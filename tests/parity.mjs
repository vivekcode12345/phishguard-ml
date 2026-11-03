// Parity test: JS features vs Python features, and JS+ONNX probabilities vs Python+ONNX probabilities.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-node";
import { createPreprocessor } from "../extension/lib/features.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const pre = read("extension/model/preprocess.json");
const psl = read("extension/model/psl_icann.json");
const parity = read("tests/data/parity_samples.json");
const prep = createPreprocessor(pre, psl);

// 1. Feature parity
let worst = 0, badRows = 0;
const badCols = {};
const examples = [];
parity.urls.forEach((url, i) => {
  let vec;
  try { vec = prep.featureVector(url); } catch (e) { badRows++; examples.push([url, "EXCEPTION " + e.message]); return; }
  let rowBad = false;
  vec.forEach((v, j) => {
    const d = Math.abs(v - parity.features[i][j]);
    worst = Math.max(worst, d);
    if (d > 1e-9) { rowBad = true; badCols[pre.feature_columns[j]] = (badCols[pre.feature_columns[j]] || 0) + 1; if (examples.length < 8) examples.push([url, pre.feature_columns[j], parity.features[i][j], v]); }
  });
  if (rowBad) badRows++;
});
console.log(`Feature parity: ${parity.urls.length} URLs, rows with mismatch = ${badRows}, max abs diff = ${worst}`);
if (badRows) { console.log("Columns:", badCols); console.log("Examples:", examples); }

// 2. End-to-end probability parity (JS preprocessing + ONNX Runtime in Node)
const session = await ort.InferenceSession.create(path.join(root, "extension/model/phishing_joint.onnx"));
let maxProbDiff = 0, flips = 0;
for (let i = 0; i < parity.urls.length; i++) {
  const url = parity.urls[i];
  const out = await session.run({
    seq: new ort.Tensor("int64", prep.encode(url), [1, pre.max_len]),
    feats: new ort.Tensor("float32", prep.scaledFeatures(url), [1, pre.feature_columns.length]),
  });
  const p = out.prob.data[0];
  maxProbDiff = Math.max(maxProbDiff, Math.abs(p - parity.prob[i]));
  if ((p >= pre.threshold) !== (parity.prob[i] >= pre.threshold)) flips++;
}
console.log(`Probability parity: max |JS - Python| = ${maxProbDiff.toExponential(2)}, decision flips at threshold ${pre.threshold.toFixed(4)} = ${flips}/${parity.urls.length}`);
