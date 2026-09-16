import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How plaintext works",
  description: "How plaintext hides a message inside ordinary-looking text, what the optional password does, and what stays in your browser.",
};

export default function LearnPage() {
  return (
    <main className="learn-shell">
      <header className="learn-header">
        <Link className="brand" href="/" aria-label="Back to plaintext">
          <span className="brand-prompt" aria-hidden="true">$</span>
          <span>plaintext</span>
          <span className="brand-cursor" aria-hidden="true">_</span>
        </Link>
        <Link className="back-link" href="/">← back to tool</Link>
      </header>

      <div className="learn-main">
        <p className="learn-kicker">./how-it-works</p>
        <h1>Hide a message inside ordinary-looking text.</h1>
        <p className="learn-lead">
          plaintext turns your message into invisible Unicode characters and places them inside normal-looking generated text. Paste that generated text back into plaintext to recover the hidden message.
        </p>

        <div className="learn-grid">
          <section className="learn-block">
            <h2>the flow</h2>
            <div>
              <p>The visible text and the hidden message are separate. The local AI writes the visible text; plaintext inserts the hidden data afterwards.</p>
              <pre className="learn-code">message → optional encryption → invisible Unicode → generated text</pre>
            </div>
          </section>

          <section className="learn-block">
            <h2>hide</h2>
            <div>
              <p>Enter the message you want to hide, choose the style of the visible text, then select <strong>Hide message</strong>. Copy the generated text exactly as it appears.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>reveal</h2>
            <div>
              <p>Paste the full generated text without editing it, then select <strong>Reveal hidden message</strong>. plaintext reads the invisible characters and reconstructs the original message.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>password</h2>
            <div>
              <p>A password is optional. If you add one, plaintext derives an encryption key with PBKDF2 and encrypts your message with AES-256-GCM before hiding it.</p>
              <p className="learn-note">Without a password, the message is hidden but not encrypted. Someone who has the generated text and knows how this encoding works can reveal it.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>privacy</h2>
            <div>
              <p>Your message and password are processed in your browser. The language model runs in the browser and is only asked to generate unrelated visible text; your hidden message is not included in its prompt.</p>
              <p>Model files are downloaded to your browser when needed, so “local” refers to where the sensitive processing happens, not to the site working without an internet connection.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>limits</h2>
            <div>
              <ul>
                <li>Keep the generated text unchanged. Editing, retyping, translating, or reformatting it can damage the hidden data.</li>
                <li>Some apps and services may remove or normalize invisible Unicode characters. If that happens, the hidden message may not survive.</li>
                <li>If you use a password, the recipient needs the same password to reveal the message.</li>
                <li>If confidentiality matters, use a password. Hiding a message is not the same as encrypting it.</li>
                <li>WebGPU is used for the local AI when available. If it is unavailable, plaintext uses built-in fallback text and the hide/reveal process still works.</li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
