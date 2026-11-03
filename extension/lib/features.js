/**
 * JavaScript port of src/features.py (training-time feature extraction).
 *
 * The port reproduces the behaviour of Python's urllib.parse.urlparse and of
 * tldextract (ICANN suffixes only), so that the 67-dimensional feature vector
 * and the character encoding match the Python training pipeline.
 * The module has no browser or Node specific dependencies.
 */

const SCHEME_CHARS = new Set(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-.");
const USES_PARAMS = new Set(["", "ftp", "hdl", "prospero", "http", "imap", "https",
  "shttp", "rtsp", "rtspu", "sip", "sips", "mms", "sftp", "tel"]);
const IPV4_RE = /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;
const IP_PATTERN = /^(\p{Nd}{1,3}\.){3}\p{Nd}{1,3}$/u;
// Python str.isdigit(): decimal digits plus superscript, subscript and circled digits
const DIGIT_RE = /^[\p{Nd}²³¹⁰⁴-⁹₀-₉①-⑨⑴-⑼⒈-⒐⓪⓵-⓽⓿❶-❾➀-➈➊-➒]$/u;
const ALNUM_RE = /^[\p{L}\p{N}]$/u;

const codePoints = (s) => Array.from(s);
const isDigit = (ch) => DIGIT_RE.test(ch);
const isAlnum = (ch) => ALNUM_RE.test(ch);
const count = (s, ch) => s.split(ch).length - 1;

// ---------------------------------------------------------------- urlparse
/** Port of urllib.parse.urlparse (Python 3.13): returns scheme, netloc, path, query. */
export function pyUrlparse(input) {
  let url = input.replace(/^[\u0000- ]+/, "").replace(/[\t\r\n]/g, "");
  let scheme = "";
  const colon = url.indexOf(":");
  if (colon > 0 && /^[A-Za-z]$/.test(url[0]) &&
      [...url.slice(0, colon)].every((c) => SCHEME_CHARS.has(c))) {
    scheme = url.slice(0, colon).toLowerCase();
    url = url.slice(colon + 1);
  }
  let netloc = "";
  if (url.slice(0, 2) === "//") {
    let delim = url.length;
    for (const c of "/?#") {
      const w = url.indexOf(c, 2);
      if (w >= 0) delim = Math.min(delim, w);
    }
    netloc = url.slice(2, delim);
    url = url.slice(delim);
    if ((netloc.includes("[") && !netloc.includes("]")) ||
        (netloc.includes("]") && !netloc.includes("["))) {
      throw new Error("Invalid IPv6 URL");
    }
  }
  const hash = url.indexOf("#");
  if (hash >= 0) url = url.slice(0, hash);
  let query = "";
  const q = url.indexOf("?");
  if (q >= 0) { query = url.slice(q + 1); url = url.slice(0, q); }
  let path = url;
  if (USES_PARAMS.has(scheme) && path.includes(";")) {
    const i = path.includes("/") ? path.indexOf(";", path.lastIndexOf("/")) : path.indexOf(";");
    if (i >= 0) path = path.slice(0, i);
  }
  return { scheme, netloc, path, query };
}

// -------------------------------------------------------------- tldextract
function punycodeDecode(input) {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
  let n = 128, i = 0, bias = 72;
  const out = [];
  let basic = input.lastIndexOf("-");
  if (basic < 0) basic = 0;
  for (let j = 0; j < basic; j++) out.push(input.charCodeAt(j));
  const adapt = (delta, numPoints, first) => {
    delta = first ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) { delta = Math.floor(delta / (base - tMin)); k += base; }
    return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
  };
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
    const oldi = i;
    for (let w = 1, k = base; ; k += base) {
      if (idx >= input.length) throw new Error("bad punycode");
      const c = input.charCodeAt(idx++);
      const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
      if (digit >= base) throw new Error("bad punycode");
      i += digit * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < t) break;
      w *= base - t;
    }
    const len = out.length + 1;
    bias = adapt(i - oldi, len, oldi === 0);
    n += Math.floor(i / len);
    i %= len;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

