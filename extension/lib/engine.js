/**
 * On-device inference engine: loads the ONNX model with ONNX Runtime Web (WebAssembly)
 * and scores URLs. Used by the offscreen document and by the benchmark page.
 * Expects the global `ort` object from vendor/ort.wasm.min.js.
 */
import { createPreprocessor } from "./features.js";

export async function loadEngine() {
  ort.env.wasm.wasmPaths = chrome.runtime.getURL("vendor/");
  ort.env.wasm.numThreads = 1;   // the model is tiny; avoids the need for cross-origin isolation
  ort.env.wasm.proxy = false;

  const t0 = performance.now();
  const getJson = (p) => fetch(chrome.runtime.getURL(p)).then((r) => r.json());
  const [pre, psl, modelBytes] = await Promise.all([
    getJson("model/preprocess.json"),
    getJson("model/psl_icann.json"),
    fetch(chrome.runtime.getURL("model/phishing_joint.onnx")).then((r) => r.arrayBuffer()),
  ]);
  const tFetched = performance.now();
  const prep = createPreprocessor(pre, psl);
  const session = await ort.InferenceSession.create(modelBytes, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  const tReady = performance.now();
  const nFeatures = pre.feature_columns.length;

  /** Score one URL. Returns the phishing probability and per-stage timings in milliseconds. */
  async function score(url) {
    const t1 = performance.now();
    const seq = new ort.Tensor("int64", prep.encode(url), [1, pre.max_len]);
    const feats = new ort.Tensor("float32", prep.scaledFeatures(url), [1, nFeatures]);
    const t2 = performance.now();
    const out = await session.run({ seq, feats });
    const t3 = performance.now();
    const prob = out.prob.data[0];
    return {
      prob,
      phishing: prob >= prep.threshold,
      threshold: prep.threshold,
      timings: { preprocessMs: t2 - t1, inferenceMs: t3 - t2, totalMs: t3 - t1 },
    };
  }

  return {
    score,
    threshold: prep.threshold,
    modelBytes: modelBytes.byteLength,
    load: { fetchMs: tFetched - t0, sessionMs: tReady - tFetched, totalMs: tReady - t0 },
  };
}
