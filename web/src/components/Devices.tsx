import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Puzzle, Smartphone } from "lucide-react";
import { Busy, Panel } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/api";
import { when } from "@/lib/format";
import { t, tn } from "@/i18n";

interface Device {
  id: string;
  label: string;
  client: "mobile" | "extension" | "agent";
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, credentials: "same-origin", body: JSON.stringify(body ?? {}) });
  const out = await r.json().catch(() => null);
  if (!r.ok) throw new Error(out?.message ?? t("That didn't work. Try again."));
  return out as T;
}

/** Connect the phone app or the browser extension: a key shown once, revocable here. */
export function Devices() {
  const st = useApi<{ devices: Device[] }>("/api/ui/devices");
  const [busy, setBusy] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ key: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const devices = st.data?.devices.filter((d) => !d.revoked) ?? [];

  const connect = async (client: Device["client"]) => {
    setBusy(client);
    try {
      const out = await postJson<{ key: string; label: string }>("/api/ui/devices", { client });
      setFresh({ key: out.key, label: out.label });
      setCopied(false);
      await st.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const revoke = async (id: string) => {
    setBusy(id);
    try {
      await postJson(`/api/ui/devices/${id}/revoke`);
      toast.message(t("Disconnected. That key no longer works."));
      await st.reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title={t("Phone app and browser extension")} sub={t("Each device gets its own key. It can plan, quote and start checkout as you; PayPal still asks you to approve every payment.")}>
      <div className="space-y-3 text-sm" data-testid="devices">
        {fresh && (
          <div className="rounded-md border border-rule bg-paper p-3" role="status">
            <p className="font-medium">{tn("Key for {0}", fresh.label)}</p>
            <p className="mt-1 text-xs text-ink-2">{t("Shown once. Paste it into the app or the extension's settings.")}</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-card px-2 py-2 font-mono text-xs" aria-label={t("Device key")}>
                {fresh.key}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(fresh.key);
                    setCopied(true);
                  } catch {
                    toast.error(t("Couldn't copy. Select the key and copy it."));
                  }
                }}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? t("Copied") : t("Copy")}
              </Button>
            </div>
          </div>
        )}
        {devices.length > 0 ? (
          <ul className="divide-y divide-rule">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 font-medium">
                    {d.client === "mobile" ? <Smartphone className="size-4" /> : <Puzzle className="size-4" />} {d.label}
                  </span>
                  <span className="block text-xs text-ink-2">{d.last_used_at ? t("Last used {0}", when(d.last_used_at)) : t("Connected {0}, not used yet", when(d.created_at))}</span>
                </span>
                <Button size="sm" variant="ghost" disabled={busy === d.id} onClick={() => void revoke(d.id)}>
                  <Busy on={busy === d.id}>{t("Disconnect")}</Busy>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-2">{t("Nothing connected.")}</p>
        )}
        <div className="flex flex-wrap gap-2 border-t border-rule pt-3">
          <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void connect("extension")}>
            <Busy on={busy === "extension"}>
              <Puzzle className="size-4" />
            </Busy>
            {t("Connect the extension")}
          </Button>
          <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void connect("mobile")}>
            <Busy on={busy === "mobile"}>
              <Smartphone className="size-4" />
            </Busy>
            {t("Connect the phone app")}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
