import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, ArrowLeftRight, BadgeDollarSign, MessageSquareWarning } from "lucide-react";
import { Lifeline, Dot, type Band, type Mark } from "@/components/Lifeline";
import { ApprovalCard, type ApprovalView } from "@/components/Approval";
import { Amount, Busy, GoLink, KV, Loaded, PageHead, Panel, State, stateOf, TrustStrip } from "@/components/kit";
import { PayChoice } from "@/components/PayChoice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction, useApi } from "@/lib/api";
import { addDays, day, money, when, words } from "@/lib/format";
import { useSession, useToday } from "@/lib/session";
import { ScamCheck } from "@/components/ScamCheck";

interface Line {
  id: string;
  title: string;
  status: string;
  unit_cents: number;
  qty: number;
  eta: string | null;
  delivered_at: string | null;
  swap_offer: { title: string; price_cents: number; eta: string; diff_cents: number } | null;
  protection: { eligible: boolean; now_cents: number; protected_unit_cents: number; amount_cents: number; policy_version: string; clause: string; evidence: string; reasons: string[] } | null;
  dates: { ordered: string | null; eta: string | null; delivered: string | null; deadline: string | null; return_days: number; protection_days: number };
}
interface Case {
  id: string;
  number: string;
  status: string;
  issue: string;
  claim: string;
  observations: string[];
  missing: { question: string }[];
  eligibility: { eligible: boolean; until?: string; reasons: string[] } | null;
  options: { key: string; label: string }[];
  requested: string | null;
  merchant_decision: { approve: boolean; note?: string } | null;
  refund_cents: number | null;
  line_id: string;
  created_at: string;
}
interface OrderData {
  order: { id: string; number: string; status: string; total_cents: number; gross_cents: number | null; fee_cents: number | null; refunded_cents: number; paypal_order_id: string | null; capture_id: string | null; repaired: boolean; paid_via: string | null; created_at: string; placed_at: string; exception: string | null; intent_id: string };
  merchant: { name: string; label: string } | null;
  intent: { id: string; text: string; deadline: string | null } | null;
  policy: { version?: string; window_days?: number; price_protection_days?: number } | null;
  lines: Line[];
  ops: { kind: string; amount_cents: number; status: string; paypal_status: string | null; paypal_id: string | null; request_id: string; reason: string | null; error: string | null; created_at: string }[];
  cases: Case[];
  events: { id: number; wall: string | null; summary: string; actor: string; kind: string }[];
  held: ApprovalView[];
  runs: { id: string; subject: string; status: string; started_at: string }[];
}

const ISSUES = [
  ["damaged", "Arrived damaged"],
  ["wrong", "Wrong item"],
  ["defective", "Stopped working"],
  ["change_of_mind", "Changed my mind"],
] as const;

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

function CaseForm({ line, reload }: { line: Line; reload: () => Promise<void> }) {
  const [issue, setIssue] = useState<string>("damaged");
  const [claim, setClaim] = useState("");
  const [photo, setPhoto] = useState(false);
  const { run, busy } = useAction(reload);
  return (
    <form
      className="mt-3 grid gap-3 rounded-md bg-sunk/70 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run("case", `/lines/${line.id}/case`, { issue, claim, photo: photo ? "1" : undefined }, { stay: true });
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={`is-${line.id}`}>What happened</Label>
        <Select value={issue} onValueChange={setIssue}>
          <SelectTrigger id={`is-${line.id}`} className="min-h-11 w-full bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ISSUES.map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`cl-${line.id}`}>Tell us in a sentence</Label>
        <Input id={`cl-${line.id}`} value={claim} onChange={(e) => setClaim(e.target.value)} required className="min-h-11 bg-card" placeholder="The shade has a scuff on one side." />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <Checkbox checked={photo} onCheckedChange={(v) => setPhoto(v === true)} /> I have a photo
      </label>
      <Button type="submit" size="sm" className="justify-self-start" disabled={Boolean(busy) || !claim.trim()}>
        <Busy on={busy === "case"}>{null}</Busy>Open a case
      </Button>
    </form>
  );
}

