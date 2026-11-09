import type { Attrs } from "../services/catalog-data.js";

/** Hard eligibility in code, with reasons. Unknown is reported as unknown, never as a pass. Pure. */
export interface Ctx {
  laptop_port: "usb-c-dp" | "thunderbolt" | "usb-a" | "hdmi" | null;
  monitor: { title: string; inputs: string[]; vesa: number | null } | null;
  require_ergonomic: boolean;
  owned_categories: Map<string, string>; // category -> owned item title
  replace_categories: Set<string>; // owned categories the person wants replaced
}

export interface PCheck {
  category: string;
  attrs: Attrs;
  stock: number;
  checkout: boolean;
}

const PORT_LABEL: Record<string, string> = { "usb-c-dp": "USB-C with video", thunderbolt: "Thunderbolt", "usb-a": "USB-A only", hdmi: "HDMI" };

export function check(p: PCheck, ctx: Ctx): { ok: boolean; reasons: string[]; unknown: string[] } {
  const reasons: string[] = [];
  const unknown: string[] = [];
  const owned = ctx.owned_categories.get(p.category);
  if (owned && !ctx.replace_categories.has(p.category)) reasons.push(`you already own ${owned}`);
  if (p.category === "dock") {
    const out = p.attrs.video_out ?? [];
    if (!out.length) reasons.push("no video output, so it cannot drive your monitor");
    if (!ctx.laptop_port) unknown.push("which port your laptop has");
    else if (!(p.attrs.host ?? []).includes(ctx.laptop_port as any)) reasons.push(`needs ${(p.attrs.host ?? []).map((h) => PORT_LABEL[h]).join(" or ")}; your laptop has ${PORT_LABEL[ctx.laptop_port]}`);
    if (ctx.monitor && out.length && !out.some((o) => ctx.monitor!.inputs.includes(o))) reasons.push(`outputs ${out.join("/").toUpperCase()} but your ${ctx.monitor.title} takes ${ctx.monitor.inputs.join("/").toUpperCase()}`);
    if (!ctx.monitor) unknown.push("your monitor's inputs");
  }
  if (p.category === "monitor_arm") {
    if (!ctx.monitor?.vesa) unknown.push("your monitor's VESA size");
    else if (!(p.attrs.vesa ?? []).includes(ctx.monitor.vesa)) reasons.push(`fits VESA ${(p.attrs.vesa ?? []).join("/")}; your monitor is VESA ${ctx.monitor.vesa}`);
  }
  if (p.category === "chair" && ctx.require_ergonomic) {
    if (p.attrs.ergonomic === false) reasons.push("no adjustable lumbar support (you asked for comfort)");
    else if (p.attrs.ergonomic !== true) unknown.push("whether it has adjustable lumbar support (not confirmed)");
  }
  if (!p.checkout) unknown.push("availability and checkout (continue at retailer)");
  return { ok: reasons.length === 0 && unknown.length === 0, reasons, unknown };
}
