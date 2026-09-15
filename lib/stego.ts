const ALPHABET = ["\u200B", "\u200C", "\u2060", "\u2063"] as const;
const ALPHABET_SET = new Set<string>(ALPHABET);

export function stripInvisiblePayload(text: string) {
  return Array.from(text)
    .filter((character) => !ALPHABET_SET.has(character))
    .join("");
}

export function bytesToInvisible(bytes: Uint8Array) {
  let output = "";
  for (const byte of bytes) {
    output += ALPHABET[(byte >> 6) & 3];
    output += ALPHABET[(byte >> 4) & 3];
    output += ALPHABET[(byte >> 2) & 3];
    output += ALPHABET[byte & 3];
  }
  return output;
}

export function invisibleToBytes(text: string) {
  const symbols = Array.from(text).filter((character) => ALPHABET_SET.has(character));
  if (symbols.length < 4) {
    throw new Error("No hidden message found.");
  }

  const completeLength = symbols.length - (symbols.length % 4);
  const bytes = new Uint8Array(completeLength / 4);
  const lookup = new Map<string, number>();

  ALPHABET.forEach((character, index) => {
    lookup.set(character, index);
  });

  for (let index = 0; index < completeLength; index += 4) {
    bytes[index / 4] =
      (lookup.get(symbols[index])! << 6) |
      (lookup.get(symbols[index + 1])! << 4) |
      (lookup.get(symbols[index + 2])! << 2) |
      lookup.get(symbols[index + 3])!;
  }

  return bytes;
}

function randomInt(min: number, max: number) {
  const range = max - min + 1;
  const maxUint = 0xffffffff;
  const limit = maxUint - (maxUint % range);
  const value = new Uint32Array(1);
  do {
    crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return min + (value[0] % range);
}

export function embedInvisiblePayload(coverText: string, payload: string) {
  const cleanCover = stripInvisiblePayload(coverText).trim();
  if (!cleanCover) {
    throw new Error("A cover sentence is required.");
  }

  const characters = Array.from(cleanCover);
  const boundaries = Math.max(1, characters.length - 1);
  const chunks: string[] = [];
  let cursor = 0;
  let remainingBoundaries = boundaries;

  while (cursor < payload.length) {
    const remaining = payload.length - cursor;
    const target = Math.max(1, Math.ceil(remaining / Math.max(1, remainingBoundaries)));
    const jitter = randomInt(-1, 1);
    const size = Math.max(1, Math.min(remaining, target + jitter));
    chunks.push(payload.slice(cursor, cursor + size));
    cursor += size;
    remainingBoundaries -= 1;
  }

  const slots = new Array(boundaries).fill("");
  const step = boundaries / chunks.length;

  chunks.forEach((chunk, index) => {
    const base = Math.min(boundaries - 1, Math.floor(index * step));
    const room = Math.max(0, Math.floor(step) - 1);
    const offset = room > 0 ? randomInt(0, room) : 0;
    const slot = Math.min(boundaries - 1, base + offset);
    slots[slot] += chunk;
  });

  let output = "";
  for (let index = 0; index < characters.length; index += 1) {
    output += characters[index];
    if (index < slots.length) {
      output += slots[index];
    }
  }

  return output;
}

export function countHiddenCharacters(text: string) {
  return Array.from(text).filter((character) => ALPHABET_SET.has(character)).length;
}
