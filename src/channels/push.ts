/** Web push for the worker PWA (roadmap B.8). VAPID keys from env; without them, pushes are recorded as simulated. */
import type { Party } from "./index.js";
import { config } from "../config.js";
import { getDb } from "../db.js";
import { enqueue } from "../jobs.js";
import { newId } from "../lib/ids.js";
import { isLang } from "../i18n/index.js";
import { display } from "../i18n/display.js";

export const pushReady = () => Boolean(config.channels.vapidPublic && config.channels.vapidPrivate);

export async function subscribe(party: Party, partyId: string, subscription: unknown) {
  const db = await getDb();
  await db.query("INSERT INTO push_subscriptions (id, party, party_id, subscription) VALUES ($1,$2,$3,$4)", [newId("push"), party, partyId, JSON.stringify(subscription)]);
}

export async function pushTo(party: Party, partyId: string, payload: { title: string; body: string; url?: string }) {
  const db = await getDb();
  const subs = (await db.query<{ id: string }>("SELECT id FROM push_subscriptions WHERE party = $1 AND party_id = $2", [party, partyId])).rows;
  const { partyLang } = await import("./index.js");
  const lang = await partyLang(db, party, partyId);
  for (const s of subs) await enqueue(db, "send_push", { subscriptionId: s.id, payload: { ...payload, lang } }, new Date(), `push:${s.id}:${Date.now()}`);
  await db.query("INSERT INTO channel_messages (id, channel, direction, address, body, status) VALUES ($1,'push','out',$2,$3,$4)", [newId("msg"), `${party}:${partyId}`, `${payload.title}: ${payload.body}`, subs.length && pushReady() ? "queued" : "simulated"]);
}

export async function sendPush(subscriptionId: string, raw: { title: string; body: string; url?: string; lang?: string | null }) {
  if (!pushReady()) return;
  // B6: in the reader's language as it goes out.
  const l = isLang(raw.lang) ? raw.lang : "en";
  const payload = { title: display(raw.title, l), body: display(raw.body, l), url: raw.url };
  const db = await getDb();
  const row = (await db.query<{ subscription: any }>("SELECT subscription FROM push_subscriptions WHERE id = $1", [subscriptionId])).rows[0];
  if (!row) return;
  const webpush = await import("web-push");
  webpush.default.setVapidDetails(`mailto:ops@${new URL(config.appUrl).hostname}`, config.channels.vapidPublic, config.channels.vapidPrivate);
  try {
    await webpush.default.sendNotification(row.subscription, JSON.stringify(payload));
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.statusCode === 410) await db.query("DELETE FROM push_subscriptions WHERE id = $1", [subscriptionId]);
    else throw e;
  }
}
