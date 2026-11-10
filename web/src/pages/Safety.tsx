import { useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, ShieldAlert, ShieldCheck, UserCheck } from "lucide-react";
import { Busy, Empty, Loaded, PageHead, Panel, Stat, State } from "@/components/kit";
import { SpeakableText } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction, useApi } from "@/lib/api";
import { money, when } from "@/lib/format";
import { cn } from "@/lib/utils";

interface SafetyData {
  inbox: { id: number; channel: string; text: string; created_at: string; flag: { serious: boolean; words: string[] } | null }[];
  holds: { id: string; action: string; cents: number; status: string; reasons: string[] }[];
  protected: { on: boolean; contacts: string[] };
  sellers: { name: string; kind: string; paid: number }[];
  demo_scam: string;
  tactics: { key: string; words: string }[];
}
interface RuleResult { level: "hold" | "caution" | "clear"; reasons: string[]; tactics: string[]; risk?: number; error?: string }
interface ModelResult { p_scam: number; level: "hold" | "caution" | "clear"; tactics: Record<string, number> }

let guardPromise: Promise<{ score: (t: string) => Promise<ModelResult> }> | null = null;
const ORT = "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.22.0/";
/** The fine-tuned scam text model, int8 ONNX, scored in this browser with onnxruntime-web. The text never leaves the device for this score. */
function loadModel() {
  if (guardPromise) return guardPromise;
  guardPromise = (async () => {
    const w = window as any;
    if (!w.ort)
      await new Promise<void>((res, rej) => {
        const s = document.createElement("script");
        s.src = `${ORT}ort.min.js`;
        s.onload = () => res();
        s.onerror = () => rej(new Error("onnxruntime-web did not load"));
        document.head.appendChild(s);
      });
    w.ort.env.wasm.wasmPaths = ORT;
    const mod = await import(/* @vite-ignore */ "/static/safety/guard-client.js" as string);
    return mod.loadGuard({ modelUrl: "/static/safety/model/model_quantized.onnx", tokenizerUrl: "/static/safety/model/tokenizer.json", headsUrl: "/static/safety/model/heads.json", ort: w.ort });
  })();
  guardPromise.catch(() => (guardPromise = null));
  return guardPromise;
}

const LEVEL = { hold: ["Hold: don't pay yet", "border-stop bg-stop-bg text-stop"], caution: ["Caution: check before you pay", "border-wait bg-wait-bg text-wait"], clear: ["No scam signals found", "border-done bg-done-bg text-done"] } as const;

