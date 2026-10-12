import { useCallback, useEffect, useRef, useState } from 'react';
import { deliverFile } from './deliver';

/** ready：中身はできたが、共有シートを開くにはボタンを押し直してもらう必要がある */
export type ExportStatus = 'idle' | 'busy' | 'ready' | 'done' | 'failed';

/** 「✓ 書き出しました」を出しておく時間（ミリ秒） */
const DONE_SHOWN_MS = 4000;

export interface ExportFile {
  blob: Blob;
  name: string;
}

/**
 * 書き出しボタンの共通の動き：中身を作る → 共有シートかダウンロードで渡す → 結果を短く出す。
 * build は、ファイルの中身（Blob）と名前を返す。共有シートを閉じただけなら何も出さない。
 * 共有シートが「押した直後」でないため開けなかったときは ready にし、「共有する」（share）で押し直してもらう
 */
export function useExport(): {
  status: ExportStatus;
  run: (build: () => Promise<ExportFile>) => Promise<void>;
  /** ready のとき、ボタンを押した直後に呼ぶ（共有シートを開く） */
  share: () => void;
} {
  const [status, setStatus] = useState<ExportStatus>('idle');
  const pending = useRef<ExportFile | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const finish = useCallback((result: 'shared' | 'downloaded' | 'cancelled' | 'needsGesture') => {
    if (result === 'needsGesture') {
      setStatus('ready');
      return;
    }
    pending.current = null;
    if (result === 'cancelled') {
      setStatus('idle');
      return;
    }
    setStatus('done');
    timer.current = setTimeout(() => setStatus('idle'), DONE_SHOWN_MS);
  }, []);
  const run = useCallback(
    async (build: () => Promise<ExportFile>) => {
      if (timer.current !== null) clearTimeout(timer.current);
      pending.current = null;
      setStatus('busy');
      try {
        const file = await build();
        pending.current = file;
        finish(await deliverFile(file.blob, file.name));
      } catch {
        pending.current = null;
        setStatus('failed');
      }
    },
    [finish],
  );
  const share = useCallback(() => {
    const file = pending.current;
    if (!file) return;
    // 押した直後に呼ぶ（await を挟まない）。それでも開けなければ ready のまま
    void deliverFile(file.blob, file.name).then(finish, () => setStatus('failed'));
  }, [finish]);
  return { status, run, share };
}
