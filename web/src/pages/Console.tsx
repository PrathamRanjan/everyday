import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Bug, FlaskConical, Send } from "lucide-react";
import { Busy, Empty, Loaded, PageHead, Panel, Stat, State } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction, useApi } from "@/lib/api";
import { money, words } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t, N_, tn } from "@/i18n";

const ConsoleNav = () => (
  <nav aria-label={t("Console")} className="mb-6 flex flex-wrap gap-2 text-sm">
    {[
      ["/console", N_("Preference model")],
      ["/console/evidence", N_("Evidence")],
      ["/console/eval", N_("Eval rows")],
      ["/telegram", N_("Telegram simulator")],
    ].map(([to, l]) => (
      <Link key={to} to={to} className={cn("inline-flex min-h-10 items-center rounded-full border px-3", location.pathname === to ? "border-ink bg-ink text-paper" : "border-rule-2 hover:bg-sunk")}>
        {t(l)}
      </Link>
    ))}
  </nav>
);

interface ConsoleData {
  report: null | { metric: string; data: string; train_shoppers: number; test_shoppers: number; train_pairs: number; seeds: number[]; popularity: { mean: number; spread: number }; global: { mean: number; spread: number }; personal: Record<string, { mean: number; spread: number }>; promote_personal: boolean; gain_at_5: number };
  manifest: unknown;
  weights: { feature: string; label: string; w: number }[];
  events: { id: number; reason: string; eligible: boolean; excluded_reason: string | null; chosen: string | null; a_product: string; b_product: string; at: string; bt: string }[];
}

const Bar = ({ v }: { v: number }) => (
  <span className="block h-2 w-full rounded-full bg-sunk">
    <span className="block h-2 rounded-full bg-ink" style={{ width: `${Math.min(100, Math.max(0, v * 100))}%` }} />
  </span>
);

