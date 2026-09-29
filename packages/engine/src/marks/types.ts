// マーク（動画上の目印）。要件 5 章 3：撃発（必須・1 動画に 1 つ）と、任意の名前のマーク（任意個）。
// 位置はフレーム番号ではなく媒体時刻（秒）で持つ。フレーム番号は姿勢推定のやり直しで変わりうるため。

export type MarkKind = 'shot' | 'custom';

export interface Mark {
  /** 動画内で一意の識別子。撃発マークは常に SHOT_MARK_ID */
  id: string;
  kind: MarkKind;
  /** 任意マークの名前。撃発マークは空文字（表示名は UI 側が持つ） */
  label: string;
  /** マークを付けたフレームの媒体時刻（秒） */
  timeSec: number;
}

export const SHOT_MARK_ID = 'shot';
