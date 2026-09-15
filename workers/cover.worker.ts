import { pipeline } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/LFM2.5-350M-ONNX";
let generatorPromise: Promise<any> | null = null;

function post(type: string, payload: Record<string, unknown> = {}) {
  self.postMessage({ type, ...payload });
}

async function getGenerator() {
  if (!generatorPromise) {
    post("status", { status: "loading", message: "Downloading local model…" });
    generatorPromise = pipeline("text-generation", MODEL_ID, {
      device: "webgpu",
      dtype: "q4",
      progress_callback: (progress: any) => {
        if (typeof progress?.progress === "number") {
          post("progress", {
            progress: Math.max(0, Math.min(100, Math.round(progress.progress))),
          });
        }
      },
    });
  }

  const generator = await generatorPromise;
  post("status", { status: "ready", message: "Local model ready" });
  return generator;
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

self.onmessage = async (event: MessageEvent) => {
  const message = event.data;

  if (message?.type === "load") {
    try {
      await getGenerator();
    } catch (error) {
      generatorPromise = null;
      post("error", {
        requestId: message.requestId,
        message: error instanceof Error ? error.message : "Unable to load local model.",
      });
    }
    return;
  }

  if (message?.type !== "generate") {
    return;
  }

  try {
    const generator = await getGenerator();
    post("status", { status: "generating", message: "Writing cover sentence…" });
    const result = await generator(
      [{ role: "user", content: message.prompt }],
      {
        max_new_tokens: 64,
        do_sample: true,
        temperature: 0.92,
        top_p: 0.92,
        top_k: 50,
        repetition_penalty: 1.08,
      },
    );

    post("generated", {
      requestId: message.requestId,
      text: extractGeneratedText(result),
    });
    post("status", { status: "ready", message: "Local model ready" });
  } catch (error) {
    post("error", {
      requestId: message.requestId,
      message: error instanceof Error ? error.message : "Unable to generate a cover sentence.",
    });
  }
};
