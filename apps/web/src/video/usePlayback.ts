// 1 本または 2 本の動画を、共通の時間軸（t）で再生する部品。
// t は「バーの時刻」で、各動画の時刻 ＝ anchorSec + t（比較画面では anchorSec が撃発ポイントなので t = 0 が撃発）。
// 1 本目が主で、t は主の動画の進みから求める。2 本目以降は主に合わせ、1 コマ以上ずれたら合わせ直す
// （Safari は 2 本の再生が少しずつずれるため）。
// 画面に知らせる t（onTick）は、主の動画の「画面に出ているコマの媒体時刻」（requestVideoFrameCallback が
// 教える、表示されたコマの時刻）から求める。再生位置（currentTime）は表示されているコマと前後に
// 数ミリ秒〜1 コマずれることがあり（実測：WebKit は ±数ミリ秒、Chrome は表示が 1 コマ先に出ることがある）、
// それで骨格のコマを選ぶと、止めたときに絵と骨格が 1 コマずれる。通知が使えない・古いときは再生位置を使う。
// 区間の終わりの判定と 2 本目の合わせ直しは、再生位置で行う。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoWithFrameCallback } from './seek';

export interface PlaybackVideo {
  /** 置かれている video 要素（まだなければ null） */
  get: () => HTMLVideoElement | null;
  /** t = 0 に当たる動画の時刻（秒） */
  anchorSec: number;
  fps: number;
}

export interface PlaybackOptions {
  videos: PlaybackVideo[];
  /** 再生する区間（t、秒）。終わりに達したら止まる（繰り返しなら先頭に戻る） */
  startT: number;
  endT: number;
  /** 速さ（1、0.5、0.25） */
  rate: number;
  loop: boolean;
  /** 再生中、動画の進みに合わせて呼ぶ。止めたときも最後に 1 回呼ぶ */
  onTick: (t: number) => void;
}

export interface Playback {
  playing: boolean;
  /** 再生を始める。利用者の操作（ボタン）の中で呼ぶこと。fromT を渡すとそこから */
  play: (fromT?: number) => void;
  pause: () => void;
}

/** 区間の終わりの手前、少なくともこの時間（秒）以内なら「終わり」とみなす（終端で止まらずに通り過ぎる対策）。実際は 1 コマ分 */
const END_EPSILON_MIN_SEC = 0.02;
const endEpsilon = (fps: number): number => Math.max(END_EPSILON_MIN_SEC, 1 / fps);

/**
 * 画面に出ているコマの時刻（秒）。表示されたコマの通知（presentedSec）があり、再生位置から 2 コマ以内なら
 * それを使う。通知がない、または古い（タブを隠していて通知が止まった間に動画が進んだ、など）ときは再生位置。
 * 2 コマなのは、Chrome では表示されたコマが再生位置より 1 コマ先に出ることがあるため
 */
function shownSecOf(presentedSec: number | null, video: HTMLVideoElement, fps: number): number {
  if (presentedSec === null || Math.abs(presentedSec - video.currentTime) > 2 / fps) {
    return video.currentTime;
  }
  return presentedSec;
}

