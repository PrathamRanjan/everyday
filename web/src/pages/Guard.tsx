import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Fingerprint, Link2, OctagonX, Power, ShieldCheck, Sparkles } from "lucide-react";
import { ApprovalCard, type ApprovalView } from "@/components/Approval";
import { Amount, Busy, Empty, Loaded, PageHead, Panel, Stat, State } from "@/components/kit";
import { SpeakableText } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAction, useApi } from "@/lib/api";
import { money, when, words } from "@/lib/format";
import { passkeySupported, registerPasskey } from "@/lib/passkey";

type Rule = { key: string; label: string; value: unknown };
interface Audit { seq: number; kind: string; entity: string; entity_id: string; hash: string; at: string }
export interface GuardCommon {
  policy: { text: string; compiler: string; unexpressed: string[] } | null;
  rules: Rule[];
  kill: { engaged: boolean; reason: string | null };
  approvals: ApprovalView[];
  countersign_cents: number;
  passkey: boolean;
  chain: { ok: boolean; rows: number; head: string; broken_at: number | null };
  audit: Audit[];
}
interface GuardData extends GuardCommon {
  backtest: { days: number; purchases: number; run: number; wait: number; deny: number; auto_cents: number; held_cents: number; recovered_cents: number; approve_above_cents: number };
  candidate: string | null;
  suggestions: { field: string; current: unknown; suggested: unknown; basis: string; label: string }[];
  suggestions_payload: string;
  agent_kills: { scope: string; engaged: boolean; reason: string | null }[];
  runs: { id: string; subject: string; status: string; actor: string; started_at: string; steps: number }[];
  drafts: { id: string; active: boolean; compiler: string; text: string; created_at: string }[];
}

export function ruleValue(v: unknown, key: string) {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.map((x) => words(String(x))).join(", ") : key === "allowed_merchants" ? "Any shop" : "Nothing blocked";
  if (typeof v === "number") return key.endsWith("_pct") ? `${v}%` : money(v);
  return String(v ?? "—");
}

