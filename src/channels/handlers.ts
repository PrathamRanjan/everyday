/**
 * What Everyday says on channels and how it answers replies (roadmap B.8). Shoppers get approval requests for held
 * repeat buys, price-protection and recall alerts and order updates; the merchant gets approval requests for refunds
 * above its threshold and case events. A button press on a held move is the approval; amounts above the
 * countersign threshold are sent back to the app for a passkey. The existing Telegram bot (services/captures.ts)
 * keeps handling clips and plans; this handles the foundation's messages on Telegram, WhatsApp and the simulator.
 */
import { config } from "../config.js";
import { getDb } from "../db.js";
import { enqueue } from "../jobs.js";
import { countersignThreshold, decideApproval } from "../guard/dryrun.js";
import { isMerchantOwner, merchantOwner } from "../guard/policy.js";
import { currentWs } from "../ws.js";
import { link, onInbound, type Party } from "./index.js";

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export function installChannelHandlers() {
  onInbound(async (m) => {
    const text = m.text.trim();
    const db = await getDb();
    const st = text.match(/^\/start\s+(m[0-9a-f]+)$/i);
    if (st && m.channel !== "simulator") {
      const row = (await db.query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [`tglink:${st[1]}`])).rows[0];
      await db.query("DELETE FROM settings WHERE key = $1", [`tglink:${st[1]}`]);
      const v = row ? (JSON.parse(row.value) as { party: string; owner?: string; exp: number }) : null;
      if (!v || v.exp < Date.now()) return "That connect link has expired. In the merchant console, open Messages and tap Connect Telegram again.";
      // A1: the chat links to the shop of the demo workspace that made the link.
      await link(m.channel, m.address, "merchant", v.owner && isMerchantOwner(v.owner) ? v.owner : merchantOwner());
      return "Connected as Northlight Supply. Refund approvals and case updates will come here with buttons. Send 'pending' any time.";
    }
    const linkMatch = text.match(/^\/?link\s+(shopper|merchant):(\S+)$/i);
    if (linkMatch && m.channel !== "simulator") return "For safety, chats are connected from the app: in Everyday, open You (or the merchant's Messages page) and tap Connect Telegram.";
    if (linkMatch) {
      const party = linkMatch[1].toLowerCase() as Party;
      const id = linkMatch[2];
      const exists = party === "merchant" ? isMerchantOwner(id) || (await db.query("SELECT 1 FROM merchants WHERE id = $1", [id])).rows.length > 0 : (await db.query("SELECT 1 FROM accounts WHERE id = $1", [id])).rows.length > 0;
      if (!exists) return "That id does not exist. Copy it from the Channels page while signed in.";
      await link(m.channel, m.address, party, party === "merchant" ? (isMerchantOwner(id) ? id : merchantOwner()) : id);
      return `Linked. You will get ${party === "merchant" ? "refund approval requests and case updates" : "approval requests, price-protection and recall alerts, and order updates"} here.`;
    }
    const party = m.party ?? (m.channel === "simulator" && /^(shopper|merchant):/.test(m.address) ? { party: m.address.split(":")[0], party_id: m.address.split(":").slice(1).join(":") } : null);
    if (!party) return "This chat isn't connected yet. In Everyday, open You and tap Connect Telegram.";
    const ownerId = party.party === "merchant" ? (isMerchantOwner(party.party_id) ? party.party_id : merchantOwner()) : party.party_id;

    const cmd = (m.buttonId ?? text).match(/^(approve|decline):(\S+)$/i);
    if (cmd) {
      const approve = cmd[1].toLowerCase() === "approve";
      const a = (await db.query<any>("SELECT * FROM approvals WHERE id = $1 AND owner_id = $2 AND status = 'pending'", [cmd[2], ownerId])).rows[0];
      if (!a) return "That request is no longer pending.";
      if (approve && a.payload.cents > countersignThreshold()) return `${usd(a.payload.cents)} is above your countersign threshold (${usd(countersignThreshold())}). Approve it with your passkey in the app (${config.appUrl}${party.party === "merchant" ? "/merchant/approvals" : "/guard"}).`;
      const payload = await decideApproval(a.id, ownerId, approve, "click");
      if (payload && approve) await enqueue(db, "release_approved", { approvalId: a.id }, new Date(), `release:${a.id}`);
      return approve ? `Approved ${usd(a.payload.cents)}. The ${String(a.action).replace("_", " ")} is back in the queue.` : "Declined. Nothing moves.";
    }
    if (/^(pending|approvals|waiting)$/i.test(text)) {
      const rows = (await db.query<any>("SELECT * FROM approvals WHERE owner_id = $1 AND status = 'pending' ORDER BY created_at", [ownerId])).rows;
      if (!rows.length) return "Nothing waiting for you.";
      return rows.map((a: any) => `${String(a.action).replace("_", " ")} ${usd(a.payload.cents)} (${a.payload.entity} ${a.payload.entity_id}): reply approve:${a.id} or decline:${a.id}`).join("\n");
    }
    if (party.party === "shopper") {
      if (/^(orders|purchases|status)$/i.test(text)) {
        const rows = (await db.query<any>("SELECT number, status, total_cents, refunded_cents FROM orders WHERE account_id = $1 ORDER BY created_at DESC LIMIT 8", [party.party_id])).rows;
        return rows.length ? rows.map((o: any) => `${o.number}: ${String(o.status).replace(/_/g, " ")}, ${usd(o.total_cents)}${o.refunded_cents ? ` (${usd(o.refunded_cents)} back)` : ""}`).join("\n") : "No purchases yet.";
      }
      if (/^(stop|kill|freeze)$/i.test(text)) {
        const { setKill } = await import("../guard/kill.js");
        await setKill(`account:${party.party_id}`, true, "stopped from a channel", "shopper");
        return "Stopped. No order, capture or repeat buy runs for your account until you release it in the app under Guard.";
      }
      if (/^(watch|watches|protection)$/i.test(text)) {
        const rows = (await db.query<any>("SELECT w.target_cents, w.status, p.title, p.price_cents FROM price_watches w JOIN products p ON p.id = w.product_id WHERE w.account_id = $1", [party.party_id])).rows;
        return rows.length ? rows.map((w: any) => `${w.title}: now ${usd(w.price_cents)}, you want ${usd(w.target_cents)} (${w.status})`).join("\n") : "No price watches.";
      }
      return "Reply 'pending' for approvals waiting on you, 'orders' for your purchases, 'watch' for price watches, or 'stop' to freeze all buying.";
    }
    if (/^(cases|open)$/i.test(text)) {
      const rows = (await db.query<any>("SELECT c.number, c.issue, c.status, c.refund_cents FROM cases c JOIN orders o ON o.id = c.order_id JOIN accounts a ON a.id = o.account_id WHERE c.status IN ('awaiting_merchant','refunding') AND a.ws_id IS NOT DISTINCT FROM $1 ORDER BY c.created_at LIMIT 10", [currentWs()])).rows;
      return rows.length ? rows.map((c: any) => `${c.number}: ${c.issue}, ${String(c.status).replace(/_/g, " ")}${c.refund_cents ? `, ${usd(c.refund_cents)}` : ""}`).join("\n") : "No open cases.";
    }
    if (/^(disputes)$/i.test(text)) {
      const rows = (await db.query<any>("SELECT d.paypal_id, d.status, d.amount_cents FROM disputes d JOIN orders o ON o.id = d.order_id JOIN accounts a ON a.id = o.account_id WHERE a.ws_id IS NOT DISTINCT FROM $1 ORDER BY d.synced_at DESC LIMIT 10", [currentWs()])).rows;
      return rows.length ? rows.map((d: any) => `${d.paypal_id}: ${d.status}${d.amount_cents ? `, ${usd(d.amount_cents)}` : ""}`).join("\n") : "No disputes on file.";
    }
    return "Reply 'pending' for refunds waiting on you, 'cases' for open cases, or 'disputes'.";
  });
}
