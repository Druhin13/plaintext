"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCoverPrompt, cleanGeneratedCover, createFallbackCover, type CoverStyle } from "@/lib/cover";
import { createPacket, parsePacket, revealPacket } from "@/lib/packet";
import { bytesToInvisible, countHiddenCharacters, embedInvisiblePayload, invisibleToBytes } from "@/lib/stego";

type Mode = "hide" | "reveal";
type ModelState = "idle" | "loading" | "ready" | "generating" | "error";
type Step = 1 | 2 | 3;

type PendingGeneration = {
  id: string;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
};

const COVER_STYLES: Array<{ value: CoverStyle; label: string; hint: string }> = [
  { value: "auto", label: "automatic", hint: "best fit" },
  { value: "casual", label: "casual", hint: "everyday" },
  { value: "work", label: "work", hint: "professional" },
  { value: "friendly", label: "friendly", hint: "warm" },
  { value: "story", label: "story", hint: "narrative" },
  { value: "random", label: "random", hint: "surprise me" },
];

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
  const [hideStep, setHideStep] = useState<Step>(1);
  const [revealStep, setRevealStep] = useState<Step>(1);
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
  const currentStep = mode === "hide" ? hideStep : revealStep;

  const modelStatusLabel = useMemo(() => {
    if (modelState === "loading") return "loading local AI";
    if (modelState === "ready") return "local AI ready";
    if (modelState === "generating") return "writing generated text";
    if (modelState === "error") return "built-in text fallback";
    return "starting local AI";
  }, [modelState]);

  const revealInputStatus = useMemo(() => {
    if (!revealInput) return "waiting for text";
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
      setHideStep(1);
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
      setHideStep(3);
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
      setRevealStep(1);
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
      setRevealStep(3);
      setAnnouncement("Hidden message revealed.");
    } catch (error) {
      if (error instanceof Error && error.message === "PASSWORD_REQUIRED") {
        setNeedsPassword(true);
        setRevealStep(2);
        setNotice("");
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

  function continueHide() {
    if (!secret.trim()) {
      setNotice("Enter the message you want to hide.");
      return;
    }
    setNotice("");
    setHideStep(2);
    setAnnouncement("Message entered. Choose how the generated text should work.");
  }

  function resetHide() {
    setSecret("");
    setPassword("");
    setCoverStyle("auto");
    setOutput("");
    setCopied(false);
    setNotice("");
    setHideStep(1);
  }

  function resetReveal() {
    setRevealInput("");
    setRevealPassword("");
    setRevealedSecret("");
    setNeedsPassword(false);
    setNotice("");
    setRevealStep(1);
  }

  const progressValue = Math.max(0, Math.min(100, modelProgress));
  const stepLabels = mode === "hide"
    ? ["write", "configure", "share"]
    : ["paste", "unlock", "read"];

  return (
    <main className="app-shell">
      <h1 className="sr-only">plaintext.fun — hide a message inside ordinary-looking text or reveal one</h1>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>

      <header className="app-nav">
        <Link className="brand" href="/" aria-label="plaintext.fun home">
          <span className="brand-prompt" aria-hidden="true">$</span>
          <span>plaintext.fun</span>
        </Link>
        <div className="nav-actions">
          <div className="model-status" role="status" aria-live="polite" aria-atomic="true" title={modelMessage}>
            <span className={`status-dot ${modelState === "error" ? "muted" : ""}`} aria-hidden="true" />
            <span>{modelStatusLabel}</span>
          </div>
          <Link className="learn-link" href="/learn">how it works <span aria-hidden="true">↗</span></Link>
        </div>
      </header>

      <section className="wizard" aria-label="Hide or reveal a hidden message" aria-busy={busy}>
        <div className="wizard-chrome">
          <div className="session-id"><span>session</span><strong>plaintext.fun</strong></div>
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

        <ol className="stepper" aria-label={`${mode} progress`}>
          {stepLabels.map((label, index) => {
            const step = (index + 1) as Step;
            const state = step < currentStep ? "done" : step === currentStep ? "current" : "upcoming";
            return (
              <li key={label} className={state} aria-current={state === "current" ? "step" : undefined}>
                <span className="step-number">0{step}</span>
                <span className="step-label">{label}</span>
              </li>
            );
          })}
        </ol>

        <div className="step-stage">
          {mode === "hide" && hideStep === 1 && (
            <section className="step-card" aria-labelledby="hide-step-one-title">
              <div className="step-copy">
                <span className="step-kicker">01 / write</span>
                <h2 id="hide-step-one-title">What do you want to hide?</h2>
                <p>Type the message exactly as you want it to come back later. It stays in your browser.</p>
              </div>

              <form onSubmit={(event) => { event.preventDefault(); continueHide(); }}>
                <div className="terminal-field light-field">
                  <div className="field-topline">
                    <label className="field-label" htmlFor="secret-input">message</label>
                    <span className="field-meta" id="secret-count">{secret.length} chars</span>
                  </div>
                  <textarea
                    id="secret-input"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                    placeholder="meet me by the old cinema at 8"
                    spellCheck={false}
                    aria-describedby="secret-count"
                    autoFocus
                  />
                </div>

                {notice && <div className="notice" role="alert"><span aria-hidden="true">!</span><span>{notice}</span></div>}

                <div className="step-actions">
                  <span className="key-hint">nothing leaves the browser</span>
                  <button className="primary-action" type="submit" disabled={!secret.trim()}>
                    continue <span aria-hidden="true">→</span>
                  </button>
                </div>
              </form>
            </section>
          )}

          {mode === "hide" && hideStep === 2 && (
            <section className="step-card" aria-labelledby="hide-step-two-title">
              <div className="step-copy">
                <span className="step-kicker">02 / configure</span>
                <h2 id="hide-step-two-title">Make the outside look ordinary.</h2>
                <p>Choose the tone of the visible text. Add a password if the hidden message should also be encrypted.</p>
              </div>

              <form onSubmit={(event) => { event.preventDefault(); void handleHide(); }}>
                <fieldset className="choice-fieldset">
                  <legend>visible text style</legend>
                  <div className="choice-grid">
                    {COVER_STYLES.map((style) => (
                      <button
                        className={coverStyle === style.value ? "choice active" : "choice"}
                        key={style.value}
                        type="button"
                        onClick={() => setCoverStyle(style.value)}
                        aria-pressed={coverStyle === style.value}
                      >
                        <strong>{style.label}</strong>
                        <span>{style.hint}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label className="password-field">
                  <span className="password-label"><strong>password</strong><em>optional</em></span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="leave blank for no encryption"
                    autoComplete="new-password"
                  />
                  <small>{password ? "The hidden message will be encrypted before it is embedded." : "Without a password, the message is hidden but not encrypted."}</small>
                </label>

                {notice && <div className="notice" role="alert"><span aria-hidden="true">!</span><span>{notice}</span></div>}

                <div className="step-actions split-actions">
                  <button className="text-action" type="button" onClick={() => { setNotice(""); setHideStep(1); }}>← back</button>
                  <button className="primary-action" type="submit" disabled={busy}>
                    {busy ? "hiding…" : "hide message"} <span aria-hidden="true">→</span>
                  </button>
                </div>
              </form>
            </section>
          )}

          {mode === "hide" && hideStep === 3 && (
            <section className="step-card result-step" aria-labelledby="hide-step-three-title">
              <div className="result-intro">
                <span className="success-mark" aria-hidden="true">✓</span>
                <div>
                  <span className="step-kicker">03 / share</span>
                  <h2 id="hide-step-three-title">Hidden in plain sight.</h2>
                  <p>Copy the text exactly as it is. Editing or reformatting it can damage the hidden data.</p>
                </div>
              </div>

              <div className="result-console">
                <div className="result-console-head">
                  <span>generated text</span>
                  <span className="ready-state">ready</span>
                </div>
                <div className="output-copy">{output}</div>
              </div>

              {notice && <div className="notice" role="alert"><span aria-hidden="true">!</span><span>{notice}</span></div>}

              <div className="result-actions">
                <button className="primary-action" type="button" onClick={copyOutput}>{copied ? "copied ✓" : "copy text"}</button>
                <button className="secondary-action" type="button" onClick={() => void handleHide()} disabled={busy}>{busy ? "generating…" : "generate another"}</button>
                <button className="text-action" type="button" onClick={() => { setNotice(""); setHideStep(2); }}>edit settings</button>
                <button className="text-action" type="button" onClick={resetHide}>new message</button>
              </div>
            </section>
          )}

          {mode === "reveal" && revealStep === 1 && (
            <section className="step-card" aria-labelledby="reveal-step-one-title">
              <div className="step-copy">
                <span className="step-kicker">01 / paste</span>
                <h2 id="reveal-step-one-title">Got some plaintext?</h2>
                <p>Paste the full text you received. We’ll check it for a hidden message without changing it.</p>
              </div>

              <form onSubmit={(event) => { event.preventDefault(); void handleReveal(); }}>
                <div className="terminal-field light-field">
                  <div className="field-topline">
                    <label className="field-label" htmlFor="reveal-input">text to inspect</label>
                    <span className={`field-meta ${revealHiddenCount > 0 ? "detected" : ""}`} id="reveal-count">{revealInputStatus}</span>
                  </div>
                  <textarea
                    id="reveal-input"
                    value={revealInput}
                    onChange={(event) => setRevealInput(event.target.value)}
                    placeholder="paste the complete generated text here"
                    spellCheck={false}
                    aria-describedby="reveal-count"
                    autoFocus
                  />
                </div>

                {notice && <div className="notice" role="alert"><span aria-hidden="true">!</span><span>{notice}</span></div>}

                <div className="step-actions">
                  <span className="key-hint">paste it exactly as received</span>
                  <button className="primary-action" type="submit" disabled={busy || !revealInput.trim()}>
                    {busy ? "checking…" : "reveal message"} <span aria-hidden="true">→</span>
                  </button>
                </div>
              </form>
            </section>
          )}

          {mode === "reveal" && revealStep === 2 && (
            <section className="step-card compact-step" aria-labelledby="reveal-step-two-title">
              <div className="step-copy">
                <span className="step-kicker">02 / unlock</span>
                <h2 id="reveal-step-two-title">This one is encrypted.</h2>
                <p>The hidden message was protected with a password. Enter the same password that was used to hide it.</p>
              </div>

              <form onSubmit={(event) => { event.preventDefault(); void handleReveal(); }}>
                <label className="password-field password-focus">
                  <span className="password-label"><strong>password</strong><em>required</em></span>
                  <input
                    type="password"
                    value={revealPassword}
                    onChange={(event) => setRevealPassword(event.target.value)}
                    placeholder="enter password"
                    autoComplete="current-password"
                    autoFocus={needsPassword}
                  />
                </label>

                {notice && <div className="notice" role="alert"><span aria-hidden="true">!</span><span>{notice}</span></div>}

                <div className="step-actions split-actions">
                  <button className="text-action" type="button" onClick={() => { setNotice(""); setRevealStep(1); }}>← back</button>
                  <button className="primary-action" type="submit" disabled={busy || !revealPassword}>
                    {busy ? "unlocking…" : "unlock message"} <span aria-hidden="true">→</span>
                  </button>
                </div>
              </form>
            </section>
          )}

          {mode === "reveal" && revealStep === 3 && (
            <section className="step-card result-step" aria-labelledby="reveal-step-three-title">
              <div className="result-intro">
                <span className="success-mark" aria-hidden="true">✓</span>
                <div>
                  <span className="step-kicker">03 / read</span>
                  <h2 id="reveal-step-three-title">Found it.</h2>
                  <p>The hidden message was recovered from the text you pasted.</p>
                </div>
              </div>

              <div className="result-console secret-console">
                <div className="result-console-head">
                  <span>hidden message</span>
                  <span className="ready-state">revealed</span>
                </div>
                <div className="secret-result">{revealedSecret}</div>
              </div>

              <div className="result-actions single-result-action">
                <button className="primary-action" type="button" onClick={resetReveal}>check another</button>
              </div>
            </section>
          )}
        </div>

        <div className="wizard-footer" aria-hidden="true">
          <span>{modelMessage}</span>
          <span>plaintext.fun / secret processed in browser</span>
        </div>
      </section>
    </main>
  );
}
