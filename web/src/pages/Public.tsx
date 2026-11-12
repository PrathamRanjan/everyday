import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { CircleCheck, CircleX, Copy, KeyRound } from "lucide-react";
import { Loaded, PageHead, Panel } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import { when } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t, tn } from "@/i18n";
import { SimulatedGaze, simulatedAccuracy } from "@/handsfree/Demo";

/** A3.2: the pages that need no sign-in. Each reads a committed result file or the showcase demo; nothing is typed in. */

const Table = ({ label, head, children, min = 640 }: { label: string; head: ReactNode[]; children: ReactNode; min?: number }) => (
  <div className="rail-scroll" tabIndex={0} role="region" aria-label={t("{0} (scrolls sideways)", label)}>
    <table className="w-full text-sm" style={{ minWidth: min }}>
      <thead>
        <tr className="border-b border-rule text-left text-xs tracking-wide text-ink-2 uppercase">
          {head.map((h, i) => (
            <th key={i} scope="col" className="py-2 pr-3 font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);
const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cn("py-2 pr-3 align-top", className)}>{children}</td>;
const Ok = ({ ok, label }: { ok: boolean; label?: string }) => (
  <span className={cn("inline-flex items-center gap-1 font-medium", ok ? "text-done" : "text-stop")}>
    {ok ? <CircleCheck className="size-4" aria-hidden /> : <CircleX className="size-4" aria-hidden />}
    {label ?? (ok ? t("pass") : t("fail"))}
  </span>
);
const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const dateOf = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

function Copyable({ text, label }: { text: string; label: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border border-rule bg-paper-2 p-3 pr-12 text-xs whitespace-pre-wrap break-all">{text}</pre>
      <button
        type="button"
        aria-label={t("Copy {0}", label)}
        className="absolute top-2 right-2 inline-flex size-9 items-center justify-center rounded-md border border-rule bg-card hover:bg-paper-2"
        onClick={() => void navigator.clipboard?.writeText(text).then(() => toast.success(t("Copied")), () => toast.error(t("Couldn't copy")))}
      >
        <Copy className="size-4" />
      </button>
    </div>
  );
}

// ---------------- /proof ----------------

interface SuiteCase { arm: string; id: string; input: string | null; expected: unknown; actual: unknown; reason: string | null; correct: boolean; trap: boolean; ms: number | null; model: string | null }
interface Suite { name: string; title: string; what: string; missing?: boolean; run_on?: string; provider?: string; arms?: { arm: string; cases: number; correct: number; p50_ms: number }[]; cases?: SuiteCase[] }
interface ProofData {
  built_from: string;
  models: { read: string; backup: string; small: string; decisions: string; connected: boolean };
  suites: Suite[];
  techjam: null | { title: string; what: string; run_on: string; systems: { system: string; cases: number; hit_rate_10: number; mrr: number; conversion: number; correct_abstain: number; false_abstain: number; avg_turns: number; technical_score: number }[]; cases: { id: string; kind: string; query: string; target: string | null; everyday: { hit10: boolean; rr: number; turns: number; converted: boolean; abstained: boolean; asked: string[] } | null; baseline: { hit10: boolean; rr: number } | null }[] };
  decisions: null | { title: string; what: string; run_on: string; model: string; thresholds: { name: string; clear_below: number; hold_above: number; held_out?: { n: number; precision: number; recall: number; false_clear: number; refused: number } }[]; not_calibrated: string[]; cases: { text: string; labels: Record<string, number>; answers: Record<string, number | null> | null }[] };
  model_card: { rows: { set: string; n: string; auc: string; caught_at_1pct: string; what: string }[]; note: string };
  robot_judge: null | { run_on: string; target: string; by: string; ok: boolean; stored: string; paths: { id: string; title: string; ok: boolean; seconds: number; error: string | null; steps: { key: string; label: string; done: boolean }[] }[] };
  not_measured: string[];
}

function SuitePanel({ s }: { s: Suite }) {
  const [open, setOpen] = useState(false);
  if (s.missing) return <Panel title={s.title}><p className="text-sm text-stop">{t("No result file yet: this check hasn't been run on this build.")}</p></Panel>;
  const cases = s.cases ?? [];
  const shown = open ? cases : cases.slice(0, 12);
  return (
    <Panel id={s.name} title={s.title} sub={t("Run {0} · {1}", dateOf(s.run_on), s.provider)}>
      <p className="mb-3 text-sm text-ink-2">{s.what}</p>
      <ul className="mb-3 flex flex-wrap gap-2 text-sm">
        {(s.arms ?? []).map((a) => (
          <li key={a.arm} className="rounded-md border border-rule px-2 py-1">
            <b>{a.arm}</b>{tn(": {0} of {1} correct{2}", a.correct, a.cases, a.p50_ms ? t(" · median {0} ms", a.p50_ms) : "")}
          </li>
        ))}
      </ul>
      <Table label={t("{0}: every case", s.title)} head={[t("Case"), t("Input"), t("Expected"), t("Answer"), t("Result")]} min={760}>
        {shown.map((c) => (
          <tr key={`${c.arm}-${c.id}`} className="border-b border-rule last:border-0">
            <Td className="font-mono text-xs">
              {c.id}
              <div className="text-ink-2">{c.arm}</div>
            </Td>
            <Td className="max-w-[16rem]">{c.input ?? "—"}</Td>
            <Td className="max-w-[14rem] text-ink-2">{show(c.expected)}</Td>
            <Td className="max-w-[18rem]">
              {show(c.actual)}
              {c.reason && <div className="text-xs text-ink-2">{c.reason}</div>}
              {c.model && <div className="text-xs text-ink-2">{c.model}</div>}
            </Td>
            <Td>
              <Ok ok={c.correct} />
            </Td>
          </tr>
        ))}
      </Table>
      {cases.length > 12 && (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setOpen((x) => !x)}>
          {open ? t("Show fewer") : t("Show all {0} cases", cases.length)}
        </Button>
      )}
    </Panel>
  );
}

export default function Proof() {
  const st = useApi<ProofData>("/api/public/proof");
  const [tjAll, setTjAll] = useState(false);
  const [decAll, setDecAll] = useState(false);
  return (
    <div className="ev-rise">
      <PageHead eyebrow={t("Proof")} title={t("Every check, every case")} lede={t("What was tested, every case with its answer, the models and the date each check ran, and what hasn't been measured. No sign-in needed.")} />
      <Loaded state={st}>
        {(d) => (
          <div className="space-y-6">
            <Panel title={t("Models")}>
              <p className="text-sm">
                {t("Reading requests and photos:")}{" "}<b>{d.models.read}</b>{" "}{tn("(backup {0}). Small jobs: {1}. Second reader for scams:", d.models.backup, d.models.small)}{" "}<b>{d.models.decisions}</b>{" "}{tn("on OpenAI's Decisions API. {0}", d.models.connected ? t("Connected on this instance.") : t("Not connected on this instance."))}
              </p>
              <p className="mt-2 text-xs text-ink-2">{d.built_from}</p>
            </Panel>
            {d.suites.map((s) => (
              <SuitePanel key={s.name} s={s} />
            ))}
            {d.decisions && (
              <Panel id="decisions" title={d.decisions.title} sub={t("Run {0} · {1}", dateOf(d.decisions.run_on), d.decisions.model)}>
                <p className="mb-3 text-sm text-ink-2">{d.decisions.what}</p>
                <Table label={t("Calibration")} head={[t("Question"), t("Clear below"), t("Hold from"), t("Held-out precision"), t("Held-out recall"), t("Held-out messages")]}>
                  {d.decisions.thresholds.map((t) => (
                    <tr key={t.name} className="num border-b border-rule last:border-0">
                      <Td className="font-mono text-xs">{t.name}</Td>
                      <Td>{t.clear_below}</Td>
                      <Td>{t.hold_above}</Td>
                      <Td>{t.held_out ? pct(t.held_out.precision) : "—"}</Td>
                      <Td>{t.held_out ? pct(t.held_out.recall) : "—"}</Td>
                      <Td>{t.held_out?.n ?? "—"}</Td>
                    </tr>
                  ))}
                </Table>
                {d.decisions.not_calibrated.length > 0 && <p className="mt-3 text-sm">{tn("Not calibrated (too few examples), so never used to hold or clear: {0}.", d.decisions.not_calibrated.join(", "))}</p>}
                <h3 className="mt-4 mb-2 text-sm font-semibold">{tn("Every labelled message ({0})", d.decisions.cases.length)}</h3>
                <Table label={t("Labelled messages")} head={[t("Message"), t("Labelled yes"), t("Model's probability for those")]} min={700}>
                  {(decAll ? d.decisions.cases : d.decisions.cases.slice(0, 10)).map((c, i) => {
                    const yes = Object.entries(c.labels).filter(([, v]) => v === 1).map(([k]) => k);
                    return (
                      <tr key={i} className="border-b border-rule last:border-0">
                        <Td className="max-w-[22rem]">{c.text}</Td>
                        <Td className="font-mono text-xs">{yes.join(", ") || t("none (genuine)")}</Td>
                        <Td className="num text-xs">{c.answers ? yes.map((k) => `${k}: ${c.answers?.[k] ?? "not decided"}`).join("; ") || "—" : "—"}</Td>
                      </tr>
                    );
                  })}
                </Table>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setDecAll((x) => !x)}>
                  {decAll ? t("Show fewer") : t("Show all {0} messages", d.decisions.cases.length)}
                </Button>
              </Panel>
            )}
            {d.techjam && (
              <Panel id="techjam" title={d.techjam.title} sub={t("Run {0} · no model", dateOf(d.techjam.run_on))}>
                <p className="mb-3 text-sm text-ink-2">{d.techjam.what}</p>
                <Table label={t("Systems")} head={[t("System"), t("Cases"), t("Found in top 10"), "MRR", t("Right item first"), t("Correctly said none"), t("Wrongly said none"), t("Turns")]} min={760}>
                  {d.techjam.systems.map((s) => (
                    <tr key={s.system} className="num border-b border-rule last:border-0">
                      <Td>{s.system}</Td>
                      <Td>{s.cases}</Td>
                      <Td>{pct(s.hit_rate_10)}</Td>
                      <Td>{s.mrr.toFixed(2)}</Td>
                      <Td>{pct(s.conversion)}</Td>
                      <Td>{pct(s.correct_abstain)}</Td>
                      <Td>{pct(s.false_abstain)}</Td>
                      <Td>{s.avg_turns.toFixed(2)}</Td>
                    </tr>
                  ))}
                </Table>
                <h3 className="mt-4 mb-2 text-sm font-semibold">{tn("Every case ({0})", d.techjam.cases.length)}</h3>
                <Table label={t("Search cases")} head={[t("Case"), t("Opening request"), t("Right item"), t("Everyday"), t("Questions asked"), t("Baseline")]} min={820}>
                  {(tjAll ? d.techjam.cases : d.techjam.cases.slice(0, 12)).map((c) => (
                    <tr key={c.id} className="border-b border-rule last:border-0">
                      <Td className="font-mono text-xs">
                        {c.id}
                        <div className="text-ink-2">{c.kind}</div>
                      </Td>
                      <Td>{c.query}</Td>
                      <Td className="font-mono text-xs">{c.target ?? t("none in the catalog")}</Td>
                      <Td>{c.everyday ? (c.target ? <Ok ok={c.everyday.converted} label={c.everyday.converted ? "first" : c.everyday.hit10 ? t("in top 10") : "missed"} /> : <Ok ok={c.everyday.abstained} label={c.everyday.abstained ? t("said none") : t("offered something")} />) : "—"}</Td>
                      <Td className="text-xs text-ink-2">{c.everyday?.asked.join(" · ") || t("none")}</Td>
                      <Td>{c.baseline ? (c.target ? (c.baseline.rr === 1 ? t("first") : c.baseline.hit10 ? t("in top 10") : t("missed")) : t("offered something")) : "—"}</Td>
                    </tr>
                  ))}
                </Table>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setTjAll((x) => !x)}>
                  {tjAll ? t("Show fewer") : t("Show all {0} cases", d.techjam.cases.length)}
                </Button>
              </Panel>
            )}
            <Panel title={t("Scam model on your device")} sub={t("From its model card")}>
              <Table label={t("Model card")} head={[t("Test set"), t("Messages"), "AUC", t("Caught at 1% genuine held"), t("What it is")]}>
                {d.model_card.rows.map((r) => (
                  <tr key={r.set} className="num border-b border-rule last:border-0">
                    <Td>{r.set}</Td>
                    <Td>{r.n}</Td>
                    <Td>{r.auc}</Td>
                    <Td>{r.caught_at_1pct}</Td>
                    <Td className="text-ink-2">{r.what}</Td>
                  </tr>
                ))}
              </Table>
              <p className="mt-3 text-sm">{d.model_card.note}</p>
            </Panel>
            <Panel title={t("Robot judge")}>
              {d.robot_judge ? (
                <>
                  <p className="mb-2 text-sm">
                    {tn("Last run {0} on {1}, by a {2}. It starts a fresh demo and walks every path on the judge page; a step counts only if it ticked itself from what really happened. {3}", when(d.robot_judge.run_on), d.robot_judge.target, d.robot_judge.by, d.robot_judge.stored)}
                  </p>
                  <ul className="space-y-2 text-sm">
                    {d.robot_judge.paths.map((p) => (
                      <li key={p.id}>
                        <Ok ok={p.ok} label={p.ok ? "completed" : "failed"} />{" "}{tn("{0} in {1} s", p.title, p.seconds)}
                        {p.error && <span className="block text-ink-2">{tn("Stopped: {0}", p.error)}</span>}
                        <span className="block text-ink-2">{p.steps.map((s) => `${s.done ? "✓" : "✗"} ${s.label}`).join(" · ")}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-ink-2">{t("No robot-judge run recorded on this build.")}</p>
              )}
            </Panel>
            <Panel title={t("Not measured")}>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {d.not_measured.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </Panel>
          </div>
        )}
      </Loaded>
    </div>
  );
}

// ---------------- /ai ----------------

interface AiData { showcase: { id: string; built: string } | null; connected: boolean; calls: { at: string; purpose: string; model: string; via: string; input: string | null; tools: { tool: string; source: string; ms: number | null }[]; output: string | null; error: string | null; ms: number; tokens_in: number; tokens_out: number; cost_usd: number; ok: boolean }[] }
const PURPOSE: Record<string, string> = { get read_request() { return t("Read a request"); }, get capture_frame() { return t("Read a photo"); }, get shopper_question() { return t("Assistant (Ask)"); }, get scam_check() { return t("Second scam reader"); }, get plan_question() { return t("Worded a question"); }, get compile_policy() { return t("Read spending rules"); }, get classify() { return t("Small job"); }, get eval() { return t("Evaluation"); } };

export function AiCalls() {
  const st = useApi<AiData>("/api/public/ai");
  return (
    <div className="ev-rise">
      <PageHead eyebrow={t("AI calls")} title={t("The last 20 model calls")} lede={t("From the showcase demo, which is rebuilt every night and asked a few real questions. Each row is one call: what it read, which tools it used, what came back, how long it took and what it cost.")} />
      <Loaded state={st}>
        {(d) =>
          !d.calls.length ? (
            <Panel>
              <p className="text-sm">{d.showcase ? t("The showcase hasn't made a model call since it was rebuilt.") : t("There's no showcase on this instance yet.")} {d.connected ? "" : t("No model is connected here.")}</p>
            </Panel>
          ) : (
            <Panel sub={d.showcase ? t("Showcase built {0}. Costs are estimates from list prices.", when(d.showcase.built)) : undefined}>
              <Table label={t("Model calls")} head={[t("When"), t("Job"), t("Model"), t("Read"), t("Tools"), t("Answer"), t("Time"), t("Cost")]} min={980}>
                {d.calls.map((c, i) => (
                  <tr key={i} className="border-b border-rule last:border-0">
                    <Td className="text-xs whitespace-nowrap">{when(c.at)}</Td>
                    <Td>{PURPOSE[c.purpose] ?? c.purpose.replace(/_/g, " ")}</Td>
                    <Td className="font-mono text-xs">
                      {c.model}
                      <div className="text-ink-2">{c.via}</div>
                    </Td>
                    <Td className="max-w-[14rem]">{c.input ?? "—"}</Td>
                    <Td className="max-w-[12rem] text-xs">{c.tools.length ? c.tools.map((t) => `${t.tool}${t.source === "paypal" ? " (PayPal MCP)" : ""}`).join(", ") : "—"}</Td>
                    <Td className="max-w-[18rem] font-mono text-xs break-words">{c.ok ? c.output : <span className="text-stop">{c.error}</span>}</Td>
                    <Td className="num whitespace-nowrap">{tn("{0} ms", c.ms)}</Td>
                    <Td className="num whitespace-nowrap">{c.cost_usd ? `$${c.cost_usd.toFixed(5)}` : t("not priced")}</Td>
                  </tr>
                ))}
              </Table>
            </Panel>
          )
        }
      </Loaded>
    </div>
  );
}

// ---------------- /paypal ----------------

interface PpData { env: string; connected: boolean; mcp_connected: boolean; showcase: { id: string; built: string } | null; apis: { key: string; api: string; endpoint: string; when: string; live: { id: string | null; at: string | null; note?: string } | null }[] }

export function PayPalApis() {
  const st = useApi<PpData>("/api/public/paypal");
  return (
    <div className="ev-rise">
      <PageHead eyebrow="PayPal" title={t("Every PayPal API Everyday uses")} lede={t("When each is called, and a live id from the showcase demo where one exists. All of it runs on PayPal's sandbox with test money.")} />
      <Loaded state={st}>
        {(d) => (
          <Panel sub={`${d.env === "sandbox" ? t("PayPal sandbox") : `PayPal ${d.env}`} · ${d.connected ? "connected" : t("not connected")}${d.showcase ? t(" · showcase built {0}", when(d.showcase.built)) : t(" · no showcase yet")}`}>
            <Table label={t("PayPal APIs")} head={["API", t("When Everyday calls it"), t("Live id in the showcase")]} min={760}>
              {d.apis.map((a) => (
                <tr key={a.key} className="border-b border-rule last:border-0">
                  <Td>
                    <b>{a.api}</b>
                    <div className="font-mono text-xs break-all text-ink-2">{a.endpoint}</div>
                  </Td>
                  <Td>{a.when}</Td>
                  <Td>
                    {a.live ? (
                      <>
                        {a.live.id && <span className="font-mono text-xs break-all">{a.live.id}</span>}
                        {a.live.note && <div className="text-xs text-ink-2">{a.live.note}</div>}
                        {a.live.at && <div className="text-xs text-ink-2">{when(a.live.at)}</div>}
                      </>
                    ) : (
                      <span className="text-ink-2">{t("None in the showcase yet")}</span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          </Panel>
        )}
      </Loaded>
    </div>
  );
}

// ---------------- /who-can-move-money ----------------

interface RolesData { rule: string; roles: { who: string; can: string[]; cannot: string[] }[] }

export function Roles() {
  const st = useApi<RolesData>("/api/public/roles");
  return (
    <div className="ev-rise">
      <PageHead eyebrow={t("Who can move money")} title={t("Who can do what with money")} lede={t("Every person, model and outside assistant that touches Everyday, with what each can and cannot do.")} />
      <Loaded state={st}>
        {(d) => (
          <div className="space-y-4">
            <Panel>
              <p className="font-medium">{d.rule}</p>
            </Panel>
            {d.roles.map((r) => (
              <Panel key={r.who} title={r.who}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-done">{t("Can")}</h3>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {r.can.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-stop">{t("Cannot")}</h3>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {r.cannot.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </Loaded>
    </div>
  );
}

// ---------------- /accessibility ----------------

interface A11yData { missing?: boolean; run_on?: string; target?: string; checks?: { id: string; title: string; how: string; ok: boolean; detail: string; pages?: number }[]; not_tested?: string[] }

export function Accessibility() {
  const st = useApi<A11yData>("/api/public/accessibility");
  return (
    <div className="ev-rise">
      <PageHead eyebrow={t("Accessibility")} title={t("What was tested, and how")} lede={t("Works with a keyboard, at 200% text and with reduced motion; every control has a name. Results come from the automated run recorded below, with its date. What wasn't tested is listed too.")} />
      <Loaded state={st}>
        {(d) =>
          d.missing ? (
            <Panel>
              <p className="text-sm text-stop">{t("No accessibility run is recorded on this build.")}</p>
            </Panel>
          ) : (
            <div className="space-y-6">
              <Panel title={t("Checks")} sub={t("Run {0} on {1}", when(d.run_on), d.target)}>
                <ul className="space-y-3">
                  {(d.checks ?? []).map((c) => (
                    <li key={c.id} className="rounded-md border border-rule p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Ok ok={c.ok} />
                        <b>{c.title}</b>
                      </div>
                      <p className="mt-1 text-ink-2">{c.how}</p>
                      <p className="mt-1">{c.detail}</p>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title={t("Not tested")}>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {(d.not_tested ?? []).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </Panel>
            </div>
          )
        }
      </Loaded>
      <HandsFreeAbout />
    </div>
  );
}

/** A9: hands-free on the accessibility page: what it does, how it is kept safe, and what is and isn't measured. */
function HandsFreeAbout() {
  const sim = useMemo(() => simulatedAccuracy(), []);
  return (
    <div className="mt-6 space-y-6" id="hands-free">
      <Panel title={t("Hands-free: look and say")} sub={t("The hand button in the header, or Alt+Shift+H. Off until you turn it on.")}>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>{t("Eyes + voice: nine dots calibrate where you look; the point snaps to the button you mean. Hold your look until the ring fills, wink, or say “Peek, click”.")}</li>
          <li>{t("Head + voice: no calibration; turn your head to move the point. For glasses, low light, or when eye tracking isn't accurate enough.")}</li>
          <li>{t("Voice only: no camera. “Peek, scroll down”, “Peek, go to plans”, “Peek, click Plan it”, “Peek, what needs me?”. Works in English, हिन्दी, Bahasa Indonesia and Português.")}</li>
          <li>{t("Stopping: Esc, the word “stop” (or रुको, berhenti, pare) at any time, the Stop button, or looking away for two seconds. A real mouse or touch takes over at once. Blinks never click.")}</li>
          <li>{t("Money: “Peek, claim my price drop” or “Peek, pay this” only names the amount. Nothing moves until you say “confirm”; the server checks the amount again, and the confirmation works once, for one minute. Deleting and cancelling are done by hand. Ten voice steps in a row, then a tap.")}</li>
          <li>{t("PayPal's own page: by voice, Everyday opens it for you, but you sign in and approve there yourself. Everyday never sees or types your PayPal password.")}</li>
          <li>{t("Privacy: the camera is read on this device by an open-source face tracker (MediaPipe) served from this site; no video leaves the device and nothing is recorded. A red “Camera on” chip shows while it runs. Speech goes to your browser's speech service to become words.")}</li>
        </ul>
      </Panel>
      <Panel title={t("See how the point picks a button")}>
        <SimulatedGaze />
      </Panel>
      <Panel title={t("What is measured, and what isn't")}>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>{t("In a real browser (Chromium with its fake camera), an automated test turns hands-free on: the face tracker and its model load from this site, the camera chip shows, it stops by itself with no face in view, and Esc, Stop and the shortcut all stop it.")}</li>
          <li>{sim ? t("On simulated eyes (made-up eye data with noise, computed just now in your browser), the calibration maths lands the four check dots about {0} px from where they are (cross-validated on the nine dots: {1} px). That checks the maths, not a person.", String(sim.check_px), String(sim.cv_px)) : t("The simulated check didn't run.")}</li>
          <li>{t("The voice money steps (confirm said back, once, one minute, amount checked again, ten-step limit) are tested against the server.")}</li>
          <li><b>{t("Not measured yet: accuracy on real people's eyes, and real speech in each language. That needs recorded sessions with people, which haven't been done.")}</b></li>
        </ul>
      </Panel>
    </div>
  );
}

// ---------------- /agents ----------------

type Call = { id: string; agent: string; tool: string; args: string; state: "running" | "ok" | "refused"; detail: string; at: string };
/** C2: what outside assistants did with this shopper's key, live (every few seconds), plus a real call to try. */
function LiveCalls({ agentKey, signedIn }: { agentKey: string | null; signedIn: boolean }) {
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch("/api/ui/agents/calls", { headers: { accept: "application/json" }, credentials: "same-origin" }).catch(() => null);
    if (r?.ok) setCalls((await r.json()).calls);
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    void load();
    const id = window.setInterval(() => document.visibilityState === "visible" && void load(), 3000);
    return () => window.clearInterval(id);
  }, [signedIn, load]);
  // A real MCP call, from this page, with the key just made: exactly what an assistant would send.
  const tryIt = async () => {
    if (!agentKey) return;
    setBusy(true);
    try {
      const r = await fetch("/mcp", { method: "POST", headers: { authorization: `Bearer ${agentKey}`, "content-type": "application/json", accept: "application/json, text/event-stream", "x-agent-id": "everyday-agents-page" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "my_constraints", arguments: {} } }) });
      if (!r.ok) throw new Error(t("The call was refused ({0}).", String(r.status)));
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!signedIn) return null;
  return (
    <Panel title={t("Live: what assistants did with your key")} sub={t("Updates every few seconds. Every call is recorded with the assistant's id.")}>
      {agentKey && (
        <Button variant="outline" className="mb-3" disabled={busy} onClick={() => void tryIt()} data-testid="agents-try">
          {t("Try a real call: my_constraints")}
        </Button>
      )}
      {calls === null ? (
        <p className="text-sm text-ink-2">{t("Loading…")}</p>
      ) : calls.length === 0 ? (
        <p className="text-sm text-ink-2">{t("No calls yet. Connect an assistant with your key, or make a key and try a call here.")}</p>
      ) : (
        <ol className="space-y-2" data-testid="agents-calls">
          {calls.map((c) => (
            <li key={c.id} className="rounded-md border border-rule p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Ok ok={c.state === "ok"} />
                <span className="font-mono text-xs font-semibold">{c.tool}</span>
                <span className="text-xs text-ink-2" data-no-i18n>{c.agent}</span>
                <span className="ml-auto text-xs text-ink-2">{when(c.at)}</span>
              </div>
              <div className="mt-1 font-mono text-[11px] break-all text-ink-2" data-no-i18n>
                {c.args} → {c.detail}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

interface AgentsData { endpoint: string; merchant_endpoint: string; transport: string; key_where: string; connect: { client: string; command: string }[]; shopper_tools: string[]; merchant_tools: string[]; limits: string }

export function Agents() {
  const st = useApi<AgentsData>("/api/public/agents");
  const me = useApi<{ workspace: { id: string } | null; who?: { account?: { id: string } | null } }>("/api/ui/workspace");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/ui/devices", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, credentials: "same-origin", body: JSON.stringify({ client: "agent" }) });
      const out = await r.json().catch(() => null);
      if (!r.ok) throw new Error(out?.message ?? t("Sign in to your demo first."));
      setKey(out.key);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ev-rise">
      <PageHead eyebrow={t("Agents")} title={t("Connect your own assistant")} lede={t("Everyday is an MCP server. An outside assistant can plan, quote and start a PayPal approval for the shopper, inside the shopper's rules; it can't refund or change limits.")} />
      <Loaded state={st}>
        {(d) => (
          <div className="space-y-6">
            <Panel title={t("Your key")}>
              <p className="mb-3 text-sm">{d.key_where}</p>
              {key ? (
                <>
                  <p className="mb-2 text-sm font-medium">{t("Shown once. Copy it now.")}</p>
                  <Copyable text={key} label={t("the assistant key")} />
                </>
              ) : me.data?.workspace ? (
                <Button onClick={() => void make()} disabled={busy}>
                  <KeyRound />{" "}{t("Make an assistant key")}
                </Button>
              ) : (
                <Button asChild variant="outline">
                  <Link to="/demo">{t("Start a demo first")}</Link>
                </Button>
              )}
            </Panel>
            <LiveCalls agentKey={key} signedIn={Boolean(me.data?.workspace)} />
            <Panel title={t("Connect")} sub={d.transport}>
              <div className="space-y-4">
                {d.connect.map((c) => (
                  <div key={c.client}>
                    <h3 className="mb-1 text-sm font-semibold">{c.client}</h3>
                    <Copyable text={key ? c.command.replace(/YOUR_EVERYDAY_KEY/g, key) : c.command} label={t("the {0} command", c.client)} />
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title={t("Tools")}>
              <p className="text-sm">
                <b>{tn("Shopper ({0}):", d.endpoint)}</b> <span className="font-mono text-xs">{d.shopper_tools.join(", ")}</span>
              </p>
              <p className="mt-2 text-sm">
                <b>{tn("Shop, read only ({0}):", d.merchant_endpoint)}</b> <span className="font-mono text-xs">{d.merchant_tools.join(", ")}</span>
              </p>
              <p className="mt-3 text-sm text-ink-2">
                {tn("{0} See", d.limits)}{" "}<Link className="underline" to="/who-can-move-money">{t("who can move money")}</Link>.
              </p>
            </Panel>
          </div>
        )}
      </Loaded>
    </div>
  );
}