export default function Console() {
  const st = useApi<ConsoleData>("/api/ui/console");
  const { run, busy } = useAction(st.reload);
  return (
    <div className="ev-rise">
      <PageHead eyebrow={t("Operator console · demo only")} title={t("Under the hood")} />
      <ConsoleNav />
      <Loaded state={st}>
        {(d) => (
          <div className="grid gap-6 lg:grid-cols-2">
            {d.report ? (
              <Panel title={t("Preference model ({0})", d.report.metric)} sub={t("{0}. {1} training / {2} held-out shoppers, {3} pairs, seeds {4}.", d.report.data, d.report.train_shoppers, d.report.test_shoppers, d.report.train_pairs, d.report.seeds.join(", "))} className="lg:col-span-2">
                <ul className="space-y-2 text-sm">
                  {[[t("Popularity (win rate)"), d.report.popularity] as const, [t("Global logistic prior"), d.report.global] as const, ...Object.entries(d.report.personal).map(([k, v]) => [t("Personal after {0} choices", k), v] as const)].map(([l, v]) => (
                    <li key={l} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2.75rem_2.75rem] items-center gap-2 sm:grid-cols-[12rem_1fr_4rem_4rem] sm:gap-3">
                      <span>{l}</span>
                      <Bar v={v.mean} />
                      <span className="num text-right">{v.mean}</span>
                      <span className="num text-right text-xs text-ink-2">±{v.spread}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <State s={d.report.promote_personal ? "succeeded" : "failed"} label={d.report.promote_personal ? "promoted" : t("not promoted")} />
                  {d.report.promote_personal ? t("Personalisation gains {0} NDCG after 5 choices, more than the global model's seed-to-seed spread.", d.report.gain_at_5) : t("The gain doesn't beat seed noise; the simpler model stays.")}
                </p>
              </Panel>
            ) : (
              <Empty title={t("No model trained yet.")} />
            )}
            <Panel title={t("Global prior weights")}>
              <ul className="max-h-80 divide-y divide-rule overflow-y-auto text-sm">
                {d.weights.map((w) => (
                  <li key={w.feature} className="grid grid-cols-[1fr_auto] gap-2 py-1.5">
                    <span>
                      {w.feature} <span className="text-xs text-ink-2">{w.label}</span>
                    </span>
                    <span className="num">{w.w.toFixed(3)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title={t("Latest explicit choices")}>
              <ul className="max-h-80 divide-y divide-rule overflow-y-auto text-sm">
                {d.events.map((e) => (
                  <li key={e.id} className="py-1.5">
                    {e.chosen === e.a_product ? (
                      <>
                        <b>{e.at}</b>{" "}{tn("over {0}", e.bt)}
                      </>
                    ) : e.chosen === e.b_product ? (
                      <>
                        <b>{e.bt}</b>{" "}{tn("over {0}", e.at)}
                      </>
                    ) : (
                      `${e.at} / ${e.bt}`
                    )}{" "}
                    <span className="text-xs text-ink-2">
                      · {words(e.reason)} · {e.eligible ? t("used") : t("not used: {0}", e.excluded_reason)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel id="lab" title={<span className="inline-flex items-center gap-2"><Bug className="size-5" />{t("Failure lab")}</span>} sub={t("Each arms a one-shot fault on the next matching PayPal call. The money still moves once, and the order's history explains the recovery.")} className="lg:col-span-2">
              <div className="flex flex-wrap gap-2">
                {[
                  ["drop_return", N_("Drop the next PayPal return")],
                  ["capture_lost", N_("Lose the next capture response")],
                  ["refund_503", N_("Fail the next refund (503)")],
                ].map(([f, l]) => (
                  <Button key={f} variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => run(f, "/console/fault", { f }, { stay: true })}>
                    <Busy on={busy === f}>{null}</Busy>
                    {t(l)}
                  </Button>
                ))}
                <Button size="sm" disabled={Boolean(busy)} onClick={() => run("rec", "/console/run", undefined, { stay: true })}>
                  <Busy on={busy === "rec"}>{null}</Busy>{t("Run reconciliation now")}
                </Button>
              </div>
            </Panel>
          </div>
        )}
      </Loaded>
    </div>
  );
}

interface Arm { arm: string; cases: number; correct: number; traps: number; traps_caught: number; naive_usd: number; paid_usd: number; cost_usd: number; p50_ms: number }
interface EvidenceData {
  real: Record<string, number>;
  capture: Arm[];
  runs?: { capture: { source: string; run_on: string | null; provider: string | null } | null; adversarial: { source: string; run_on: string | null; provider: string | null } | null };
  adversarial: Arm[];
  ai: { calls: number; ok: number; cost_usd: number; by_purpose: { purpose: string; calls: number; cost_usd: number; p50_ms: number }[] };
  chain: { ok: boolean; rows: number; head: string; broken_at: number | null };
  techjam: string | null;
  paypal: boolean;
  provider: string;
  channel3: boolean;
  telegram: boolean;
  push: boolean;
  has_openai: boolean;
}

function ArmTable({ arms }: { arms: Arm[] }) {
  return (
    <div className="rail-scroll" tabIndex={0} role="region" aria-label={t("Table (scrolls sideways)")}>
      <table className="num w-full min-w-[620px] text-sm">
        <thead>
          <tr className="border-b border-rule text-left text-xs text-ink-2 uppercase">
            {[t("Arm"), t("Cases"), t("Correct"), t("Traps"), t("Caught"), t("$ naive"), t("$ moved"), "p50"].map((h) => (
              <th key={h} className="py-2 pr-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {arms.map((a) => (
            <tr key={a.arm} className="border-b border-rule last:border-0">
              <td className="py-1.5 pr-3 font-semibold">{a.arm}</td>
              <td className="pr-3">{a.cases}</td>
              <td className="pr-3">{a.correct}</td>
              <td className="pr-3">{a.traps}</td>
              <td className="pr-3">{a.traps_caught}</td>
              <td className="pr-3">{a.naive_usd.toFixed(2)}</td>
              <td className="pr-3">{a.paid_usd.toFixed(2)}</td>
              <td>{tn("{0} ms", a.p50_ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Evidence() {
  const st = useApi<EvidenceData>("/api/ui/evidence");
  const { run, busy } = useAction(st.reload);
  return (
    <div className="ev-rise">
      <PageHead eyebrow={t("Operator console · demo only")} title={t("Evidence")} lede={t("What's real, what's simulated, and what the evals measured on this instance.")} />
      <ConsoleNav />
      <Loaded state={st}>
        {(d) => (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={t("PayPal captures")} value={d.real.captures} />
              <Stat label={t("Refunds sent")} value={d.real.refunds} />
              <Stat label={t("Model calls")} value={d.ai.calls} hint={t("{0} ok · about ${1}", d.ai.ok, d.ai.cost_usd.toFixed(3))} />
              <Stat label={t("Assistant runs")} value={d.real.runs} />
              <Stat label={t("Repeat buys paid")} value={d.real.repeats_paid} />
              <Stat label={t("Held or refused")} value={d.real.repeats_stopped} tone="now" />
              <Stat label={t("Saved PayPals")} value={d.real.vaults} />
              <Stat label={t("Disputes")} value={d.real.disputes} />
            </div>
            <Panel title={t("Real vs simulated")}>
              <dl className="grid gap-3 text-sm sm:grid-cols-[9rem_1fr]">
                <dt className="font-semibold">{t("PayPal")}</dt>
                <dd>{tn("Sandbox REST: orders, captures, refunds, vault and payment tokens, merchant-initiated captures, tracking, disputes with evidence, transaction search, negative-test mocks. {0} No live money.", d.paypal ? t("Credentials present.") : t("No credentials here: the fake client is in use."))}</dd>
                <dt className="font-semibold">{t("Models")}</dt>
                <dd>
                  {tn("{0}. {1} Models read screenshots, covers, requests and mandates; they never set a price, a refund or a payee.", d.provider, d.ai.by_purpose.map((p) => `${words(p.purpose)} ×${p.calls} (p50 ${p.p50_ms} ms)`).join(" · ") || t("No calls recorded yet."))}
                </dd>
                <dt className="font-semibold">{t("Catalog")}</dt>
                <dd>{tn("Seeded Northlight catalog; the three demo clips have authored objects. Channel3 {0}.", d.channel3 ? t("live") : t("not configured"))}</dd>
                <dt className="font-semibold">{t("Channels")}</dt>
                <dd>
                  {tn("Telegram {0} · Web push {1} · the message log is always on.", d.telegram ? t("live") : t("not configured"), d.push ? t("live") : t("not configured"))}
                </dd>
                <dt className="font-semibold">{t("Audit chain")}</dt>
                <dd>
                  {d.chain.ok ? t("intact, {0} rows", d.chain.rows) : t("broken at row {0}", d.chain.broken_at)} · <span className="id">{d.chain.head.slice(0, 16)}…</span>
                </dd>
              </dl>
            </Panel>
            <Panel
              title={t("Capture reader eval")}
              sub={t("Synthetic frames through the caption-only rules arm, the vision model (grounded and quarantined by code) and the oracle.")}
              action={
                <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => run("cap", "/console/eval", { suite: "capture" }, { stay: true })}>
                  <Busy on={busy === "cap"}>
                    <FlaskConical className="size-4" />
                  </Busy>
                  {t("Run")}
                </Button>
              }
            >
              {d.capture.length ? <ArmTable arms={d.capture} /> : <p className="text-sm text-ink-2">{t("Not run on this instance yet.")}</p>}
              {d.runs?.capture?.run_on && <p className="mt-2 text-xs text-ink-2">{tn("From {0}, run on {1} with {2}.", d.runs.capture.source, d.runs.capture.run_on.slice(0, 10), d.runs.capture.provider)}</p>}
            </Panel>
            <Panel
              title={t("Adversarial money harness")}
              sub={t("Hostile and malformed money moves through the live gate. Every one must be denied, refused or held.")}
              action={
                <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => run("adv", "/console/eval", { suite: "adversarial" }, { stay: true })}>
                  <Busy on={busy === "adv"}>
                    <FlaskConical className="size-4" />
                  </Busy>
                  {t("Run")}
                </Button>
              }
            >
              {d.adversarial.length ? <ArmTable arms={d.adversarial} /> : <p className="text-sm text-ink-2">{t("Not run on this instance yet.")}</p>}
              {d.runs?.adversarial?.run_on && <p className="mt-2 text-xs text-ink-2">{tn("From {0}, run on {1} ({2}).", d.runs.adversarial.source, d.runs.adversarial.run_on.slice(0, 10), d.runs.adversarial.provider)}</p>}
            </Panel>
            <Panel title={t("Shopping chat test")}>{d.techjam ? <pre tabIndex={0} className="rail-scroll rounded-md bg-sunk p-3 text-xs whitespace-pre">{d.techjam}</pre> : <p className="text-sm text-ink-2">{t("Not run yet.")}</p>}</Panel>
          </div>
        )}
      </Loaded>
    </div>
  );
}

interface EvalData { suite: string; total: number; arms: string[]; kinds: string[]; rows: { id: number; case_id: string; arm: string; expected: string; actual: string; correct: boolean; kind: string; naive: number; ours: number; ms: number; detail: string }[]; count: number }

export function Eval() {
  const [sp, setSp] = useSearchParams();
  const suite = sp.get("suite") ?? "capture";
  const arm = sp.get("arm") ?? "";
  const outcome = sp.get("outcome") ?? "";
  const st = useApi<EvalData>(`/api/ui/eval?${new URLSearchParams({ suite, ...(arm ? { arm } : {}), ...(outcome ? { outcome } : {}) })}`);
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k === "suite") n.delete("arm");
    setSp(n);
  };
  return (
    <div className="ev-rise">
      <PageHead eyebrow={t("Operator console · demo only")} title={t("Eval rows")} />
      <ConsoleNav />
      <div className="mb-4 flex flex-wrap gap-3">
        <Tabs value={suite} onValueChange={(v) => set("suite", v)}>
          <TabsList className="bg-sunk">
            <TabsTrigger value="capture">{t("Capture")}</TabsTrigger>
            <TabsTrigger value="adversarial">{t("Adversarial")}</TabsTrigger>
            <TabsTrigger value="techjam">{t("Shopping chat")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={outcome || "all"} onValueChange={(v) => set("outcome", v === "all" ? "" : v)}>
          <TabsList className="bg-sunk">
            <TabsTrigger value="all">{t("All")}</TabsTrigger>
            <TabsTrigger value="correct">{t("Correct")}</TabsTrigger>
            <TabsTrigger value="wrong">{t("Wrong")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <Loaded state={st}>
        {(d) => (
          <>
            {d.arms.length > 1 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {["", ...d.arms].map((a) => (
                  <button key={a || "all"} onClick={() => set("arm", a)} className={cn("min-h-9 rounded-full border px-3 text-xs", arm === a ? "border-ink bg-ink text-paper" : "border-rule-2")}>
                    {a || t("every arm")}
                  </button>
                ))}
              </div>
            )}
            <p className="num mb-2 text-sm text-ink-2">
              {tn("{0} of {1} rows", d.count, d.total)}
            </p>
            {d.rows.length ? (
              <div className="rail-scroll rounded-lg border border-rule bg-card" tabIndex={0} role="region" aria-label={t("Eval rows (scrolls sideways)")}>
                <table className="w-full min-w-[760px] text-xs">
                  <thead>
                    <tr className="border-b border-rule text-left text-ink-2 uppercase">
                      {[t("Case"), t("Arm"), t("Kind"), t("Expected"), t("Actual"), "", t("$ naive / ours"), "ms"].map((h) => (
                        <th key={h} className="px-2 py-2 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="num">
                    {d.rows.map((r) => (
                      <tr key={r.id} className="border-b border-rule align-top last:border-0">
                        <td className="id px-2 py-1.5">{r.case_id}</td>
                        <td className="px-2">{r.arm}</td>
                        <td className="px-2">{r.kind}</td>
                        <td className="px-2">{r.expected}</td>
                        <td className="px-2">
                          {r.actual}
                          {r.detail && <span className="block text-ink-2">{r.detail}</span>}
                        </td>
                        <td className="px-2">
                          <State s={r.correct ? "done" : "failed"} label={r.correct ? "right" : "wrong"} />
                        </td>
                        <td className="px-2">
                          {money(r.naive)} / {money(r.ours)}
                        </td>
                        <td className="px-2">{r.ms}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title={t("No rows for this filter.")} />
            )}
          </>
        )}
      </Loaded>
    </div>
  );
}

interface TgData { chat: string; linked: boolean; live: boolean; messages: { at: number; me: boolean; text: string; buttons: { text: string; data: string | null; url: string | null }[] | null }[] }

export function Telegram() {
  const [sp] = useSearchParams();
  const chat = sp.get("chat") ?? "555001";
  const st = useApi<TgData>(`/api/ui/telegram?chat=${chat}`);
  const { run, busy } = useAction(st.reload);
  const [text, setText] = useState("");
  return (
    <div className="ev-rise">
      <PageHead eyebrow={t("Operator console · demo only")} title={t("Telegram simulator")} lede={t("Posts the same updates Telegram would to the real bot code. Try sending a Reel link, then “pending”.")} />
      <ConsoleNav />
      <Loaded state={st}>
        {(d) => (
          <div className="mx-auto max-w-lg rounded-xl border border-rule bg-sunk p-3">
            <p className="num mb-3 text-center text-xs text-ink-2">
              {tn("chat {0} · {1} · {2}", d.chat, d.linked ? t("linked to a shopper") : t("not linked: send “/start everyday-<code>” from Things I own"), d.live ? t("bot token present") : t("no bot token: simulator only"))}
            </p>
            <ol className="flex flex-col gap-2">
              {d.messages.map((m, k) => (
                <li key={k} className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", m.me ? "self-start bg-card" : "self-end bg-ink text-paper")}>
                  <p className="break-words whitespace-pre-wrap">{m.text}</p>
                  {m.buttons && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.buttons.map((b, j) =>
                        b.url ? (
                          <Link key={j} to={b.url} className="inline-flex min-h-9 items-center rounded-full border border-rule-2 bg-paper px-3 text-xs text-ink">
                            {b.text}
                          </Link>
                        ) : (
                          <button key={j} disabled={Boolean(busy)} onClick={() => run(`cb${k}${j}`, "/telegram/send", { chat: d.chat, callback: b.data ?? "" }, { stay: true })} className="min-h-9 rounded-full border border-rule-2 bg-paper px-3 text-xs text-ink">
                            {b.text}
                          </button>
                        ),
                      )}
                    </div>
                  )}
                </li>
              ))}
              {!d.messages.length && <li className="text-center text-sm text-ink-2">{t("No messages yet.")}</li>}
            </ol>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run("send", "/telegram/send", { chat: d.chat, text }, { stay: true }).then(() => setText(""));
              }}
            >
              <Label htmlFor="tg" className="sr-only">
                {t("Message")}
              </Label>
              <Input id="tg" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Message the bot")} className="min-h-11 bg-card" required />
              <Button type="submit" disabled={Boolean(busy) || !text.trim()} aria-label={t("Send")}>
                <Busy on={busy === "send"}>
                  <Send className="size-4" />
                </Busy>
              </Button>
            </form>
          </div>
        )}
      </Loaded>
    </div>
  );
}
