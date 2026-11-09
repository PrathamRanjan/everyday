import { useState } from "react";
import { useSearchParams } from "react-router";
import { ExternalLink, Repeat, Search, Siren, Wallet } from "lucide-react";
import { Amount, Busy, Empty, Loaded, PageHead, Panel, PayPalButton, Stat, State, TrustStrip } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction, useApi } from "@/lib/api";
import { day, money, words } from "@/lib/format";

interface PassportData {
  summary: {
    spent: number;
    back: number;
    live: { refunded_live: number; paid_live: number; protections_live: number; repeats_paid: number; repeats_held: number };
    recovered: { kind: string; n: number; cents: number }[];
    by_category: [string, number][];
    history: { id: string; at: string; category: string; merchant: string; price_cents: number; refund_cents: number; refund_kind: string | null; note: string | null }[];
  };
  vault: { status: string; last4: string } | null;
  recalls: { item: string; title: string; remedy: string; url: string }[];
  repeats: { id: string; qty: number; amount_cents: number; status: string; order_id: string | null; created_at: string; title: string }[];
  watches: { id: string; target_cents: number; status: string; title: string; price_cents: number }[];
  buyable: { id: string; title: string; price_cents: number }[];
  q: string;
  ext: { results: { title: string; brand: string | null; price_cents: number | null; url: string | null; merchant: string | null; image: string | null; source: string }[]; source: string; note: string } | null;
  channel3: boolean;
}

