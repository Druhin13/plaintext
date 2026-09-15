export type CoverStyle = "auto" | "casual" | "work" | "friendly" | "story" | "random";

const starts = [
  "I ended up",
  "I noticed",
  "I somehow",
  "I was thinking",
  "Apparently",
  "It turns out",
  "For some reason",
  "I completely forgot that",
];

const middles = [
  "taking the longer way home",
  "buying more coffee than I needed",
  "leaving the window open all afternoon",
  "finding a really good bakery near the station",
  "spending way too long reorganising my desk",
  "watching the rain from the kitchen",
  "walking past the same little shop twice",
  "making dinner much later than usual",
];

const endings = [
  "and it was actually kind of nice.",
  "which probably says a lot about my day.",
  "so I guess that worked out.",
  "and I am still not sure why.",
  "but I am not complaining.",
  "which felt oddly peaceful.",
  "and now I cannot stop thinking about it.",
  "so that was basically my afternoon.",
];

function pick<T>(items: readonly T[]) {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return items[value[0] % items.length];
}

export function createFallbackCover() {
  return `${pick(starts)} ${pick(middles)} ${pick(endings)}`;
}

export function buildCoverPrompt(style: CoverStyle) {
  const styleInstruction =
    style === "auto"
      ? "Choose a natural everyday tone at random."
      : style === "random"
        ? "Choose an unpredictable but believable everyday context and tone."
        : `Use a ${style} tone.`;

  return [
    "Write exactly one ordinary, believable English sentence that could plausibly appear in a real text message or casual conversation.",
    styleInstruction,
    "Keep it between 14 and 30 words.",
    "Do not mention secrets, encryption, passwords, hidden messages, codes, AI, technology, steganography, or anything suspicious.",
    "Avoid quotes, labels, explanations, markdown, or multiple sentences.",
    "Return only the sentence.",
  ].join(" ");
}

export function cleanGeneratedCover(value: string) {
  return value
    .replace(/^.*?assistant\s*[:\n]/i, "")
    .replace(/^[-*\s]+/, "")
    .replace(/^['\"]|['\"]$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)[0]
    .trim();
}
