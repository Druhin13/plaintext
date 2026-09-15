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
  const [modelMessage, setModelMessage] = useState("Model not loaded");
  const [modelProgress, setModelProgress] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<PendingGeneration | null>(null);

  const hiddenCount = useMemo(() => countHiddenCharacters(output), [output]);

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
        setModelMessage("Local model unavailable");
        const pending = pendingRef.current;
        if (pending && (!message.requestId || pending.id === message.requestId)) {
          pendingRef.current = null;
          pending.reject(new Error(message.message || "Local model unavailable."));
        }
      }
    };
    worker.onerror = () => {
      setModelState("error");
      setModelMessage("Local model unavailable");
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
      setModelMessage("WebGPU unavailable · using fallback");
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
      setModelMessage("WebGPU unavailable · using fallback");
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
        throw new Error("Generated cover was too short.");
      }
      return cleaned;
    } catch {
      setModelState("error");
      setModelMessage("AI fallback active");
      return createFallbackCover();
    }
  }, [coverStyle, getWorker]);

  async function handleHide() {
    if (!secret.trim()) {
      setNotice("Enter something to hide first.");
      return;
    }

    setBusy(true);
    setNotice("");
    setCopied(false);
    setAnnouncement("Generating cover text.");

    try {
      const [cover, packet] = await Promise.all([
        generateCover(),
        createPacket(secret, password || undefined),
      ]);
      const invisiblePayload = bytesToInvisible(packet);
      const result = embedInvisiblePayload(cover, invisiblePayload);
      setOutput(result);
      setAnnouncement("Cover text generated. It is ready to copy.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setNotice(message);
      setAnnouncement("Unable to hide the message.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReveal() {
    if (!revealInput.trim()) {
      setNotice("Paste a plaintext message first.");
      return;
    }

    setBusy(true);
    setNotice("");
    setRevealedSecret("");
    setAnnouncement("Inspecting pasted text.");

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
        setNotice("Encrypted message detected. Enter the password to reveal it.");
        setAnnouncement("Encrypted message detected. A password is required.");
      } else {
        const message = error instanceof Error ? error.message : "Unable to reveal this message.";
        setNotice(message);
        setAnnouncement("Unable to reveal the message.");
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
      setAnnouncement("Copied to clipboard.");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setNotice("Could not copy automatically. Select the generated text and copy it manually.");
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
      <h1 className="sr-only">plaintext — hide or reveal a message in ordinary-looking text</h1>
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
            <span>{modelState === "generating" ? "working" : modelState}</span>
          </div>
          <Link className="learn-link" href="/learn">learn more <span aria-hidden="true">↗</span></Link>
        </div>
      </header>

      <section className="terminal" aria-label="plaintext conversion terminal" aria-busy={busy}>
        <div className="terminal-bar">
          <div className="terminal-dots" aria-hidden="true"><span /><span /><span /></div>
          <span className="terminal-title" aria-hidden="true">plaintext.local</span>
          <div className="mode-switch" role="group" aria-label="Mode">
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
                  <label className="field-label" htmlFor="secret-input">secret</label>
                  <span className="field-meta" id="secret-count">{secret.length} chars</span>
                </div>
                <textarea
                  id="secret-input"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder="type your secret…"
                  spellCheck={false}
                  aria-describedby="secret-count"
                />
              </div>

              <div className="option-row">
                <label>
                  <span>password <em>optional</em></span>
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="none" autoComplete="new-password" />
                </label>
                <label>
                  <span>cover style</span>
                  <select value={coverStyle} onChange={(event) => setCoverStyle(event.target.value as CoverStyle)}>
                    <option value="auto">auto</option>
                    <option value="casual">casual</option>
                    <option value="work">work</option>
                    <option value="friendly">friendly</option>
                    <option value="story">story</option>
                    <option value="random">random</option>
                  </select>
                </label>
              </div>

              <button className="run-button" type="submit" disabled={busy || !secret.trim()}>
                <span>{busy ? "running…" : "run hide"}</span>
                <span aria-hidden="true">↵</span>
              </button>
            </form>

            {notice && <div className="notice" role="alert"><span aria-hidden="true">!</span><span>{notice}</span></div>}

            <section className={`terminal-output ${output ? "has-output" : ""}`} aria-labelledby="hide-output-heading">
              <div className="output-heading">
                <span id="hide-output-heading">output</span>
                <span>{output ? `${hiddenCount} hidden chars` : "waiting"}</span>
              </div>
              {output ? (
                <>
                  <div className="output-copy">{output}</div>
                  <div className="output-actions">
                    <button type="button" onClick={copyOutput}>{copied ? "copied ✓" : "copy"}</button>
                    <button type="button" onClick={handleHide} disabled={busy}>regenerate</button>
                  </div>
                </>
              ) : (
                <div className="output-empty" aria-hidden="true"><span className="blink">_</span></div>
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
                  <label className="field-label" htmlFor="reveal-input">plaintext</label>
                  <span className="field-meta" id="reveal-count">{countHiddenCharacters(revealInput)} hidden chars</span>
                </div>
                <textarea
                  id="reveal-input"
                  value={revealInput}
                  onChange={(event) => setRevealInput(event.target.value)}
                  placeholder="paste a message…"
                  spellCheck={false}
                  aria-describedby="reveal-count"
                />
              </div>

              {(needsPassword || revealPassword) && (
                <label className="password-row">
                  <span>password</span>
                  <input type="password" value={revealPassword} onChange={(event) => setRevealPassword(event.target.value)} placeholder="enter password" autoComplete="current-password" autoFocus={needsPassword} />
                </label>
              )}

              <button className="run-button" type="submit" disabled={busy || !revealInput.trim()}>
                <span>{busy ? "running…" : "run reveal"}</span>
                <span aria-hidden="true">↵</span>
              </button>
            </form>

            {notice && <div className="notice" role="alert"><span aria-hidden="true">!</span><span>{notice}</span></div>}

            <section className={`terminal-output ${revealedSecret ? "has-output" : ""}`} aria-labelledby="reveal-output-heading">
              <div className="output-heading"><span id="reveal-output-heading">output</span><span>{revealedSecret ? "secret found" : "waiting"}</span></div>
              {revealedSecret ? (
                <div className="secret-result">{revealedSecret}</div>
              ) : (
                <div className="output-empty" aria-hidden="true"><span className="blink">_</span></div>
              )}
            </section>
          </div>
        )}

        <div className="terminal-statusbar" aria-hidden="true">
          <span>{modelMessage}</span>
          <span>local / browser</span>
        </div>
      </section>
    </main>
  );
}
