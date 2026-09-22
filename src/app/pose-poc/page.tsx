"use client";

import { useEffect, useRef, useState } from "react";
import {
  DrawingUtils,
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

// Batch 1 proof-of-concept only: validates client-side MediaPipe pose
// extraction + skeleton overlay on an uploaded video. No fps gating, no
// metrics, no persistence — see CLAUDE.md "Batch 1" section.

type Status =
  | { phase: "loading-model" }
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "error"; message: string };

export default function PosePocPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const vfcRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);

  const [status, setStatus] = useState<Status>({ phase: "loading-model" });
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  // Load the pose landmarker model once, client-side (WASM), on mount.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setStatus({ phase: "idle" });
      } catch (err) {
        if (cancelled) return;
        setStatus({
          phase: "error",
          message:
            err instanceof Error
              ? `Failed to load pose model: ${err.message}`
              : "Failed to load pose model.",
        });
      }
    }

    init();
    return () => {
      cancelled = true;
      cancelScheduledFrame();
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    lastVideoTimeRef.current = -1;
    setVideoUrl(URL.createObjectURL(file));
  }

  function handleLoadedMetadata() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  function handlePlay() {
    if (status.phase === "error" || status.phase === "loading-model") return;
    setStatus({ phase: "running" });
    scheduleNextFrame();
  }

  function handlePause() {
    cancelScheduledFrame();
    setStatus((s) => (s.phase === "error" ? s : { phase: "idle" }));
  }

  function cancelScheduledFrame() {
    const video = videoRef.current;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (vfcRef.current !== null && video && "cancelVideoFrameCallback" in video) {
      video.cancelVideoFrameCallback(vfcRef.current);
      vfcRef.current = null;
    }
  }

  // Prefer requestVideoFrameCallback: it fires exactly once per decoded
  // video frame (not once per display refresh), so detection stays in
  // lockstep with the actual frame rate instead of re-running on frames
  // that haven't changed yet — meaningfully faster and smoother than a
  // plain requestAnimationFrame loop.
  function scheduleNextFrame() {
    const video = videoRef.current;
    if (!video) return;
    if ("requestVideoFrameCallback" in video) {
      vfcRef.current = video.requestVideoFrameCallback(onVideoFrame);
    } else {
      rafRef.current = requestAnimationFrame(onVideoFrame);
    }
  }

  function onVideoFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker) return;
    if (video.paused || video.ended) return;

    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      const result = landmarker.detectForVideo(video, performance.now());
      drawResult(canvas, result);
    }

    scheduleNextFrame();
  }

  function drawResult(canvas: HTMLCanvasElement, result: PoseLandmarkerResult) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const drawingUtils = new DrawingUtils(ctx);
    for (const landmarks of result.landmarks) {
      drawingUtils.drawLandmarks(landmarks, {
        radius: 3,
        color: "#B5502E",
      });
      drawingUtils.drawConnectors(
        landmarks,
        PoseLandmarker.POSE_CONNECTIONS,
        { color: "#F2EFE6", lineWidth: 2 }
      );
    }
    ctx.restore();
  }

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>
        Pose landmarker proof of concept
      </h1>
      <p style={{ color: "#666", marginBottom: 16 }}>
        Batch 1 only — upload a test video to check that pose detection and
        skeleton overlay work before anything else gets built.
      </p>

      {status.phase === "loading-model" && <p>Loading pose model…</p>}
      {status.phase === "error" && (
        <p style={{ color: "#B5502E" }}>{status.message}</p>
      )}

      <input
        type="file"
        accept="video/*"
        onChange={handleFileChange}
        disabled={status.phase === "loading-model"}
        style={{ marginBottom: 16, display: "block" }}
      />

      {videoUrl && (
        <div style={{ position: "relative", width: "fit-content" }}>
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={handlePlay}
            onPause={handlePause}
            onEnded={handlePause}
            style={{ display: "block", maxWidth: "100%" }}
          />
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          />
        </div>
      )}
    </main>
  );
}
