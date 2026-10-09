// 段階⑤「動画の指定」の、待ちが止まったときの逃げ道の自動テスト（最終-2）。
// シークの完了通知が来ない・Worker の返事が来ない状況を細工で作り、時間切れと「中断」「やめる」が効くことと、
// 解析中の Wake Lock（画面を消さないよう頼む仕組み）を確かめる。開発サーバ（npm run dev）を起動した状態で使う。
//   node apps/web/e2e/analysistest.mjs webkit
//   node apps/web/e2e/analysistest.mjs chromium
// 動画は shot.mp4（作り方は savetest.mjs）。結果は apps/web/e2e/results/analysis-<ブラウザ名>.json（git 管理外）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { hidePersonInScreenshots } from './hidePerson.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [browserName = 'webkit'] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:5173';
const videoPath = process.env.VIDEO ?? join(here, 'videos', 'shot.mp4');

const launcher = { chromium, webkit }[browserName];
if (!launcher) throw new Error(`unknown browser: ${browserName}`);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`  ${ok ? 'OK  ' : 'NG  '} ${name}${detail === '' ? '' : `  [${detail}]`}`);
};

const browser = await launcher.launch({ headless: process.env.HEADLESS === '1' });
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
hidePersonInScreenshots(page);
// Wake Lock を模擬し、頼んだ回数と解放した回数を数える（ページを開き直すたびに 0 から）
await page.addInitScript(() => {
  window.__wake = { requests: 0, releases: 0 };
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: async () => {
        window.__wake.requests++;
        return {
          released: false,
          release: async () => {
            window.__wake.releases++;
          },
          addEventListener() {},
          removeEventListener() {},
        };
      },
    },
  });
});
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const tid = (id) => page.locator(`[data-testid=${id}]`);
const textOf = (sel) => page.locator(sel);
/** 「中断」ボタン（解析中だけ出る）。目印が付く前のコードでも探せるよう、文字で探す */
const cancelButton = () => page.getByRole('button', { name: '中断', exact: true });
/** ページを開き直して「動画の指定」まで進む（射手は登録済み） */
const freshStart = async () => {
  await page.goto(base);
  await tid('tab-save').click();
  await tid('shooter-next').click();
  await tid('video-pick').waitFor();
};
/** 動画を選び、フレームレートの推定が終わって「姿勢推定を実行」が押せるまで待つ */
const pickAndWait = async () => {
  await tid('video-file').setInputFiles(videoPath);
  await tid('run-analysis').and(page.locator(':enabled')).waitFor({ timeout: 60_000 });
};
/**
 * video の currentTime の書き込み（シーク）を、指定した回数だけ順に横取りする（savetest と同じ細工）。
 * drop＝書き込まない（完了の通知が来ない）。指定を使い切ると元に戻る
 */
const patchSeek = (modes) =>
  page.evaluate((queue) => {
    const proto = HTMLMediaElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, 'currentTime');
    const restore = () => Object.defineProperty(proto, 'currentTime', original);
    window.__seekPatch = { queue: [...queue], restore, dropped: 0 };
    Object.defineProperty(proto, 'currentTime', {
      configurable: true,
      get: original.get,
      set(value) {
        const m = window.__seekPatch.queue.shift();
        if (window.__seekPatch.queue.length === 0) restore();
        if (m === 'drop') {
          window.__seekPatch.dropped++;
          return;
        }
        original.set.call(this, value);
      },
    });
  }, modes);
/** 細工でシークが握りつぶされる（止まる）のを待つ */
const waitDropped = () =>
  page.waitForFunction(() => window.__seekPatch?.dropped > 0, null, { timeout: 30_000 });
/** Worker への送信のうち、指定した種類（'init'＝準備、'estimate'＝推定）を握りつぶす（返事が来ない状況） */
const swallowWorker = (types) =>
  page.evaluate((kinds) => {
    window.__swallowed = 0;
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...rest) {
      if (message && kinds.includes(message.type)) {
        window.__swallowed++;
        return;
      }
      return original.call(this, message, ...rest);
    };
  }, types);
/** 握りつぶした送信が出るまで待つ（＝アプリが返事を待ち始めた瞬間） */
const waitSwallowed = () =>
  page.waitForFunction(() => window.__swallowed > 0, null, { timeout: 30_000 });
