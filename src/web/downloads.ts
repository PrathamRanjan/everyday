/**
 * C3: the browser extension as a .zip to download (the extension/ folder of this repository, as it is). Built once in
 * memory on first request: a plain ZIP writer (deflate from zlib, CRC-32), no extra package.
 */
import { Router } from "express";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../extension");
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir).sort()) {
    if (f.startsWith(".") || f === "node_modules") continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else out.push(p);
  }
  return out;
}

export function zipFolder(dir: string, prefix: string): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const p of files(dir)) {
    const name = Buffer.from(`${prefix}/${relative(dir, p).split("\\").join("/")}`);
    const data = readFileSync(p);
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8 names
    h.writeUInt16LE(8, 8); // deflate
    h.writeUInt32LE(0, 10); // time/date: 1980-01-01, so the zip is the same each build
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(comp.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(name.length, 26);
    locals.push(h, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(0, 12);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    centrals.push(c, name);
    offset += h.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const n = centrals.length / 2;
  end.writeUInt16LE(n, 8);
  end.writeUInt16LE(n, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

let cached: Buffer | null = null;
export function downloadRoutes() {
  const r = Router();
  r.get("/downloads/everyday-extension.zip", (_req, res) => {
    cached ??= zipFolder(root, "everyday-extension");
    res.set({ "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="everyday-extension.zip"', "Cache-Control": "public, max-age=3600" }).send(cached);
  });
  return r;
}
