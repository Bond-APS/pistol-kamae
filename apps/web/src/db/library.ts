// ライブラリ（保存した記録）と射手の読み書き。

import {
  RECORD_FORMAT_VERSION,
  checkShotRecord,
  type Handedness,
  type Mark,
  type RecordAnalysis,
  type ShotRecord,
} from '@pistol-kamae/engine';
import {
  db,
  type RecordDataRow,
  type RecordRow,
  type ShooterRow,
  type StoredImage,
} from './schema';

const LAST_SHOOTER_KEY = 'lastShooterId';

/** 同じ名前の射手がすでにいるときに投げる */
export class DuplicateShooterError extends Error {
  constructor() {
    super('duplicate shooter name');
    this.name = 'DuplicateShooterError';
  }
}

export async function listShooters(): Promise<ShooterRow[]> {
  return db.shooters.orderBy('id').toArray();
}

async function assertNameFree(name: string, exceptId?: number): Promise<void> {
  const same = await db.shooters.where('name').equals(name).first();
  if (same && same.id !== exceptId) throw new DuplicateShooterError();
}

export async function addShooter(name: string, handedness: Handedness): Promise<number> {
  return db.transaction('rw', db.shooters, async () => {
    await assertNameFree(name);
    return db.shooters.add({ name, handedness, createdAt: Date.now() });
  });
}

/** 名前や利き手を直す。その射手の記録すべてに反映される（記録は射手を番号で参照しているため） */
export async function updateShooter(
  id: number,
  name: string,
  handedness: Handedness,
): Promise<void> {
  await db.transaction('rw', db.shooters, async () => {
    await assertNameFree(name, id);
    await db.shooters.update(id, { name, handedness });
  });
}

export async function getLastShooterId(): Promise<number | null> {
  const row = await db.settings.get(LAST_SHOOTER_KEY);
  return typeof row?.value === 'number' ? row.value : null;
}

export async function setLastShooterId(id: number): Promise<void> {
  await db.settings.put({ key: LAST_SHOOTER_KEY, value: id });
}

/** 記録に付ける情報（保存時と編集時に入力するもの） */
export interface RecordFields {
  shooterId: number;
  shotAt: string;
  score: number | null;
  memo: string;
  favorite: boolean;
}

export interface RecordImages {
  still: StoredImage;
  thumb: StoredImage;
}

/** 新しい記録を保存し、その番号を返す */
export async function addRecord(
  fields: RecordFields,
  analysis: RecordAnalysis,
  marks: Mark[],
  images: RecordImages,
): Promise<number> {
  return db.transaction('rw', db.records, db.recordData, async () => {
    const now = Date.now();
    const id = await db.records.add({
      ...fields,
      thumb: images.thumb,
      createdAt: now,
      updatedAt: now,
    });
    await db.recordData.add({
      id,
      formatVersion: RECORD_FORMAT_VERSION,
      analysis,
      marks,
      still: images.still,
    });
    return id;
  });
}

/** 保存済みの記録のマークと静止画を差し替える（保存後にマークを変えたときの上書き保存） */
export async function overwriteRecordMarks(
  id: number,
  marks: Mark[],
  images: RecordImages,
): Promise<void> {
  await db.transaction('rw', db.records, db.recordData, async () => {
    const updated = await db.records.update(id, { thumb: images.thumb, updatedAt: Date.now() });
    if (updated === 0) throw new Error('record not found');
    await db.recordData.update(id, { marks, still: images.still });
  });
}

export async function updateRecordFields(id: number, fields: RecordFields): Promise<void> {
  await db.records.update(id, { ...fields, updatedAt: Date.now() });
}

export async function setRecordFavorite(id: number, favorite: boolean): Promise<void> {
  await db.records.update(id, { favorite });
}

export async function deleteRecord(id: number): Promise<void> {
  await db.transaction('rw', db.records, db.recordData, async () => {
    await db.records.delete(id);
    await db.recordData.delete(id);
  });
}

export async function listRecords(): Promise<RecordRow[]> {
  return db.records.toArray();
}

export async function getRecordRow(id: number): Promise<RecordRow | null> {
  return (await db.records.get(id)) ?? null;
}

/** 開いた 1 件の内容 */
export interface OpenedRecord {
  row: RecordRow;
  shooter: ShooterRow;
  /** engine の保存形式に組み立てたもの（角度の計算に使う） */
  record: ShotRecord;
  still: StoredImage;
}

/** 見出し・中身・射手を合わせて、engine の保存形式に組み立てる */
export function toShotRecord(row: RecordRow, data: RecordDataRow, shooter: ShooterRow): ShotRecord {
  return {
    formatVersion: RECORD_FORMAT_VERSION,
    analysis: data.analysis,
    marks: data.marks,
    meta: {
      shotAt: row.shotAt,
      shooterName: shooter.name,
      handedness: shooter.handedness,
      score: row.score,
      memo: row.memo,
      favorite: row.favorite,
    },
  };
}

/** 1 件を開く。見つからない、または形式が壊れていれば null */
export async function openRecord(id: number): Promise<OpenedRecord | null> {
  const [row, data] = await Promise.all([db.records.get(id), db.recordData.get(id)]);
  if (!row || !data || data.formatVersion !== RECORD_FORMAT_VERSION) return null;
  const shooter = await db.shooters.get(row.shooterId);
  if (!shooter) return null;
  const record = toShotRecord(row, data, shooter);
  if (checkShotRecord(record) !== null) return null;
  return { row, shooter, record, still: data.still };
}
