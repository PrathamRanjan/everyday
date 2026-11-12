import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Brain, Plus, Send, Siren, Trash2, Undo2, Wrench } from "lucide-react";
import { Lifeline } from "@/components/Lifeline";
import { Amount, Busy, Empty, Loaded, PageHead, Panel, State } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useAction, useApi } from "@/lib/api";
import { day, words } from "@/lib/format";
import { useSession } from "@/lib/session";
import { t, tn } from "@/i18n";

interface Owned { id: string; title: string; status: string; source: string; category: string; attrs: any; price_cents: number | null; acquired: string; return_until: string | null; warranty_until: string | null; recipient: string | null; order_line_id: string | null }
interface Person {
  id: string;
  name: string;
  relation: string;
  is_self: boolean;
  version: number;
  why: { feature: string; label: string; delta: number; text: string }[];
  receipts: { id: number; chosen: string | null; other: string | null; reason: string; used: boolean; undone: boolean; why_not: string | null; changed: unknown[] }[];
}
interface YouData { today: string; owned: Owned[]; recalls: { item: string; item_id: string; title: string; remedy: string; url: string }[]; people: Person[]; limit_cents: number; telegram: boolean; facts: { key: string; value: string; source: string }[]; categories: Record<string, string> }

function AddOwned({ cats, reload }: { cats: Record<string, string>; reload: () => Promise<void> }) {
  const [f, setF] = useState({ title: "", category: "monitor", brand_model: "", inputs: "", vesa: "", price: "" });
  const { run, busy } = useAction(reload);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run("add", "/you/owned", f, { stay: true });
      }}
    >
      <div className="grid gap-1.5 sm:col-span-2">
        <Label htmlFor="o-title">{t("What is it?")}</Label>
        <Input id="o-title" required value={f.title} onChange={set("title")} placeholder={t("24-inch monitor")} className="min-h-11 bg-card" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="o-cat">{t("Kind")}</Label>
        <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
          <SelectTrigger id="o-cat" className="min-h-11 w-full bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(cats).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="o-bm">{t("Brand and model (optional)")}</Label>
        <Input id="o-bm" value={f.brand_model} onChange={set("brand_model")} placeholder={t("Dell P2422H")} className="min-h-11 bg-card" />
      </div>
      {f.category === "monitor" && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="o-in">{t("Inputs (for compatibility)")}</Label>
            <Input id="o-in" value={f.inputs} onChange={set("inputs")} placeholder={t("hdmi, dp")} className="min-h-11 bg-card" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="o-vesa">{t("VESA mount (mm)")}</Label>
            <Input id="o-vesa" type="number" inputMode="numeric" value={f.vesa} onChange={set("vesa")} placeholder="100" className="num min-h-11 bg-card" />
          </div>
        </>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="o-price">{t("Price paid in dollars (optional)")}</Label>
        <Input id="o-price" type="number" inputMode="decimal" step="0.01" value={f.price} onChange={set("price")} className="num min-h-11 bg-card" />
      </div>
      <Button type="submit" className="self-end justify-self-start" disabled={Boolean(busy)}>
        <Busy on={busy === "add"}>{null}</Busy>{t("Add it")}
      </Button>
    </form>
  );
}

