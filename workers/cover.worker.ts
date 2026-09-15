import { pipeline } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/LFM2.5-350M-ONNX";
const DEFAULT_CACHE_TARGET = 2;
const MAX_RECENT_COVERS = 80;
const MAX_GENERATION_ATTEMPTS = 6;
const MAX_SIMILARITY = 0.72;

let generatorPromise: Promise<any> | null = null;
let hasTotalProgress = false;
let processingTasks = false;

const foregroundTasks: Array<() => Promise<void>> = [];
const backgroundTasks: Array<() => Promise<void>> = [];
const coverCache = new Map<string, string[]>();
const primingCounts = new Map<string, number>();
const recentCovers: string[] = [];

const openingDirections = [
  "Start directly with an action or concrete detail.",
  "Start with a natural time phrase.",
  "Start with a place or setting if it feels natural.",
  "Avoid beginning with a first-person pronoun.",
  "Use a conversational first-person opening that is not a greeting.",
  "Start mid-thought in a way that still makes sense on its own.",
  "Open with the mundane subject itself rather than explaining context.",
  "Use an understated observation as the opening.",
];

const rhythmDirections = [
  "Keep the syntax simple and direct.",
  "Use one natural subordinate clause.",
  "Use a slightly clipped text-message rhythm.",
  "Use a relaxed spoken rhythm with one contraction.",
  "Make the sentence practical rather than reflective.",
  "Make the sentence observational rather than explanatory.",
  "Use a different sentence shape from a typical assistant response.",
  "Keep the wording plain and unpolished, like a real message typed quickly.",
];

const detailDirections = [
  "Include one specific but unremarkable physical detail.",
  "Include one ordinary time reference if it fits.",
  "Include one mundane place detail if it fits.",
  "Include one everyday object or food detail if it fits.",
  "Keep details sparse and believable.",
  "Use no adjective unless it sounds completely natural.",
  "Prefer concrete nouns over vague emotional language.",
  "Avoid coffee, lunch, rain, routes home, and reminders for this variation.",
];

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
    post("status", { status: "loading", message: "Loading local model in background…" });
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
    post("status", { status: "ready", message: "Local model ready" });
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

function tokenSet(value: string) {
  return new Set(normalizeCover(value).split(" ").filter(Boolean));
}

function bigramSet(value: string) {
  const words = normalizeCover(value).split(" ").filter(Boolean);
  const bigrams = new Set<string>();
  for (let index = 0; index < words.length - 1; index += 1) {
    bigrams.add(`${words[index]} ${words[index + 1]}`);
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
  const openingPenalty = leftOpening.length > 0 && leftOpening === rightOpening ? 0.9 : 0;

  return Math.max(wordSimilarity * 0.58 + bigramSimilarity * 0.42, openingPenalty);
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

function buildAttemptPrompt(basePrompt: string, attempt: number) {
  const recent = recentCovers
    .slice(-6)
    .map((value) => `“${value}”`)
    .join(" | ");

  return [
    basePrompt,
    `Fresh variation ${attempt + 1}: ${pick(openingDirections)}`,
    pick(rhythmDirections),
    pick(detailDirections),
    "Use genuinely different wording, subject matter, and sentence structure from anything generated recently.",
    recent ? `Do not repeat or closely paraphrase these recent outputs: ${recent}` : "Do not use a stock or template-like sentence.",
    "Return only the new sentence.",
  ].join(" ");
}

async function generateUniqueText(prompt: string, announce: boolean) {
  const generator = await getGenerator();

  if (announce) {
    post("status", { status: "generating", message: "Writing cover sentence…" });
  }

  let bestCandidate = "";
  let bestSimilarity = Number.POSITIVE_INFINITY;

  try {
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const temperature = 0.96 + randomIndex(18) / 100 + attempt * 0.015;
      const topP = 0.94 + randomIndex(5) / 100;
      const result = await generator(
        [{ role: "user", content: buildAttemptPrompt(prompt, attempt) }],
        {
          max_new_tokens: 64,
          do_sample: true,
          temperature: Math.min(1.16, temperature),
          top_p: Math.min(0.99, topP),
          top_k: 80 + randomIndex(41),
          repetition_penalty: 1.1,
        },
      );

      const candidate = cleanCandidate(extractGeneratedText(result));
      if (candidate.length < 20 || hasExactRecentMatch(candidate)) {
        continue;
      }

      const similarity = maxRecentSimilarity(candidate);
      if (similarity < bestSimilarity) {
        bestCandidate = candidate;
        bestSimilarity = similarity;
      }

      if (similarity < MAX_SIMILARITY) {
        rememberCover(candidate);
        return candidate;
      }
    }

    if (bestCandidate) {
      rememberCover(bestCandidate);
      return bestCandidate;
    }

    throw new Error("The local model could not produce a fresh cover sentence.");
  } finally {
    if (announce) {
      post("status", { status: "ready", message: "Local model ready" });
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
        message: error instanceof Error ? error.message : "Unable to load local model.",
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
      message: error instanceof Error ? error.message : "Unable to generate a cover sentence.",
    });
  }
};
