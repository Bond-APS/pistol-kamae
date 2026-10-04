// 段階⑤の比較画面の自動テスト。ライブラリで 2 件を選んで比較に入り、1 本のバー（0 ＝ 撃発）、
// 再生・速さ・繰り返し、音のグラフ、重ねたままの撃発ポイント・切り抜き範囲の修正を確かめる。
// 開発サーバ（npm run dev）を起動した状態で使う。
//   node apps/web/e2e/comparetest.mjs webkit
//   node apps/web/e2e/comparetest.mjs chromium
// 動画は shot.mp4（発射音入り、5 秒。作り方は savetest.mjs）と motion.mp4（音声なし、4 秒。作り方は librarytest.mjs）。
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
  await tid('shooter-next').click();
  await tid('video-file').setInputFiles(path);
  await tid('run-analysis').click({ timeout: 60_000 });
  // 推定が終わると、自動で切り抜きへ進む
  await tid('clip-player').waitFor({ timeout: 15 * 60_000 });
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
  // 「撃発ポイントを確定」を押すと、自動で保存へ進む
  await tid('shot-set').click();
  await tid('form-summary').waitFor({ timeout: 15_000 });
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
    '比較のバーは丸いつまみのまま（▲ ではない）',
    (await page.locator('[data-testid=compare-bar] .wave-arrow').count()) === 0,
  );
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

  // 撃発ポイントの修正：重ねたまま、片方だけを 1 コマずつ動かすか、音の山に合わせる
  const shotEditAttr = async (name) => Number(await tid('compare-shot-edit').getAttribute(name));
  const minBefore = Number(await tid('compare-bar-slider').getAttribute('min'));
  await tid('compare-fix-shot').click();
  await tid('compare-shot-edit').waitFor();
  await waitBothReady();
  const zoomMin = Number(await tid('compare-bar-slider').getAttribute('min'));
  const zoomMax = Number(await tid('compare-bar-slider').getAttribute('max'));
  check(
    '撃発ポイントの修正は重ねたまま開き、バーが撃発の前後 1 秒になる',
    (await tid('compare-overlay').count()) === 1 &&
      near(zoomMin, -1, 0.02) &&
      near(zoomMax, 1, 0.02),
    `${zoomMin}〜${zoomMax}`,
  );
  check(
    '最初は②比較を動かす側。音のない動画では「音の山に合わせる」を押せず、理由が出る',
    (await tid('compare-shot-edit').getAttribute('data-role')) === 'current' &&
      (await tid('shot-edit-peak').isDisabled()) &&
      (await tid('shot-edit-no-audio').count()) === 1,
  );
  // ①基準（発射音あり）を 3 コマ早くする。保存した撃発ポイントは、発射音の山にいちばん近いコマ
  await tid('shot-edit-role-base').click();
  const savedShot = await shotEditAttr('data-base-shot');
  check(
    'すでに音の山にいるときは「音の山に合わせる」を押せない',
    await tid('shot-edit-peak').isDisabled(),
  );
  const index0 = await compareIndexes();
  for (let i = 0; i < 3; i++) await tid('shot-edit-earlier').click();
  await waitBothReady();
  const index1 = await compareIndexes();
  check(
    '「1 コマ早く」で、選んだ側（①基準）の絵だけが 1 コマずつ動く',
    index1.base === index0.base - 3 && index1.current === index0.current,
    `${JSON.stringify(index0)} → ${JSON.stringify(index1)}`,
  );
  check(
    '動かした量が数字で出る（3 コマ早く）。動かしていない側は「変更なし」',
    (await tid('shot-edit-line-base').textContent()).includes('3 コマ早く') &&
      (await tid('shot-edit-line-current').textContent()).includes('変更なし'),
    await tid('shot-edit-line-base').textContent(),
  );
  await page.screenshot({
    path: join(here, 'results', `compare-${browserName}-shotedit.png`),
    fullPage: true,
  });
  // 「音の山に合わせる」で、発射音の山（保存のときに置かれた位置）へ戻る
  await tid('shot-edit-peak').click();
  await waitBothReady();
  check(
    '「音の山に合わせる」で、撃発ポイントが発射音の山へ移る',
    near(await shotEditAttr('data-base-shot'), savedShot, 0.001) &&
      near(savedShot, a.shotSec, 0.02) &&
      (await tid('shot-edit-line-base').textContent()).includes('変更なし'),
    `${await shotEditAttr('data-base-shot')} (expected ${savedShot}、音の最大 ${a.shotSec})`,
  );
  // キャンセルでは何も変わらない
  await tid('shot-edit-earlier').click();
  await tid('shot-edit-cancel').click();
  await tid('compare-shot-edit').waitFor({ state: 'detached' });
  check(
    'キャンセルすると撃発ポイントは変わらず、バーが元の区間に戻る',
    near(Number(await tid('compare-bar-slider').getAttribute('min')), minBefore, 0.02),
    await tid('compare-bar-slider').getAttribute('min'),
  );
  // ①基準を 1 コマ遅くして決定する
  await tid('compare-fix-shot').click();
  await tid('compare-shot-edit').waitFor();
  await tid('shot-edit-role-base').click();
  await tid('shot-edit-later').click();
  const fixedShot = await shotEditAttr('data-base-shot');
  check(
    '「1 コマ遅く」で 1 コマ分だけ遅くなる',
    near(fixedShot, savedShot + 1 / 30, 0.002),
    fixedShot,
  );
  // バーを撃発の瞬間から動かしたまま決定しても、撃発の写真（詳細と一覧の静止画）は撃発のコマから作られる。
  // 写真を作るときに動画がどの時刻にいたかを、描画の入口で記録して確かめる
  await slideTo('compare-bar', 0.5);
  await waitBothReady();
  await page.evaluate(() => {
    window.__videoDraws = [];
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (source, ...rest) {
      if (source instanceof HTMLVideoElement) window.__videoDraws.push(source.currentTime);
      return original.call(this, source, ...rest);
    };
  });
  await tid('shot-edit-confirm').click();
  await tid('compare-shot-edit').waitFor({ state: 'detached', timeout: 15_000 });
  const draws = await page.evaluate(() => window.__videoDraws);
  check(
    'バーを動かしたまま決定しても、撃発の写真は撃発のコマから作られる',
    draws.length === 2 &&
      draws.every((sec) => sec >= fixedShot - 0.001 && sec < fixedShot + 1 / 30),
    `${JSON.stringify(draws)} (撃発 ${fixedShot})`,
  );
  // 読み直しが終わって、バーの範囲が新しい撃発ポイントのものになるのを待つ
  await page.waitForFunction(
    (expected) => {
      const slider = document.querySelector('[data-testid=compare-bar-slider]');
      return slider && Math.abs(Number(slider.min) - expected) < 0.02;
    },
    -(fixedShot - 1.0),
    { timeout: 15_000 },
  );
  await waitBothReady();
  const min2 = Number(await tid('compare-bar-slider').getAttribute('min'));
  check(
    '決定すると撃発ポイントが保存され、共通の区間が計算し直される',
    near(-min2, fixedShot - 1.0, 0.02),
    `${min2} (expected -${(fixedShot - 1.0).toFixed(2)})`,
  );
  // 切り抜き範囲の修正：重ねたまま、撃発を 0 とした開始・終了を決め、①②の両方に当てはめる
  await tid('compare-fix-clip').click();
  await tid('compare-clip-edit').waitFor();
  const editMin = Number(await tid('compare-bar-slider').getAttribute('min'));
  const editMax = Number(await tid('compare-bar-slider').getAttribute('max'));
  // 直している間は、切り抜きを無視した動画そのものの共通する区間を動ける：A は前 ≈ 2.5・後 ≈ 2.5、B は前 2.0・後 ≈ 2.03
  check(
    '修正中はバーが動画そのものの共通する区間に広がる',
    near(-editMin, 2.0, 0.1) && near(editMax, 2.03, 0.1),
    `${editMin}〜${editMax}`,
  );
  check('取っ手が 2 つ出る', (await page.locator('.wave-handle').count()) === 2);
  await slideTo('compare-bar', 1.0);
  await waitBothReady();
  await tid('clip-set-end').click();
  await page.screenshot({
    path: join(here, 'results', `compare-${browserName}-clipedit.png`),
    fullPage: true,
  });
  check(
    '「ここを終了に」で終了が +1.0 秒になる',
    /1\.0 秒後（/.test(await tid('clip-length').textContent()),
    await tid('clip-length').textContent(),
  );
  await tid('clip-confirm').click();
  await tid('compare-clip-edit').waitFor({ state: 'detached', timeout: 15_000 });
  await tid('compare-bar').waitFor();
  await waitBothReady();
  const min3 = Number(await tid('compare-bar-slider').getAttribute('min'));
  const max3 = Number(await tid('compare-bar-slider').getAttribute('max'));
  check(
    '決定すると両方の動画が切り抜かれ、共通の区間が +1.0 秒までになる',
    near(max3, 1.0, 0.05) && near(min3, min2, 0.05),
    `${min3}〜${max3}`,
  );
  // ライブラリの詳細にも反映されている（②音声なし：撃発 2.0 → 0.53〜3.0 秒）
  await tid('compare-back').click();
  await item(b.id).locator('[data-testid=lib-open]').click();
  await tid('record-detail').waitFor();
  const lengthB = await tid('detail-length').textContent();
  check('②の詳細の範囲が更新される', /〜3\.0 秒/.test(lengthB), lengthB);
  await tid('detail-back').click();
  // ①の詳細には、比較画面で直した撃発ポイントが出る
  await item(a.id).locator('[data-testid=lib-open]').click();
  await tid('record-detail').waitFor();
  check(
    '①の詳細の撃発ポイントが、比較画面で直した値になる',
    (await tid('detail-shot').textContent()).includes(fixedShot.toFixed(2)),
    `${await tid('detail-shot').textContent()} (expected ${fixedShot.toFixed(2)})`,
  );
  await tid('detail-back').click();
  await tid('pick-compare').click();
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
