import { useState } from "react";
import { Busy, Stat } from "@/components/kit";
import { SpeakableText } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { t, tn } from "@/i18n";

/** What /safety/scan returns (src/safety/readers.ts): rules, Decisions and the code reader; strictest wins. */
export interface ServerRead {
  level: "hold" | "caution" | "clear";
  state: "hold" | "caution" | "pay_somewhere" | "unconfirmed" | "clear";
  headline: string;
  reasons: string[];
  tactics: string[];
  risk?: number;
  rules: { level: string; reasons: string[]; tactics: string[]; risk: number };
  decisions: { ran: boolean; why_not: string | null; model: string | null; latency_ms: number | null; answers: { name: string; probability: number | null; verdict: string; threshold: { clear_below: number; hold_above: number; calibrated: boolean } }[] };
  code: { destinations: { kind: string; value: string; why: string }[] };
  error?: string;
}
export interface ModelResult { p_scam: number; level: "hold" | "caution" | "clear"; tactics: Record<string, number> }

let guardPromise: Promise<{ score: (t: string) => Promise<ModelResult> }> | null = null;
const ORT = "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.22.0/";
/** The fine-tuned scam text model, int8 ONNX, scored in this browser with onnxruntime-web. The text never leaves the device for this score. */
export function loadModel() {
  if (guardPromise) return guardPromise;
  guardPromise = (async () => {
    const w = window as any;
    if (!w.ort)
      await new Promise<void>((res, rej) => {
        const s = document.createElement("script");
        s.src = `${ORT}ort.min.js`;
        s.onload = () => res();
        s.onerror = () => rej(new Error(t("onnxruntime-web did not load")));
        document.head.appendChild(s);
      });
    w.ort.env.wasm.wasmPaths = ORT;
    const mod = await import(/* @vite-ignore */ "/static/safety/guard-client.js" as string);
    return mod.loadGuard({ modelUrl: "/static/safety/model/model_quantized.onnx", tokenizerUrl: "/static/safety/model/tokenizer.json", headsUrl: "/static/safety/model/heads.json", ort: w.ort });
  })();
  guardPromise.catch(() => (guardPromise = null));
  return guardPromise;
}

const TONE = { hold: "border-stop bg-stop-bg text-stop", caution: "border-wait bg-wait-bg text-wait", pay_somewhere: "border-wait bg-wait-bg text-wait", unconfirmed: "border-wait bg-wait-bg text-wait", clear: "border-done bg-done-bg text-done" } as const;
const PRED_WORDS: Record<string, string> = {
  impersonation: "claims to be someone trusted",
  urgency_or_secrecy: "pushes to act fast or keep quiet",
  changed_payment_details: "new or changed payment details",
  pay_outside_paypal: "pay outside PayPal's checkout",
  gift_cards_or_crypto: "gift cards or crypto",
  fee_to_release: "a fee to release something",
  code_or_link: "a code or a link",
  overpay_and_refund: "overpaid, send the difference",
  too_good_to_be_true: "too good to be true",
  asks_for_payment: "asks you to pay",
  names_a_payment_destination: "names where to send money",
};

/**
 * A6.1/A6.2 on screen: the on-device model, the rules, Decisions and the code reader side by side; the strictest wins,
 * and green only when the server says every reader is clear (A6.2) and the on-device model agrees.
 */
