import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { CircleCheck, CircleX, Copy, KeyRound } from "lucide-react";
import { Loaded, PageHead, Panel } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import { when } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A3.2: the pages that need no sign-in. Each reads a committed result file or the showcase demo; nothing is typed in. */

const Table = ({ label, head, children, min = 640 }: { label: string; head: ReactNode[]; children: ReactNode; min?: number }) => (
  <div className="rail-scroll" tabIndex={0} role="region" aria-label={`${label} (scrolls sideways)`}>
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
    {label ?? (ok ? "pass" : "fail")}
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
        aria-label={`Copy ${label}`}
        className="absolute top-2 right-2 inline-flex size-9 items-center justify-center rounded-md border border-rule bg-card hover:bg-paper-2"
        onClick={() => void navigator.clipboard?.writeText(text).then(() => toast.success("Copied"), () => toast.error("Couldn't copy"))}
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
  robot_judge: null | { run_on: string; target: string; paths: { id: string; ok: boolean; ms: number; failed_step?: string | null }[] };
  not_measured: string[];
}

function SuitePanel({ s }: { s: Suite }) {
  const [open, setOpen] = useState(false);
  if (s.missing) return <Panel title={s.title}><p className="text-sm text-stop">No result file yet: this check hasn't been run on this build.</p></Panel>;
  const cases = s.cases ?? [];
  const shown = open ? cases : cases.slice(0, 12);
  return (
    <Panel id={s.name} title={s.title} sub={`Run ${dateOf(s.run_on)} · ${s.provider}`}>
      <p className="mb-3 text-sm text-ink-2">{s.what}</p>
      <ul className="mb-3 flex flex-wrap gap-2 text-sm">
        {(s.arms ?? []).map((a) => (
          <li key={a.arm} className="rounded-md border border-rule px-2 py-1">
            <b>{a.arm}</b>: {a.correct} of {a.cases} correct{a.p50_ms ? ` · median ${a.p50_ms} ms` : ""}
          </li>
        ))}
      </ul>
      <Table label={`${s.title}: every case`} head={["Case", "Input", "Expected", "Answer", "Result"]} min={760}>
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
          {open ? "Show fewer" : `Show all ${cases.length} cases`}
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
      <PageHead eyebrow="Proof" title="Every check, every case" lede="What was tested, every case with its answer, the models and the date each check ran, and what hasn't been measured. No sign-in needed." />
      <Loaded state={st}>
        {(d) => (
          <div className="space-y-6">
            <Panel title="Models">
              <p className="text-sm">
                Reading requests and photos: <b>{d.models.read}</b> (backup {d.models.backup}). Small jobs: {d.models.small}. Second reader for scams: <b>{d.models.decisions}</b> on OpenAI's Decisions API. {d.models.connected ? "Connected on this instance." : "Not connected on this instance."}
              </p>
              <p className="mt-2 text-xs text-ink-2">{d.built_from}</p>
            </Panel>
            {d.suites.map((s) => (
              <SuitePanel key={s.name} s={s} />
            ))}
            {d.decisions && (
              <Panel id="decisions" title={d.decisions.title} sub={`Run ${dateOf(d.decisions.run_on)} · ${d.decisions.model}`}>
                <p className="mb-3 text-sm text-ink-2">{d.decisions.what}</p>
                <Table label="Calibration" head={["Question", "Clear below", "Hold from", "Held-out precision", "Held-out recall", "Held-out messages"]}>
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
                {d.decisions.not_calibrated.length > 0 && <p className="mt-3 text-sm">Not calibrated (too few examples), so never used to hold or clear: {d.decisions.not_calibrated.join(", ")}.</p>}
                <h3 className="mt-4 mb-2 text-sm font-semibold">Every labelled message ({d.decisions.cases.length})</h3>
                <Table label="Labelled messages" head={["Message", "Labelled yes", "Model's probability for those"]} min={700}>
                  {(decAll ? d.decisions.cases : d.decisions.cases.slice(0, 10)).map((c, i) => {
                    const yes = Object.entries(c.labels).filter(([, v]) => v === 1).map(([k]) => k);
                    return (
                      <tr key={i} className="border-b border-rule last:border-0">
                        <Td className="max-w-[22rem]">{c.text}</Td>
                        <Td className="font-mono text-xs">{yes.join(", ") || "none (genuine)"}</Td>
                        <Td className="num text-xs">{c.answers ? yes.map((k) => `${k}: ${c.answers?.[k] ?? "not decided"}`).join("; ") || "—" : "—"}</Td>
                      </tr>
                    );
                  })}
                </Table>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setDecAll((x) => !x)}>
                  {decAll ? "Show fewer" : `Show all ${d.decisions.cases.length} messages`}
                </Button>
              </Panel>
            )}
            {d.techjam && (
              <Panel id="techjam" title={d.techjam.title} sub={`Run ${dateOf(d.techjam.run_on)} · no model`}>
                <p className="mb-3 text-sm text-ink-2">{d.techjam.what}</p>
                <Table label="Systems" head={["System", "Cases", "Found in top 10", "MRR", "Right item first", "Correctly said none", "Wrongly said none", "Turns"]} min={760}>
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
                <h3 className="mt-4 mb-2 text-sm font-semibold">Every case ({d.techjam.cases.length})</h3>
                <Table label="Search cases" head={["Case", "Opening request", "Right item", "Everyday", "Questions asked", "Baseline"]} min={820}>
                  {(tjAll ? d.techjam.cases : d.techjam.cases.slice(0, 12)).map((c) => (
                    <tr key={c.id} className="border-b border-rule last:border-0">
                      <Td className="font-mono text-xs">
                        {c.id}
                        <div className="text-ink-2">{c.kind}</div>
                      </Td>
                      <Td>{c.query}</Td>
                      <Td className="font-mono text-xs">{c.target ?? "none in the catalog"}</Td>
                      <Td>{c.everyday ? (c.target ? <Ok ok={c.everyday.converted} label={c.everyday.converted ? "first" : c.everyday.hit10 ? "in top 10" : "missed"} /> : <Ok ok={c.everyday.abstained} label={c.everyday.abstained ? "said none" : "offered something"} />) : "—"}</Td>
                      <Td className="text-xs text-ink-2">{c.everyday?.asked.join(" · ") || "none"}</Td>
                      <Td>{c.baseline ? (c.target ? (c.baseline.rr === 1 ? "first" : c.baseline.hit10 ? "in top 10" : "missed") : "offered something") : "—"}</Td>
                    </tr>
                  ))}
                </Table>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setTjAll((x) => !x)}>
                  {tjAll ? "Show fewer" : `Show all ${d.techjam.cases.length} cases`}
                </Button>
              </Panel>
            )}
            <Panel title="Scam model on your device" sub="From its model card">
              <Table label="Model card" head={["Test set", "Messages", "AUC", "Caught at 1% genuine held", "What it is"]}>
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
            <Panel title="Robot judge">
              {d.robot_judge ? (
                <>
                  <p className="mb-2 text-sm">
                    Last run {when(d.robot_judge.run_on)} on {d.robot_judge.target}.
                  </p>
                  <ul className="space-y-1 text-sm">
                    {d.robot_judge.paths.map((p) => (
                      <li key={p.id}>
                        <Ok ok={p.ok} label={p.ok ? "completed" : "failed"} /> {p.id} in {(p.ms / 1000).toFixed(1)} s{p.failed_step ? `; stopped at ${p.failed_step}` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-ink-2">No robot-judge run recorded on this build.</p>
              )}
            </Panel>
            <Panel title="Not measured">
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
const PURPOSE: Record<string, string> = { read_request: "Read a request", capture_frame: "Read a photo", shopper_question: "Assistant (Ask)", scam_check: "Second scam reader", plan_question: "Worded a question", compile_policy: "Read spending rules", classify: "Small job", eval: "Evaluation" };

export function AiCalls() {
  const st = useApi<AiData>("/api/public/ai");
  return (
    <div className="ev-rise">
      <PageHead eyebrow="AI calls" title="The last 20 model calls" lede="From the showcase demo, which is rebuilt every night and asked a few real questions. Each row is one call: what it read, which tools it used, what came back, how long it took and what it cost." />
      <Loaded state={st}>
        {(d) =>
          !d.calls.length ? (
            <Panel>
              <p className="text-sm">{d.showcase ? "The showcase hasn't made a model call since it was rebuilt." : "There's no showcase on this instance yet."} {d.connected ? "" : "No model is connected here."}</p>
            </Panel>
          ) : (
            <Panel sub={d.showcase ? `Showcase built ${when(d.showcase.built)}. Costs are estimates from list prices.` : undefined}>
              <Table label="Model calls" head={["When", "Job", "Model", "Read", "Tools", "Answer", "Time", "Cost"]} min={980}>
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
                    <Td className="num whitespace-nowrap">{c.ms} ms</Td>
                    <Td className="num whitespace-nowrap">{c.cost_usd ? `$${c.cost_usd.toFixed(5)}` : "not priced"}</Td>
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
      <PageHead eyebrow="PayPal" title="Every PayPal API Everyday uses" lede="When each is called, and a live id from the showcase demo where one exists. All of it runs on PayPal's sandbox with test money." />
      <Loaded state={st}>
        {(d) => (
          <Panel sub={`${d.env === "sandbox" ? "PayPal sandbox" : `PayPal ${d.env}`} · ${d.connected ? "connected" : "not connected"}${d.showcase ? ` · showcase built ${when(d.showcase.built)}` : " · no showcase yet"}`}>
            <Table label="PayPal APIs" head={["API", "When Everyday calls it", "Live id in the showcase"]} min={760}>
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
                      <span className="text-ink-2">None in the showcase yet</span>
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
      <PageHead eyebrow="Who can move money" title="Who can do what with money" lede="Every person, model and outside assistant that touches Everyday, with what each can and cannot do." />
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
                    <h3 className="mb-1 text-sm font-semibold text-done">Can</h3>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {r.can.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="mb-1 text-sm font-semibold text-stop">Cannot</h3>
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
      <PageHead eyebrow="Accessibility" title="What was tested, and how" lede="Works with a keyboard, at 200% text and with reduced motion; every control has a name. Results come from the automated run recorded below, with its date. What wasn't tested is listed too." />
      <Loaded state={st}>
        {(d) =>
          d.missing ? (
            <Panel>
              <p className="text-sm text-stop">No accessibility run is recorded on this build.</p>
            </Panel>
          ) : (
            <div className="space-y-6">
              <Panel title="Checks" sub={`Run ${when(d.run_on)} on ${d.target}`}>
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
              <Panel title="Not tested">
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
    </div>
  );
}

// ---------------- /agents ----------------

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
      if (!r.ok) throw new Error(out?.message ?? "Sign in to your demo first.");
      setKey(out.key);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ev-rise">
      <PageHead eyebrow="Agents" title="Connect your own assistant" lede="Everyday is an MCP server. An outside assistant can plan, quote and start a PayPal approval for the shopper, inside the shopper's rules; it can't refund or change limits." />
      <Loaded state={st}>
        {(d) => (
          <div className="space-y-6">
            <Panel title="Your key">
              <p className="mb-3 text-sm">{d.key_where}</p>
              {key ? (
                <>
                  <p className="mb-2 text-sm font-medium">Shown once. Copy it now.</p>
                  <Copyable text={key} label="the assistant key" />
                </>
              ) : me.data?.workspace ? (
                <Button onClick={() => void make()} disabled={busy}>
                  <KeyRound /> Make an assistant key
                </Button>
              ) : (
                <Button asChild variant="outline">
                  <Link to="/demo">Start a demo first</Link>
                </Button>
              )}
            </Panel>
            <Panel title="Connect" sub={d.transport}>
              <div className="space-y-4">
                {d.connect.map((c) => (
                  <div key={c.client}>
                    <h3 className="mb-1 text-sm font-semibold">{c.client}</h3>
                    <Copyable text={key ? c.command.replace(/YOUR_EVERYDAY_KEY/g, key) : c.command} label={`the ${c.client} command`} />
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Tools">
              <p className="text-sm">
                <b>Shopper ({d.endpoint}):</b> <span className="font-mono text-xs">{d.shopper_tools.join(", ")}</span>
              </p>
              <p className="mt-2 text-sm">
                <b>Shop, read only ({d.merchant_endpoint}):</b> <span className="font-mono text-xs">{d.merchant_tools.join(", ")}</span>
              </p>
              <p className="mt-3 text-sm text-ink-2">
                {d.limits} See <Link className="underline" to="/who-can-move-money">who can move money</Link>.
              </p>
            </Panel>
          </div>
        )}
      </Loaded>
    </div>
  );
}