function LineCard({ l, first, deadline, reload, today }: { l: Line; first: boolean; deadline: string | null; reload: () => Promise<void>; today: string }) {
  const { run, busy } = useAction(reload);
  const [problem, setProblem] = useState(false);
  const rail = lineRail(l, today);
  const late = deadline && l.eta && l.eta > deadline && l.status !== "delivered";
  return (
    <article className="rounded-lg border border-rule bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl">{l.title}</p>
          <p className="num text-xs text-ink-2">
            {l.qty > 1 ? `${l.qty} × ${money(l.unit_cents)}` : money(l.unit_cents)}
            {late && <span className="font-semibold text-stop"> · after your {day(deadline)} deadline</span>}
          </p>
        </div>
        <State s={l.status} />
      </div>
      {rail.marks.length > 0 && (
        <div className="mt-3" data-tour={first ? "lifeline" : undefined}>
          <Lifeline marks={rail.marks} bands={rail.bands} today={today} deadline={deadline} title={`${l.title} lifeline`} />
        </div>
      )}
      {l.status === "backordered" && l.swap_offer && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-now/40 bg-now-bg p-3 text-sm">
          <ArrowLeftRight className="size-4 shrink-0 text-now" />
          <p className="min-w-0 flex-1">
            In stock instead: <b>{l.swap_offer.title}</b> ({money(l.swap_offer.price_cents)}, arrives {day(l.swap_offer.eta)})
            {l.swap_offer.diff_cents ? `; ${money(l.swap_offer.diff_cents)} back to your PayPal` : ""}. It passed the same checks.
          </p>
          <Button size="sm" disabled={Boolean(busy)} onClick={() => run("swap", `/lines/${l.id}/swap`, undefined, { stay: true })}>
            <Busy on={busy === "swap"}>{null}</Busy>Swap it
          </Button>
        </div>
      )}
      {l.protection &&
        (l.protection.eligible ? (
          <div className="mt-3 flex flex-wrap items-start gap-3 rounded-md border border-done/40 bg-done-bg p-3 text-sm">
            <BadgeDollarSign className="mt-0.5 size-4 shrink-0 text-done" />
            <div className="min-w-0 flex-1">
              <p>
                The shop now charges <Amount cents={l.protection.now_cents} />; you paid <Amount cents={l.protection.protected_unit_cents} />.
              </p>
              <p className="mt-1 text-xs text-ink-2">
                {l.protection.policy_version}: “{l.protection.clause}” ({l.protection.evidence})
              </p>
              <p className="mt-1 text-xs text-ink-2">The shop approves it; the money goes back to your original PayPal payment and counts once PayPal confirms it.</p>
            </div>
            <Button size="sm" disabled={Boolean(busy)} onClick={() => run("pp", `/lines/${l.id}/price-protection`, undefined, { stay: true })}>
              <Busy on={busy === "pp"}>{null}</Busy>Ask for {money(l.protection.amount_cents)} back
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-xs text-ink-2">
            Now {money(l.protection.now_cents)}, but the price promise doesn't apply: {l.protection.reasons.join(" ")}
          </p>
        ))}
      {l.status === "delivered" && (
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => setProblem(!problem)} aria-expanded={problem}>
            <MessageSquareWarning className="size-4" /> Problem with this item?
          </Button>
          {problem && <CaseForm line={l} reload={reload} />}
        </div>
      )}
    </article>
  );
}