/** 条件が満たされるまで待つ。満たされなければ false（例外にしない） */
const waitFor = async (locator, options) => {
  try {
    await locator.waitFor(options);
    return true;
  } catch {
    return false;
  }
};

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

  // 1. 動画を選んだ直後の「しばらくお待ちください」で「やめる」を押すと、動画の指定に戻る
  console.log('  1. 推定の「やめる」');
  await freshStart();
  await tid('video-file').setInputFiles(videoPath);
  const hasStop = await waitFor(tid('load-waiting-cancel'), { timeout: 1500 });
  if (hasStop)
    await tid('load-waiting-cancel')
      .click({ timeout: 3000 })
      .catch(() => {});
  const backToIdle =
    hasStop &&
    (await waitFor(tid('video-pick-state'), { timeout: 3000 })) &&
    (await tid('video-pick-state').textContent()) === 'ファイル未選択' &&
    (await tid('video-pick').isEnabled());
  check(
    '「しばらくお待ちください」に「やめる」があり、押すと動画の指定に戻る',
    backToIdle,
    `button=${hasStop}`,
  );

  // 2. 推定中にシークが止まっても、数秒で先へ進む（推定できなければ 30 fps 扱い）
  console.log('  2. 推定中のシークの停止');
  await freshStart();
  await patchSeek(['drop']);
  await tid('video-file').setInputFiles(videoPath);
  // 1 回のシークの時間切れ（5 秒）のあと、残りの推定が終わるのを待つ
  const proceeded = await waitFor(tid('run-analysis').and(page.locator(':enabled')), {
    timeout: 12_000,
  });
  check('推定中にシークが止まっても、数秒で「姿勢推定を実行」が押せる状態になる', proceeded);

  // 3. 解析中にシークが止まったとき、「中断」がすぐ効く
  console.log('  3. 解析中のシークの停止 → 中断');
  await freshStart();
  await pickAndWait();
  await patchSeek(['drop']);
  await tid('run-analysis').click();
  // シークが止まった瞬間（細工が使われた）を待ってから押す
  await waitDropped();
  await page.waitForTimeout(300);
  const stalledLine = await textOf('text=/処理中|モデルを読み込んで/')
    .first()
    .textContent()
    .catch(() => '');
  await cancelButton().click({ timeout: 3000 });
  const cancelledFast = await waitFor(textOf('text=中断しました'), { timeout: 1500 });
  check(
    '解析中にシークが止まっても、「中断」を押すとすぐ「中断しました」になる',
    cancelledFast,
    stalledLine,
  );

  // 3b. モデルの準備の返事が来ないとき（「モデルを読み込んでいます…」のまま）も、「中断」がすぐ効く
  console.log('  3b. モデルの準備中 → 中断');
  await freshStart();
  await pickAndWait();
  await swallowWorker(['init']);
  await tid('run-analysis').click();
  await waitSwallowed();
  await textOf('text=モデルを読み込んでいます').waitFor({ timeout: 5000 });
  await cancelButton().click({ timeout: 3000 });
  const cancelledPreparing = await waitFor(textOf('text=中断しました'), { timeout: 1500 });
  check(
    'モデルの準備の返事が来なくても、「中断」を押すとすぐ「中断しました」になり、画面が固まらない',
    cancelledPreparing && (await tid('video-pick').isEnabled()),
  );

  // 4. 解析中にシークが止まったまま何もしないと、時間切れで失敗の案内が出て、動画を選び直せる
  console.log('  4. 解析中のシークの停止 → 時間切れ');
  await freshStart();
  await pickAndWait();
  await patchSeek(['drop']);
  await tid('run-analysis').click();
  // モデルの準備（数秒）のあと最初のシークが止まり、5 秒の時間切れで案内が出る
  const stalledNotice = await waitFor(tid('load-stalled'), { timeout: 15_000 });
  check(
    '解析中にシークが止まったままなら、時間切れで「動画の読み込みが途中で止まりました」と案内し、「ファイルを選択」が押せる',
    stalledNotice && (await tid('video-pick').isEnabled()),
    `notice=${stalledNotice}`,
  );

  // 5. Worker の返事が来ないとき、「中断」がすぐ効く
  console.log('  5. Worker の返事なし → 中断');
  await freshStart();
  await pickAndWait();
  await swallowWorker(['estimate']);
  await tid('run-analysis').click();
  // 推定の送信が握りつぶされた瞬間（返事を待ち始めた）に押す
  await waitSwallowed();
  await page.waitForTimeout(300);
  await cancelButton().click({ timeout: 3000 });
  const cancelledWorker = await waitFor(textOf('text=中断しました'), { timeout: 1500 });
  check('Worker の返事が来なくても、「中断」を押すとすぐ「中断しました」になる', cancelledWorker);

  // 6. 普通に解析すると切り抜きへ進み、解析の間だけ Wake Lock を頼んで、終わると解放する
  console.log('  6. 解析と Wake Lock');
  await freshStart();
  await pickAndWait();
  await tid('run-analysis').click();
  await tid('clip-player').waitFor({ timeout: 15 * 60_000 });
  const wake = await page.evaluate(() => window.__wake);
  summary.wake = wake;
  check(
    '解析の間だけ Wake Lock を頼み、終わると解放する（1 回ずつ）',
    wake.requests === 1 && wake.releases === 1,
    JSON.stringify(wake),
  );
} catch (e) {
  fatal = e instanceof Error ? (e.stack ?? e.message) : String(e);
  await page
    .screenshot({
      path: join(here, 'results', `analysis-${browserName}-error.png`),
      fullPage: true,
    })
    .catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `analysis-${browserName}.json`);
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
