// 比較画面で、重ねたまま撃発ポイントを直すための計算（画面から切り離してある）。
// 2 本の撃発ポイントがずれているとき、片方だけを 1 コマずつ動かすか、音の山に合わせて揃える。

import type { LandmarkFrame } from '@pistol-kamae/engine';
import { frameRange, nearestFrameIndex } from '../analysis/frames';
import { binTimeSec, type AudioEnvelope } from '../audio/envelope';

/** 修正中にバーへ出す、撃発の前後の長さ（秒）。「音の山に合わせる」が山を探す範囲も同じ */
export const SHOT_EDIT_SPAN_SEC = 1;

interface Range {
  startSec: number;
  endSec: number;
}

/** 範囲の中で、時刻にいちばん近いコマの時刻 */
function frameTimeInRange(
  frames: ReadonlyArray<LandmarkFrame>,
  index: number,
  range: Range,
): number | null {
  const { first, last } = frameRange(frames, range.startSec, range.endSec);
  return frames[Math.min(Math.max(index, first), last)]?.timeSec ?? null;
}

/** 撃発ポイントを deltaFrames コマ動かした時刻（負＝早く）。切り抜きの範囲の外へは出ない */
export function shiftShot(
  frames: ReadonlyArray<LandmarkFrame>,
  shotSec: number,
  deltaFrames: number,
  clip: Range,
): number {
  const index = nearestFrameIndex(frames, shotSec) + deltaFrames;
  return frameTimeInRange(frames, index, clip) ?? shotSec;
}

/**
 * 「音の山に合わせる」：撃発ポイントの前後 spanSec（切り抜きの範囲の中）で音が最大の時点に、いちばん近いコマの時刻。
 * 動画全体の最大ではなく近くの山を使うのは、隣の射座の発射音のほうが大きいことがあるため。
 * その範囲に音がなければ null
 */
export function peakShot(
  env: AudioEnvelope,
  frames: ReadonlyArray<LandmarkFrame>,
  shotSec: number,
  clip: Range,
  spanSec: number = SHOT_EDIT_SPAN_SEC,
): number | null {
  const from = Math.max(shotSec - spanSec, clip.startSec);
  const to = Math.min(shotSec + spanSec, clip.endSec);
  let best = -1;
  let bestValue = 0;
  for (let i = 0; i < env.values.length; i++) {
    const t = binTimeSec(env, i);
    if (t < from || t > to) continue;
    if (env.values[i]! > bestValue) {
      bestValue = env.values[i]!;
      best = i;
    }
  }
  if (best < 0) return null;
  return frameTimeInRange(frames, nearestFrameIndex(frames, binTimeSec(env, best)), clip);
}

/** 撃発ポイントを何コマ動かしたか（正＝遅く） */
export function shotFrameDelta(
  frames: ReadonlyArray<LandmarkFrame>,
  fromSec: number,
  toSec: number,
): number {
  return nearestFrameIndex(frames, toSec) - nearestFrameIndex(frames, fromSec);
}
