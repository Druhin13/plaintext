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

const topics = [
  "a small change of plans",
  "something ordinary that happened while commuting",
  "food or a meal",
  "a mundane household task",
  "the weather affecting an everyday plan",
  "a shop, café, or supermarket",
  "a package or delivery",
  "an ordinary workday detail",
  "a weekend plan",
  "a minor scheduling update",
  "something seen while walking outside",
  "a book, show, song, or podcast",
  "a room, desk, kitchen, or other everyday space",
  "a casual purchase",
  "a simple errand",
  "an everyday interaction with a friend or colleague",
  "traffic, a train, a bus, or getting somewhere",
  "a normal morning or evening routine",
];

const intents = [
  "Share a passing observation.",
  "Give a casual update without asking for anything.",
  "Mention a tiny anecdote from the day.",
  "Make an offhand conversational remark.",
  "Mention a practical detail someone might naturally text.",
  "Share a mildly amusing everyday moment.",
  "Mention a plan in a relaxed way.",
  "Make a low-stakes comment that invites no explanation.",
];

const structures = [
  "Use a natural contraction somewhere if it fits.",
  "Do not begin the sentence with 'I'.",
  "Begin with a time or place phrase rather than a greeting.",
  "Use a simple conversational sentence with no greeting.",
  "Make the sentence sound spontaneous rather than polished.",
  "Include one concrete mundane detail such as an object, place, time, or food.",
  "Use an understated tone and avoid dramatic adjectives.",
  "Vary the sentence rhythm and opening from typical assistant-generated prose.",
];

const perspectives = [
  "first-person casual message",
  "neutral everyday observation",
  "message to a friend",
  "message to a colleague",
  "small personal update",
  "brief conversational aside",
];

function randomIndex(length: number) {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] % length;
}

function pick<T>(items: readonly T[]) {
  return items[randomIndex(items.length)];
}

export function createFallbackCover() {
  return `${pick(starts)} ${pick(middles)} ${pick(endings)}`;
}

export function buildCoverPrompt(style: CoverStyle) {
  const styleInstruction =
    style === "auto"
      ? "Use a natural everyday tone that matches the scene."
      : style === "random"
        ? "Use an unpredictable but believable everyday tone."
        : `Use a ${style} tone.`;

  const targetWords = 14 + randomIndex(17);
  const topic = pick(topics);
  const intent = pick(intents);
  const structure = pick(structures);
  const perspective = pick(perspectives);

  return [
    "Write exactly one fresh, ordinary, believable English sentence that could plausibly appear in a real text message or casual conversation.",
    styleInstruction,
    `Scene: ${topic}.`,
    `Perspective: ${perspective}.`,
    intent,
    structure,
    `Aim for about ${targetWords} words, while staying between 12 and 32 words.`,
    "Invent the wording from scratch. Do not fall back to stock phrases or repeatedly use openings such as 'Hey, just wanted to', 'I noticed', 'I ended up', or 'For some reason'.",
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
