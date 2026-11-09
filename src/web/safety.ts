/**
 * Scam and fraud protection for shoppers (SAFETY_ACCESSIBILITY_SPEC §4, §6 Everyday row): check a seller or marketplace
 * message (rules on the server, the fine-tuned text model in this browser), see inbound messages with their scan,
 * see holds the safety layer created and why, and switch protected mode on for a first payment to any new seller.
 */
import { Router } from "express";
import { getDb } from "../db.js";
import { GtError } from "../lib/util.js";
import { assessMessage, protectedMode, safetyHolds, setProtectedMode } from "../safety/index.js";
import { scanText, TACTIC_WORDS, TACTICS } from "../safety/rules.js";
import { fmtWall } from "../core/time.js";
import { nowOf, type Account } from "../store.js";
import { shopper } from "./auth.js";
import { back, flashOf, json } from "./common.js";
import { html, layout, money, pill, raw, type Raw } from "./html.js";

const page = (req: Parameters<typeof flashOf>[0], a: Account, title: string, body: Raw) => layout({ title, area: "shopper", who: { name: a.name, clock: fmtWall(nowOf(a)) }, flash: flashOf(req) }, body);

/** The marketplace message the demo button pastes: an off-platform, overpayment-refund scam aimed at a shopper. */
export const DEMO_SCAM = "Hi! I saw you want the oak lamp. I can do it for $40 instead of $59 but PayPal takes a big fee, so please pay me directly by bank transfer or send a gift card code on WhatsApp. If you already paid, I was sent too much, refund me the difference today and I ship tonight. Here is the tracking: http://bit.ly/lamp-track";

