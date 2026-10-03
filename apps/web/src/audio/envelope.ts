// 音の大きさの時間変化（包絡線）。バーの上に描くグラフと、撃発ポイントの当たり（音の最大）に使う。
// 取り出した AAC（ADTS）をブラウザの音声機能（Web Audio、端末の中で動く）で波形に戻し、
// 短い区切り（BIN_SEC）ごとの最大振幅を並べる。発射音は鋭い山になる。

import { extractAacAudio } from './mp4audio';

/** 区切りの長さ（秒）。10 ms なら 30 fps の 1 コマより細かい */
export const BIN_SEC = 0.01;

export interface AudioEnvelope {
  /** 区切りごとの大きさ（0〜1、最大を 1 に揃える） */
  values: Float32Array;
  binSec: number;
  /** 動画の時刻に対する音声の始まり（秒）。区切り i の時刻 ＝ offsetSec + i × binSec */
  offsetSec: number;
  durationSec: number;
}

/** 音声の時刻 → 動画の時刻 の変換を含めて、区切り i の中央の動画時刻（秒） */
export const binTimeSec = (env: AudioEnvelope, i: number): number =>
  env.offsetSec + (i + 0.5) * env.binSec;

/** 指定の動画時刻の範囲の中で、音が最も大きい時刻（秒）。範囲に区切りがなければ null */
export function loudestTimeSec(
  env: AudioEnvelope,
  startSec: number,
  endSec: number,
): number | null {
  let best = -1;
  let bestValue = -1;
  for (let i = 0; i < env.values.length; i++) {
    const t = binTimeSec(env, i);
    if (t < startSec || t > endSec) continue;
    if (env.values[i]! > bestValue) {
      bestValue = env.values[i]!;
      best = i;
    }
  }
  return best < 0 ? null : binTimeSec(env, best);
}

type DecodeContext = { decodeAudioData: BaseAudioContext['decodeAudioData'] };

/** 波形に戻すための文脈。音は出さないので、再生装置を持たない OfflineAudioContext を使う */
function decodeContext(sampleRate: number): DecodeContext {
  const w = window as unknown as {
    OfflineAudioContext?: typeof OfflineAudioContext;
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  };
  const Ctx = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!Ctx) throw new Error('web audio unavailable');
  return new Ctx(1, 1, sampleRate);
}

function decode(ctx: DecodeContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  // 古い Safari の decodeAudioData は Promise を返さないので、呼び戻し形で呼ぶ
  return new Promise((resolve, reject) => {
    const result = ctx.decodeAudioData(bytes, resolve, (e) => reject(e ?? new Error('decode')));
    if (result && typeof (result as Promise<AudioBuffer>).then === 'function') {
      (result as Promise<AudioBuffer>).then(resolve, reject);
    }
  });
}

/**
 * 動画ファイルのバイト列から包絡線を作る。音声がない・読めないときは null（例外は投げない）。
 * 30 秒の動画で 1 秒かからない。
 */
export async function computeEnvelope(file: ArrayBuffer): Promise<AudioEnvelope | null> {
  try {
    const audio = extractAacAudio(file);
    if (!audio) return null;
    const ctx = decodeContext(audio.sampleRate);
    // decodeAudioData は渡したバッファを取り込んで使えなくすることがあるので、複製を渡す
    const copy = audio.adts.slice().buffer;
    const buffer = await decode(ctx, copy as ArrayBuffer);
    const binSamples = Math.max(1, Math.round(buffer.sampleRate * BIN_SEC));
    const bins = Math.ceil(buffer.length / binSamples);
    const values = new Float32Array(bins);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const a = Math.abs(data[i]!);
        const b = (i / binSamples) | 0;
        if (a > values[b]!) values[b] = a;
      }
    }
    let max = 0;
    for (let i = 0; i < bins; i++) if (values[i]! > max) max = values[i]!;
    if (max > 0) for (let i = 0; i < bins; i++) values[i] = values[i]! / max;
    return {
      values,
      binSec: binSamples / buffer.sampleRate,
      offsetSec: audio.offsetSec,
      durationSec: buffer.duration,
    };
  } catch {
    return null;
  }
}
