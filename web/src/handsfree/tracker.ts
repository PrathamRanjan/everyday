/**
 * A1: the camera, read on this device only. MediaPipe Face Landmarker (Apache-2.0) runs in the browser from files this
 * site serves (/mediapipe/*.wasm, /models/face_landmarker.task); no video frame leaves the device and nothing is
 * recorded. Each frame gives the features in math.ts, whether each eye is closed, and whether a face is there.
 */
import { features, type Vec } from "./math";

export type Frame = { t: number; face: boolean; f: Vec | null; blinkL: number; blinkR: number; fps: number };
export type Tracker = { stop: () => void; video: HTMLVideoElement };

export async function startTracker(onFrame: (fr: Frame) => void): Promise<Tracker> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use a camera here.");
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false });
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  let landmarker: any;
  try {
    const vision = await import("@mediapipe/tasks-vision");
    const files = await vision.FilesetResolver.forVisionTasks("/mediapipe");
    const opts = (delegate: "GPU" | "CPU") => ({ baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate }, runningMode: "VIDEO" as const, numFaces: 1, outputFaceBlendshapes: true });
    landmarker = await vision.FaceLandmarker.createFromOptions(files, opts("GPU")).catch(() => vision.FaceLandmarker.createFromOptions(files, opts("CPU")));
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(`The face tracker didn't load (${(e as Error).message}).`);
  }
  let stopped = false;
  let last = -1;
  let frames = 0;
  let fpsAt = performance.now();
  let fps = 0;
  const loop = () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.currentTime !== last) {
      last = video.currentTime;
      const t = performance.now();
      const r = landmarker.detectForVideo(video, t);
      const lm = r.faceLandmarks?.[0];
      const bs: { categoryName: string; score: number }[] = r.faceBlendshapes?.[0]?.categories ?? [];
      const score = (n: string) => bs.find((c) => c.categoryName === n)?.score ?? 0;
      frames++;
      if (t - fpsAt > 1000) {
        fps = Math.round((frames * 1000) / (t - fpsAt));
        frames = 0;
        fpsAt = t;
      }
      onFrame({ t, face: Boolean(lm), f: lm ? features(lm) : null, blinkL: score("eyeBlinkLeft"), blinkR: score("eyeBlinkRight"), fps });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return {
    video,
    stop: () => {
      stopped = true;
      stream.getTracks().forEach((t) => t.stop());
      try {
        landmarker?.close();
      } catch {
        /* already closed */
      }
    },
  };
}
