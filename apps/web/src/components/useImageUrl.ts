import { useEffect, useState } from 'react';
import type { StoredImage } from '../db/schema';

/**
 * 保存してある画像データを、画面に出せる一時的な URL に直す。
 * 使い終わったら URL を解放する（解放しないと画像がメモリに残り続ける）。
 */
export function useImageUrl(image: StoredImage | null): string | null {
  const [entry, setEntry] = useState<{ image: StoredImage; url: string } | null>(null);
  useEffect(() => {
    if (!image) return;
    const url = URL.createObjectURL(new Blob([image.bytes], { type: image.type }));
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) setEntry({ image, url });
    });
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [image]);
  // 画像が替わった直後は、前の画像の（解放済みの）URL を返さない
  return entry && entry.image === image ? entry.url : null;
}
