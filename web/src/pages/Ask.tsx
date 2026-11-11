import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Bot, CircleCheck, CircleX, Cpu, Send } from "lucide-react";
import { Busy, PageHead, Panel } from "@/components/kit";
import { SpeakableText } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import { cn } from "@/lib/utils";

type Ev =
  | { type: "start"; run_id: string; model: string }
  | { type: "thinking"; turn: number }
  | { type: "tool"; step: number; name: string; source: "everyday" | "paypal"; args: string; ms: number; ok: boolean; result: string }
  | { type: "answer"; sentences: { text: string; cites: number[] }[]; steps: number; ms: number; model: string; links: { label: string; href: string }[] }
  | { type: "error"; message: string };
interface ToolsInfo {
  model: string;
  backup: string;
  ready: boolean;
  max_steps: number;
  max_seconds: number;
  tools: { name: string; kind: "read" | "propose"; source: "everyday" | "paypal"; description: string }[];
  paypal: { url: string; ready: boolean; allowed: string[] };
}

const EXAMPLES = [
  "What can I still get money back on?",
  "Is there a quiet wireless mouse under $60 I can buy here?",
  "Did PayPal confirm my last order and any refunds on it?",
  "sweat-proof wireless earbuds for running, under $80",
];
const WORDS: Record<string, string> = {
  owned_items: "Read what you own",
  my_rules: "Read your spending rules",
  list_orders: "Read your orders",
  money_back: "Looked for money you can get back",
  search_products: "Searched for products",
  check_product: "Checked a product in code",
  paypal_order: "Asked PayPal about an order",
  paypal_refund: "Asked PayPal about a refund",
  propose_plan: "Made a plan for you to review",
};

