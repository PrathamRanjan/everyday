import { act, EverydayError, getJson, openOnSite, settings } from "./lib/api.js";
import { readPage } from "./lib/page.js";

// Everything shown here that came from the shop's page is set as text, never as HTML.
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
};
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const shown = (n, cur) => (cur && cur !== "USD" ? `${cur} ${n.toFixed(2)}` : `$${n.toFixed(2)}`);
const main = document.getElementById("main");
const setMain = (...kids) => {
  main.replaceChildren(...kids);
  main.setAttribute("aria-busy", "false");
};

document.getElementById("open").addEventListener("click", () => void openOnSite("/today"));
document.getElementById("settings").addEventListener("click", () => void chrome.runtime.openOptionsPage());

/** The sentence Everyday will plan from. It names the kind of thing when the page says it, so the reader can quote it. */
function sentenceFor(page) {
  const p = page.product;
  if (!p) return "";
  const kind = p.category ? ` (${p.category.split(/[>/|]/).pop().trim().toLowerCase()})` : "";
  const under = p.price && (!p.currency || p.currency === "USD") ? `, under $${Math.ceil(p.price)}` : "";
  return `Something like the ${p.name}${kind}${under}`;
}

async function currentPage() {
  // ?tab=<id> opens the popup as a page about a given tab (used by the end-to-end test).
  const forced = Number(new URLSearchParams(location.search).get("tab"));
  const [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || "")) return { tab, page: null, why: "Open a shop's page to save or check it." };
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
    return { tab, page: res?.result ?? null, why: null };
  } catch {
    return { tab, page: null, why: "Chrome doesn't let extensions read this page." };
  }
}

async function screenshotOf(tab) {
  try {
    const url = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
    return await (await fetch(url)).blob();
  } catch {
    return null;
  }
}

function errorCard(e) {
  const signin = e instanceof EverydayError && e.code === "signin";
  return h(
    "div",
    { class: "card error", role: "alert" },
    h("p", { style: "margin:0" }, e.message || "Something went wrong."),
    signin &&
      h(
        "div",
        { class: "actions" },
        h("button", { type: "button", class: "btn", onclick: () => void openOnSite("/login") }, "Sign in to Everyday"),
        h("button", { type: "button", class: "btn secondary", onclick: () => void chrome.runtime.openOptionsPage() }, "Use a device key instead"),
      ),
  );
}

function busy(btn, label) {
  btn.disabled = true;
  btn.dataset.label = btn.textContent;
  btn.textContent = label;
  return () => {
    btn.disabled = false;
    btn.textContent = btn.dataset.label;
  };
}

function productCard(page, tab) {
  const p = page.product;
  const text = h("textarea", { id: "ask", "aria-describedby": "ask-help", placeholder: "For example: a quiet mouse under $45 by Thursday" }, sentenceFor(page));
  const status = h("p", { class: "note", role: "status", "aria-live": "polite" });
  const plan = h("button", { type: "button", class: "btn" }, "Plan it with Everyday");
  const save = h("button", { type: "button", class: "btn secondary" }, "Save to Find (reads a screenshot)");
  const sync = () => (plan.disabled = !text.value.trim());
  text.addEventListener("input", sync);
  sync();

  plan.addEventListener("click", async () => {
    const done = busy(plan, "Planning…");
    try {
      const out = await act("/plans", new URLSearchParams({ text: text.value.trim() }));
      await openOnSite(out.to);
      window.close();
    } catch (e) {
      status.textContent = e.message;
      done();
    }
  });
  save.addEventListener("click", async () => {
    const done = busy(save, "Saving…");
    try {
      const form = new FormData();
      form.append("url", page.url);
      form.append("text", [p?.name || page.title, p?.price ? `seen at ${shown(p.price, p.currency)} on ${page.site}` : `on ${page.site}`].join(", "));
      const shot = await screenshotOf(tab);
      if (shot) form.append("shot", shot, "page.jpg");
      const out = await act("/discover/capture", form);
      await openOnSite(out.to);
      window.close();
    } catch (e) {
      status.textContent = e.message;
      done();
    }
  });

  return h(
    "section",
    { class: "card", "aria-labelledby": "on-page" },
    h("h2", { id: "on-page" }, "On this page"),
    p
      ? h(
          "div",
          { class: "product" },
          p.image ? h("img", { src: p.image, alt: "", referrerpolicy: "no-referrer", onerror: (e) => e.target.replaceWith(h("span", { class: "noimg" })) }) : h("span", { class: "noimg" }),
          h("div", {}, h("div", { class: "name" }, p.name), h("p", { class: "muted" }, [p.brand, p.price ? `${shown(p.price, p.currency)} on ${page.site}` : page.site].filter(Boolean).join(" · ")), h("p", { class: "muted" }, `Read from the page's ${p.source} data`)),
        )
      : h("p", { class: "muted" }, `No product details on ${page.site}. Describe what you want and Everyday plans it.`),
    h("label", { for: "ask" }, "What should Everyday find?"),
    text,
    h("p", { class: "note", id: "ask-help" }, "Everyday reads your words; code applies your budget, dates and rules. Nothing is bought until you approve on PayPal."),
    h("div", { class: "actions" }, plan, save),
    status,
  );
}

