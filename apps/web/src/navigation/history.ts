/**
 * 画面の履歴（最終-10）。
 *
 * 画面の切り替えは React の状態で行っているため、そのままではブラウザの「戻る」（Android の戻るボタン、
 * iPhone の画面左端からのスワイプ）でアプリの外へ出てしまい、解析結果が消える。そこで、画面の段階が進む
 * たびにブラウザの履歴へ 1 つ積み（pushState）、「戻る」の合図（popstate）が来たら各画面にその項目を知らせて、
 * 1 つ前の段階に戻してもらう。画面の「戻る」ボタンも、履歴を 1 つ戻す（history.back）形にそろえる。
 *
 * 履歴の項目は「どの画面の、どの段階か」だけを持つ。URL は変えない（共有や再読込での復元は目的にしない）。
 * 再読込のあとに残った古い項目は、起動ごとに変わる番号（sid）で見分け、その画面の起点として扱う。
 */
import type { PlayerMode } from '../screens/RecordPlayer';
import type { SaveStep } from '../screens/SaveScreen';

/** 履歴の 1 項目 */
export type NavEntry =
  | { view: 'save'; step: SaveStep }
  | { view: 'library'; detail?: number; player?: PlayerMode }
  | { view: 'compare'; edit?: 'shot' | 'clip' }
  | { view: 'noise' };

/** 項目が知らされた理由。push＝画面が積んだ（タブの切り替えなど）、pop＝ブラウザの「戻る」「進む」 */
export type NavSource = 'push' | 'pop';
export type NavListener = (entry: NavEntry, source: NavSource) => void;

export interface Nav {
  /** 今の項目（履歴の先頭） */
  current(): NavEntry;
  /** 1 つ前の項目。分からなければ null */
  previous(): NavEntry | null;
  /** 1 つ積み、各画面に知らせる */
  push(entry: NavEntry): void;
  /** 先頭を置き換える（知らせない） */
  replace(entry: NavEntry): void;
  /**
   * 1 つ戻る（結果は popstate で届く）。戻る先が分からないとき（再読込のあとなど）は、先頭を fallback に
   * 置き換えて、戻ったものとして知らせる
   */
  back(fallback: NavEntry): void;
  /**
   * 先頭から続く「drop が真の項目」を履歴から取り除いてから、entry を積む（保存の完了で、その動画のために
   * 積んだ段階を消すため）。取り除く途中の合図は各画面に知らせない
   */
  unwindAndPush(drop: (entry: NavEntry) => boolean, entry: NavEntry): void;
  subscribe(listener: NavListener): () => void;
}

/** 履歴に持たせる状態 */
interface Mark {
  kamae: { sid: number; idx: number; entry: NavEntry };
}

/** ブラウザの履歴のうち、使う部分（テストで差し替える） */
export interface NavEnv {
  pushState(state: unknown): void;
  replaceState(state: unknown): void;
  go(delta: number): void;
  /** popstate の購読。届いた状態を渡す */
  onPop(listener: (state: unknown) => void): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const browserEnv = (): NavEnv => ({
  pushState: (state) => window.history.pushState(state, ''),
  replaceState: (state) => window.history.replaceState(state, ''),
  go: (delta) => window.history.go(delta),
  onPop: (listener) => window.addEventListener('popstate', (e) => listener(e.state)),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id as number),
});

/** 履歴から取り除く操作（history.go）の合図を待つ上限。来なければ先へ進む */
const UNWIND_TIMEOUT_MS = 1000;

const markOf = (state: unknown): Mark['kamae'] | null => {
  const m = (state as Partial<Mark> | null)?.kamae;
  return m && typeof m.sid === 'number' && typeof m.idx === 'number' && m.entry ? m : null;
};

/** 古い項目（再読込の前のもの）を、その画面の起点に読み替える */
const baseOf = (entry: NavEntry): NavEntry => {
  switch (entry.view) {
    case 'save':
      return { view: 'save', step: 'shooter' };
    case 'library':
      return { view: 'library' };
    case 'compare':
      return { view: 'compare' };
    case 'noise':
      return { view: 'noise' };
  }
};