export function usePlayback(opts: PlaybackOptions): Playback {
  const { videos, rate } = opts;
  const [playing, setPlaying] = useState(false);
  // 再生中の処理（rAF）から最新の設定を読むための入れ物。描画のたびに effect で入れ替える
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const all = useCallback(() => videos.map((v) => v.get()), [videos]);

  /** 実際に再生していたか（止まっているときに pause() を呼んでも、時点を上書きしないため） */
  const playingRef = useRef(false);
  /** 今の再生で、主の動画に最後に表示されたコマの媒体時刻（秒）。通知がまだなければ null（shownSecOf で使う） */
  const presentedSecRef = useRef<number | null>(null);
  const pause = useCallback(() => {
    const elements = all();
    const master = elements[0];
    for (const v of elements) v?.pause();
    if (playingRef.current && master && master.readyState >= 1) {
      const { startT: s, endT: e, videos: vs, onTick } = optsRef.current;
      const shownSec = shownSecOf(presentedSecRef.current, master, vs[0]!.fps);
      onTick(Math.min(Math.max(shownSec - vs[0]!.anchorSec, s), e));
    }
    playingRef.current = false;
    setPlaying(false);
  }, [all]);

  const seekAll = useCallback(
    (t: number) => {
      videos.forEach((pv) => {
        const v = pv.get();
        if (v) v.currentTime = pv.anchorSec + t;
      });
    },
    [videos],
  );

  const play = useCallback(
    (fromT?: number) => {
      const elements = all();
      const master = elements[0];
      if (!master || elements.some((v) => !v)) return;
      const { startT: s, endT: e, rate: r } = optsRef.current;
      // 区間が 1 コマに満たなければ再生しない（終端の判定を繰り返すだけになる）
      if (e - s < 1 / videos[0]!.fps) return;
      let t = fromT ?? master.currentTime - videos[0]!.anchorSec;
      // 区間の外、または終わりにいるときは先頭から
      if (t < s || t >= e - endEpsilon(videos[0]!.fps)) t = s;
      presentedSecRef.current = null;
      seekAll(t);
      for (const v of elements) v!.playbackRate = r;
      // 利用者の操作の中で、すべてを同時に再生し始める（iPhone は操作の外からの再生を断る）
      void Promise.all(elements.map((v) => v!.play())).then(
        () => {
          playingRef.current = true;
          setPlaying(true);
        },
        () => pause(),
      );
    },
    [all, videos, seekAll, pause],
  );

  // 速さを変えたら、再生中の動画にもすぐ反映する
  useEffect(() => {
    for (const v of all()) if (v) v.playbackRate = rate;
  }, [rate, all]);

  // 再生中：主の動画の進みに合わせて t を知らせ、他の動画のずれを直し、区間の終わりで止める・戻す
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let restarting = false;
    // 主の動画から、表示されたコマの媒体時刻を受け取り続ける（通知は 1 回ごとなので、受け取るたびに次を頼む）
    const frameSource = (all()[0] ?? null) as VideoWithFrameCallback | null;
    let frameHandle: number | undefined;
    if (frameSource?.requestVideoFrameCallback) {
      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        presentedSecRef.current = meta.mediaTime;
        frameHandle = frameSource.requestVideoFrameCallback!(onFrame);
      };
      frameHandle = frameSource.requestVideoFrameCallback(onFrame);
    }
    /** 最後に知らせた t。コマが変わったときだけ知らせる（同じ値で画面を描き直さないため） */
    let lastShownT: number | null = null;
    const tick = () => {
      const elements = all();
      const master = elements[0];
      const { startT: s, endT: e, loop: l, onTick: cb, videos: vs } = optsRef.current;
      if (!master || elements.some((v) => !v || v.paused || v.ended)) {
        // どれかが動画の末尾に達して ended になった（区間の終わりが動画の末尾と同じとき）。
        // 繰り返しなら先頭へ戻して続ける。それ以外（画面から外れた・ブラウザが止めた）は全部止める
        if (l && elements.every((v) => v) && elements.some((v) => v!.ended)) {
          seekAll(s);
          void Promise.all(elements.map((v) => v!.play())).catch(() => pause());
          raf = requestAnimationFrame(tick);
          return;
        }
        pause();
        return;
      }
      const t = master.currentTime - vs[0]!.anchorSec;
      if (!restarting && t >= e - endEpsilon(vs[0]!.fps)) {
        if (l) {
          restarting = true;
          seekAll(s);
          // シークが終わるまで、終端の判定を繰り返さない
          const done = () => {
            restarting = false;
            master.removeEventListener('seeked', done);
          };
          master.addEventListener('seeked', done);
        } else {
          pause();
          cb(e);
          return;
        }
      } else if (!master.seeking) {
        const shownT = shownSecOf(presentedSecRef.current, master, vs[0]!.fps) - vs[0]!.anchorSec;
        if (shownT !== lastShownT) {
          lastShownT = shownT;
          cb(shownT);
        }
        // 2 本目以降を主に合わせる
        for (let i = 1; i < elements.length; i++) {
          const v = elements[i]!;
          const expected = vs[i]!.anchorSec + t;
          if (!v.seeking && Math.abs(v.currentTime - expected) > 1 / vs[i]!.fps) {
            v.currentTime = expected;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (frameHandle !== undefined) frameSource?.cancelVideoFrameCallback?.(frameHandle);
    };
  }, [playing, all, seekAll, pause]);

  // 画面を離れるときは止める
  useEffect(
    () => () => {
      for (const v of all()) v?.pause();
    },
    [all],
  );

  return { playing, play, pause };
}
