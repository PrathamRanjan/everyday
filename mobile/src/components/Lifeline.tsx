import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { day, daysBetween, toDate } from "@/lib/format";
import { useTheme, type Palette } from "@/lib/theme";

/** Money and item states share one visual language with the website. */
export type Tone = "now" | "wait" | "done" | "back" | "stop" | "plain";
export interface Mark {
  key: string;
  label: string;
  date: string | null;
  tone: Tone;
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
const MIN_W = 520;

const color = (c: Palette, t: Tone) => (t === "now" ? c.now : t === "wait" ? c.wait : t === "done" || t === "back" ? c.done : t === "stop" ? c.stop : c.ink2);

/**
 * The lifeline, the same drawing as the website's: marks on a rail, return and price-promise windows hanging under
 * it as bands, and a tick for today. Long windows are compressed after a break so the near weeks stay readable.
 * Drawn only from the dates passed in. Scrolls sideways on a narrow phone.
 */
export function Lifeline({ marks, bands = [], today, deadline, compact = false, title }: { marks: Mark[]; bands?: Band[]; today: string; deadline?: string | null; compact?: boolean; title?: string }) {
  const { c } = useTheme();
  const [box, setBox] = useState(0);
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
  const placed = (() => {
    const lanes = { up: -Infinity, down: -Infinity };
    return [...dated]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((m, i) => {
        const x = model.x(m.date);
        const up = i % 2 === 1 && dated.length > 3;
        const sub = compact ? "" : `${day(m.date)}${m.note ? ` · ${m.note}` : ""}`;
        const w = Math.max(m.label.length * 6.6, sub.length * 5.8);
        const want = x < 70 ? x - 7 : x > W - 70 ? x - w + 7 : x - w / 2;
        const lane = up ? "up" : "down";
        const lx = Math.max(PAD / 2, Math.min(Math.max(want, lanes[lane] + 10), W - PAD / 2 - w));
        lanes[lane] = lx + w;
        return { m, x, lx, up, sub };
      });
  })();
  const summary = [title, ...dated.map((m) => `${m.label} ${day(m.date)}${m.note ? ` (${m.note})` : ""}`), ...bands.map((b) => `${b.label} until ${day(b.to)}`), `today ${day(today)}`].filter(Boolean).join("; ");
  const lastDone = dated.filter((m) => m.tone !== "plain" && toDate(m.date).getTime() <= toDate(today).getTime()).map((m) => model.x(m.date));
  const progressTo = Math.max(PAD, ...lastDone, Math.min(tx, W - PAD));
  const width = Math.max(box, MIN_W);
  const height = (H / W) * width;
  const font = "PublicSans_600SemiBold";
  const fontR = "PublicSans_400Regular";

  return (
    <View onLayout={(e) => setBox(e.nativeEvent.layout.width)} accessible accessibilityRole="image" aria-label={summary}>
      <ScrollView horizontal showsHorizontalScrollIndicator={box < MIN_W} scrollEnabled={box < MIN_W} focusable={box < MIN_W} role={box < MIN_W ? "group" : undefined} aria-label={box < MIN_W ? "Timeline, scrolls sideways" : undefined} importantForAccessibility="no-hide-descendants">
        <Svg width={width} height={height} viewBox={`0 0 ${W} ${H}`}>
          <Line x1={PAD} x2={W - PAD} y1={RAIL_Y} y2={RAIL_Y} stroke={c.rule2} strokeWidth={2} strokeLinecap="round" />
          <Line x1={PAD} x2={progressTo} y1={RAIL_Y} y2={RAIL_Y} stroke={c.ink} strokeWidth={2} strokeLinecap="round" />
          {model.compress && (
            <G>
              <Rect x={model.split + 2} y={RAIL_Y - 7} width={10} height={14} fill={c.card} />
              <Line x1={model.split + 3} x2={model.split + 7} y1={RAIL_Y + 6} y2={RAIL_Y - 6} stroke={c.ink3} strokeWidth={1.5} />
              <Line x1={model.split + 8} x2={model.split + 12} y1={RAIL_Y + 6} y2={RAIL_Y - 6} stroke={c.ink3} strokeWidth={1.5} />
            </G>
          )}
          {deadline && (
            <G>
              <Line x1={model.x(deadline)} x2={model.x(deadline)} y1={RAIL_Y - 16} y2={RAIL_Y + 8} stroke={c.now} strokeWidth={1.5} strokeDasharray="3 3" />
              <SvgText x={model.x(deadline)} y={RAIL_Y - 20} textAnchor="middle" fontSize={11} fill={c.now} fontFamily={font}>
                {`need by ${day(deadline)}`}
              </SvgText>
            </G>
          )}
          {bands.map((b, i) => {
            const x1 = model.x(b.from);
            const x2 = Math.max(x1 + 6, model.x(b.to));
            const y = BAND0 + i * 30;
            const left = daysBetween(today, b.to);
            const open = left >= 0 && daysBetween(b.from, today) >= 0;
            const closing = open && left <= 7;
            const over = left < 0;
            const col = over ? c.ink3 : closing ? c.now : c.done;
            const labelText = `${b.label} · ${over ? `ended ${day(b.to)}` : open ? `${left === 0 ? "ends today" : `${left} day${left === 1 ? "" : "s"} left`} · ${day(b.to)}` : `${day(b.from)} – ${day(b.to)}`}`;
            const textX = Math.min(x1, W - PAD - labelText.length * 5.6);
            return (
              <G key={b.key}>
                <Rect x={x1} y={y - 5} width={x2 - x1} height={10} rx={5} fill={col} opacity={over ? 0.18 : 0.22} />
                <Rect x={x1} y={y - 5} width={Math.max(0, Math.min(x2, tx) - x1)} height={10} rx={5} fill={col} opacity={over ? 0.3 : 0.55} />
                <SvgText x={Math.max(PAD, textX)} y={y + 18} fontSize={11} fill={closing ? c.now : c.ink2} fontFamily={closing ? font : fontR}>
                  {labelText}
                </SvgText>
              </G>
            );
          })}
          <G>
            <Line x1={tx} x2={tx} y1={RAIL_Y - 12} y2={H - 16} stroke={c.ink} strokeWidth={1} opacity={0.5} />
            <Rect x={Math.min(W - 42, Math.max(2, tx - 20))} y={H - 16} width={40} height={14} rx={7} fill={c.ink} />
            <SvgText x={Math.min(W - 22, Math.max(22, tx))} y={H - 6} textAnchor="middle" fontSize={9.5} fill={c.paper} fontFamily={font} letterSpacing={0.6}>
              TODAY
            </SvgText>
          </G>
          {placed.map(({ m, x, lx, up, sub }) => (
            <G key={m.key}>
              <Glyph x={x} y={RAIL_Y} tone={m.tone} c={c} />
              <SvgText x={lx} y={up ? RAIL_Y - 14 : RAIL_Y + 22} fontSize={11.5} fill={c.ink} fontFamily={font}>
                {m.label}
              </SvgText>
              {!compact && (
                <SvgText x={lx} y={up ? RAIL_Y - 26 : RAIL_Y + 35} fontSize={10.5} fill={c.ink2} fontFamily={fontR}>
                  {sub}
                </SvgText>
              )}
            </G>
          ))}
        </Svg>
      </ScrollView>
    </View>
  );
}

function Glyph({ x, y, tone, c }: { x: number; y: number; tone: Tone; c: Palette }) {
  const col = color(c, tone);
  if (tone === "wait") return <Circle cx={x} cy={y} r={6} fill={c.card} stroke={col} strokeWidth={2.5} />;
  if (tone === "back")
    return (
      <G>
        <Circle cx={x} cy={y} r={7} fill={c.card} stroke={col} strokeWidth={2} />
        <Path d={`M${x + 3} ${y - 1.5} A3.2 3.2 0 1 0 ${x + 2.4} ${y + 2.2}`} fill="none" stroke={col} strokeWidth={1.6} />
      </G>
    );
  if (tone === "stop")
    return (
      <G>
        <Circle cx={x} cy={y} r={7} fill={c.card} />
        <Line x1={x - 4.5} y1={y - 4.5} x2={x + 4.5} y2={y + 4.5} stroke={col} strokeWidth={2.4} strokeLinecap="round" />
        <Line x1={x + 4.5} y1={y - 4.5} x2={x - 4.5} y2={y + 4.5} stroke={col} strokeWidth={2.4} strokeLinecap="round" />
      </G>
    );
  if (tone === "plain") return <Circle cx={x} cy={y} r={4.5} fill={c.card} stroke={c.ink2} strokeWidth={1.6} />;
  return <Circle cx={x} cy={y} r={6.5} fill={col} stroke={c.card} strokeWidth={2} />;
}
