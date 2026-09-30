// ブラウザ内データベース（IndexedDB）の表の定義。Dexie は IndexedDB を扱いやすくする部品。
// 保存はすべてこの端末の中で完結する。動画本体は保存しない。

import type { Handedness, Mark, RecordAnalysis } from '@pistol-kamae/engine';
import Dexie, { type EntityTable, type Table } from 'dexie';

/**
 * 画像データ。Blob（ファイルのようなデータ）のままではなくバイト列で持つ。
 * 古い Safari は IndexedDB に Blob を入れると失敗することがあるため。
 */
export interface StoredImage {
  bytes: ArrayBuffer;
  /** 画像の種類（例：image/jpeg） */
  type: string;
}

/** 射手。利き手は射手ごとに 1 回だけ決める */
export interface ShooterRow {
  id: number;
  name: string;
  handedness: Handedness;
  createdAt: number;
}

/** 記録の見出し部分（一覧に出す情報）。重い中身は RecordDataRow に分けて、一覧を軽くする */
export interface RecordRow {
  id: number;
  shooterId: number;
  /** 撮影日時。端末の現地時刻で 'YYYY-MM-DDTHH:mm' */
  shotAt: string;
  score: number | null;
  memo: string;
  favorite: boolean;
  /** 一覧用の小さい静止画（人物を中心に切り抜いたもの） */
  thumb: StoredImage;
  createdAt: number;
  updatedAt: number;
}

/** 記録の中身（関節の位置の時系列・マーク・撃発フレームの静止画）。id は RecordRow と同じ */
export interface RecordDataRow {
  id: number;
  formatVersion: number;
  analysis: RecordAnalysis;
  marks: Mark[];
  still: StoredImage;
}

/** 前回選んだ射手など、端末ごとの小さな設定 */
export interface SettingRow {
  key: string;
  value: unknown;
}

export class KamaeDb extends Dexie {
  shooters!: EntityTable<ShooterRow, 'id'>;
  records!: EntityTable<RecordRow, 'id'>;
  recordData!: Table<RecordDataRow, number>;
  settings!: Table<SettingRow, string>;

  constructor() {
    super('pistol-kamae');
    // 表の定義を変えるときは version の番号を上げ、古いデータの移し替えを書く
    this.version(1).stores({
      shooters: '++id, &name',
      records: '++id, shooterId, shotAt',
      recordData: 'id',
      settings: 'key',
    });
  }
}

export const db = new KamaeDb();
