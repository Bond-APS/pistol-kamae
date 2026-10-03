import { useEffect, useState } from 'react';
import { getRecordAudio, getRecordVideo, setRecordAudio } from '../db/library';
import { computeEnvelope, type AudioEnvelope } from './envelope';

/** 音の包絡線の元：読み込んだ動画ファイル、または保存した記録の動画本体 */
export type EnvelopeSource = { kind: 'file'; file: File } | { kind: 'record'; recordId: number };

/**
 * 状態。loading：計算中、none：音声がない・読めない（グラフなしで手で指定する）、ready：グラフを出せる
 */
export type EnvelopeState =
  { state: 'loading' } | { state: 'none' } | { state: 'ready'; envelope: AudioEnvelope };

const keyOf = (s: EnvelopeSource): string =>
  s.kind === 'file'
    ? `file:${s.file.name}:${s.file.size}:${s.file.lastModified}`
    : `record:${s.recordId}`;

/** 計算済みの包絡線。画面を行き来しても計算し直さないよう、直近の数本を覚えておく */
const cache = new Map<string, Promise<AudioEnvelope | null>>();
const CACHE_LIMIT = 4;

function envelopeFor(source: EnvelopeSource): Promise<AudioEnvelope | null> {
  const key = keyOf(source);
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = (async () => {
    if (source.kind === 'file') return computeEnvelope(await source.file.arrayBuffer());
    // 記録：計算済みなら保存してあるものを使う。なければ動画本体から計算して保存する
    // （動画全体と音声の波形をメモリに載せる計算を、記録ごとに 1 回で済ませるため）
    const saved = await getRecordAudio(source.recordId);
    if (saved) {
      const { values, binSec, offsetSec, durationSec } = saved;
      return { values, binSec, offsetSec, durationSec };
    }
    const bytes = (await getRecordVideo(source.recordId))?.bytes ?? null;
    const envelope = bytes ? await computeEnvelope(bytes) : null;
    if (envelope) await setRecordAudio(source.recordId, envelope);
    return envelope;
  })();
  cache.set(key, promise);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return promise;
}

/** 記録の動画を付け直したときなど、覚えている包絡線を捨てる */
export function forgetEnvelope(recordId: number): void {
  cache.delete(`record:${recordId}`);
}

/**
 * 保存の流れで計算した包絡線を、保存した記録に写す（動画本体を読み直さずに済むように）。
 * 計算していなければ何もしない（次に開いたときに計算する）
 */
export async function adoptEnvelope(file: File, recordId: number): Promise<void> {
  const envelope = await (cache.get(keyOf({ kind: 'file', file })) ?? Promise.resolve(null));
  if (envelope) await setRecordAudio(recordId, envelope);
}

export function useAudioEnvelope(source: EnvelopeSource | null): EnvelopeState {
  const key = source ? keyOf(source) : '';
  const [entry, setEntry] = useState<{ key: string; state: EnvelopeState } | null>(null);
  useEffect(() => {
    if (!source) return;
    let alive = true;
    envelopeFor(source).then(
      (envelope) => {
        if (alive)
          setEntry({ key, state: envelope ? { state: 'ready', envelope } : { state: 'none' } });
      },
      () => {
        if (alive) setEntry({ key, state: { state: 'none' } });
      },
    );
    return () => {
      alive = false;
    };
    // source はオブジェクトなので、中身を表す key で比べる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!source) return { state: 'none' };
  return entry && entry.key === key ? entry.state : { state: 'loading' };
}
