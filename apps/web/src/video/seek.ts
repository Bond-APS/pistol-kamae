// HTML video のシークは厳密にフレーム単位ではない（CLAUDE.md 5 章）。
// 目的の時刻へ移動したあと「本当に表示されたフレーム」を見分けるために、二段構えにする。
//  1. requestVideoFrameCallback（表示されたフレームの媒体時刻を教えてくれる機能）が
//     使えるブラウザでは、その時刻を使う。シークの前に登録しないと取りこぼす。
//  2. 使えない・呼ばれない場合（未対応ブラウザ、ページが非表示のとき）は、フレームを
//     小さな画像に縮めて前のフレームと見比べ、「絵が変わったか」で新しいフレームと判定する。

export type VideoWithFrameCallback = HTMLVideoElement & {
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

/** シークが時間内に終わらなかったときの失敗。呼び出し側で、ほかの失敗と見分けるために使う */
export class SeekTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`seek did not finish within ${timeoutMs} ms`);
    this.name = 'SeekTimeoutError';
  }
}

/** 中断の合図（AbortSignal）でシークの待ちをやめたときの失敗 */
export class SeekAbortedError extends Error {
  constructor() {
    super('seek aborted');
    this.name = 'SeekAbortedError';
  }
}

export interface SeekOptions {
  /** seeked の後、フレーム時刻の通知を待つ上限（ミリ秒）。既定 60 */
  settleMs?: number;
  /**
   * シークの完了を待つ上限（ミリ秒）。過ぎたら SeekTimeoutError で失敗にし、待ちを解除する。
   * 省略すると待ち続ける（隠れたタブなどでは完了の通知が来ないことがある）
   */
  timeoutMs?: number;
  /** 中断の合図。中断されたら SeekAbortedError で失敗にし、待ちを解除する */
  signal?: AbortSignal;
}

/** 指定時刻へシークし、表示されたフレームの時刻を返す */
export function seekTo(
  video: HTMLVideoElement,
  timeSec: number,
  options: SeekOptions = {},
): Promise<SeekResult> {
  const { settleMs = 60, timeoutMs, signal } = options;
  const v = video as VideoWithFrameCallback;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SeekAbortedError());
      return;
    }
    let seeked = false;
    let done = false;
    let handle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let limit: ReturnType<typeof setTimeout> | undefined;

    /** 待ちをすべて解除する。結果を返す前に 1 回だけ通る（2 回目以降は false） */
    const settle = (): boolean => {
      if (done) return false;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      if (limit !== undefined) clearTimeout(limit);
      if (handle !== undefined) v.cancelVideoFrameCallback?.(handle);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      return true;
    };
    const onAbort = () => fail(new SeekAbortedError());
    const finish = (result: SeekResult) => {
      if (settle()) resolve(result);
    };
    const fail = (error: Error) => {
      if (settle()) reject(error);
    };
    const onSeeked = () => {
      seeked = true;
      // シーク自体は終わったので、時間切れの対象から外す（猶予の間に時間切れにならないように）
      if (limit !== undefined) clearTimeout(limit);
      // フレーム時刻の通知が少し遅れて来ることがあるので、短い猶予を置く
      timer = setTimeout(() => finish({ timeSec: video.currentTime, exact: false }), settleMs);
    };
    const onError = () => fail(new Error('video error during seek'));

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
    if (timeoutMs !== undefined) {
      limit = setTimeout(() => fail(new SeekTimeoutError(timeoutMs)), timeoutMs);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      video.currentTime = timeSec;
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
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

  seek(
    video: HTMLVideoElement,
    timeSec: number,
    options: Omit<SeekOptions, 'settleMs'> = {},
  ): Promise<SeekResult> {
    const settle = this.exactSeen || this.attempts < this.probeCount ? this.settleMs : 0;
    this.attempts++;
    return seekTo(video, timeSec, { ...options, settleMs: settle }).then((r) => {
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
 * 「フレームが切り替わった時刻」の並びから fps を求める。
 * 静止した映像では隣り合うフレームが同じ絵になり、切り替わりを見落とすことがある。
 * 回数を数えると見落としの分だけ低く出るので、間隔の中央値を基準にし、
 * 見落としで長くなった間隔（中央値の 1.5 倍超）を除いた平均から求める。
 */
export function frameRateFromChangeTimes(times: ReadonlyArray<number>): number | null {
  if (times.length < 3) return null;
  const intervals: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i]! - times[i - 1]!;
    if (d > 0) intervals.push(d);
  }
  if (intervals.length < 2) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1]!;
  const kept = intervals.filter((d) => d <= median * 1.5);
  const mean = kept.reduce((s, d) => s + d, 0) / kept.length;
  const fps = 1 / mean;
  return Number.isFinite(fps) && fps > 0 ? snapFrameRate(fps) : null;
}

export interface EstimateFrameRateOptions {
  /** 中断の合図。中断されたら SeekAbortedError で失敗にする */
  signal?: AbortSignal;
  /** 1 回のシークの時間切れ（ミリ秒）。切れたら、それまでに集めた切り替わりだけから推定する */
  seekTimeoutMs?: number;
}

/**
 * フレームレートを推定する。HTML video は fps を教えてくれないので、
 * 先頭 1 秒を 1/120 秒刻みでシークし、フレームが切り替わった時刻を集める。
 * 判定できなければ null（呼び出し側で既定値を使う）。
 */
export async function estimateFrameRate(
  video: HTMLVideoElement,
  options: EstimateFrameRateOptions = {},
): Promise<number | null> {
  const span = Math.min(1, video.duration);
  if (!(span > 0)) return null;
  const step = 1 / 120;
  const sig = new FrameSignature();
  const session = new SeekSession();
  const exactTimes = new Set<number>();
  const changeTimes: number[] = [];
  let prev: Uint8ClampedArray | null = null;
  let allExact = true;
  const seekOptions: Omit<SeekOptions, 'settleMs'> = {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.seekTimeoutMs !== undefined ? { timeoutMs: options.seekTimeoutMs } : {}),
  };

  for (let t = 0; t < span; t += step) {
    let r: SeekResult;
    try {
      r = await session.seek(video, t, seekOptions);
    } catch (e) {
      // シークが止まったら、それまでに集めた分だけで推定する（止まった video は待っても戻らないことが多い）
      if (e instanceof SeekTimeoutError) break;
      throw e;
    }
    if (r.exact) exactTimes.add(Math.round(r.timeSec * 1e5) / 1e5);
    else allExact = false;
    const s = sig.of(video);
    if (!FrameSignature.same(prev, s)) changeTimes.push(t);
    prev = s;
  }

  // 正確な時刻が全部そろっていればそれを優先する
  if (allExact && exactTimes.size >= 3) {
    const exact = frameRateFromChangeTimes([...exactTimes].sort((a, b) => a - b));
    if (exact) return exact;
  }
  return frameRateFromChangeTimes(changeTimes);
}
