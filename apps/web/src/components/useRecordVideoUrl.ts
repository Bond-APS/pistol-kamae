import { useEffect, useState } from 'react';
import { getRecordVideo } from '../db/library';

/**
 * 記録の動画本体の状態。
 * loading：読み込み中、none：動画を保存していない記録、ready：表示できる（url は一時的な URL）
 */
export type RecordVideo =
  { state: 'loading' } | { state: 'none' } | { state: 'ready'; url: string };

/**
 * 保存してある動画本体を、video 要素に渡せる一時的な URL に直す。
 * 使い終わったら URL を解放する（解放しないと動画がメモリに残り続ける）。
 * version を変えると読み直す（動画を付け直したとき）。
 */
export function useRecordVideoUrl(recordId: number, version: number): RecordVideo {
  const [entry, setEntry] = useState<{ key: string; video: RecordVideo } | null>(null);
  const key = `${recordId}:${version}`;
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    void getRecordVideo(recordId).then(
      (video) => {
        if (!alive) return;
        if (!video) {
          setEntry({ key, video: { state: 'none' } });
          return;
        }
        url = URL.createObjectURL(new Blob([video.bytes], { type: video.type }));
        setEntry({ key, video: { state: 'ready', url } });
      },
      () => {
        if (alive) setEntry({ key, video: { state: 'none' } });
      },
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [recordId, key]);
  // 記録が替わった直後は、前の記録の（解放済みの）URL を返さない
  return entry && entry.key === key ? entry.video : { state: 'loading' };
}
