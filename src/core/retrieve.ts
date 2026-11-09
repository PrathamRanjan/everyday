/**
 * Hybrid retrieval. Pure. BM25 over product text (literal and model-number matches) plus a hashed character-trigram
 * TF-IDF vector (fuzzy and misspelt matches), combined by reciprocal rank fusion.
 */
export interface Doc {
  id: string;
  text: string; // title, brand, model, category, attributes
  model?: string;
}

const SYN: Record<string, string> = { light: "lamp", lamps: "lamp", lighting: "lamp", seat: "chair", stool: "chair", hub: "dock", adapter: "dock", adaptor: "dock", docking: "dock", screen: "monitor", display: "monitor", keyboards: "keyboard", mice: "mouse", arm: "monitor_arm", mount: "monitor_arm", mat: "desk_mat", headset: "headphones", cam: "webcam" };
const STOP = new Set(["a", "an", "the", "and", "or", "for", "with", "of", "to", "in", "on", "my", "i", "me", "need", "want", "like", "this", "that", "some", "please", "inch"]);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/["“”]/g, " ")
    .split(/[^a-z0-9-]+/)
    .flatMap((t) => (t.includes("-") ? [t, ...t.split("-")] : [t]))
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t))
    .map((t) => SYN[t] ?? t);
}

export class BM25 {
  private df = new Map<string, number>();
  private tf: Map<string, number>[] = [];
  private len: number[] = [];
  private avg = 0;
  constructor(private docs: Doc[], private k1 = 1.2, private b = 0.75) {
    for (const d of docs) {
      const t = tokens(d.text);
      const m = new Map<string, number>();
      for (const x of t) m.set(x, (m.get(x) ?? 0) + 1);
      for (const x of m.keys()) this.df.set(x, (this.df.get(x) ?? 0) + 1);
      this.tf.push(m);
      this.len.push(t.length);
    }
    this.avg = this.len.reduce((a, b) => a + b, 0) / Math.max(1, docs.length);
  }
  search(query: string): { id: string; score: number }[] {
    const q = [...new Set(tokens(query))];
    const N = this.docs.length;
    const out: { id: string; score: number }[] = [];
    this.docs.forEach((d, i) => {
      let s = 0;
      for (const t of q) {
        const f = this.tf[i].get(t);
        if (!f) continue;
        const idf = Math.log(1 + (N - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
        s += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.len[i]) / this.avg));
      }
      // Exact model number in the query gets a strong literal boost.
      if (d.model && query.toLowerCase().includes(d.model.toLowerCase())) s += 10;
      if (s > 0) out.push({ id: d.id, score: s });
    });
    return out.sort((a, b) => b.score - a.score);
  }
}

const DIM = 2048;
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % DIM;
}
function grams(s: string): string[] {
  const t = ` ${s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `;
  const out: string[] = [];
  for (let i = 0; i + 3 <= t.length; i++) out.push(t.slice(i, i + 3));
  return out;
}

/** Hashed trigram TF-IDF vectors with cosine similarity (fuzzy, typo-tolerant; not a learned embedding). */
export class TrigramIndex {
  private idf = new Float64Array(DIM);
  private vecs: Float64Array[] = [];
  constructor(private docs: Doc[]) {
    const df = new Float64Array(DIM);
    const raw = docs.map((d) => {
      const v = new Float64Array(DIM);
      for (const g of grams(d.text)) v[hash(g)] += 1;
      for (let i = 0; i < DIM; i++) if (v[i]) df[i] += 1;
      return v;
    });
    for (let i = 0; i < DIM; i++) this.idf[i] = Math.log((1 + docs.length) / (1 + df[i])) + 1;
    this.vecs = raw.map((v) => this.norm(v));
  }
  private norm(v: Float64Array) {
    let n = 0;
    for (let i = 0; i < DIM; i++) {
      v[i] = v[i] * this.idf[i];
      n += v[i] * v[i];
    }
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < DIM; i++) v[i] /= n;
    return v;
  }
  search(query: string): { id: string; score: number }[] {
    const q = new Float64Array(DIM);
    for (const g of grams(query)) q[hash(g)] += 1;
    const qv = this.norm(q);
    return this.docs.map((d, i) => {
      let s = 0;
      const v = this.vecs[i];
      for (let k = 0; k < DIM; k++) if (qv[k]) s += qv[k] * v[k];
      return { id: d.id, score: s };
    }).filter((x) => x.score > 0.05).sort((a, b) => b.score - a.score);
  }
}

/** Reciprocal rank fusion. */
export function rrf(lists: { id: string }[][], k = 60): { id: string; score: number }[] {
  const s = new Map<string, number>();
  for (const l of lists) l.forEach((x, i) => s.set(x.id, (s.get(x.id) ?? 0) + 1 / (k + i + 1)));
  return [...s].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

export function hybrid(docs: Doc[]) {
  const bm = new BM25(docs);
  const tri = new TrigramIndex(docs);
  return {
    bm25: (q: string) => bm.search(q),
    trigram: (q: string) => tri.search(q),
    fused: (q: string, n = 30) => rrf([bm.search(q).slice(0, 50), tri.search(q).slice(0, 50)]).slice(0, n),
  };
}
