const CURRENT_ALPHABET = ["\u200D", "\u200C", "\u2060", "\u2063"] as const;
const LEGACY_ALPHABET = ["\u200B", "\u200C", "\u2060", "\u2063"] as const;
const ALL_ALPHABET_SET = new Set<string>([...CURRENT_ALPHABET, ...LEGACY_ALPHABET]);

export function stripInvisiblePayload(text: string) {
  return Array.from(text)
    .filter((character) => !ALL_ALPHABET_SET.has(character))
    .join("");
}

export function bytesToInvisible(bytes: Uint8Array) {
  let output = "";
  for (const byte of bytes) {
    output += CURRENT_ALPHABET[(byte >> 6) & 3];
    output += CURRENT_ALPHABET[(byte >> 4) & 3];
    output += CURRENT_ALPHABET[(byte >> 2) & 3];
    output += CURRENT_ALPHABET[byte & 3];
  }
  return output;
}

function decodeWithAlphabet(text: string, alphabet: readonly string[]) {
  const alphabetSet = new Set<string>(alphabet);
  const symbols = Array.from(text).filter((character) => alphabetSet.has(character));
  if (symbols.length < 4) {
    throw new Error("No hidden message found.");
  }

  const completeLength = symbols.length - (symbols.length % 4);
  const bytes = new Uint8Array(completeLength / 4);
  const lookup = new Map<string, number>();

  alphabet.forEach((character, index) => {
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

export function invisibleToBytes(text: string) {
  const characters = Array.from(text);
  const hasCurrentMarker = characters.includes(CURRENT_ALPHABET[0]);
  const hasLegacyMarker = characters.includes(LEGACY_ALPHABET[0]);

  if (hasLegacyMarker && !hasCurrentMarker) {
    return decodeWithAlphabet(text, LEGACY_ALPHABET);
  }

  return decodeWithAlphabet(text, CURRENT_ALPHABET);
}

export function embedInvisiblePayload(coverText: string, payload: string) {
  const cleanCover = stripInvisiblePayload(coverText).trim();
  if (!cleanCover) {
    throw new Error("A cover sentence is required.");
  }

  if (!payload) {
    return cleanCover;
  }

  const characters = Array.from(cleanCover);
  const safeSlots = characters
    .map((character, index) => (/\s/u.test(character) ? index : -1))
    .filter((index) => index >= 0);

  if (safeSlots.length === 0) {
    return `${cleanCover}${payload}`;
  }

  const chunkCount = Math.min(safeSlots.length, payload.length);
  const selectedSlots = Array.from({ length: chunkCount }, (_, index) => {
    const position = Math.floor(((index + 1) * safeSlots.length) / (chunkCount + 1));
    return safeSlots[Math.min(safeSlots.length - 1, position)];
  });

  const chunks = new Map<number, string>();
  let cursor = 0;

  for (let index = 0; index < selectedSlots.length; index += 1) {
    const remaining = payload.length - cursor;
    const remainingChunks = selectedSlots.length - index;
    const size = Math.ceil(remaining / remainingChunks);
    const slot = selectedSlots[index];
    chunks.set(slot, (chunks.get(slot) ?? "") + payload.slice(cursor, cursor + size));
    cursor += size;
  }

  let output = "";
  for (let index = 0; index < characters.length; index += 1) {
    const hiddenChunk = chunks.get(index);
    if (hiddenChunk) {
      output += hiddenChunk;
    }
    output += characters[index];
  }

  return output;
}

export function countHiddenCharacters(text: string) {
  return Array.from(text).filter((character) => ALL_ALPHABET_SET.has(character)).length;
}