export function ScamCheck({ demo, tactics, context, compact }: { demo?: string; tactics?: { key: string; words: string }[]; context?: string; compact?: boolean }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ server: ServerRead | null; serverErr: string | null; model: ModelResult | null; modelErr: string | null; ms: number } | null>(null);
  const words = Object.fromEntries((tactics ?? []).map((t) => [t.key, t.words]));
  const check = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setOut(null);
    let server: ServerRead | null = null;
    let serverErr: string | null = null;
    let model: ModelResult | null = null;
    let modelErr: string | null = null;
    let ms = 0;
    setStatus(t("Checking with the rules and the second reader…"));
    try {
      const r = await fetch("/safety/scan", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ text, context }) });
      const j = await r.json();
      if (!r.ok) serverErr = j.message ?? `The server check failed (${r.status}).`;
      else server = j;
    } catch (e) {
      serverErr = (e as Error).message;
    }
    try {
      setStatus(guardPromise ? t("Scoring on this device…") : t("Loading the model onto this device (23 MB, once)…"));
      const g = await loadModel();
      const t0 = performance.now();
      model = await g.score(text);
      ms = performance.now() - t0;
    } catch (e) {
      modelErr = (e as Error).message;
    }
    setOut({ server, serverErr, model, modelErr, ms });
    setStatus("");
    setBusy(false);
  };
  const s = out?.server;
  const m = out?.model;
  const modelTactic = Object.values(m?.tactics ?? {}).some((p) => p >= 0.5);
  // The device model can raise the level; it can't lower it. A server error is never green.
  let state: keyof typeof TONE | null = null;
  let headline = "";
  if (out) {
    if (!s) (state = "unconfirmed"), (headline = t("Not confirmed clear: the server check didn't run"));
    else if (s.state === "hold" || m?.level === "hold") (state = "hold"), (headline = t("Hold: don't pay yet"));
    else if (s.state !== "clear") (state = s.state), (headline = s.headline);
    else if (m?.level === "caution" && modelTactic) (state = "caution"), (headline = t("Caution: check before you pay"));
    else (state = "clear"), (headline = t("No scam signs found"));
  }
  const found = new Set([...(s?.tactics ?? []), ...Object.entries(m?.tactics ?? {}).filter(([, p]) => p >= 0.5).map(([k]) => k)]);
  return (
    <div className="grid gap-3">
      <Label htmlFor={`scan-${context ?? "page"}`}>{compact ? t("Paste the message you got") : t("Paste a seller's reply, a marketplace message or a text about a parcel")}</Label>
      <SpeakableText id={`scan-${context ?? "page"}`} value={text} onChange={setText} rows={compact ? 3 : 5} placeholder={t("Paste the message here")} />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={check} disabled={busy || !text.trim()}>
          <Busy on={busy}>{null}</Busy>{t("Check this message")}
        </Button>
        {demo && (
          <Button variant="outline" onClick={() => setText(demo)}>
            {t("Paste the demo scam")}
          </Button>
        )}
        <span className="text-sm text-ink-2" aria-live="polite">
          {status}
        </span>
      </div>
      {out && state && (
        <div aria-live="polite" className="grid gap-3">
          <div role="status" className={cn("rounded-lg border p-3 font-semibold", TONE[state])}>
            {headline}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t("On this device")} value={m ? `${Math.round(m.p_scam * 100)}%` : "—"} hint={m ? t("{0} ms; nothing left your browser", out.ms.toFixed(0)) : (out.modelErr ?? t("not run"))} />
            <Stat label={t("Rules")} value={s?.rules.level ?? "—"} hint={s ? (s.rules.reasons.length ? `${s.rules.reasons.length} reason${s.rules.reasons.length > 1 ? "s" : ""}` : t("no rule fired")) : (out.serverErr ?? t("not run"))} />
            <Stat label={t("Second reader")} value={s?.decisions.ran ? `${s.decisions.answers.filter((a) => a.verdict === "yes").length} yes` : "—"} hint={s?.decisions.ran ? t("{0}, {1} ms", s.decisions.model, s.decisions.latency_ms) : (s?.decisions.why_not ?? t("not run"))} />
            <Stat label={t("Pay-to details")} value={s ? String(s.code.destinations.filter((d) => d.kind !== "link").length) : "—"} hint={s ? (s.code.destinations.length ? `${s.code.destinations.length} found` : t("none named")) : t("not run")} />
          </div>
          {s?.reasons?.length ? (
            <div>
              <h3 className="text-sm font-semibold">{t("Why")}</h3>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {s.reasons.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {!compact && found.size > 0 && (
            <div>
              <h3 className="text-sm font-semibold">{t("What this message does")}</h3>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {[...found].map((k) => (
                  <li key={k}>{words[k] ?? k}</li>
                ))}
              </ul>
            </div>
          )}
          {!compact && s?.decisions.ran && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold">{t("The second reader's answers")}</summary>
              <table className="mt-2 w-full text-left text-xs">
                <thead>
                  <tr>
                    <th className="py-1">{t("Question")}</th>
                    <th>{t("Probability")}</th>
                    <th>{t("Answer")}</th>
                    <th>{t("Thresholds")}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.decisions.answers.map((a) => (
                    <tr key={a.name} className="border-t border-line">
                      <td className="py-1">{PRED_WORDS[a.name] ?? a.name}</td>
                      <td>{a.probability === null ? "—" : a.probability.toFixed(2)}</td>
                      <td>{a.verdict.replace("_", " ")}</td>
                      <td>
                        {tn("no below {0}, yes from {1}{2}", a.threshold.clear_below, a.threshold.hold_above, a.threshold.calibrated ? "" : t(" (not calibrated)"))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          <p className="text-sm text-ink-2">
            {tn("What to do: pay only through Everyday's own PayPal checkout, or to details you confirmed by phone on a number you already had. Never share codes. {0}", state === "clear" ? t("A clear result isn't a guarantee.") : "")}
          </p>
        </div>
      )}
    </div>
  );
}
