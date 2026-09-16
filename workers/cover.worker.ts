import { pipeline } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/LFM2.5-350M-ONNX";
const DEFAULT_CACHE_TARGET = 2;
const MAX_RECENT_COVERS = 80;
const MAX_GENERATION_ATTEMPTS = 4;
const MIN_ACCEPTABLE_QUALITY = 62;

const SYSTEM_PROMPT = [
  "You write realistic one-sentence English messages that could genuinely be sent by a person.",
  "Prefer ordinary phrasing, simple syntax, concrete details, and natural contractions.",
  "Do not sound like an assistant, storyteller, copywriter, or creative-writing exercise.",
  "Do not add commentary, labels, explanations, quotation marks, or multiple options.",
  "Return only the message.",
].join(" ");

const variationDirections = [
  "Keep the syntax simple and direct.",
  "Lead with the practical detail rather than background context.",
  "Use a contraction if one fits naturally.",
  "Write it like a message typed quickly on a phone.",
  "Keep the tone matter-of-fact and understated.",
  "Prefer concrete nouns and verbs over descriptive language.",
  "Let the sentence sound slightly imperfect rather than polished.",
  "Keep one clear point and avoid explaining why it matters.",
];

const unnaturalPhrases = [
  "for some reason",
  "it turns out",
  "i ended up",
  "i noticed",
  "i somehow",
  "i was thinking",
  "just wanted to",
  "oddly",
  "which felt",
  "kind of nice",
  "probably says a lot",
  "basically my",
  "so i guess",
  "and now i cannot stop",
  "could not help but",
  "little did i know",
];