function Checker({ demo, tactics }: { demo: string; tactics: SafetyData["tactics"] }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ rules: RuleResult | null; model: ModelResult | null; modelErr: string | null; ms: number } | null>(null);
  const words = Object.fromEntries(tactics.map((t) => [t.key, t.words]));
  const check = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setOut(null);
    let rules: RuleResult | null = null;
    let model: ModelResult | null = null;
    let modelErr: string | null = null;
    let ms = 0;
    setStatus("Checking the rules…");
    try {
      const r = await fetch("/safety/scan", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ text }) });
      rules = await r.json();
    } catch (e) {
      rules = { level: "clear", reasons: [], tactics: [], error: (e as Error).message };
    }
    try {
      setStatus(guardPromise ? "Scoring in your browser…" : "Loading the model into your browser (23 MB, once)…");
      const g = await loadModel();
      const t0 = performance.now();
      model = await g.score(text);
      ms = performance.now() - t0;
    } catch (e) {
      modelErr = (e as Error).message;
    }
    setOut({ rules, model, modelErr, ms });
    setStatus("");
    setBusy(false);
  };
  const r = out?.rules;
  const m = out?.model;
  const modelOnly = m?.level === "caution" && (!r?.level || r.level === "clear") && !Object.values(m?.tactics ?? {}).some((p) => p >= 0.5);
  const level = out ? ([r?.level, m?.level].includes("hold") ? "hold" : modelOnly ? "clear" : [r?.level, m?.level].includes("caution") ? "caution" : "clear") : null;
  const found = new Set([...(r?.tactics ?? []), ...Object.entries(m?.tactics ?? {}).filter(([, p]) => p >= 0.5).map(([k]) => k)]);
  return (
    <div className="grid gap-3">
      <Label htmlFor="scan">Paste a seller's reply, a marketplace message or a text about a parcel</Label>
      <SpeakableText id="scan" value={text} onChange={setText} rows={5} placeholder="Paste the message here" />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={check} disabled={busy || !text.trim()}>
          <Busy on={busy}>{null}</Busy>Check this message
        </Button>
        <Button variant="outline" onClick={() => setText(demo)}>
          Paste the demo scam
        </Button>
        <span className="text-sm text-ink-2" aria-live="polite">
          {status}
        </span>
      </div>
      {out && level && (
        <div aria-live="polite" className="grid gap-3">
          <div role="status" className={cn("rounded-lg border p-3 font-semibold", LEVEL[level][1])}>
            {LEVEL[level][0]}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Text model (here)" value={m ? `${Math.round(m.p_scam * 100)}%` : "—"} hint={m ? `${out.ms.toFixed(0)} ms, on this device` : (out.modelErr ?? "not run")} />
            <Stat label="Rules (server)" value={r?.level ?? "—"} hint={r?.reasons?.length ? `${r.reasons.length} reason${r.reasons.length > 1 ? "s" : ""}` : (r?.error ?? "no rule fired")} />
            <Stat label="Risk model" value={r?.risk !== undefined ? `${Math.round(r.risk * 100)}%` : "—"} hint="trained on synthetic data" />
          </div>
          {found.size > 0 && (
            <div>
              <h3 className="text-sm font-semibold">What this message does</h3>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {[...found].map((k) => (
                  <li key={k}>{words[k] ?? k}</li>
                ))}
              </ul>
            </div>
          )}
          {r?.reasons?.length ? (
            <div>
              <h3 className="text-sm font-semibold">Why</h3>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {r.reasons.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-sm text-ink-2">
            What to do: pay only to details you confirmed by phone on a number you already had. Never share codes. If in doubt, hold the payment and ask someone.{" "}
            {modelOnly && m ? `The text model was a little unsure (${Math.round(m.p_scam * 100)}%) but found no scam tactic and no rule fired, so this isn't flagged. ` : ""}
            {level === "clear" ? "A clear result isn't a guarantee: at this setting the model catches about three in four scams." : ""}
          </p>
        </div>
      )}
    </div>
  );
}

export default function Safety() {
  const st = useApi<SafetyData>("/api/ui/safety");
  const { run, busy } = useAction(st.reload);
  const [c1, setC1] = useState<string | null>(null);
  const [c2, setC2] = useState<string | null>(null);
  return (
    <Loaded state={st}>
      {(d) => (
        <div className="ev-rise">
          <PageHead
            eyebrow="Scam protection"
            title="A second pair of eyes"
            lede={
              <>
                Rules in code, a scam text model that runs in your browser, and a payment-risk score. The strictest wins, and none of them can approve a payment. <Link className="underline underline-offset-4" to="/safety/model-card">How it was tested</Link>.
              </>
            }
            needs={d.holds.filter((h) => h.status === "pending").length ? `${d.holds.filter((h) => h.status === "pending").length} payment held` : undefined}
          />
          <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            <Panel title="Check a message" sub="The model scores it on this device; the words never leave your browser for that score.">
              <Checker demo={d.demo_scam} tactics={d.tactics} />
            </Panel>
            <div className="space-y-6">
              <Panel id="protected" title={<span className="inline-flex items-center gap-2"><UserCheck className="size-5" />Protected mode {d.protected.on && <State s="active" label="on" />}</span>} sub="The first payment to any new seller waits for you, holds are explained calmly with no timers, and a trusted contact hears about every hold.">
                <form
                  className="grid gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("prot", "/safety/protected", { on: d.protected.on ? "0" : "1", contact1: c1 ?? d.protected.contacts[0] ?? "", contact2: c2 ?? d.protected.contacts[1] ?? "" }, { stay: true });
                  }}
                >
                  <div className="grid gap-1.5">
                    <Label htmlFor="pc1">Trusted contact (Telegram chat id, optional)</Label>
                    <Input id="pc1" value={c1 ?? d.protected.contacts[0] ?? ""} onChange={(e) => setC1(e.target.value)} placeholder="telegram:123456789" className="min-h-11 bg-card" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="pc2">Second contact</Label>
                    <Input id="pc2" value={c2 ?? d.protected.contacts[1] ?? ""} onChange={(e) => setC2(e.target.value)} className="min-h-11 bg-card" />
                  </div>
                  <Button type="submit" variant={d.protected.on ? "outline" : "default"} className="justify-self-start" disabled={Boolean(busy)}>
                    <Busy on={busy === "prot"}>{null}</Busy>
                    {d.protected.on ? "Turn protected mode off" : "Turn protected mode on"}
                  </Button>
                </form>
              </Panel>
              <Panel title="Holds the safety layer made">
                {d.holds.length ? (
                  <ul className="space-y-3">
                    {d.holds.map((h) => (
                      <li key={h.id} className="text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <b>
                            {h.action} {money(h.cents)}
                          </b>
                          <State s={h.status === "approved" ? "succeeded" : h.status === "pending" ? "held" : h.status} />
                        </div>
                        {h.reasons.length > 0 && (
                          <ul className="mt-1 list-disc pl-5 text-ink-2">
                            {h.reasons.map((x) => (
                              <li key={x}>{x}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty icon={<ShieldCheck className="size-6" />} title="Nothing held.">
                    If a payment looks like a scam pattern, it waits here and on Rules.
                  </Empty>
                )}
              </Panel>
            </div>
            <Panel id="inbox" title="Messages you received">
              {d.inbox.length ? (
                <ul className="space-y-3">
                  {d.inbox.map((m) => (
                    <li key={m.id} className={cn("rounded-md border p-3 text-sm", m.flag ? (m.flag.serious ? "border-stop/50 bg-stop-bg" : "border-wait/50 bg-wait-bg") : "border-rule")}>
                      {m.flag && (
                        <p role="alert" className={cn("mb-1 flex items-start gap-1.5 font-semibold", m.flag.serious ? "text-stop" : "text-wait")}>
                          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                          This message {m.flag.words.join(", and ")}. Everyday only pays through PayPal checkout; nothing in a message changes that.
                        </p>
                      )}
                      <p className="break-words">{m.text}</p>
                      <p className="num mt-1 text-xs text-ink-2">
                        {m.channel} · {when(m.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title="No messages.">Messages from shops and the Telegram bot show here, checked as they arrive.</Empty>
              )}
            </Panel>
            <Panel id="sellers" title="Sellers" sub="A first payment to a seller found on the open web is a caution; with protected mode on it waits for you.">
              <ul className="divide-y divide-rule text-sm">
                {d.sellers.map((s) => (
                  <li key={s.name} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">{s.name.replace(/\s*\(.*\)$/, "")}</span>
                    <State s={s.kind === "discovery" ? "pending" : "paid"} label={s.kind === "discovery" ? "found on the web" : "test merchant"} />
                    <span className="num w-16 text-right text-ink-2">{s.paid} paid</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </Loaded>
  );
}

const CARD = [
  ["ScamShield SMS test", "8,188", "0.988", "75%", "real Singapore SMS, in-distribution"],
  ["ScamShield eval sets", "1,574", "0.979", "67%", "real and hand-written"],
  ["Singlish genuine", "600", "—", "1.0% held", "real everyday messages: the false-alarm check"],
  ["Business templates", "200", "0.85", "11%", "author-written, held-out templates"],
  ["Business email (BEC) seed", "200", "0.58", "25%", "hand-written; the model is weak here"],
];

export function ModelCard() {
  return (
    <div className="ev-rise">
      <Link to="/safety" className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Scam protection
      </Link>
      <PageHead eyebrow="Model card" title="How the scam check was tested" lede="Numbers come from frozen test sets the model never trained on. Everything synthetic is marked." />
      <div className="space-y-6">
        <Panel title="Text model" sub="Runs in your browser, 23 MB, int8 ONNX.">
          <div className="rail-scroll" tabIndex={0} role="region" aria-label="Table (scrolls sideways)">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-xs tracking-wide text-ink-2 uppercase">
                  <th className="py-2 pr-3 font-semibold">Test set</th>
                  <th className="py-2 pr-3 text-right font-semibold">Messages</th>
                  <th className="py-2 pr-3 text-right font-semibold">AUC</th>
                  <th className="py-2 pr-3 text-right font-semibold">Caught at 1% genuine held</th>
                  <th className="py-2 font-semibold">What it is</th>
                </tr>
              </thead>
              <tbody className="num">
                {CARD.map((r) => (
                  <tr key={r[0]} className="border-b border-rule last:border-0">
                    <td className="py-2 pr-3">{r[0]}</td>
                    <td className="py-2 pr-3 text-right">{r[1]}</td>
                    <td className="py-2 pr-3 text-right">{r[2]}</td>
                    <td className="py-2 pr-3 text-right">{r[3]}</td>
                    <td className="py-2 text-ink-2">{r[4]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-ink-2">The browser and Python versions agree on the hold decision for 197 of 200 messages; the three differ because int8 arithmetic differs between runtimes. The training notebooks aren't in this repository, so these figures can't be re-run from it.</p>
        </Panel>
        <Panel title="Payment-risk model">
          <p className="text-sm">
            LightGBM, 300 trees, monotone: a scam signal can only raise the score. <b>Trained on synthetic data</b>; there's no real payment-fraud data in this project. Its score is a ranking signal shown next to the rule reasons, never a fraud rate.
          </p>
        </Panel>
      </div>
    </div>
  );
}
