// 読み出した行から、engine の保存形式の記録を組み立てて検査する（データベースと画面から切り離した計算）。
// 古い版の中身は読み替えてから検査する（データベースへは書き戻さない）。

import {
  RECORD_FORMAT_VERSION,
  checkShotRecord,
  normalizeTitle,
  upgradeShotRecord,
  type RecordProblem,
  type ShotRecord,
} from '@pistol-kamae/engine';
import type { RecordDataRow, RecordRow, ShooterRow, StoredImage } from './schema';

/** ライブラリから開いた 1 件 */
export interface OpenedRecord {
  row: RecordRow;
  shooter: ShooterRow;
  /** engine の保存形式に組み立てたもの（角度の計算に使う） */
  record: ShotRecord;
  still: StoredImage;
}

export type OpenRecordResult =
  | { kind: 'open'; opened: OpenedRecord }
  /** 見出しの行がない（削除済みなど） */
  | { kind: 'missing' }
  /** 中身がない・射手がいない・版を読み替えられない・形式の検査に落ちた。削除はできる */
  | { kind: 'invalid'; problem: RecordProblem | 'noData' | 'noShooter'; row: RecordRow };

/** 見出し・中身・射手を合わせて、engine の保存形式に組み立てる（中身は今の版である前提） */
export function toShotRecord(row: RecordRow, data: RecordDataRow, shooter: ShooterRow): ShotRecord {
  return {
    formatVersion: RECORD_FORMAT_VERSION,
    analysis: data.analysis,
    marks: data.marks,
    clip: data.clip,
    // 水平校正（カメラの傾きの補正）は初期バージョンから外した（2026-10-03、開発者の決定）。
    // 以前に引いた線はデータベースに残すが、角度の計算には使わない
    level: null,
    meta: {
      title: row.title,
      shotAt: row.shotAt,
      shooterName: shooter.name,
      handedness: shooter.handedness,
      score: row.score,
      memo: row.memo,
      favorite: row.favorite,
    },
  };
}

/**
 * 読み出した行から記録を組み立てて検査する。
 * 古い版の中身は upgradeShotRecord で今の版に読み替える（題名は見出しの行のものを使う）
 */
export function buildOpenedRecord(
  row: RecordRow,
  data: RecordDataRow | undefined,
  shooter: ShooterRow | undefined,
): OpenRecordResult {
  if (!data) return { kind: 'invalid', problem: 'noData', row };
  if (!shooter) return { kind: 'invalid', problem: 'noShooter', row };
  const base = toShotRecord(row, data, shooter);
  // 中身の版をそのまま付けて読み替える。読み替えは題名を撮影日時から作り直すが、見出しの行に正しい題名が
  // あればそちらを使う（題名がない・壊れている行は、読み替えの既定の題名のまま）
  const upgraded = upgradeShotRecord({ ...base, formatVersion: data.formatVersion });
  const title = base.meta.title;
  const keepTitle = typeof title === 'string' && title !== '' && normalizeTitle(title) === title;
  const candidate =
    keepTitle && isObject(upgraded) && isObject(upgraded.meta)
      ? { ...upgraded, meta: { ...upgraded.meta, title } }
      : upgraded;
  const problem = checkShotRecord(candidate);
  if (problem !== null) return { kind: 'invalid', problem, row };
  return {
    kind: 'open',
    opened: { row, shooter, record: candidate as ShotRecord, still: data.still },
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
