import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { FlaskConical, PackageCheck, RefreshCw, Truck } from "lucide-react";
import { ApprovalCard } from "@/components/Approval";
import { Amount, Busy, Empty, Loaded, PageHead, Panel, Stat, State } from "@/components/kit";
import { FirstRun } from "./Today";
import { AuditChain, KillSwitch, PasskeyPanel, RulesList, type GuardCommon } from "./Guard";
import { SpeakableText } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction, useApi } from "@/lib/api";
import { day, money, when, words } from "@/lib/format";
import { t, tn } from "@/i18n";

interface MerchantData {
  merchant: { id: string; name: string };
  lines: { id: string; title: string; status: string; eta: string | null; unit_cents: number; delivered_at: string | null; number: string; order_id: string; order_status: string; customer: string }[];
  cases: { id: string; number: string; status: string; issue: string; claim: string; flagged: boolean; requested: string | null; refund_cents: number | null; created_at: string; order_number: string; title: string }[];
  catalog: { id: string; title: string; sku: string; stock: number; price_cents: number; category: string }[];
  kill: boolean;
  approvals: number;
}

const short = (n: string) => n.replace(/\s*\(.*\)$/, "");

function LineRow({ l, reload }: { l: MerchantData["lines"][number]; reload: () => Promise<void> }) {
  const { run, busy } = useAction(reload);
  const [note, setNote] = useState("");
  const [days, setDays] = useState("4");
  const open = l.status === "ordered" || l.status === "shipped" || l.status === "backordered";
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <p className="font-medium">{l.title}</p>
        <p className="num text-xs text-ink-2">
          <span className="id">{l.number}</span> · {l.customer} · {money(l.unit_cents)}
          {l.eta ? t(" · due {0}", day(l.eta)) : ""}
          {l.delivered_at ? t(" · delivered {0}", day(l.delivered_at.slice(0, 10))) : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <State s={l.status} />
        {l.status === "ordered" && (
          <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => run("ship", `/merchant/lines/${l.id}/ship`, undefined, { stay: true })}>
            <Busy on={busy === "ship"}>
              <Truck className="size-4" />
            </Busy>
            {t("Ship")}
          </Button>
        )}
        {open && (
          <>
            <Label htmlFor={`n-${l.id}`} className="sr-only">
              {t("Delivery note")}
            </Label>
            <Input id={`n-${l.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Delivery note (optional)")} className="min-h-11 w-40 bg-card text-sm" />
            <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => run("del", `/merchant/lines/${l.id}/deliver`, { note }, { stay: true })}>
              <Busy on={busy === "del"}>
                <PackageCheck className="size-4" />
              </Busy>
              {t("Deliver")}
            </Button>
          </>
        )}
        {l.status === "ordered" && (
          <span className="flex items-center gap-1">
            <Label htmlFor={`d-${l.id}`} className="sr-only">
              {t("Days late")}
            </Label>
            <Input id={`d-${l.id}`} type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} className="num min-h-11 w-16 bg-card text-sm" aria-describedby={`dh-${l.id}`} />
            <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => run("bo", `/merchant/lines/${l.id}/backorder`, { days }, { stay: true })}>
              {t("Backorder")}
            </Button>
            <span id={`dh-${l.id}`} className="sr-only">
              {t("working days late")}
            </span>
          </span>
        )}
      </div>
    </li>
  );
}

function CaseRow({ c, reload }: { c: MerchantData["cases"][number]; reload: () => Promise<void> }) {
  const { run, busy } = useAction(reload);
  const [note, setNote] = useState("");
  const waiting = c.status === "awaiting_merchant";
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="id font-semibold">{c.number}</span>
        <State s={c.status} />
        <span className="text-sm text-ink-2">
          {tn("{0} · {1} · order {2}", c.title, words(c.issue), c.order_number)}
        </span>
      </div>
      <p className="mt-1 text-sm">{c.claim}</p>
      {c.flagged && <p className="mt-1 text-xs font-semibold text-stop">{t("The claim had instruction-like text; Everyday ignored it.")}</p>}
      {c.requested && (
        <p className="mt-1 text-sm text-ink-2">
          {t("Asks for:")}{" "}<b className="text-ink">{words(c.requested)}</b>
          {c.refund_cents ? (
            <>
              {" "}
              · <Amount cents={c.refund_cents} />
            </>
          ) : null}
        </p>
      )}
      {waiting && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Label htmlFor={`cn-${c.id}`} className="sr-only">
            {t("Note to the customer")}
          </Label>
          <Input id={`cn-${c.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Note (optional)")} className="min-h-11 w-56 bg-card text-sm" />
          <Button size="sm" disabled={Boolean(busy)} onClick={() => run("ok", `/merchant/cases/${c.id}`, { approve: "1", note }, { stay: true })}>
            <Busy on={busy === "ok"}>{null}</Busy>{tn("Approve{0}", c.refund_cents ? ` ${money(c.refund_cents)} refund` : "")}
          </Button>
          <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => run("no", `/merchant/cases/${c.id}`, { approve: "0", note }, { stay: true })}>
            {t("Decline")}
          </Button>
          <span className="w-full text-xs text-ink-2">{t("A refund runs under your refund rules; at or above its approval line it waits on Approvals first.")}</span>
        </div>
      )}
    </li>
  );
}

