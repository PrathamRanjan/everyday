import { useEffect, useRef } from "react";

/**
 * A7: one polite live region for the whole app (rendered by the shell). Every payment result and payment status
 * change is announced here, once, so a screen reader hears "Paid: PayPal confirmed the capture" without moving focus.
 */
export function announce(text: string | null | undefined) {
  const el = typeof document !== "undefined" ? document.getElementById("ev-announce") : null;
  if (!el || !text) return;
  el.textContent = "";
  window.setTimeout(() => {
    el.textContent = text;
  }, 60);
}

/** Announces `text` whenever it changes after the first render (a status that moved while the page was open). */
export function Announce({ text }: { text: string }) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    announce(text);
  }, [text]);
  return null;
}
