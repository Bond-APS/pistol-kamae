// 撃発フレームの静止画を作る。一覧の小さい写真と、動画本体のない記録の表示に使う。

import { frameIndexAt, type LandmarkFrame, type Rect } from '@pistol-kamae/engine';
import { seekTimeForFrame } from '../analysis/frames';
import type { RecordImages } from '../db/library';
import type { StoredImage } from '../db/schema';
import { THUMB_ASPECT, thumbCrop } from '../library/crop';
import { seekTo } from './seek';

/** 静止画の長い辺の上限（画素）。これより大きい動画は縮めて保存する */
const STILL_MAX_SIDE = 1280;
/** 一覧用の小さい静止画の幅（画素）。表示は 60px 幅なので、高精細な画面でも足りる大きさ */
const THUMB_WIDTH = 180;
const JPEG_QUALITY = 0.85;
/** シークの完了を待つ上限。隠れたタブなどで完了の通知が来ないときに、待ち続けないため。過ぎたら失敗にする */
const SEEK_TIMEOUT_MS = 3000;
/** 表示されたコマの時刻と、記録したコマの時刻のずれの許容（秒）。Chrome では通知の時刻が記録と 1 ミリ秒ほど違うことがある */
const FRAME_TIME_TOLERANCE_SEC = 0.004;
/**
 * シークのあと、表示されたコマの通知を待つ猶予（ミリ秒）。通知が来れば待たずに進む。
 * 解析の 60 ミリ秒より長くするのは、通知が少し遅れただけで照合（狙ったコマが出ているか）が抜けないように
 */
const FRAME_NOTICE_SETTLE_MS = 200;

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
 * 撃発フレームの絵が出ていると確かめられないとき（シークの時間切れ、絵が読めていない、別のコマが出ている）は
 * 失敗にする。そのとき出ている絵を撮ると、撃発ポイントと骨格は正しいのに写真だけ別のコマ、という記録を
 * 黙って作ってしまうため。呼び出し側は失敗を案内し、もう一度押してもらう
 */
export async function captureShotImages(
  video: HTMLVideoElement,
  result: { frames: LandmarkFrame[]; width: number; height: number; fps: number },
  shotTimeSec: number,
): Promise<RecordImages> {
  const index = frameIndexAt(result.frames, shotTimeSec);
  const frame = result.frames[index];
  if (!frame) throw new Error('shot frame not found');

  video.pause();
  const seek = await seekTo(video, seekTimeForFrame(result.frames, index, result.fps), {
    settleMs: FRAME_NOTICE_SETTLE_MS,
    timeoutMs: SEEK_TIMEOUT_MS,
  });
  if (video.readyState < 2) throw new Error('video frame not available');
  // 表示されたコマの時刻が取れたとき（実際にシークが起きて新しいコマが出たとき）は、狙ったコマが出ている
  // ことを確かめ、画面側のシークなどで別のコマが出ていたら失敗にする。すでにそのコマが出ていてシークが
  // 省略されたときは通知が来ないので、確かめずに撮る（出ているのはそのコマ）。
  // 照合は「記録したコマの区間 [このコマの時刻, 次のコマの時刻) に入っているか」。記録にない実コマが間に
  // ある動画（コマの間隔が一定でないなど）でも、同じ区間なら同じ絵とみなす
  const next = result.frames[index + 1];
  const shownSec = seek.timeSec;
  const inFrame =
    shownSec >= frame.timeSec - FRAME_TIME_TOLERANCE_SEC &&
    (!next || shownSec < next.timeSec - FRAME_TIME_TOLERANCE_SEC);
  if (seek.exact && !inFrame) throw new Error('a different frame is displayed');

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
