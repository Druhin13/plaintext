# plaintext

Hide a secret inside ordinary-looking text.

`plaintext` is a lightweight browser-only steganography app. It uses ordinary English cover sentences, encodes the secret as invisible Unicode, and can optionally encrypt the secret before embedding it.

## What it does

- Chooses cover text instantly from a small local English sentence bank
- Lets the user provide their own visible text instead
- Encodes payload bytes with an invisible four-symbol Unicode alphabet
- Spreads the invisible payload through the visible cover text
- Supports optional password encryption with `AES-256-GCM`
- Derives password keys with `PBKDF2-SHA-256`
- Uses a random salt and IV for every encrypted message
- Detects versioned `plaintext` packets when revealing
- Sends no secret, password, ciphertext, or cover sentence to an application backend

## Stack

- Next.js 16
- React 19
- TypeScript
- Web Crypto API
- Local JSON sentence bank

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

The cover text and hidden payload are deliberately separate.

```text
secret
  ├─ optional password encryption
  │    └─ PBKDF2 → AES-256-GCM
  └─ versioned binary packet
         └─ invisible Unicode encoder
                └─ embedded into visible cover text

local English sentence bank
  └─ random sentence selection
         └─ visible cover text only
```

Automatic mode never generates text with a model. It selects one curated sentence locally and immediately. The hidden message is embedded only after the cover text has been chosen.

## Privacy model

Application logic is client-side. The current app has no API route, database, analytics integration, user account system, model inference, or server-side secret processing.

## Important limitation

Invisible Unicode is not a universally reliable transport. Some apps, editors, sanitizers, or normalization pipelines may remove or alter invisible characters. Treat this as an experimental steganography tool, not a guaranteed secure messaging transport.

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

## Automatic sentence bank

`data/cover-sentences.json` currently contains 108 curated English sentences:

- 36 short
- 36 medium
- 36 long

The picker varies sentence length and avoids recently used sentences so repeated clicks are less likely to return the same text.

## Status

Early v1. The core hide/reveal flow, optional password encryption, local sentence selection, custom visible text, and lightweight UI are implemented.
