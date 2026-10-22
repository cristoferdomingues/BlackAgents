/**
 * Turns a short clip into text on this computer.
 * The model is downloaded once and cached by the browser. The audio is not uploaded.
 */

const MODEL = "onnx-community/whisper-tiny.en"

type SpeechPipeline = (audio: Float32Array) => Promise<unknown>

let loading: Promise<SpeechPipeline> | null = null

function loadModel(): Promise<SpeechPipeline> {
  if (!loading) {
    loading = import("@huggingface/transformers")
      .then(async ({ pipeline, env }) => {
        env.allowLocalModels = false
        const asr = await pipeline("automatic-speech-recognition", MODEL, {
          dtype: "q8",
          device: "wasm",
        })
        return asr as SpeechPipeline
      })
      .catch((error: unknown) => {
        loading = null
        throw error
      })
  }
  return loading
}

/** Download the speech model if it is not cached yet. */
export async function prepareWakeModel(): Promise<void> {
  await loadModel()
}

/** Text for 16 kHz mono samples. Empty when the model returns nothing useful. */
export async function transcribeWakeAudio(samples: Float32Array): Promise<string> {
  const asr = await loadModel()
  const result: unknown = await asr(samples)
  if (typeof result === "object" && result !== null && "text" in result) {
    const text = result.text
    return typeof text === "string" ? text : ""
  }
  return ""
}