const forbiddenContent = /\b(secret|secrets|hidden|hiding|hide|encryption|encrypted|encrypt|password|passwords|steganography|model|models|artificial intelligence|\bai\b)\b/i;
const assistantOpening = /^(sure|certainly|absolutely|of course|here(?:'s| is)|the sentence|message:|sentence:|output:)/i;

let generatorPromise: Promise<any> | null = null;
let hasTotalProgress = false;
let processingTasks = false;

const foregroundTasks: Array<() => Promise<void>> = [];
const backgroundTasks: Array<() => Promise<void>> = [];
const coverCache = new Map<string, string[]>();
const primingCounts = new Map<string, number>();
const recentCovers: string[] = [];

function post(type: string, payload: Record<string, unknown> = {}) {
  self.postMessage({ type, ...payload });
}

function randomIndex(length: number) {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] % length;
}

function pick<T>(items: readonly T[]) {
  return items[randomIndex(items.length)];
}

async function getGenerator() {
  if (!generatorPromise) {
    post("status", { status: "loading", message: "Preparing text engine…" });
    hasTotalProgress = false;
    generatorPromise = pipeline("text-generation", MODEL_ID, {
      device: "webgpu",
      dtype: "q4",
      progress_callback: (progress: any) => {
        if (progress?.status === "progress_total" && typeof progress?.progress === "number") {
          hasTotalProgress = true;
          post("progress", {
            progress: Math.max(0, Math.min(100, Math.round(progress.progress))),
          });
          return;
        }

        if (!hasTotalProgress && typeof progress?.progress === "number") {
          post("progress", {
            progress: Math.max(0, Math.min(100, Math.round(progress.progress))),
          });
        }
      },
    });
  }

  try {
    const generator = await generatorPromise;
    post("progress", { progress: 100 });
    post("status", { status: "ready", message: "Text engine ready" });
    return generator;
  } catch (error) {
    generatorPromise = null;
    throw error;
  }
}

function extractGeneratedText(result: any) {
  const first = Array.isArray(result) ? result[0] : result;
  const generated = first?.generated_text;

  if (typeof generated === "string") {
    return generated;
  }

  if (Array.isArray(generated)) {
    const assistant = [...generated].reverse().find((message) => message?.role === "assistant");
    if (typeof assistant?.content === "string") {
      return assistant.content;
    }
    const last = generated[generated.length - 1];
    if (typeof last?.content === "string") {
      return last.content;
    }
  }

  return "";
}

function cleanCandidate(value: string) {
  return value
    .replace(/<\|[^>]+\|>/g, " ")
    .replace(/^.*?assistant\s*[:\n]/i, "")
    .replace(/^[-*\s]+/, "")
    .replace(/^['\"]|['\"]$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)[0]
    .trim();
}

function normalizeCover(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: string) {
  return normalizeCover(value).split(" ").filter(Boolean);
}

function tokenSet(value: string) {
  return new Set(words(value));
}

function bigramSet(value: string) {
  const values = words(value);
  const bigrams = new Set<string>();
  for (let index = 0; index < values.length - 1; index += 1) {
    bigrams.add(`${values[index]} ${values[index + 1]}`);
  }
  return bigrams;
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function sentenceSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeCover(left);
  const normalizedRight = normalizeCover(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const wordSimilarity = jaccard(tokenSet(left), tokenSet(right));
  const bigramSimilarity = jaccard(bigramSet(left), bigramSet(right));
  const leftOpening = normalizedLeft.split(" ").slice(0, 4).join(" ");
  const rightOpening = normalizedRight.split(" ").slice(0, 4).join(" ");
  const openingPenalty = leftOpening.length > 0 && leftOpening === rightOpening ? 0.88 : 0;

  return Math.max(wordSimilarity * 0.55 + bigramSimilarity * 0.45, openingPenalty);
}

function maxRecentSimilarity(candidate: string) {
  let maximum = 0;
  for (const previous of recentCovers) {
    maximum = Math.max(maximum, sentenceSimilarity(candidate, previous));
  }
  return maximum;
}

function hasExactRecentMatch(candidate: string) {
  const normalized = normalizeCover(candidate);
  return recentCovers.some((previous) => normalizeCover(previous) === normalized);
}

function rememberCover(candidate: string) {
  if (!candidate || hasExactRecentMatch(candidate)) {
    return;
  }

  recentCovers.push(candidate);
  if (recentCovers.length > MAX_RECENT_COVERS) {
    recentCovers.splice(0, recentCovers.length - MAX_RECENT_COVERS);
  }
}

function hasRepeatedAdjacentWord(candidate: string) {
  const values = words(candidate);
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] === values[index - 1]) {
      return true;
    }
  }
  return false;
}

function naturalnessScore(candidate: string) {
  const normalized = normalizeCover(candidate);
  const wordCount = words(candidate).length;

  if (!candidate || wordCount < 7 || wordCount > 30) {
    return 0;
  }

  if (assistantOpening.test(candidate) || forbiddenContent.test(candidate)) {
    return 0;
  }

  if (/[*#{}\[\]<>`]/.test(candidate) || hasRepeatedAdjacentWord(candidate)) {
    return 0;
  }

  const sentenceEndings = candidate.match(/[.!?](?=\s|$)/g)?.length ?? 0;
  if (sentenceEndings > 1) {
    return 0;
  }

  let score = 100;

  if (wordCount < 9) score -= (9 - wordCount) * 4;
  if (wordCount > 22) score -= (wordCount - 22) * 3;

  for (const phrase of unnaturalPhrases) {
    if (normalized.includes(phrase)) {
      score -= 16;
    }
  }

  const commaCount = (candidate.match(/,/g) ?? []).length;
  if (commaCount > 2) score -= (commaCount - 2) * 7;

  if (/[;:]/.test(candidate)) score -= 8;
  if (/[—–]/.test(candidate)) score -= 10;
  if (/\([^)]{3,}\)/.test(candidate)) score -= 8;
  if (/\b(really|very|quite|rather)\b.*\b(really|very|quite|rather)\b/i.test(candidate)) score -= 7;
  if (/\b(which|that)\b.{0,28}\b(which|that)\b/i.test(candidate)) score -= 5;
  if (/\b(i think|i feel like|i have to say|to be honest|honestly)\b/i.test(candidate)) score -= 10;

  if (/\b(can't|won't|didn't|isn't|it's|i'm|i've|we're|that's|there's|you'll|i'll)\b/i.test(candidate)) {
    score += 3;
  }

  if (/[.!?]$/.test(candidate)) score += 2;

  return Math.max(0, Math.min(105, score));
}

function buildAttemptPrompt(basePrompt: string, attempt: number) {
  return [
    basePrompt,
    `Variation note: ${variationDirections[attempt % variationDirections.length]}`,
    "Use fresh wording, but do not add extra ideas that are not needed for the situation.",
  ].join("\n");
}

async function generateUniqueText(prompt: string, announce: boolean) {
  const generator = await getGenerator();

  if (announce) {
    post("status", { status: "generating", message: "Writing visible text…" });
  }

  let bestCandidate = "";
  let bestCombinedScore = Number.NEGATIVE_INFINITY;
  let bestQuality = 0;

  try {
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const temperatures = [0.18, 0.24, 0.32, 0.4] as const;
      const result = await generator(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildAttemptPrompt(prompt, attempt) },
        ],
        {
          max_new_tokens: 48,
          do_sample: true,
          temperature: temperatures[Math.min(attempt, temperatures.length - 1)],
          top_p: 0.92,
          top_k: 50,
          repetition_penalty: 1.05,
        },
      );

      const candidate = cleanCandidate(extractGeneratedText(result));
      if (!candidate || hasExactRecentMatch(candidate)) {
        continue;
      }

      const quality = naturalnessScore(candidate);
      if (quality === 0) {
        continue;
      }

      const similarity = maxRecentSimilarity(candidate);
      const combinedScore = quality - similarity * 28;

      if (combinedScore > bestCombinedScore) {
        bestCandidate = candidate;
        bestCombinedScore = combinedScore;
        bestQuality = quality;
      }

      if (attempt >= 1 && quality >= 92 && similarity <= 0.58) {
        rememberCover(candidate);
        return candidate;
      }
    }

    if (bestCandidate && bestQuality >= MIN_ACCEPTABLE_QUALITY) {
      rememberCover(bestCandidate);
      return bestCandidate;
    }

    throw new Error("The text engine could not produce a natural sentence.");
  } finally {
    if (announce) {
      post("status", { status: "ready", message: "Text engine ready" });
    }
  }
}