function OwnedCard({ o, today, recall, reload }: { o: Owned; today: string; recall?: YouData["recalls"][number]; reload: () => Promise<void> }) {
  const { run, busy } = useAction(reload);
  const [quote, setQuote] = useState("");
  const bands = [
    ...(o.return_until ? [{ key: "r", label: t("Return window"), from: o.acquired, to: o.return_until }] : []),
    ...(o.warranty_until ? [{ key: "w", label: t("Warranty"), from: o.acquired, to: o.warranty_until }] : []),
  ];
  const active = o.status === "owned";
  return (
    <article className="rounded-lg border border-rule bg-card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl">{o.title}</p>
          <p className="text-xs text-ink-2">
            {words(o.category)} · {o.source}
            {o.recipient && o.recipient !== "You" && o.recipient !== "Maya" ? ` · ${o.recipient}'s` : ""}
            {o.price_cents ? (
              <>
                {" · "}
                <Amount cents={o.price_cents} />
              </>
            ) : null}
          </p>
        </div>
        <State s={o.status} />
      </div>
      {recall && (
        <div role="alert" className="mt-3 flex gap-2 rounded-md bg-stop-bg p-3 text-sm">
          <Siren className="size-4 shrink-0 text-stop" />
          <p>
            <b className="text-stop">{t("Recall.")}</b> {recall.title} <b>{recall.remedy}.</b>{" "}
            <a href={recall.url} className="underline underline-offset-4" rel="noopener nofollow noreferrer" target="_blank">
              {t("Notice")}
            </a>
          </p>
        </div>
      )}
      {active && bands.length > 0 && (
        <div className="mt-3">
          <Lifeline compact marks={[{ key: "a", label: t("Got it"), date: o.acquired, tone: "done" }]} bands={bands} today={today} title={`${o.title} lifeline`} />
        </div>
      )}
      {active && !bands.length && <p className="mt-2 text-xs text-ink-2">{t("No return or warranty dates known. Plans still use it so you don't buy a second one.")}</p>}
      {active && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-rule pt-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run("adv", `/you/owned/${o.id}/advice`, { quote }, { stay: true });
            }}
          >
            <div className="grid gap-1">
              <Label htmlFor={`q-${o.id}`} className="text-xs">
                {t("Repair quote ($)")}
              </Label>
              <Input id={`q-${o.id}`} type="number" inputMode="decimal" value={quote} onChange={(e) => setQuote(e.target.value)} className="num min-h-11 w-24 bg-card" />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={Boolean(busy)}>
              <Wrench className="size-4" />{" "}{t("Repair or replace?")}
            </Button>
          </form>
          <Select onValueChange={(v) => run("st", `/you/owned/${o.id}/status`, { status: v }, { stay: true })}>
            <SelectTrigger className="min-h-11 w-auto bg-card" aria-label={t("Mark {0} as", o.title)}>
              <SelectValue placeholder={t("Mark as…")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sold">{t("Sold")}</SelectItem>
              <SelectItem value="given">{t("Given away")}</SelectItem>
              <SelectItem value="recycled">{t("Recycled")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </article>
  );
}

function Taste({ p, reload }: { p: Person; reload: () => Promise<void> }) {
  const { run, busy } = useAction(reload);
  return (
    <div className="rounded-lg border border-rule bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-xl">
          {p.is_self ? t("You") : <span data-no-i18n>{p.name}</span>}
          {!p.is_self && <span className="font-sans text-sm text-ink-2" data-no-i18n> · {p.relation}</span>}
        </h3>
        <span className="num text-xs text-ink-2" data-detail>
          {tn("model v{0}", p.version)}
        </span>
      </div>
      {p.why.length ? (
        <ul className="mt-2 space-y-1 text-sm">
          {p.why.map((w) => (
            <li key={w.feature} className="flex items-center justify-between gap-2">
              <span>{w.text}</span>
              <button className="min-h-9 rounded-full px-2 text-xs text-ink-2 underline underline-offset-4 hover:text-ink" disabled={Boolean(busy)} onClick={() => run(`f${w.feature}`, "/you/forget", { recipient: p.id, feature: w.feature }, { stay: true })}>
                {t("Forget")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-2">{t("Nothing learned yet beyond the starting point every account gets.")}</p>
      )}
      {p.receipts.length > 0 && (
        <details className="mt-3 text-sm" data-detail>
          <summary className="min-h-9 cursor-pointer font-semibold">{tn("Choices that taught this ({0})", p.receipts.length)}</summary>
          <ul className="mt-1 space-y-1.5">
            {p.receipts.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  {r.chosen ? `${r.chosen} over ${r.other}` : t("Neither ({0})", words(r.reason))}
                  {!r.used && <span className="text-ink-2">{" "}{tn("· not used{0}", r.why_not ? `: ${r.why_not}` : "")}</span>}
                </span>
                {r.used && (
                  <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => run(`u${r.id}`, "/you/undo", { event: r.id }, { stay: true })}>
                    <Undo2 className="size-3.5" />{" "}{t("Undo")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <Dialog>
        <DialogTrigger asChild>
          <Button size="sm" variant="ghost" className="mt-2 text-stop">
            <Trash2 className="size-4" />{" "}{t("Delete this memory")}
          </Button>
        </DialogTrigger>
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle>{tn("Delete what Everyday learned about {0} taste?", p.is_self ? t("your") : `${p.name}'s`)}</DialogTitle>
            <DialogDescription>{t("Every choice and its effect is removed, and plans go back to the starting point. This can't be undone.")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="destructive" disabled={Boolean(busy)} onClick={() => run("del", "/you/delete-memory", { recipient: p.id }, { stay: true })}>
              <Busy on={busy === "del"}>{null}</Busy>{t("Delete memory")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function You() {
  const st = useApi<YouData>("/api/ui/you");
  const { session } = useSession();
  const [q] = useSearchParams();
  const code = q.get("code");
  const { run, busy } = useAction(st.reload);
  const [limit, setLimit] = useState<string | null>(null);
  return (
    <Loaded state={st}>
      {(d) => {
        const mine = d.owned.filter((o) => o.status === "owned");
        const past = d.owned.filter((o) => o.status !== "owned");
        const closing = mine.filter((o) => o.return_until && o.return_until >= d.today).sort((a, b) => String(a.return_until).localeCompare(String(b.return_until)));
        return (
          <div className="ev-rise">
            <PageHead
              eyebrow={t("Things I own")}
              title={t("What you have, and how long it's covered")}
              lede={t("{0} things. Plans use this list so you don't buy a second one.", mine.length)}
              needs={d.recalls.length ? t("{0} recall to act on", d.recalls.length) : closing[0] ? t("{0}: return by {1}", closing[0].title, day(closing[0].return_until)) : undefined}
            />
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <section id="owned" className="scroll-mt-24 space-y-3">
                {mine.length ? mine.map((o) => <OwnedCard key={o.id} o={o} today={d.today} recall={d.recalls.find((r) => r.item_id === o.id)} reload={st.reload} />) : <Empty title={t("Nothing here yet.")}>{t("Things you buy appear on their own. Add what you already have below.")}</Empty>}
                <Panel
                  title={
                    <span className="inline-flex items-center gap-2">
                      <Plus className="size-5" />
                      {t("Add something you already have")}
                    </span>
                  }
                >
                  <AddOwned cats={d.categories} reload={st.reload} />
                </Panel>
                {past.length > 0 && (
                  <Panel title={t("No longer yours")}>
                    <ul className="space-y-1 text-sm">
                      {past.map((o) => (
                        <li key={o.id} className="flex items-center justify-between gap-2">
                          {o.title} <State s={o.status} />
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}
              </section>
              <aside className="space-y-6">
                <Panel title={t("Monthly limit")} id="limit" sub={t("Your own number. Everyday won't plan past it.")}>
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run("lim", "/you/limit", { limit: limit ?? d.limit_cents / 100 }, { stay: true });
                    }}
                  >
                    <div className="grid flex-1 gap-1">
                      <Label htmlFor="limit">{t("Dollars a month")}</Label>
                      <Input id="limit" type="number" inputMode="decimal" min={0} value={limit ?? String(d.limit_cents / 100)} onChange={(e) => setLimit(e.target.value)} className="num min-h-11 bg-card" />
                    </div>
                    <Button type="submit" variant="outline" disabled={Boolean(busy)}>
                      {t("Save")}
                    </Button>
                  </form>
                </Panel>
                <section className="space-y-3">
                  <h2 className="flex items-center gap-2 text-xl font-medium">
                    <Brain className="size-5" />{" "}{t("What it learned")}
                  </h2>
                  {d.people.map((p) => (
                    <Taste key={p.id} p={p} reload={st.reload} />
                  ))}
                </section>
                <Panel title={t("Telegram")} sub={d.telegram ? t("Linked. Share a Reel to the bot and it lands here.") : t("Share Reels and approve from chat.")}>
                  {code ? (
                    <p className="text-sm">
                      {t("Send")}{" "}<b className="id">{tn("everyday-{0}", code)}</b>{" "}{t("to")}{" "}
                      <a className="underline" href={`https://t.me/${session?.telegram_bot}`}>
                        @{session?.telegram_bot}
                      </a>{" "}{t("within 15 minutes.")}
                    </p>
                  ) : (
                    <Button variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => run("tg", "/connect/telegram")}>
                      <Send className="size-4" /> {d.telegram ? t("Open Telegram") : t("Link Telegram")}
                    </Button>
                  )}
                  <p className="mt-2 text-xs text-ink-2">
                    {t("No phone handy? The")}{" "}
                    <Link className="underline" to="/telegram">
                      {t("Telegram simulator")}
                    </Link>{" "}{t("runs the same bot code.")}
                  </p>
                </Panel>
                {d.facts.length > 0 && (
                  <Panel title={t("Facts it keeps")}>
                    <ul className="space-y-1 text-sm">
                      {d.facts.map((f, k) => (
                        <li key={k}>
                          <b>{words(f.key)}</b>: {f.value} <span className="text-xs text-ink-2">({f.source})</span>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}
              </aside>
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}
