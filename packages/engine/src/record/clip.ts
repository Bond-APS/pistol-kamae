// 切り抜きの範囲（段階⑤）。動画ファイルは丸ごと保存し、「使う範囲」だけを記録に持つ。
// 範囲の外は、長さの表示・バー・再生のすべてで「存在しない」ものとして扱う。
// ブラウザの中で動画ファイルを切って作り直す（再エンコード）のは v1 ではやらない。

/** 切り抜きの範囲（元の動画の媒体時刻、秒）。範囲なし（全体）は記録側で null で表す */
export interface Clip {
  startSec: number;
  endSec: number;
}

export type ClipProblem = 'invalidClip' | 'shotOutsideClip';

/** 範囲を返す。範囲なし（null）なら動画の全体 */
export function clipOf(clip: Clip | null, durationSec: number): Clip {
  return clip ?? { startSec: 0, endSec: durationSec };
}

/** 切り抜いたあとの長さ（秒） */
export function clipDurationSec(clip: Clip | null, durationSec: number): number {
  const c = clipOf(clip, durationSec);
  return c.endSec - c.startSec;
}

/** その時刻が範囲の中か（両端を含む） */
export function clipContains(clip: Clip | null, durationSec: number, timeSec: number): boolean {
  const c = clipOf(clip, durationSec);
  return timeSec >= c.startSec && timeSec <= c.endSec;
}

/**
 * 範囲の検査。開始は 0 以上、終了は動画の長さ以下、開始＜終了であること。
 * 撃発ポイントの時刻を渡したときは、それが範囲の中にあることも調べる
 * （比較は撃発ポイントで揃えるので、範囲の外に撃発があると揃えられない）。
 */
export function checkClip(
  clip: Clip | null,
  durationSec: number,
  shotSec?: number,
): ClipProblem | null {
  if (clip !== null) {
    const { startSec, endSec } = clip;
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return 'invalidClip';
    if (startSec < 0 || endSec > durationSec || startSec >= endSec) return 'invalidClip';
  }
  if (shotSec !== undefined && !clipContains(clip, durationSec, shotSec)) return 'shotOutsideClip';
  return null;
}

/** 1 本の動画の、撃発ポイントを 0 とした前後の長さ（秒） */
export interface ShotWindow {
  /** 撃発より前に使える長さ（範囲の開始 → 撃発） */
  beforeSec: number;
  /** 撃発より後に使える長さ（撃発 → 範囲の終了） */
  afterSec: number;
}

export function shotWindow(clip: Clip | null, durationSec: number, shotSec: number): ShotWindow {
  const c = clipOf(clip, durationSec);
  return { beforeSec: shotSec - c.startSec, afterSec: c.endSec - shotSec };
}

/**
 * 2 本に共通する区間。撃発ポイントを 0 として、前も後も短い方に合わせる（時間の伸縮はしない）。
 * 比較画面の 1 本のバーはこの区間を動き、繰り返し再生もこの区間を回る。
 */
export function commonWindow(a: ShotWindow, b: ShotWindow): ShotWindow {
  return {
    beforeSec: Math.max(Math.min(a.beforeSec, b.beforeSec), 0),
    afterSec: Math.max(Math.min(a.afterSec, b.afterSec), 0),
  };
}
