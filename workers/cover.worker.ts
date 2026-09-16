const MODEL_ID = "onnx-community/LFM2.5-350M-ONNX";
const MAX_RECENT_COVERS = 80;
const MAX_GENERATION_ATTEMPTS = 4;
const MIN_ACCEPTABLE_QUALITY = 62;

type CoverLanguage = "en" | "bn" | "hi" | "es" | "fr" | "de" | "ar";

const SYSTEM_PROMPT = [
  "You write realistic one-sentence messages that could genuinely be sent by a person.",
  "Always write in the target language requested by the user.",
  "Prefer ordinary phrasing, simple syntax, concrete details, and natural everyday language.",
  "Do not sound like an assistant, storyteller, copywriter, translation exercise, or creative-writing exercise.",
  "Do not add commentary, labels, explanations, quotation marks, translations, or multiple options.",
  "Return only the message.",
].join(" ");

const variationDirections = [
  "Keep the syntax simple and direct.",
  "Lead with the practical detail rather than background context.",
  "Use the kind of phrasing a native speaker would use in a quick message.",
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
const assistantOpening = /^(sure|certainly|absolutely|of course|here(?:'s| is)|the sentence|message:|sentence:|output:|translation:)/i;

let generatorPromise: Promise<any> | null = null;
let hasTotalProgress = false;
let processingTasks = false;

const foregroundTasks: Array<() => Promise<void>> = [];
const recentCovers: string[] = [];

function post(type: string, payload: Record<string, unknown> = {}) {
  self.postMessage({ type, ...payload });
}

async function getGenerator() {
  if (!generatorPromise) {
    post("status", { status: "loading", message: "Preparing text engine…" });
    hasTotalProgress = false;
    generatorPromise = (async () => {
      const { pipeline } = await import("@huggingface/transformers");
      return pipeline("text-generation", MODEL_ID, {
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
    })();
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
    .split(/(?<=[.!?।؟])\s+/u)[0]
    .trim();
}

function normalizeCover(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}'’\s]/gu, " ")
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

function requestedScriptRatio(candidate: string, language: CoverLanguage) {
  const letters = Array.from(candidate).filter((character) => /\p{L}/u.test(character));
  if (letters.length === 0) {
    return 0;
  }

  let scriptPattern: RegExp;
  if (language === "bn") {
    scriptPattern = /[\u0980-\u09FF]/u;
  } else if (language === "hi") {
    scriptPattern = /[\u0900-\u097F]/u;
  } else if (language === "ar") {
    scriptPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u;
  } else {
    scriptPattern = /[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]/u;
  }

  const matching = letters.filter((character) => scriptPattern.test(character)).length;
  return matching / letters.length;
}

function matchesRequestedLanguage(candidate: string, language: CoverLanguage) {
  const ratio = requestedScriptRatio(candidate, language);
  if (language === "bn" || language === "hi" || language === "ar") {
    return ratio >= 0.7;
  }
  return ratio >= 0.78;
}

function naturalnessScore(candidate: string, language: CoverLanguage) {
  const normalized = normalizeCover(candidate);
  const wordCount = words(candidate).length;

  if (!candidate || wordCount < 5 || wordCount > 34) {
    return 0;
  }

  if (!matchesRequestedLanguage(candidate, language)) {
    return 0;
  }

  if (assistantOpening.test(candidate) || forbiddenContent.test(candidate)) {
    return 0;
  }

  if (/[*#{}\[\]<>`]/.test(candidate) || hasRepeatedAdjacentWord(candidate)) {
    return 0;
  }

  const sentenceEndings = candidate.match(/[.!?।؟](?=\s|$)/gu)?.length ?? 0;
  if (sentenceEndings > 1) {
    return 0;
  }

  let score = 100;

  if (wordCount < 8) score -= (8 - wordCount) * 4;
  if (wordCount > 24) score -= (wordCount - 24) * 3;

  if (language === "en") {
    for (const phrase of unnaturalPhrases) {
      if (normalized.includes(phrase)) {
        score -= 16;
      }
    }
  }

  const commaCount = (candidate.match(/[,،]/g) ?? []).length;
  if (commaCount > 2) score -= (commaCount - 2) * 7;

  if (/[;:]/.test(candidate)) score -= 8;
  if (/[—–]/.test(candidate)) score -= 10;
  if (/\([^)]{3,}\)/.test(candidate)) score -= 8;

  if (language === "en") {
    if (/\b(really|very|quite|rather)\b.*\b(really|very|quite|rather)\b/i.test(candidate)) score -= 7;
    if (/\b(which|that)\b.{0,28}\b(which|that)\b/i.test(candidate)) score -= 5;
    if (/\b(i think|i feel like|i have to say|to be honest|honestly)\b/i.test(candidate)) score -= 10;
    if (/\b(can't|won't|didn't|isn't|it's|i'm|i've|we're|that's|there's|you'll|i'll)\b/i.test(candidate)) {
      score += 3;
    }
  }

  if (/[.!?।؟]$/u.test(candidate)) score += 2;

  return Math.max(0, Math.min(105, score));
}

function buildAttemptPrompt(basePrompt: string, attempt: number) {
  return [
    basePrompt,
    `Variation note: ${variationDirections[attempt % variationDirections.length]}`,
    "Use fresh wording, but do not add extra ideas that are not needed for the situation.",
  ].join("\n");
}

async function generateUniqueText(prompt: string, announce: boolean, language: CoverLanguage) {
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
          max_new_tokens: language === "en" ? 48 : 72,
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

      const quality = naturalnessScore(candidate, language);
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

    throw new Error("The text engine could not produce a natural sentence in the selected language.");
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
    while (foregroundTasks.length > 0) {
      const task = foregroundTasks.shift();
      if (task) {
        await task();
      }
    }
  } finally {
    processingTasks = false;
  }
}

function enqueueTask<T>(task: () => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const wrapped = async () => {
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      }
    };

    foregroundTasks.push(wrapped);
    void processTaskQueue();
  });
}

function safeLanguage(value: unknown): CoverLanguage {
  if (value === "bn" || value === "hi" || value === "es" || value === "fr" || value === "de" || value === "ar") {
    return value;
  }
  return "en";
}

self.onmessage = async (event: MessageEvent) => {
  const message = event.data;

  // Startup must stay cheap and stable. The heavy generation dependency and
  // model are both loaded only after an explicit generation request.
  if (message?.type === "load" || message?.type === "prime") {
    return;
  }

  if (message?.type !== "generate") {
    return;
  }

  const language = safeLanguage(message.language);

  try {
    const text = await enqueueTask(() => generateUniqueText(message.prompt, true, language));
    post("generated", {
      requestId: message.requestId,
      text,
      cached: false,
    });
  } catch (error) {
    post("error", {
      requestId: message.requestId,
      message: error instanceof Error ? error.message : "Unable to generate visible text.",
    });
  }
};