export function createNav(origin: NavEntry, env: NavEnv = browserEnv()): Nav {
  const sid = Date.now() + Math.random();
  let stack: NavEntry[] = [origin];
  let idx = 0;
  const entryAt = (i: number): NavEntry => stack[i] ?? origin;
  const listeners = new Set<NavListener>();
  /** 取り除く操作の途中。終わったら積む項目と、待ちの上限 */
  let unwinding: { entry: NavEntry; timer: unknown } | null = null;
  /** 取り除く操作の途中に頼まれた操作。終わってから順に行う（鏡とブラウザの履歴がずれないように） */
  let deferred: (() => void)[] = [];

  const mark = (): Mark => ({ kamae: { sid, idx, entry: entryAt(idx) } });
  const notify = (entry: NavEntry, source: NavSource) => {
    for (const l of [...listeners]) l(entry, source);
  };
  const doPush = (entry: NavEntry) => {
    stack = stack.slice(0, idx + 1);
    stack.push(entry);
    idx += 1;
    env.pushState(mark());
    notify(entry, 'push');
  };
  const finishUnwind = () => {
    if (!unwinding) return;
    const { entry, timer } = unwinding;
    unwinding = null;
    env.clearTimeout(timer);
    // 着地した位置より上の項目は、積むときに捨てられる
    stack = stack.slice(0, idx + 1);
    doPush(entry);
    const queued = deferred;
    deferred = [];
    for (const op of queued) op();
  };
  /** 取り除く操作の途中なら後回しにして true */
  const defer = (op: () => void) => {
    if (!unwinding) return false;
    deferred.push(op);
    return true;
  };
  /** 届いた目印が、いま持っている鏡の項目と合うか（再読込の前の項目や、ずれた項目を見分ける） */
  const matches = (m: Mark['kamae']) =>
    m.sid === sid && m.idx < stack.length && entryAt(m.idx).view === m.entry.view;

  // 起動時：先頭を起点に置き換える（再読込で残った目印を消す）
  env.replaceState(mark());

  env.onPop((state) => {
    const m = markOf(state);
    if (unwinding) {
      // 着地した位置が狙いと違っていたら、鏡をその位置に直してから積む
      if (m && matches(m)) idx = m.idx;
      finishUnwind();
      return;
    }
    // 目印のない項目（このアプリの外）は扱わない
    if (!m) return;
    if (matches(m)) {
      idx = m.idx;
    } else {
      // 再読込の前の項目：その画面の起点として扱い、ここを新しい起点にする
      stack = [baseOf(m.entry)];
      idx = 0;
      env.replaceState(mark());
    }
    notify(entryAt(idx), 'pop');
  });

  const nav: Nav = {
    current: () => entryAt(idx),
    previous: () => (idx > 0 ? entryAt(idx - 1) : null),
    push: (entry) => {
      if (!defer(() => doPush(entry))) doPush(entry);
    },
    replace: (entry) => {
      if (defer(() => nav.replace(entry))) return;
      stack[idx] = entry;
      env.replaceState(mark());
    },
    back: (fallback) => {
      if (defer(() => nav.back(fallback))) return;
      if (idx > 0) env.go(-1);
      else {
        stack[idx] = fallback;
        env.replaceState(mark());
        notify(fallback, 'pop');
      }
    },
    unwindAndPush: (drop, entry) => {
      let j = idx;
      while (j > 0 && drop(entryAt(j))) j -= 1;
      const delta = idx - j;
      if (delta === 0) {
        doPush(entry);
        return;
      }
      // 鏡の項目は着地まで残しておく（着地が狙いと違ったときに、その位置へ直せるように）
      idx = j;
      unwinding = { entry, timer: env.setTimeout(finishUnwind, UNWIND_TIMEOUT_MS) };
      env.go(-delta);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return nav;
}
