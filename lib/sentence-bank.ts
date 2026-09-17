import sentenceBank from "@/data/cover-sentences.json";

type SentenceLength = "short" | "medium" | "long";

const LENGTHS: readonly SentenceLength[] = ["short", "medium", "long"];
const RECENT_LIMIT = 12;
const recentSentences: string[] = [];

function randomIndex(length: number) {
  if (length <= 1) return 0;

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] % length;
  }

  return Math.floor(Math.random() * length);
}

function remember(sentence: string) {
  recentSentences.push(sentence);
  if (recentSentences.length > RECENT_LIMIT) {
    recentSentences.splice(0, recentSentences.length - RECENT_LIMIT);
  }
}

export function getAutomaticCover() {
  const length = LENGTHS[randomIndex(LENGTHS.length)];
  const bucket = sentenceBank.en[length];
  const available = bucket.filter((sentence) => !recentSentences.includes(sentence));
  const candidates = available.length > 0 ? available : bucket;
  const sentence = candidates[randomIndex(candidates.length)];

  remember(sentence);
  return sentence;
}

export const AUTOMATIC_COVER_COUNT =
  sentenceBank.en.short.length +
  sentenceBank.en.medium.length +
  sentenceBank.en.long.length;
