import { Accessibility, Volume2, VolumeX } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { usePrefs, useReadAloud, type Prefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

function Row({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <Label htmlFor={id} className="flex flex-col items-start gap-0.5 text-sm font-medium">
        {label}
        {hint && <span className="text-xs font-normal text-ink-2">{hint}</span>}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}

const SIZES: Prefs["textScale"][] = [1, 1.15, 1.3, 1.5];

/** "Display and help": text size, contrast, font, motion, target size, simple words, read aloud, extra time. */
export function DisplayHelp() {
  const { prefs, set, reset } = usePrefs();
  const read = useReadAloud();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("Display and help")} title={t("Display and help")} data-tour="display-help">
          <Accessibility className="size-[18px]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,340px)] bg-card p-4">
        <h2 className="font-display text-lg">{t("Display and help")}</h2>
        <p className="mb-3 text-xs text-ink-2">{t("Saved on this device only.")}</p>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{t("Text size")}</legend>
          <div className="grid grid-cols-4 gap-1 rounded-full bg-sunk p-1">
            {SIZES.map((s) => (
              <button key={s} type="button" aria-pressed={prefs.textScale === s} onClick={() => set({ textScale: s })} className={cn("num min-h-10 rounded-full text-sm font-semibold text-ink-2", prefs.textScale === s && "bg-card text-ink shadow-sm")}>
                {Math.round(s * 100)}%
              </button>
            ))}
          </div>
        </fieldset>
        <div className="mt-2 divide-y divide-rule">
          <Row id="a11y-contrast" label={t("Higher contrast")} checked={prefs.contrast === "high"} onChange={(v) => set({ contrast: v ? "high" : "default" })} />
          <Row id="a11y-font" label={t("Easier-to-read font")} hint={t("Atkinson Hyperlegible")} checked={prefs.font === "hyperlegible"} onChange={(v) => set({ font: v ? "hyperlegible" : "default" })} />
          <Row id="a11y-motion" label={t("Turn off motion")} hint={t("Otherwise follows your device")} checked={prefs.reducedMotion === true} onChange={(v) => set({ reducedMotion: v ? true : "system" })} />
          <Row id="a11y-targets" label={t("Bigger buttons")} checked={prefs.bigTargets} onChange={(v) => set({ bigTargets: v })} />
          <Row id="a11y-simple" label={t("Fewer details")} hint={t("Hides IDs and technical notes")} checked={prefs.simpleWords} onChange={(v) => set({ simpleWords: v })} />
          <Row id="a11y-time" label={t("Extra time")} hint={t("Quotes and approvals never auto-refresh away")} checked={prefs.extraTime} onChange={(v) => set({ extraTime: v })} />
          <Row id="a11y-voice" label={t("Microphone on text boxes")} hint={t("Hold it to talk instead of typing, where the browser supports it")} checked={!prefs.hideMic} onChange={(v) => set({ hideMic: !v })} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {read.supported && (
            <Button variant="outline" size="sm" onClick={read.toggle} aria-pressed={read.speaking}>
              {read.speaking ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              {read.speaking ? t("Stop reading") : t("Read this page aloud")}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={reset}>
            {t("Reset")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
