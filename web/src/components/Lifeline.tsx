import { useId, useMemo } from "react";
import { day, daysBetween, toDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t, tn } from "@/i18n";

/** Money and item states share one visual language (DESIGN_BRIEF.md). */
export type Tone = "now" | "wait" | "done" | "back" | "stop" | "plain";

export interface Mark {
  key: string;
  label: string;
  date: string | null;
  tone: Tone;
  /** Shown under the label, e.g. an amount or "PayPal COMPLETED". */
  note?: string;
}
export interface Band {
  key: string;
  label: string;
  from: string;
  to: string;
}

const W = 680;
const PAD = 22;
const RAIL_Y = 40;

const COLOR: Record<Tone, string> = { now: "var(--now)", wait: "var(--wait)", done: "var(--done)", back: "var(--done)", stop: "var(--stop)", plain: "var(--ink-2)" };

/**
 * The lifeline: one item through time. Marks sit on the rail; windows (return, price promise, warranty) hang
 * under it as bands; a tick shows today. Long windows (a warranty of years) are compressed after a break so the
 * near weeks stay readable. Everything is drawn from the dates passed in; nothing is decorative.
 */
export function Lifeline({ marks, bands = [], today, deadline, compact = false, className, title }: { marks: Mark[]; bands?: Band[]; today: string; deadline?: string | null; compact?: boolean; className?: string; title?: string }) {
  const uid = useId();
  const dated = marks.filter((m) => m.date) as (Mark & { date: string })[];
  const model = useMemo(() => {
    const all = [today, ...dated.map((m) => m.date), ...bands.flatMap((b) => [b.from, b.to]), ...(deadline ? [deadline] : [])].filter(Boolean).map((d) => toDate(d).getTime());
    const min = Math.min(...all);
    const maxAll = Math.max(...all);
    const nearEnd = Math.max(min + 21 * 864e5, ...[today, ...dated.map((m) => m.date), ...bands.filter((b) => daysBetween(b.from, b.to) <= 60).map((b) => b.to), ...(deadline ? [deadline] : [])].map((d) => toDate(d).getTime())) + 4 * 864e5;
    const compress = maxAll > nearEnd + 30 * 864e5;
    const split = compress ? W * 0.74 : W - PAD;
    const x = (iso: string) => {
      const t = toDate(iso).getTime();
      if (!compress || t <= nearEnd) return PAD + ((t - min) / Math.max(1, (compress ? nearEnd : maxAll) - min)) * (split - PAD);
      return split + 14 + ((t - nearEnd) / Math.max(1, maxAll - nearEnd)) * (W - PAD - split - 14);
    };
    return { x, compress, split };
  }, [today, deadline, JSON.stringify(dated), JSON.stringify(bands)]); // eslint-disable-line react-hooks/exhaustive-deps
  const BAND0 = RAIL_Y + (compact ? 38 : 52);
  const H = BAND0 + bands.length * 30 + 22;
  const tx = model.x(today);
  // Mark labels, left to right: centred under the mark where there's room, otherwise nudged right so two close dates
  // (paid and arrives two days apart) never print on top of each other.
  const placed = (() => {
    const lanes = { up: -Infinity, down: -Infinity };
    return [...dated].sort((a, b) => a.date.localeCompare(b.date)).map((m, i) => {
      const x = model.x(m.date);
      const up = i % 2 === 1 && dated.length > 3;
      const sub = compact ? "" : `${day(m.date)}${m.note ? ` · ${m.note}` : ""}`;
      const w = Math.max(m.label.length * 6.6, sub.length * 5.8);
      const want = x < 70 ? x - 7 : x > W - 70 ? x - w + 7 : x - w / 2;
      const lane = up ? "up" : "down";
      const lx = Math.max(PAD / 2, Math.min(Math.max(want, lanes[lane] + 10), W - PAD / 2 - w));
      lanes[lane] = lx + w;
      return { m, x, lx, up };
    });
  })();
  const summary = [title, ...dated.map((m) => `${m.label} ${day(m.date)}${m.note ? ` (${m.note})` : ""}`), ...bands.map((b) => `${b.label} until ${day(b.to)}`), `today ${day(today)}`].filter(Boolean).join("; ");
  const lastDone = dated.filter((m) => m.tone !== "plain" && toDate(m.date).getTime() <= toDate(today).getTime()).map((m) => model.x(m.date));
  const progressTo = Math.max(PAD, ...lastDone, Math.min(tx, W - PAD));

  return (
    <figure className={cn("rail-scroll -mx-1 px-1", className)} data-lifeline tabIndex={0} role="group" aria-label={t("Timeline (scrolls sideways on small screens)")}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full min-w-[520px]" role="img" aria-labelledby={`${uid}-t`}>
        <title id={`${uid}-t`}>{summary}</title>
        {/* the rail */}
        <line x1={PAD} x2={W - PAD} y1={RAIL_Y} y2={RAIL_Y} stroke="var(--rule-2)" strokeWidth={2} strokeLinecap="round" />
        <line x1={PAD} x2={progressTo} y1={RAIL_Y} y2={RAIL_Y} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" style={{ strokeDasharray: 1000, ["--len" as string]: 1000, animation: "ev-draw 700ms var(--ease) both" }} />
        {model.compress && (
          <g aria-hidden>
            <rect x={model.split + 2} y={RAIL_Y - 7} width={10} height={14} fill="var(--card)" />
            <line x1={model.split + 3} x2={model.split + 7} y1={RAIL_Y + 6} y2={RAIL_Y - 6} stroke="var(--ink-3)" strokeWidth={1.5} />
            <line x1={model.split + 8} x2={model.split + 12} y1={RAIL_Y + 6} y2={RAIL_Y - 6} stroke="var(--ink-3)" strokeWidth={1.5} />
          </g>
        )}
        {/* deadline */}
        {deadline && (
          <g>
            <line x1={model.x(deadline)} x2={model.x(deadline)} y1={RAIL_Y - 16} y2={RAIL_Y + 8} stroke="var(--now)" strokeWidth={1.5} strokeDasharray="3 3" />
            <text x={model.x(deadline)} y={RAIL_Y - 20} textAnchor="middle" fontSize={11} fill="var(--now)" className="num" fontWeight={600}>
              {tn("need by {0}", day(deadline))}
            </text>
          </g>
        )}
        {/* bands */}
        {bands.map((b, i) => {
          const x1 = model.x(b.from);
          const x2 = Math.max(x1 + 6, model.x(b.to));
          const y = BAND0 + i * 30;
          const left = daysBetween(today, b.to);
          const open = left >= 0 && daysBetween(b.from, today) >= 0;
          const closing = open && left <= 7;
          const over = left < 0;
          const c = over ? "var(--ink-3)" : closing ? "var(--now)" : "var(--done)";
          const labelText = `${b.label} · ${over ? `ended ${day(b.to)}` : open ? `${left === 0 ? "ends today" : `${left} day${left === 1 ? "" : "s"} left`} · ${day(b.to)}` : `${day(b.from)} – ${day(b.to)}`}`;
          const textX = Math.min(x1, W - PAD - labelText.length * 5.6);
          return (
            <g key={b.key}>
              <rect x={x1} y={y - 5} width={x2 - x1} height={10} rx={5} fill={c} opacity={over ? 0.18 : 0.22} />
              <rect x={x1} y={y - 5} width={Math.max(0, Math.min(x2, tx) - x1)} height={10} rx={5} fill={c} opacity={over ? 0.3 : 0.55} />
              <text x={Math.max(PAD, textX)} y={y + 18} fontSize={11} fill={closing ? "var(--now)" : "var(--ink-2)"} fontWeight={closing ? 600 : 400} className="num">
                {labelText}
              </text>
            </g>
          );
        })}
        {/* today */}
        <g>
          <line x1={tx} x2={tx} y1={RAIL_Y - 12} y2={H - 16} stroke="var(--ink)" strokeWidth={1} opacity={0.5} />
          <rect x={Math.min(W - 42, Math.max(2, tx - 20))} y={H - 16} width={40} height={14} rx={7} fill="var(--ink)" />
          <text x={Math.min(W - 22, Math.max(22, tx))} y={H - 6} textAnchor="middle" fontSize={9.5} fill="var(--paper)" fontWeight={700} letterSpacing={0.6}>
            {t("TODAY")}
          </text>
        </g>
        {/* marks */}
        {placed.map(({ m, x, lx, up }) => {
          return (
            <g key={m.key}>
              <MarkGlyph x={x} y={RAIL_Y} tone={m.tone} />
              <text x={lx} y={up ? RAIL_Y - 14 : RAIL_Y + 22} textAnchor="start" fontSize={11.5} fill="var(--ink)" fontWeight={600}>
                {m.label}
              </text>
              {!compact && (
                <text x={lx} y={up ? RAIL_Y - 26 : RAIL_Y + 22 + 13} textAnchor="start" fontSize={10.5} fill="var(--ink-2)" className="num">
                  {day(m.date)}
                  {m.note ? ` · ${m.note}` : ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

function MarkGlyph({ x, y, tone }: { x: number; y: number; tone: Tone }) {
  const c = COLOR[tone];
  if (tone === "wait") return <circle cx={x} cy={y} r={6} fill="var(--card)" stroke={c} strokeWidth={2.5} />;
  if (tone === "back")
    return (
      <g>
        <circle cx={x} cy={y} r={7} fill="var(--card)" stroke={c} strokeWidth={2} />
        <path d={`M${x + 3} ${y - 1.5} A3.2 3.2 0 1 0 ${x + 2.4} ${y + 2.2}`} fill="none" stroke={c} strokeWidth={1.6} />
      </g>
    );
  if (tone === "stop")
    return (
      <g stroke={c} strokeWidth={2.4} strokeLinecap="round">
        <circle cx={x} cy={y} r={7} fill="var(--card)" strokeWidth={0} />
        <line x1={x - 4.5} y1={y - 4.5} x2={x + 4.5} y2={y + 4.5} />
        <line x1={x + 4.5} y1={y - 4.5} x2={x - 4.5} y2={y + 4.5} />
      </g>
    );
  if (tone === "plain") return <circle cx={x} cy={y} r={4.5} fill="var(--card)" stroke="var(--ink-2)" strokeWidth={1.6} />;
  return <circle cx={x} cy={y} r={6.5} fill={c} stroke="var(--card)" strokeWidth={2} />;
}

/** The small inline version of a mark, for badges, tables and timelines. */
export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("inline-block size-3.5 shrink-0 align-[-2px]", className)} aria-hidden>
      <MarkGlyph x={8} y={8} tone={tone} />
    </svg>
  );
}
