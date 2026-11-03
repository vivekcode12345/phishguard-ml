// Minimal server-side baseline: the same ONNX model behind an HTTP API.
// Used only for the "local inference vs API" comparison.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-node";
import { createPreprocessor } from "../extension/lib/features.js";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../extension/model");
const pre = JSON.parse(fs.readFileSync(path.join(dir, "preprocess.json"), "utf8"));
const psl = JSON.parse(fs.readFileSync(path.join(dir, "psl_icann.json"), "utf8"));
const prep = createPreprocessor(pre, psl);
const session = await ort.InferenceSession.create(path.join(dir, "phishing_joint.onnx"));

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const { url } = JSON.parse(body);
      const out = await session.run({
        seq: new ort.Tensor("int64", prep.encode(url), [1, pre.max_len]),
        feats: new ort.Tensor("float32", prep.scaledFeatures(url), [1, pre.feature_columns.length]),
      });
      const prob = out.prob.data[0];
      res.writeHead(200, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ prob, phishing: prob >= prep.threshold }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json", ...cors });
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  });
}).listen(8787, "127.0.0.1", () => console.log("API listening on http://127.0.0.1:8787/score"));
