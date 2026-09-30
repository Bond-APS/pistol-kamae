import {
  DEFAULT_VISIBILITY_THRESHOLD,
  isPointUsable,
  LANDMARK_NAMES,
  SKELETON_EDGES,
  type LandmarkFrame,
} from '@pistol-kamae/engine';
import { useEffect, useRef, type RefObject } from 'react';
import { frameIndexAt } from '../analysis/frames';

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
  const lm = frame.landmarks;
  if (!lm) return;
  const scale = Math.max(w, h) / 1000;
  // 計測に使わない点（visibility が低い、または画面の外）は灰色で描く
  const ok = (name: (typeof LANDMARK_NAMES)[number]) =>
    isPointUsable(lm[name], DEFAULT_VISIBILITY_THRESHOLD, { width: w, height: h });

  ctx.lineWidth = 3 * scale;
  for (const [a, b] of SKELETON_EDGES) {
    ctx.strokeStyle = ok(a) && ok(b) ? 'rgba(0, 220, 90, 0.9)' : 'rgba(160, 160, 160, 0.6)';
    ctx.beginPath();
    ctx.moveTo(lm[a].x, lm[a].y);
    ctx.lineTo(lm[b].x, lm[b].y);
    ctx.stroke();
  }
  for (const name of LANDMARK_NAMES) {
    const p = lm[name];
    ctx.fillStyle = ok(name) ? 'rgba(0, 220, 90, 1)' : 'rgba(160, 160, 160, 0.8)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 * scale, 0, Math.PI * 2);
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
