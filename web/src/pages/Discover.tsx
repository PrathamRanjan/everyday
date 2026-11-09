import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ExternalLink, Film, ImageUp, Link2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Amount, Busy, Empty, Loaded, PageHead, Panel, State, TrustStrip } from "@/components/kit";
import { PlanForm, SpeakableText, type Recipient } from "@/components/forms";
import { useAction, useApi } from "@/lib/api";
import { when } from "@/lib/format";

interface DiscoverData {
  captures: { id: string; url: string | null; title: string | null; status: string; channel: string; platform: string; created_at: string; objects: number }[];
  q: string;
  results: { id: string; title: string; model: string; merchant: string; price_cents: number; checkout: boolean; category: string }[];
  watches: { id: string; target_cents: number; status: string; title: string; price_cents: number }[];
  clips: { url: string; title: string }[];
  ai: boolean;
}

function CaptureForm({ clips }: { clips: DiscoverData["clips"] }) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { run, busy } = useAction();
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    if (url) fd.append("url", url);
    if (text) fd.append("text", text);
    if (file) fd.append("shot", file);
    void run("cap", "/discover/capture", fd);
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="url" className="flex items-center gap-2">
          <Link2 className="size-4" /> A Reel, TikTok, Short or product link
        </Label>
        <Input id="url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/shorts/…" className="min-h-11 bg-card text-base" />
        <div className="flex flex-wrap gap-1.5 pt-1" aria-label="Demo clips">
          {clips.map((c) => (
            <button key={c.url} type="button" onClick={() => setUrl(c.url)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-rule-2 bg-paper px-3 text-xs hover:bg-sunk">
              <Film className="size-3.5" /> {c.title}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-1.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <ImageUp className="size-4" /> Or a screenshot
        </span>
        <input ref={fileRef} id="shot" type="file" accept="image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            Choose image
          </Button>
          <span className="min-w-0 truncate text-sm text-ink-2">{file ? file.name : "No image chosen"}</span>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cap-text">Or describe it</Label>
        <SpeakableText id="cap-text" value={text} onChange={setText} placeholder="a warm oak desk lamp" rows={1} />
      </div>
      <Button type="submit" className="justify-self-start" disabled={Boolean(busy) || (!url && !text && !file)}>
        <Busy on={busy === "cap"}>{null}</Busy>
        {busy === "cap" ? "Reading…" : "Save and read it"}
      </Button>
    </form>
  );
}

export default function Discover() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get("q") ?? "";
  const st = useApi<DiscoverData>(`/api/ui/discover${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const rc = useApi<{ recipients: Recipient[] }>("/api/ui/plans");
  const [term, setTerm] = useState(q);
  const { run, busy } = useAction(st.reload);
  const [targets, setTargets] = useState<Record<string, string>>({});
  return (
    <div className="ev-rise">
      <PageHead eyebrow="Find" title="Show it, or say it." lede="Start from something you saw, or from what you need. Either way you get a checked plan before anything is paid." />
      <Loaded state={st}>
        {(d) => (
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Ask" sub="The quickest way." className="lg:order-2">
              {rc.data ? <PlanForm recipients={rc.data.recipients} /> : <div className="h-40 animate-pulse rounded-md bg-sunk" />}
            </Panel>
            <Panel title="Show it" sub={d.ai ? "Screenshots and video covers are read by a vision model." : "No vision model on this server: links are saved and demo clips use their authored items."} className="lg:order-1">
              <div data-tour="capture-form">
                <CaptureForm clips={d.clips} />
              </div>
            </Panel>

            <TrustStrip className="lg:order-3 lg:col-span-2" ai="Names what's in the picture or cover, with how sure it is." code="Checks the item exists in a shop, fits, and is in budget." paypal="Nothing is paid here. Checkout comes after the plan." />

            <Panel title="Search the shops" className="lg:order-4">
              <form
                role="search"
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSp(term ? { q: term } : {});
                }}
              >
                <Label htmlFor="q" className="sr-only">
                  Search
                </Label>
                <Input id="q" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="model number, kind or description" className="min-h-11 bg-card" />
                <Button type="submit" variant="outline" aria-label="Search">
                  <Search className="size-4" />
                </Button>
              </form>
              {d.q && !d.results.length && <p className="mt-3 text-sm text-ink-2">Nothing matched “{d.q}”.</p>}
              {d.results.length > 0 && (
                <ul className="mt-3 divide-y divide-rule">
                  {d.results.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{p.title}</p>
                        <p className="text-xs text-ink-2">
                          {p.model} · {p.merchant}
                        </p>
                      </div>
                      <Amount cents={p.price_cents} strong />
                      {p.checkout ? (
                        <form
                          className="flex items-center gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void run(`w${p.id}`, "/discover/watch", { product: p.id, target: targets[p.id] }, { stay: true });
                          }}
                        >
                          <Label htmlFor={`t-${p.id}`} className="sr-only">
                            Target price in dollars
                          </Label>
                          <Input id={`t-${p.id}`} type="number" min={1} step={1} inputMode="numeric" placeholder="$ target" value={targets[p.id] ?? ""} onChange={(e) => setTargets({ ...targets, [p.id]: e.target.value })} className="num min-h-11 w-24 bg-card" required />
                          <Button type="submit" size="sm" variant="outline" disabled={Boolean(busy)}>
                            Watch
                          </Button>
                        </form>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                          <ExternalLink className="size-3.5" /> buy elsewhere
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {d.watches.length > 0 && (
                <div className="mt-4 border-t border-rule pt-3">
                  <h3 className="text-sm font-semibold">Price watches</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {d.watches.map((w) => (
                      <li key={w.id} className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1">{w.title}</span>
                        <span className="num text-ink-2">
                          now <Amount cents={w.price_cents} /> · target <Amount cents={w.target_cents} />
                        </span>
                        <State s={w.status === "fired" ? "fired" : "active"} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Panel>

            <Panel title="Saved" className="lg:order-5">
              <Tabs defaultValue="all">
                <TabsList className="bg-sunk">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="read">Read</TabsTrigger>
                </TabsList>
                {(["all", "read"] as const).map((t) => {
                  const rows = d.captures.filter((c) => t === "all" || c.objects > 0);
                  return (
                    <TabsContent key={t} value={t}>
                      {rows.length ? (
                        <ul className="divide-y divide-rule">
                          {rows.map((c) => (
                            <li key={c.id}>
                              <Link to={`/captures/${c.id}`} className="flex min-h-14 items-center gap-3 py-2 hover:bg-sunk/50">
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate font-medium">{c.title || c.url || "Description"}</span>
                                  <span className="block text-xs text-ink-2">
                                    {c.platform} · via {c.channel} · {when(c.created_at)}
                                  </span>
                                </span>
                                <State s={c.status} />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <Empty title="Nothing saved yet.">Paste a link above, or send one to the Telegram bot.</Empty>
                      )}
                    </TabsContent>
                  );
                })}
              </Tabs>
            </Panel>
          </div>
        )}
      </Loaded>
    </div>
  );
}
