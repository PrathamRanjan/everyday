import { useState } from "react";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
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
export function PlanForm({ recipients, captureId, disabled, hint, placeholder = "A quiet mouse under $45 by Thursday", label = "What do you need?" }: { recipients: Recipient[]; captureId?: string; disabled?: boolean; hint?: string; placeholder?: string; label?: string }) {
  const [text, setText] = useState("");
  const [rcp, setRcp] = useState(recipients[0]?.id ?? "");
  const { run, busy } = useAction();
  return (
    <form
      data-tour="plan-form"
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run("plan", "/plans", { text, recipient_id: rcp, capture_id: captureId });
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
  );
}
