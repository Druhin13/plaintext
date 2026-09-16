import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How plaintext.fun works",
  description: "How plaintext.fun hides a message inside ordinary-looking text, what the optional password does, and what stays in your browser.",
};

export default function LearnPage() {
  return (
    <main className="learn-shell">
      <header className="learn-header">
        <Link className="brand" href="/" aria-label="Back to plaintext.fun">plaintext.fun</Link>
        <Link className="back-link" href="/">Back to tool</Link>
      </header>

      <article className="learn-main">
        <p className="learn-kicker">How it works</p>
        <h1>Hide a message inside ordinary-looking text.</h1>
        <p className="learn-lead">
          plaintext.fun turns your message into invisible Unicode characters and places them inside normal-looking generated text. Paste that text back into plaintext.fun to recover the hidden message.
        </p>

        <div className="learn-grid">
          <section className="learn-block">
            <h2>The flow</h2>
            <div>
              <p>The visible text and the hidden message are separate. The visible sentence is generated first. plaintext.fun inserts the hidden data afterwards.</p>
              <pre className="learn-code">message → optional encryption → invisible Unicode → generated text</pre>
            </div>
          </section>

          <section className="learn-block">
            <h2>Hide</h2>
            <div>
              <p>Enter the message you want to hide, choose the style of the visible text, then select <strong>Hide message</strong>. Copy the generated text exactly as it appears.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>Reveal</h2>
            <div>
              <p>Paste the complete generated text without editing it, then select <strong>Reveal message</strong>. plaintext.fun reads the invisible characters and reconstructs the original message.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>Password</h2>
            <div>
              <p>A password is optional. If you add one, plaintext.fun derives an encryption key with PBKDF2 and encrypts your message with AES-256-GCM before hiding it.</p>
              <p className="learn-note">Without a password, the message is hidden but not encrypted. Someone who has the generated text and knows how this encoding works can reveal it.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>Privacy</h2>
            <div>
              <p>Your message and password are processed in your browser. The hidden message is inserted only after the visible text has been created.</p>
              <p>The text generator is downloaded to your browser when needed. Your message is not sent away to create the visible sentence.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>Limits</h2>
            <div>
              <ul>
                <li>Keep the generated text unchanged. Editing, retyping, translating or reformatting it can damage the hidden data.</li>
                <li>Some apps and services may remove or normalize invisible Unicode characters. If that happens, the hidden message may not survive.</li>
                <li>If you use a password, the recipient needs the same password to reveal the message.</li>
                <li>If confidentiality matters, use a password. Hiding a message is not the same as encrypting it.</li>
                <li>If browser-based text generation is unavailable, plaintext.fun uses built-in fallback text and the hide and reveal process still works.</li>
              </ul>
            </div>
          </section>
        </div>
      </article>
    </main>
  );
}
