// 段階④の合格ライン（同一射手の別の動画を正規化して重ねたとき、骨格がおおむね一致する）の確認。
// ユーザー候補の動画 6 本（apps/web/e2e/videos/friend-*.mov、git 管理外）を実際の画面で読み込み・保存し、
// 1 本目を基準として残りの 5 本と重ね、関節のずれと角度の差を数値で出す。重ね描きの画像も保存する。
// 開発サーバ（npm run dev）を起動した状態で使う。姿勢推定を 6 本分行うので 10 分ほどかかる。
//   node apps/web/e2e/friendstest.mjs webkit
// 結果は apps/web/e2e/results/friends-<ブラウザ名>.json と friends-<ブラウザ名>-<動画名>.png（git 管理外）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const [browserName = 'webkit'] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:5173';
const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });

/** 撃発の代わりに使う時刻（秒）。6 本とも据銃中 */
const SHOT_SEC = 16;
// 水平校正（カメラの傾きの補正）は初期バージョンから外したので、線は引かない（2026-10-03）
const VIDEOS = ['good-1', 'good-2', 'good-3', 'bad-1', 'bad-2', 'bad-3'].map((name) => ({ name }));

const launcher = { chromium, webkit }[browserName];
if (!launcher) throw new Error(`unknown browser: ${browserName}`);
const browser = await launcher.launch({ headless: process.env.HEADLESS === '1' });
const page = await browser.newPage({ viewport: { width: 393, height: 760 } });
// 角度の数値は既定では隠れている。このテストは数値を読むので、最初から「表示」にしておく
await page.addInitScript(() => window.localStorage.setItem('kamae.showNumbers', '1'));
const tid = (id) => page.locator(`[data-testid=${id}]`);

const slideTo = async (index) => {
  await tid('frame-slider').evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, index);
  await page.waitForFunction(
    (i) => {
      const label = document.querySelector('[data-testid=frame-label]');
      const video = document.querySelector('.video-box video');
      return label?.getAttribute('data-frame-index') === String(i) && video && !video.seeking;
    },
    index,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(300);
};
const skeleton = (layer) =>
  page.evaluate((l) => {
    const g = document.querySelector(`[data-testid=still] [data-testid=${l}]`);
    return g
      ? [...g.querySelectorAll('circle')].map((c) => ({
          x: Number(c.getAttribute('cx')),
          y: Number(c.getAttribute('cy')),
          // 灰色の点（よく見えない・画面の外）は比べない
          usable: c.getAttribute('fill') !== 'rgb(160, 160, 160)',
        }))
      : null;
  }, layer);
const diffTable = () =>
  tid('diff-table')
    .locator('tr[data-metric]')
    .evaluateAll((trs) =>
      Object.fromEntries(
        trs.map((tr) => {
          const num = (s) => (s === '' ? null : Number(s));
          return [
            tr.dataset.metric,
            {
              base: num(tr.dataset.base),
              current: num(tr.dataset.current),
              diff: num(tr.dataset.diff),
              level: tr.dataset.level,
            },
          ];
        }),
      ),
    );
