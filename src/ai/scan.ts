/** Flags text written to an automated system inside customer or supplier messages. The text stays data. */
const PATTERNS: [string, RegExp][] = [
  ["agent_instruction", /\b(assistant|ai agent|agent|bot|llm|model|copilot|gpt|claude)\s*[:,-]/i],
  ["agent_instruction", /\bignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\b/i],
  ["agent_instruction", /\b(system|developer)\s+(prompt|message|instruction)/i],
  ["payment_redirect", /\b(send|pay|transfer|remit|wire|refund)\b[^\n]{0,60}\b(to|into)\b[^\n]{0,80}(@|\baccount\b|\biban\b|\bbsb\b|paypal\.me|\bwallet\b)/i],
  ["payment_redirect", /\bchange\s+(the\s+)?(payee|recipient|beneficiary|bank|account|payment details)/i],
  ["amount_override", /\b(set|change|make|adjust)\s+(the\s+)?(total|amount|payment|charge|refund)\s+(to|=)/i],
  ["amount_override", /\bapprove\s+(this\s+)?(refund|invoice|claim)\s+(in\s+full|automatically|without)/i],
];

export function scanText(text: string): { kind: string; text: string }[] {
  const out: { kind: string; text: string }[] = [];
  for (const line of text.split(/\r?\n|(?<=[.!?])\s+/)) {
    const hit = PATTERNS.find(([, re]) => re.test(line));
    if (hit) out.push({ kind: hit[0], text: line.trim().slice(0, 200) });
  }
  return out;
}
