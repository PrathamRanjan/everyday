/**
 * A4: what a spoken phrase means, decided in code (no model), in English, हिन्दी, Bahasa Indonesia and Português.
 * The stop words are checked first, on every phrase, with or without the wake word, and always win.
 * Anything about money ("pay", "claim my price drop") is not decided here: it goes to the server, which answers with
 * a confirmation the person has to say back (see /api/ui/handsfree/command). No imports: the tests read this file.
 */

export type Spoken =
  | { kind: "stop" }
  | { kind: "click"; name: string | null } // name null: the thing being looked at ("click this")
  | { kind: "scroll"; dir: "up" | "down" }
  | { kind: "back" }
  | { kind: "go"; to: string }
  | { kind: "calibrate" }
  | { kind: "confirm" }
  | { kind: "cancel" }
  | { kind: "server"; text: string } // everything else (money, plans, questions): the server's router decides
  | { kind: "ignored"; why: string };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFC")
    .replace(/[.,!?।؟¿¡"“”'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const any = (s: string, words: string[]) => words.some((w) => new RegExp(`(^|\\s)${w}(\\s|$)`, "u").test(s));

export const STOP = ["stop", "stop it", "halt", "रुको", "रुकिए", "रुक जाओ", "बंद करो", "बस", "berhenti", "stop dulu", "pare", "parar"]; // not "para": it also means "to/for" in Portuguese
export const WAKE = ["peek", "pick", "peak", "पीक", "पिक"];
const CONFIRM = ["confirm", "yes", "yes pay", "yes confirm", "हाँ", "हां", "पुष्टि", "पुष्टि करें", "ya", "iya", "konfirmasi", "sim", "confirmar", "confirmo"];
const CANCEL = ["cancel", "no", "never mind", "नहीं", "रद्द", "रद्द करो", "batal", "tidak", "jangan", "não", "nao", "cancelar"];
const CLICK = ["click", "press", "select", "choose", "open", "क्लिक", "क्लिक करो", "दबाओ", "दबाएँ", "चुनो", "खोलो", "klik", "tekan", "pilih", "buka", "clicar", "clique", "aperte", "apertar", "escolher", "abrir", "abra"];
const THIS = ["this", "that", "it", "here", "यह", "इसे", "इस", "वह", "ये", "ini", "itu", "isso", "este", "esse", "isto", "aqui"];
const DOWN = ["scroll down", "down", "नीचे", "नीचे जाओ", "turun", "gulir ke bawah", "ke bawah", "descer", "rolar para baixo", "para baixo"];
const UP = ["scroll up", "up", "ऊपर", "ऊपर जाओ", "naik", "gulir ke atas", "ke atas", "subir", "rolar para cima", "para cima"];
const BACK = ["go back", "back", "वापस", "पीछे", "kembali", "voltar", "volta"];
const CALIBRATE = ["calibrate", "recalibrate", "कैलिब्रेट", "कैलिब्रेट करो", "kalibrasi", "calibrar"];
const PAGES: [string, string[]][] = [
  ["/today", ["today", "home", "आज", "होम", "hari ini", "beranda", "hoje", "início", "inicio"]],
  ["/plans", ["plans", "my plans", "योजना", "योजनाएँ", "प्लान", "rencana", "planos", "meus planos"]],
  ["/purchases", ["purchases", "orders", "my orders", "खरीदारी", "ऑर्डर", "pesanan", "pembelian", "pedidos", "compras", "meus pedidos"]],
  ["/ask", ["ask", "assistant", "पूछें", "पूछो", "सहायक", "tanya", "asisten", "perguntar", "assistente"]],
  ["/receipts", ["receipts", "रसीद", "रसीदें", "struk", "kuitansi", "recibos", "notas"]],
  ["/you", ["you", "my things", "profile", "आप", "प्रोफ़ाइल", "profil", "você", "perfil"]],
  ["/accessibility", ["accessibility", "सुलभता", "aksesibilitas", "acessibilidade"]],
];
const GO = ["go to", "open", "show", "जाओ", "खोलो", "दिखाओ", "पर जाओ", "buka", "ke", "tampilkan", "ir para", "abrir", "mostrar", "vá para", "va para"];

/** Strips the wake word from the front. Returns null when it isn't there. */
export function afterWake(text: string): string | null {
  const s = norm(text);
  for (const w of WAKE) if (s === w || s.startsWith(`${w} `)) return s.slice(w.length).trim();
  return null;
}

export const isStop = (text: string) => any(norm(text), STOP);

/**
 * One phrase → what to do. `awake` is true right after the wake word or while push-to-talk is held; otherwise only
 * the wake word (and stop) count, so talk in the room doesn't click things.
 */
export function understand(text: string, awake: boolean): Spoken {
  const raw = norm(text);
  if (!raw) return { kind: "ignored", why: "empty" };
  if (isStop(raw)) return { kind: "stop" };
  let s = raw;
  if (!awake) {
    const rest = afterWake(raw);
    if (rest === null) return { kind: "ignored", why: "no wake word" };
    s = rest;
    if (!s) return { kind: "ignored", why: "wake word only" };
  } else {
    s = afterWake(raw) ?? raw;
  }
  // Whole phrase only: "no" is also Portuguese for "in the" ("clique no botão").
  if (CONFIRM.includes(s)) return { kind: "confirm" };
  if (CANCEL.includes(s)) return { kind: "cancel" };
  if (any(s, CALIBRATE)) return { kind: "calibrate" };
  if (DOWN.includes(s) || any(s, DOWN.filter((w) => w.includes(" ")))) return { kind: "scroll", dir: "down" };
  if (UP.includes(s) || any(s, UP.filter((w) => w.includes(" ")))) return { kind: "scroll", dir: "up" };
  if (BACK.includes(s)) return { kind: "back" };
  for (const [to, words] of PAGES)
    for (const w of words) if (s === w || GO.some((g) => s === `${g} ${w}` || s === `${w} ${g}` || s === `${w} पर जाओ`)) return { kind: "go", to };
  // "click", "click this", "press Plan it", "इसे दबाओ", "klik ini", "clique em Planejar".
  const words = s.split(" ");
  const clickAt = words.findIndex((w, i) => CLICK.includes(w) || CLICK.includes(`${w} ${words[i + 1] ?? ""}`.trim()));
  if (clickAt >= 0) {
    const rest = words.filter((_, i) => i !== clickAt && !(CLICK.includes(`${words[clickAt]} ${words[clickAt + 1] ?? ""}`) && i === clickAt + 1));
    const PREP = ["on", "the", "em", "no", "na", "को", "पर"];
    // "click this" means the thing looked at; "click Plan it" keeps its own words ("it" is part of the name).
    const words2 = rest.filter((w) => !PREP.includes(w));
    const name = words2.every((w) => THIS.includes(w)) ? "" : words2.join(" ").trim();
    return { kind: "click", name: name || null };
  }
  if (THIS.includes(s)) return { kind: "click", name: null };
  return { kind: "server", text: s };
}

/** Best match for a spoken name among the names of what is on screen (word overlap, then prefix), or null. */
export function matchName(said: string, names: { id: string; name: string }[]): string | null {
  const want = norm(said).split(" ").filter(Boolean);
  if (!want.length) return null;
  let best: { id: string; score: number } | null = null;
  for (const n of names) {
    const have = norm(n.name).split(" ").filter(Boolean);
    if (!have.length) continue;
    const hit = want.filter((w) => have.some((h) => h === w || (w.length >= 4 && h.startsWith(w)))).length;
    const score = hit / Math.max(want.length, 1) + (norm(n.name) === norm(said) ? 1 : 0) - have.length * 0.01;
    if (hit && (!best || score > best.score)) best = { id: n.id, score };
  }
  return best && best.score >= 0.5 ? best.id : null;
}
