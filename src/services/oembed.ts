/**
 * Public cover of a shared video. YouTube and TikTok publish an oEmbed record for any public video: its title, the
 * creator's name and a cover image. Everyday fetches that record (no key, no scraping, no video frames) and lets the
 * vision reader name the products on the cover. The basis says exactly that: the cover and title, not the video.
 *
 * Only the platforms' own oEmbed endpoints are called, and the cover is fetched only from the platforms' image hosts,
 * with a size cap and a timeout, so a shared link can't make the server fetch an arbitrary address.
 */
import type { Link } from "../core/url.js";

export interface Cover {
  title: string;
  author: string | null;
  image: { mime: string; body: Buffer } | null;
}

const IMAGE_HOSTS = [/(^|\.)ytimg\.com$/i, /(^|\.)tiktokcdn(-[a-z]+)?\.com$/i, /(^|\.)ibyteimg\.com$/i, /(^|\.)tiktokv\.com$/i];
const MAX_IMAGE = 4 * 1024 * 1024;

let fetchImpl: typeof fetch = (i, init) => fetch(i, init);
/** Tests replace the network. */
export function setOembedFetch(f: typeof fetch | null) {
  fetchImpl = f ?? ((i, init) => fetch(i, init));
}

function endpointFor(link: Link): string | null {
  if (link.platform === "youtube") return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${link.id}`)}`;
  if (link.platform === "tiktok" && !link.short_link) return `https://www.tiktok.com/oembed?url=${encodeURIComponent(link.canonical)}`;
  return null;
}

async function get(url: string, ms: number) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetchImpl(url, { signal: ctl.signal, headers: { "user-agent": "Everyday/1.0 (+oembed)" }, redirect: "error" });
  } finally {
    clearTimeout(t);
  }
}

/** The public title and cover of a YouTube or TikTok video, or null when the platform has none (private, removed, other site). */
export async function coverOf(link: Link): Promise<Cover | null> {
  const endpoint = endpointFor(link);
  if (!endpoint) return null;
  try {
    const r = await get(endpoint, 6000);
    if (!r.ok) return null;
    const meta = (await r.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    const title = String(meta.title ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (!title && !meta.thumbnail_url) return null;
    let image: Cover["image"] = null;
    if (meta.thumbnail_url) {
      let u: URL | null = null;
      try {
        u = new URL(meta.thumbnail_url);
      } catch {
        u = null;
      }
      if (u && u.protocol === "https:" && IMAGE_HOSTS.some((re) => re.test(u!.hostname))) {
        const ir = await get(u.toString(), 8000);
        const mime = (ir.headers.get("content-type") ?? "").split(";")[0].trim();
        const len = Number(ir.headers.get("content-length") ?? 0);
        if (ir.ok && /^image\/(jpeg|png|webp)$/.test(mime) && len <= MAX_IMAGE) {
          const body = Buffer.from(await ir.arrayBuffer());
          if (body.length <= MAX_IMAGE) image = { mime, body };
        }
      }
    }
    return { title, author: meta.author_name ? String(meta.author_name).slice(0, 80) : null, image };
  } catch {
    return null;
  }
}
