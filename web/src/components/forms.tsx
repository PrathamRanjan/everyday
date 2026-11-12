import { useState } from "react";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Busy } from "./kit";
import { useAction } from "@/lib/api";
import { useDictation, usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { t, N_ } from "@/i18n";

export type Recipient = { id: string; name: string; relation: string; is_self: boolean };

/** A text box with optional voice typing (Display and help → Voice typing). */
export function SpeakableText({ id, value, onChange, placeholder, rows = 2, required, className }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; required?: boolean; className?: string }) {
  const { prefs } = usePrefs();
  const dict = useDictation((t) => onChange(value ? `${value} ${t}` : t));
  return (
    <div className={cn("relative", className)}>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} required={required} className="min-h-12 resize-y bg-card pr-12 text-base" />
      {prefs.voiceInput && dict.supported && (
        <Button type="button" size="icon-sm" variant={dict.on ? "default" : "ghost"} className="absolute top-1 right-1" onClick={dict.start} aria-label={dict.on ? t("Listening") : t("Speak instead of typing")}>
          <Mic className="size-4" />
        </Button>
      )}
    </div>
  );
}

/** "What do you need?" — creates a plan through the existing POST /plans route. */
/** A5.5: the server's sentence when the model couldn't read a request. The page then offers a retry and the manual form. */
export const AI_FAILED = "I couldn't read that. Try again, or fill it in below.";
const KINDS: [string, string][] = [["lamp", N_("Desk lamp")], ["chair", N_("Chair")], ["dock", N_("Dock or hub")], ["mouse", N_("Mouse")], ["keyboard", N_("Keyboard")], ["monitor_arm", N_("Monitor arm")], ["desk_mat", N_("Desk mat")], ["webcam", N_("Webcam")], ["headphones", N_("Headphones or earbuds")]];

/** The manual form: each field chosen by the person, nothing read by a model. */
function ManualPlan({ text, recipient, captureId }: { text: string; recipient: string; captureId?: string }) {
  const [category, setCategory] = useState("");
  const [budget, setBudget] = useState("");
  const [by, setBy] = useState("");
  const [must, setMust] = useState("");
  const { run, busy } = useAction();
  return (
    <form
      className="grid gap-3 rounded-lg border border-rule-2 p-3"
      aria-label={t("Fill it in by hand")}
      onSubmit={(e) => {
        e.preventDefault();
        void run("manual", "/plans", { manual: "1", text, category, budget, by, must, recipient_id: recipient, capture_id: captureId }).then((out) => {
          try {
            if (out && !out.err) sessionStorage.removeItem(`ev-plan-failed:${captureId ?? ""}`);
          } catch {
            /* nothing to clear */
          }
        });
      }}
    >
      <p className="text-sm font-medium">{t("Fill it in by hand")}</p>
      <div className="grid gap-1.5">
        <Label htmlFor="mp-kind">{t("What kind of item")}</Label>
        <select id="mp-kind" required value={category} onChange={(e) => setCategory(e.target.value)} className="min-h-11 rounded-md border border-rule-2 bg-card px-3 text-base">
          <option value="">{t("Choose…")}</option>
          {KINDS.map(([v, l]) => (
            <option key={v} value={v}>
              {t(l)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="mp-budget">{t("Budget in dollars (optional)")}</Label>
          <Input id="mp-budget" inputMode="numeric" pattern="[0-9]{1,5}" value={budget} onChange={(e) => setBudget(e.target.value)} className="min-h-11" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="mp-by">{t("Needed by (optional)")}</Label>
          <Input id="mp-by" type="date" value={by} onChange={(e) => setBy(e.target.value)} className="min-h-11" />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="mp-must">{t("Must be (optional, commas between)")}</Label>
        <Input id="mp-must" value={must} onChange={(e) => setMust(e.target.value)} placeholder={t("wireless, quiet")} className="min-h-11" />
      </div>
      <Button type="submit" disabled={Boolean(busy) || !category}>
        <Busy on={busy === "manual"}>{null}</Busy>
        {t("Plan it from this form")}
      </Button>
    </form>
  );
}

export function PlanForm({ recipients, captureId, disabled, hint, placeholder = t("A quiet mouse under $45 by Thursday"), label = t("What do you need?") }: { recipients: Recipient[]; captureId?: string; disabled?: boolean; hint?: string; placeholder?: string; label?: string }) {
  // The page refetches (and remounts this form) after every action, so a failed reading is kept for this tab until it
  // is retried or planned by hand; otherwise the retry and the manual form would vanish with the toast.
  const KEY = `ev-plan-failed:${captureId ?? ""}`;
  const saved = (() => {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  })();
  // A3.1: a judge-page button opens this page with the sentence already typed (?text=).
  const typed = typeof window !== "undefined" && !captureId ? new URLSearchParams(window.location.search).get("text") : null;
  const [text, setText] = useState(saved ?? typed ?? "");
  const [rcp, setRcp] = useState(recipients[0]?.id ?? "");
  const [failed, setFailed] = useState(saved !== null);
  const { run, busy } = useAction();
  const submit = async () => {
    const out = await run("plan", "/plans", { text, recipient_id: rcp, capture_id: captureId });
    const bad = out?.err === AI_FAILED;
    try {
      if (bad) sessionStorage.setItem(KEY, text);
      else sessionStorage.removeItem(KEY);
    } catch {
      /* the panel still shows until the page reloads */
    }
    setFailed(bad);
  };
  return (
    <div className="grid gap-4">
    <form
      data-tour="plan-form"
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Label htmlFor="plan-text">{label}</Label>
      <SpeakableText id="plan-text" value={text} onChange={setText} placeholder={placeholder} required={!captureId} />
      <p className="text-xs text-ink-2">{t("Say the budget, the day and anything it must be. The model reads the words; code reads every number.")}</p>
      {recipients.length > 1 && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1.5 text-sm font-medium">{t("For")}</legend>
          {recipients.map((r) => (
            <label key={r.id} className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm", rcp === r.id ? "border-ink bg-ink text-paper" : "border-rule-2 bg-card")}>
              <input type="radio" name="recipient" value={r.id} checked={rcp === r.id} onChange={() => setRcp(r.id)} className="sr-only" />
              {r.is_self ? t("Me") : `${r.name} · ${r.relation}`}
            </label>
          ))}
        </fieldset>
      )}
      {recipients.find((r) => r.id === rcp && !r.is_self) && <p className="text-xs text-ink-2">{t("A gift: it's planned with what they own, and won't change what Everyday learns about your taste.")}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={Boolean(busy) || disabled || (!text.trim() && !captureId)}>
          <Busy on={busy === "plan"}>{null}</Busy>
          {busy === "plan" ? t("Reading and planning…") : t("Plan it")}
        </Button>
        {hint && <span className="text-sm text-ink-2">{hint}</span>}
      </div>
    </form>
    {failed && (
      <div role="alert" className="grid gap-3">
        <p className="text-sm">{AI_FAILED}</p>
        <div>
          <Button type="button" variant="outline" onClick={() => void submit()} disabled={Boolean(busy)}>
            <Busy on={busy === "plan"}>{null}</Busy>
            {t("Try again")}
          </Button>
        </div>
        <ManualPlan text={text} recipient={rcp} captureId={captureId} />
      </div>
    )}
    </div>
  );
}
