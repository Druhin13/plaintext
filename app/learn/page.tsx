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
          plaintext.fun turns your message into invisible Unicode characters and places them inside normal-looking visible text. Paste that text back into plaintext.fun to recover the hidden message.
        </p>

        <div className="learn-grid">
          <section className="learn-block">
            <h2>The flow</h2>
            <div>
              <p>The visible text and the hidden message are separate. plaintext.fun can choose an English cover sentence automatically, or you can write the visible text yourself. The hidden data is inserted afterwards.</p>
              <pre className="learn-code">message → optional encryption → invisible Unicode → visible text</pre>
            </div>
          </section>

          <section className="learn-block">
            <h2>Hide</h2>
            <div>
              <p>Enter the message you want to hide. Leave the visible text on <strong>Automatic</strong> to use a local English sentence, or choose <strong>My own text</strong> and write exactly what people should see. Then select <strong>Hide message</strong> and copy the result unchanged.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>Automatic text</h2>
            <div>
              <p>Automatic mode uses a small built-in bank of curated English sentences in different lengths. A sentence is selected locally in your browser, so there is no AI model to download and no generation request to wait for.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>Reveal</h2>
            <div>
              <p>Paste the complete visible text without editing it, then select <strong>Reveal</strong>. plaintext.fun reads the invisible characters and reconstructs the original hidden message.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>Password</h2>
            <div>
              <p>A password is optional. If you add one, plaintext.fun derives an encryption key with PBKDF2 and encrypts your message with AES-256-GCM before hiding it.</p>
              <p className="learn-note">Without a password, the message is hidden but not encrypted. Someone who has the visible text and knows how this encoding works can reveal it.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>Privacy</h2>
            <div>
              <p>Your message and password are processed in your browser. Automatic cover text is selected from the local sentence bank, and your hidden message is inserted only afterwards.</p>
              <p>There is no model inference or application backend involved in creating the cover text.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>Limits</h2>
            <div>
              <ul>
                <li>Keep the final visible text unchanged. Editing, retyping, translating or reformatting it can damage the hidden data.</li>
                <li>Some apps and services may remove or normalize invisible Unicode characters. If that happens, the hidden message may not survive.</li>
                <li>If you use a password, the recipient needs the same password to reveal the message.</li>
                <li>If confidentiality matters, use a password. Hiding a message is not the same as encrypting it.</li>
              </ul>
            </div>
          </section>
        </div>
      </article>
    </main>
  );
}
