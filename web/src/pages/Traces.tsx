import { Link, useParams } from "react-router";
import { ArrowLeft, Bot, ChevronRight, Cpu, ScanText, ShieldCheck, User } from "lucide-react";
import { Empty, Loaded, PageHead, Panel, State } from "@/components/kit";
import { useApi } from "@/lib/api";
import { when } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Run { id: string; subject: string; actor: string; agent_id: string | null; status: string; started_at: string; ended_at: string | null; entity: string | null; entity_id: string | null; steps?: number }
interface Step { step: number; actor: string; tool: string | null; args: unknown; policy: string | null; gate: string | null; result: unknown; pp_request_id: string | null; pp_debug_id: string | null; duration_ms: number | null; at: string }

export default function Traces() {
  const st = useApi<{ runs: Run[] }>("/api/ui/traces");
  return (
    <Loaded state={st}>
      {(d) => (
        <div className="ev-rise">
          <PageHead eyebrow="What the assistant did" title="Every step, on the record" lede="Each run shows who acted — the model, code, the gate or PayPal — what the gate said, and PayPal's request id so it can be matched in the sandbox." />
          <Panel tight>
            {d.runs.length ? (
              <ul className="divide-y divide-rule">
                {d.runs.map((r) => (
                  <li key={r.id}>
                    <Link to={`/trace/${r.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-sunk/60 sm:px-5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{r.subject}</span>
                        <span className="num block text-xs text-ink-2">
                          {r.actor} · {when(r.started_at)}
                          {r.steps !== undefined ? ` · ${r.steps} steps` : ""}
                        </span>
                      </span>
                      <State s={r.status} />
                      <ChevronRight className="size-4 text-ink-3" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4 sm:p-5">
                <Empty title="No runs yet.">Plans, checkouts, refunds and repeat buys each leave a trace here.</Empty>
              </div>
            )}
          </Panel>
        </div>
      )}
    </Loaded>
  );
}

const ACTOR: Record<string, [React.ReactNode, string]> = {
  model: [<ScanText key="m" className="size-4" />, "AI"],
  code: [<Cpu key="c" className="size-4" />, "Code"],
  guard: [<ShieldCheck key="g" className="size-4" />, "Gate"],
  gate: [<ShieldCheck key="g2" className="size-4" />, "Gate"],
  paypal: [<ShieldCheck key="p" className="size-4" />, "PayPal"],
  user: [<User key="u" className="size-4" />, "Person"],
  owner: [<User key="o" className="size-4" />, "Owner"],
  customer: [<User key="cu" className="size-4" />, "Customer"],
  agent: [<Bot key="a" className="size-4" />, "Assistant"],
};
const show = (v: unknown) => (v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v, null, 1));

export function Trace() {
  const { id } = useParams();
  const st = useApi<{ run: Run; steps: Step[]; viewer: string }>(`/api/ui/trace/${id}`);
  return (
    <Loaded state={st}>
      {(d) => {
        const r = d.run;
        const back = r.entity === "order" ? (d.viewer === "merchant" ? "/merchant" : `/orders/${r.entity_id}`) : r.entity === "intent" ? `/plans/${r.entity_id}` : r.entity === "repeat_buy" ? "/passport" : "/traces";
        return (
          <div className="ev-rise">
            <Link to="/traces" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-ink-2 hover:text-ink">
              <ArrowLeft className="size-4" /> All runs
            </Link>
            <PageHead
              eyebrow={
                <span className="inline-flex flex-wrap items-center gap-2">
                  {r.actor}
                  {r.agent_id && <span className="id">{r.agent_id}</span>} · started {when(r.started_at)}
                  {r.ended_at && ` · ended ${when(r.ended_at)}`}
                  <State s={r.status} />
                </span>
              }
              title={r.subject}
              lede="Secrets and image bytes are redacted."
              actions={
                back !== "/traces" ? (
                  <Link to={back} className="text-sm font-semibold underline underline-offset-4">
                    Open {r.entity === "intent" ? "the plan" : r.entity === "order" ? "the order" : "it"}
                  </Link>
                ) : undefined
              }
            />
            <ol className="relative space-y-3 border-l-2 border-rule pl-5">
              {d.steps.map((s) => {
                const [icon, label] = ACTOR[s.actor] ?? [<Bot key="b" className="size-4" />, s.actor];
                return (
                  <li key={s.step} className="relative">
                    <span className={cn("absolute top-3 -left-[31px] flex size-6 items-center justify-center rounded-full border-2 border-paper", s.actor === "model" ? "bg-wait-bg text-wait" : s.actor === "paypal" ? "bg-done-bg text-done" : "bg-sunk text-ink")}>{icon}</span>
                    <div className="rounded-lg border border-rule bg-card p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold tracking-wide uppercase">{label}</span>
                        {s.tool && <span className="font-medium">{s.tool}</span>}
                        <span className="num ml-auto text-xs text-ink-2">
                          #{s.step}
                          {s.duration_ms !== null ? ` · ${s.duration_ms} ms` : ""}
                        </span>
                      </div>
                      {s.gate && s.gate !== "n/a" && (
                        <p className="mt-1 flex flex-wrap items-center gap-2">
                          <State s={s.gate === "allowed" ? "approved" : s.gate === "held" ? "held" : "denied"} label={`gate: ${s.gate.replace(/_/g, " ")}`} />
                          {s.policy && <span className="text-xs text-ink-2">{s.policy}</span>}
                        </p>
                      )}
                      {s.pp_request_id && (
                        <p className="id mt-1 text-xs text-ink-2">
                          PayPal request {s.pp_request_id}
                          {s.pp_debug_id ? ` · debug ${s.pp_debug_id}` : ""}
                        </p>
                      )}
                      {(show(s.args) || show(s.result)) && (
                        <details className="mt-2" data-detail>
                          <summary className="min-h-9 cursor-pointer text-xs font-semibold">Details</summary>
                          {show(s.args) && <pre className="mt-1 max-h-48 overflow-auto rounded bg-sunk p-2 text-[11px] whitespace-pre-wrap">{show(s.args)}</pre>}
                          {show(s.result) && <pre className="mt-1 max-h-48 overflow-auto rounded bg-sunk p-2 text-[11px] whitespace-pre-wrap">{show(s.result)}</pre>}
                        </details>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      }}
    </Loaded>
  );
}
