import Link from "next/link";

export default function LearnPage() {
  return (
    <main className="learn-shell">
      <header className="learn-header">
        <Link className="brand" href="/" aria-label="Back to plaintext">
          <span className="brand-prompt">$</span>
          <span>plaintext</span>
          <span className="brand-cursor">_</span>
        </Link>
        <Link className="back-link" href="/">← back to terminal</Link>
      </header>

      <div className="learn-main">
        <p className="learn-kicker">./learn</p>
        <h1>Ordinary text on the outside. Extra data underneath.</h1>
        <p className="learn-lead">
          plaintext is an experimental browser tool for encoding data inside ordinary-looking text while keeping the main interaction simple and local-first.
        </p>

        <div className="learn-grid">
          <section className="learn-block">
            <h2>hide</h2>
            <div>
              <p>A local language model creates unrelated cover text, then plaintext encodes the input into invisible Unicode carried by that text.</p>
              <pre className="learn-code">input → packet → invisible symbols → cover text</pre>
            </div>
          </section>

          <section className="learn-block">
            <h2>reveal</h2>
            <div>
              <p>Paste the untouched carrier text back into the terminal and plaintext reconstructs the original packet.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>password</h2>
            <div>
              <p>When a password is supplied, the packet is protected with PBKDF2-derived AES-256-GCM before encoding. Without a password, the data is encoded but not encrypted.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>local</h2>
            <div>
              <p>Encoding, decoding, encryption, and cover generation run in the browser. The language model receives only instructions for unrelated cover text, not the input being encoded.</p>
            </div>
          </section>

          <section className="learn-block">
            <h2>limits</h2>
            <div>
              <ul>
                <li>Some apps may strip or normalize invisible Unicode.</li>
                <li>Editing carrier text can damage the encoded packet.</li>
                <li>WebGPU gives the best local-model experience; unsupported browsers use a fallback cover.</li>
                <li>The project is experimental and designed for learning and exploration.</li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
