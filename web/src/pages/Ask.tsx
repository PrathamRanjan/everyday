import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Bot, CircleCheck, CircleX, Cpu, Send } from "lucide-react";
import { Busy, PageHead, Panel } from "@/components/kit";
import { SpeakableText } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { t, N_, tn } from "@/i18n";

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
  N_("What can I still get money back on?"),
  N_("Is there a quiet wireless mouse under $60 I can buy here?"),
  N_("Did PayPal confirm my last order and any refunds on it?"),
  N_("sweat-proof wireless earbuds for running, under $80"),
];
const WORDS: Record<string, string> = {
  get owned_items() {
    return t("Read what you own");
  },
  get my_rules() {
    return t("Read your spending rules");
  },
  get list_orders() {
    return t("Read your orders");
  },
  get money_back() {
    return t("Looked for money you can get back");
  },
  get search_products() {
    return t("Searched for products");
  },
  get check_product() {
    return t("Checked a product in code");
  },
  get paypal_order() {
    return t("Asked PayPal about an order");
  },
  get paypal_refund() {
    return t("Asked PayPal about a refund");
  },
  get propose_plan() {
    return t("Made a plan for you to review");
  },
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
      <PageHead eyebrow={t("Ask")} title={t("Ask Everyday")} lede={t("Ask about what you own, what you can get back, or something to buy. The assistant reads your records and asks PayPal itself; it can't buy, pay or refund anything. You'll see every step it takes.")} />
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
                {t("Your question")}
              </label>
              <SpeakableText id="ask" value={q} onChange={setQ} rows={3} placeholder={t("For example: what can I still get money back on?")} />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={busy || !q.trim() || info.data?.ready === false}>
                  <Busy on={busy}>
                    <Send />
                  </Busy>
                  {t("Ask")}
                </Button>
                {EXAMPLES.map((x) => (
                  <button key={x} type="button" className="rounded-full border border-rule px-3 py-1 text-sm hover:bg-paper-2" onClick={() => setQ(t(x))}>
                    {t(x)}
                  </button>
                ))}
              </div>
              {info.data?.ready === false && <p className="text-sm text-stop">{t("No model is connected on this instance, so the assistant can't answer here.")}</p>}
            </form>
          </Panel>

          <Panel title={t("Answer")} sub={answer ? t("{0}, {1} step{2}, {3} s", answer.model, answer.steps, answer.steps === 1 ? "" : "s", (answer.ms / 1000).toFixed(1)) : undefined}>
            <div aria-live="polite">
              {!events.length && <p className="text-sm text-ink-2">{t("Ask something to see the assistant work.")}</p>}
              {thinking && <p className="text-sm text-ink-2">{tn("Working… {0}", tools.length ? t("{0} step{1} so far.", tools.length, tools.length > 1 ? "s" : "") : "")}</p>}
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
                            aria-label={t("Source: step {0}, {1}", n, WORDS[tools.find((t) => t.step === n)?.name ?? ""] ?? t("a tool call"))}
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

        <aside aria-label={t("AI work rail")} className="lg:sticky lg:top-20 lg:self-start">
          <Panel
            title={
              <span className="inline-flex items-center gap-2">
                <Bot className="size-5" />
                {t("AI work")}
              </span>
            }
            sub={start ? t("Run {0} on {1}", start.run_id.slice(-8), start.model) : info.data ? t("{0} (backup {1}); at most {2} steps and {3} s", info.data.model, info.data.backup, info.data.max_steps, info.data.max_seconds) : undefined}
            action={
              <button type="button" className="text-sm underline lg:hidden" aria-expanded={railOpen} onClick={() => setRailOpen((x) => !x)}>
                {railOpen ? t("Hide") : t("Show")}
              </button>
            }
          >
            <div className={cn(!railOpen && "hidden lg:block")}>
              {!tools.length && !thinking && (
                <div className="text-sm text-ink-2">
                  <p>{t("Each tool call shows here as it happens: its name, what it was asked, how long it took and what came back.")}</p>
                  {info.data && (
                    <ul className="mt-3 space-y-1">
                      {info.data.tools.map((tool) => (
                        <li key={tool.name}>
                          <span className="font-mono text-xs">{tool.name}</span> · {tool.kind === "propose" ? t("proposes, never pays") : t("reads only")}
                          {tool.source === "paypal" ? t(" · PayPal's MCP server{0}", info.data!.paypal.ready ? "" : t(" (not connected here)")) : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <ol className="space-y-2">
                {tools.map((st) => (
                  <li key={st.step} id={`step-${st.step}`} className={cn("scroll-mt-24 rounded-md border p-2 text-sm transition-colors", hot === st.step ? "border-accent bg-paper-2" : "border-rule")}>
                    <div className="flex items-center gap-2">
                      <span className="num w-6 shrink-0 text-xs text-ink-2">{st.step}</span>
                      {st.ok ? <CircleCheck className="size-4 shrink-0 text-done" aria-label="ok" /> : <CircleX className="size-4 shrink-0 text-stop" aria-label="failed" />}
                      <span className="font-medium">{WORDS[st.name] ?? st.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-ink-2">{tn("{0} ms", st.ms)}</span>
                    </div>
                    <div className="mt-1 break-words pl-8 text-xs text-ink-2">
                      <span className="font-mono">{st.name}</span>
                      {st.source === "paypal" && <span className="ml-1 rounded bg-paper-2 px-1">{t("PayPal MCP")}</span>} {st.args !== "{}" ? st.args : ""}
                    </div>
                    <div className="mt-1 break-words pl-8 font-mono text-xs">{st.result}</div>
                  </li>
                ))}
                {thinking && (
                  <li className="flex items-center gap-2 text-sm text-ink-2">
                    <Cpu className="size-4 animate-pulse" />{" "}{t("The model is deciding the next step…")}
                  </li>
                )}
              </ol>
              {start && (
                <p className="mt-3 text-xs text-ink-2">
                  {t("Every step is also kept on")}{" "}<Link className="underline" to={`/trace/${start.run_id}`}>{t("the run's trace")}</Link>.
                </p>
              )}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