function decodeLabel(label) {
  const lowered = label.toLowerCase();
  if (lowered.startsWith("xn--")) {
    try { return punycodeDecode(lowered.slice(4)); } catch (e) { /* keep ASCII form */ }
  }
  return lowered;
}

function buildTrie(rules) {
  const root = { m: new Map(), end: false };
  for (const rule of rules) {
    let node = root;
    for (const label of rule.split(".").reverse()) {
      if (!node.m.has(label)) node.m.set(label, { m: new Map(), end: false });
      node = node.m.get(label);
    }
    node.end = true;
  }
  return root;
}

function schemelessUrl(url) {
  const d = url.indexOf("//");
  if (d === 0) return url.slice(2);
  if (d < 2 || url[d - 1] !== ":" || [...url.slice(0, d - 1)].some((c) => !SCHEME_CHARS.has(c))) return url;
  return url.slice(d + 2);
}

function lenientNetloc(url) {
  const authority = schemelessUrl(url).split("/")[0].split("?")[0].split("#")[0];
  const at = authority.lastIndexOf("@");
  const afterUserinfo = at >= 0 ? authority.slice(at + 1) : authority;
  if (afterUserinfo && afterUserinfo[0] === "[") {
    const close = afterUserinfo.indexOf("]");
    if (close >= 0) return afterUserinfo.slice(0, close + 1);
  }
  const hostname = afterUserinfo.split(":")[0].trim();
  return hostname.replace(/[.。．｡]+$/, "");
}

function suffixIndex(trie, labels) {
  let node = trie;
  let suffixIdx = labels.length, labelIdx = labels.length;
  for (let k = labels.length - 1; k >= 0; k--) {
    const decoded = decodeLabel(labels[k]);
    if (node.m.has(decoded)) {
      labelIdx -= 1;
      node = node.m.get(decoded);
      if (node.end) suffixIdx = labelIdx;
      continue;
    }
    if (node.m.has("*")) return node.m.has("!" + decoded) ? labelIdx : labelIdx - 1;
    break;
  }
  return suffixIdx === labels.length ? null : suffixIdx;
}

function looksLikeIpv6(s) {
  if (!/^[0-9a-fA-F:.]+$/.test(s) || !s.includes(":")) return false;
  return s.split("::").length <= 2;
}

/** Port of tldextract.extract (ICANN suffixes only). */
function tldExtract(trie, url) {
  const netloc = lenientNetloc(url)
    .replace(/。/g, ".").replace(/．/g, ".").replace(/｡/g, ".");
  if (netloc.length >= 4 && netloc[0] === "[" && netloc[netloc.length - 1] === "]" &&
      looksLikeIpv6(netloc.slice(1, -1))) {
    return { subdomain: "", domain: netloc, suffix: "" };
  }
  const labels = netloc.split(".");
  const idx = suffixIndex(trie, labels);
  if (idx === null) {
    if (labels.length === 4 && netloc && /[0-9]/.test(netloc[0]) && IPV4_RE.test(netloc)) {
      return { subdomain: "", domain: netloc, suffix: "" };
    }
    return { subdomain: labels.slice(0, -1).join("."), domain: labels[labels.length - 1], suffix: "" };
  }
  return {
    subdomain: idx >= 2 ? labels.slice(0, idx - 1).join(".") : "",
    domain: idx > 0 ? labels[idx - 1] : "",
    suffix: labels.slice(idx).join("."),
  };
}

// ---------------------------------------------------------------- features
function shannonEntropy(text) {
  const chars = codePoints(text);
  if (chars.length === 0) return 0;
  const counts = new Map();
  for (const c of chars) counts.set(c, (counts.get(c) || 0) + 1);
  const n = chars.length;
  let total = 0;
  for (const v of counts.values()) total += (v / n) * Math.log2(v / n);
  return -total;
}

