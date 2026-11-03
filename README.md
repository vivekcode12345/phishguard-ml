# PhishGuard ML: Zero-Day Phishing URL Detection with On-Device Inference

Authors: <add team member names>

A phishing URL detector that combines a character-level CNN with handcrafted lexical features, evaluated on
**chronological and domain-disjoint splits** (not only random splits) and deployed as a **Chrome extension whose model
runs entirely inside the browser**. Visited URLs are never sent to a server.

## Contents

- [Quick start](#quick-start)
- [Contributions](#contributions)
- [Data](#data)
- [Models](#models)
- [Results](#results)
- [On-device deployment](#on-device-deployment)
- [Repository layout](#repository-layout)
- [Limitations](#limitations)
- [Reproducibility](#reproducibility)
- [Screenshots](#screenshots)

## Quick start

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `extension/` folder.
3. Click the extension icon and use **Check a URL** to score an address locally.
4. Open `chrome-extension://<extension-id>/benchmark.html` and click **Run benchmark**.

Do not visit real phishing sites to test; use the popup or the stubbed-network end-to-end test.

## Contributions

1. **Honest zero-day evaluation.** Random, domain-disjoint and strictly chronological splits on the same data.
   Detection quality drops sharply from random to chronological splits, which random-split papers do not show.
2. **Hybrid model with ablation.** Random Forest, XGBoost, character CNN, three fusion strategies and an early-fusion
   joint network, compared at a fixed 1% false-positive rate with domain-clustered bootstrap confidence intervals.
3. **Privacy-preserving deployment.** The joint network (481 KB ONNX) runs in a Manifest V3 extension with ONNX Runtime Web.
   JavaScript features are verified to match the Python training features on 2,000 URLs plus 196 edge cases.
4. **Robustness and performance study.** URL obfuscation, class imbalance, training-seed variability, latency and memory.

## Data

| Class | Source | Notes |
|---|---|---|
| Phishing | PhishTank online-valid feed, Nov 2024 to Oct 2026 | 31,178 URLs after cleaning, each with a submission timestamp |
| Legitimate | Tranco top-100k domains | Same-site links from 6,000 homepages, plus 12,735 bare homepage URLs from additional domains so that both classes have the same share (33%) of domain-only URLs |

After cleaning the dataset has 69,787 URLs. Domains that appear in both classes (free hosting and shorteners) were removed.
For the chronological split, 3,944 phishing URLs were dropped so that no domain appears in two splits; the models use 65,843 URLs.
The data files are not committed. They are rebuilt by `notebooks/project.ipynb`.

### Splits

| Split | Construction |
|---|---|
| Random | Stratified 70/15/15 (reference only) |
| Domain-disjoint | Whole domains assigned to train, validation or test |
| Chronological | Phishing URLs split by submission time (validation from 2026-06-21, test from 2026-08-14), domain-disjoint across splits; legitimate URLs have no timestamp and are split by domain |

Phishing domains are reused over time: 56% of the validation and 28% of the test phishing URLs in the chronological split
were on domains already seen in an earlier split and had to be removed.

## Models

| Model | Input |
|---|---|
| Random Forest, XGBoost | 67 lexical features (lengths, character counts, entropy, keywords, brand mentions, TLD one-hot, ...) |
| Character CNN | First 200 characters of the URL (scheme removed), embedding and two Conv1d layers, 105,889 parameters |
| Joint network (deployed) | CNN branch and handcrafted-feature branch trained end to end, 122,529 parameters |
| Late fusion | Weighted average and logistic-regression stacking of XGBoost and CNN probabilities |

## Results

Threshold fixed on the validation set at 1% false-positive rate. Cells show PR-AUC / recall at that threshold.
Test sets: random and domain-disjoint about 40% phishing, chronological 37% phishing.

| Model | Random | Domain-disjoint | Chronological |
|---|---|---|---|
| Random Forest | 0.987 / 0.905 | 0.959 / 0.681 | 0.908 / 0.609 |
| XGBoost | 0.987 / 0.904 | 0.965 / 0.771 | 0.926 / 0.618 |
| Character CNN | 0.990 / 0.927 | 0.949 / 0.638 | 0.932 / 0.614 |
| Late fusion: weighted average | 0.993 / 0.942 | 0.975 / 0.817 | 0.950 / 0.700 |
| Late fusion: stacking | 0.994 / 0.956 | 0.978 / 0.815 | 0.955 / 0.725 |
| **Joint network (deployed)** | 0.993 / 0.953 | 0.975 / 0.792 | **0.957 / 0.709** |

- On the chronological split the joint network's PR-AUC 95% CI [0.950, 0.964] does not overlap that of the best single model, the
  character CNN [0.924, 0.940]. On the random and domain-disjoint splits the intervals overlap, so the gain is not statistically established there.
- The three fusion strategies are statistically indistinguishable.
- Over 3 training seeds (chronological split) the joint network reaches PR-AUC 0.955 ± 0.005 and recall 0.708 ± 0.015.
  XGBoost is deterministic in this setup, so it has no seed variance.
- A random split overstates performance: at the default 0.5 threshold XGBoost has F1 0.947 on the random split and 0.795 on the chronological split.

### Robustness (chronological split, joint network, recall at the 1% FPR threshold)

| Attack applied to phishing URLs | XGBoost | Char CNN | Joint network |
|---|---|---|---|
| None (clean) | 0.618 | 0.614 | 0.709 |
| Long random query padding | 0.962 | 0.974 | 0.965 |
| Trusted-domain subdomain prefix | 0.995 | 0.999 | 1.000 |
| Leetspeak host substitution | 0.753 | 0.578 | 0.895 |
| Benign-looking deep path appended | 0.658 | 0.446 | 0.575 |
| Percent-encoded path | 0.592 | 0.579 | 0.685 |

Most of these edits make a URL look more suspicious, so recall rises. The real weakness is the **benign-looking deep path**, which lowers
the recall of the character-based models. This matches a path-length bias in the legitimate data (see Limitations).

Class imbalance (joint network): PR-AUC 0.957 at the natural 37% phishing share, 0.813 at 5% and 0.684 at 1%;
precision falls to 0.371 at 1% prevalence while recall stays near 0.72. Real browsing has far fewer phishing URLs than the test set.

## On-device deployment

The extension (`extension/`) scores every main-frame navigation locally and redirects flagged pages to a warning page.
Details, install steps and the test suite are in [`extension/README.md`](extension/README.md).

Measured in Chrome 156 on an 8-core MacBook (500 URLs, single run, repeated twice with the same result):

| Metric | Value |
|---|---|
| Model file | 481 KB (plus an 11 MB shared WebAssembly runtime) |
| Model load, once per browser start | 73 ms |
| Preprocessing + inference per URL | mean 1.09 ms, p95 1.2 ms, p99 1.2 ms |
| Extension round trip (service worker to offscreen document and back) | mean 1.72 ms, p95 1.9 ms |
| Same model as an HTTP API on localhost (native ONNX Runtime) | mean 1.01 ms, p95 1.2 ms |
| Memory footprint in Chrome Task Manager (extension process) | 82.3 MB |

On localhost the API is slightly faster than the extension, and it contains no network delay (a lower bound for any real server).
Local inference is therefore justified by **privacy** (no URL leaves the device), **independence from a server and from network failures**,
and no server cost, not by raw latency.

Verification: JavaScript and Python features agree on 2,000 held-out URLs (0 mismatches) and on 196 edge cases (0 mismatches);
ONNX probabilities agree within 4.5e-7 with 0 decision flips; an end-to-end browser test passes in Chromium.

## Repository layout

| Path | Content |
|---|---|
| `notebooks/project.ipynb` | Data collection, EDA, splits, models, ablation, robustness, ONNX export |
| `src/features.py` | Python feature extractor used in training |
| `extension/` | Chrome extension (Manifest V3, ONNX Runtime Web) |
| `server/` | Same model as an HTTP API for the latency comparison |
| `tests/` | Parity, edge-case and browser end-to-end tests |
| `results/` | Benchmark output and screenshots |

## Limitations

- The legitimate URLs come from homepage links, so their paths are longer than the phishing paths (single-feature AUC of path length 0.745).
  Bare-domain URLs were balanced across classes and path features were not removed. A second legitimate source would remove this bias.
- Legitimate URLs have no timestamps, so the chronological split is time-ordered for phishing URLs only.
- Only the URL string is analysed; there are no page content, certificate or WHOIS features.
- Results come from a single dataset, a single data collection window and one validation-selected threshold.
- Manifest V3 cannot block a navigation synchronously; the warning page replaces the tab a few milliseconds after the navigation starts.
- Performance numbers are from one machine and one run per measurement.

## Reproducibility

The notebook rebuilds the data and produces the reported splits, models, robustness experiments and ONNX export.
Open `notebooks/project.ipynb` in Colab or Jupyter and run its cells in order. The source data is not committed.

Install the JavaScript dependencies and run the parity and edge-case checks with:

```bash
npm install
npm run test:parity
npm run test:edge
```

For the browser test, install the Playwright browser and run:

```bash
npx playwright install chromium
npm run test:e2e
```

The extension benchmark is run manually from `chrome-extension://<extension-id>/benchmark.html`; append
`?api=http://127.0.0.1:8787/score` when comparing with the local HTTP API.

## Screenshots

![Popup](results/screenshots/popup.png)

![Warning page](results/screenshots/warning.png)