export function safetyRoutes() {
  const r = Router();

  r.get("/safety", shopper(async (req, res, a) => {
    const db = await getDb();
    const inbox = (await db.query<any>("SELECT * FROM inbox WHERE account_id = $1 ORDER BY id DESC LIMIT 20", [a.id])).rows;
    const holds = await safetyHolds(a.id);
    const prot = await protectedMode(a.id);
    const sellers = (await db.query<any>("SELECT m.name, m.kind, count(o.id)::int AS paid FROM merchants m LEFT JOIN orders o ON o.merchant_id = m.id AND o.account_id = $1 AND o.status NOT IN ('created','cancelled') GROUP BY m.id ORDER BY m.name", [a.id])).rows;
    res.send(page(req, a, "Scam and fraud protection", html`<h1>Scam and fraud protection</h1>
<p class="muted">Rules in code, a scam text model that runs in your browser, and a payment-risk model. Strictest wins; none of them can approve a payment. Anything held waits for you on <a href="/guard">Guard</a>. <a href="/safety/model-card">How it was tested</a>.</p>
<section class="card" id="check"><h2>Check a message</h2><p class="sub muted">Paste a seller's reply, a marketplace message or a text about a parcel. The model scores it on this device; the words never leave your browser for the score.</p>
<form id="scan-form" class="stack"><label for="scan-text" class="sr">Message to check</label><textarea id="scan-text" name="text" rows="6" placeholder="Paste the message here" style="width:100%"></textarea>
<div class="row"><button class="btn primary" type="submit" id="scan-btn">Check this message</button><button class="btn" type="button" id="scan-demo">Paste the demo scam</button><span class="small muted" id="scan-status" aria-live="polite"></span></div></form>
<div id="scan-result" aria-live="polite"></div>
${raw(`<script type="application/json" id="demo-bec">${JSON.stringify({ text: DEMO_SCAM }).replace(/</g, "\\u003c")}</script>`)}</section>
<section class="card" id="inbox"><h2>Messages you received</h2>${inbox.length ? html`<ul class="stack">${inbox.map((m) => { const s = scanText(m.text); return html`<li>${s.fired.length ? html`<div class="banner ${["changed_details", "off_platform", "gift_cards_crypto", "fee_to_release", "overpay_refund"].some((t) => s.fired.includes(t as any)) ? "bad" : "warn"}" role="alert"><b>Scam check:</b> this message ${s.fired.map((t) => TACTIC_WORDS[t]).join(", and ")}. Everyday only pays through PayPal checkout; nothing in a message changes that.</div>` : ""}<span class="small muted">${m.channel}</span> ${m.text}</li>`; })}</ul>` : html`<p class="muted">No messages yet.</p>`}</section>
<section class="card" id="sellers"><h2>Sellers</h2><p class="sub muted">A first payment to a seller found on the open web is a caution; with protected mode on it waits for your approval.</p><div class="table-wrap"><table><thead><tr><th>Seller</th><th>Kind</th><th class="num">Paid orders</th></tr></thead><tbody>${sellers.map((s) => html`<tr><td>${s.name}</td><td>${s.kind === "discovery" ? pill("pending", "found on the web") : pill("paid", "test merchant")}</td><td class="num">${s.paid}</td></tr>`)}</tbody></table></div></section>
<section class="card" id="holds"><h2>Holds the safety layer created</h2>${holds.length ? html`<ul class="stack">${holds.map((h) => html`<li><div class="spread"><b>${h.action.replace("_", " ")} ${money(Number(h.payload.cents ?? 0))}</b> ${pill(h.status === "approved" ? "succeeded" : h.status === "declined" ? "declined" : h.status, h.status)}</div>${h.payload.safety_reasons?.length ? html`<details class="small"><summary>Why we paused this</summary><ul>${h.payload.safety_reasons.map((x: string) => html`<li>${x}</li>`)}</ul></details>` : ""}</li>`)}</ul>` : html`<p class="muted">None yet.</p>`}</section>
<section class="card" id="protected"><h2>Protected mode ${prot.on ? pill("paid", "on") : pill("stale", "off")}</h2><p class="sub muted">For anyone who wants a second pair of eyes: the first payment to any new seller waits for approval, holds are explained calmly with no timers, and a trusted contact is told about every hold.</p>
<form method="post" action="/safety/protected" class="stack"><label for="pc1">Trusted contact (Telegram chat id, optional)</label><input id="pc1" name="contact1" value="${prot.contacts[0] ?? ""}" placeholder="telegram:123456789"><label for="pc2">Second contact</label><input id="pc2" name="contact2" value="${prot.contacts[1] ?? ""}"><div class="row"><button class="btn primary" type="submit" name="on" value="${prot.on ? "0" : "1"}">${prot.on ? "Turn protected mode off" : "Turn protected mode on"}</button></div></form></section>
<section class="card" id="a11y"><h2>Accessibility</h2><p class="sub muted">Text size, contrast, a clearer font, read-aloud, voice input, plain words, bigger buttons and more time: open <button class="btn small" type="button" data-a11y-open>Display and help</button> on any page. Your choices stay on this device.</p></section>
<script src="https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.22.0/ort.min.js"></script><script type="module" src="/static/safety.js"></script>`));
  }));

  r.get("/safety/model-card", shopper(async (req, res, a) => {
    res.send(page(req, a, "How the scam check was tested", html`<h1>How the scam check was tested</h1>
<p class="muted">Numbers come from frozen test sets the model never trained on. Everything synthetic is marked. Full card in the repository at <span class="mono">guard-lab/MODEL_CARD.md</span>.</p>
<section class="card"><h2>Text model (runs in your browser, 23 MB)</h2><div class="table-wrap"><table><thead><tr><th>Test set</th><th class="num">Messages</th><th class="num">AUC</th><th class="num">Caught at 1% genuine held</th><th>What it is</th></tr></thead><tbody>
<tr><td>ScamShield SMS test</td><td class="num">8,188</td><td class="num">0.988</td><td class="num">75%</td><td>real Singapore SMS, in-distribution</td></tr>
<tr><td>ScamShield eval sets</td><td class="num">1,574</td><td class="num">0.979</td><td class="num">67%</td><td>real and hand-written</td></tr>
<tr><td>Singlish genuine</td><td class="num">600</td><td class="num">—</td><td class="num">1.0% held</td><td>real everyday messages: the false-alarm check</td></tr>
<tr><td>Business templates</td><td class="num">200</td><td class="num">0.85</td><td class="num">11%</td><td>author-written, held-out templates</td></tr>
<tr><td>Business email (BEC) seed</td><td class="num">200</td><td class="num">0.58</td><td class="num">25%</td><td>hand-written; the model is weak here</td></tr>
</tbody></table></div><p class="small muted">Browser and Python agree on the hold decision for 197 of 200 messages; the three differ because int8 arithmetic differs between runtimes.</p></section>
<section class="card"><h2>Payment-risk model</h2><p>LightGBM, 300 trees, monotone: a scam signal can only raise the score. <b>Trained on synthetic data</b>; there is no real payment-fraud data in this project. Its score is a ranking signal shown with the rule reasons, never a fraud rate.</p></section>
<section class="card"><h2>Tactics the model names</h2><ul>${TACTICS.map((t) => html`<li><b>${t.replace(/_/g, " ")}</b>: ${TACTIC_WORDS[t]}</li>`)}</ul></section>`));
  }));

  r.post("/safety/scan", json(async (req) => {
    const text = String(req.body?.text ?? "").slice(0, 4000);
    if (!text.trim()) throw new GtError("Paste a message first.", "bad_request", 400);
    return assessMessage(text);
  }));

  r.post("/safety/protected", shopper(async (req, res, a) => {
    const on = String(req.body.on) === "1";
    await setProtectedMode(a.id, on, [String(req.body.contact1 ?? "").trim(), String(req.body.contact2 ?? "").trim()]);
    back(res, "/safety#protected", on ? "Protected mode is on." : "Protected mode is off.");
  }, true));

  return r;
}