// 関節の順は engine の LANDMARK_NAMES
const NAMES = [
  'nose',
  'leftEar',
  'rightEar',
  'leftShoulder',
  'rightShoulder',
  'leftHip',
  'rightHip',
  'leftWrist',
  'rightWrist',
  'leftAnkle',
  'rightAnkle',
];
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const summary = { shotSec: SHOT_SEC, records: [], pairs: [] };
let fatal = null;
try {
  await page.goto(base);
  await tid('shooter-register').click();
  await tid('shooter-name').fill('ユーザー候補');
  await tid('shooter-right').click();
  await tid('shooter-submit').click();
  await tid('shooter-dialog').waitFor({ state: 'detached' });

  // ── 6 本を読み込み、保存する
  for (const [i, video] of VIDEOS.entries()) {
    console.log(`  ${video.name}：姿勢推定を実行中…`);
    await tid('tab-load').click();
    await tid('video-file').setInputFiles(join(here, 'videos', `friend-${video.name}.mov`));
    await page.waitForFunction(
      () => document.querySelector('[data-testid=run-analysis]')?.disabled === false,
      null,
      { timeout: 120_000 },
    );
    await tid('run-analysis').click({ timeout: 60_000 });
    await tid('analysis-done').waitFor({ timeout: 15 * 60_000 });
    await tid('go-mark').click();
    await tid('frame-slider').waitFor();
    const total = Number(await tid('frame-slider').getAttribute('max')) + 1;
    const duration = await page.locator('.video-box video').evaluate((v) => v.duration);
    await slideTo(Math.round((SHOT_SEC / duration) * total));
    await tid('mark-shot').click();
    await tid('save-open').click();
    await tid('record-form').waitFor();
    if (i === 0) await tid('form-favorite').click();
    // 一覧で見分けられるよう、撮影日時を 1 分ずつずらし、メモに動画名を入れる
    await tid('form-shot-at').fill(`2026-09-30T10:0${i}`);
    await tid('form-memo-toggle').click();
    await tid('form-memo').fill(video.name);
    await tid('form-submit').click();
    await tid('save-done').waitFor({ timeout: 30_000 });
    const id = Number(await tid('save-block').getAttribute('data-saved-id'));

    summary.records.push({ name: video.name, id });
    console.log(`  ${video.name}：保存（記録 ${id}）`);
  }

  // ── 1 本目を基準に、残りと重ねる
  const [first, ...rest] = summary.records;
  for (const record of rest) {
    await tid('tab-library').click();
    await page
      .locator(`[data-testid=lib-item][data-record-id="${record.id}"] [data-testid=lib-open]`)
      .click();
    await tid('detail-table').waitFor();
    await tid('detail-compare').click();
    // 初回だけ、基準を選ぶ窓が開く
    if (record === rest[0]) {
      await tid('picker-pick').first().waitFor();
      await tid('picker-pick').first().click();
    }
    await tid('diff-table').waitFor();
    await page.waitForFunction(
      (id) => document.querySelector('[data-testid=pair-current]')?.dataset.recordId === String(id),
      record.id,
    );
    const current = await skeleton('still-skeleton');
    const baseLayer = await skeleton('still-skeleton-base');
    const trunk = dist(mid(current[5], current[6]), mid(current[3], current[4]));
    // 揃えたあとの関節のずれ（体幹の長さに対する割合）。両方で使えた点だけ
    const gaps = {};
    for (const [i, name] of NAMES.entries()) {
      if (current[i].usable && baseLayer[i].usable) {
        gaps[name] = dist(current[i], baseLayer[i]) / trunk;
      }
    }
    const values = Object.values(gaps);
    const pair = {
      base: first.name,
      current: record.name,
      // 今回の記録の腰の中心と体幹の長さ（元の動画の画素）
      hip: mid(current[5], current[6]),
      trunk,
      meanGap: values.reduce((s, v) => s + v, 0) / values.length,
      maxGap: Math.max(...values),
      gaps,
      diffs: await diffTable(),
    };
    await tid('align-raw').click();
    const rawBase = await skeleton('still-skeleton-base');
    const rawValues = NAMES.map((_, i) =>
      current[i].usable && rawBase[i].usable ? dist(current[i], rawBase[i]) / trunk : null,
    ).filter((v) => v !== null);
    pair.meanGapRaw = rawValues.reduce((s, v) => s + v, 0) / rawValues.length;
    // 撮ったままでは基準の骨格は動かさないので、基準の記録の腰の中心と体幹の長さが分かる
    summary.baseHip = mid(rawBase[5], rawBase[6]);
    summary.baseTrunk = dist(summary.baseHip, mid(rawBase[3], rawBase[4]));
    await tid('align-normalized').click();
    summary.pairs.push(pair);
    console.log(
      `  ${first.name} と ${record.name}：揃えたあとのずれ 平均 ${(pair.meanGap * 100).toFixed(1)}%、最大 ${(pair.maxGap * 100).toFixed(1)}%（撮ったままでは平均 ${(pair.meanGapRaw * 100).toFixed(1)}%）`,
    );
    await tid('compare').screenshot({
      path: join(outDir, `friends-${browserName}-${record.name}.png`),
    });
  }
} catch (e) {
  fatal = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  await page
    .screenshot({ path: join(outDir, `friends-${browserName}-error.png`), fullPage: true })
    .catch(() => {});
}

const outFile = join(outDir, `friends-${browserName}.json`);
writeFileSync(outFile, JSON.stringify({ browser: browserName, fatal, ...summary }, null, 2));
await browser.close();
console.log(`saved ${outFile}`);
if (fatal) console.log(`FATAL: ${fatal}`);
process.exit(fatal ? 1 : 0);
