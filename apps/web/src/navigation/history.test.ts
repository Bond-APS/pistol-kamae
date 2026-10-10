import { describe, expect, it } from 'vitest';
import { createNav, type NavEntry, type NavEnv } from './history';

/** ブラウザの履歴の代わり。積んだ状態と位置を持ち、go で popstate を起こす */
function fakeHistory() {
  const states: unknown[] = [null];
  let pos = 0;
  let popListener: ((state: unknown) => void) | null = null;
  const timers: (() => void)[] = [];
  const env: NavEnv = {
    pushState: (s) => {
      states.splice(pos + 1);
      states.push(s);
      pos += 1;
    },
    replaceState: (s) => {
      states[pos] = s;
    },
    go: (delta) => {
      pos = Math.max(0, Math.min(states.length - 1, pos + delta));
      popListener?.(states[pos]);
    },
    onPop: (l) => {
      popListener = l;
    },
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length - 1;
    },
    clearTimeout: () => {},
  };
  return {
    env,
    get pos() {
      return pos;
    },
    get length() {
      return states.length;
    },
    stateAt: (i: number) => states[i],
    /** 再読込を真似る：状態は残したまま、popstate の購読だけ付け替える */
    reload: () => {
      popListener = null;
    },
    fireTimers: () => timers.splice(0).forEach((fn) => fn()),
  };
}

const shooter: NavEntry = { view: 'save', step: 'shooter' };
const video: NavEntry = { view: 'save', step: 'video' };
const clip: NavEntry = { view: 'save', step: 'clip' };
const library: NavEntry = { view: 'library' };

