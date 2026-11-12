// A1.4: the face tracker runs in the browser from files this site serves itself (no CDN, works offline once cached).
// Copies MediaPipe's WebAssembly runtime (Apache-2.0) from node_modules into public/mediapipe before each build.
import { copyFileSync, mkdirSync } from "node:fs";
const from = "node_modules/@mediapipe/tasks-vision/wasm";
mkdirSync("public/mediapipe", { recursive: true });
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) copyFileSync(`${from}/${f}`, `public/mediapipe/${f}`);
console.log("MediaPipe runtime copied to public/mediapipe");
