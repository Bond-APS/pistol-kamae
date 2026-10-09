import { useEffect, useState } from 'react';
import { getRecordAudio, getRecordVideo, setRecordAudio } from '../db/library';
import { BIN_SEC, computeEnvelope, type AudioEnvelope } from './envelope';

/**
 * 「音声がない（または読めない）」も記録に保存する（区切りが 0 個の包絡線）。保存しないと、音声のない動画は
 * 開くたびに動画本体を丸ごと読んで「音声なし」と結論し直すことになる（比較画面では動画 URL の読み込みと重なる）
 */
const NONE: AudioEnvelope = {
  values: new Float32Array(0),
  binSec: BIN_SEC,
  offsetSec: 0,
  durationSec: 0,
};
const toStored = (envelope: AudioEnvelope | null): AudioEnvelope => envelope ?? NONE;
const fromStored = (saved: AudioEnvelope): AudioEnvelope | null =>
  saved.values.length === 0 ? null : saved;

/**
 * 音の包絡線の元：読み込んだ動画ファイル、または保存した記録の動画本体。
 * record の version は、動画を付け直したあとに読み直すための番号（forgetEnvelope のあとで上げる）
 */
export type EnvelopeSource =
  { kind: 'file'; file: File } | { kind: 'record'; recordId: number; version?: number };

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
    // ファイル：必要な部分だけを読む（200 MB の動画でも全体はメモリに載せない）
    if (source.kind === 'file') return computeEnvelope(source.file);
    // 記録：計算済みなら保存してあるものを使う。なければ動画本体から計算して保存する
    // （動画全体と音声の波形をメモリに載せる計算を、記録ごとに 1 回で済ませるため。
    // 保存の流れと「動画ファイルを選び直す」で包絡線を写すので、ここへ来るのは古い記録だけ）
    const saved = await getRecordAudio(source.recordId);
    if (saved) {
      const { values, binSec, offsetSec, durationSec } = saved;
      return fromStored({ values, binSec, offsetSec, durationSec });
    }
    const bytes = (await getRecordVideo(source.recordId))?.bytes ?? null;
    if (!bytes) return null;
    const envelope = await computeEnvelope(bytes);
    await setRecordAudio(source.recordId, toStored(envelope)).catch(() => {});
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
 * 計算していなければ何もしない（次に開いたときに計算する）。「音声なし」も写す
 */
export async function adoptEnvelope(file: File, recordId: number): Promise<void> {
  const computed = cache.get(keyOf({ kind: 'file', file }));
  if (!computed) return;
  await setRecordAudio(recordId, toStored(await computed));
}

/**
 * 「動画ファイルを選び直す」で付けた動画から包絡線を計算して記録に保存する（ファイルの必要な部分だけを読む）。
 * あとで比較画面や「動画を再生」が、保存した動画本体を丸ごと読み直して計算しないで済むように。
 * 「音声なし」も保存する（次に開いたときに動画本体を読み直さないため）
 */
export async function storeEnvelopeFromFile(file: File, recordId: number): Promise<void> {
  await setRecordAudio(recordId, toStored(await computeEnvelope(file)));
}

export function useAudioEnvelope(source: EnvelopeSource | null): EnvelopeState {
  // 記録の version は覚えている包絡線の鍵には入れず、読み直す合図としてだけ使う
  const key = source
    ? `${keyOf(source)}:${source.kind === 'record' ? (source.version ?? 0) : 0}`
    : '';
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
