import { describe, expect, it } from 'vitest';
import {
  addCustomMark,
  nextMarkId,
  normalizeMarkLabel,
  removeMark,
  setShotMark,
  shotMarkOf,
} from '../src/marks/operations';
import { SHOT_MARK_ID, type Mark } from '../src/marks/types';

describe('撃発マーク', () => {
  it('付けていなければ null', () => {
    expect(shotMarkOf([])).toBeNull();
  });

  it('付けると 1 つだけ入る', () => {
    const marks = setShotMark([], 5.2);
    expect(marks).toEqual([{ id: SHOT_MARK_ID, kind: 'shot', label: '', timeSec: 5.2 }]);
    expect(shotMarkOf(marks)?.timeSec).toBe(5.2);
  });

  it('付け直すと時刻だけが変わり、2 つにはならない', () => {
    const marks = setShotMark(setShotMark([], 5.2), 6.0);
    expect(marks.filter((m) => m.kind === 'shot')).toHaveLength(1);
    expect(shotMarkOf(marks)?.timeSec).toBe(6.0);
  });

  it('付け直しても任意マークは残る', () => {
    let marks = addCustomMark([], { id: 'a', label: '振り上げ開始', timeSec: 1 });
    marks = setShotMark(marks, 5);
    marks = setShotMark(marks, 6);
    expect(marks.map((m) => m.id)).toEqual(['a', SHOT_MARK_ID]);
  });

  it('元の一覧を書き換えない', () => {
    const before: Mark[] = [];
    setShotMark(before, 1);
    expect(before).toEqual([]);
  });
});

describe('任意マーク', () => {
  it('何個でも追加でき、時刻順に並ぶ', () => {
    let marks = addCustomMark([], { id: 'b', label: '据銃開始', timeSec: 3 });
    marks = addCustomMark(marks, { id: 'a', label: '振り上げ開始', timeSec: 1 });
    marks = setShotMark(marks, 2);
    expect(marks.map((m) => m.timeSec)).toEqual([1, 2, 3]);
    expect(marks.map((m) => m.label)).toEqual(['振り上げ開始', '', '据銃開始']);
  });

  it('同じ時刻なら撃発が先、任意マーク同士は追加した順', () => {
    let marks = addCustomMark([], { id: 'a', label: '一つ目', timeSec: 2 });
    marks = addCustomMark(marks, { id: 'b', label: '二つ目', timeSec: 2 });
    marks = setShotMark(marks, 2);
    expect(marks.map((m) => m.id)).toEqual([SHOT_MARK_ID, 'a', 'b']);
  });

  it('名前の前後の空白は除く', () => {
    const marks = addCustomMark([], { id: 'a', label: '  振り上げ開始 ', timeSec: 1 });
    expect(marks[0]?.label).toBe('振り上げ開始');
  });

  it('名前が空なら追加しない', () => {
    expect(addCustomMark([], { id: 'a', label: '   ', timeSec: 1 })).toEqual([]);
    expect(normalizeMarkLabel('')).toBeNull();
    expect(normalizeMarkLabel(' a ')).toBe('a');
  });

  it('id が重複していれば追加しない', () => {
    const marks = addCustomMark([], { id: 'a', label: '一つ目', timeSec: 1 });
    expect(addCustomMark(marks, { id: 'a', label: '二つ目', timeSec: 2 })).toEqual(marks);
  });

  it('同じ名前のマークを複数付けられる', () => {
    let marks = addCustomMark([], { id: 'a', label: '息を止める', timeSec: 1 });
    marks = addCustomMark(marks, { id: 'b', label: '息を止める', timeSec: 2 });
    expect(marks).toHaveLength(2);
  });
});

describe('nextMarkId', () => {
  it('使われていない番号を返す（削除後も重複しない）', () => {
    expect(nextMarkId([])).toBe('c1');
    let marks = setShotMark([], 1);
    marks = addCustomMark(marks, { id: nextMarkId(marks), label: '一つ目', timeSec: 1 });
    marks = addCustomMark(marks, { id: nextMarkId(marks), label: '二つ目', timeSec: 2 });
    expect(marks.map((m) => m.id)).toEqual([SHOT_MARK_ID, 'c1', 'c2']);
    marks = removeMark(marks, 'c1');
    expect(nextMarkId(marks)).toBe('c3');
  });
});

describe('削除', () => {
  it('指定したマークだけが消える', () => {
    let marks = addCustomMark([], { id: 'a', label: '一つ目', timeSec: 1 });
    marks = addCustomMark(marks, { id: 'b', label: '二つ目', timeSec: 2 });
    marks = setShotMark(marks, 3);
    expect(removeMark(marks, 'a').map((m) => m.id)).toEqual(['b', SHOT_MARK_ID]);
  });

  it('撃発マークも削除できる', () => {
    const marks = removeMark(setShotMark([], 3), SHOT_MARK_ID);
    expect(shotMarkOf(marks)).toBeNull();
  });

  it('存在しない id なら何も変わらない', () => {
    const marks = setShotMark([], 3);
    expect(removeMark(marks, 'zzz')).toEqual(marks);
  });
});
