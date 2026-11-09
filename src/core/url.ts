/** Normalizes Reel / TikTok / Shorts / YouTube links to platform:id so a repeat share reuses one capture. */
export interface Link {
  platform: "instagram" | "tiktok" | "youtube" | "web";
  id: string;
  canonical: string;
  short_link: boolean; // needs resolving before the id is known (vm.tiktok.com)
}

export function normalizeLink(raw: string): Link | null {
  let u: URL;
  try {
    u = new URL(raw.trim().replace(/^(?!https?:\/\/)/, "https://"));
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, "").toLowerCase();
  const path = u.pathname.replace(/\/+$/, "");
  let m: RegExpMatchArray | null;
  if (host === "instagram.com" && (m = path.match(/^\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/))) return { platform: "instagram", id: m[1], canonical: `https://www.instagram.com/reel/${m[1]}/`, short_link: false };
  if (host === "tiktok.com" && (m = path.match(/^\/@[^/]+\/video\/(\d+)/))) return { platform: "tiktok", id: m[1], canonical: `https://www.tiktok.com/video/${m[1]}`, short_link: false };
  if ((host === "vm.tiktok.com" || host === "vt.tiktok.com") && (m = path.match(/^\/([A-Za-z0-9]+)/))) return { platform: "tiktok", id: `short:${m[1]}`, canonical: `https://${host}/${m[1]}/`, short_link: true };
  if ((host === "youtube.com" || host === "music.youtube.com") && (m = path.match(/^\/shorts\/([A-Za-z0-9_-]{6,})/))) return { platform: "youtube", id: m[1], canonical: `https://youtube.com/shorts/${m[1]}`, short_link: false };
  if (host === "youtube.com" && path === "/watch" && u.searchParams.get("v")) return { platform: "youtube", id: u.searchParams.get("v")!, canonical: `https://youtube.com/shorts/${u.searchParams.get("v")}`, short_link: false };
  if (host === "youtu.be" && (m = path.match(/^\/([A-Za-z0-9_-]{6,})/))) return { platform: "youtube", id: m[1], canonical: `https://youtube.com/shorts/${m[1]}`, short_link: false };
  if (!/\./.test(host)) return null;
  return { platform: "web", id: `${host}${path}`, canonical: `https://${host}${path}`, short_link: false };
}

export const findLinks = (text: string) => [...text.matchAll(/https?:\/\/\S+|(?:www\.)?(?:instagram\.com|tiktok\.com|vm\.tiktok\.com|youtube\.com|youtu\.be)\/\S+/gi)].map((m) => m[0].replace(/[),.!?]+$/, ""));