/** A5.3: the Ask screen with the AI work rail: each tool call as it happens, then the answer with each sentence linked to the step it cites. */
export default function Ask() {
  const [params] = useSearchParams();
  const info = useApi<ToolsInfo>("/api/ui/ask/tools");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [events, setEvents] = useState<Ev[]>([]);
  const [busy, setBusy] = useState(false);
  const [hot, setHot] = useState<number | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const started = useRef(false);

  const go = async (question = q) => {
    if (!question.trim() || busy) return;
    setBusy(true);
    setEvents([]);
    setHot(null);
    try {
      const res = await fetch("/api/ui/ask", { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify({ question }) });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setEvents([{ type: "error", message: j.message ?? `The assistant didn't answer (${res.status}).` }]);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i).replace(/^data: /, "");
          buf = buf.slice(i + 2);
          try {
            const e = JSON.parse(line) as Ev;
            setEvents((xs) => [...xs, e]);
          } catch {
            /* not an event */
          }
        }
      }
    } catch (e) {
      setEvents((xs) => [...xs, { type: "error", message: `The connection dropped: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (params.get("q") && params.get("go") === "1" && !started.current) {
      started.current = true;
      void go(params.get("q")!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tools = events.filter((e): e is Extract<Ev, { type: "tool" }> => e.type === "tool");
  const answer = events.find((e): e is Extract<Ev, { type: "answer" }> => e.type === "answer");
  const error = events.find((e): e is Extract<Ev, { type: "error" }> => e.type === "error");
  const start = events.find((e): e is Extract<Ev, { type: "start" }> => e.type === "start");
  const thinking = busy && !answer && !error;

  return (
    <div className="ev-rise">
      <PageHead eyebrow="Ask" title="Ask Everyday" lede="Ask about what you own, what you can get back, or something to buy. The assistant reads your records and asks PayPal itself; it can't buy, pay or refund anything. You'll see every step it takes." />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Panel>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void go();
              }}
            >
              <label htmlFor="ask" className="text-sm font-medium">
                Your question
              </label>
              <SpeakableText id="ask" value={q} onChange={setQ} rows={3} placeholder="For example: what can I still get money back on?" />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={busy || !q.trim() || info.data?.ready === false}>
                  <Busy on={busy}>
                    <Send />
                  </Busy>
                  Ask
                </Button>
                {EXAMPLES.map((x) => (
                  <button key={x} type="button" className="rounded-full border border-rule px-3 py-1 text-sm hover:bg-paper-2" onClick={() => setQ(x)}>
                    {x}
                  </button>
                ))}
              </div>
              {info.data?.ready === false && <p className="text-sm text-stop">No model is connected on this instance, so the assistant can't answer here.</p>}
            </form>
          </Panel>

          <Panel title="Answer" sub={answer ? `${answer.model}, ${answer.steps} step${answer.steps === 1 ? "" : "s"}, ${(answer.ms / 1000).toFixed(1)} s` : undefined}>
            <div aria-live="polite">
              {!events.length && <p className="text-sm text-ink-2">Ask something to see the assistant work.</p>}
              {thinking && <p className="text-sm text-ink-2">Working… {tools.length ? `${tools.length} step${tools.length > 1 ? "s" : ""} so far.` : ""}</p>}
              {error && <p className="text-sm text-stop">{error.message}</p>}
              {answer && (
                <>
                  <p className="leading-relaxed">
                    {answer.sentences.map((s, i) => (
                      <span key={i}>
                        {s.text}
                        {s.cites.map((n) => (
                          <a
                            key={n}
                            href={`#step-${n}`}
                            onMouseEnter={() => setHot(n)}
                            onFocus={() => setHot(n)}
                            onClick={() => setRailOpen(true)}
                            className="ml-0.5 align-super text-xs font-semibold text-accent underline"
                            aria-label={`Source: step ${n}, ${WORDS[tools.find((t) => t.step === n)?.name ?? ""] ?? "a tool call"}`}
                          >
                            [{n}]
                          </a>
                        ))}{" "}
                      </span>
                    ))}
                  </p>
                  {answer.links.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {answer.links.map((l) => (
                        <Button key={l.href} asChild variant="outline" size="sm">
                          <Link to={l.href}>{l.label}</Link>
                        </Button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </Panel>
        </div>

        <aside aria-label="AI work rail" className="lg:sticky lg:top-20 lg:self-start">
          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                <Bot className="size-5" />
                AI work
              </span>
            }
            sub={start ? `Run ${start.run_id.slice(-8)} on ${start.model}` : info.data ? `${info.data.model} (backup ${info.data.backup}); at most ${info.data.max_steps} steps and ${info.data.max_seconds} s` : undefined}
            action={
              <button type="button" className="text-sm underline lg:hidden" aria-expanded={railOpen} onClick={() => setRailOpen((x) => !x)}>
                {railOpen ? "Hide" : "Show"}
              </button>
            }
          >
            <div className={cn(!railOpen && "hidden lg:block")}>
              {!tools.length && !thinking && (
                <div className="text-sm text-ink-2">
                  <p>Each tool call shows here as it happens: its name, what it was asked, how long it took and what came back.</p>
                  {info.data && (
                    <ul className="mt-3 space-y-1">
                      {info.data.tools.map((t) => (
                        <li key={t.name}>
                          <span className="font-mono text-xs">{t.name}</span> · {t.kind === "propose" ? "proposes, never pays" : "reads only"}
                          {t.source === "paypal" ? ` · PayPal's MCP server${info.data!.paypal.ready ? "" : " (not connected here)"}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <ol className="space-y-2">
                {tools.map((t) => (
                  <li key={t.step} id={`step-${t.step}`} className={cn("scroll-mt-24 rounded-md border p-2 text-sm transition-colors", hot === t.step ? "border-accent bg-paper-2" : "border-rule")}>
                    <div className="flex items-center gap-2">
                      <span className="num w-6 shrink-0 text-xs text-ink-2">{t.step}</span>
                      {t.ok ? <CircleCheck className="size-4 shrink-0 text-done" aria-label="ok" /> : <CircleX className="size-4 shrink-0 text-stop" aria-label="failed" />}
                      <span className="font-medium">{WORDS[t.name] ?? t.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-ink-2">{t.ms} ms</span>
                    </div>
                    <div className="mt-1 break-words pl-8 text-xs text-ink-2">
                      <span className="font-mono">{t.name}</span>
                      {t.source === "paypal" && <span className="ml-1 rounded bg-paper-2 px-1">PayPal MCP</span>} {t.args !== "{}" ? t.args : ""}
                    </div>
                    <div className="mt-1 break-words pl-8 font-mono text-xs">{t.result}</div>
                  </li>
                ))}
                {thinking && (
                  <li className="flex items-center gap-2 text-sm text-ink-2">
                    <Cpu className="size-4 animate-pulse" /> The model is deciding the next step…
                  </li>
                )}
              </ol>
              {start && (
                <p className="mt-3 text-xs text-ink-2">
                  Every step is also kept on <Link className="underline" to={`/trace/${start.run_id}`}>the run's trace</Link>.
                </p>
              )}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
