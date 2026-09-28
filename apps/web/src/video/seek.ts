// HTML video のシークは厳密にフレーム単位ではない（CLAUDE.md 5 章）。
// 目的の時刻へ移動したあと「本当に表示されたフレーム」を見分けるために、二段構えにする。
//  1. requestVideoFrameCallback（表示されたフレームの媒体時刻を教えてくれる機能）が
//     使えるブラウザでは、その時刻を使う。シークの前に登録しないと取りこぼす。
//  2. 使えない・呼ばれない場合（未対応ブラウザ、ページが非表示のとき）は、フレームを
//     小さな画像に縮めて前のフレームと見比べ、「絵が変わったか」で新しいフレームと判定する。

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: { mediaTime: number }) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function hasFrameCallback(video: HTMLVideoElement): boolean {
  return typeof (video as VideoWithFrameCallback).requestVideoFrameCallback === 'function';
}

export interface SeekResult {
  /** 表示されたフレームの媒体時刻（秒）。取れなければシーク先の時刻 */
  timeSec: number;
  /** requestVideoFrameCallback から得た正確な時刻かどうか */
  exact: boolean;
}

/**
 * 指定時刻へシークし、表示されたフレームの時刻を返す。
 * @param settleMs seeked の後、フレーム時刻の通知を待つ上限（ミリ秒）
 */
export function seekTo(
  video: HTMLVideoElement,
  timeSec: number,
  settleMs = 60,
): Promise<SeekResult> {
  const v = video as VideoWithFrameCallback;
  return new Promise((resolve, reject) => {
    let seeked = false;
    let done = false;
    let handle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: SeekResult) => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      if (handle !== undefined) v.cancelVideoFrameCallback?.(handle);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      resolve(result);
    };
    const onSeeked = () => {
      seeked = true;
      // フレーム時刻の通知が少し遅れて来ることがあるので、短い猶予を置く
      timer = setTimeout(() => finish({ timeSec: video.currentTime, exact: false }), settleMs);
    };
    const onError = () => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', onSeeked);
      reject(new Error('video error during seek'));
    };

    if (v.requestVideoFrameCallback) {
      const onFrame = (_: number, meta: { mediaTime: number }) => {
        // シーク完了前の通知は古いフレームなので読み飛ばす
        if (!seeked) {
          handle = v.requestVideoFrameCallback!(onFrame);
          return;
        }
        finish({ timeSec: meta.mediaTime, exact: true });
      };
      handle = v.requestVideoFrameCallback(onFrame);
    }
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = timeSec;
  });
}

/**
 * 連続してシークするときの待ち時間を調整する。
 * 最初の数回でフレーム時刻の通知が一度も来なければ（未対応・非表示）、以後は待たない。
 */
export class SeekSession {
  private exactSeen = false;
  private attempts = 0;
  private readonly probeCount = 5;
  private readonly settleMs = 60;

  seek(video: HTMLVideoElement, timeSec: number): Promise<SeekResult> {
    const settle = this.exactSeen || this.attempts < this.probeCount ? this.settleMs : 0;
    this.attempts++;
    return seekTo(video, timeSec, settle).then((r) => {
      if (r.exact) this.exactSeen = true;
      return r;
    });
  }
}

/** フレームの「絵」を 64×64 画素に縮めた指紋。fps 推定で前のフレームと同じかどうかの判定に使う */
export class FrameSignature {
  private readonly size = 64;
  private readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  private readonly ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

  constructor() {
    this.canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(this.size, this.size)
        : document.createElement('canvas');
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as
      OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
  }

  of(video: HTMLVideoElement): Uint8ClampedArray {
    this.ctx.drawImage(video, 0, 0, this.size, this.size);
    return this.ctx.getImageData(0, 0, this.size, this.size).data;
  }

  static same(a: Uint8ClampedArray | null, b: Uint8ClampedArray): boolean {
    if (!a || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
}

const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120];

/** よくある fps に十分近ければそれに丸める（誤差 5% 以内） */
export function snapFrameRate(fps: number): number {
  let best = fps;
  let bestErr = Infinity;
  for (const c of COMMON_FPS) {
    const err = Math.abs(fps - c) / c;
    if (err < bestErr) {
      bestErr = err;
      best = c;
    }
  }
  return bestErr <= 0.05 ? best : fps;
}

/**
 * フレームレートを推定する。HTML video は fps を教えてくれないので、
 * 先頭 0.5 秒を 1/120 秒刻みでシークし、絵が変わった回数を数える。
 * 判定できなければ null（呼び出し側で既定値を使う）。
 */
export async function estimateFrameRate(video: HTMLVideoElement): Promise<number | null> {
  const span = Math.min(0.5, video.duration);
  if (!(span > 0)) return null;
  const step = 1 / 120;
  const sig = new FrameSignature();
  const session = new SeekSession();
  const exactTimes = new Set<number>();
  let prev: Uint8ClampedArray | null = null;
  let distinct = 0;
  let allExact = true;

  for (let t = 0; t < span; t += step) {
    const r = await session.seek(video, t);
    if (r.exact) exactTimes.add(Math.round(r.timeSec * 1e4));
    else allExact = false;
    const s = sig.of(video);
    if (!FrameSignature.same(prev, s)) distinct++;
    prev = s;
  }

  // 正確な時刻が全部そろっていればそれを優先する
  const count = allExact && exactTimes.size >= 2 ? exactTimes.size : distinct;
  if (count < 2) return null;
  const fps = count / span;
  return Number.isFinite(fps) && fps > 0 ? snapFrameRate(fps) : null;
}
