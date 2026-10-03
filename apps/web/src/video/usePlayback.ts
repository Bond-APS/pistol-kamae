// 1 本または 2 本の動画を、共通の時間軸（t）で再生する部品。
// t は「バーの時刻」で、各動画の時刻 ＝ anchorSec + t（比較画面では anchorSec が撃発ポイントなので t = 0 が撃発）。
// 1 本目が主で、t は主の動画の進みから求める。2 本目以降は主に合わせ、1 コマ以上ずれたら合わせ直す
// （Safari は 2 本の再生が少しずつずれるため）。

import { useCallback, useEffect, useRef, useState } from 'react';

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

/** 区間の終わりの手前、この時間（秒）以内なら「終わり」とみなす（終端で止まらずに通り過ぎる対策） */
const END_EPSILON_SEC = 0.02;

export function usePlayback(opts: PlaybackOptions): Playback {
  const { videos, rate } = opts;
  const [playing, setPlaying] = useState(false);
  // 再生中の処理（rAF）から最新の設定を読むための入れ物。描画のたびに effect で入れ替える
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const all = useCallback(() => videos.map((v) => v.get()), [videos]);

  const pause = useCallback(() => {
    const elements = all();
    const master = elements[0];
    for (const v of elements) v?.pause();
    if (master && master.readyState >= 1) {
      optsRef.current.onTick(master.currentTime - optsRef.current.videos[0]!.anchorSec);
    }
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
      let t = fromT ?? master.currentTime - videos[0]!.anchorSec;
      // 区間の外、または終わりにいるときは先頭から
      if (t < s || t >= e - END_EPSILON_SEC) t = s;
      seekAll(t);
      for (const v of elements) v!.playbackRate = r;
      // 利用者の操作の中で、すべてを同時に再生し始める（iPhone は操作の外からの再生を断る）
      void Promise.all(elements.map((v) => v!.play())).then(
        () => setPlaying(true),
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
    const tick = () => {
      const elements = all();
      const master = elements[0];
      const { startT: s, endT: e, loop: l, onTick: cb, videos: vs } = optsRef.current;
      if (!master || elements.some((v) => !v || v.paused || v.ended)) {
        // 画面から外れた・端まで行った・ブラウザが止めた：全部止める
        if (master && master.ended && l && elements.every((v) => v)) {
          // 動画の末尾が区間の終わりと同じときは、末尾に達して ended になる。繰り返しなら先頭へ
          seekAll(s);
          void Promise.all(elements.map((v) => v!.play())).catch(() => pause());
          raf = requestAnimationFrame(tick);
          return;
        }
        pause();
        return;
      }
      const t = master.currentTime - vs[0]!.anchorSec;
      if (!restarting && t >= e - END_EPSILON_SEC) {
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
        cb(t);
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
    return () => cancelAnimationFrame(raf);
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
