import type { LandmarkFrame } from '@pistol-kamae/engine';
import { ja } from '../i18n/ja';

/** 選んだ時点を、撃発からの秒数で表す。例：撃発の 1.20 秒前 */
export function relativeTimeLabel(
  frames: ReadonlyArray<LandmarkFrame>,
  index: number,
  shotIndex: number,
): string {
  if (index === shotIndex) return ja.compare.atShot;
  const dt = (frames[index]?.timeSec ?? 0) - (frames[shotIndex]?.timeSec ?? 0);
  return dt < 0 ? ja.compare.beforeShot(-dt) : ja.compare.afterShot(dt);
}
