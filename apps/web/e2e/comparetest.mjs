// 段階⑤の比較画面の自動テスト。ライブラリで 2 件を選んで比較に入り、1 本のバー（0 ＝ 撃発）、
// 再生・速さ・繰り返し、音のグラフ、撃発ポイント・切り抜き範囲の修正の入口を確かめる。
// 開発サーバ（npm run dev）を起動した状態で使う。
//   node apps/web/e2e/comparetest.mjs webkit
//   node apps/web/e2e/comparetest.mjs chromium
// 動画は shot.mp4（発射音入り、5 秒。作り方は savetest.mjs）と motion.mp4（音声なし、4 秒。作り方は marktest.mjs）。
// 結果は apps/web/e2e/results/compare-<ブラウザ名>.json に保存する（git 管理外）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const [browserName = 'webkit'] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:5173';
const videos = {
  shot: join(here, 'videos', 'shot.mp4'),
  motion: join(here, 'videos', 'motion.mp4'),
};

const launcher = { chromium, webkit }[browserName];
if (!launcher) throw new Error(`unknown browser: ${browserName}`);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`  ${ok ? 'OK  ' : 'NG  '} ${name}${detail === '' ? '' : `  [${detail}]`}`);
};

const browser = await launcher.launch({ headless: process.env.HEADLESS === '1' });
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
// 角度の数値は既定では隠れている。このテストは差分表を読むので、最初から「表示」にしておく
await page.addInitScript(() => window.localStorage.setItem('kamae.showNumbers', '1'));
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const tid = (id) => page.locator(`[data-testid=${id}]`);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const slideTo = async (barId, sec) => {
  await tid(`${barId}-slider`).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, sec);
  await page.waitForTimeout(300);
};
const waitSettled = (playerId) =>
  page.waitForFunction(
    (id) => {
      const v = document.querySelector(`[data-testid=${id}-stage] video`);
      return v && v.readyState >= 2 && !v.seeking && v.paused;
    },
    playerId,
    { timeout: 10_000 },
  );
/** 比較画面の 2 本の video の状態（base：①基準、current：②比較） */
const stageVideos = async () => {
  const list = await page
    .locator('[data-testid=stage-video-base], [data-testid=stage-video-current]')
    .evaluateAll((vs) =>
      vs.map((v) => [
        v.dataset.testid.replace('stage-video-', ''),
        { t: v.currentTime, paused: v.paused, rate: v.playbackRate, ready: v.readyState },
      ]),
    );
  return Object.fromEntries(list);
};
const waitBothReady = () =>
  page.waitForFunction(
    () => {
      const vs = document.querySelectorAll(
        '[data-testid=stage-video-base], [data-testid=stage-video-current]',
      );
      return vs.length === 2 && [...vs].every((v) => v.readyState >= 2 && !v.seeking);
    },
    null,
    { timeout: 20_000 },
  );
const compareIndexes = async () => ({
  base: Number(await tid('compare-time').getAttribute('data-base-index')),
  current: Number(await tid('compare-time').getAttribute('data-current-index')),
});

/** 動画を 1 本保存する。clip を渡せば切り抜く。撃発は shotSec（省略すれば音の最大、音がなければ 2.0 秒） */
async function saveVideo(path, title, { clip, shotSec } = {}) {
  await tid('tab-save').click();
  await tid('video-file').setInputFiles(path);
  await tid('run-analysis').click({ timeout: 60_000 });
  await tid('analysis-done').waitFor({ timeout: 15 * 60_000 });
  await tid('go-clip').click();
  await tid('clip-player').waitFor();
  await waitSettled('clip-player');
  if (clip) {
    await slideTo('clip-player-bar', clip[0]);
    await waitSettled('clip-player');
    await tid('clip-set-start').click();
    await slideTo('clip-player-bar', clip[1]);
    await waitSettled('clip-player');
    await tid('clip-set-end').click();
  }
  await tid('clip-confirm').click();
  await tid('shot-player').waitFor();
  await waitSettled('shot-player');
  // 音のグラフが出るなら、音の最大に置かれるのを待つ
  await page.waitForTimeout(1500);
  if (shotSec !== undefined) {
    await slideTo('shot-player-bar', shotSec);
    await waitSettled('shot-player');
  }
  const noAudio = (await page.locator('.wave-none').count()) === 1;
  const sec = Number(await tid('shot-player-bar').getAttribute('data-value-sec'));
  await tid('shot-set').click();
  await tid('shot-player-bar-marker-shot').waitFor({ timeout: 15_000 });
  await tid('shot-to-save').click();
  await tid('form-title').fill(title);
  await tid('form-submit').click();
  await tid('save-done').waitFor({ timeout: 30_000 });
  const id = Number(await tid('save-done').getAttribute('data-saved-id'));
  await tid('save-next').click();
  return { id, shotSec: sec, noAudio };
}

