import { useState } from "react";
import { View } from "react-native";
import { Button, Chips, Field, Txt } from "./ui";
import { useAct } from "@/lib/useAct";
import { useTheme } from "@/lib/theme";

export type Recipient = { id: string; name: string; relation: string; is_self: boolean };

/** A5.5: the server's sentence when the model couldn't read a request. */
export const AI_FAILED = "I couldn't read that. Try again, or fill it in below.";
const KINDS = [
  { value: "lamp", label: "Desk lamp" },
  { value: "chair", label: "Chair" },
  { value: "dock", label: "Dock or hub" },
  { value: "mouse", label: "Mouse" },
  { value: "keyboard", label: "Keyboard" },
  { value: "monitor_arm", label: "Monitor arm" },
  { value: "desk_mat", label: "Desk mat" },
  { value: "webcam", label: "Webcam" },
  { value: "headphones", label: "Headphones" },
];

/** The manual form: each field chosen by the person, nothing read by a model. */
function ManualPlan({ text, recipient, captureId }: { text: string; recipient: string; captureId?: string }) {
  const [category, setCategory] = useState("");
  const [budget, setBudget] = useState("");
  const [by, setBy] = useState("");
  const [must, setMust] = useState("");
  const { run, busy } = useAct();
  return (
    <>
      <Txt weight="bold" size={14}>
        Fill it in by hand
      </Txt>
      <Chips label="What kind of item" value={category} onChange={setCategory} options={KINDS} />
      <Field label="Budget in dollars (optional)" value={budget} onChangeText={setBudget} keyboardType="number-pad" />
      <Field label="Needed by (optional, YYYY-MM-DD)" value={by} onChangeText={setBy} placeholder="2026-11-20" />
      <Field label="Must be (optional, commas between)" value={must} onChangeText={setMust} placeholder="wireless, quiet" />
      <Button label="Plan it from this form" busy={busy === "manual"} disabled={!category || Boolean(busy)} onPress={() => void run("manual", "/plans", { manual: "1", text, category, budget, by, must, recipient_id: recipient, capture_id: captureId })} />
    </>
  );
}

/** "What do you need?" — the same POST /plans the website uses, tagged as from the phone. */
export function PlanForm({ recipients, captureId, disabled, label = "What do you need?", placeholder = "For example: a quiet mouse under $45 by Thursday" }: { recipients: Recipient[]; captureId?: string; disabled?: boolean; label?: string; placeholder?: string }) {
  const { c } = useTheme();
  const [text, setText] = useState("");
  const [rcp, setRcp] = useState(recipients[0]?.id ?? "");
  const { run, busy, error } = useAct();
  const failed = error === AI_FAILED;
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
      {failed && (
        <>
          <View accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Txt>{AI_FAILED}</Txt>
          </View>
          <Button label="Try again" kind="secondary" busy={busy === "plan"} disabled={Boolean(busy)} onPress={() => void run("plan", "/plans", { text, recipient_id: rcp, capture_id: captureId })} />
          <ManualPlan text={text} recipient={rcp} captureId={captureId} />
        </>
      )}
    </>
  );
}
