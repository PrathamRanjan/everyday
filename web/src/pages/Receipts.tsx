import { useRef, useState } from "react";
import { SpeakableText } from "@/components/forms";
import { Link } from "react-router";
import { Camera, ClipboardPaste, FileText, ReceiptText, Trash2 } from "lucide-react";
import { Busy, PageHead, Panel, TrustStrip } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { announce } from "@/lib/announce";
import { money } from "@/lib/format";
import { t, tn } from "@/i18n";

/**
 * B6: receipts in. Paste an order email or add a photo; the model reads it, code keeps only what it can find in the
 * receipt's own words, and nothing is saved until you check the lines and press Save. If the reading fails, the same
 * form is there to fill in by hand.
 */
interface Reading {
  reader: string;
  model: string;
  merchant: string | null;
  purchase_date: string | null;
  date_quote: string | null;
  return_days: number | null;
  return_quote: string | null;
  lines: { title: string; category: string | null; price_cents: number | null; price_quote: string | null; warranty_years: number | null; warranty_quote: string | null }[];
  quarantined: string[];
  dropped: number;
}
interface Row {
  title: string;
  price: string;
  warranty_years: string;
  category: string | null;
  quote: string | null;
}
const blank = (): Row => ({ title: "", price: "", warranty_years: "", category: null, quote: null });

async function postJson(path: string, body: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", "x-everyday-ui": "1" }, credentials: "same-origin", body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, j };
}

