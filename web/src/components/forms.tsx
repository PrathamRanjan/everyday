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

export type Recipient = { id: string; name: string; relation: string; is_self: boolean };

/** A text box with optional voice typing (Display and help → Voice typing). */
export function SpeakableText({ id, value, onChange, placeholder, rows = 2, required, className }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; required?: boolean; className?: string }) {
  const { prefs } = usePrefs();
  const dict = useDictation((t) => onChange(value ? `${value} ${t}` : t));
  return (
    <div className={cn("relative", className)}>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} required={required} className="min-h-12 resize-y bg-card pr-12 text-base" />
      {prefs.voiceInput && dict.supported && (
        <Button type="button" size="icon-sm" variant={dict.on ? "default" : "ghost"} className="absolute top-1 right-1" onClick={dict.start} aria-label={dict.on ? "Listening" : "Speak instead of typing"}>
          <Mic className="size-4" />
        </Button>
      )}
    </div>
  );
}

/** "What do you need?" — creates a plan through the existing POST /plans route. */
/** A5.5: the server's sentence when the model couldn't read a request. The page then offers a retry and the manual form. */
export const AI_FAILED = "I couldn't read that. Try again, or fill it in below.";
const KINDS: [string, string][] = [["lamp", "Desk lamp"], ["chair", "Chair"], ["dock", "Dock or hub"], ["mouse", "Mouse"], ["keyboard", "Keyboard"], ["monitor_arm", "Monitor arm"], ["desk_mat", "Desk mat"], ["webcam", "Webcam"], ["headphones", "Headphones or earbuds"]];

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
      aria-label="Fill it in by hand"
      onSubmit={(e) => {
        e.preventDefault();
        void run("manual", "/plans", { manual: "1", text, category, budget, by, must, recipient_id: recipient, capture_id: captureId });
      }}
    >
      <p className="text-sm font-medium">Fill it in by hand</p>
      <div className="grid gap-1.5">
        <Label htmlFor="mp-kind">What kind of item</Label>
        <select id="mp-kind" required value={category} onChange={(e) => setCategory(e.target.value)} className="min-h-11 rounded-md border border-rule-2 bg-card px-3 text-base">
          <option value="">Choose…</option>
          {KINDS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="mp-budget">Budget in dollars (optional)</Label>
          <Input id="mp-budget" inputMode="numeric" pattern="[0-9]{1,5}" value={budget} onChange={(e) => setBudget(e.target.value)} className="min-h-11" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="mp-by">Needed by (optional)</Label>
          <Input id="mp-by" type="date" value={by} onChange={(e) => setBy(e.target.value)} className="min-h-11" />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="mp-must">Must be (optional, commas between)</Label>
        <Input id="mp-must" value={must} onChange={(e) => setMust(e.target.value)} placeholder="wireless, quiet" className="min-h-11" />
      </div>
      <Button type="submit" disabled={Boolean(busy) || !category}>
        <Busy on={busy === "manual"}>{null}</Busy>
        Plan it from this form
      </Button>
    </form>
  );
}

export function PlanForm({ recipients, captureId, disabled, hint, placeholder = "A quiet mouse under $45 by Thursday", label = "What do you need?" }: { recipients: Recipient[]; captureId?: string; disabled?: boolean; hint?: string; placeholder?: string; label?: string }) {
  const [text, setText] = useState("");
  const [rcp, setRcp] = useState(recipients[0]?.id ?? "");
  const [failed, setFailed] = useState(false);
  const { run, busy } = useAction();
  const submit = async () => {
    const out = await run("plan", "/plans", { text, recipient_id: rcp, capture_id: captureId });
    setFailed(out?.err === AI_FAILED);
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
      <p className="text-xs text-ink-2">Say the budget, the day and anything it must be. The model reads the words; code reads every number.</p>
      {recipients.length > 1 && (
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1.5 text-sm font-medium">For</legend>
          {recipients.map((r) => (
            <label key={r.id} className={cn("inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm", rcp === r.id ? "border-ink bg-ink text-paper" : "border-rule-2 bg-card")}>
              <input type="radio" name="recipient" value={r.id} checked={rcp === r.id} onChange={() => setRcp(r.id)} className="sr-only" />
              {r.is_self ? "Me" : `${r.name} · ${r.relation}`}
            </label>
          ))}
        </fieldset>
      )}
      {recipients.find((r) => r.id === rcp && !r.is_self) && <p className="text-xs text-ink-2">A gift: it's planned with what they own, and won't change what Everyday learns about your taste.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={Boolean(busy) || disabled || (!text.trim() && !captureId)}>
          <Busy on={busy === "plan"}>{null}</Busy>
          {busy === "plan" ? "Reading and planning…" : "Plan it"}
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
            Try again
          </Button>
        </div>
        <ManualPlan text={text} recipient={rcp} captureId={captureId} />
      </div>
    )}
    </div>
  );
}
