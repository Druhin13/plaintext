# plaintext

Hide a secret inside ordinary-looking text.

`plaintext` is an experimental browser-only steganography app. It generates a natural English cover sentence locally, encodes the secret as invisible Unicode, and optionally encrypts the secret before embedding it.

## What it does

- Generates cover text locally in the browser with `LFM2.5-350M`
- Keeps the secret out of the model prompt
- Encodes payload bytes with an invisible four-symbol Unicode alphabet
- Spreads the invisible payload through the visible cover text
- Supports optional password encryption with `AES-256-GCM`
- Derives password keys with `PBKDF2-SHA-256`
- Uses a random salt and IV for every encrypted message
- Detects versioned `plaintext` packets when revealing
- Falls back to a local rule-based sentence generator if WebGPU/model inference is unavailable
- Sends no secret, password, ciphertext, or generated cover sentence to an application backend

## Stack

- Next.js 16
- React 19
- TypeScript
- Web Crypto API
- Transformers.js
- WebGPU
- `onnx-community/LFM2.5-350M-ONNX`

## Development

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

For validation:

```bash
npm run typecheck
npm run build
```

## Architecture

The cover generator and the hidden payload are deliberately separate.

```text
secret
  ├─ optional password encryption
  │    └─ PBKDF2 → AES-256-GCM
  └─ versioned binary packet
         └─ invisible Unicode encoder
                └─ embedded into cover sentence

random cover prompt
  └─ local browser LLM
         └─ visible cover sentence only
```

The LLM never sees the secret. Its only job is to produce plausible visible text.

## Privacy model

Application logic is client-side. The model files are downloaded from Hugging Face when local AI is first used and may be cached by the browser. The current app has no API route, database, analytics integration, user account system, or server-side secret processing.

## Important limitation

Invisible Unicode is not a universally reliable transport. Some apps, editors, sanitizers, or normalization pipelines may remove or alter zero-width characters. Treat this as an experimental/fun steganography tool, not a guaranteed secure messaging transport.

Password mode protects the hidden content cryptographically, but the presence of invisible Unicode can still be detected by someone inspecting the text's code points.

## Current packet format

Version `1` stores:

```text
magic        4 bytes
version      1 byte
flags        1 byte
salt length  1 byte
iv length    1 byte
payload len  4 bytes
salt         variable
iv           variable
payload      variable
```

The visible carrier sentence contains an encoded representation of that packet using four invisible Unicode symbols, providing two encoded bits per invisible character.

## Status

Early v1. The core hide/reveal flow, password encryption, local cover generation, fallback generation, and initial UI are implemented.
