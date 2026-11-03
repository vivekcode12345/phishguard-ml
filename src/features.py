"""Lexical URL features shared by training, robustness tests and the JavaScript port."""

import math
import re
from collections import Counter
from urllib.parse import urlparse

import tldextract

KEYWORDS = ("login", "signin", "verify", "secure", "account", "update",
            "confirm", "password", "bank", "wallet", "support", "billing")
BRANDS = ("paypal", "google", "apple", "microsoft", "amazon", "facebook", "netflix",
          "instagram", "whatsapp", "dhl", "fedex", "chase", "wellsfargo", "dropbox",
          "linkedin", "outlook", "office365", "adobe", "binance", "coinbase",
          "metamask", "usps")
IP_PATTERN = re.compile(r"^(\d{1,3}\.){3}\d{1,3}$")


def shannon_entropy(text):
    """Shannon entropy (bits per character) of a string."""
    if not text:
        return 0.0
    n = len(text)
    return -sum((c / n) * math.log2(c / n) for c in Counter(text).values())


def extract_features(url):
    """Compute lexical features from the URL string only (no network access)."""
    parsed = urlparse(url if "://" in url else "http://" + url)
    host = parsed.netloc.lower().split("@")[-1]
    hostname = host.split(":")[0]
    ext = tldextract.extract(url)
    path, query = parsed.path, parsed.query
    lower = url.lower()
    registered = ext.domain.lower()
    outside = (ext.subdomain + "/" + path).lower()

    return {
        "url_len": len(url),
        "host_len": len(hostname),
        "path_len": len(path),
        "query_len": len(query),
        "n_dots": url.count("."),
        "n_hyphens": url.count("-"),
        "n_underscores": url.count("_"),
        "n_slashes": url.count("/"),
        "n_digits": sum(ch.isdigit() for ch in url),
        "digit_ratio": sum(ch.isdigit() for ch in url) / len(url),
        "n_special": sum(not ch.isalnum() for ch in url),
        "n_params": query.count("&") + (1 if query else 0),
        "has_at": int("@" in url),
        "has_port": int(":" in host),
        "has_ip_host": int(bool(IP_PATTERN.match(hostname))),
        "is_https": int(parsed.scheme == "https"),
        "has_punycode": int("xn--" in lower),
        "subdomain_depth": len([s for s in ext.subdomain.split(".") if s]),
        "path_depth": len([s for s in path.split("/") if s]),
        "tld_len": len(ext.suffix),
        "domain_entropy": shannon_entropy(registered),
        "url_entropy": shannon_entropy(lower),
        "digits_in_domain": sum(ch.isdigit() for ch in registered),
        "n_keywords": sum(k in lower for k in KEYWORDS),
        "brand_mismatch": int(any(b in outside and b not in registered for b in BRANDS)),
        "brand_in_domain": int(any(b in registered and b != registered for b in BRANDS)),
        "tld": ext.suffix or "none",
        "is_bare": int(path in ("", "/") and not query),
    }
