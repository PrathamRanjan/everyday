import { useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { Bell, MessageSquare, Send, ShieldAlert } from "lucide-react";
import { Busy, Empty, Loaded, PageHead, Panel, State } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction, useApi } from "@/lib/api";
import { when } from "@/lib/format";
import { subscribePush } from "@/lib/passkey";
import { Devices } from "@/components/Devices";
import { cn } from "@/lib/utils";

interface ChannelsData {
  address: string;
  who: string;
  telegram_linked: boolean;
  telegram_ready: boolean;
  push_ready: boolean;
  simulator: boolean;
  addresses: { value: string; label: string }[];
  messages: { id: number; address: string; channel: string; direction: "in" | "out"; status: string; body: string; created_at: string; buttons: { id?: string; label?: string; text?: string }[] | null; flag: { serious: boolean; words: string[] } | null }[];
}

export default function Channels() {
  const [sp, setSp] = useSearchParams();
  const address = sp.get("address");
  const st = useApi<ChannelsData>(`/api/ui/channels${address ? `?address=${encodeURIComponent(address)}` : ""}`);
  const { run, busy } = useAction(st.reload);
  const [text, setText] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  return (
    <Loaded state={st}>
      {(d) => (
        <div className="ev-rise">
          <PageHead eyebrow="Messages" title="Messages and alerts" lede="Approvals, delays, price drops and refunds reach you with buttons. This log shows exactly what each channel sent." />
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <Panel title={d.simulator ? "Message log and simulator" : "Your messages"} sub={d.simulator ? "Demo only: view and reply as any party, with the same code the phone channels use." : undefined}>
              {d.simulator && d.addresses.length > 0 && (
                <div className="mb-4 grid gap-1.5">
                  <Label htmlFor="addr">Conversation</Label>
                  <Select value={d.address} onValueChange={(v) => setSp({ address: v })}>
                    <SelectTrigger id="addr" className="min-h-11 w-full bg-card sm:w-80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {d.addresses.map((a) => (
                        <SelectItem key={a.value} value={a.value}>
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {d.messages.length ? (
                <ol className="flex flex-col-reverse gap-3" aria-label="Messages, newest last">
                  {d.messages.map((m) => (
                    <li key={m.id} className={cn("max-w-[88%] rounded-lg border p-3 text-sm", m.direction === "out" ? "self-start border-rule bg-card" : "self-end border-ink/20 bg-sunk")}>
                      <p className="num mb-1 text-[11px] text-ink-2">
                        {m.channel} · {m.direction === "in" ? "received" : "sent"} · {when(m.created_at)} · {m.status}
                      </p>
                      {m.flag && (
                        <p role="alert" className={cn("mb-1 flex gap-1.5 text-xs font-semibold", m.flag.serious ? "text-stop" : "text-wait")}>
                          <ShieldAlert className="size-3.5 shrink-0" />
                          This message {m.flag.words.join(", and ")}. Everyday only acts on its own buttons and commands.
                        </p>
                      )}
                      <p className="break-words whitespace-pre-wrap">{m.body}</p>
                      {m.buttons && m.buttons.length > 0 && m.direction === "out" && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {m.buttons.map((b, k) => (
                            <Button key={k} size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => run(`b${m.id}${k}`, "/channels/reply", { address: m.address, buttonId: b.id ?? "", replyTo: m.id }, { stay: true })}>
                              {b.label ?? b.text ?? b.id}
                            </Button>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty icon={<MessageSquare className="size-6" />} title="No messages yet.">
                  When a plan is ready, a delivery slips or a refund lands, the message appears here.
                </Empty>
              )}
              {d.address && (
                <form
                  className="mt-4 flex gap-2 border-t border-rule pt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("reply", "/channels/reply", { address: d.address, text }, { stay: true }).then(() => setText(""));
                  }}
                >
                  <Label htmlFor="reply" className="sr-only">
                    Reply
                  </Label>
                  <Input id="reply" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} required placeholder="Reply (try: pending, orders, watch, stop, cases)" className="min-h-11 bg-card" />
                  <Button type="submit" disabled={Boolean(busy) || !text.trim()} aria-label="Send">
                    <Busy on={busy === "reply"}>
                      <Send className="size-4" />
                    </Busy>
                  </Button>
                </form>
              )}
            </Panel>
            <aside className="space-y-6">
              {d.who !== "console" && (
                <Panel title="On your phone">
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span>Telegram</span>
                      <State s={d.telegram_linked ? "active" : d.telegram_ready ? "pending" : "stale"} label={d.telegram_linked ? "connected" : d.telegram_ready ? "not connected" : "bot not configured here"} />
                    </div>
                    {d.telegram_ready && (
                      <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => run("tg", "/connect/telegram")}>
                        <Send className="size-4" /> {d.telegram_linked ? "Connect another chat" : "Connect Telegram"}
                      </Button>
                    )}
                    <div className="flex items-center justify-between gap-2 border-t border-rule pt-3">
                      <span>Browser notifications</span>
                      <State s={d.push_ready ? "pending" : "stale"} label={d.push_ready ? "available" : "not configured here"} />
                    </div>
                    {d.push_ready && "serviceWorker" in navigator && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pushBusy}
                        onClick={async () => {
                          setPushBusy(true);
                          try {
                            toast.message(await subscribePush());
                          } catch (e) {
                            toast.error((e as Error).message);
                          } finally {
                            setPushBusy(false);
                          }
                        }}
                      >
                        <Busy on={pushBusy}>
                          <Bell className="size-4" />
                        </Busy>
                        Turn on notifications
                      </Button>
                    )}
                  </div>
                </Panel>
              )}
              {d.who === "shopper" && <Devices />}
            </aside>
          </div>
        </div>
      )}
    </Loaded>
  );
}
