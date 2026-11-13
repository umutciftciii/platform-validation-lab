"use client";

import { useMotionValueEvent, type MotionValue } from "motion/react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export type VesselFrameSet = {
  /** Public directory holding 001.webp, 002.webp, ... */
  dir: string;
  count: number;
  /** Native square size of each frame in pixels. */
  size: number;
};

export type VesselMediaSource = {
  poster: string;
  desktop: VesselFrameSet;
  mobile: VesselFrameSet;
};

/**
 * Temporary source: V3 "SH04 - PURE FLOW", cropped square with audio removed.
 * Replace this object when the final render arrives; nothing else has to change.
 */
export const TEMP_VESSEL_MEDIA: VesselMediaSource = {
  poster: "/media/iccsyn-vessel/temp-sh04/poster.webp",
  desktop: { dir: "/media/iccsyn-vessel/temp-sh04/desktop", count: 72, size: 960 },
  mobile: { dir: "/media/iccsyn-vessel/temp-sh04/mobile", count: 48, size: 560 },
};

const MAX_CONCURRENT_LOADS = 6;
const LOAD_START_DELAY_MS = 150;

const frameUrl = (set: VesselFrameSet, index: number) =>
  `${set.dir}/${String(index + 1).padStart(3, "0")}.webp`;

/**
 * First, last, then repeated midpoints. Scrubbing is coarse but works across the
 * whole range almost immediately, and sharpens as the remaining frames arrive.
 */
function loadOrder(count: number): number[] {
  const order = [0, count - 1];
  const seen = new Set(order);
  for (let step = count - 1; step > 1; step = Math.ceil(step / 2)) {
    for (let i = Math.floor(step / 2); i < count; i += step) {
      if (!seen.has(i)) {
        seen.add(i);
        order.push(i);
      }
    }
  }
  for (let i = 0; i < count; i++) if (!seen.has(i)) order.push(i);
  return order;
}

function prefersDataSaving() {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  return Boolean(
    connection?.saveData || connection?.effectiveType?.includes("2g"),
  );
}

type LabVesselMediaProps = {
  /** 0 to 1. Each value maps to one frame of real footage. */
  progress: MotionValue<number>;
  source?: VesselMediaSource;
  variant: "desktop" | "mobile";
  /** False keeps the static poster and downloads no frames. */
  scrub: boolean;
  alt: string;
  sizes: string;
};

/**
 * Plays real footage against scroll. It never simulates the liquid: the canvas
 * only ever shows a decoded frame, and the poster covers it until one is ready.
 */
export function LabVesselMedia({
  progress,
  source = TEMP_VESSEL_MEDIA,
  variant,
  scrub,
  alt,
  sizes,
}: LabVesselMediaProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<(HTMLImageElement | undefined)[]>([]);
  const drawnRef = useRef(-1);
  const [canvasReady, setCanvasReady] = useState(false);
  const set = source[variant];

  const draw = (value: number) => {
    const frames = framesRef.current;
    const context = canvasRef.current?.getContext("2d");
    if (!context || frames.length === 0) return;

    const target = Math.round(Math.min(1, Math.max(0, value)) * (set.count - 1));
    // Nearest decoded frame, so a fast scroll never shows an empty canvas.
    for (let offset = 0; offset < set.count; offset++) {
      const index = [target - offset, target + offset].find(
        (candidate) => frames[candidate],
      );
      if (index === undefined) continue;
      if (index !== drawnRef.current) {
        context.drawImage(frames[index] as HTMLImageElement, 0, 0, set.size, set.size);
        drawnRef.current = index;
      }
      return;
    }
  };

  useMotionValueEvent(progress, "change", draw);

  useEffect(() => {
    if (!scrub || prefersDataSaving()) return;

    let cancelled = false;
    const frames: (HTMLImageElement | undefined)[] = new Array(set.count);
    framesRef.current = frames;
    drawnRef.current = -1;

    const queue = loadOrder(set.count);
    const worker = async () => {
      while (!cancelled && queue.length > 0) {
        const index = queue.shift() as number;
        const image = new window.Image();
        image.src = frameUrl(set, index);
        try {
          await image.decode();
        } catch {
          continue; // A missing frame falls back to its nearest neighbour.
        }
        if (cancelled) return;
        frames[index] = image;
        draw(progress.get());
        if (drawnRef.current !== -1) setCanvasReady(true);
      }
    };

    // Deferred past hydration. The server renders the desktop layout, so starting
    // now would make a phone download desktop frames before it switches variant.
    const startTimer = window.setTimeout(() => {
      for (let i = 0; i < MAX_CONCURRENT_LOADS; i++) void worker();
    }, LOAD_START_DELAY_MS);

    return () => {
      window.clearTimeout(startTimer);
      cancelled = true;
      framesRef.current = [];
      setCanvasReady(false);
    };
    // `draw` only reads refs and `set`, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrub, set, progress]);

  return (
    <div role="img" aria-label={alt} className="vessel-mask relative h-full w-full">
      <Image
        src={source.poster}
        alt=""
        fill
        sizes={sizes}
        draggable={false}
        className={`object-cover ${canvasReady ? "invisible" : ""}`}
      />
      {scrub && (
        <canvas
          ref={canvasRef}
          width={set.size}
          height={set.size}
          aria-hidden
          className="absolute inset-0 h-full w-full"
        />
      )}
    </div>
  );
}
