const params = new URLSearchParams(location.search);
const target = params.get("u") || "";
const prob = parseFloat(params.get("p"));
const isWebUrl = /^https?:\/\//i.test(target);

document.getElementById("url").textContent = target;
if (!Number.isNaN(prob)) document.getElementById("score").textContent = `Phishing score: ${(prob * 100).toFixed(1)}%`;

document.getElementById("back").addEventListener("click", async () => {
  if (history.length > 1) { history.back(); return; }
  const tab = await chrome.tabs.getCurrent();
  if (tab) chrome.tabs.remove(tab.id);
});

document.getElementById("proceed").addEventListener("click", async () => {
  if (!isWebUrl) return;
  // Allow this host for the rest of the browser session, then continue to the page.
  await chrome.runtime.sendMessage({ target: "background", type: "allow", url: target });
  location.replace(target);
});
