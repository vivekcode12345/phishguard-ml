// End-to-end test of the unpacked extension in a real Chromium (headed, under Xvfb).
const { chromium } = require("playwright");
const { spawn, execSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");

const ext = path.resolve(__dirname, "../extension");
const parity = JSON.parse(fs.readFileSync(path.resolve(__dirname, "data/parity_samples.json"), "utf8"));
const order = parity.prob.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]);
const phishUrls = order.slice(0, 3).map(([p, i]) => parity.urls[i]);
const legitUrls = order.slice(-3).map(([p, i]) => parity.urls[i]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUrl(page, test, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (test(page.url())) return true; await sleep(50); }
  return false;
}

function extensionRssMB() {
  const rows = execSync("ps -eo pid,rss,args --no-headers").toString().split("\n");
  const procs = rows.filter((l) => /--type=renderer/.test(l) && /--extension-process/.test(l));
  return { count: procs.length, rssMB: procs.reduce((s, l) => s + parseInt(l.trim().split(/\s+/)[1], 10), 0) / 1024 };
}

(async () => {
  const api = spawn("node", ["server/server.mjs"], { cwd: path.resolve(__dirname, ".."), stdio: "inherit" });
  await sleep(1500);
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-profile-"));
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
    const id = new URL(sw.url()).host;
    console.log("Extension id:", id, "| Chromium", ctx.browser()?.version?.());

    // Serve stub pages so no real network access is needed
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body><h1>stub page</h1></body></html>" }));

    const page = await ctx.newPage();
    const results = { phishing: [], legit: [] };

    for (const url of phishUrls) {
      await page.goto(url).catch(() => {});
      await waitUrl(page, (u) => /warning\.html/.test(u));
      results.phishing.push({ url: url.slice(0, 70), blocked: /warning\.html/.test(page.url()) });
    }
    for (const url of legitUrls) {
      await page.goto(url).catch(() => {});
      await sleep(700);
      const badge = await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ active: true }); return chrome.action.getBadgeText({ tabId: t.id }); }).catch(() => "?");
      results.legit.push({ url: url.slice(0, 70), blocked: /warning\.html/.test(page.url()), stayed: page.url().startsWith("http"), badge });
    }
    console.log("Phishing-flagged URLs:", JSON.stringify(results.phishing));
    console.log("Legitimate URLs:", JSON.stringify(results.legit));

    // Warning page content and "Proceed anyway"
    await page.goto(phishUrls[0]).catch(() => {});
    if (!(await waitUrl(page, (u) => /warning\.html/.test(u)))) throw new Error("warning page not shown");
    await page.waitForLoadState("domcontentloaded");
    console.log("Warning heading:", await page.locator("h1").innerText(), "|", await page.locator("#score").innerText());
    await page.screenshot({ path: path.resolve(__dirname, "../results/screenshots/warning.png") });
    await page.click("#proceed");
    await waitUrl(page, (u) => u.startsWith("http"));
    console.log("After 'Proceed anyway' URL is web page again:", page.url().slice(0, 60));

    // Popup (opened as a tab) manual check
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.fill("#manual", phishUrls[1]); await popup.click("#go");
    await popup.waitForFunction(() => /phishing|signal/i.test(document.getElementById("status").textContent) && !/Checking/.test(document.getElementById("status").textContent), null, { timeout: 10000 });
    console.log("Popup verdict:", await popup.locator("#status").innerText(), "|", await popup.locator("#detail").innerText());
    await popup.screenshot({ path: path.resolve(__dirname, "../results/screenshots/popup.png"), clip: { x: 0, y: 0, width: 380, height: 330 } });

    // Benchmark (with API comparison)
    const rssBefore = extensionRssMB();
    const bench = await ctx.newPage();
    bench.on("console", (m) => console.log("  [bench console]", m.text().slice(0, 200)));
    bench.on("pageerror", (e) => console.log("  [bench pageerror]", String(e).slice(0, 300)));
    await bench.goto(`chrome-extension://${id}/benchmark.html?auto=1&api=${encodeURIComponent("http://127.0.0.1:8787/score")}`);
    await bench.waitForFunction(() => /^benchmark (done|error)$/.test(document.title), null, { timeout: 120000 });
    if ((await bench.title()) === "benchmark error") throw new Error(await bench.locator("#out").innerText());
    const result = await bench.evaluate(() => window.__bench);
    result.extensionProcessRss = { before: rssBefore, after: extensionRssMB() };
    fs.writeFileSync(path.resolve(__dirname, "../results/benchmark_result.json"), JSON.stringify(result, null, 2));
    console.log("BENCH", JSON.stringify(result));
  } finally {
    await ctx.close().catch(() => {});
    api.kill();
  }
})().catch((e) => { console.error("E2E FAILED:", e); process.exit(1); });