export function RulesList({ rules }: { rules: Rule[] }) {
  return (
    <dl className="divide-y divide-rule">
      {rules.map((r) => (
        <div key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5">
          <dt className="min-w-0 flex-1 text-sm">{r.label}</dt>
          <dd className="num font-semibold">{ruleValue(r.value, r.key)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function KillSwitch({ kill, path, scope, reload, who }: { kill: { engaged: boolean; reason: string | null }; path: string; scope?: string; reload: () => Promise<void>; who: string }) {
  const { run, busy } = useAction(reload);
  const [reason, setReason] = useState("");
  return (
    <div className={kill.engaged ? "rounded-lg border border-stop bg-stop-bg p-4" : "rounded-lg border border-rule bg-card p-4"}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={kill.engaged ? "text-stop" : "text-ink-2"}>{kill.engaged ? <OctagonX className="size-6" /> : <Power className="size-6" />}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{kill.engaged ? "Kill switch is ON. No money moves." : "Kill switch"}</p>
          <p className="text-sm text-ink-2">{kill.engaged ? `Reason: ${kill.reason ?? "none given"}. Every payment, refund and repeat buy is refused before PayPal is called.` : `One switch stops every money move ${who}. Nothing is lost; it all waits.`}</p>
        </div>
        {kill.engaged ? (
          <Button variant="outline" disabled={Boolean(busy)} onClick={() => run("k", path, { scope, engaged: "0" }, { stay: true })}>
            <Busy on={busy === "k"}>{null}</Busy>Release
          </Button>
        ) : (
          <form
            className="flex w-full flex-wrap gap-2 sm:w-auto"
            onSubmit={(e) => {
              e.preventDefault();
              void run("k", path, { scope, engaged: "1", reason }, { stay: true });
            }}
          >
            <Label htmlFor="kill-reason" className="sr-only">
              Reason
            </Label>
            <input id="kill-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="min-h-11 min-w-0 flex-1 rounded-md border border-rule-2 bg-card px-3 text-sm" />
            <Button type="submit" variant="destructive" disabled={Boolean(busy)}>
              <Busy on={busy === "k"}>{null}</Busy>Stop all money moves
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export function AuditChain({ chain, audit }: { chain: GuardCommon["chain"]; audit: Audit[] }) {
  return (
    <Panel title="Tamper-evident log" sub={chain.ok ? `${chain.rows} entries; every hash checks out.` : `Broken at entry ${chain.broken_at}.`}>
      <div className="mb-3 flex items-center gap-2">
        <State s={chain.ok ? "done" : "failed"} label={chain.ok ? "chain verified" : "chain broken"} />
        <span className="id truncate text-xs text-ink-2" data-detail>
          head {chain.head.slice(0, 16)}…
        </span>
      </div>
      <ol className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
        {audit.map((x) => (
          <li key={x.seq} className="grid grid-cols-[2.5rem_1fr] gap-2">
            <span className="num text-xs text-ink-2">#{x.seq}</span>
            <span>
              {words(x.kind)} <span className="text-xs text-ink-2">· {when(x.at)}</span>
              <span className="id block text-[11px] text-ink-2" data-detail>
                {x.hash.slice(0, 20)}…
              </span>
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function PasskeyPanel({ has, countersign, merchant, reload }: { has: boolean; countersign: number; merchant?: boolean; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Panel title="Passkey" sub={`Anything above ${money(countersign)} needs a passkey on this device to approve.`}>
      {has ? (
        <p className="flex items-center gap-2 text-sm">
          <ShieldCheck className="size-4 text-done" /> A passkey is registered.
        </p>
      ) : passkeySupported() ? (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await registerPasskey(merchant);
              toast.success("Passkey registered.");
              await reload();
            } catch (e) {
              toast.error(`Passkey not registered: ${(e as Error).message}`);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Busy on={busy}>
            <Fingerprint className="size-4" />
          </Busy>
          Register a passkey
        </Button>
      ) : (
        <p className="text-sm text-ink-2">This browser doesn't support passkeys.</p>
      )}
    </Panel>
  );
}

export default function Guard() {
  const [threshold, setThreshold] = useState<number | null>(null);
  const [debounced, setDebounced] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(threshold), 250);
    return () => clearTimeout(t);
  }, [threshold]);
  const st = useApi<GuardData>(`/api/ui/guard${debounced ? `?approve_above_cents=${debounced}` : ""}`);
  const { run, busy } = useAction(st.reload);
  const [text, setText] = useState<string | null>(null);
  const [picks, setPicks] = useState<number[]>([]);
  return (
    <Loaded state={st}>
      {(d) => {
        const bt = d.backtest;
        const cur = Number(d.rules.find((r) => r.key === "approve_above_cents")?.value ?? 0);
        return (
          <div className="ev-rise">
            <PageHead eyebrow="Rules and approvals" title="Your rules for money" lede="Write them in plain words. Code enforces them on every payment, refund and repeat buy, before PayPal is asked." needs={d.approvals.length ? `${d.approvals.length} waiting for you` : undefined} />
            {d.approvals.length > 0 && (
              <section className="mb-6 space-y-3" aria-label="Waiting for you">
                {d.approvals.map((a) => (
                  <ApprovalCard key={a.id} a={a} reload={st.reload} next="/guard" />
                ))}
              </section>
            )}
            <div className="mb-6">
              <KillSwitch kill={d.kill} path="/guard/kill" scope="account" reload={st.reload} who="for you" />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Panel title="Your mandate" sub={d.policy ? `Read by ${d.policy.compiler}.` : "Using the defaults."}>
                <div data-tour="rules">
                  {d.policy && <blockquote className="mb-3 border-l-2 border-rule-2 pl-3 text-sm text-ink-2 italic">{d.policy.text}</blockquote>}
                  <RulesList rules={d.rules} />
                  {d.policy?.unexpressed.length ? <p className="mt-2 rounded-md bg-wait-bg p-2 text-sm">Not enforced (couldn't be turned into a rule): {d.policy.unexpressed.join("; ")}</p> : null}
                </div>
              </Panel>
              <Panel title="Change it in words" id="drafts">
                <form
                  className="grid gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                  }}
                >
                  <Label htmlFor="mandate">Your mandate</Label>
                  <SpeakableText id="mandate" rows={4} value={text ?? d.policy?.text ?? ""} onChange={setText} placeholder="Never spend more than $400 on one purchase. Ask me before any repeat buy over $30. Only buy from Northlight." />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" disabled={Boolean(busy) || !(text ?? "").trim()} onClick={() => run("draft", "/guard/policy", { text: text ?? "", mode: "draft" }, { stay: true })}>
                      <Busy on={busy === "draft"}>{null}</Busy>Save as draft
                    </Button>
                    <Button type="button" disabled={Boolean(busy) || !(text ?? "").trim()} onClick={() => run("adopt", "/guard/policy", { text: text ?? "", mode: "adopt" }, { stay: true })}>
                      <Busy on={busy === "adopt"}>{null}</Busy>Adopt now
                    </Button>
                  </div>
                  <p className="text-xs text-ink-2">A model turns the words into rules; sentences it can't express are listed, never guessed.</p>
                </form>
                {d.drafts.filter((x) => !x.active).length > 0 && (
                  <ul className="mt-4 space-y-2 border-t border-rule pt-3 text-sm">
                    {d.drafts
                      .filter((x) => !x.active)
                      .slice(0, 4)
                      .map((x) => (
                        <li key={x.id} className="flex items-start gap-2">
                          <span className="min-w-0 flex-1 text-ink-2">
                            “{x.text.slice(0, 120)}” <span className="text-xs">· {when(x.created_at)}</span>
                          </span>
                          <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => run(x.id, `/guard/policy/${x.id}/activate`, undefined, { stay: true })}>
                            Adopt
                          </Button>
                        </li>
                      ))}
                  </ul>
                )}
              </Panel>

              <Panel title="What if?" sub={`Your last ${bt.days} days of purchases, replayed against a different approval line.`} className="lg:col-span-2">
                <div className="grid gap-4 md:grid-cols-[1fr_1.4fr] md:items-center">
                  <div>
                    <Label htmlFor="bt" className="flex items-baseline justify-between">
                      Ask me before repeat buys at or above <b className="num text-lg">{money(threshold ?? bt.approve_above_cents ?? cur)}</b>
                    </Label>
                    <Slider id="bt" className="mt-4" min={500} max={30000} step={500} value={[threshold ?? bt.approve_above_cents ?? cur]} onValueChange={([v]) => setThreshold(v)} aria-label="Approval line in cents" />
                    <div className="num mt-1 flex justify-between text-xs text-ink-2">
                      <span>$5</span>
                      <span>$300</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="Would run" value={bt.run} hint={money(bt.auto_cents)} tone="done" />
                    <Stat label="Would wait" value={bt.wait} hint={money(bt.held_cents)} tone="now" />
                    <Stat label="Refused" value={bt.deny} tone="stop" />
                  </div>
                </div>
                {d.candidate && threshold !== null && threshold !== cur && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
                    <p className="text-sm">
                      Move your approval line from <Amount cents={cur} /> to <Amount cents={threshold} strong />?
                    </p>
                    <Button size="sm" disabled={Boolean(busy)} onClick={() => run("cand", "/guard/adopt-rules", { rules: d.candidate! }, { stay: true }).then(() => setThreshold(null))}>
                      <Busy on={busy === "cand"}>{null}</Busy>Adopt this line
                    </Button>
                  </div>
                )}
              </Panel>

              {d.suggestions.length > 0 && (
                <Panel title={<span className="inline-flex items-center gap-2"><Sparkles className="size-5" />Earned trust</span>} sub="Based on what you've approved by hand. Nothing changes unless you pick it.">
                  <ul className="space-y-2">
                    {d.suggestions.map((s, k) => (
                      <li key={k}>
                        <label className="flex min-h-11 items-start gap-3 text-sm">
                          <Checkbox checked={picks.includes(k)} onCheckedChange={(v) => setPicks(v ? [...picks, k] : picks.filter((x) => x !== k))} className="mt-0.5" />
                          <span>
                            <b>{s.label}</b>: {ruleValue(s.current, s.field)} → {ruleValue(s.suggested, s.field)}
                            <span className="block text-xs text-ink-2">{s.basis}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <Button
                    size="sm"
                    className="mt-3"
                    disabled={!picks.length || Boolean(busy)}
                    onClick={() => void run("sug", "/guard/suggestions", { payload: d.suggestions_payload, pick: picks }, { stay: true })}
                  >
                    Adopt selected
                  </Button>
                </Panel>
              )}

              <PasskeyPanel has={d.passkey} countersign={d.countersign_cents} reload={st.reload} />
              <AuditChain chain={d.chain} audit={d.audit} />

              <Panel title="Assistants that acted for you" className="lg:col-span-2">
                {d.runs.length ? (
                  <ul className="divide-y divide-rule text-sm">
                    {d.runs.slice(0, 8).map((r) => (
                      <li key={r.id}>
                        <Link to={`/trace/${r.id}`} className="flex min-h-11 items-center gap-3 py-2 hover:underline">
                          <span className="min-w-0 flex-1 truncate">{r.subject}</span>
                          <span className="text-xs text-ink-2">{r.actor}</span>
                          <State s={r.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty title="No assistant runs yet.">Plans, checkouts and repeat buys each leave a trace here.</Empty>
                )}
                {d.agent_kills.length > 0 && (
                  <p className="mt-3 flex items-center gap-2 text-sm text-stop">
                    <Link2 className="size-4" /> Stopped assistants: {d.agent_kills.map((k) => k.scope.replace("agent:", "")).join(", ")}
                  </p>
                )}
              </Panel>
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}
