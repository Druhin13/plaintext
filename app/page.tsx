"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCoverPrompt, cleanGeneratedCover, createFallbackCover, type CoverStyle } from "@/lib/cover";
import { createPacket, parsePacket, revealPacket } from "@/lib/packet";
import { bytesToInvisible, countHiddenCharacters, embedInvisiblePayload, invisibleToBytes } from "@/lib/stego";

type Mode = "hide" | "reveal";
type ModelState = "idle" | "loading" | "ready" | "generating" | "error";

type PendingGeneration = {
  id: string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
};

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function friendlyRevealError(error: unknown) {
  if (!(error instanceof Error)) {
    return "Could not reveal a hidden message from this text.";
  }

  if (error.message === "No hidden message found.") {
    return "No hidden message found. Make sure you pasted the full generated text without editing it.";
  }

  if (error.message === "A hidden message was found, but it appears to be damaged.") {
    return "A hidden message was found, but some of it is missing or changed. Paste the original generated text again.";
  }

  if (error.message === "Incorrect password or damaged message.") {
    return "The password is incorrect, or the generated text was changed. Check the password and try the original text again.";
  }

  return error.message;
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("hide");
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [coverStyle, setCoverStyle] = useState<CoverStyle>("auto");
  const [output, setOutput] = useState("");
  const [revealInput, setRevealInput] = useState("");
  const [revealPassword, setRevealPassword] = useState("");
  const [revealedSecret, setRevealedSecret] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [modelState, setModelState] = useState<ModelState>("idle");
  const [modelMessage, setModelMessage] = useState("Starting local AI");
  const [modelProgress, setModelProgress] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<PendingGeneration | null>(null);

  const revealHiddenCount = useMemo(() => countHiddenCharacters(revealInput), [revealInput]);

  const modelStatusLabel = useMemo(() => {
    if (modelState === "loading") return "loading local AI";
    if (modelState === "ready") return "local AI ready";
    if (modelState === "generating") return "writing generated text";
    if (modelState === "error") return "built-in text fallback";
    return "starting local AI";
  }, [modelState]);

  const revealInputStatus = useMemo(() => {
    if (!revealInput) return "paste full text";
    if (revealHiddenCount > 0) return "hidden data detected";
    return "no hidden data detected";
  }, [revealHiddenCount, revealInput]);

  const getWorker = useCallback(() => {
    if (workerRef.current) {
      return workerRef.current;
    }

    const worker = new Worker(new URL("../workers/cover.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const message = event.data;
      if (message?.type === "status") {
        setModelState(message.status);
        setModelMessage(message.message);
      }
      if (message?.type === "progress") {
        setModelProgress(message.progress ?? 0);
      }
      if (message?.type === "generated") {
        const pending = pendingRef.current;
        if (pending && pending.id === message.requestId) {
          pendingRef.current = null;
          pending.resolve(message.text ?? "");
        }
      }
      if (message?.type === "error") {
        setModelState("error");
        setModelMessage("Using built-in text fallback");
        const pending = pendingRef.current;
        if (pending && (!message.requestId || pending.id === message.requestId)) {
          pendingRef.current = null;
          pending.reject(new Error(message.message || "Local model unavailable."));
        }
      }
    };
    worker.onerror = () => {
      setModelState("error");
      setModelMessage("Using built-in text fallback");
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) {
        pending.reject(new Error("Local model worker failed."));
      }
    };
    workerRef.current = worker;
    return worker;
  }, []);

  useEffect(() => {
    if (!("gpu" in navigator)) {
      setModelState("error");
      setModelMessage("WebGPU unavailable · using built-in text");
      return;
    }

    const worker = getWorker();
    worker.postMessage({ type: "load" });

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [getWorker]);

  useEffect(() => {
    if (modelState !== "ready" || !("gpu" in navigator)) {
      return;
    }

    const worker = getWorker();
    worker.postMessage({
      type: "prime",
      cacheKey: coverStyle,
      prompt: buildCoverPrompt(coverStyle),
      target: 2,
    });
  }, [coverStyle, getWorker, modelState]);

  const generateCover = useCallback(async () => {
    if (!("gpu" in navigator)) {
      setModelState("error");
      setModelMessage("WebGPU unavailable · using built-in text");
      return createFallbackCover();
    }

    try {
      const worker = getWorker();
      const requestId = makeId();
      const prompt = buildCoverPrompt(coverStyle);
      const generated = await new Promise<string>((resolve, reject) => {
        pendingRef.current = { id: requestId, resolve, reject };
        worker.postMessage({
          type: "generate",
          requestId,
          prompt,
          cacheKey: coverStyle,
        });
      });
      const cleaned = cleanGeneratedCover(generated);
      if (cleaned.length < 20) {
        throw new Error("Generated text was too short.");
      }
      return cleaned;
    } catch {
      setModelState("error");
      setModelMessage("Using built-in text fallback");
      return createFallbackCover();
    }
  }, [coverStyle, getWorker]);

  async function handleHide() {
    if (!secret.trim()) {
      setNotice("Enter the message you want to hide.");
      return;
    }

    setBusy(true);
    setNotice("");
    setCopied(false);
    setAnnouncement("Creating generated text and hiding your message inside it.");

    try {
      const [cover, packet] = await Promise.all([
        generateCover(),
        createPacket(secret, password || undefined),
      ]);
      const invisiblePayload = bytesToInvisible(packet);
      const result = embedInvisiblePayload(cover, invisiblePayload);
      setOutput(result);
      setAnnouncement("Your message is hidden. The generated text is ready to copy.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not hide the message.";
      setNotice(message);
      setAnnouncement("Could not hide the message.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReveal() {
    if (!revealInput.trim()) {
      setNotice("Paste the full generated text first.");
      return;
    }

    setBusy(true);
    setNotice("");
    setRevealedSecret("");
    setAnnouncement("Checking the pasted text for a hidden message.");

    try {
      const bytes = invisibleToBytes(revealInput);
      const packet = parsePacket(bytes);
      setNeedsPassword(packet.encrypted);
      const result = await revealPacket(packet, revealPassword || undefined);
      setRevealedSecret(result);
      setNeedsPassword(false);
      setAnnouncement("Hidden message revealed.");
    } catch (error) {
      if (error instanceof Error && error.message === "PASSWORD_REQUIRED") {
        setNeedsPassword(true);
        setNotice("This hidden message is password-protected. Enter the password, then reveal it again.");
        setAnnouncement("A password is required to reveal this hidden message.");
      } else {
        const message = friendlyRevealError(error);
        setNotice(message);
        setAnnouncement("Could not reveal a hidden message from this text.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyOutput() {
    if (!output) {
      return;
    }

    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setNotice("");
      setAnnouncement("Generated text copied to the clipboard.");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setNotice("Copy failed. Select the generated text and copy it manually.");
      setAnnouncement("Automatic copy failed.");
    }
  }

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setNotice("");
    setAnnouncement(`${nextMode === "hide" ? "Hide" : "Reveal"} mode selected.`);
  }

  function submitHide(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleHide();
  }

  function submitReveal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleReveal();
  }

  const progressValue = Math.max(0, Math.min(100, modelProgress));

  return (
    <main className="app-shell">
      <h1 className="sr-only">plaintext — hide a message inside ordinary-looking text or reveal one</h1>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>

      <header className="app-nav">
        <Link className="brand" href="/" aria-label="plaintext home">
          <span className="brand-prompt" aria-hidden="true">$</span>
          <span>plaintext</span>
          <span className="brand-cursor" aria-hidden="true">_</span>
        </Link>
        <div className="nav-actions">
          <div className="model-status" role="status" aria-live="polite" aria-atomic="true" title={modelMessage}>
            <span className={`status-dot ${modelState === "error" ? "muted" : ""}`} aria-hidden="true" />
            <span>{modelStatusLabel}</span>
          </div>
          <Link className="learn-link" href="/learn">how it works <span aria-hidden="true">↗</span></Link>
        </div>
      </header>

      <section className="terminal" aria-label="Hide or reveal a hidden message" aria-busy={busy}>
        <div className="terminal-bar">
          <div className="terminal-dots" aria-hidden="true"><span /><span /><span /></div>
          <span className="terminal-title" aria-hidden="true">plaintext.local</span>
          <div className="mode-switch" role="group" aria-label="Choose what you want to do">
            <button className={mode === "hide" ? "active" : ""} onClick={() => switchMode("hide")} type="button" aria-pressed={mode === "hide"}>hide</button>
            <button className={mode === "reveal" ? "active" : ""} onClick={() => switchMode("reveal")} type="button" aria-pressed={mode === "reveal"}>reveal</button>
          </div>
        </div>

        {(modelState === "loading" || modelState === "generating") && (
          <div
            className="progress-track"
            role="progressbar"
            aria-label={modelMessage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressValue > 0 ? progressValue : undefined}
            aria-valuetext={modelMessage}
          >
            <span style={{ width: `${progressValue || 8}%` }} />
          </div>
        )}

        {mode === "hide" ? (
          <div className="terminal-body">
            <div className="command-line" aria-hidden="true"><span className="prompt">$</span><span>plaintext hide</span></div>
            <h2 className="sr-only">Hide a message</h2>

            <form className="terminal-form" onSubmit={submitHide} aria-busy={busy}>
              <div className="terminal-field">
                <div className="field-topline">
                  <label className="field-label" htmlFor="secret-input">message to hide</label>
                  <span className="field-meta" id="secret-count">{secret.length} chars</span>
                </div>
                <textarea
                  id="secret-input"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder="type the message you want to hide…"
                  spellCheck={false}
                  aria-describedby="secret-count"
                />
              </div>

              <div className="option-row">
                <label>
                  <span>password <em>optional · encrypts</em></span>
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="leave blank for no encryption" autoComplete="new-password" />
                </label>
                <label>
                  <span>visible text style</span>
                  <select value={coverStyle} onChange={(event) => setCoverStyle(event.target.value as CoverStyle)}>
                    <option value="auto">automatic</option>
                    <option value="casual">casual</option>
                    <option value="work">work</option>
                    <option value="friendly">friendly</option>
                    <option value="story">story</option>
                    <option value="random">random</option>
                  </select>
                </label>
              </div>

              <button className="run-button" type="submit" disabled={busy || !secret.trim()}>
                <span>{busy ? "hiding message…" : "hide message"}</span>
                <span aria-hidden="true">↵</span>
              </button>
            </form>

            {notice && <div className="notice" role="alert"><span aria-hidden="true">!</span><span>{notice}</span></div>}

            <section className={`terminal-output ${output ? "has-output" : ""}`} aria-labelledby="hide-output-heading">
              <div className="output-heading">
                <span id="hide-output-heading">text to copy</span>
                <span>{output ? "ready" : "waiting"}</span>
              </div>
              {output ? (
                <>
                  <div className="output-copy">{output}</div>
                  <div className="output-actions">
                    <button type="button" onClick={copyOutput}>{copied ? "copied ✓" : "copy text"}</button>
                    <button type="button" onClick={handleHide} disabled={busy}>generate another</button>
                  </div>
                </>
              ) : (
                <div className="output-empty"><span>generated text will appear here</span></div>
              )}
            </section>
          </div>
        ) : (
          <div className="terminal-body">
            <div className="command-line" aria-hidden="true"><span className="prompt">$</span><span>plaintext reveal</span></div>
            <h2 className="sr-only">Reveal a hidden message</h2>

            <form className="terminal-form" onSubmit={submitReveal} aria-busy={busy}>
              <div className="terminal-field">
                <div className="field-topline">
                  <label className="field-label" htmlFor="reveal-input">text to inspect</label>
                  <span className="field-meta" id="reveal-count">{revealInputStatus}</span>
                </div>
                <textarea
                  id="reveal-input"
                  value={revealInput}
                  onChange={(event) => setRevealInput(event.target.value)}
                  placeholder="paste the full generated text here…"
                  spellCheck={false}
                  aria-describedby="reveal-count"
                />
              </div>

              {(needsPassword || revealPassword) && (
                <label className="password-row">
                  <span>password required</span>
                  <input type="password" value={revealPassword} onChange={(event) => setRevealPassword(event.target.value)} placeholder="enter the password used to hide it" autoComplete="current-password" autoFocus={needsPassword} />
                </label>
              )}

              <button className="run-button" type="submit" disabled={busy || !revealInput.trim()}>
                <span>{busy ? "checking text…" : "reveal hidden message"}</span>
                <span aria-hidden="true">↵</span>
              </button>
            </form>

            {notice && <div className="notice" role="alert"><span aria-hidden="true">!</span><span>{notice}</span></div>}

            <section className={`terminal-output ${revealedSecret ? "has-output" : ""}`} aria-labelledby="reveal-output-heading">
              <div className="output-heading"><span id="reveal-output-heading">hidden message</span><span>{revealedSecret ? "revealed" : "waiting"}</span></div>
              {revealedSecret ? (
                <div className="secret-result">{revealedSecret}</div>
              ) : (
                <div className="output-empty"><span>hidden message will appear here</span></div>
              )}
            </section>
          </div>
        )}

        <div className="terminal-statusbar" aria-hidden="true">
          <span>{modelMessage}</span>
          <span>secret processed in browser</span>
        </div>
      </section>
    </main>
  );
}