export default function Order() {
  const { id } = useParams();
  const st = useApi<OrderData>(`/api/ui/orders/${id}`);
  const { run, busy } = useAction(st.reload);
  const today = useToday();
  const { session } = useSession();
  return (
    <Loaded state={st} rows={4}>
      {(d) => {
        const o = d.order;
        const cap = d.ops.find((x) => x.kind === "capture" && x.status === "succeeded");
        const unpaid = o.status === "created";
        const choose = d.cases.filter((c) => c.status === "choose");
        return (
          <div className="ev-rise">
            <Link to="/purchases" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-ink-2 hover:text-ink">
              <ArrowLeft className="size-4" /> Bought
            </Link>
            <PageHead
              eyebrow={
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span className="id">{o.number}</span> · {d.merchant?.name.replace(/\s*\(.*\)$/, "") ?? "Shop"} · {when(o.placed_at)}
                </span>
              }
              title={unpaid ? "Not paid yet" : o.refunded_cents && o.refunded_cents >= (o.gross_cents ?? 0) ? "Refunded" : `Paid ${money(o.gross_cents ?? o.total_cents)}`}
              lede={d.intent ? `For “${d.intent.text}”` : undefined}
              needs={unpaid ? "Approve the payment on PayPal" : choose.length ? "Choose a remedy" : undefined}
              next={unpaid ? "The order's dates start once PayPal confirms" : d.lines.some((l) => l.status === "ordered" || l.status === "shipped") ? "Delivery, then the return window runs" : undefined}
            />

            <div data-tour="order-status" className="mb-6 grid gap-3 rounded-lg border border-rule bg-card p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
              <State s={cap?.paypal_status ?? o.status} className="justify-self-start" />
              <p className="text-sm">
                {unpaid
                  ? o.paypal_order_id
                    ? "A PayPal checkout was started but not approved. If you closed PayPal, pay again; if you approved, this updates within a minute once PayPal confirms."
                    : "Nothing has been charged."
                  : cap
                    ? `PayPal says ${cap.paypal_status ?? "completed"}. Everyday read the capture back before recording it.`
                    : `Status: ${stateOf(o.status)[1]}.`}
                {o.paid_via === "demo_wallet" && !unpaid && " Paid from the demo's saved sandbox wallet, with no PayPal login."}
                {o.repaired && " This order was recovered from PayPal's own record after the return redirect was lost."}
                {o.exception && <span className="block text-stop">{o.exception}</span>}
              </p>
              {cap?.paypal_id && (
                <span className="text-xs text-ink-2" data-detail>
                  capture <span className="id text-ink">{cap.paypal_id}</span>
                </span>
              )}
            </div>

            {d.held.map((a) => (
              <ApprovalCard key={a.id} a={a} reload={st.reload} next={`/orders/${o.id}`} className="mb-6" />
            ))}
            {unpaid && (
              <div className="mb-6">
                <PayChoice className="max-w-md" cents={o.total_cents} busy={busy} run={run} wallet={{ path: `/orders/${o.id}/pay-demo` }} page={{ path: `/orders/${o.id}/pay` }} />
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <div className="min-w-0 space-y-4">
                <h2 className="text-xl font-medium">Items</h2>
                {d.lines.map((l, k) => (
                  <LineCard key={l.id} l={l} first={k === 0} deadline={d.intent?.deadline ?? null} reload={st.reload} today={today} />
                ))}

                {d.cases.length > 0 && (
                  <section id="cases" className="scroll-mt-24 space-y-3">
                    <h2 className="text-xl font-medium">Cases</h2>
                    {d.cases.map((c) => (
                      <article key={c.id} className="rounded-lg border border-rule bg-card p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="id font-semibold">{c.number}</span>
                          <State s={c.status} />
                          <span className="text-sm text-ink-2">{words(c.issue)}</span>
                        </div>
                        <p className="mt-2">{c.claim}</p>
                        <dl className="mt-2 grid gap-1 text-sm">
                          {c.observations.length > 0 && (
                            <div>
                              <dt className="inline font-semibold">Observed: </dt>
                              <dd className="inline">{c.observations.join(" ")}</dd>
                            </div>
                          )}
                          {c.missing.length > 0 && (
                            <div>
                              <dt className="inline font-semibold">Still needed: </dt>
                              <dd className="inline">{c.missing.map((m) => m.question).join(" ")}</dd>
                            </div>
                          )}
                          <div>
                            <dt className="inline font-semibold">{c.issue === "price_drop" ? "Price promise" : "Return"}: </dt>
                            <dd className="inline">
                              {c.eligibility?.eligible ? `eligible${c.eligibility.until ? ` until ${day(String(c.eligibility.until).slice(0, 10))}` : ""}` : "not eligible"}
                              {c.eligibility?.reasons?.length ? ` — ${c.eligibility.reasons.join(" ")}` : ""}
                            </dd>
                          </div>
                        </dl>
                        {c.status === "choose" && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {c.options.map((op) => (
                              <Button key={op.key} size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => run(op.key, `/cases/${c.id}/remedy`, { key: op.key }, { stay: true })}>
                                <Busy on={busy === op.key}>{null}</Busy>
                                {op.label}
                              </Button>
                            ))}
                          </div>
                        )}
                        {c.requested && (
                          <p className="mt-3 text-sm text-ink-2">
                            You asked for: {words(c.requested)} · the shop {c.merchant_decision ? (c.merchant_decision.approve ? "approved" : "declined") : "is reviewing"}
                            {c.refund_cents ? ` · refund ${money(c.refund_cents)}` : ""}
                            {c.status === "resolved" && c.refund_cents ? " · confirmed by PayPal" : ""}
                          </p>
                        )}
                      </article>
                    ))}
                  </section>
                )}
              </div>

              <aside className="space-y-6">
                <Panel title="Money">
                  <KV
                    rows={[
                      ["Paid", money(o.gross_cents)],
                      ["Refunded", money(o.refunded_cents)],
                      ["Net", <b key="n">{money((o.gross_cents ?? 0) - (o.refunded_cents ?? 0))}</b>],
                      ...(o.fee_cents !== null ? ([["Shop's PayPal fee", money(o.fee_cents)]] as [React.ReactNode, React.ReactNode][]) : []),
                    ]}
                  />
                </Panel>
                <Panel title="Payment record" sub={session?.demo ? "Every call to PayPal, in order, at the real time it was made (not the demo clock)." : "Every call to PayPal, in order."}>
                  {d.ops.length ? (
                    <ol className="relative space-y-3 border-l border-rule-2 pl-5">
                      {d.ops.map((x, k) => (
                        <li key={k} className="relative text-sm">
                          <span className="absolute top-0.5 -left-[27px] rounded-full bg-card p-0.5">
                            <Dot tone={stateOf(x.status)[0]} />
                          </span>
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-medium">{words(x.kind)}</span>
                            <Amount cents={x.amount_cents} />
                          </div>
                          <div className="text-xs text-ink-2">
                            {stateOf(x.status)[1]}
                            {x.paypal_status ? ` · PayPal ${x.paypal_status}` : ""} · {when(x.created_at)}
                          </div>
                          {x.reason && <div className="text-xs">{x.reason}</div>}
                          {x.status === "failed" && x.error && <div className="text-xs text-stop">{x.error.slice(0, 160)}</div>}
                          <div className="id mt-0.5 text-[11px] text-ink-2" data-detail>
                            {x.paypal_id ?? "—"} · {x.request_id}
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-sm text-ink-2">No PayPal calls yet.</p>
                  )}
                  {d.runs[0] && (
                    <GoLink to={`/trace/${d.runs[0].id}`} className="mt-3">
                      Full trace
                    </GoLink>
                  )}
                </Panel>
                <TrustStrip className="sm:grid-cols-1 sm:divide-x-0 sm:divide-y" ai="Reads a case's words and photo note, never the refund amount." code="Checks the return window and the policy version you bought under." paypal="Captures and refunds, read back before they count." />
              </aside>
            </div>

            <Panel title="What happened" className="mt-6">
              <ol className="space-y-2 text-sm">
                {d.events.map((e) => (
                  <li key={e.id} className="grid gap-x-3 sm:grid-cols-[9rem_1fr]">
                    <span className="num text-xs text-ink-2">{e.wall ? when(e.wall) : ""}</span>
                    <span>
                      {e.summary} <span className="text-xs text-ink-2">· {e.actor}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel title="Got a message about this?" sub="A text about a delivery fee, a seller asking you to pay somewhere else, a refund that needs your code: paste it here. Everyday never asks you to pay anywhere but PayPal's own page." className="mt-6">
              <ScamCheck context={`order:${d.order.id}`} compact />
            </Panel>
          </div>
        );
      }}
    </Loaded>
  );
}
