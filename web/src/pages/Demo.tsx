import { Link } from "react-router";
import { ArrowRight, Clock, Link2, PlayCircle, RotateCcw, Store, User } from "lucide-react";
import { Busy, Loaded, PageHead, Panel } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useAction, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { day } from "@/lib/format";
import { startTour } from "@/tours/tours";

interface JudgeData { beats: { title: string; body: string; href: string }[]; session: string }

/** Judge mode: the six beats of the story, and one button that runs the guided three-minute tour. */
export function Judge() {
  const st = useApi<JudgeData>("/api/ui/judge");
  return (
    <Loaded state={st}>
      {(d) => (
        <div className="ev-rise">
          <div data-tour="judge-head">
            <PageHead eyebrow="Judge mode" title="Three minutes, the whole loop" lede="A guided walk from a request to a paid, tracked order, with the real PayPal sandbox step in the middle. Every number you see comes from this instance's database." />
          </div>
          <div className="mb-8 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => void startTour("judge")}>
              <PlayCircle className="size-5" /> Start the guided tour
            </Button>
            <span className="text-sm text-ink-2">Signs you in as Maya, a demo shopper. You'll need the sandbox buyer login for the PayPal step.</span>
          </div>
          <ol className="grid gap-3 md:grid-cols-2">
            {d.beats.map((b, i) => (
              <li key={b.title} className="rounded-lg border border-rule bg-card p-4">
                <div className="flex items-baseline gap-3">
                  <span className="num font-display text-3xl text-now">{i + 1}</span>
                  <h2 className="text-xl font-medium">{b.title}</h2>
                </div>
                <p className="mt-2 text-sm text-ink-2">{b.body}</p>
                <Link to={b.href} className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold underline underline-offset-4">
                  Open <ArrowRight className="size-3.5" />
                </Link>
              </li>
            ))}
          </ol>
          <p className="num mt-6 text-xs text-ink-2">Session {st.data?.session}. Sandbox only; Maya and Northlight Supply are seeded.</p>
        </div>
      )}
    </Loaded>
  );
}

export default function Demo() {
  const st = useApi<{ demo: boolean; clock: string | null; loaded: boolean; private_demos?: boolean; workspace?: string | null }>("/api/ui/demo");
  const p = useApi<{ demo: boolean; accounts: { id: string; name: string }[]; merchants: { id: string; name: string }[] }>("/api/ui/personas");
  const { run, busy } = useAction(st.reload);
  const { session } = useSession();
  const ws = session?.workspace ?? null;
  return (
    <Loaded state={st}>
      {(d) => (
        <div className="ev-rise">
          <PageHead eyebrow="Demo controls" title="Run the demo" lede={d.demo ? "Your own demo: move its clock, start it again, or switch between Maya and her shop." : "Demo mode is off on this server."} />
          {d.demo && d.private_demos && !d.workspace && (
            <Panel title="You don't have a demo yet" sub="Each visitor gets a private copy. Nobody else sees what you do in yours.">
              <Button disabled={Boolean(busy)} onClick={() => run("start", "/demo/start", {})}>
                <Busy on={busy === "start"}>{null}</Busy>Try the live demo
              </Button>
            </Panel>
          )}
          {d.demo && (!d.private_demos || d.workspace) && (
            <div className="grid gap-6 md:grid-cols-2">
              <Panel title={<span className="inline-flex items-center gap-2"><Clock className="size-5" />Demo clock</span>} sub="Deliveries, return windows and price promises run on this clock.">
                <p className="num font-display text-3xl">{d.clock ?? "—"}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" disabled={Boolean(busy)} onClick={() => run("day", "/demo/clock", { step: "day" }, { stay: true })}>
                    <Busy on={busy === "day"}>{null}</Busy>+1 working day
                  </Button>
                  <Button variant="outline" disabled={Boolean(busy)} onClick={() => run("week", "/demo/clock", { step: "week" }, { stay: true })}>
                    <Busy on={busy === "week"}>{null}</Busy>+1 week
                  </Button>
                </div>
              </Panel>
              <Panel title={<span className="inline-flex items-center gap-2"><RotateCcw className="size-5" />Start my demo again</span>} sub="Rebuilds only your own demo: Maya, her shop, the catalog and the seed's sandbox payments. Nobody else's demo changes. Sandbox orders already in PayPal stay in PayPal.">
                <Button
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    if (confirm("Rebuild your own demo from the start? Only yours changes.")) void run("reset", "/demo/reset");
                  }}
                >
                  <Busy on={busy === "reset"}>{null}</Busy>Reset my demo
                </Button>
              </Panel>
              {ws && (
                <Panel title={<span className="inline-flex items-center gap-2"><Link2 className="size-5" />This demo</span>} sub={`Private to you. Deleted if unused until ${day(String(ws.expires_at).slice(0, 10))}.`} className="md:col-span-2">
                  {ws.progress_line && <p className="text-sm" role="status">{ws.progress_line}</p>}
                  {ws.join_url && (
                    <p className="mt-2 text-sm text-ink-2">
                      Open the same demo on your phone: <span className="num break-all text-ink">{ws.join_url}</span>
                    </p>
                  )}
                </Panel>
              )}
              <Panel title="Jump in" className="md:col-span-2">
                <div className="flex flex-wrap gap-2">
                  {p.data?.accounts.map((a) => (
                    <Button key={a.id} variant="outline" disabled={Boolean(busy)} onClick={() => run(a.id, "/login", { as: `acc:${a.id}` })}>
                      <User className="size-4" /> {a.name} (shopper)
                    </Button>
                  ))}
                  {p.data?.merchants.map((m) => (
                    <Button key={m.id} variant="outline" disabled={Boolean(busy)} onClick={() => run(m.id, "/login", { as: `mer:${m.id}` })}>
                      <Store className="size-4" /> {m.name.replace(/\s*\(.*\)$/, "")} (merchant)
                    </Button>
                  ))}
                  <Button variant="ghost" onClick={() => void startTour("judge")}>
                    <PlayCircle className="size-4" /> Judge tour
                  </Button>
                </div>
                <p className="mt-3 text-xs text-ink-2">MCP clients use access keys printed by the seed script; keys are never shown on a page.</p>
              </Panel>
            </div>
          )}
        </div>
      )}
    </Loaded>
  );
}