describe('createNav', () => {
  it('起動時に先頭を起点に置き換え、積むと知らせる', () => {
    const h = fakeHistory();
    const nav = createNav(shooter, h.env);
    const seen: string[] = [];
    nav.subscribe((e, s) => seen.push(`${s}:${JSON.stringify(e)}`));
    expect(h.stateAt(0)).toMatchObject({ kamae: { idx: 0, entry: shooter } });
    nav.push(video);
    expect(nav.current()).toEqual(video);
    expect(nav.previous()).toEqual(shooter);
    expect(h.pos).toBe(1);
    expect(seen).toEqual([`push:${JSON.stringify(video)}`]);
  });

  it('戻ると 1 つ前の項目を pop として知らせ、位置が合う', () => {
    const h = fakeHistory();
    const nav = createNav(shooter, h.env);
    nav.push(video);
    nav.push(clip);
    const seen: NavEntry[] = [];
    nav.subscribe((e, s) => s === 'pop' && seen.push(e));
    nav.back(shooter);
    expect(seen).toEqual([video]);
    expect(nav.current()).toEqual(video);
    // 戻ったあとに積むと、「進む」の項目は捨てられる
    nav.push(library);
    expect(h.length).toBe(3);
    expect(nav.current()).toEqual(library);
    expect(nav.previous()).toEqual(video);
  });

  it('戻る先がなければ fallback に置き換えて知らせる', () => {
    const h = fakeHistory();
    const nav = createNav(shooter, h.env);
    const seen: NavEntry[] = [];
    nav.subscribe((e) => seen.push(e));
    nav.back(library);
    expect(h.pos).toBe(0);
    expect(nav.current()).toEqual(library);
    expect(seen).toEqual([library]);
  });

  it('unwindAndPush は条件に合う項目を取り除いてから積み、途中の合図は知らせない', () => {
    const h = fakeHistory();
    const nav = createNav(shooter, h.env);
    nav.push(video);
    nav.push(library);
    nav.push(video);
    nav.push(clip);
    nav.push({ view: 'save', step: 'shot' });
    nav.push({ view: 'save', step: 'form' });
    const seen: string[] = [];
    nav.subscribe((e, s) => seen.push(`${s}:${e.view}:${'step' in e ? e.step : ''}`));
    const done: NavEntry = { view: 'save', step: 'done' };
    nav.unwindAndPush((e) => e.view === 'save' && e.step !== 'shooter' && e.step !== 'done', done);
    expect(seen).toEqual(['push:save:done']);
    expect(nav.current()).toEqual(done);
    expect(nav.previous()).toEqual(library);
    expect(h.pos).toBe(3);
    expect(h.length).toBe(4);
  });

  it('unwindAndPush で取り除くものがなければ、そのまま積む', () => {
    const h = fakeHistory();
    const nav = createNav(shooter, h.env);
    nav.unwindAndPush(() => true, library);
    expect(nav.current()).toEqual(library);
    expect(nav.previous()).toEqual(shooter);
  });

  it('取り除く合図が来なければ、時間切れで積む', () => {
    const h = fakeHistory();
    // go しても popstate を起こさない履歴
    const silent: NavEnv = { ...h.env, go: () => {} };
    const nav = createNav(shooter, silent);
    nav.push(video);
    const done: NavEntry = { view: 'save', step: 'done' };
    nav.unwindAndPush((e) => e.view === 'save' && e.step === 'video', done);
    // 取り除く途中は、着地する項目を先頭として持つ
    expect(nav.current()).toEqual(shooter);
    h.fireTimers();
    expect(nav.current()).toEqual(done);
  });

  it('取り除く途中に頼まれた操作は、終わってから順に行う', () => {
    const h = fakeHistory();
    const silent: NavEnv = { ...h.env, go: () => {} };
    const nav = createNav(shooter, silent);
    nav.push(video);
    nav.push(clip);
    const done: NavEntry = { view: 'save', step: 'done' };
    nav.unwindAndPush((e) => e.view === 'save' && e.step !== 'shooter', done);
    // 途中に「ライブラリで見る」が押された
    nav.push(library);
    expect(nav.current()).toEqual(shooter);
    h.fireTimers();
    expect(nav.current()).toEqual(library);
    expect(nav.previous()).toEqual(done);
  });

  it('取り除く操作の着地が狙いと違えば、鏡をその位置に直してから積む', () => {
    const h = fakeHistory();
    // go(-2) を頼まれても 1 つしか戻らない履歴
    const short: NavEnv = { ...h.env, go: (delta) => h.env.go(Math.max(delta, -1)) };
    const nav = createNav(shooter, short);
    nav.push(video);
    nav.push(clip);
    const done: NavEntry = { view: 'save', step: 'done' };
    nav.unwindAndPush((e) => e.view === 'save' && e.step !== 'shooter', done);
    expect(nav.current()).toEqual(done);
    expect(nav.previous()).toEqual(video);
    expect(h.pos).toBe(2);
  });

  it('番号は合っても画面が違う目印は、古い項目として扱う', () => {
    const h = fakeHistory();
    const nav = createNav(shooter, h.env);
    nav.push(library);
    const seen: NavEntry[] = [];
    nav.subscribe((e, s) => s === 'pop' && seen.push(e));
    // 同じ番号（1）だが、鏡では library のところに save の目印が残っている
    const stale = h.stateAt(1) as { kamae: { sid: number; idx: number; entry: NavEntry } };
    h.env.replaceState({ kamae: { ...stale.kamae, entry: clip } });
    h.env.go(0);
    expect(seen).toEqual([shooter]);
    expect(nav.previous()).toBeNull();
  });

  it('再読込の前の項目へ戻ったら、その画面の起点として扱う', () => {
    const h = fakeHistory();
    const first = createNav(shooter, h.env);
    first.push(video);
    first.push(clip);
    h.reload();
    // 再読込：先頭（clip）が新しい起点に置き換わる
    const nav = createNav(shooter, h.env);
    expect(h.pos).toBe(2);
    const seen: NavEntry[] = [];
    nav.subscribe((e, s) => s === 'pop' && seen.push(e));
    h.env.go(-1);
    expect(seen).toEqual([shooter]);
    expect(nav.previous()).toBeNull();
    expect(h.stateAt(1)).toMatchObject({ kamae: { idx: 0, entry: shooter } });
  });

  it('目印のない項目（アプリの外）は知らせない', () => {
    const h = fakeHistory();
    const nav = createNav(shooter, h.env);
    const seen: NavEntry[] = [];
    nav.subscribe((e) => seen.push(e));
    h.env.replaceState(null);
    h.env.go(0);
    expect(seen).toEqual([]);
  });
});
