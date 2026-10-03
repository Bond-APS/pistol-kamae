import { useEffect, useState } from 'react';
import { getRecordVideo } from '../db/library';
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
    const bytes =
      source.kind === 'file'
        ? await source.file.arrayBuffer()
        : ((await getRecordVideo(source.recordId))?.bytes ?? null);
    return bytes ? computeEnvelope(bytes) : null;
  })();
  cache.set(key, promise);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return promise;
}

/** 記録の動画を付け直したときなど、覚えている包絡線を捨てる */
export function forgetEnvelope(recordId: number): void {
  cache.delete(`record:${recordId}`);
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
