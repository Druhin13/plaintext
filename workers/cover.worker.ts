import { pipeline } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/LFM2.5-350M-ONNX";
const DEFAULT_CACHE_TARGET = 2;

let generatorPromise: Promise<any> | null = null;
let hasTotalProgress = false;
let processingTasks = false;

const foregroundTasks: Array<() => Promise<void>> = [];
const backgroundTasks: Array<() => Promise<void>> = [];
const coverCache = new Map<string, string[]>();
const primingCounts = new Map<string, number>();

function post(type: string, payload: Record<string, unknown> = {}) {
  self.postMessage({ type, ...payload });
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

async function generateText(prompt: string, announce: boolean) {
  const generator = await getGenerator();

  if (announce) {
    post("status", { status: "generating", message: "Writing cover sentence…" });
  }

  const result = await generator(
    [{ role: "user", content: prompt }],
    {
      max_new_tokens: 64,
      do_sample: true,
      temperature: 0.92,
      top_p: 0.92,
      top_k: 50,
      repetition_penalty: 1.08,
    },
  );

  if (announce) {
    post("status", { status: "ready", message: "Local model ready" });
  }

  return extractGeneratedText(result);
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
  cached.push(text);
  coverCache.set(cacheKey, cached);
}

function schedulePrime(cacheKey: string, prompt: string, target = DEFAULT_CACHE_TARGET) {
  const cachedCount = coverCache.get(cacheKey)?.length ?? 0;
  const primingCount = primingCounts.get(cacheKey) ?? 0;
  const needed = Math.max(0, target - cachedCount - primingCount);

  for (let index = 0; index < needed; index += 1) {
    primingCounts.set(cacheKey, (primingCounts.get(cacheKey) ?? 0) + 1);

    void enqueueTask("background", async () => {
      try {
        const text = await generateText(prompt, false);
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
    const text = await enqueueTask("foreground", () => generateText(message.prompt, true));
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
