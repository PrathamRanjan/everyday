import { useEffect } from "react";
import { QR } from "@/components/Install";
import { Link } from "react-router";
import { ArrowRight, CircleCheck, Clock, Link2, PlayCircle, RotateCcw, Store, User } from "lucide-react";
import { Busy, Loaded, PageHead, Panel } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useAction, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { day } from "@/lib/format";
import { startTour } from "@/tours/tours";
import { cn } from "@/lib/utils";
import { t, tn } from "@/i18n";

interface JudgeStep { key: string; label: string; how: string; href: string; done: boolean; at: string | null }
interface JudgeData {
  ws: string | null;
  signed_in: boolean;
  paths: { id: string; title: string; minutes: number; no_login: boolean; why: string; steps: JudgeStep[] }[];
  live: { what: string; state: "live" | "not connected" | "sample"; how: string }[];
  pages: { href: string; label: string; what: string }[];
  phone: { url: string; svg: string } | null;
  sandbox_buyer: { email: string; password: string | null } | null;
}

/**
 * A3.1: the judge page. Three short paths; each step opens the exact screen (with text typed where there is any) and
 * ticks itself when the server records the event in this visitor's own demo. No tour runs by itself.
 */
export function Judge() {
  const st = useApi<JudgeData>("/api/ui/judge");
  const { run, busy } = useAction(st.reload);
  // Steps tick themselves: refresh while the page is open.
  const reload = st.reload;
  useEffect(() => {
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
  }, [reload]);
  return (
    <Loaded state={st}>
      {(d) => (
        <div className="ev-rise">
          <PageHead eyebrow={t("For judges")} title={t("Try it in three minutes")} lede={t("Pick a path. Each step opens the right screen, and ticks itself here when it really happened in your own private demo. No PayPal login is needed for any of them; the sandbox moves test money only.")} />
          {!d.ws && (
            <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-rule bg-card p-4">
              <p className="text-sm">{t("Start your own private demo first: a shopper, a shop, two real sandbox purchases and a price drop waiting to be claimed.")}</p>
              <Button disabled={Boolean(busy)} onClick={() => void run("start", "/demo/start", {}, { stay: true })}>
                <Busy on={busy === "start"}>
                  <PlayCircle />
                </Busy>
                {t("Start my demo")}
              </Button>
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            {d.paths.map((p) => {
              const n = p.steps.filter((x) => x.done).length;
              return (
                <section key={p.id} aria-labelledby={`path-${p.id}`} className="rounded-lg border border-rule bg-card p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 id={`path-${p.id}`} className="text-xl font-medium">
                      {p.title}
                    </h2>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-2">
                      <Clock className="size-3.5" />
                      {tn("{0} min", p.minutes)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink-2">{p.why}</p>
                  <p className="mt-2 text-xs font-semibold" aria-live="polite">
                    {tn("{0} of {1} done{2}", n, p.steps.length, p.no_login ? t(" · no PayPal login") : "")}
                  </p>
                  <ol className="mt-3 space-y-2">
                    {p.steps.map((s, i) => (
                      <li key={s.key} className={cn("rounded-md border p-3 text-sm", s.done ? "border-done/50 bg-done-bg" : "border-rule")}>
                        <div className="flex items-start gap-2">
                          {s.done ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-done" aria-label="done" /> : <span className="num w-4 shrink-0 text-ink-2">{i + 1}</span>}
                          <div className="min-w-0">
                            <div className="font-medium">{s.label}</div>
                            <div className="text-ink-2">{s.how}</div>
                            {s.done && s.at && <div className="num text-xs text-ink-2">{tn("Recorded {0}", new Date(s.at).toLocaleTimeString())}</div>}
                          </div>
                        </div>
                        {!s.done && d.ws && (
                          <Link to={s.href} className="mt-2 inline-flex min-h-11 items-center gap-1 pl-6 font-semibold underline underline-offset-4">
                            {t("Open")}{" "}<ArrowRight className="size-3.5" />
                          </Link>
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <Panel title={t("What is live, what is simulated")} sub={t("Built from this site's own settings when you opened the page, not typed by hand.")}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs text-ink-2">
                      <th className="py-1 pr-3">{t("Part")}</th>
                      <th className="pr-3">{t("State")}</th>
                      <th>{t("How")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.live.map((r) => (
                      <tr key={r.what} className="border-t border-rule align-top">
                        <td className="py-1.5 pr-3 font-medium">{r.what}</td>
                        <td className="pr-3">
                          <span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", r.state === "live" ? "bg-done-bg text-done" : r.state === "sample" ? "bg-wait-bg text-wait" : "bg-paper-2 text-ink-2")}>{r.state}</span>
                        </td>
                        <td className="text-ink-2">{r.how}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <div className="space-y-6">
              <Panel title={t("On your phone")} sub={d.phone ? t("Scan to open this same demo on a phone, signed in. The link works for 48 hours.") : t("Start your demo first to get a phone link.")}>
                {d.phone && (
                  <div className="grid justify-items-start gap-2">
                    <div className="w-40 rounded bg-white p-2" role="img" aria-label={t("QR code that opens this demo on a phone")} dangerouslySetInnerHTML={{ __html: d.phone.svg }} />
                    <button type="button" className="text-sm underline" onClick={() => void navigator.clipboard?.writeText(d.phone!.url)}>
                      <Link2 className="mr-1 inline size-3.5" />
                      {t("Copy the link")}
                    </button>
                  </div>
                )}
              </Panel>
              <Panel title={t("PayPal sandbox accounts")}>
                {d.sandbox_buyer ? (
                  <dl className="grid gap-1 text-sm">
                    <dt className="text-ink-2">{t("Sandbox buyer (for paying on PayPal's own page)")}</dt>
                    <dd className="font-mono">{d.sandbox_buyer.email}</dd>
                    {d.sandbox_buyer.password && <dd className="font-mono">{d.sandbox_buyer.password}</dd>}
                  </dl>
                ) : (
                  <p className="text-sm text-ink-2">{t("None needed: every path pays with the demo's saved sandbox wallet. A sandbox buyer login for paying on PayPal's own page hasn't been published here.")}</p>
                )}
              </Panel>
              <Panel title={t("Pages that need no sign-in")}>
                <ul className="space-y-2 text-sm">
                  {d.pages.map((p) => (
                    <li key={p.href}>
                      <Link className="font-semibold underline underline-offset-4" to={p.href}>
                        {p.label}
                      </Link>{" "}
                      <span className="text-ink-2">{p.what}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>
          <p className="mt-6 text-xs text-ink-2">
            {t("Want a walk-through of one page instead?")}{" "}<button type="button" className="underline" onClick={() => void startTour("judge")}>{t("Explain the page I'm on")}</button>{" "}{t("(it explains this page only and ends when you leave it).")}
          </p>
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
          <PageHead eyebrow={t("Demo controls")} title={t("Run the demo")} lede={d.demo ? t("Your own demo: move its clock, start it again, or switch between Maya and her shop.") : t("Demo mode is off on this server.")} />
          {d.demo && d.private_demos && !d.workspace && (
            <Panel title={t("You don't have a demo yet")} sub={t("Each visitor gets a private copy. Nobody else sees what you do in yours.")}>
              <Button disabled={Boolean(busy)} onClick={() => run("start", "/demo/start", {})}>
                <Busy on={busy === "start"}>{null}</Busy>{t("Try the live demo")}
              </Button>
            </Panel>
          )}
          {d.demo && (!d.private_demos || d.workspace) && (
            <div className="grid gap-6 md:grid-cols-2">
              <Panel title={<span className="inline-flex items-center gap-2"><Clock className="size-5" />{t("Demo clock")}</span>} sub={t("Deliveries, return windows and price promises run on this clock.")}>
                <p className="num font-display text-3xl">{d.clock ?? "—"}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" disabled={Boolean(busy)} onClick={() => run("day", "/demo/clock", { step: "day" }, { stay: true })}>
                    <Busy on={busy === "day"}>{null}</Busy>{t("+1 working day")}
                  </Button>
                  <Button variant="outline" disabled={Boolean(busy)} onClick={() => run("week", "/demo/clock", { step: "week" }, { stay: true })}>
                    <Busy on={busy === "week"}>{null}</Busy>{t("+1 week")}
                  </Button>
                </div>
              </Panel>
              <Panel title={<span className="inline-flex items-center gap-2"><RotateCcw className="size-5" />{t("Start my demo again")}</span>} sub={t("Rebuilds only your own demo: Maya, her shop, the catalog and the seed's sandbox payments. Nobody else's demo changes. Sandbox orders already in PayPal stay in PayPal.")}>
                <Button
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    if (confirm(t("Rebuild your own demo from the start? Only yours changes."))) void run("reset", "/demo/reset");
                  }}
                >
                  <Busy on={busy === "reset"}>{null}</Busy>{t("Reset my demo")}
                </Button>
              </Panel>
              {ws && (
                <Panel title={<span className="inline-flex items-center gap-2"><Link2 className="size-5" />{t("This demo")}</span>} sub={t("Private to you. Deleted if unused until {0}.", day(String(ws.expires_at).slice(0, 10)))} className="md:col-span-2">
                  {ws.progress_line && <p className="text-sm" role="status">{ws.progress_line}</p>}
                  {ws.join_url && (
                    <div className="mt-2 flex flex-wrap items-start gap-3">
                      <QR text={ws.join_url} label={t("QR code: opens this demo on your phone, signed in")} size={128} />
                      <p className="min-w-0 flex-1 text-sm text-ink-2">
                        {t("Open the same demo on your phone:")}{" "}<span className="num break-all text-ink">{ws.join_url}</span>
                      </p>
                    </div>
                  )}
                </Panel>
              )}
              <Panel title={t("Jump in")} className="md:col-span-2">
                <div className="flex flex-wrap gap-2">
                  {p.data?.accounts.map((a) => (
                    <Button key={a.id} variant="outline" disabled={Boolean(busy)} onClick={() => run(a.id, "/login", { as: `acc:${a.id}` })}>
                      <User className="size-4" />{" "}{tn("{0} (shopper)", a.name)}
                    </Button>
                  ))}
                  {p.data?.merchants.map((m) => (
                    <Button key={m.id} variant="outline" disabled={Boolean(busy)} onClick={() => run(m.id, "/login", { as: `mer:${m.id}` })}>
                      <Store className="size-4" />{" "}{tn("{0} (merchant)", m.name.replace(/\s*\(.*\)$/, ""))}
                    </Button>
                  ))}
                  <Button variant="ghost" asChild>
                    <Link to="/#demo">
                      <PlayCircle className="size-4" />{" "}{t("Guided demo")}
                    </Link>
                  </Button>
                </div>
                <p className="mt-3 text-xs text-ink-2">{t("MCP clients use access keys printed by the seed script; keys are never shown on a page.")}</p>
              </Panel>
            </div>
          )}
        </div>
      )}
    </Loaded>
  );
}
