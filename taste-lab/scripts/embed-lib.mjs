// The one embedding recipe, shared by the lab, the export parity check and (mirrored) the browser:
// paraphrase-multilingual-MiniLM-L12-v2, 8-bit (q8) ONNX weights, mean pooling, unit length; 384 numbers.
// The text is what a web listing always has: its title, and "by <brand>" when known.
import { env, pipeline } from "@huggingface/transformers";

export const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const DTYPE = "q8";
export const DIM = 384;
env.cacheDir = new URL("../.cache/", import.meta.url).pathname;

export const itemText = (title, brand) => [String(title ?? "").replace(/\s+/g, " ").trim().slice(0, 200), brand ? `by ${String(brand).trim()}` : ""].filter(Boolean).join(". ");

let extractor = null;
export async function embedder() {
  extractor ??= await pipeline("feature-extraction", MODEL_ID, { dtype: DTYPE });
  return async (texts) => {
    const out = await extractor(texts, { pooling: "mean", normalize: true });
    return out.tolist().map((v) => Float32Array.from(v));
  };
}