let fatal = null;
const summary = {};
try {
  console.log(`open ${base} (${browserName})`);
  await page.goto(base);
  await tid('shooter-register').click();
  await tid('shooter-name').fill('テスト射手');
  await tid('shooter-right').click();
  await tid('shooter-submit').click();
  await tid('shooter-select').waitFor();

  console.log('  動画を 2 本保存中…');
  const a = await saveVideo(videos.shot, '発射音あり', { clip: [1.0, 4.0] });
  const b = await saveVideo(videos.motion, '音声なし', { shotSec: 2.0 });
  summary.records = { a, b };
  check(
    '音声のない動画では「音声なし」と出て、手で撃発を指定できる',
    b.noAudio && near(b.shotSec, 2.0, 0.05),
    JSON.stringify(b),
  );
  check(
    '発射音のある動画では音の最大に置かれる',
    !a.noAudio && near(a.shotSec, 2.5, 0.3),
    JSON.stringify(a),
  );

  // ライブラリで 2 件を選ぶ：最初の◯が①基準、次が②比較
  await tid('tab-library').click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid=lib-item]').length === 2,
  );
  const item = (id) => page.locator(`[data-testid=lib-item][data-record-id="${id}"]`);
  check('選ぶ前は比較のバーが出ない', (await tid('pick-bar').count()) === 0);
  await item(b.id).locator('[data-testid=lib-pick]').click();
  check(
    '1 件目を選ぶと①になり、もう 1 件を促す',
    (await item(b.id).getAttribute('data-pick')) === '1' &&
      (await tid('pick-line').textContent()).includes('もう 1 件選ぶ'),
    await tid('pick-line').textContent(),
  );
  check('1 件だけでは「比較する」が押せない', await tid('pick-compare').isDisabled());
  await item(a.id).locator('[data-testid=lib-pick]').click();
  check('2 件目は②', (await item(a.id).getAttribute('data-pick')) === '2');
  check(
    '①基準・②比較の表示',
    (await tid('pick-line').textContent()) === '①基準：音声なし　②比較：発射音あり',
    await tid('pick-line').textContent(),
  );
  await tid('pick-swap').click();
  check(
    '⇄ で入れ替わる',
    (await tid('pick-line').textContent()) === '①基準：発射音あり　②比較：音声なし' &&
      (await item(a.id).getAttribute('data-pick')) === '1',
  );
  // もう一度押すと外れる
  await item(a.id).locator('[data-testid=lib-pick]').click();
  check(
    '◯をもう一度押すと外れ、残った 1 件が①になる',
    (await item(a.id).getAttribute('data-pick')) === '' &&
      (await item(b.id).getAttribute('data-pick')) === '1',
  );
  await item(a.id).locator('[data-testid=lib-pick]').click();
  await tid('pick-swap').click();
  // ①基準：発射音あり（A）、②比較：音声なし（B）
  await tid('pick-compare').click();

  // 比較画面
  await tid('compare').waitFor();
  await tid('compare-bar').waitFor();
  check('入口のタブが比較では選択なし', (await page.locator('.tab.active').count()) === 0);
  check(
    '見出しに①と②のタイトル',
    (await tid('compare-pair').textContent()).includes('①発射音あり') &&
      (await tid('compare-pair').textContent()).includes('②音声なし'),
    await tid('compare-pair').textContent(),
  );
  await waitBothReady();
  const min = Number(await tid('compare-bar-slider').getAttribute('min'));
  const max = Number(await tid('compare-bar-slider').getAttribute('max'));
  // A：撃発 ≈ 2.47、範囲 1.0〜4.0 → 前 1.47・後 1.53。B：撃発 2.0、全体 4.03 秒 → 前 2.0・後 2.03。共通は短い方
  const expectBefore = a.shotSec - 1.0;
  const expectAfter = 4.0 - a.shotSec;
  check(
    'バーの範囲が 2 本に共通する区間（撃発の前後それぞれ短い方）',
    near(-min, expectBefore, 0.1) && near(max, expectAfter, 0.1),
    `${min}〜${max} (expected -${expectBefore.toFixed(2)}〜${expectAfter.toFixed(2)})`,
  );
  check('開いた直後は撃発の瞬間', (await tid('compare-time').textContent()).includes('撃発の瞬間'));
  check('撃発の印が 0 にある', (await tid('compare-bar-marker-shot').count()) === 1);
  check(
    '音のグラフは音のある 1 本分',
    (await page.locator('[data-testid=compare-bar-wave] path').count()) === 1,
  );
  const at0 = await compareIndexes();
  await tid('compare-next').click();
  await page.waitForTimeout(400);
  const at1 = await compareIndexes();
  check(
    '1 コマ送りで 2 本とも進む',
    at1.current === at0.current + 1 && at1.base === at0.base + 1,
    `${JSON.stringify(at0)} → ${JSON.stringify(at1)}`,
  );
  check(
    '時点の表示が「撃発の 0.03 秒後」',
    /撃発の 0\.0[34] 秒後/.test(await tid('compare-time').textContent()),
    await tid('compare-time').textContent(),
  );
  await tid('compare-prev').click();
  await page.waitForTimeout(400);
  check('1 コマ戻しで撃発に戻る', (await tid('compare-time').textContent()).includes('撃発の瞬間'));

  // 再生：1/4 の速さで 2 本とも再生され、止めると揃っている
  await tid('compare-rate-25').click();
  await tid('compare-play').click();
  await page.waitForTimeout(1500);
  const playing = await stageVideos();
  check(
    '1/4 の速さで 2 本とも再生される',
    Object.keys(playing).length === 2 &&
      Object.values(playing).every((v) => !v.paused && v.rate === 0.25),
    JSON.stringify(playing),
  );
  await tid('compare-play').click();
  await page.waitForTimeout(500);
  const paused = await stageVideos();
  const atPause = await compareIndexes();
  check(
    '止めると 2 本とも止まり、撃発からの相対時刻が揃う',
    Object.values(paused).every((v) => v.paused) &&
      near(paused.base.t - a.shotSec - (paused.current.t - 2.0), 0, 0.08),
    `${JSON.stringify(paused)} idx=${JSON.stringify(atPause)}`,
  );
  // 繰り返し：区間の終わりで先頭に戻る
  await tid('compare-rate-100').click();
  await tid('compare-loop').click();
  await slideTo('compare-bar', max - 0.3);
  await waitBothReady();
  await tid('compare-play').click();
  await page.waitForTimeout(1800);
  const looped = await stageVideos();
  const tLoop = looped.current.t - 2.0; // ②比較（B）の撃発からの時刻
  check(
    '繰り返しで区間の先頭に戻って続く',
    Object.values(looped).every((v) => !v.paused) && tLoop < 0.5 && tLoop >= -expectBefore - 0.1,
    `t=${tLoop.toFixed(2)} ${JSON.stringify(looped)}`,
  );
  await tid('compare-play').click();
  await tid('compare-loop').click();

  // 差分表（数値は表示にしてある）
  check('差分表が出る', (await tid('diff-table').count()) === 1);
  await page.screenshot({
    path: join(here, 'results', `compare-${browserName}.png`),
    fullPage: true,
  });

  // 撃発ポイントの修正：どちらを直すか選び、プレイヤーが開く
  await tid('compare-fix-shot').click();
  await tid('compare-fix-which').waitFor();
  await tid('compare-fix-base').click();
  await tid('record-player').waitFor();
  check(
    '基準の撃発ポイントの修正が開く',
    (await tid('record-player').getAttribute('data-mode')) === 'shot' &&
      (await tid('player-title').textContent()) === '発射音あり',
  );
  await waitSettled('player');
  await tid('player-next').click();
  await waitSettled('player');
  const fixedShot = Number(await tid('player-bar').getAttribute('data-value-sec'));
  await tid('shot-set').click();
  await tid('player-saved').waitFor({ timeout: 15_000 });
  await tid('player-back').click();
  await tid('compare-bar').waitFor();
  await waitBothReady();
  const min2 = Number(await tid('compare-bar-slider').getAttribute('min'));
  check(
    '直した撃発ポイントで共通の区間が計算し直される',
    near(-min2, fixedShot - 1.0, 0.1),
    `${min2} (expected -${(fixedShot - 1.0).toFixed(2)})`,
  );
  await tid('compare-fix-clip').click();
  await tid('compare-fix-current').click();
  await tid('record-player').waitFor();
  check(
    '比較の切り抜き範囲の修正が開く',
    (await tid('record-player').getAttribute('data-mode')) === 'clip' &&
      (await tid('player-title').textContent()) === '音声なし',
  );
  await tid('player-back').click();
  await tid('compare-bar').waitFor();

  // ライブラリへ戻る
  await tid('compare-back').click();
  await tid('pick-bar').waitFor();
  check(
    'ライブラリへ戻ると 2 件が選ばれたまま',
    (await tid('pick-line').textContent()).includes('①基準：発射音あり'),
  );
} catch (e) {
  fatal = e instanceof Error ? (e.stack ?? e.message) : String(e);
  await page
    .screenshot({ path: join(here, 'results', `compare-${browserName}-error.png`), fullPage: true })
    .catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `compare-${browserName}.json`);
writeFileSync(
  outFile,
  JSON.stringify({ browser: browserName, base, fatal, summary, checks, logs }, null, 2),
);
await browser.close();

console.log(`saved ${outFile}`);
if (fatal) console.log(`FATAL: ${fatal}`);
if (logs.length) console.log(`console: ${logs.length} 件（結果ファイル参照）`);
console.log(`${checks.length - failed.length} / ${checks.length} 合格`);
process.exit(fatal || failed.length ? 1 : 0);
