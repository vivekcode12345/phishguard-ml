import fs from "node:fs";
import { createPreprocessor } from "../extension/lib/features.js";
const read = (p) => JSON.parse(fs.readFileSync(new URL("../" + p, import.meta.url), "utf8"));
const pre = read("extension/model/preprocess.json"), edge = read("tests/data/edge_cases.json");
const prep = createPreprocessor(pre, read("extension/model/psl_icann.json"));
let bad = 0;
edge.urls.forEach((url, i) => {
  let vec;
  try { vec = prep.featureVector(url); } catch (e) { bad++; console.log("JS EXCEPTION", JSON.stringify(url), e.message); return; }
  const diffs = vec.map((v, j) => [pre.feature_columns[j], edge.features[i][j], v]).filter(([, a, b]) => !(Math.abs(a - b) < 1e-9 || (Number.isNaN(a) && Number.isNaN(b))));
  if (diffs.length) { bad++; console.log("MISMATCH", JSON.stringify(url).slice(0, 80), JSON.stringify(diffs.slice(0, 3))); }
});
console.log(`Edge cases: ${edge.urls.length} URLs, mismatching = ${bad}`);