/** Shrinks a photo to at most 1600 px on its long side, as JPEG, before it leaves the browser. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error(t("That file isn't an image this browser can open.")));
      i.src = url;
    });
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function Receipts() {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState("");
  const [returnDays, setReturnDays] = useState("");
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ title: string; return_until: string | null; warranty_until: string | null }[] | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const sample = async () => {
    const r = await fetch("/api/ui/receipts/sample", { credentials: "same-origin" }).then((x) => x.json());
    setText(r.text);
    setPhoto(null);
    announce(t("The sample receipt is in the box. Press Read it."));
  };
  const manual = (why: string | null) => {
    setReading(null);
    setRows([blank()]);
    setErr(why);
    if (why) announce(why);
  };
  const read = async () => {
    setBusy("read");
    setErr(null);
    setSaved(null);
    try {
      const r = await postJson("/api/ui/receipts/read", photo ? { image: photo } : { text });
      if (!r.ok) return r.j?.manual ? manual(r.j.message) : setErr(r.j?.message ?? t("That didn't work. Try again."));
      const g: Reading = r.j.reading;
      setReading(g);
      setMerchant(g.merchant ?? "");
      setDate(g.purchase_date ?? "");
      setReturnDays(g.return_days ? String(g.return_days) : "");
      setRows(g.lines.map((l) => ({ title: l.title, price: l.price_cents ? (l.price_cents / 100).toFixed(2) : "", warranty_years: l.warranty_years ? String(l.warranty_years) : "", category: l.category, quote: l.price_quote })));
      announce(t("Read {0} item{1}. Check them, then press Save.", g.lines.length, g.lines.length === 1 ? "" : "s"));
    } catch {
      setErr(t("Couldn't reach Everyday. Nothing was saved."));
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    if (!rows) return;
    setBusy("save");
    setErr(null);
    try {
      const lines = rows
        .filter((r) => r.title.trim())
        .map((r) => ({ title: r.title.trim(), category: r.category, price_cents: r.price ? Math.round(Number(r.price) * 100) : null, purchase_date: date, merchant: merchant || null, return_days: returnDays ? Number(returnDays) : null, warranty_years: r.warranty_years ? Number(r.warranty_years) : null }));
      const r = await postJson("/api/ui/receipts/save", { lines, how: reading ? "model" : "manual" });
      if (!r.ok) return setErr(r.j?.message ?? t("That didn't save. Try again."));
      setSaved(r.j.items);
      setRows(null);
      setReading(null);
      setText("");
      setPhoto(null);
      announce(t("Saved {0} item{1} to what you own.", r.j.items.length, r.j.items.length === 1 ? "" : "s"));
    } catch {
      setErr(t("Couldn't reach Everyday. Nothing was saved."));
    } finally {
      setBusy(null);
    }
  };
  const set = (i: number, k: keyof Row, v: string) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  return (
    <div className="grid gap-6">
      <PageHead
        eyebrow={t("Receipts")}
        title={t("Add something you bought elsewhere")}
        lede={t("Paste the order email or add a photo of the receipt. Everyday reads the item, price, date and the return and warranty terms, and you check them before anything is saved. Then the item gets the same reminders as things bought here.")}
      />
      <TrustStrip ai={t("The model reads the receipt and quotes where each value came from.")} code={t("Code keeps a value only if that quote is really on the receipt, and works out the dates.")} paypal={t("No money moves on this page.")} />

      {saved && (
        <Panel title={t("Saved")}>
          <ul className="grid gap-2">
            {saved.map((s) => (
              <li key={s.title} className="text-sm">
                <strong>{s.title}</strong>: {s.return_until ? t("return by {0}", s.return_until) : t("no return window on the receipt")}; {s.warranty_until ? t("warranty to {0}", s.warranty_until) : t("no warranty on the receipt")}.
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            <Link className="underline" to="/today">{t("See it on Today")}</Link>{" "}{t("or")}{" "}<Link className="underline" to="/you">{t("in what you own")}</Link>.
          </p>
        </Panel>
      )}

      {!rows && (
        <Panel title={t("1. The receipt")} sub={t("Text or a photo. The receipt is treated as data: instructions inside it are ignored.")}>
          <div className="grid gap-3">
            <Label htmlFor="receipt-text">{t("Order email or receipt text")}</Label>
            <SpeakableText id="receipt-text" rows={9} value={text} onChange={(v) => (setText(v), setPhoto(null))} placeholder={t("Paste the order confirmation here")} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={sample}>
                <FileText aria-hidden />{" "}{t("Use the sample receipt")}
              </Button>
              <Button type="button" variant="outline" onClick={() => file.current?.click()}>
                <Camera aria-hidden />{" "}{t("Add a photo")}
              </Button>
              <input
                ref={file}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label={t("Receipt photo")}
                tabIndex={-1}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    setPhoto(await shrink(f));
                    setText("");
                    announce(t("Photo {0} added. Press Read it.", f.name));
                  } catch (x) {
                    setErr((x as Error).message);
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  const b = await fetch("/static/samples/receipt-photo.png").then((r) => r.blob());
                  setPhoto(await shrink(new File([b], "receipt-photo.png", { type: "image/png" })));
                  setText("");
                  announce(t("The sample receipt photo is added. Press Read it."));
                }}
              >
                <Camera aria-hidden />{" "}{t("Use a sample photo")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => manual(null)}>
                <ClipboardPaste aria-hidden />{" "}{t("Type it in yourself")}
              </Button>
            </div>
            {photo && <img src={photo} alt={t("The receipt photo you added")} className="max-h-64 w-auto max-w-full rounded border object-contain" />}
            {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
            <div>
              <Button type="button" onClick={read} disabled={busy !== null || (!text.trim() && !photo)}>
                <Busy on={busy === "read"}>
                  <ReceiptText aria-hidden />{" "}{t("Read it")}
                </Busy>
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {rows && (
        <Panel title={t("2. Check what was read")} sub={reading ? t("Read by {0} ({1}). Change anything that's wrong.", reading.model, reading.reader === "vision-model" ? t("from the photo") : t("from the text")) : t("Fill in what the receipt says. Leave a term empty if the receipt doesn't state it.")}>
          <div className="grid gap-4">
            {reading && reading.dropped > 0 && <p className="text-sm">{tn("Everyday left out {0} value{1} the model gave but couldn't point to on the receipt.", reading.dropped, reading.dropped === 1 ? "" : "s")}</p>}
            {reading && reading.quarantined.length > 0 && <p className="text-sm">{t("The receipt had text that looked like instructions; it was ignored.")}</p>}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1">
                <Label htmlFor="r-merchant">{t("Shop")}</Label>
                <Input id="r-merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="r-date">{t("Date bought")}</Label>
                <Input id="r-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                {reading?.date_quote && <p className="text-xs text-muted-foreground">{tn("From “{0}”", reading.date_quote)}</p>}
              </div>
              <div className="grid gap-1">
                <Label htmlFor="r-return">{t("Return window (days)")}</Label>
                <Input id="r-return" inputMode="numeric" value={returnDays} onChange={(e) => setReturnDays(e.target.value.replace(/\D/g, ""))} placeholder={t("Not on the receipt")} />
                {reading?.return_quote ? <p className="text-xs text-muted-foreground">{tn("From “{0}”", reading.return_quote)}</p> : reading && <p className="text-xs text-muted-foreground">{t("The receipt doesn't state one.")}</p>}
                {/deliver/i.test(reading?.return_quote ?? "") && <p className="text-xs text-muted-foreground">{t("The receipt counts from delivery. Everyday counts from the date bought, so your real window may end a few days later.")}</p>}
              </div>
            </div>
            <ul className="grid gap-3">
              {rows.map((r, i) => (
                <li key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_8rem_8rem_auto] sm:items-end">
                  <div className="grid gap-1">
                    <Label htmlFor={`r-title-${i}`}>{t("Item")}</Label>
                    <Input id={`r-title-${i}`} value={r.title} onChange={(e) => set(i, "title", e.target.value)} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`r-price-${i}`}>{t("Price ($)")}</Label>
                    <Input id={`r-price-${i}`} inputMode="decimal" value={r.price} onChange={(e) => set(i, "price", e.target.value.replace(/[^\d.]/g, ""))} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`r-war-${i}`}>{t("Warranty (years)")}</Label>
                    <Input id={`r-war-${i}`} inputMode="decimal" value={r.warranty_years} onChange={(e) => set(i, "warranty_years", e.target.value.replace(/[^\d.]/g, ""))} placeholder={t("None stated")} />
                  </div>
                  <Button type="button" variant="ghost" size="icon" aria-label={t("Remove {0}", r.title || t("this item"))} onClick={() => setRows((rs) => (rs!.length > 1 ? rs!.filter((_, j) => j !== i) : [blank()]))}>
                    <Trash2 aria-hidden />
                  </Button>
                  {r.quote && <p className="text-xs text-muted-foreground sm:col-span-4">{tn("Price from “{0}”{1}", r.quote, r.price ? ` (${money(Math.round(Number(r.price) * 100))})` : "")}</p>}
                </li>
              ))}
            </ul>
            {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={save} disabled={busy !== null || !date || !rows.some((r) => r.title.trim())}>
                <Busy on={busy === "save"}>{tn("Save {0} to what I own", rows.filter((r) => r.title.trim()).length || "")}</Busy>
              </Button>
              <Button type="button" variant="outline" onClick={() => setRows((rs) => [...rs!, blank()])} disabled={rows.length >= 10}>
                {t("Add another item")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => (setRows(null), setReading(null), setErr(null))}>
                {t("Start over")}
              </Button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
