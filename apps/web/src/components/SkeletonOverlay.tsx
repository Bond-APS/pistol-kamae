import type { LandmarkFrame } from '@pistol-kamae/engine';
import { useEffect, useRef, type RefObject } from 'react';
import { frameIndexAt } from '../analysis/frames';
import { SKELETON_COLORS, SKELETON_SIZES, skeletonParts } from './skeleton';

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  frames: LandmarkFrame[];
  width: number;
  height: number;
  /** 現在のフレーム番号が変わったときに知らせる */
  onFrameIndex?: (index: number) => void;
}

function draw(ctx: CanvasRenderingContext2D, frame: LandmarkFrame, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  if (!frame.landmarks) return;
  const scale = Math.max(w, h) / 1000;
  const { edges, points } = skeletonParts(frame.landmarks, { width: w, height: h });
  const color = (usable: boolean) => (usable ? SKELETON_COLORS.usable : SKELETON_COLORS.unusable);

  ctx.lineCap = 'round';
  // 縁取りを先にすべて描き、その上に色の線を重ねる
  for (const pass of ['outline', 'line'] as const) {
    ctx.lineWidth = SKELETON_SIZES[pass] * scale;
    for (const e of edges) {
      ctx.strokeStyle = pass === 'outline' ? SKELETON_COLORS.outline : color(e.usable);
      ctx.beginPath();
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
      ctx.stroke();
    }
  }
  for (const { p, usable } of points) {
    ctx.fillStyle = SKELETON_COLORS.outline;
    ctx.beginPath();
    ctx.arc(p.x, p.y, SKELETON_SIZES.dotOutline * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color(usable);
    ctx.beginPath();
    ctx.arc(p.x, p.y, SKELETON_SIZES.dot * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 動画の上に骨格を重ね描きする canvas。動画と同じ画素サイズにして座標をそのまま使う。 */
export function SkeletonOverlay({ videoRef, frames, width, height, onFrameIndex }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let lastIndex = -2;
    const tick = () => {
      const index = frameIndexAt(frames, video.currentTime);
      if (index !== lastIndex) {
        lastIndex = index;
        const frame = frames[index];
        if (frame) draw(ctx, frame, width, height);
        else ctx.clearRect(0, 0, width, height);
        onFrameIndex?.(index);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, frames, width, height, onFrameIndex]);

  return <canvas ref={canvasRef} className="overlay" width={width} height={height} />;
}
