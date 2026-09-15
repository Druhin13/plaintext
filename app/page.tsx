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

    try {
      const [cover, packet] = await Promise.all([
        generateCover(),
        createPacket(secret, password || undefined),
      ]);
      const invisiblePayload = bytesToInvisible(packet);
      const result = embedInvisiblePayload(cover, invisiblePayload);
      setOutput(result);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong.");
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

    try {
      const bytes = invisibleToBytes(revealInput);
      const packet = parsePacket(bytes);
      setNeedsPassword(packet.encrypted);
      const result = await revealPacket(packet, revealPassword || undefined);
      setRevealedSecret(result);
      setNeedsPassword(false);
    } catch (error) {
      if (error instanceof Error && error.message === "PASSWORD_REQUIRED") {
        setNeedsPassword(true);
        setNotice("Encrypted message detected. Enter the password to reveal it.");
      } else {
        setNotice(error instanceof Error ? error.message : "Unable to reveal this message.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyOutput() {
    if (!output) {
      return;
    }
    await navigator.clipboard.writeText(output);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setNotice("");
  }

  return (
    <main className="app-shell">
      <header className="app-nav">
        <a className="brand" href="#" aria-label="plaintext home">
          <span className="brand-prompt">$</span>
          <span>plaintext</span>
          <span className="brand-cursor">_</span>
        </a>
        <div className="nav-actions">
          <div className="model-status" title={modelMessage}>
            <span className={`status-dot ${modelState === "error" ? "muted" : ""}`} />
            <span>{modelState === "generating" ? "working" : modelState}</span>
          </div>
          <Link className="learn-link" href="/learn">learn more ↗</Link>
        </div>
      </header>

      <section className="terminal" aria-label="plaintext terminal">
        <div className="terminal-bar">
          <div className="terminal-dots" aria-hidden="true"><span /><span /><span /></div>
          <span className="terminal-title">plaintext.local</span>
          <div className="mode-switch" role="tablist" aria-label="plaintext mode">
            <button className={mode === "hide" ? "active" : ""} onClick={() => switchMode("hide")} type="button" role="tab" aria-selected={mode === "hide"}>hide</button>
            <button className={mode === "reveal" ? "active" : ""} onClick={() => switchMode("reveal")} type="button" role="tab" aria-selected={mode === "reveal"}>reveal</button>
          </div>
        </div>

        {(modelState === "loading" || modelState === "generating") && (
          <div className="progress-track" aria-label={modelMessage}>
            <span style={{ width: `${modelProgress || 8}%` }} />
          </div>
        )}

        {mode === "hide" ? (
          <div className="terminal-body">
            <div className="command-line"><span className="prompt">$</span><span>plaintext hide</span></div>

            <label className="terminal-field" htmlFor="secret-input">
              <span className="field-label">secret</span>
              <textarea id="secret-input" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="type your secret…" spellCheck={false} />
              <span className="field-meta">{secret.length} chars</span>
            </label>

            <div className="option-row">
              <label>
                <span>password <em>optional</em></span>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="none" autoComplete="new-password" />
              </label>
              <label>
                <span>cover</span>
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

            <button className="run-button" type="button" onClick={handleHide} disabled={busy || !secret.trim()}>
              <span>{busy ? "running…" : "run hide"}</span>
              <span>↵</span>
            </button>

            {notice && <div className="notice" role="status"><span>!</span>{notice}</div>}

            <div className={`terminal-output ${output ? "has-output" : ""}`}>
              <div className="output-heading">
                <span>stdout</span>
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
                <div className="output-empty"><span className="blink">_</span></div>
              )}
            </div>
          </div>
        ) : (
          <div className="terminal-body">
            <div className="command-line"><span className="prompt">$</span><span>plaintext reveal</span></div>

            <label className="terminal-field" htmlFor="reveal-input">
              <span className="field-label">plaintext</span>
              <textarea id="reveal-input" value={revealInput} onChange={(event) => setRevealInput(event.target.value)} placeholder="paste a message…" spellCheck={false} />
              <span className="field-meta">{countHiddenCharacters(revealInput)} hidden chars</span>
            </label>

            {(needsPassword || revealPassword) && (
              <label className="password-row">
                <span>password</span>
                <input type="password" value={revealPassword} onChange={(event) => setRevealPassword(event.target.value)} placeholder="enter password" autoComplete="current-password" />
              </label>
            )}

            <button className="run-button" type="button" onClick={handleReveal} disabled={busy || !revealInput.trim()}>
              <span>{busy ? "running…" : "run reveal"}</span>
              <span>↵</span>
            </button>

            {notice && <div className="notice" role="status"><span>!</span>{notice}</div>}

            <div className={`terminal-output ${revealedSecret ? "has-output" : ""}`}>
              <div className="output-heading"><span>stdout</span><span>{revealedSecret ? "secret found" : "waiting"}</span></div>
              {revealedSecret ? (
                <div className="secret-result">{revealedSecret}</div>
              ) : (
                <div className="output-empty"><span className="blink">_</span></div>
              )}
            </div>
          </div>
        )}

        <div className="terminal-statusbar">
          <span>{modelMessage}</span>
          <span>local / browser</span>
        </div>
      </section>
    </main>
  );
}
