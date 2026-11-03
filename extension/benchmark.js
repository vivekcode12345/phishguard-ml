// Benchmark for Section "Real-time performance": run from the extension origin so that the
// numbers include the real browser WebAssembly runtime.
import { loadEngine } from "./lib/engine.js";

const N = 500, WARMUP = 30;
const out = document.getElementById("out");
const log = (s) => { out.textContent += s + "\n"; };
const heapMB = () => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null);

function stats(values) {
  const v = [...values].sort((a, b) => a - b);
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { mean: v.reduce((a, b) => a + b, 0) / v.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: v[v.length - 1] };
}

async function run() {
  const urls = await (await fetch(chrome.runtime.getURL("model/bench_urls.json"))).json();
  const result = { n: Math.min(N, urls.length), userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency };

  const heap0 = heapMB();
  const engine = await loadEngine();
  result.modelBytes = engine.modelBytes;
  result.load = engine.load;
  result.heapMB = { beforeLoad: heap0, afterLoad: heapMB() };

  for (let i = 0; i < WARMUP; i++) await engine.score(urls[i % urls.length]);

  const pre = [], inf = [], tot = [];
  for (const url of urls.slice(0, result.n)) {
    const r = await engine.score(url);
    pre.push(r.timings.preprocessMs); inf.push(r.timings.inferenceMs); tot.push(r.timings.totalMs);
  }
  result.preprocessMs = stats(pre); result.inferenceMs = stats(inf); result.localTotalMs = stats(tot);
  result.heapMB.afterRuns = heapMB();

  // Extension round trip: popup page -> service worker -> offscreen document -> back
  const rt = [];
  for (const url of urls.slice(0, 200)) {
    const t0 = performance.now();
    await chrome.runtime.sendMessage({ target: "background", type: "check", url, silent: true });
    rt.push(performance.now() - t0);
  }
  result.extensionRoundTripMs = stats(rt);

  const api = new URLSearchParams(location.search).get("api");
  if (api) {
    const times = [];
    for (const url of urls.slice(0, 200)) {
      const t0 = performance.now();
      const res = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      await res.json();
      times.push(performance.now() - t0);
    }
    result.apiRoundTripMs = stats(times); result.apiUrl = api;
  }
  return result;
}

document.getElementById("run").addEventListener("click", async () => {
  out.textContent = "Running…\n";
  try {
    const result = await run();
    window.__bench = result;
    out.textContent = JSON.stringify(result, null, 2);
    document.title = "benchmark done";
  } catch (e) {
    out.textContent = "Benchmark failed: " + (e && e.stack || e);
    document.title = "benchmark error";
  }
});
if (new URLSearchParams(location.search).get("auto")) document.getElementById("run").click();
