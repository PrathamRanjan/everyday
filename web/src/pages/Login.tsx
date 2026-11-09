import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { KeyRound, Store, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Busy, Loaded, PageHead } from "@/components/kit";
import { postAction, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { toast } from "sonner";

type Personas = { demo: boolean; accounts: { id: string; name: string }[]; merchants: { id: string; name: string }[] };

export default function Login() {
  const [q] = useSearchParams();
  const next = q.get("next") ?? "";
  const st = useApi<Personas>("/api/ui/personas");
  const { refresh } = useSession();
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const go = async (k: string, data: Record<string, string>) => {
    setBusy(k);
    try {
      const r = await postAction("/login", { ...data, next });
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
      <PageHead eyebrow="Sign in" title="Who are you today?" lede="This is a demo on the PayPal sandbox. Pick a seeded person; nothing here uses real money." />
      <Loaded state={st}>
        {(d) => (
          <div className="grid gap-4 sm:grid-cols-2">
            {d.accounts.map((a) => (
              <div key={a.id} className="flex flex-col gap-3 rounded-lg border border-rule bg-card p-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-full bg-now-bg text-now">
                    <User className="size-5" />
                  </span>
                  <div>
                    <p className="font-display text-xl">{a.name}</p>
                    <p className="text-sm text-ink-2">Shopper · buying a study setup by Friday</p>
                  </div>
                </div>
                <Button onClick={() => go(a.id, { as: `acc:${a.id}` })} disabled={Boolean(busy)}>
                  <Busy on={busy === a.id}>{null}</Busy>Continue as {a.name}
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
                    <p className="text-sm text-ink-2">Merchant · sandbox test shop</p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => go(m.id, { as: `mer:${m.id}` })} disabled={Boolean(busy)}>
                  <Busy on={busy === m.id}>{null}</Busy>Open the merchant console
                </Button>
              </div>
            ))}
            <form
              className="flex flex-col gap-3 rounded-lg border border-rule bg-card p-5 sm:col-span-2"
              onSubmit={(e) => {
                e.preventDefault();
                void go("key", { key });
              }}
            >
              <div className="flex items-center gap-2 font-medium">
                <KeyRound className="size-4" /> With an access key
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="key">Access key</Label>
                <Input id="key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} className="min-h-11" required />
              </div>
              <Button type="submit" variant="outline" className="self-start" disabled={Boolean(busy) || !key}>
                <Busy on={busy === "key"}>{null}</Busy>Sign in
              </Button>
              {!d.demo && <p className="text-sm text-ink-2">Demo mode is off on this server, so only access keys work.</p>}
            </form>
          </div>
        )}
      </Loaded>
    </div>
  );
}
