// 段階④の合格ライン（同一射手の別の動画を正規化して重ねたとき、骨格がおおむね一致する）の確認。
// ユーザー候補の動画 6 本（apps/web/e2e/videos/friend-*.mov、git 管理外）を実際の画面で読み込み・保存し、
// 1 本目を基準として残りの 5 本と重ね、関節のずれと角度の差を数値で出す。重ね描きの画像も保存する。
// 動画は今の「動画の保存」の流れ（射手の選択 → 動画の指定 → 切り抜き → 撃発ポイントの特定 → 保存）で保存し、
// ライブラリで 2 件を選んで比較画面に入る（2026-10-04 に、段階⑤の画面に合わせて書き直した）。
// 開発サーバ（npm run dev）を起動した状態で使う。姿勢推定を 6 本分行うので 25 分ほどかかる。
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

/** 撃発の代わりに使う時刻（秒）。6 本とも据銃中。姿勢を比べるテストなので、発射音の時刻ではなく同じ時刻で揃える */
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

/** バーのつまみを動かす（React が値の変化に気付くよう、ブラウザ本来の設定手段を使う） */
const slideTo = async (barId, sec) => {
  await tid(`${barId}-slider`).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, sec);
  await page.waitForTimeout(300);
};
/** プレイヤーの video が、止まっていて、シークも終わっている */
const waitSettled = (playerId) =>
  page.waitForFunction(
    (id) => {
      const v = document.querySelector(`[data-testid=${id}-stage] video`);
      return v && v.readyState >= 2 && !v.seeking && v.paused;
    },
    playerId,
    { timeout: 30_000 },
  );
/** 比較画面の 2 本の video が、どちらも読めていて、シークも終わっている */
const waitBothReady = () =>
  page.waitForFunction(
    () => {
      const vs = document.querySelectorAll(
        '[data-testid=stage-video-base], [data-testid=stage-video-current]',
      );
      return vs.length === 2 && [...vs].every((v) => v.readyState >= 2 && !v.seeking);
    },
    null,
    { timeout: 30_000 },
  );
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
    await tid('tab-save').click();
    // 1 射手の選択 → 2 動画の指定
    await tid('shooter-next').click();
    await tid('video-file').setInputFiles(join(here, 'videos', `friend-${video.name}.mov`));
    await page.waitForFunction(
      () => document.querySelector('[data-testid=run-analysis]')?.disabled === false,
      null,
      { timeout: 120_000 },
    );
    await tid('run-analysis').click({ timeout: 60_000 });
    // 3 切り抜き：推定が終わると自動で進む。範囲は動画の全体のまま
    await tid('clip-player').waitFor({ timeout: 15 * 60_000 });
    await waitSettled('clip-player');
    await tid('clip-confirm').click();
    // 4 撃発ポイントの特定：音のグラフが出るのを待ち、音の最大（自動の当たり）の時刻を記録してから、決めた時刻に置く
    await tid('shot-player').waitFor();
    await waitSettled('shot-player');
    await page
      .locator('[data-testid=shot-player-bar-wave], .wave-none')
      .first()
      .waitFor({ timeout: 60_000 });
    await page.waitForTimeout(500);
    const noAudio = (await page.locator('.wave-none').count()) === 1;
    const loudestSec = noAudio
      ? null
      : Number(await tid('shot-player-bar').getAttribute('data-value-sec'));
    await slideTo('shot-player-bar', SHOT_SEC);
    await waitSettled('shot-player');
    const shotSec = Number(await tid('shot-player-bar').getAttribute('data-value-sec'));
    // 5 保存：「撃発ポイントを確定」を押すと自動で進む
    await tid('shot-set').click();
    await tid('form-summary').waitFor({ timeout: 30_000 });
    // 一覧で見分けられるよう、タイトルとメモに動画名を入れ、撮影日時を 1 分ずつずらす
    await tid('form-title').fill(video.name);
    if (i === 0) await tid('form-favorite').click();
    await tid('form-shot-at').fill(`2026-09-30T10:0${i}`);
    await tid('form-memo').fill(video.name);
    await tid('form-submit').click();
    await tid('save-done').waitFor({ timeout: 60_000 });
    const id = Number(await tid('save-done').getAttribute('data-saved-id'));
    await tid('save-next').click();

    summary.records.push({ name: video.name, id, shotSec, loudestSec });
    console.log(
      `  ${video.name}：保存（記録 ${id}、撃発 ${shotSec.toFixed(2)} 秒、音の最大 ${loudestSec === null ? '音声なし' : `${loudestSec.toFixed(2)} 秒`}）`,
    );
  }

  // ── 1 本目を基準（①）に、残りを 1 本ずつ比較（②）として重ねる
  const [first, ...rest] = summary.records;
  const item = (id) => page.locator(`[data-testid=lib-item][data-record-id="${id}"]`);
  let previous = null;
  for (const record of rest) {
    await tid('tab-library').click();
    await item(record.id).waitFor();
    // ◯を押した順に ①基準・②比較。2 組目からは、前の②を外してから次を選ぶ
    if (previous === null) await item(first.id).locator('[data-testid=lib-pick]').click();
    else await item(previous.id).locator('[data-testid=lib-pick]').click();
    await item(record.id).locator('[data-testid=lib-pick]').click();
    if (
      (await item(first.id).getAttribute('data-pick')) !== '1' ||
      (await item(record.id).getAttribute('data-pick')) !== '2'
    ) {
      throw new Error(`could not pick ${first.name} and ${record.name}`);
    }
    await tid('pick-compare').click();
    await tid('compare-bar').waitFor();
    await page.waitForFunction(
      (name) =>
        document.querySelector('[data-testid=compare-pair]')?.textContent?.includes(`②${name}`),
      record.name,
    );
    await waitBothReady();
    await tid('diff-table').waitFor();
    previous = record;
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
    await tid('compare-back').click();
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
