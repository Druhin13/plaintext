"use client";

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
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

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
        worker.postMessage({ type: "generate", requestId, prompt });
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
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="plaintext home">
          <span className="brand-mark">p_</span>
          <span>plaintext</span>
        </a>
        <div className="privacy-pill"><span className="status-dot" /> local only</div>
      </header>

      <section className="hero">
        <p className="eyebrow">steganography for ordinary text</p>
        <h1>Say one thing.<br /><span>Mean another.</span></h1>
        <p className="intro">Hide a secret inside a completely ordinary sentence. No account, no server, no trace. Everything happens in your browser.</p>
      </section>

      <section className="workspace">
        <div className="mode-switch" role="tablist" aria-label="plaintext mode">
          <button className={mode === "hide" ? "active" : ""} onClick={() => switchMode("hide")} type="button">Hide</button>
          <button className={mode === "reveal" ? "active" : ""} onClick={() => switchMode("reveal")} type="button">Reveal</button>
        </div>

        {mode === "hide" ? (
          <div className="panel-grid">
            <div className="panel input-panel">
              <div className="panel-heading">
                <span>01 / secret</span>
                <span>{secret.length} chars</span>
              </div>
              <textarea value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Type something you don't want to say out loud…" spellCheck={false} />
              <div className="field-row">
                <label>
                  <span>Password <em>optional</em></span>
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Encrypt before hiding" autoComplete="new-password" />
                </label>
                <label>
                  <span>Cover style</span>
                  <select value={coverStyle} onChange={(event) => setCoverStyle(event.target.value as CoverStyle)}>
                    <option value="auto">Auto</option>
                    <option value="casual">Casual</option>
                    <option value="work">Work</option>
                    <option value="friendly">Friendly</option>
                    <option value="story">Story</option>
                    <option value="random">Random</option>
                  </select>
                </label>
              </div>
              <button className="primary-button" type="button" onClick={handleHide} disabled={busy || !secret.trim()}>
                <span>{busy ? "Working…" : "Hide in plain sight"}</span>
                <span>↗</span>
              </button>
            </div>

            <div className={`panel output-panel ${output ? "has-output" : ""}`}>
              <div className="panel-heading">
                <span>02 / plaintext</span>
                {output ? <span>{hiddenCount} invisible chars</span> : <span>waiting</span>}
              </div>
              {output ? (
                <>
                  <div className="output-copy">{output}</div>
                  <div className="output-actions">
                    <button type="button" onClick={copyOutput}>{copied ? "Copied" : "Copy message"}</button>
                    <button type="button" onClick={handleHide} disabled={busy}>Regenerate</button>
                  </div>
                </>
              ) : (
                <div className="empty-output">
                  <div className="cursor-box">_</div>
                  <p>Your innocent-looking message will appear here.</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="panel-grid reveal-grid">
            <div className="panel input-panel">
              <div className="panel-heading"><span>01 / paste</span><span>{countHiddenCharacters(revealInput)} hidden chars</span></div>
              <textarea value={revealInput} onChange={(event) => setRevealInput(event.target.value)} placeholder="Paste a plaintext message here…" spellCheck={false} />
              {(needsPassword || revealPassword) && (
                <label className="single-field">
                  <span>Password</span>
                  <input type="password" value={revealPassword} onChange={(event) => setRevealPassword(event.target.value)} placeholder="Enter password" autoComplete="current-password" />
                </label>
              )}
              <button className="primary-button" type="button" onClick={handleReveal} disabled={busy || !revealInput.trim()}>
                <span>{busy ? "Inspecting…" : "Reveal message"}</span>
                <span>↘</span>
              </button>
            </div>

            <div className={`panel output-panel ${revealedSecret ? "has-output" : ""}`}>
              <div className="panel-heading"><span>02 / secret</span><span>{revealedSecret ? "found" : "waiting"}</span></div>
              {revealedSecret ? (
                <div className="secret-result"><span>decrypted output</span><p>{revealedSecret}</p></div>
              ) : (
                <div className="empty-output"><div className="cursor-box">_</div><p>Any hidden message will be revealed here.</p></div>
              )}
            </div>
          </div>
        )}

        {notice && <div className="notice" role="status">{notice}</div>}
      </section>

      <section className="system-strip">
        <div><span className={`status-dot ${modelState === "error" ? "muted" : ""}`} /><strong>{modelMessage}</strong></div>
        {(modelState === "loading" || modelState === "generating") && <div className="progress-track"><span style={{ width: `${modelProgress || 8}%` }} /></div>}
        <p>{modelState === "idle" ? "The ~350M local model downloads on first use and is cached by your browser." : "Cover text is generated locally. Your secret is never included in the AI prompt."}</p>
      </section>

      <section className="how-it-works">
        <div className="section-label">how it works</div>
        <div className="steps">
          <article><span>01</span><h2>Write</h2><p>Enter any secret. Add a password if you want AES-256-GCM encryption.</p></article>
          <article><span>02</span><h2>Disguise</h2><p>A tiny local model writes natural cover text. Your payload is encoded with invisible Unicode.</p></article>
          <article><span>03</span><h2>Reveal</h2><p>Paste the untouched message back here. plaintext extracts and decrypts what nobody else can see.</p></article>
        </div>
      </section>

      <footer><span>plaintext / experimental</span><span>browser-only · open source</span></footer>
    </main>
  );
}
