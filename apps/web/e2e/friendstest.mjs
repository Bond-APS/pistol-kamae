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
/**
 * 動画ごとの水平校正の線（元の動画の画素座標）。射手のすぐ右にある鏡の枠（鉛直）の上端と下端。
 * 静止画の縁を画像処理で追って求めた（2026-10-01、当てはめの残差 0.5 画素以下）。
 */
const VIDEOS = [
  { name: 'good-1', level: { x1: 886, y1: 87, x2: 882, y2: 548 } },
  { name: 'good-2', level: { x1: 847, y1: 49, x2: 841, y2: 506 } },
  { name: 'good-3', level: { x1: 824, y1: 68, x2: 820, y2: 523 } },
  { name: 'bad-1', level: { x1: 831, y1: 18, x2: 823, y2: 476 } },
  { name: 'bad-2', level: { x1: 816, y1: 2, x2: 809, y2: 353 } },
  { name: 'bad-3', level: { x1: 830, y1: 2, x2: 817, y2: 442 } },
];

const launcher = { chromium, webkit }[browserName];
if (!launcher) throw new Error(`unknown browser: ${browserName}`);
const browser = await launcher.launch({ headless: process.env.HEADLESS === '1' });
const page = await browser.newPage({ viewport: { width: 393, height: 760 } });
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
const levelEnd = async (n) => ({
  x: Number(await tid(`level-handle-${n}`).getAttribute('data-x')),
  y: Number(await tid(`level-handle-${n}`).getAttribute('data-y')),
});
/** 線の端 n を、画像の座標 (x, y) まで動かす。引きずったあと、矢印キーで 1 画素以内に合わせる */
const moveEnd = async (n, x, y) => {
  const from = await levelEnd(n);
  const box = await tid(`level-handle-${n}`).boundingBox();
  const scale = await tid('level-svg').evaluate((svg) => svg.getScreenCTM().a);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + (x - from.x) * scale, start.y + (y - from.y) * scale, {
    steps: 6,
  });
  await page.mouse.up();
  await tid(`level-handle-${n}`).focus();
  for (let i = 0; i < 40; i++) {
    const at = await levelEnd(n);
    const dx = Math.round(x - at.x);
    const dy = Math.round(y - at.y);
    if (dx === 0 && dy === 0) break;
    if (dx !== 0) await page.keyboard.press(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    if (dy !== 0) await page.keyboard.press(dy > 0 ? 'ArrowDown' : 'ArrowUp');
  }
};

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

  // ── 6 本を読み込み、保存し、水平の線を引く
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

    await tid('save-view').click();
    await page
      .locator(`[data-testid=lib-item][data-record-id="${id}"] [data-testid=lib-open]`)
      .click();
    await tid('detail-table').waitFor();
    await tid('detail-level-open').click();
    await tid('level-editor').waitFor();
    await moveEnd(1, video.level.x1, video.level.y1);
    await moveEnd(2, video.level.x2, video.level.y2);
    const tilt = Number(await tid('level-readout').getAttribute('data-tilt'));
    const kind = await tid('level-readout').getAttribute('data-kind');
    await tid('level-submit').click();
    await tid('level-editor').waitFor({ state: 'detached' });
    summary.records.push({ name: video.name, id, tilt, kind });
    console.log(`  ${video.name}：保存（記録 ${id}）、カメラの傾き ${tilt.toFixed(2)}°（${kind}）`);
    await tid('detail-back').click();
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
