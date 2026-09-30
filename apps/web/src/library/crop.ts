import {
  coverRect,
  expandRect,
  personBounds,
  type CommonLandmarks,
  type ImageSize,
  type Rect,
} from '@pistol-kamae/engine';

/** 一覧用の小さい静止画の縦横比（幅 ÷ 高さ）。立った人物に合わせて縦長にする */
export const THUMB_ASPECT = 3 / 4;

/** 関節の点は体の輪郭より内側にあるので、頭の上や足先の分として足す余白（長い辺に対する割合） */
const PERSON_MARGIN = 0.15;

/** 人物に寄せた範囲。人物を検出できていなければ画像全体 */
export function personCrop(landmarks: CommonLandmarks | null, imageSize: ImageSize): Rect {
  const whole: Rect = { x: 0, y: 0, width: imageSize.width, height: imageSize.height };
  const bounds = landmarks ? personBounds(landmarks, imageSize) : null;
  return bounds ? expandRect(bounds, PERSON_MARGIN, imageSize) : whole;
}

/** 一覧用の切り抜き範囲。人物を中央に、決まった縦横比で */
export function thumbCrop(landmarks: CommonLandmarks | null, imageSize: ImageSize): Rect {
  return coverRect(personCrop(landmarks, imageSize), THUMB_ASPECT, imageSize);
}
