// ブラウザ内データベース（IndexedDB）の表の定義。Dexie は IndexedDB を扱いやすくする部品。
// 保存はすべてこの端末の中で完結する。動画本体も端末の中にだけ保存する（比較画面で、任意の時点の絵を出すため）。

import {
  RECORD_FORMAT_VERSION,
  clipDurationSec,
  defaultTitle,
  type Clip,
  type Handedness,
  type LevelLine,
  type Mark,
  type RecordAnalysis,
} from '@pistol-kamae/engine';
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
  /** タイトル。初期値は撮影日時。版 4 で追加 */
  title: string;
  shooterId: number;
  /** 撮影日時。端末の現地時刻で 'YYYY-MM-DDTHH:mm' */
  shotAt: string;
  /** 点数。段階⑤で画面から外した（保存済みの値は残す。新しい記録は null） */
  score: number | null;
  /** 切り抜いたあとの長さ（秒）。一覧に出す。版 4 で追加 */
  clipSec: number;
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
  /** 切り抜きの範囲（元の動画の媒体時刻）。全体なら null。保存形式の版 3 で追加 */
  clip: Clip | null;
  /** 水平校正の線（元の動画の画素座標）。引いていなければ null。保存形式の版 2 で追加 */
  level: LevelLine | null;
  still: StoredImage;
}

/**
 * 記録の動画本体。id は RecordRow と同じ。重いので、比較画面で使うときだけ読む。
 * Blob のままだと Safari（WebKit）で保存に失敗するので、画像と同じくバイト列で持つ。
 */
export interface RecordVideoRow {
  id: number;
  bytes: ArrayBuffer;
  /** 動画の種類（例：video/quicktime） */
  type: string;
}

/**
 * 記録の音の大きさの時間変化（包絡線）。id は RecordRow と同じ。
 * 動画本体から計算できるが、計算には動画全体と音声の波形をメモリに載せるので、1 回計算したら保存して使い回す
 */
export interface RecordAudioRow {
  id: number;
  values: Float32Array;
  binSec: number;
  offsetSec: number;
  durationSec: number;
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
  recordVideos!: Table<RecordVideoRow, number>;
  recordAudio!: Table<RecordAudioRow, number>;
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
    // 版 2（段階④）：記録に水平校正の線を足した。表の構成は同じ。
    // 版 1 で保存した記録は消さずに、「線なし」として今の保存形式に直す
    this.version(2).upgrade((tx) =>
      tx
        .table<RecordDataRow, number>('recordData')
        .toCollection()
        .modify((row) => {
          if (row.formatVersion === 1) {
            row.formatVersion = 2;
            row.level = null;
          }
        }),
    );
    // 版 3（段階④の仕様変更）：動画本体の表を足した。それまでの記録は「動画なし」のまま残る
    this.version(3).stores({ recordVideos: 'id' });
    // 版 4（段階⑤）：記録にタイトル（初期値は撮影日時）と切り抜きの範囲（全体 = null）を足した。
    // 保存形式は版 3 になる。表の構成は同じ
    this.version(4).upgrade(async (tx) => {
      const data = tx.table<RecordDataRow, number>('recordData');
      await data.toCollection().modify((row) => {
        if (row.formatVersion === 2) {
          row.formatVersion = RECORD_FORMAT_VERSION;
          row.clip = null;
        }
      });
      const durations = new Map<number, number>();
      await data.each((row) => {
        durations.set(row.id, clipDurationSec(row.clip ?? null, row.analysis.durationSec));
      });
      await tx
        .table<RecordRow, number>('records')
        .toCollection()
        .modify((row) => {
          if (typeof row.title !== 'string' || row.title === '') {
            row.title = defaultTitle(row.shotAt);
          }
          if (typeof row.clipSec !== 'number') row.clipSec = durations.get(row.id) ?? 0;
        });
    });
    // 版 5（段階⑤）：音の包絡線の表を足した。初めて開いたときに動画本体から計算して入れる
    this.version(5).stores({ recordAudio: 'id' });
  }
}

export const db = new KamaeDb();
