import { useEffect } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { Lifeline, type Band, type Mark } from "@/components/Lifeline";
import { ApprovalCard, type ApprovalView } from "@/components/Approval";
import { Button, Card, DemoRibbon, Divider, KV, Loaded, Note, Screen, StatePill, Title, TrustStrip, Txt } from "@/components/ui";
import { serverBase } from "@/lib/api";
import { addDays, day, money, when, words } from "@/lib/format";
import { useAct } from "@/lib/useAct";
import { PayChoice } from "@/components/PayChoice";
import { useApi } from "@/lib/useApi";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/lib/toast";

interface Line {
  id: string;
  title: string;
  status: string;
  unit_cents: number;
  qty: number;
  eta: string | null;
  swap_offer: { title: string; price_cents: number; eta: string; diff_cents: number } | null;
  protection: { eligible: boolean; now_cents: number; protected_unit_cents: number; amount_cents: number; policy_version: string; reasons: string[] } | null;
  dates: { ordered: string | null; eta: string | null; delivered: string | null; deadline: string | null; return_days: number; protection_days: number };
}
interface OrderData {
  order: { id: string; number: string; status: string; total_cents: number; refunded_cents: number; paypal_order_id: string | null; capture_id: string | null; paid_via: string | null; placed_at: string; exception: string | null; intent_id: string };
  merchant: { name: string } | null;
  intent: { id: string; text: string; deadline: string | null } | null;
  lines: Line[];
  ops: { kind: string; amount_cents: number; status: string; paypal_status: string | null; paypal_id: string | null; reason: string | null; error: string | null; created_at: string }[];
  events: { id: number; wall: string | null; summary: string }[];
  held: ApprovalView[];
}

function lineRail(l: Line, today: string): { marks: Mark[]; bands: Band[] } {
  const d = l.dates;
  const marks: Mark[] = [];
  // A line stays "pending" until PayPal confirms the payment: then it is ordered, not yet paid.
  if (d.ordered) marks.push(l.status === "pending" ? { key: "paid", label: "Ordered, not paid", date: d.ordered, tone: "wait", note: money(l.unit_cents * l.qty) } : { key: "paid", label: "Paid", date: d.ordered, tone: "done", note: money(l.unit_cents * l.qty) });
  if (l.status === "backordered") marks.push({ key: "bo", label: "Backordered", date: d.eta ?? today, tone: "now" });
  else if (d.delivered) marks.push({ key: "del", label: "Delivered", date: d.delivered, tone: "done" });
  else if (d.eta) marks.push({ key: "eta", label: l.status === "shipped" ? "On its way" : "Arrives", date: d.eta, tone: "wait" });
  if (l.status === "returned") marks.push({ key: "ret", label: "Returned", date: today, tone: "back" });
  const start = d.delivered ?? d.eta ?? d.ordered ?? today;
  const bands: Band[] = [];
  if (l.status !== "returned" && l.status !== "swapped") bands.push({ key: "r", label: "Return window", from: start, to: addDays(start, d.return_days) });
  if (d.protection_days && d.ordered) bands.push({ key: "p", label: "Price promise", from: d.ordered, to: addDays(d.ordered, d.protection_days) });
  return { marks, bands };
}