async function processTaskQueue() {
  if (processingTasks) {
    return;
  }

  processingTasks = true;

  try {
    while (foregroundTasks.length > 0 || backgroundTasks.length > 0) {
      const task = foregroundTasks.shift() ?? backgroundTasks.shift();
      if (task) {
        await task();
      }
    }
  } finally {
    processingTasks = false;
  }
}

function enqueueTask<T>(priority: "foreground" | "background", task: () => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const wrapped = async () => {
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      }
    };

    if (priority === "foreground") {
      foregroundTasks.push(wrapped);
    } else {
      backgroundTasks.push(wrapped);
    }

    void processTaskQueue();
  });
}

function getCachedCover(cacheKey: string) {
  const cached = coverCache.get(cacheKey);
  if (!cached?.length) {
    return null;
  }

  const value = cached.shift() ?? null;
  if (cached.length === 0) {
    coverCache.delete(cacheKey);
  }
  return value;
}

function addCachedCover(cacheKey: string, text: string) {
  if (!text) {
    return;
  }

  const cached = coverCache.get(cacheKey) ?? [];
  if (!cached.some((value) => normalizeCover(value) === normalizeCover(text))) {
    cached.push(text);
    coverCache.set(cacheKey, cached);
  }
}

function schedulePrime(cacheKey: string, prompt: string, target = DEFAULT_CACHE_TARGET) {
  const cachedCount = coverCache.get(cacheKey)?.length ?? 0;
  const primingCount = primingCounts.get(cacheKey) ?? 0;
  const needed = Math.max(0, target - cachedCount - primingCount);

  for (let index = 0; index < needed; index += 1) {
    primingCounts.set(cacheKey, (primingCounts.get(cacheKey) ?? 0) + 1);

    void enqueueTask("background", async () => {
      try {
        const text = await generateUniqueText(prompt, false);
        addCachedCover(cacheKey, text);
        post("primed", {
          cacheKey,
          count: coverCache.get(cacheKey)?.length ?? 0,
        });
      } finally {
        const remaining = Math.max(0, (primingCounts.get(cacheKey) ?? 1) - 1);
        if (remaining === 0) {
          primingCounts.delete(cacheKey);
        } else {
          primingCounts.set(cacheKey, remaining);
        }
      }
    }).catch(() => undefined);
  }
}

self.onmessage = async (event: MessageEvent) => {
  const message = event.data;

  if (message?.type === "load") {
    try {
      await getGenerator();
    } catch (error) {
      post("error", {
        requestId: message.requestId,
        message: error instanceof Error ? error.message : "Unable to prepare the text engine.",
      });
    }
    return;
  }

  if (message?.type === "prime") {
    if (typeof message.cacheKey === "string" && typeof message.prompt === "string") {
      const target = typeof message.target === "number" ? Math.max(1, Math.floor(message.target)) : DEFAULT_CACHE_TARGET;
      schedulePrime(message.cacheKey, message.prompt, target);
    }
    return;
  }

  if (message?.type !== "generate") {
    return;
  }

  const cacheKey = typeof message.cacheKey === "string" ? message.cacheKey : "auto";
  const cached = getCachedCover(cacheKey);

  if (cached) {
    post("generated", {
      requestId: message.requestId,
      text: cached,
      cached: true,
    });
    schedulePrime(cacheKey, message.prompt, DEFAULT_CACHE_TARGET);
    return;
  }

  try {
    const text = await enqueueTask("foreground", () => generateUniqueText(message.prompt, true));
    post("generated", {
      requestId: message.requestId,
      text,
      cached: false,
    });
    schedulePrime(cacheKey, message.prompt, DEFAULT_CACHE_TARGET);
  } catch (error) {
    post("error", {
      requestId: message.requestId,
      message: error instanceof Error ? error.message : "Unable to generate visible text.",
    });
  }
};
