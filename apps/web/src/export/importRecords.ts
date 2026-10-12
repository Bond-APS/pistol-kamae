// JSON から読み取った記録をライブラリに書く。
// 射手は名前で引き当て（いなければ登録）、利き手は画面で決めたものに合わせる。
// 動画本体は、保存の流れと同じ上限（200 MB）と失敗の扱い（記録だけ保存して知らせる）。

import type { Handedness } from '@pistol-kamae/engine';
import {
  addRecord,
  addShooter,
  listShooters,
  setRecordAudio,
  setRecordVideo,
  updateShooter,
} from '../db/library';
import { VIDEO_MAX_BYTES } from '../video/limits';
import { decodeAudio, type ExportedRecord } from './json';

export interface ImportOutcome {
  /** 書き込んだ記録の番号 */
  ids: number[];
  /** 書き込めなかった件数（データベースの失敗など） */
  failed: number;
  /** 動画本体が上限を超えていて保存しなかった件数 */
  videoTooLarge: number;
  /** 動画本体の保存に失敗した件数（空き容量不足など） */
  videoFailed: number;
}

/**
 * 記録を順に書き込む。handednessByName は、射手の名前ごとに使う利き手（画面で決めたもの）。
 * 登録済みの射手と違えば射手の登録を直す（その射手の記録すべてに反映される）。
 * onProgress は 1 件書くごとに呼ぶ
 */
export async function importRecords(
  items: ReadonlyArray<ExportedRecord>,
  handednessByName: ReadonlyMap<string, Handedness>,
  onProgress?: (done: number) => void,
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { ids: [], failed: 0, videoTooLarge: 0, videoFailed: 0 };
  const shooterIds = new Map<string, number>();
  const existing = await listShooters();
  for (const s of existing) shooterIds.set(s.name, s.id);

  const ensureShooter = async (name: string, fileHandedness: Handedness): Promise<number> => {
    const handedness = handednessByName.get(name) ?? fileHandedness;
    const registered = existing.find((s) => s.name === name);
    if (registered) {
      if (registered.handedness !== handedness) {
        await updateShooter(registered.id, name, handedness);
        registered.handedness = handedness;
      }
      return registered.id;
    }
    const id = await addShooter(name, handedness);
    existing.push({ id, name, handedness, createdAt: Date.now() });
    return id;
  };

  let done = 0;
  for (const item of items) {
    const { record } = item;
    try {
      const shooterId = await ensureShooter(record.meta.shooterName, record.meta.handedness);
      const id = await addRecord(
        {
          title: record.meta.title,
          shooterId,
          shotAt: record.meta.shotAt,
          memo: record.meta.memo,
          favorite: record.meta.favorite,
        },
        record.analysis,
        record.marks,
        record.clip,
        { still: item.still, thumb: item.thumb },
        record.meta.score,
      );
      outcome.ids.push(id);
      // 動画本体 → 音のグラフの順（動画を付けると前の音のグラフが捨てられるため）
      if (item.video) {
        try {
          if (item.video.bytes.byteLength > VIDEO_MAX_BYTES) outcome.videoTooLarge++;
          else await setRecordVideo(id, item.video);
        } catch {
          outcome.videoFailed++;
        }
      }
      if (item.audio) await setRecordAudio(id, decodeAudio(item.audio));
    } catch {
      outcome.failed++;
    }
    done++;
    onProgress?.(done);
  }
  return outcome;
}
