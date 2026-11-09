import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/*
 * Two small effects adapted from Magic UI (MIT, https://magicui.design): a number ticker and a border beam.
 * Rewritten without the motion library to keep the bundle small. Used on the public landing page only, never on
 * a screen where money is approved. Both stop when the person asks for less motion.
 */
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.a11yMotion === "off";

export function NumberTicker({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(value);
  useEffect(() => {
    const el = ref.current;
    if (!el || still()) return setN(value);
    setN(0);
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, Math.max(0, (t - t0) / 900));
        setN(Math.round(value * (1 - Math.pow(1 - k, 3))));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);
  return (
    <span ref={ref} className={cn("num", className)} aria-label={format(value)}>
      <span aria-hidden>{format(n)}</span>
    </span>
  );
}

export function BorderBeam({ className }: { className?: string }) {
  return <span aria-hidden className={cn("ev-beam pointer-events-none absolute inset-0 rounded-[inherit]", className)} />;
}
