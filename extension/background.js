// Service worker: watches main-frame navigations, asks the offscreen document to score the URL
// locally and shows a warning page for URLs the model flags as phishing.
// No URL is sent over the network and no browsing history is stored (only two counters).

const OFFSCREEN_URL = "offscreen.html";
const cache = new Map(); // url -> verdict (kept in memory only)
const CACHE_LIMIT = 500;
let creating = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length > 0) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["WORKERS"],
      justification: "Run the on-device ONNX phishing model (WebAssembly) outside the service worker.",
    }).finally(() => { creating = null; });
  }
  await creating;
}

async function isEnabled() {
  const { enabled } = await chrome.storage.local.get("enabled");
  return enabled !== false;
}

async function bump(counter) {
  const data = await chrome.storage.local.get(counter);
  await chrome.storage.local.set({ [counter]: (data[counter] || 0) + 1 });
}

/** Score a URL locally (cached). Returns null when the URL cannot be scored. */
async function scoreUrl(url, silent = false) {
  if (!silent && cache.has(url)) return { ...cache.get(url), cached: true };
  await ensureOffscreen();
  const t0 = performance.now();
  const res = await chrome.runtime.sendMessage({ target: "offscreen", type: "score", url });
  if (!res || !res.ok) return null;
  const verdict = { ...res, roundTripMs: performance.now() - t0 };
  if (silent) return verdict; // benchmark mode: no caching, no counters
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(url, verdict);
  await bump("scanned");
  return verdict;
}

async function isAllowed(url) {
  try {
    const { allow = [] } = await chrome.storage.session.get("allow");
    return allow.includes(new URL(url).hostname);
  } catch { return false; }
}

function setBadge(tabId, verdict) {
  const text = !verdict ? "" : verdict.phishing ? "!" : "OK";
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: verdict && verdict.phishing ? "#c62828" : "#2e7d32" }).catch(() => {});
}

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0 || !/^https?:\/\//i.test(details.url)) return;
  if (!(await isEnabled()) || (await isAllowed(details.url))) return;
  try {
    const verdict = await scoreUrl(details.url);
    setBadge(details.tabId, verdict);
    if (verdict && verdict.phishing) {
      await bump("warned");
      const page = chrome.runtime.getURL("warning.html") +
        `?u=${encodeURIComponent(details.url)}&p=${verdict.prob.toFixed(4)}`;
      await chrome.tabs.update(details.tabId, { url: page });
    }
  } catch (e) {
    console.warn("PhishGuard: could not score URL", e);
  }
});

// Tab-specific badge text is cleared on navigation, so re-apply it from the cache.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0 && cache.has(details.url)) setBadge(details.tabId, cache.get(details.url));
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "background") return;
  (async () => {
    if (msg.type === "check") {
      sendResponse(await scoreUrl(msg.url, !!msg.silent).catch((e) => ({ ok: false, error: String(e) })));
    } else if (msg.type === "allow") {
      const { allow = [] } = await chrome.storage.session.get("allow");
      const host = new URL(msg.url).hostname;
      if (!allow.includes(host)) allow.push(host);
      await chrome.storage.session.set({ allow });
      sendResponse({ ok: true });
    } else if (msg.type === "stats") {
      const s = await chrome.storage.local.get(["scanned", "warned", "enabled"]);
      sendResponse({ scanned: s.scanned || 0, warned: s.warned || 0, enabled: s.enabled !== false });
    } else if (msg.type === "setEnabled") {
      await chrome.storage.local.set({ enabled: !!msg.value });
      sendResponse({ ok: true });
    }
  })();
  return true;
});
