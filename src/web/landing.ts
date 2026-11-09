/** The public front door: what Everyday does for a shopper, how it keeps money safe, and a persona picker. */
import type { Request, Response } from "express";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { flashOf } from "./common.js";
import { html, layout, raw } from "./html.js";
import { icon } from "./icons.js";

const ic = (n: string) => raw(icon(n));

export async function landing(req: Request, res: Response) {
  const db = await getDb();
  const accounts = config.demoMode ? (await db.query<any>("SELECT id, name FROM accounts ORDER BY name").catch(() => ({ rows: [] as any[] }))).rows : [];
  const merchants = config.demoMode ? (await db.query<any>("SELECT id, name FROM merchants WHERE kind = 'test_merchant' ORDER BY name").catch(() => ({ rows: [] as any[] }))).rows : [];
  const as = (v: string, label: string, cls = "primary") => html`<form method="post" action="/login" class="inline"><input type="hidden" name="as" value="${v}"><button class="btn ${cls}" type="submit">${label} ${ic("arrowRight")}</button></form>`;
  const maya = accounts[0];
  res.send(layout({ title: "a personal shopper that knows when not to buy", area: "public", site: true, flash: flashOf(req) }, html`
<section class="lp-hero"><div class="wrap lp-split">
  <div>
    <span class="lp-eyebrow"><b>For shoppers</b> From a saved Reel to a delivered setup</span>
    <h1 class="lp-title">Saw it on a Reel? <em>Get it right, once.</em></h1>
    <p class="lp-lead">Share a Reel, a TikTok or a screenshot and say what you need. Everyday plans it around what you already own and your budget, buys with PayPal only when you approve, and keeps helping after delivery: delays, returns, price drops and recalls.</p>
    <div class="lp-cta">${maya ? as(`acc:${maya.id}`, `Try it as ${maya.name}`, "primary lg") : html`<a class="btn primary lg" href="/demo">Load the demo ${ic("arrowRight")}</a>`}<a class="btn lg" href="/judge">3-minute tour</a></div>
    <div class="lp-trust" style="margin-top:1.5rem"><span>${ic("checkCircle")}PayPal sandbox, no real money</span><span>${ic("checkCircle")}Every payment needs your approval</span><span>${ic("checkCircle")}It will tell you not to buy</span></div>
  </div>
  <div class="mock" aria-hidden="true"><div class="mock-bar"><i></i><i></i><i></i><span>Study setup by Friday · $350</span></div><div class="mock-body">
    <div class="mock-row"><span><b>Oak desk lamp</b> · exact match from the Reel</span><span class="amt">$59.00</span></div>
    <div class="mock-row"><span><b>Ergo Mesh Chair</b> · you picked comfort</span><span class="amt">$189.00</span></div>
    <div class="mock-row"><span><b>Monitor</b> · you already own one</span><span class="pill">skipped</span></div>
    <div class="guard-card caution" style="margin:0"><div class="gc-head">${ic("alert")}Chair delayed to Monday</div><p class="gc-do" style="color:inherit">That misses Friday. In stock instead: Ergo Lite, arrives Thursday, $20 back to your PayPal.</p></div>
  </div></div>
</div></section>

<section class="lp-section alt" id="how"><div class="wrap">
  <p class="lp-kicker">How it works</p><h2 class="lp-h2">From “I want this look” to the box at your door.</h2>
  <p class="lp-sub">Every recommendation explains itself, and nothing is paid until you say so on PayPal.</p>
  <ol class="lp-steps">
    <li><h3>Share what you like</h3><p>A Reel, TikTok, Short, product link or screenshot. Pick which item in it you mean.</p></li>
    <li><h3>Say what you need</h3><p>“This setup by Friday for $350. I already own a monitor.” Everyday asks one question if it must.</p></li>
    <li><h3>See a plan, approve it</h3><p>What fits, what doesn't and why, the exact total, then PayPal checkout. The payment is read back from PayPal.</p></li>
    <li><h3>It keeps helping</h3><p>Delays with in-stock swaps, return and warranty windows, price protection and recalls on things you own.</p></li>
  </ol>
</div></section>

<section class="lp-section"><div class="wrap">
  <p class="lp-kicker">What's inside</p><h2 class="lp-h2">The shopping friend who reads the small print.</h2>
  <div class="lp-features" style="margin-top:1.5rem">
    <div class="lp-feature"><span class="ic">${ic("camera")}</span><h3>Understands what you saw</h3><p>Reels and screenshots become items you can pick, matched to the merchant's real catalog.</p></div>
    <div class="lp-feature"><span class="ic">${ic("box")}</span><h3>Knows what you own</h3><p>It won't sell you a second monitor, and it checks a new one fits the arm you have.</p></div>
    <div class="lp-feature"><span class="ic">${ic("wallet")}</span><h3>Respects your limits</h3><p>A monthly limit and your own rules, like “ask me before any repeat buy over $30”.</p></div>
    <div class="lp-feature"><span class="ic">${ic("truck")}</span><h3>Handles the after</h3><p>A delay comes with an in-stock swap; a scuffed lamp becomes a partial refund, confirmed by PayPal.</p></div>
    <div class="lp-feature"><span class="ic">${ic("receipt")}</span><h3>Price protection</h3><p>If the merchant drops the price within its policy, Everyday asks for the difference back.</p></div>
    <div class="lp-feature"><span class="ic">${ic("bot")}</span><h3>Works with your assistant</h3><p>An MCP endpoint lets Claude plan and ask for approval, never pay on its own.</p></div>
  </div>
</div></section>

<section class="lp-section alt" id="safe"><div class="wrap lp-split">
  <div><p class="lp-kicker">Safe shopping</p><h2 class="lp-h2">The best deal on the web is sometimes a scam.</h2>
  <p class="lp-sub">Sellers found on the open web, “pay me directly to skip the fees”, and “I overpaid, refund the difference” are the classic marketplace scams. Everyday is built to slow them down.</p>
  <ul class="stack" style="padding-left:1.1rem;color:var(--ui-muted-fg)"><li>The first payment to a seller found on the web gets a warning; with protected mode on, it waits for you.</li><li>Paste any seller message to check it for scam tactics, scored in your own browser.</li><li>Everyday only pays through PayPal checkout. Nothing in a message changes that.</li></ul></div>
  <div class="stack"><div class="guard-card hold"><div class="gc-head">${ic("shieldAlert")}Paused for your safety</div><ul><li>First payment to a seller found on the open web.</li><li>Their message asks you to pay by bank transfer to skip PayPal's fee.</li></ul><p class="gc-do">Nothing was charged. Check the seller is real before you approve.</p></div>
  <div class="guard-card clear"><div class="gc-head">${ic("shieldCheck")}Checked: no scam signals</div><p class="gc-do">Northlight Supply, a merchant you've paid before, at your usual order size.</p></div></div>
</div></section>

<section class="lp-section" id="access"><div class="wrap">
  <p class="lp-kicker">For everyone</p><h2 class="lp-h2">Make it comfortable before you start.</h2>
  <p class="lp-sub">These choices stay on this device and apply to every page. Change them any time from <b>Display</b> at the top.</p>
  <div class="a11y-quick"><button class="btn" type="button" data-q="textScale:1.5">${ic("type")}Bigger text</button><button class="btn" type="button" data-q="contrast:high">${ic("eye")}High contrast</button><button class="btn" type="button" data-q="font:hyperlegible">Easier-to-read font</button><button class="btn" type="button" data-q="readAloud:true">${ic("volume")}Read pages aloud</button><button class="btn" type="button" data-q="simpleWords:true">Plain words</button><button class="btn" type="button" data-q="bigTargets:true">Bigger buttons</button><button class="btn" type="button" data-q="extraTime:true">${ic("clock")}More time</button></div>
</div></section>

<section class="lp-section alt" id="try"><div class="wrap">
  <p class="lp-kicker">Try it</p><h2 class="lp-h2">Pick who you want to be.</h2>
  <p class="lp-sub">A demo shopper and a clearly identified test merchant on the PayPal sandbox. When a PayPal page opens, sign in with the sandbox buyer account.</p>
  <div class="lp-personas">
    ${accounts.map((a) => html`<div class="persona-card"><div class="who"><span class="avatar">${a.name[0]}</span><span><b>${a.name}</b><span>Shopper · study setup by Friday</span></span></div><p>Share a Reel, plan a $350 study setup around the monitor she owns, approve it on PayPal, then handle a delay and a scuffed lamp.</p>${as(`acc:${a.id}`, `Continue as ${a.name}`)}</div>`)}
    ${merchants.map((m) => html`<div class="persona-card"><div class="who"><span class="avatar">${ic("store")}</span><span><b>${m.name}</b><span>Test merchant</span></span></div><p>Ship, backorder and deliver; approve refunds and answer cases. Everything Maya sees comes from here.</p>${as(`mer:${m.id}`, "Open the merchant console", "")}</div>`)}
    ${accounts.length ? "" : html`<div class="persona-card"><div class="who"><span class="avatar">${ic("gauge")}</span><span><b>Load the demo</b><span>Maya and Northlight Supply</span></span></div><p>Seed the demo shopper and test merchant, then come back here.</p><a class="btn primary" href="/demo">Demo setup ${ic("arrowRight")}</a></div>`}
  </div>
</div></section>`));
}
