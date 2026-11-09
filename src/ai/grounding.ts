/**
 * Grounding and quarantine helpers (roadmap B.1). A model may only report a value it can point at in the
 * source; anything it cannot quote is dropped and flagged. Instruction-shaped text found inside a note or a
 * message is quarantined: shown to people, never forwarded to any tool.
 */
export interface Grounded<T> {
  value: T | null;
  quote: string | null;
  grounded: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[“”"']/g, "").trim();

/** Keeps `value` only when `quote` (the model's own citation) appears in the source text. */
export function ground<T>(value: T | null, quote: string | null | undefined, sourceText: string): Grounded<T> {
  if (value === null || value === undefined) return { value: null, quote: null, grounded: false };
  if (!quote || !quote.trim()) return { value: null, quote: null, grounded: false };
  const ok = norm(sourceText).includes(norm(quote));
  return ok ? { value, quote, grounded: true } : { value: null, quote, grounded: false };
}

/** Where a grounded quote sits in the source, as a span for highlighting. */
export function spanOf(sourceText: string, quote: string | null | undefined): { start: number; end: number; text: string } | null {
  if (!quote) return null;
  const i = sourceText.indexOf(quote);
  if (i >= 0) return { start: i, end: i + quote.length, text: quote };
  const j = sourceText.toLowerCase().indexOf(quote.toLowerCase());
  return j >= 0 ? { start: j, end: j + quote.length, text: sourceText.slice(j, j + quote.length) } : null;
}

const INSTRUCTION_PATTERNS = [
  /\b(ignore|disregard|forget|skip|bypass)\b.{0,40}\b(instructions?|rules?|above|previous|approval|approvals|checks?)\b/i,
  /\b(approve|accept|pay|release|refund|capture|transfer|send|waive)\b.{0,40}\b(full|all|everyone|everybody|immediately|now|without|regardless)\b/i,
  /\b(you are|act as|pretend|system prompt|assistant|as an ai|language model)\b/i,
  /\b(mark|set|treat|consider)\b.{0,30}\b(as (verified|accepted|delivered|approved|complete|paid|undamaged|fine))\b/i,
  /\b(system|assistant|developer)\s*:/i,
  /\b(no (damage|fee|charge)|waive the (fee|charge|deposit))\b.{0,30}\b(agreed|approved|confirmed) by (the )?(owner|manager|customer|shop)\b/i,
];

/** Lines of a note or message that read as instructions to a reader or a machine rather than as data. */
export function quarantine(text: string): { clean: string; quarantined: string[] } {
  const quarantined: string[] = [];
  const kept: string[] = [];
  for (const line of text.split(/\r?\n|(?<=[.!?])\s+(?=[A-Z])/)) {
    if (INSTRUCTION_PATTERNS.some((re) => re.test(line))) quarantined.push(line.trim());
    else kept.push(line);
  }
  return { clean: kept.join(" ").replace(/\s+/g, " ").trim(), quarantined };
}
