// JSON 読込の前に決めること（画面から切り離した計算）。
// 射手は名前で引き当て、いなければ登録する。利き手が違えば、どちらを使うか選んでもらう。
// 撮影日時・射手名・動画の長さが同じ記録があれば「重複」として確認する（2026-10-12 の決定）。

import type { Handedness, ShotRecord } from '@pistol-kamae/engine';

/** 登録済みの射手（名前と利き手） */
export interface KnownShooter {
  name: string;
  handedness: Handedness;
}

/** ライブラリにある記録の、重複の判定に使う部分 */
export interface KnownRecord {
  shooterName: string;
  shotAt: string;
  durationSec: number;
}

/** 読み込むファイルに出てくる射手（名前ごとに 1 つ） */
export interface PlannedShooter {
  name: string;
  /** ファイルの中の利き手。同じ名前で利き手が混じっていれば最初のもの */
  handedness: Handedness;
  /** 登録済みの射手。いなければ null（新しく登録する） */
  registered: KnownShooter | null;
  /** 登録済みで、利き手が違う（どちらを使うか選んでもらう） */
  conflict: boolean;
}

export interface ImportPlan {
  shooters: PlannedShooter[];
  /** 重複（すでに同じ記録がある）と判定した記録の、records の添え字 */
  duplicates: number[];
}

/** 動画の長さがこの差（秒）の中なら同じとみなす（同じファイルなら同じ長さになる） */
const DURATION_TOLERANCE_SEC = 0.01;

export function isSameRecord(a: KnownRecord, b: KnownRecord): boolean {
  return (
    a.shooterName === b.shooterName &&
    a.shotAt === b.shotAt &&
    Math.abs(a.durationSec - b.durationSec) <= DURATION_TOLERANCE_SEC
  );
}

export const knownRecordOf = (record: ShotRecord): KnownRecord => ({
  shooterName: record.meta.shooterName,
  shotAt: record.meta.shotAt,
  durationSec: record.analysis.durationSec,
});

export function planImport(
  records: ReadonlyArray<ShotRecord>,
  knownShooters: ReadonlyArray<KnownShooter>,
  knownRecords: ReadonlyArray<KnownRecord>,
): ImportPlan {
  const shooters = new Map<string, PlannedShooter>();
  for (const record of records) {
    const { shooterName, handedness } = record.meta;
    if (shooters.has(shooterName)) continue;
    const registered = knownShooters.find((s) => s.name === shooterName) ?? null;
    shooters.set(shooterName, {
      name: shooterName,
      handedness,
      registered,
      conflict: registered !== null && registered.handedness !== handedness,
    });
  }
  // ライブラリにある記録と、同じファイルの中で先に出てきた記録の両方と比べる
  // （全件の JSON を 2 回つなげたようなファイルでも、2 重に入らないように）
  const duplicates: number[] = [];
  const seen: KnownRecord[] = [];
  records.forEach((record, i) => {
    const key = knownRecordOf(record);
    if ([...knownRecords, ...seen].some((k) => isSameRecord(k, key))) duplicates.push(i);
    seen.push(key);
  });
  return { shooters: [...shooters.values()], duplicates };
}