function monthCard(today) {
  const sp = today.spending;
  const used = sp.limit_cents ? Math.min(100, Math.round(((sp.spent_cents + sp.reserved_cents) / sp.limit_cents) * 100)) : 0;
  const soon = today.soon?.[0];
  return h(
    "section",
    { class: "card", "aria-labelledby": "month" },
    h("h2", { id: "month" }, "Your month"),
    h("div", { class: "bar", role: "img", "aria-label": `${used}% of your monthly limit used` }, h("span", { style: `width:${used}%` })),
    h("dl", { class: "kv" }, h("dt", {}, "Left this month"), h("dd", {}, money(sp.left_cents)), h("dt", {}, "Monthly limit"), h("dd", {}, money(sp.limit_cents))),
    soon && h("p", { class: "note" }, `Next return window to close: ${soon.title}, ${soon.return_until}.`),
    today.held?.length ? h("p", { class: "note" }, `${today.held.length} approval${today.held.length === 1 ? "" : "s"} waiting for you in Everyday.`) : null,
  );
}

/** Code compares the basket total the page shows with your own limits. It is a check, not a block. */
function checkoutCard(page, today, guard) {
  const c = page.checkout;
  const sp = today.spending;
  const maxOne = guard?.rules?.find((r) => r.key === "max_purchase_cents")?.value ?? null;
  let tone = "wait";
  let head = "Couldn't find the basket total on this page.";
  let detail = "Everyday only reads what the page shows.";
  if (guard?.kill?.engaged) {
    tone = "now";
    head = "Your kill switch is on.";
    detail = "Everyday won't start any payment until you release it under Rules.";
  } else if (c.total && c.currency && c.currency !== "USD") {
    head = `Basket: ${c.currency} ${c.total.toFixed(2)}.`;
    detail = "Your limits are in US dollars, so there's nothing to compare without a conversion.";
  } else if (c.total) {
    const cents = Math.round(c.total * 100);
    if (cents > sp.left_cents) {
      tone = "now";
      head = `Over your monthly limit by ${money(cents - sp.left_cents)}.`;
      detail = `This basket is ${money(cents)}; you have ${money(sp.left_cents)} left of ${money(sp.limit_cents)} this month.`;
    } else if (maxOne !== null && cents > maxOne) {
      tone = "now";
      head = `Above your largest single purchase (${money(maxOne)}).`;
      detail = `This basket is ${money(cents)}. Your rule says anything bigger needs a second look.`;
    } else {
      tone = "done";
      head = "Within your limits.";
      detail = `${money(cents)} leaves ${money(sp.left_cents - cents)} of this month's ${money(sp.limit_cents)}.`;
    }
  }
  return h(
    "section",
    { class: "card", "aria-labelledby": "check" },
    h("h2", { id: "check" }, "Checkout check"),
    h("div", { class: `verdict ${tone}`, role: "status" }, head, h("p", {}, detail)),
    c.text && h("p", { class: "note" }, `Read from the page: “${c.text}”.`),
    h("p", { class: "note" }, "Everyday doesn't pay on other shops. This compares the page's total with your own rules."),
  );
}

async function start() {
  const who = document.getElementById("who");
  const ribbon = document.getElementById("ribbon");
  const { key } = await settings();
  const [{ tab, page, why }, session] = await Promise.all([currentPage(), getJson("/api/ui/session").catch((e) => e)]);
  if (session instanceof Error) {
    who.textContent = "Not connected";
    return setMain(errorCard(session));
  }
  if (session.demo) {
    ribbon.hidden = false;
    ribbon.textContent = `Demo · PayPal ${session.paypal_env}, test money only`;
  }
  if (session.who?.kind !== "shopper") {
    who.textContent = "Not signed in";
    return setMain(errorCard(new EverydayError(session.who?.kind === "merchant" ? "You're signed in to Everyday as the shop. Sign in as a shopper." : "Sign in to Everyday first.", "signin")));
  }
  who.textContent = `${session.who.first} · ${key ? "device key" : "signed in"}`;
  const [today, guard] = await Promise.all([getJson("/api/ui/today"), getJson("/api/ui/guard").catch(() => null)]).catch((e) => [e, null]);
  if (today instanceof Error) return setMain(errorCard(today));
  const parts = [];
  if (page?.checkout) parts.push(checkoutCard(page, today, guard));
  if (page) parts.push(productCard(page, tab));
  else parts.push(h("section", { class: "card" }, h("p", { style: "margin:0" }, why)));
  parts.push(monthCard(today));
  setMain(...parts);
  void chrome.runtime.sendMessage({ type: "refresh-badge" }).catch(() => undefined);
}

start().catch((e) => setMain(errorCard(e)));
