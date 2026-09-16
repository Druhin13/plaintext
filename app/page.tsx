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
  { value: "auto", label: "Automatic", hint: "Let plaintext choose" },
  { value: "casual", label: "Casual", hint: "Everyday and relaxed" },
  { value: "work", label: "Work", hint: "Neutral and professional" },
  { value: "friendly", label: "Friendly", hint: "Warm and conversational" },
  { value: "story", label: "Story", hint: "A little more narrative" },
  { value: "random", label: "Random", hint: "Something unexpected" },
];

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function friendlyRevealError(error: unknown) {
  if (!(error instanceof Error)) {
    return "Could not reveal a hidden message from this text.";
  }

  if (error.message === "No hidden message found.") {
    return "No hidden message found. Make sure you pasted the complete generated text without editing it.";
  }

  if (error.message === "A hidden message was found, but it appears to be damaged.") {
    return "A hidden message was found, but some of it is missing or changed. Paste the original generated text again.";
  }

  if (error.message === "Incorrect password or damaged message.") {
    return "The password is incorrect, or the generated text was changed. Check the password and try the original text again.";
  }

  return error.message;
}

function getEngineLabel(state: ModelState) {
  if (state === "loading") return "LOADING";
  if (state === "generating") return "WRITING";
  if (state === "error") return "FALLBACK";
  if (state === "ready") return "READY";
  return "STANDBY";
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
  const [modelProgress, setModelProgress] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<PendingGeneration | null>(null);

  const revealHiddenCount = useMemo(() => countHiddenCharacters(revealInput), [revealInput]);
  const currentStep = mode === "hide" ? hideStep : revealStep;

  const revealInputStatus = useMemo(() => {
    if (!revealInput) return "Waiting";
    if (revealHiddenCount > 0) return "Hidden data detected";
    return "Nothing detected yet";
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
        const pending = pendingRef.current;
        if (pending && (!message.requestId || pending.id === message.requestId)) {
          pendingRef.current = null;
          pending.reject(new Error(message.message || "Text generator unavailable."));
        }
      }
    };
    worker.onerror = () => {
      setModelState("error");
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) {
        pending.reject(new Error("Text generator failed."));
      }
    };
    workerRef.current = worker;
    return worker;
  }, []);

  useEffect(() => {
    if (!("gpu" in navigator)) {
      setModelState("error");
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
      return createFallbackCover();
    }

    try {
      const worker = getWorker();
      const requestId = makeId();
      const prompt = buildCoverPrompt(coverStyle);
      const generated = await new Promise<string>((resolve, reject) => {
        pendingRef.current = { id: requestId, resolve, reject };
        worker.postMessage({ type: "generate", requestId, prompt, cacheKey: coverStyle });
      });
      const cleaned = cleanGeneratedCover(generated);
      if (cleaned.length < 20) {
        throw new Error("Generated text was too short.");
      }
      return cleaned;
    } catch {
      setModelState("error");
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
    setAnnouncement("Creating visible text and hiding your message inside it.");

    try {
      const [cover, packet] = await Promise.all([
        generateCover(),
        createPacket(secret, password || undefined),
      ]);
      const invisiblePayload = bytesToInvisible(packet);
      const result = embedInvisiblePayload(cover, invisiblePayload);
      setOutput(result);
      setHideStep(3);
      setAnnouncement("Your message is hidden. The text is ready to copy.");
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
      setNotice("Paste the complete generated text first.");
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
    if (!output) return;

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
    setAnnouncement("Message entered. Choose how the visible text should look.");
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
    ? ["Message", "Disguise", "Share"]
    : ["Paste", "Unlock", "Read"];

  return (
    <main className="app-shell">
      <h1 className="sr-only">plaintext.fun — hide a message inside ordinary-looking text or reveal one</h1>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>

      <div className="terminal-device">
        <div className="terminal-screen">
          <header className="app-nav">
            <Link className="brand" href="/" aria-label="plaintext.fun home">plaintext.fun</Link>

            <div className="device-readout" aria-label="Current status">
              <span>{mode.toUpperCase()}</span>
              <span>{String(currentStep).padStart(2, "0")}/03</span>
              <span>{getEngineLabel(modelState)}</span>
            </div>

            <Link className="learn-link" href="/learn">Help</Link>
          </header>

          <section className="editorial-flow" aria-label="Hide or reveal a hidden message" aria-busy={busy}>
            {(modelState === "loading" || modelState === "generating") && (
              <div
                className="progress-track"
                role="progressbar"
                aria-label="Preparing visible text"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressValue > 0 ? progressValue : undefined}
                aria-valuetext="Preparing visible text"
              >
                <span style={{ width: `${progressValue || 8}%` }} />
              </div>
            )}

            <div className="flow-head">
              <div className="mode-switch" role="group" aria-label="Choose what you want to do">
                <button className={mode === "hide" ? "active" : ""} onClick={() => switchMode("hide")} type="button" aria-pressed={mode === "hide"}>Hide</button>
                <button className={mode === "reveal" ? "active" : ""} onClick={() => switchMode("reveal")} type="button" aria-pressed={mode === "reveal"}>Reveal</button>
              </div>

              <ol className="stepper" aria-label={`${mode} progress`}>
                {stepLabels.map((label, index) => {
                  const step = (index + 1) as Step;
                  const state = step < currentStep ? "done" : step === currentStep ? "current" : "upcoming";
                  return (
                    <li key={label} className={state} aria-current={state === "current" ? "step" : undefined}>
                      <span className="step-number">0{step}</span>
                      <span>{label}</span>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="flow-stage">
              {mode === "hide" && hideStep === 1 && (
                <section className="editorial-step" aria-labelledby="hide-step-one-title">
                  <div className="step-heading">
                    <p className="step-kicker">Step 01 of 03</p>
                    <h2 id="hide-step-one-title">What do you want to hide?</h2>
                    <p className="step-intro">Write the message exactly as you want it to be recovered later. It stays in your browser.</p>
                  </div>

                  <form className="step-form" onSubmit={(event) => { event.preventDefault(); continueHide(); }}>
                    <label className="editor-field" htmlFor="secret-input">
                      <span className="editor-meta"><span>Message</span><span>{secret.length} characters</span></span>
                      <textarea
                        id="secret-input"
                        value={secret}
                        onChange={(event) => setSecret(event.target.value)}
                        placeholder="Meet me by the old cinema at 8."
                        spellCheck={false}
                        autoFocus
                      />
                    </label>

                    {notice && <div className="notice" role="alert">{notice}</div>}

                    <div className="form-actions">
                      <button className="primary-action" type="submit" disabled={!secret.trim()}>Continue</button>
                    </div>
                  </form>
                </section>
              )}

              {mode === "hide" && hideStep === 2 && (
                <section className="editorial-step" aria-labelledby="hide-step-two-title">
                  <div className="step-heading">
                    <p className="step-kicker">Step 02 of 03</p>
                    <h2 id="hide-step-two-title">Choose the disguise.</h2>
                    <p className="step-intro">Select the tone of the visible text. Add a password if the hidden message should also be encrypted.</p>
                  </div>

                  <form className="step-form" onSubmit={(event) => { event.preventDefault(); void handleHide(); }}>
                    <fieldset className="choice-fieldset">
                      <legend>Visible text style</legend>
                      <div className="choice-list">
                        {COVER_STYLES.map((style) => (
                          <button
                            className={coverStyle === style.value ? "choice active" : "choice"}
                            key={style.value}
                            type="button"
                            onClick={() => setCoverStyle(style.value)}
                            aria-pressed={coverStyle === style.value}
                          >
                            <span className="choice-name">{style.label}</span>
                            <span className="choice-hint">{style.hint}</span>
                            <span className="choice-state" aria-hidden="true">{coverStyle === style.value ? "ON" : ""}</span>
                          </button>
                        ))}
                      </div>
                    </fieldset>

                    <label className="password-field">
                      <span className="password-topline"><span>Password</span><em>Optional</em></span>
                      <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Leave blank to hide without encryption"
                        autoComplete="new-password"
                      />
                      <small>{password ? "Your message will be encrypted before it is hidden." : "Without a password, the message is hidden but not encrypted."}</small>
                    </label>

                    {notice && <div className="notice" role="alert">{notice}</div>}

                    <div className="form-actions split-actions">
                      <button className="text-action" type="button" onClick={() => { setNotice(""); setHideStep(1); }}>Back</button>
                      <button className="primary-action" type="submit" disabled={busy}>{busy ? "Preparing text…" : "Hide message"}</button>
                    </div>
                  </form>
                </section>
              )}

              {mode === "hide" && hideStep === 3 && (
                <section className="editorial-step result-step" aria-labelledby="hide-step-three-title">
                  <div className="step-heading">
                    <p className="step-kicker">Step 03 of 03</p>
                    <h2 id="hide-step-three-title">Ready to share.</h2>
                    <p className="step-intro">Your message is hidden inside the text below. Copy it exactly as it appears.</p>
                  </div>

                  <div className="result-box">
                    <div className="result-meta"><span>Generated text</span><span>Ready</span></div>
                    <div className="output-copy">{output}</div>
                  </div>

                  {notice && <div className="notice" role="alert">{notice}</div>}

                  <div className="result-actions">
                    <button className="primary-action" type="button" onClick={copyOutput}>{copied ? "Copied" : "Copy text"}</button>
                    <button className="secondary-action" type="button" onClick={() => void handleHide()} disabled={busy}>{busy ? "Preparing…" : "Generate another"}</button>
                    <button className="text-action" type="button" onClick={() => { setNotice(""); setHideStep(2); }}>Edit settings</button>
                    <button className="text-action" type="button" onClick={resetHide}>New message</button>
                  </div>

                  <p className="result-note">Editing, translating or reformatting this text can damage the hidden data.</p>
                </section>
              )}

              {mode === "reveal" && revealStep === 1 && (
                <section className="editorial-step" aria-labelledby="reveal-step-one-title">
                  <div className="step-heading">
                    <p className="step-kicker">Step 01 of 03</p>
                    <h2 id="reveal-step-one-title">Paste the text.</h2>
                    <p className="step-intro">Paste the complete text you received. plaintext will check it for a hidden message without changing it.</p>
                  </div>

                  <form className="step-form" onSubmit={(event) => { event.preventDefault(); void handleReveal(); }}>
                    <label className="editor-field" htmlFor="reveal-input">
                      <span className="editor-meta"><span>Text to inspect</span><span className={revealHiddenCount > 0 ? "detected" : ""}>{revealInputStatus}</span></span>
                      <textarea
                        id="reveal-input"
                        value={revealInput}
                        onChange={(event) => setRevealInput(event.target.value)}
                        placeholder="Paste the complete generated text here."
                        spellCheck={false}
                        autoFocus
                      />
                    </label>

                    {notice && <div className="notice" role="alert">{notice}</div>}

                    <div className="form-actions">
                      <button className="primary-action" type="submit" disabled={busy || !revealInput.trim()}>{busy ? "Checking…" : "Reveal message"}</button>
                    </div>
                  </form>
                </section>
              )}

              {mode === "reveal" && revealStep === 2 && (
                <section className="editorial-step compact-step" aria-labelledby="reveal-step-two-title">
                  <div className="step-heading">
                    <p className="step-kicker">Step 02 of 03</p>
                    <h2 id="reveal-step-two-title">Enter the password.</h2>
                    <p className="step-intro">This hidden message is encrypted. Use the same password that was used when it was created.</p>
                  </div>

                  <form className="step-form" onSubmit={(event) => { event.preventDefault(); void handleReveal(); }}>
                    <label className="password-field password-focus">
                      <span className="password-topline"><span>Password</span><em>Required</em></span>
                      <input
                        type="password"
                        value={revealPassword}
                        onChange={(event) => setRevealPassword(event.target.value)}
                        placeholder="Enter password"
                        autoComplete="current-password"
                        autoFocus={needsPassword}
                      />
                    </label>

                    {notice && <div className="notice" role="alert">{notice}</div>}

                    <div className="form-actions split-actions">
                      <button className="text-action" type="button" onClick={() => { setNotice(""); setRevealStep(1); }}>Back</button>
                      <button className="primary-action" type="submit" disabled={busy || !revealPassword}>{busy ? "Unlocking…" : "Unlock message"}</button>
                    </div>
                  </form>
                </section>
              )}

              {mode === "reveal" && revealStep === 3 && (
                <section className="editorial-step result-step" aria-labelledby="reveal-step-three-title">
                  <div className="step-heading">
                    <p className="step-kicker">Step 03 of 03</p>
                    <h2 id="reveal-step-three-title">Message revealed.</h2>
                    <p className="step-intro">The hidden message was recovered from the text you pasted.</p>
                  </div>

                  <div className="result-box secret-box">
                    <div className="result-meta"><span>Hidden message</span><span>Revealed</span></div>
                    <div className="secret-result">{revealedSecret}</div>
                  </div>

                  <div className="result-actions single-action">
                    <button className="primary-action" type="button" onClick={resetReveal}>Check another</button>
                  </div>
                </section>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