export default function Order() {
  const { id, ok, err } = useLocalSearchParams<{ id: string; ok?: string; err?: string }>();
  const st = useApi<OrderData>(`/api/ui/orders/${id}`);
  const { run, busy } = useAct(st.reload);
  const { who } = useSession();
  const { c } = useTheme();
  const toast = useToast();
  const router = useRouter();
  // Arrived from PayPal through everyday://orders/<id>?ok=… : say what happened.
  useEffect(() => {
    if (ok) toast(ok);
    else if (err) toast(err, "err");
  }, [ok, err]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = who?.today ?? new Date().toISOString().slice(0, 10);
  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Screen onRefresh={() => void st.reload()} refreshing={st.loading && Boolean(st.data)}>
        <Loaded st={st}>
          {(d) => {
            const o = d.order;
            const capture = d.ops.find((x) => x.kind === "capture" && x.paypal_id);
            return (
              <>
                <Title eyebrow={`${o.number} · ${when(o.placed_at)}`}>{d.lines.map((l) => l.title).join(", ") || o.number}</Title>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <StatePill s={o.status} />
                  <Txt weight="bold">{money(o.total_cents)}</Txt>
                  {o.refunded_cents > 0 && (
                    <Txt color={c.done} weight="bold">
                      · {money(o.refunded_cents)} back
                    </Txt>
                  )}
                </View>
                {o.exception && <Note tone="now">{o.exception}</Note>}
                {o.paid_via === "demo_wallet" && o.status !== "created" && <Note tone="done">Paid from the demo's saved sandbox wallet, with no PayPal login.</Note>}
                {d.held.map((a) => (
                  <ApprovalCard key={a.id} a={a} reload={st.reload} />
                ))}

                {o.status === "created" && d.held.length === 0 && (
                  <Card tone="wait" title="Not paid yet" sub={o.paypal_order_id ? "PayPal checkout was started but not approved. Nothing has been charged." : "Pay with PayPal when you're ready."}>
                    <PayChoice cents={o.total_cents} busy={busy} run={run} wallet={{ path: `/orders/${o.id}/pay-demo` }} page={{ path: `/orders/${o.id}/pay` }} />
                    {o.paypal_order_id && <Button label="I approved on PayPal: check again" kind="secondary" onPress={() => void st.reload()} />}
                  </Card>
                )}

                {d.lines.map((l) => {
                  const rail = lineRail(l, today);
                  const late = d.intent?.deadline && l.eta && l.eta > d.intent.deadline && l.status !== "delivered";
                  return (
                    <Card key={l.id} title={l.title} sub={`${l.qty > 1 ? `${l.qty} × ${money(l.unit_cents)}` : money(l.unit_cents)}${late ? ` · after your ${day(d.intent!.deadline)} deadline` : ""}`} right={<StatePill s={l.status} />}>
                      {rail.marks.length > 0 && <Lifeline marks={rail.marks} bands={rail.bands} today={today} deadline={d.intent?.deadline} title={`${l.title} lifeline`} />}
                      {l.swap_offer && l.status === "backordered" && (
                        <View style={{ gap: 8 }}>
                          <Note tone="now">{`In stock instead: ${l.swap_offer.title}, ${money(l.swap_offer.price_cents)}, arrives ${day(l.swap_offer.eta)}${l.swap_offer.diff_cents ? `; ${money(l.swap_offer.diff_cents)} back to your PayPal` : ""}.`}</Note>
                          <Button label="Swap to the in-stock one" busy={busy === `swap${l.id}`} disabled={Boolean(busy)} onPress={() => void run(`swap${l.id}`, `/lines/${l.id}/swap`, undefined, { stay: true })} />
                        </View>
                      )}
                      {l.protection?.eligible && (
                        <View style={{ gap: 8 }}>
                          <Note tone="done">{`It's cheaper now: you paid ${money(l.protection.protected_unit_cents)}, it's ${money(l.protection.now_cents)} today. ${l.protection.policy_version} price promise: ${money(l.protection.amount_cents)} back.`}</Note>
                          <Button label={`Ask for ${money(l.protection.amount_cents)} back`} busy={busy === `pp${l.id}`} disabled={Boolean(busy)} onPress={() => void run(`pp${l.id}`, `/lines/${l.id}/price-protection`, undefined, { stay: true })} />
                        </View>
                      )}
                    </Card>
                  );
                })}

                <Card title="Payment record" sub="Read back from PayPal; times are the real time each call was made.">
                  {d.ops.length ? (
                    d.ops.map((x, k) => (
                      <View key={k} style={{ gap: 2 }}>
                        {k > 0 && <Divider />}
                        <KV rows={[[`PayPal ${words(x.kind)}`, money(x.amount_cents)]]} />
                        <Txt size={12} color={x.error ? c.stop : c.ink2} selectable>
                          {[x.paypal_status ?? x.status, x.paypal_id, when(x.created_at), x.error].filter(Boolean).join(" · ")}
                        </Txt>
                      </View>
                    ))
                  ) : (
                    <Txt color={c.ink2}>No PayPal calls yet.</Txt>
                  )}
                  {capture && (
                    <Txt size={12} color={c.done} weight="bold">
                      PayPal capture {capture.paypal_id}
                    </Txt>
                  )}
                </Card>

                <Card title="What happened">
                  {d.events.slice(0, 8).map((e, k) => (
                    <View key={e.id} style={{ gap: 2 }}>
                      {k > 0 && <Divider />}
                      <Txt size={14}>{e.summary}</Txt>
                      <Txt size={12} color={c.ink2}>
                        {e.wall ? when(e.wall) : ""}
                      </Txt>
                    </View>
                  ))}
                </Card>

                <View style={{ gap: 10 }}>
                  {d.intent && <Button label="Back to the plan" kind="secondary" onPress={() => router.push(`/plans/${d.intent!.id}`)} />}
                  <Button label="Return or report a problem on the website" kind="secondary" icon="external-link" onPress={() => void WebBrowser.openBrowserAsync(`${serverBase()}/orders/${o.id}#cases`)} />
                </View>
                <TrustStrip ai="Never touches the money on this order." code="Checks every refund against the merchant's written mandate." paypal="Holds the payment record; Everyday reads it back before saying “paid”." />
              </>
            );
          }}
        </Loaded>
      </Screen>
      <DemoRibbon />
    </View>
  );
}
