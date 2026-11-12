import { Check, Languages } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { LANGS, getLang, setLang, t, useLang } from "@/i18n";
import { announce } from "@/lib/announce";
import { lakhOn, setLakh } from "@/lib/format";
import { cn } from "@/lib/utils";

const MACHINE = "Translated by a machine; a person hasn't reviewed it yet. Payment and consent wording is checked by code, not by the translation.";

/** B1.1: the language menu, each name written in its own language. Switching keeps every form as it was. */
export function LangPicker({ className }: { className?: string }) {
  useLang();
  const cur = getLang();
  const pick = async (code: (typeof LANGS)[number]["code"]) => {
    await setLang(code);
    announce(t("Language: {0}", LANGS.find((l) => l.code === code)!.name));
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={cn("gap-1.5 px-2", className)} aria-label={t("Language: {0}. Change language", LANGS.find((l) => l.code === cur)!.name)} data-testid="lang-picker">
          <Languages className="size-4" />
          <span className="text-xs font-semibold uppercase" data-no-i18n>{cur}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="eyebrow px-2 pt-1 pb-2">{t("Language")}</div>
        <ul role="list" className="space-y-1">
          {LANGS.map((l) => (
            <li key={l.code}>
              <button type="button" lang={l.tag} onClick={() => void pick(l.code)} aria-pressed={cur === l.code} className={cn("flex min-h-11 w-full items-center justify-between rounded-md px-3 text-left text-sm hover:bg-sunk", cur === l.code && "font-semibold")}>
                <span>{l.name}</span>
                {cur === l.code && <Check className="size-4" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
        {cur === "hi" && (
          <label className="mt-2 flex min-h-11 items-center gap-2 px-3 text-sm">
            <input type="checkbox" defaultChecked={lakhOn()} onChange={(e) => {
              setLakh(e.target.checked);
              void setLang(cur);
            }} />
            {t("Group numbers in lakhs (1,00,000)")}
          </label>
        )}
        {cur !== "en" && <p className="mt-2 border-t border-rule px-3 pt-2 text-xs text-ink-2">{t(MACHINE)}</p>}
      </PopoverContent>
    </Popover>
  );
}

/** The same choice as plain links, for the first screen. */
export function LangLinks({ className }: { className?: string }) {
  useLang();
  const cur = getLang();
  return (
    <nav aria-label={t("Language")} className={cn("flex flex-wrap gap-x-1 gap-y-1 text-sm", className)}>
      {LANGS.map((l, i) => (
        <span key={l.code} className="inline-flex items-center">
          {i > 0 && <span aria-hidden className="px-1 text-ink-2">·</span>}
          <button type="button" lang={l.tag} onClick={() => void setLang(l.code)} aria-current={cur === l.code ? "true" : undefined} className={cn("min-h-11 rounded px-1 underline-offset-4 hover:underline", cur === l.code ? "font-semibold" : "text-ink-2")}>
            {l.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
