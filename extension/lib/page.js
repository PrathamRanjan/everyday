// Runs inside the shop's page (chrome.scripting, only after the person opens the popup there). It only reads:
// the product the page describes (schema.org JSON-LD, then Open Graph tags) and, on a cart or checkout page, the
// total it shows. It must be self-contained: Chrome serialises this function into the page.

export function readPage() {
  const clean = (s, n = 160) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const num = (v) => {
    const n = Number(String(v ?? "").replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const meta = (name) => document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute("content") ?? null;
  const SYMBOL = { $: "USD", "US$": "USD", "S$": "SGD", "€": "EUR", "£": "GBP", "¥": "JPY", "A$": "AUD" };

  // schema.org Product, wherever it sits (@graph, arrays, nested).
  const products = [];
  const walk = (x) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(walk);
    const t = x["@type"];
    if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) products.push(x);
    if (x["@graph"]) walk(x["@graph"]);
  };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      walk(JSON.parse(s.textContent || ""));
    } catch {
      /* a broken block on the page; skip it */
    }
  }
  let product = null;
  const p = products[0];
  if (p) {
    const offer = [p.offers].flat().filter(Boolean)[0] || {};
    const image = [p.image].flat().filter(Boolean)[0];
    product = {
      name: clean(p.name, 140),
      brand: clean(typeof p.brand === "object" ? p.brand?.name : p.brand, 60) || null,
      category: clean(p.category, 60) || null,
      image: typeof image === "object" ? image?.url ?? null : image ?? null,
      price: num(offer.price ?? offer.lowPrice),
      currency: offer.priceCurrency || null,
      source: "schema.org",
    };
  } else if ((meta("og:type") || "").startsWith("product") || meta("product:price:amount")) {
    product = {
      name: clean(meta("og:title") || document.title, 140),
      brand: clean(meta("product:brand"), 60) || null,
      category: null,
      image: meta("og:image"),
      price: num(meta("product:price:amount")),
      currency: meta("product:price:currency"),
      source: "Open Graph",
    };
  }
  if (product && !product.name) product = null;
  if (product?.image) {
    try {
      product.image = new URL(product.image, location.href).href;
    } catch {
      product.image = null;
    }
  }

  // A cart or checkout page: the last "total" with an amount next to it is usually the grand total.
  let checkout = null;
  if (/(cart|basket|bag|checkout)/i.test(location.pathname + " " + document.title)) {
    const text = (document.body?.innerText || "").slice(0, 60000);
    const re = /(order total|grand total|estimated total|total)[^\n\d$€£¥]{0,24}(US\$|S\$|A\$|\$|€|£|¥)\s?(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/gi;
    let m;
    let last = null;
    while ((m = re.exec(text))) last = m;
    if (last) checkout = { label: clean(last[1], 30), total: num(last[3]), currency: SYMBOL[last[2]] || null, text: clean(last[0], 80) };
    else checkout = { label: null, total: null, currency: null, text: null };
  }

  return { url: location.href, site: location.hostname.replace(/^www\./, ""), title: clean(document.title, 140), product, checkout };
}
