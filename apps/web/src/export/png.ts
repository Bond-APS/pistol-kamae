// 比較画面の重ねた絵を PNG にする（要件 9 章、2026-10-12 の決定）。
// 画面の大きさではなく、②比較の動画の画素（1 画素 ＝ 動画 1 画素）で描き直す。
// 上に帯を足し「①のタイトル ／ ②のタイトル〔全角スペース〕時点」を 1 行入れる。①基準の半透明と②比較、骨格の線を含む。
// 骨格は画面の SVG（SkeletonLayer）と同じ色・太さ・点線で canvas に描く。

import { composeAffine, type Affine, type ImageSize, type Rect } from '@pistol-kamae/engine';
import { SKELETON_COLORS, SKELETON_SIZES, type SkeletonParts } from '../components/skeleton';

/** 重ねる 1 枚（下から順） */
export interface PngLayer {
  /** 絵の元（video 要素か画像）。描けるものがなければ null（その層は飛ばす） */
  source: CanvasImageSource | null;
  /** 元の大きさ（画素） */
  size: ImageSize;
  /** 元の画素座標 → 枠（view）の座標 */
  transform: Affine;
  /** 濃さ（0〜1） */
  opacity: number;
}

export interface PngSkeleton {
  parts: SkeletonParts;
  variant: 'current' | 'base';
}

export interface PngInput {
  /** 表示範囲（②の画素座標。画像の外にはみ出すことがある） */
  view: Rect;
  layers: PngLayer[];
  skeletons: PngSkeleton[];
  /** 帯に書く 1 行 */
  title: string;
}

/** 帯の高さ（幅に対する割合）と、その下限・上限（画素） */
const BAND_RATIO = 0.045;
const BAND_MIN_PX = 28;
const BAND_MAX_PX = 96;
const BAND_BG = '#1a1a1a';
const BAND_FG = '#ffffff';
/** 枠の外（絵のないところ）の色 */
const EMPTY_BG = '#000000';

/** 帯の高さ（画素） */
export function bandHeight(viewWidth: number): number {
  return Math.round(Math.min(BAND_MAX_PX, Math.max(BAND_MIN_PX, viewWidth * BAND_RATIO)));
}

/** 文字が幅に収まるよう、末尾を … にして切る */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function drawSkeleton(ctx: CanvasRenderingContext2D, skeleton: PngSkeleton, scale: number): void {
  const base = skeleton.variant === 'base';
  const main = base ? SKELETON_COLORS.base : SKELETON_COLORS.usable;
  const color = (usable: boolean) => (usable ? main : SKELETON_COLORS.unusable);
  const { edges, points } = skeleton.parts;
  ctx.save();
  ctx.globalAlpha = base ? 0.85 : 1;
  ctx.lineCap = 'round';
  // 縁取りを先に
  ctx.strokeStyle = SKELETON_COLORS.outline;
  ctx.lineWidth = SKELETON_SIZES.outline * scale;
  ctx.setLineDash([]);
  for (const e of edges) {
    ctx.beginPath();
    ctx.moveTo(e.a.x, e.a.y);
    ctx.lineTo(e.b.x, e.b.y);
    ctx.stroke();
  }
  // 色の線（基準は点線）
  ctx.lineWidth = SKELETON_SIZES.line * scale;
  if (base) ctx.setLineDash([SKELETON_SIZES.line * 3 * scale, SKELETON_SIZES.line * 2.4 * scale]);
  for (const e of edges) {
    ctx.strokeStyle = color(e.usable);
    ctx.beginPath();
    ctx.moveTo(e.a.x, e.a.y);
    ctx.lineTo(e.b.x, e.b.y);
    ctx.stroke();
  }
  // 点
  ctx.setLineDash([]);
  ctx.strokeStyle = SKELETON_COLORS.outline;
  ctx.lineWidth = (SKELETON_SIZES.dotOutline - SKELETON_SIZES.dot) * scale;
  for (const { p, usable } of points) {
    ctx.fillStyle = color(usable);
    ctx.beginPath();
    ctx.arc(p.x, p.y, SKELETON_SIZES.dot * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** 重ねた絵を canvas に描く（描いた canvas を返す。テストで中身を見られるように分けている） */
export function drawOverlay(input: PngInput): HTMLCanvasElement {
  const { view, layers, skeletons, title } = input;
  const width = Math.max(1, Math.round(view.width));
  const height = Math.max(1, Math.round(view.height));
  const band = bandHeight(width);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height + band;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');

  // 帯
  ctx.fillStyle = BAND_BG;
  ctx.fillRect(0, 0, width, band);
  ctx.fillStyle = BAND_FG;
  ctx.font = `${Math.round(band * 0.5)}px system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(fitText(ctx, title, width - band), band * 0.4, band / 2);

  // 絵：枠の座標 → canvas の画素（帯の下、view の左上を原点に）
  ctx.fillStyle = EMPTY_BG;
  ctx.fillRect(0, band, width, height);
  const toCanvas: Affine = { a: 1, b: 0, c: 0, d: 1, e: -view.x, f: band - view.y };
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, band, width, height);
  ctx.clip();
  for (const layer of layers) {
    if (!layer.source) continue;
    const m = composeAffine(toCanvas, layer.transform);
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.drawImage(layer.source, 0, 0, layer.size.width, layer.size.height);
    ctx.restore();
  }
  ctx.setTransform(toCanvas.a, toCanvas.b, toCanvas.c, toCanvas.d, toCanvas.e, toCanvas.f);
  const scale = Math.max(view.width, view.height) / 1000;
  for (const s of skeletons) drawSkeleton(ctx, s, scale);
  ctx.restore();
  return canvas;
}

/** canvas を PNG のファイルの中身にする */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('could not encode png'));
    }, 'image/png');
  });
}

/** canvas に描ける画像と、使い終わったら呼ぶ後片付け */
export interface LoadedImage {
  image: HTMLImageElement;
  release: () => void;
}

/** 保存してある静止画（バイト列）を、canvas に描ける画像にする。描き終えたら release で一時 URL を手放す */
export async function imageFromBytes(bytes: ArrayBuffer, type: string): Promise<LoadedImage> {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  return { image, release: () => URL.revokeObjectURL(url) };
}

/**
 * video 要素がシークを終えて絵を出せる状態になるまで待つ（つまみを動かした直後に押したときに、前のコマを撮らないため）。
 * 時間切れなら失敗にする
 */
export function waitVideoSettled(video: HTMLVideoElement, timeoutMs = 2000): Promise<void> {
  const settled = () => !video.seeking && video.readyState >= 2;
  if (settled()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (settled()) resolve();
      else if (Date.now() - started > timeoutMs) reject(new Error('video not ready'));
      else setTimeout(poll, 50);
    };
    poll();
  });
}

export async function renderOverlayPng(input: PngInput): Promise<Blob> {
  return canvasToPng(drawOverlay(input));
}
