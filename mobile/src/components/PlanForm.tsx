import { useState } from "react";
import { Button, Chips, Field, Txt } from "./ui";
import { useAct } from "@/lib/useAct";
import { useTheme } from "@/lib/theme";

export type Recipient = { id: string; name: string; relation: string; is_self: boolean };

/** "What do you need?" — the same POST /plans the website uses, tagged as from the phone. */
export function PlanForm({ recipients, captureId, disabled, label = "What do you need?", placeholder = "For example: a quiet mouse under $45 by Thursday" }: { recipients: Recipient[]; captureId?: string; disabled?: boolean; label?: string; placeholder?: string }) {
  const { c } = useTheme();
  const [text, setText] = useState("");
  const [rcp, setRcp] = useState(recipients[0]?.id ?? "");
  const { run, busy } = useAct();
  const gift = recipients.find((r) => r.id === rcp && !r.is_self);
  return (
    <>
      <Field label={label} value={text} onChangeText={setText} placeholder={placeholder} multiline hint="Say the budget, the day and anything it must be. The model reads the words; code reads every number." />
      {recipients.length > 1 && <Chips label="For" value={rcp} onChange={setRcp} options={recipients.map((r) => ({ value: r.id, label: r.is_self ? "Me" : `${r.name} · ${r.relation}` }))} />}
      {gift && (
        <Txt size={12} color={c.ink2}>
          A gift: it's planned with what they own, and won't change what Everyday learns about your taste.
        </Txt>
      )}
      <Button
        label={busy ? "Reading and planning…" : "Plan it"}
        busy={Boolean(busy)}
        disabled={disabled || (!text.trim() && !captureId)}
        onPress={async () => {
          const out = await run("plan", "/plans", { text, recipient_id: rcp, capture_id: captureId });
          if (out) setText("");
        }}
      />
    </>
  );
}
