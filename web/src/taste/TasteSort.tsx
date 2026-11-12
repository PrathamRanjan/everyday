import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { getJson } from "@/lib/api";
import { t } from "@/i18n";
import { itemText, loadModelCard, loadTaste, scoreListings, type TasteModel } from "./taste";

const KEY = "ev-taste";
const saved = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};
const save = (on: boolean) => {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* private window */
  }
};

export type TasteResult = { scores: number[]; nothingFits: boolean } | null;
type State = { kind: "off" } | { kind: "loading"; p: number } | { kind: "on"; learnedFrom: number } | { kind: "empty" } | { kind: "error"; why: string };

/**
 * Opt-in: sorts web listings by how close they are to what this shopper already owns, with the taste model from
 * taste-lab/. Runs in this browser only. It reorders within each verdict; it never changes a verdict.
 */
export function TasteSort({ listings, onResult }: { listings: { title: string; brand: string | null }[]; onResult: (r: TasteResult) => void }) {
  const [st, setSt] = useState<State>({ kind: "off" });
  const [card, setCard] = useState<TasteModel | null>(null);
  const sig = listings.map((l) => l.title).join("|");
  useEffect(() => {
    void loadModelCard().then(setCard).catch(() => setCard(null));
  }, []);
  const run = async () => {
    setSt({ kind: "loading", p: 0 });
    try {
      const h = await getJson<{ items: { title: string; brand: string | null; kept: boolean }[] }>("/api/ui/taste/history");
      if (!h.items.length) {
        setSt({ kind: "empty" });
        onResult(null);
        return;
      }
      await loadTaste((p) => setSt({ kind: "loading", p }));
      const r = await scoreListings(
        h.items.map((x) => ({ text: itemText(x.title, x.brand), stars: x.kept ? 5 : 2 })),
        listings.map((l) => itemText(l.title, l.brand)),
      );
      onResult(r);
      setSt({ kind: "on", learnedFrom: h.items.length });
    } catch (e) {
      onResult(null);
      setSt({ kind: "error", why: (e as Error).message });
    }
  };
  useEffect(() => {
    if (saved() && listings.length) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const on = st.kind === "on" || st.kind === "loading";
  const toggle = () => {
    if (on) {
      save(false);
      setSt({ kind: "off" });
      onResult(null);
    } else {
      save(true);
      void run();
    }
  };
  const best = card?.test?.[card.ships]?.all;
  const rand = card?.test?.random?.all;
  return (
    <div className="mb-3 rounded-md border border-rule p-3 text-sm" data-testid="taste-sort">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={toggle} aria-pressed={on} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-rule px-3 font-semibold" data-testid="taste-toggle">
          <Sparkles className="size-4" aria-hidden />
          {on ? t("Stop sorting by my taste") : t("Sort by my taste")}
        </button>
        {st.kind === "loading" && <span role="status">{st.p > 0 && st.p < 1 ? t("Downloading the language model… {0}%", Math.round(st.p * 100)) : t("Reading the listings on this device…")}</span>}
        {st.kind === "on" && <span role="status" className="text-ink-2">{t("Sorted within each verdict by closeness to the {0} things you own.", st.learnedFrom)}</span>}
        {st.kind === "empty" && <span role="status" className="text-ink-2">{t("There's nothing you own yet to learn your taste from.")}</span>}
        {st.kind === "error" && <span role="alert" className="text-stop">{t("The taste model didn't run: {0}", st.why)}</span>}
      </div>
      <p className="mt-2 text-xs text-ink-2">
        {t("Runs in this browser only; the first time it downloads a 118 MB multilingual model from Hugging Face. It never changes whether a listing fits: code decides that.")}{" "}
        {best && rand && t("On held-out Amazon purchases it put the real next buy in the top 10 of 100 {0}% of the time (random order: {1}%).", Math.round(best.hr_at_10 * 100), Math.round(rand.hr_at_10 * 100))}{" "}
        <a href="/api/ui/taste" className="underline underline-offset-4">{t("Model card")}</a>
      </p>
    </div>
  );
}
