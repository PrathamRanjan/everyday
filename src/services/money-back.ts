/**
 * B6 differentiators 2 and 3: the lifeline is the product. The first screen leads with the money the shopper can
 * still get back (price drops inside the shop's promise, claims already with the shop, return windows still open),
 * and each owned item gets one line: bought, return window ends, price promise ends, warranty ends, and what
 * Everyday does at each point. With "claim price drops for me" on, a drop inside the promise becomes a claim without
 * asking; the shop still approves it and the refund counts only once PayPal confirms it.
 */
import { getDb, type Queryable } from "../db.js";
import { wall } from "../core/time.js";
import { J, nowIso, type Account } from "../store.js";
import { withWs } from "../ws.js";
import { claimPriceProtection, protectionsFor } from "./protect.js";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const addDays = (iso: string, n: number) => new Date(wall(iso.slice(0, 10)).getTime() + n * 864e5).toISOString().slice(0, 10);

export interface MoneyLine {
  kind: "price_drop" | "claim_open" | "return";
  title: string;
  amount_cents: number | null;
  until: string | null;
  detail: string;
  href: string;
  line_id: string | null;
}
export interface ItemLine {
  id: string;
  title: string;
  bought: string;
  return_until: string | null;
  promise_until: string | null;
  warranty_until: string | null;
  next: string;
  href: string | null;
}

export async function moneyBack(q: Queryable, a: Account) {
  const today = nowIso(a).slice(0, 10);
  const auto = Boolean((await q.query<{ auto_claim: boolean }>("SELECT auto_claim FROM accounts WHERE id = $1", [a.id])).rows[0]?.auto_claim);
  const prot = await protectionsFor(q, a);
  const lines: MoneyLine[] = [];
  for (const p of prot.filter((x) => x.eligible))
    lines.push({ kind: "price_drop", title: p.title, amount_cents: p.amount_cents, until: null, detail: `The shop now charges ${money(p.now_cents)}; you paid ${money(p.protected_unit_cents)}. ${p.policy_version ?? "The shop's policy"} promises the difference.`, href: `/orders/${p.order_id}`, line_id: p.line_id });
  const open = (await q.query<any>("SELECT c.number, c.status, c.issue, c.refund_cents, c.line_id, o.id AS order_id, l.title FROM cases c JOIN orders o ON o.id = c.order_id LEFT JOIN order_lines l ON l.id = c.line_id WHERE o.account_id = $1 AND c.status IN ('awaiting_merchant','refunding','choose') ORDER BY c.created_at DESC", [a.id])).rows;
  for (const c of open)
    lines.push({ kind: "claim_open", title: c.title ?? c.number, amount_cents: c.refund_cents ?? null, until: null, detail: `${c.number} (${c.issue === "price_drop" ? "price drop" : String(c.issue).replace(/_/g, " ")}) is ${c.status === "refunding" ? "being refunded; it counts once PayPal confirms it" : c.status === "choose" ? "waiting for you to choose a remedy" : "with the shop"}.`, href: `/orders/${c.order_id}#cases`, line_id: c.line_id });
  const items = (
    await q.query<any>(
      `SELECT oi.id, oi.title, oi.acquired, oi.return_until, oi.warranty_until, oi.price_cents, l.id AS line_id, l.delivered_at, ord.id AS order_id, ord.policy
         FROM owned_items oi LEFT JOIN order_lines l ON l.id = oi.order_line_id LEFT JOIN orders ord ON ord.id = l.order_id
        WHERE oi.account_id = $1 AND oi.status = 'owned' ORDER BY oi.acquired DESC LIMIT 12`,
      [a.id],
    )
  ).rows;
  for (const i of items)
    if (i.return_until && i.return_until >= today && i.order_id)
      lines.push({ kind: "return", title: i.title, amount_cents: i.price_cents ?? null, until: i.return_until, detail: `You can still return it${i.price_cents ? ` for up to ${money(i.price_cents)}` : ""}, until ${i.return_until}.`, href: `/orders/${i.order_id}`, line_id: i.line_id });
  const dropBy = new Map(prot.filter((x) => x.eligible).map((x) => [x.line_id, x]));
  const openBy = new Map(open.map((c) => [c.line_id, c]));
  const itemLines: ItemLine[] = items.map((i) => {
    const days = Number(J<any>(i.policy)?.price_protection_days ?? 0);
    const promise = days && i.delivered_at ? addDays(String(i.delivered_at), days) : null;
    const next = dropBy.has(i.line_id)
      ? auto
        ? "The price dropped: Everyday claims it for you."
        : `The price dropped: ask for ${money(dropBy.get(i.line_id)!.amount_cents)} back.`
      : openBy.has(i.line_id)
        ? `${openBy.get(i.line_id).number} is open; Everyday shows the refund once PayPal confirms it.`
        : promise && promise >= today
          ? auto
            ? `Watching the price until ${promise}; a drop is claimed for you.`
            : `Any drop until ${promise} shows here to claim.`
          : i.return_until && i.return_until >= today
            ? `Return window open until ${i.return_until}.`
            : i.warranty_until && i.warranty_until >= today
              ? `Under warranty until ${i.warranty_until}; open a case from the order if it breaks.`
              : "Nothing left to watch.";
    return { id: i.id, title: i.title, bought: String(i.acquired).slice(0, 10), return_until: i.return_until, promise_until: promise, warranty_until: i.warranty_until, next, href: i.order_id ? `/orders/${i.order_id}` : null };
  });
  const sum = (k: MoneyLine["kind"]) => lines.filter((l) => l.kind === k).reduce((s, l) => s + (l.amount_cents ?? 0), 0);
  return { auto_claim: auto, claim_now_cents: sum("price_drop"), in_progress_cents: sum("claim_open"), if_returned_cents: sum("return"), lines, items: itemLines };
}

/** Claims every drop the shop's promise covers, for one shopper. Returns how many it asked for. */
export async function autoClaim(a: Account): Promise<{ claimed: { number: string; amount_cents: number }[]; failed: string[] }> {
  const db = await getDb();
  const out = { claimed: [] as { number: string; amount_cents: number }[], failed: [] as string[] };
  for (const p of (await protectionsFor(db, a)).filter((x) => x.eligible)) {
    try {
      const c = await claimPriceProtection(a, p.line_id);
      out.claimed.push({ number: c.number, amount_cents: c.amount_cents });
    } catch (e) {
      out.failed.push(`${p.title}: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  return out;
}

/** The worker's sweep: each shopper who turned it on, inside their own workspace. */
export async function autoClaimAll(): Promise<number> {
  const db = await getDb();
  const { accountById } = await import("../store.js");
  const rows = (await db.query<{ id: string; ws_id: string | null }>("SELECT id, ws_id FROM accounts WHERE auto_claim")).rows;
  let n = 0;
  for (const r of rows)
    await withWs(r.ws_id, async () => {
      const a = await accountById(db, r.id).catch(() => null);
      if (a) n += (await autoClaim(a)).claimed.length;
    });
  return n;
}
