const MAGIC = new Uint8Array([80, 76, 84, 88]);
const VERSION = 1;
const FLAG_ENCRYPTED = 1;
const HEADER_LENGTH = 12;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const PBKDF2_ITERATIONS = 250000;

export type ParsedPacket = {
  encrypted: boolean;
  salt: Uint8Array;
  iv: Uint8Array;
  payload: Uint8Array;
};

function concatBytes(...parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function writeUint32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function readUint32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

async function deriveKey(password: string, salt: Uint8Array) {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(password)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function createPacket(secret: string, password?: string) {
  const plaintext = new TextEncoder().encode(secret);
  const encrypted = Boolean(password?.length);
  let salt = new Uint8Array(0);
  let iv = new Uint8Array(0);
  let payload = plaintext;

  if (encrypted) {
    salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const key = await deriveKey(password!, salt);
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
      },
      key,
      toArrayBuffer(plaintext),
    );
    payload = new Uint8Array(ciphertext);
  }

  const header = concatBytes(
    MAGIC,
    new Uint8Array([
      VERSION,
      encrypted ? FLAG_ENCRYPTED : 0,
      salt.length,
      iv.length,
    ]),
    writeUint32(payload.length),
  );

  return concatBytes(header, salt, iv, payload);
}

export function parsePacket(bytes: Uint8Array): ParsedPacket {
  if (bytes.length < HEADER_LENGTH) {
    throw new Error("No hidden message found.");
  }

  for (let index = 0; index < MAGIC.length; index += 1) {
    if (bytes[index] !== MAGIC[index]) {
      throw new Error("No hidden message found.");
    }
  }

  const version = bytes[4];
  if (version !== VERSION) {
    throw new Error(`Unsupported plaintext message version: ${version}.`);
  }

  const flags = bytes[5];
  const saltLength = bytes[6];
  const ivLength = bytes[7];
  const payloadLength = readUint32(bytes, 8);
  const expectedLength = HEADER_LENGTH + saltLength + ivLength + payloadLength;

  if (bytes.length < expectedLength) {
    throw new Error("A hidden message was found, but it appears to be damaged.");
  }

  let offset = HEADER_LENGTH;
  const salt = bytes.slice(offset, offset + saltLength);
  offset += saltLength;
  const iv = bytes.slice(offset, offset + ivLength);
  offset += ivLength;
  const payload = bytes.slice(offset, offset + payloadLength);

  return {
    encrypted: Boolean(flags & FLAG_ENCRYPTED),
    salt,
    iv,
    payload,
  };
}

export async function revealPacket(packet: ParsedPacket, password?: string) {
  if (!packet.encrypted) {
    return new TextDecoder().decode(packet.payload);
  }

  if (!password) {
    throw new Error("PASSWORD_REQUIRED");
  }

  try {
    const key = await deriveKey(password, packet.salt);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(packet.iv),
      },
      key,
      toArrayBuffer(packet.payload),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("Incorrect password or damaged message.");
  }
}