export default function Passport() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get("q") ?? "";
  const st = useApi<PassportData>(`/api/ui/passport${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const { run, busy } = useAction(st.reload);
  const [product, setProduct] = useState("");
  const [qty, setQty] = useState("1");
  const [term, setTerm] = useState(q);
  return (
    <Loaded state={st}>
      {(d) => {
        const max = Math.max(1, ...d.summary.by_category.map(([, c]) => c));
        const pick = d.buyable.find((b) => b.id === product);
        return (
          <div className="ev-rise">
            <PageHead eyebrow="Wallet and repeat buys" title="Your PayPal, saved once" lede="Save PayPal once for repeat buys. Each one still passes your rules; above your approval line it waits for you." />
            <div className="grid gap-6 lg:grid-cols-2">
              <Panel title={<span className="inline-flex items-center gap-2"><Wallet className="size-5" />Saved PayPal</span>} sub="PayPal Vault (sandbox). Everyday stores a token, never your login or card.">
                {d.vault?.status === "active" ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <State s="active" label="saved" />
                    <span className="id text-sm text-ink-2" data-detail>
                      token …{d.vault.last4}
                    </span>
                    <Button size="sm" variant="outline" className="ml-auto" disabled={Boolean(busy)} onClick={() => run("rev", "/passport/vault/revoke", undefined, { stay: true })}>
                      <Busy on={busy === "rev"}>{null}</Busy>Remove
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <PayPalButton busy={busy === "vault"} onClick={() => run("vault", "/passport/vault")}>
                      Save PayPal for repeat buys
                    </PayPalButton>
                    <p className="text-xs text-ink-2">You'll approve on PayPal's sandbox and come back here.</p>
                  </div>
                )}
              </Panel>

              <Panel title={<span className="inline-flex items-center gap-2"><Repeat className="size-5" />Buy again</span>} sub="Runs through the same gate as everything else: kill switch, limits, your approval line, scam rules.">
                <form
                  className="grid gap-3 sm:grid-cols-[1fr_5rem_auto] sm:items-end"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("rep", "/passport/repeat", { product, qty }, { stay: true });
                  }}
                >
                  <div className="grid gap-1.5">
                    <Label htmlFor="rb-p">Product</Label>
                    <Select value={product} onValueChange={setProduct}>
                      <SelectTrigger id="rb-p" className="min-h-11 w-full bg-card">
                        <SelectValue placeholder="Choose…" />
                      </SelectTrigger>
                      <SelectContent>
                        {d.buyable.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.title} · {money(b.price_cents)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="rb-q">Qty</Label>
                    <Input id="rb-q" type="number" min={1} max={20} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className="num min-h-11 bg-card" />
                  </div>
                  <Button type="submit" disabled={!product || Boolean(busy) || d.vault?.status !== "active"}>
                    <Busy on={busy === "rep"}>{null}</Busy>
                    {pick ? `Buy for ${money(pick.price_cents * Math.max(1, Number(qty) || 1))}` : "Buy again"}
                  </Button>
                </form>
                {d.vault?.status !== "active" && <p className="mt-2 text-xs text-ink-2">Save PayPal first.</p>}
                {d.repeats.length > 0 && (
                  <ul className="mt-4 divide-y divide-rule border-t border-rule text-sm">
                    {d.repeats.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                        <span className="min-w-0 flex-1">
                          {r.qty} × {r.title}
                        </span>
                        <Amount cents={r.amount_cents} />
                        <State s={r.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <TrustStrip className="lg:col-span-2" ai="Not involved in repeat buys." code="Checks your rules and approval line, then holds or refuses before PayPal." paypal="Charges the saved PayPal and returns a capture Everyday reads back." />

              <Panel title="This year, in numbers" sub="Seeded demo history for Maya plus this demo's real sandbox orders." className="lg:col-span-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Spent (seeded)" value={money(d.summary.spent)} />
                  <Stat label="Got back (seeded)" value={money(d.summary.back)} tone="done" />
                  <Stat label="Paid on PayPal here" value={money(d.summary.live.paid_live)} hint="real sandbox captures" />
                  <Stat label="Refunded on PayPal here" value={money(d.summary.live.refunded_live)} tone="done" hint="read back from PayPal" />
                </div>
                <div className="mt-5 grid gap-6 md:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-semibold">By kind</h3>
                    <ul className="mt-2 space-y-1.5">
                      {d.summary.by_category.map(([c, cents]) => (
                        <li key={c} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 text-sm">
                          <span className="truncate">{words(c)}</span>
                          <span className="h-2 rounded-full bg-sunk">
                            <span className="block h-2 rounded-full bg-ink" style={{ width: `${(cents / max) * 100}%` }} />
                          </span>
                          <Amount cents={cents} className="text-xs" />
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Money back, by how</h3>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {d.summary.recovered.map((r) => (
                        <li key={r.kind} className="flex justify-between gap-2">
                          <span>
                            {words(r.kind)} <span className="text-ink-2">× {r.n}</span>
                          </span>
                          <Amount cents={r.cents} className="text-done" />
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <details className="mt-4 text-sm" data-detail>
                  <summary className="min-h-9 cursor-pointer font-semibold">Every purchase ({d.summary.history.length})</summary>
                  <ul className="mt-2 divide-y divide-rule">
                    {d.summary.history.map((h) => (
                      <li key={h.id} className="grid grid-cols-[4.5rem_1fr_auto] gap-2 py-1.5">
                        <span className="num text-xs text-ink-2">{day(h.at.slice(0, 10))}</span>
                        <span className="min-w-0">
                          {words(h.category)} · {h.merchant}
                          {h.note && <span className="block text-xs text-ink-2">{h.note}</span>}
                        </span>
                        <span className="text-right">
                          <Amount cents={h.price_cents} />
                          {h.refund_cents ? (
                            <span className="num block text-xs text-done">
                              −<Amount cents={h.refund_cents} />
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </Panel>

              {d.recalls.length > 0 && (
                <Panel title={<span className="inline-flex items-center gap-2 text-stop"><Siren className="size-5" />Recalls</span>}>
                  <ul className="space-y-2 text-sm">
                    {d.recalls.map((r, k) => (
                      <li key={k}>
                        <b>{r.item}</b>: {r.remedy}.{" "}
                        <a className="underline" href={r.url} target="_blank" rel="noopener nofollow noreferrer">
                          Notice
                        </a>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}

              <Panel title="Look it up elsewhere" sub={d.channel3 ? "Live product search (Channel3). Results are links to buy with that shop, not here." : "No Channel3 key on this server: seeded catalog results."}>
                <form
                  role="search"
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSp(term ? { q: term } : {});
                  }}
                >
                  <Label htmlFor="ext-q" className="sr-only">
                    Search other shops
                  </Label>
                  <Input id="ext-q" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="logitech mx master" className="min-h-11 bg-card" />
                  <Button type="submit" variant="outline" aria-label="Search">
                    <Search className="size-4" />
                  </Button>
                </form>
                {d.ext && (
                  <>
                    <p className="mt-2 text-xs text-ink-2">{d.ext.note}</p>
                    {d.ext.results.length ? (
                      <ul className="mt-2 divide-y divide-rule text-sm">
                        {d.ext.results.slice(0, 8).map((r, k) => (
                          <li key={k} className="flex items-center gap-3 py-2">
                            {r.image && <img src={r.image} alt="" loading="lazy" className="size-12 shrink-0 rounded-md bg-sunk object-contain" />}
                            <span className="min-w-0 flex-1">
                              {r.url ? (
                                <a href={r.url} target="_blank" rel="noopener nofollow noreferrer" className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
                                  {r.title} <ExternalLink className="size-3 shrink-0" />
                                </a>
                              ) : (
                                <span className="font-medium">{r.title}</span>
                              )}
                              <span className="block text-xs text-ink-2">{[r.brand, r.merchant].filter(Boolean).join(" · ")}</span>
                            </span>
                            <Amount cents={r.price_cents} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Empty title="No results." />
                    )}
                  </>
                )}
              </Panel>
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}
