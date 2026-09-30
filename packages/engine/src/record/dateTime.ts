// 撮影日時。端末の現地時刻を 'YYYY-MM-DDTHH:mm' の文字列で持つ。
// 時差の情報を持たせないのは、別の端末へ渡しても（段階⑥）撮ったときの時刻のまま表示するため。

export interface LocalDateTime {
  year: number;
  /** 1〜12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 曜日。0 = 日曜、6 = 土曜 */
  weekday: number;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** Date を端末の現地時刻の文字列に直す（秒以下は切り捨て） */
export function toLocalDateTime(date: Date): string {
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * 'YYYY-MM-DDTHH:mm' を分解する。秒が付いていても受け付ける（入力欄が秒を付けるブラウザがある）。
 * 形式が違う、または存在しない日時（2 月 30 日など）なら null。
 */
export function parseLocalDateTime(text: string): LocalDateTime | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(text);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (hour > 23 || minute > 59) return null;
  // 曜日は暦だけで決まるので、時差の影響を受けない UTC で計算する
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCFullYear(year);
  if (utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return { year, month, day, hour, minute, weekday: utc.getUTCDay() };
}

/** 保存用に整える（秒を落とす）。不正なら null */
export function normalizeLocalDateTime(text: string): string | null {
  const p = parseLocalDateTime(text);
  if (!p) return null;
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
