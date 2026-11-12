import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Hand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { t } from "@/i18n";
import { announce } from "@/lib/announce";
import type { Mode } from "./HandsFree";

// The engine (camera, face tracker, speech) loads only when someone switches hands-free on.
const HandsFree = lazy(() => import("./HandsFree").then((m) => ({ default: m.HandsFree })));
const KEY = "ev-hf-mode";

/** A1.9: the header switch. Alt+Shift+H turns it on with the last mode, or off. */
export function HandsFreeToggle() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [open, setOpen] = useState(false);
  const start = useCallback((m: Mode) => {
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* not remembered */
    }
    setOpen(false);
    setMode(m);
  }, []);
  const stop = useCallback((why: string) => {
    console.info("[hands-free] stopped:", why);
    setMode(null);
    announce(why || t("Hands-free is off."));
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.code === "KeyH") {
        e.preventDefault();
        setMode((m) => {
          if (m) return null;
          try {
            return (localStorage.getItem(KEY) as Mode | null) ?? "voice";
          } catch {
            return "voice";
          }
        });
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const choice = (m: Mode, title: string, sub: string) => (
    <li>
      <button type="button" className="w-full rounded-md px-2 py-2 text-left hover:bg-sunk" onClick={() => start(m)} data-testid={`handsfree-${m}`}>
        <span className="block font-semibold text-ink">{title}</span>
        <span className="block text-xs text-ink-2">{sub}</span>
      </button>
    </li>
  );
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={mode ? t("Hands-free is on. Turn it off") : t("Hands-free (look and say)")} title={t("Hands-free (Alt+Shift+H)")} aria-pressed={Boolean(mode)} data-testid="handsfree-toggle" onClick={(e) => {
            if (mode) {
              e.preventDefault();
              stop(t("Hands-free is off."));
            }
          }}>
            <Hand className={mode ? "size-[18px] text-stop" : "size-[18px]"} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-2">
          <div className="eyebrow px-2 pt-1 pb-2">{t("Hands-free: look and say")}</div>
          <ul role="list" className="space-y-1">
            {choice("eyes", t("Eyes + voice"), t("Look at a button and hold, wink, or say “click”. Calibrates with nine dots first."))}
            {choice("head", t("Head + voice"), t("No calibration: turn your head to move the point. Good with glasses or low light."))}
            {choice("voice", t("Voice only"), t("No camera. Say “Peek”, then what to do."))}
          </ul>
          <p className="px-2 pt-2 text-xs text-ink-2">{t("The camera is read on this device and nothing from it is sent or kept. Speech goes to your browser's speech service to become words. Esc or “stop” turns it off.")}</p>
        </PopoverContent>
      </Popover>
      {mode && (
        <Suspense fallback={null}>
          <HandsFree key={mode} mode={mode} onStop={stop} />
        </Suspense>
      )}
    </>
  );
}
