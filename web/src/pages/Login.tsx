import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { KeyRound, PlayCircle, Store, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Busy, Loaded, PageHead } from "@/components/kit";
import { postAction, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { toast } from "sonner";
import { t, tn } from "@/i18n";

type Personas = { demo: boolean; accounts: { id: string; name: string }[]; merchants: { id: string; name: string }[]; private_demos?: boolean; workspace?: string | null };

const d0 = (st: { data: Personas | null }) => Boolean(st.data?.demo);

export default function Login() {
  const [q] = useSearchParams();
  const next = q.get("next") ?? "";
  const st = useApi<Personas>("/api/ui/personas");
  const { refresh } = useSession();
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const go = async (k: string, data: Record<string, string>, path = "/login") => {
    setBusy(k);
    try {
      const r = await postAction(path, path === "/login" ? { ...data, next } : data);
      if (r.err) toast.error(r.err);
      await refresh();
      nav(r.to);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHead eyebrow={t("Sign in")} title={t("Who are you today?")} lede={t("This is a demo on the PayPal sandbox. Nothing here uses real money. Be Maya, the shopper, or her shop; you can switch sides at any time with the switch at the top.")} />
      {d0(st) && (
        <p className="-mt-2 mb-6 text-sm">
          <Link className="font-semibold underline" to="/?home=1#start">{t("New here? Take a guided walk-through instead →")}</Link>
        </p>
      )}
      <Loaded state={st}>
        {(d) => (
          <div className="grid gap-4 sm:grid-cols-2">
            {d.demo && d.private_demos && !d.workspace && (
              <div className="flex flex-col gap-3 rounded-lg border border-rule bg-card p-5 sm:col-span-2">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-full bg-now-bg text-now">
                    <PlayCircle className="size-5" />
                  </span>
                  <div>
                    <p className="font-display text-xl">{t("Your own demo")}</p>
                    <p className="text-sm text-ink-2">{t("A private copy with Maya, her shop and real sandbox payments. Nobody else sees it; it's deleted 48 hours after your last visit.")}</p>
                  </div>
                </div>
                <Button className="self-start" onClick={() => go("start", {}, "/demo/start")} disabled={Boolean(busy)}>
                  <Busy on={busy === "start"}>{null}</Busy>{t("Try the live demo")}
                </Button>
              </div>
            )}
            {d.accounts.map((a) => (
              <div key={a.id} className="flex flex-col gap-3 rounded-lg border border-rule bg-card p-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-full bg-now-bg text-now">
                    <User className="size-5" />
                  </span>
                  <div>
                    <p className="font-display text-xl">{a.name}</p>
                    <p className="text-sm text-ink-2">{t("Shopper · buying a study setup by Friday")}</p>
                  </div>
                </div>
                <Button onClick={() => go(a.id, { as: `acc:${a.id}` })} disabled={Boolean(busy)}>
                  <Busy on={busy === a.id}>{null}</Busy>{tn("Continue as {0}", a.name)}
                </Button>
              </div>
            ))}
            {d.merchants.map((m) => (
              <div key={m.id} className="flex flex-col gap-3 rounded-lg border border-rule bg-card p-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-full bg-sunk">
                    <Store className="size-5" />
                  </span>
                  <div>
                    <p className="font-display text-xl">{m.name.replace(/\s*\(.*\)$/, "")}</p>
                    <p className="text-sm text-ink-2">{t("Merchant · sandbox test shop")}</p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => go(m.id, { as: `mer:${m.id}` })} disabled={Boolean(busy)}>
                  <Busy on={busy === m.id}>{null}</Busy>{t("Open the merchant console")}
                </Button>
              </div>
            ))}
            {d.demo ? (
              <details className="rounded-lg border border-rule bg-card p-5 sm:col-span-2">
                <summary className="cursor-pointer font-medium">{t("For developers: sign in with an access key")}</summary>
                <p className="mt-2 mb-3 text-sm text-ink-2">{t("You don't need a key for the demo. Keys are for connecting an outside AI agent (over MCP) to a shopper's account, and are printed by the seed script, never shown on the site.")}</p>
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void go("key", { key });
                }}
              >
                <div className="flex items-center gap-2 font-medium">
                  <KeyRound className="size-4" />{" "}{t("With an access key")}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="key">{t("Access key")}</Label>
                  <Input id="key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} className="min-h-11" required />
                </div>
                <Button type="submit" variant="outline" className="self-start" disabled={Boolean(busy) || !key}>
                  <Busy on={busy === "key"}>{null}</Busy>{t("Sign in")}
                </Button>
                {!d.demo && <p className="text-sm text-ink-2">{t("Demo mode is off on this server, so only access keys work.")}</p>}
              </form>
              </details>
            ) : (
            <form
              className="flex flex-col gap-3 rounded-lg border border-rule bg-card p-5 sm:col-span-2"
              onSubmit={(e) => {
                e.preventDefault();
                void go("key", { key });
              }}
            >
              <div className="flex items-center gap-2 font-medium">
                <KeyRound className="size-4" />{" "}{t("With an access key")}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="key">{t("Access key")}</Label>
                <Input id="key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} className="min-h-11" required />
              </div>
              <Button type="submit" variant="outline" className="self-start" disabled={Boolean(busy) || !key}>
                <Busy on={busy === "key"}>{null}</Busy>{t("Sign in")}
              </Button>
              {!d.demo && <p className="text-sm text-ink-2">{t("Demo mode is off on this server, so only access keys work.")}</p>}
            </form>
            )}
          </div>
        )}
      </Loaded>
    </div>
  );
}
