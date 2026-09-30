import type { StoredImage } from '../db/schema';
import { useImageUrl } from './useImageUrl';

interface Props {
  image: StoredImage;
  className?: string;
  alt: string;
}

/** 保存してある画像を表示する */
export function StoredImg({ image, className, alt }: Props) {
  const url = useImageUrl(image);
  if (!url) return <span className={className} />;
  return <img className={className} src={url} alt={alt} loading="lazy" decoding="async" />;
}
