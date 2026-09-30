// ライブラリに保存する 1 件（処理済み動画 1 本分）の形式。要件 9 章。
// 動画本体と静止画は含めない（静止画は画像データなので、保存する側が別に持つ）。
// 角度の時系列も含めない。開くたびに関節の位置から計算する（二重に持つと食い違いの原因になる）。

import type { LandmarkFrame } from '../landmarks/types';
import type { Mark } from '../marks/types';
import type { Handedness } from '../normalize/handedness';

/** 保存形式の版番号。形式を変えたら上げ、古い版を読むときの変換を足す */
export const RECORD_FORMAT_VERSION = 1;

/** 姿勢推定の結果（動画 1 本分） */
export interface RecordAnalysis {
  /** 使用した姿勢推定モデルの名前（例：mediapipe-full-video） */
  backendId: string;
  /** 動画の幅・高さ（画素）。関節の位置はこの画素座標で入っている */
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  /** 関節の位置の時系列（共通ランドマーク形式）。左利きでも左右反転していない生の座標 */
  frames: LandmarkFrame[];
}

/** 記録に付ける情報 */
export interface RecordMeta {
  /** 撮影日時。端末の現地時刻で 'YYYY-MM-DDTHH:mm'（時差の情報は持たない） */
  shotAt: string;
  shooterName: string;
  /** 射手の利き手。角度の符号と銃側・非銃側の判定に使う */
  handedness: Handedness;
  /** この 1 発の点数（0〜10.9）。未入力は null */
  score: number | null;
  memo: string;
  favorite: boolean;
}

export interface ShotRecord {
  formatVersion: typeof RECORD_FORMAT_VERSION;
  analysis: RecordAnalysis;
  /** 撃発マーク（必須）と任意マーク */
  marks: Mark[];
  meta: RecordMeta;
}
