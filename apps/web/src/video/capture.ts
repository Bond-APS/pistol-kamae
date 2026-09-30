// 撃発フレームの静止画を作る。動画本体は保存しないので、ライブラリで開いたときはこの静止画を表示する。

import { frameIndexAt, type Rect } from '@pistol-kamae/engine';
import { seekTimeForFrame } from '../analysis/frames';
import type { AnalysisResult } from '../analysis/runAnalysis';
import type { RecordImages } from '../db/library';
import type { StoredImage } from '../db/schema';
import { THUMB_ASPECT, thumbCrop } from '../library/crop';
import { seekTo } from './seek';

/** 静止画の長い辺の上限（画素）。これより大きい動画は縮めて保存する */
const STILL_MAX_SIDE = 1280;
/** 一覧用の小さい静止画の幅（画素）。表示は 60px 幅なので、高精細な画面でも足りる大きさ */
const THUMB_WIDTH = 180;
const JPEG_QUALITY = 0.85;
/** シークの完了を待つ上限。隠れたタブなどで完了の通知が来ないときに、待ち続けないため */
const SEEK_TIMEOUT_MS = 3000;

function toJpeg(canvas: HTMLCanvasElement): Promise<StoredImage> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('could not encode image'));
          return;
        }
        blob.arrayBuffer().then((bytes) => resolve({ bytes, type: blob.type }), reject);
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

function drawToJpeg(
  video: HTMLVideoElement,
  source: Rect,
  width: number,
  height: number,
): Promise<StoredImage> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('2d context unavailable'));
  ctx.drawImage(
    video,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return toJpeg(canvas);
}

/**
 * 動画を撃発フレームへ移動し、その絵から静止画（全体）と一覧用の小さい静止画（人物を切り抜き）を作る。
 * 動画は撃発フレームを表示したままになる。
 */
export async function captureShotImages(
  video: HTMLVideoElement,
  result: AnalysisResult,
  shotTimeSec: number,
): Promise<RecordImages> {
  const index = frameIndexAt(result.frames, shotTimeSec);
  const frame = result.frames[index];
  if (!frame) throw new Error('shot frame not found');

  video.pause();
  await Promise.race([
    seekTo(video, seekTimeForFrame(result.frames, index, result.fps)),
    new Promise((resolve) => setTimeout(resolve, SEEK_TIMEOUT_MS)),
  ]);

  const size = { width: result.width, height: result.height };
  const whole: Rect = { x: 0, y: 0, ...size };
  const scale = Math.min(1, STILL_MAX_SIDE / Math.max(size.width, size.height));
  const still = await drawToJpeg(video, whole, size.width * scale, size.height * scale);
  const thumb = await drawToJpeg(
    video,
    thumbCrop(frame.landmarks, size),
    THUMB_WIDTH,
    THUMB_WIDTH / THUMB_ASPECT,
  );
  return { still, thumb };
}
