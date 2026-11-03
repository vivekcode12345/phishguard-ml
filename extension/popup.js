const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage({ target: "background", ...msg });

function show(url, v) {
  $("url").textContent = url || "";
  if (!v || v.ok === false) {
    $("status").className = "status";
    $("status").textContent = v && v.error ? "Could not analyse this URL" : "Not analysed";
    $("bar").hidden = true; $("detail").textContent = "";
    return;
  }
  $("status").className = "status " + (v.phishing ? "bad" : "ok");
  $("status").textContent = v.phishing ? "Likely phishing" : "No phishing signal detected";
  $("bar").hidden = false;
  $("fill").className = "fill" + (v.phishing ? " bad" : "");
  $("fill").style.width = Math.round(v.prob * 100) + "%";
  $("thr").style.left = Math.round(v.threshold * 100) + "%";
  const ms = v.timings ? v.timings.totalMs.toFixed(1) : "?";
  $("detail").textContent = `Phishing score ${(v.prob * 100).toFixed(1)}% · alert threshold ${(v.threshold * 100).toFixed(0)}% · ${ms} ms`;
}

async function refreshStats() {
  const s = await send({ type: "stats" });
  $("stats").textContent = `${s.scanned} checked · ${s.warned} warned`;
  $("enabled").checked = s.enabled;
}

async function checkUrl(url) {
  $("status").textContent = "Checking…"; $("status").className = "status";
  show(url, await send({ type: "check", url }));
  refreshStats();
}

$("go").addEventListener("click", () => {
  let u = $("manual").value.trim();
  if (!u) return;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = "https://" + u;
  checkUrl(u);
});
$("manual").addEventListener("keydown", (e) => { if (e.key === "Enter") $("go").click(); });
$("enabled").addEventListener("change", (e) => send({ type: "setEnabled", value: e.target.checked }));

(async () => {
  refreshStats();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && /^https?:\/\//i.test(tab.url)) checkUrl(tab.url);
  else show(tab && tab.url && tab.url.startsWith("chrome-extension://") ? "" : (tab && tab.url) || "", null);
})();