/**
 * Create a feature extractor and encoder bound to the exported preprocessing assets.
 * @param {object} preprocess contents of preprocess.json
 * @param {string[]} pslRules ICANN public suffix rules (psl_icann.json)
 */
export function createPreprocessor(preprocess, pslRules) {
  const trie = buildTrie(pslRules);
  const { keywords, brands } = preprocess;
  const columns = preprocess.feature_columns;
  const tldColumns = new Set(preprocess.tld_columns);
  const knownTlds = new Set(preprocess.tld_columns.filter((c) => c !== "tld_other").map((c) => c.slice(4)));
  const charToId = new Map(codePoints(preprocess.chars).map((c, i) => [c, i + 2]));

  /** Lexical features of a URL string (same names as src/features.py). */
  function extractFeatures(url) {
    const parsed = pyUrlparse(url.includes("://") ? url : "http://" + url);
    const host = parsed.netloc.toLowerCase().split("@").pop();
    const hostname = host.split(":")[0];
    const ext = tldExtract(trie, url);
    const { path, query } = parsed;
    const lower = url.toLowerCase();
    const registered = ext.domain.toLowerCase();
    const outside = (ext.subdomain + "/" + path).toLowerCase();
    const chars = codePoints(url);
    const nDigits = chars.filter(isDigit).length;
    return {
      url_len: chars.length,
      host_len: codePoints(hostname).length,
      path_len: codePoints(path).length,
      query_len: codePoints(query).length,
      n_dots: count(url, "."),
      n_hyphens: count(url, "-"),
      n_underscores: count(url, "_"),
      n_slashes: count(url, "/"),
      n_digits: nDigits,
      digit_ratio: nDigits / chars.length,
      n_special: chars.filter((c) => !isAlnum(c)).length,
      n_params: count(query, "&") + (query ? 1 : 0),
      has_at: +url.includes("@"),
      has_port: +host.includes(":"),
      has_ip_host: +IP_PATTERN.test(hostname),
      is_https: +(parsed.scheme === "https"),
      has_punycode: +lower.includes("xn--"),
      subdomain_depth: ext.subdomain.split(".").filter(Boolean).length,
      path_depth: path.split("/").filter(Boolean).length,
      tld_len: codePoints(ext.suffix).length,
      domain_entropy: shannonEntropy(registered),
      url_entropy: shannonEntropy(lower),
      digits_in_domain: codePoints(registered).filter(isDigit).length,
      n_keywords: keywords.filter((k) => lower.includes(k)).length,
      brand_mismatch: +brands.some((b) => outside.includes(b) && !registered.includes(b)),
      brand_in_domain: +brands.some((b) => registered.includes(b) && b !== registered),
      tld: ext.suffix || "none",
    };
  }

  /** Raw (unscaled) 67-dimensional feature vector in training column order. */
  function featureVector(url) {
    const f = extractFeatures(url);
    const tld = knownTlds.has(f.tld) ? f.tld : "other";
    return columns.map((c) => (tldColumns.has(c) && c !== "tld_len" ? +(c === "tld_" + tld) : f[c]));
  }

  /** log1p + standardisation with the training statistics (model input). */
  function scaledFeatures(url) {
    const raw = featureVector(url);
    const out = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      out[i] = (Math.fround(Math.log1p(raw[i])) - preprocess.scaler_mean[i]) / preprocess.scaler_scale[i];
    }
    return out;
  }

  /** Character ids (0 = padding, 1 = unknown); scheme removed, truncated to max_len. */
  function encode(url) {
    const s = codePoints(url.replace(/^https?:\/\//, "")).slice(0, preprocess.max_len);
    const ids = new BigInt64Array(preprocess.max_len);
    s.forEach((c, i) => { ids[i] = BigInt(charToId.get(c) ?? 1); });
    return ids;
  }

  return { extractFeatures, featureVector, scaledFeatures, encode, threshold: preprocess.threshold };
}
