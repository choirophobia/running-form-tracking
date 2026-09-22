// Batch 2: client-side fps detection + tiered confidence gate, per PRD
// Section 5. Runs entirely in the browser, before a video enters the pose
// pipeline — no network round-trip, no server involved.
//
// mediainfo.js is loaded as an ESM module straight from jsdelivr at
// runtime (not as an npm dependency): its published package resolves, via
// the "module"/"import" export conditions, to a build whose emscripten
// glue does `new URL('MediaInfoModule.wasm', import.meta.url)` to locate
// the wasm binary — Turbopack statically analyzes that as a bundled asset
// reference and fails, because the .wasm file doesn't sit next to that
// particular build's JS inside node_modules. Loading the same file from
// its real CDN URL sidesteps the bundler entirely (mirrors the CDN-loaded
// MediaPipe model in the Batch 1 PoC).
//
// The wasm binary itself is published only at dist/MediaInfoModule.wasm,
// not next to dist/esm-bundle/index.js — its default `import.meta.url`
// relative lookup would 404 (verified against the actual CDN paths), so
// `locateFile` is required to point it at the right URL explicitly.
const MEDIAINFO_DIST_BASE = "https://cdn.jsdelivr.net/npm/mediainfo.js@0.3.8/dist/";
const MEDIAINFO_ESM_BUNDLE_URL = `${MEDIAINFO_DIST_BASE}esm-bundle/index.js`;

export type FpsDetectionMethod = "metadata" | "frame-count";
export type FpsTier = "full" | "reduced" | "blocked";

export interface FpsDetectionResult {
  fps: number;
  method: FpsDetectionMethod;
  tier: FpsTier;
}

const MIN_PLAUSIBLE_FPS = 15;
const MAX_PLAUSIBLE_FPS = 480;
const FULL_CONFIDENCE_FPS = 120;
const REDUCED_CONFIDENCE_FPS = 60;
const FRAME_COUNT_SAMPLE_SECONDS = 2;

// Minimal shape of what we read from mediainfo.js's result — not the full
// published type (see the CDN-loading note above for why we don't import
// its package types either).
interface MediaInfoTrack {
  readonly "@type": string;
  readonly FrameRate?: number;
}
interface MediaInfoAnalyzeResult {
  readonly media?: { readonly track: readonly MediaInfoTrack[] };
}
interface MediaInfoInstance {
  analyzeData(
    getSize: () => number,
    readChunk: (chunkSize: number, offset: number) => Promise<Uint8Array>
  ): Promise<MediaInfoAnalyzeResult>;
  close(): void;
}
type MediaInfoFactory = (options?: {
  format?: string;
  locateFile?: (path: string) => string;
}) => Promise<MediaInfoInstance>;

let mediaInfoFactoryPromise: Promise<MediaInfoFactory> | null = null;

function loadMediaInfoFactory(): Promise<MediaInfoFactory> {
  if (!mediaInfoFactoryPromise) {
    // MEDIAINFO_ESM_BUNDLE_URL is a variable, not an inline literal, so the
    // bundler can't statically resolve this specifier — it stays a plain
    // runtime browser import of the CDN URL.
    mediaInfoFactoryPromise = import(MEDIAINFO_ESM_BUNDLE_URL).then(
      (mod) => mod.default as MediaInfoFactory
    );
  }
  return mediaInfoFactoryPromise;
}

function isPlausibleFps(fps: number): boolean {
  return Number.isFinite(fps) && fps >= MIN_PLAUSIBLE_FPS && fps <= MAX_PLAUSIBLE_FPS;
}

// reducedConfidenceFps defaults to the real PRD Section 5 threshold (60fps).
// The only caller that should ever pass an override is a dev/test affordance
// on the pose-poc page — the shipped gate always uses the default.
export function classifyFpsTier(
  fps: number,
  reducedConfidenceFps: number = REDUCED_CONFIDENCE_FPS
): FpsTier {
  if (fps >= FULL_CONFIDENCE_FPS) return "full";
  if (fps >= reducedConfidenceFps) return "reduced";
  return "blocked";
}

/**
 * Primary method: read the encoded frame rate straight from the container
 * metadata (fast — only the header is parsed, not the full file). Returns
 * null if there's no video track or no frame rate field to read.
 */
async function detectFpsFromMetadata(file: File): Promise<number | null> {
  const mediaInfoFactory = await loadMediaInfoFactory();
  const mediainfo = await mediaInfoFactory({
    format: "object",
    locateFile: (path) => `${MEDIAINFO_DIST_BASE}${path}`,
  });

  try {
    const result = await mediainfo.analyzeData(
      () => file.size,
      (chunkSize, offset) =>
        file
          .slice(offset, offset + chunkSize)
          .arrayBuffer()
          .then((buffer) => new Uint8Array(buffer))
    );

    const videoTrack = result.media?.track.find((track) => track["@type"] === "Video");
    const fps = videoTrack?.FrameRate;
    return typeof fps === "number" ? fps : null;
  } finally {
    mediainfo.close();
  }
}

/**
 * Fallback method: decode the first ~2s of the video and count actual
 * frame callbacks. Used when metadata is missing, malformed, or reports an
 * implausible value — some phone exports mis-report fps in the header.
 */
function detectFpsByFrameCounting(
  file: File,
  sampleSeconds = FRAME_COUNT_SAMPLE_SECONDS
): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    let firstMediaTime: number | null = null;
    let lastMediaTime = 0;
    let frameCount = 0;
    let settled = false;

    function cleanup() {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
    }

    function finish(fps: number) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(fps);
    }

    function fail(err: unknown) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    }

    function onFrame(_now: number, metadata: VideoFrameCallbackMetadata) {
      if (settled) return;
      if (firstMediaTime === null) firstMediaTime = metadata.mediaTime;
      lastMediaTime = metadata.mediaTime;
      frameCount++;

      const elapsed = lastMediaTime - firstMediaTime;
      if (elapsed >= sampleSeconds || video.ended) {
        if (elapsed > 0 && frameCount > 1) {
          finish((frameCount - 1) / elapsed);
        } else {
          fail(new Error("Could not capture enough frames to estimate frame rate."));
        }
        return;
      }
      video.requestVideoFrameCallback(onFrame);
    }

    video.addEventListener("loadedmetadata", () => {
      if (!("requestVideoFrameCallback" in video)) {
        fail(new Error("requestVideoFrameCallback is not supported in this browser."));
        return;
      }
      video.requestVideoFrameCallback(onFrame);
      video.play().catch(fail);
    });
    video.addEventListener("error", () =>
      fail(new Error("Could not load video for frame counting."))
    );
  });
}

/**
 * Detects a video file's frame rate client-side: container metadata first,
 * falling back to empirical frame counting if metadata is missing,
 * malformed, or outside a plausible range (~15-480fps). Classifies the
 * result into the tiered confidence gate from PRD Section 5.
 */
export async function detectFps(file: File): Promise<FpsDetectionResult> {
  let fps: number | null = null;
  let method: FpsDetectionMethod = "metadata";

  try {
    fps = await detectFpsFromMetadata(file);
  } catch {
    fps = null;
  }

  if (fps === null || !isPlausibleFps(fps)) {
    fps = await detectFpsByFrameCounting(file);
    method = "frame-count";
  }

  return { fps, method, tier: classifyFpsTier(fps) };
}
