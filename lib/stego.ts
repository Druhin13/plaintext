const CURRENT_ALPHABET = ["\u2061", "\u2062", "\u2063", "\u2064"] as const;
const PREVIOUS_ALPHABET = ["\u200D", "\u200C", "\u2060", "\u2063"] as const;
const LEGACY_ALPHABET = ["\u200B", "\u200C", "\u2060", "\u2063"] as const;
const PACKET_MAGIC = new Uint8Array([80, 76, 84, 88]);

const ALPHABETS = [CURRENT_ALPHABET, PREVIOUS_ALPHABET, LEGACY_ALPHABET] as const;

function alphabetSet(alphabet: readonly string[]) {
  return new Set<string>(alphabet);
}

function symbolsForAlphabet(text: string, alphabet: readonly string[]) {
  const set = alphabetSet(alphabet);
  return Array.from(text).filter((character) => set.has(character));
}

function startsWithPacketMagic(bytes: Uint8Array) {
  if (bytes.length < PACKET_MAGIC.length) {
    return false;
  }

  for (let index = 0; index < PACKET_MAGIC.length; index += 1) {
    if (bytes[index] !== PACKET_MAGIC[index]) {
      return false;
    }
  }

  return true;
}

function decodeWithAlphabet(text: string, alphabet: readonly string[]) {
  const symbols = symbolsForAlphabet(text, alphabet);
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

function detectPayloadAlphabet(text: string) {
  for (const alphabet of ALPHABETS) {
    try {
      const bytes = decodeWithAlphabet(text, alphabet);
      if (startsWithPacketMagic(bytes)) {
        return alphabet;
      }
    } catch {
      // Try the next historical alphabet.
    }
  }

  return null;
}

export function stripInvisiblePayload(text: string) {
  const detected = detectPayloadAlphabet(text);
  if (!detected) {
    return text;
  }

  const set = alphabetSet(detected);
  return Array.from(text)
    .filter((character) => !set.has(character))
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

export function invisibleToBytes(text: string) {
  const detected = detectPayloadAlphabet(text);
  if (detected) {
    return decodeWithAlphabet(text, detected);
  }

  const characters = Array.from(text);
  const hasCurrentSymbols = characters.some((character) => CURRENT_ALPHABET.includes(character as (typeof CURRENT_ALPHABET)[number]));
  const hasPreviousMarker = characters.includes(PREVIOUS_ALPHABET[0]);
  const hasLegacyMarker = characters.includes(LEGACY_ALPHABET[0]);

  if (hasCurrentSymbols) {
    return decodeWithAlphabet(text, CURRENT_ALPHABET);
  }

  if (hasLegacyMarker && !hasPreviousMarker) {
    return decodeWithAlphabet(text, LEGACY_ALPHABET);
  }

  if (hasPreviousMarker) {
    return decodeWithAlphabet(text, PREVIOUS_ALPHABET);
  }

  throw new Error("No hidden message found.");
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
  const detected = detectPayloadAlphabet(text);
  if (!detected) {
    return 0;
  }
  return symbolsForAlphabet(text, detected).length;
}
