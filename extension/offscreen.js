// Offscreen document: hosts the ONNX Runtime Web session for the service worker.
import { loadEngine } from "./lib/engine.js";

const enginePromise = loadEngine();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "offscreen") return;
  (async () => {
    try {
      const engine = await enginePromise;
      if (msg.type === "score") sendResponse({ ok: true, ...(await engine.score(msg.url)) });
      else if (msg.type === "info") sendResponse({ ok: true, load: engine.load, modelBytes: engine.modelBytes });
      else sendResponse({ ok: false, error: "unknown message type" });
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // keep the message channel open for the async response
});