function PriceRow({ p, reload }: { p: MerchantData["catalog"][number]; reload: () => Promise<void> }) {
  const { run, busy } = useAction(reload);
  const [price, setPrice] = useState(String(p.price_cents / 100));
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{p.title}</span>
        <span className="id block text-xs text-ink-2">
          {tn("{0} · {1} in stock", p.sku, p.stock)}
        </span>
      </span>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void run("p", `/merchant/products/${p.id}/price`, { price }, { stay: true });
        }}
      >
        <Label htmlFor={`pr-${p.id}`} className="sr-only">
          {tn("Price for {0} in dollars", p.title)}
        </Label>
        <Input id={`pr-${p.id}`} type="number" step="0.01" min={0} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="num min-h-11 w-24 bg-card text-sm" />
        <Button size="sm" variant="outline" type="submit" disabled={Boolean(busy) || Number(price) * 100 === p.price_cents}>
          {t("Set")}
        </Button>
      </form>
    </li>
  );
}

export default function Merchant() {
  const st = useApi<MerchantData>("/api/ui/merchant");
  return (
    <Loaded state={st}>
      {(d) => {
        const open = d.lines.filter((l) => ["ordered", "shipped", "backordered"].includes(l.status));
        const waiting = d.cases.filter((c) => c.status === "awaiting_merchant");
        return (
          <div className="ev-rise">
            <FirstRun kind="merchant" />
            <PageHead eyebrow={t("{0} · sandbox test shop", short(d.merchant.name))} title={t("Orders to look after")} needs={[waiting.length ? `${waiting.length} case${waiting.length > 1 ? "s" : ""} to decide` : null, d.approvals ? `${d.approvals} refund approval${d.approvals > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ") || undefined} next={open.length ? t("{0} line{1} to ship or deliver", open.length, open.length > 1 ? "s" : "") : undefined} />
            {d.kill && (
              <div role="alert" className="mb-6 rounded-lg border border-stop bg-stop-bg p-4 text-sm text-stop">
                <b>{t("Your kill switch is on.")}</b>{" "}{t("No refund can move until you release it on")}{" "}<Link className="underline" to="/merchant/approvals">{t("Approvals")}</Link>.
              </div>
            )}
            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <div className="space-y-6">
                <Panel title={t("Order lines")} sub={t("Paid orders only.")}>
                  <div data-tour="merchant-orders">
                    {d.lines.length ? (
                      <ul className="divide-y divide-rule">
                        {d.lines.map((l) => (
                          <LineRow key={l.id} l={l} reload={st.reload} />
                        ))}
                      </ul>
                    ) : (
                      <Empty title={t("No paid orders yet.")}>{t("When a shopper pays on PayPal, the lines appear here.")}</Empty>
                    )}
                  </div>
                </Panel>
                <Panel title={t("Cases")} id="cases">
                  <div data-tour="merchant-cases">
                    {d.cases.length ? (
                      <ul className="divide-y divide-rule">
                        {d.cases.map((c) => (
                          <CaseRow key={c.id} c={c} reload={st.reload} />
                        ))}
                      </ul>
                    ) : (
                      <Empty title={t("No cases.")}>{t("Returns, damage reports and price-promise claims arrive here with what was observed.")}</Empty>
                    )}
                  </div>
                </Panel>
              </div>
              <Panel title={t("Prices and stock")} sub={t("A lower price triggers price-promise checks for recent buyers.")} id="catalog">
                <ul className="max-h-[36rem] divide-y divide-rule overflow-y-auto">
                  {d.catalog.map((p) => (
                    <PriceRow key={p.id} p={p} reload={st.reload} />
                  ))}
                </ul>
              </Panel>
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}

interface MoneyData {
  merchant: { id: string; name: string };
  disputes: { id: string; paypal_id: string; status: string; reason: string | null; amount_cents: number | null; evidence_sent_at: string | null; due_at: string | null; number: string | null }[];
  trackers: { id: string; number: string; carrier: string; tracking_number: string; paypal_status: string | null }[];
  lines: { id: string; title: string; status: string; number: string }[];
  totals: { orders: number; gross: number; fees: number; refunded: number };
  recon: null | { error: string } | { rows: { id: string; code: string; cents: number; order: string | null; agrees: boolean | "refund" | null }[]; unmatched: number; disagree: number; note: string };
  fake: boolean;
}

function TrackRow({ l, reload }: { l: MoneyData["lines"][number]; reload: () => Promise<void> }) {
  const { run, busy } = useAction(reload);
  const [carrier, setCarrier] = useState("");
  const [num, setNum] = useState("");
  return (
    <li className="grid gap-2 py-3">
      <p className="text-sm">
        <span className="id font-semibold">{l.number}</span> · {l.title}
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run("t", `/merchant/lines/${l.id}/tracking`, { carrier, number: num }, { stay: true });
        }}
      >
        <Label htmlFor={`c-${l.id}`} className="sr-only">
          {t("Carrier")}
        </Label>
        <Input id={`c-${l.id}`} required value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder={t("Carrier (e.g. DHL)")} className="min-h-11 w-32 bg-card text-sm" />
        <Label htmlFor={`tn-${l.id}`} className="sr-only">
          {t("Tracking number")}
        </Label>
        <Input id={`tn-${l.id}`} required value={num} onChange={(e) => setNum(e.target.value)} placeholder={t("Tracking number")} className="min-h-11 w-40 bg-card text-sm" />
        <Button size="sm" type="submit" variant="outline" disabled={Boolean(busy)}>
          <Busy on={busy === "t"}>{null}</Busy>{t("Attach")}
        </Button>
      </form>
    </li>
  );
}

export function MerchantMoney() {
  const [sp, setSp] = useSearchParams();
  const st = useApi<MoneyData>(`/api/ui/merchant/money${sp.get("reconcile") ? "?reconcile=1" : ""}`);
  const { run, busy } = useAction(st.reload);
  const [code, setCode] = useState("INSTRUMENT_DECLINED");
  return (
    <Loaded state={st}>
      {(d) => (
        <div className="ev-rise">
          <PageHead eyebrow={t("Money")} title={t("What PayPal says")} lede={t("{0} · PayPal sandbox{1}.", short(d.merchant.name), d.fake ? t(" (fake client on this server)") : "")} needs={d.disputes.filter((x) => x.status !== "RESOLVED").length ? t("{0} open dispute", d.disputes.filter((x) => x.status !== "RESOLVED").length) : undefined} />
          <div data-tour="merchant-money" className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t("Paid orders")} value={d.totals.orders} />
            <Stat label={t("Gross")} value={money(d.totals.gross)} />
            <Stat label={t("PayPal fees")} value={money(d.totals.fees)} />
            <Stat label={t("Refunded")} value={money(d.totals.refunded)} tone="done" />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title={t("Tracking")} id="tracking" sub={t("Attached to the PayPal order, so the shopper sees it in PayPal too.")}>
              {d.lines.length ? (
                <ul className="divide-y divide-rule">
                  {d.lines.map((l) => (
                    <TrackRow key={l.id} l={l} reload={st.reload} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-2">{t("Every paid line has tracking.")}</p>
              )}
              {d.trackers.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-rule pt-3 text-sm">
                  {d.trackers.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-2">
                      <span className="id">{t.number}</span>
                      <span className="min-w-0 flex-1">
                        {t.carrier} {t.tracking_number}
                      </span>
                      <State s={t.paypal_status ?? "pending"} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel
              title={t("Disputes")}
              id="disputes"
              sub={t("Synced from PayPal every ten minutes. The evidence pack is built from what the shopper agreed: quote hash, policy version, delivery and case history.")}
              action={
                <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => run("sync", "/merchant/money/disputes/sync", undefined, { stay: true })}>
                  <Busy on={busy === "sync"}>
                    <RefreshCw className="size-4" />
                  </Busy>
                  {t("Sync")}
                </Button>
              }
            >
              {d.disputes.length ? (
                <ul className="divide-y divide-rule text-sm">
                  {d.disputes.map((x) => (
                    <li key={x.id} className="grid gap-1 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="id font-semibold">{x.paypal_id}</span>
                        <State s={x.status} />
                        <Amount cents={x.amount_cents} className="ml-auto" />
                      </div>
                      <p className="text-ink-2">
                        {tn("Order {0} · {1}{2}{3}", x.number ?? "?", x.reason ? words(x.reason.toLowerCase()) : t("no reason given"), x.due_at ? t(" · respond by {0}", when(x.due_at)) : "", x.evidence_sent_at ? t(" · evidence sent {0}", when(x.evidence_sent_at)) : "")}
                      </p>
                      {!x.evidence_sent_at && x.status !== "RESOLVED" && (
                        <div className="flex gap-2">
                          <Button size="sm" disabled={Boolean(busy)} onClick={() => run(`e${x.id}`, `/merchant/money/disputes/${x.id}/evidence`, undefined, { stay: true })}>
                            {t("Send evidence")}
                          </Button>
                          <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => run(`a${x.id}`, `/merchant/money/disputes/${x.id}/accept`, { note: t("Accepted by the merchant.") }, { stay: true })}>
                            {t("Accept claim")}
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title={t("No disputes.")}>{t("Open one from the sandbox buyer account to see the flow.")}</Empty>
              )}
            </Panel>
            <Panel title={t("Check against PayPal's own record")} sub={t("Transaction Search, last 30 days, matched to Everyday's orders.")} id="recon">
              <Button size="sm" variant="outline" onClick={() => setSp({ reconcile: "1" })} disabled={st.loading}>
                <Busy on={st.loading && Boolean(sp.get("reconcile"))}>{null}</Busy>{t("Reconcile now")}
              </Button>
              {d.recon &&
                ("error" in d.recon ? (
                  <p className="mt-3 rounded-md bg-stop-bg p-3 text-sm text-stop">{d.recon.error}</p>
                ) : (
                  <>
                    <p className="mt-3 text-sm">
                      {tn("{0} PayPal transactions · {1} unmatched captures · {2} amount mismatches.", d.recon.rows.length, d.recon.unmatched, d.recon.disagree)}{" "}<span className="text-ink-2">{d.recon.note}</span>
                    </p>
                    <ul className="mt-2 max-h-64 divide-y divide-rule overflow-y-auto text-sm">
                      {d.recon.rows.slice(0, 50).map((x) => (
                        <li key={x.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 py-1.5">
                          <span className="id truncate text-xs">{x.id}</span>
                          <Amount cents={x.cents} />
                          <State s={x.agrees === false ? "failed" : x.agrees === "refund" ? "REFUNDED" : x.agrees ? "done" : "stale"} label={x.agrees === false ? (x.order ? "mismatch" : t("not in Everyday")) : x.agrees === "refund" ? "refund" : (x.order ?? t("no order"))} />
                        </li>
                      ))}
                    </ul>
                  </>
                ))}
            </Panel>
            <Panel title={<span className="inline-flex items-center gap-2"><FlaskConical className="size-5" />{t("Failure drill")}</span>} sub={t("Asks PayPal to refuse the next write with a test code, so the failure path runs for real: a one-cent refund against the latest capture.")}>
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run("neg", "/merchant/money/negative-test", { code }, { stay: true });
                }}
              >
                <div className="grid gap-1">
                  <Label htmlFor="neg">{t("PayPal test code")}</Label>
                  <Select value={code} onValueChange={setCode}>
                    <SelectTrigger id="neg" className="min-h-11 w-64 bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["INSTRUMENT_DECLINED", "INSUFFICIENT_FUNDS", "TRANSACTION_REFUSED", "INTERNAL_SERVER_ERROR"].map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" variant="outline" disabled={Boolean(busy)}>
                  <Busy on={busy === "neg"}>{null}</Busy>{t("Run")}
                </Button>
              </form>
            </Panel>
          </div>
        </div>
      )}
    </Loaded>
  );
}

interface MApprovals extends GuardCommon {
  merchant: { id: string; name: string };
}

export function MerchantApprovals() {
  const st = useApi<MApprovals>("/api/ui/merchant/approvals");
  const { run, busy } = useAction(st.reload);
  const [text, setText] = useState<string | null>(null);
  return (
    <Loaded state={st}>
      {(d) => (
        <div className="ev-rise">
          <PageHead eyebrow={t("Approvals")} title={t("Your refund rules")} lede={t("Refunds run under rules you write. At or above the approval line a refund waits here; above the passkey line it needs a passkey.")} needs={d.approvals.length ? t("{0} refund waiting", d.approvals.length) : undefined} />
          {d.approvals.length > 0 && (
            <section className="mb-6 space-y-3">
              {d.approvals.map((a) => (
                <ApprovalCard key={a.id} a={a} merchant reload={st.reload} next="/merchant/approvals" />
              ))}
            </section>
          )}
          <div className="mb-6">
            <KillSwitch kill={d.kill} path="/merchant/approvals/kill" reload={st.reload} who={t("for this shop")} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title={t("Mandate")} sub={d.policy ? t("Read by {0}.", d.policy.compiler) : t("Using the defaults.")}>
              <div data-tour="merchant-rules">
                {d.policy && <blockquote className="mb-3 border-l-2 border-rule-2 pl-3 text-sm text-ink-2 italic">{d.policy.text}</blockquote>}
                <RulesList rules={d.rules} />
              </div>
              <form
                className="mt-4 grid gap-2 border-t border-rule pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run("pol", "/merchant/approvals/policy", { text: text ?? "" }, { stay: true });
                }}
              >
                <Label htmlFor="mpol">{t("Change it in words")}</Label>
                <SpeakableText id="mpol" rows={3} value={text ?? d.policy?.text ?? ""} onChange={setText} placeholder={t("Refund at most 60% without a return. Ask me before any refund over $150.")} />
                <Button type="submit" className="justify-self-start" disabled={Boolean(busy) || !(text ?? "").trim()}>
                  <Busy on={busy === "pol"}>{null}</Busy>{t("Adopt")}
                </Button>
              </form>
            </Panel>
            <div className="space-y-6">
              <PasskeyPanel has={d.passkey} countersign={d.countersign_cents} merchant reload={st.reload} />
              <AuditChain chain={d.chain} audit={d.audit} />
            </div>
          </div>
        </div>
      )}
    </Loaded>
  );
}
