// 段階⑤のライブラリの自動テスト：射手、保存していない動画の印、一覧の絞り込み、お気に入り、編集、削除、
// 古い版（段階③の版 1）で保存した記録の移し替え。保存の流れそのものは savetest.mjs、比較は comparetest.mjs。
// 開発サーバ（npm run dev）を起動した状態で使う。
//   node apps/web/e2e/librarytest.mjs webkit
//   node apps/web/e2e/librarytest.mjs chromium
// 動画は motion.mp4（作り方は marktest.mjs のコメント）。
// 結果は apps/web/e2e/results/library-<ブラウザ名>.json に保存する（git 管理外）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const [browserName = 'webkit'] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:5173';
const videoPath = join(here, 'videos', 'motion.mp4');
const VIEWPORT = { width: 430, height: 900 };

const launcher = { chromium, webkit }[browserName];
if (!launcher) throw new Error(`unknown browser: ${browserName}`);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`  ${ok ? 'OK  ' : 'NG  '} ${name}${detail === '' ? '' : `  [${detail}]`}`);
};
const logs = [];
const watch = (p) => {
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
  });
  p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
};

const browser = await launcher.launch({ headless: process.env.HEADLESS === '1' });
let page = await browser.newPage({ viewport: VIEWPORT });
watch(page);
const tid = (id) => page.locator(`[data-testid=${id}]`);
const waitItems = (n) =>
  page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid=lib-item]').length === count,
    n,
    { timeout: 10_000 },
  );
const waitSettled = (playerId) =>
  page.waitForFunction(
    (id) => {
      const v = document.querySelector(`[data-testid=${id}-stage] video`);
      return v && v.readyState >= 2 && !v.seeking && v.paused;
    },
    playerId,
    { timeout: 10_000 },
  );
const registerShooter = async (name, hand) => {
  await tid('shooter-name').fill(name);
  await tid(`shooter-${hand}`).click();
  await tid('shooter-submit').click();
  await tid('shooter-dialog').waitFor({ state: 'detached' });
};

let fatal = null;
const summary = {};
try {
  console.log(`open ${base} (${browserName})`);
  await page.goto(base);

  // ── 射手
  await tid('shooter-register').waitFor();
  check('射手を登録するまで「次へ」を押せない', await tid('shooter-next').isDisabled());
  await tid('shooter-register').click();
  check('名前が空のうちは登録できない', await tid('shooter-submit').isDisabled());
  await registerShooter('山田', 'right');
  await tid('shooter-select').waitFor();
  await tid('shooter-select').selectOption('add');
  await registerShooter('佐藤', 'left');
  check(
    '2 人目を登録すると選ばれる',
    (await tid('shooter-select').locator('option:checked').textContent()) === '佐藤（左利き）',
  );
  await tid('shooter-select').selectOption({ label: '山田（右利き）' });
  await tid('shooter-next').click();
  check(
    '動画の指定に、選んだ射手が出る',
    (await tid('load-shooter').textContent()).includes('山田（右利き）'),
    await tid('load-shooter').textContent(),
  );

  // ── 保存していない動画の印と、動画の選び直しの確認
  console.log('  姿勢推定を実行中…');
  await tid('video-file').setInputFiles(videoPath);
  check('推定の前は未保存の印が出ない', (await tid('unsaved-dot').count()) === 0);
  await tid('run-analysis').click({ timeout: 60_000 });
  // 推定が終わると、自動で切り抜きへ進む
  await tid('clip-player').waitFor({ timeout: 15 * 60_000 });
  await tid('unsaved-dot').waitFor();
  check(
    '切り抜きに進むと「動画の保存」タブに未保存の印が出る',
    (await tid('unsaved-dot').count()) === 1,
  );
  await waitSettled('clip-player');
  await tid('save-reset').click();
  await tid('discard-dialog').waitFor();
  await tid('discard-dialog').locator('[data-testid=confirm-cancel]').click();
  check(
    '「戻る」の確認でキャンセルすると切り抜きのまま',
    (await tid('save-screen').getAttribute('data-step')) === 'clip',
  );
  // 「保存せずに進む」は 1 つ前（動画の指定）へ戻る。射手は選んだまま、動画は選び直しになる
  await tid('save-reset').click();
  await tid('discard-dialog').locator('[data-testid=confirm-ok]').click();
  await tid('video-pick').waitFor();
  check(
    '「戻る」で保存せずに進むと、動画の指定に戻り、射手はそのままで動画は未選択',
    (await tid('save-screen').getAttribute('data-step')) === 'video' &&
      (await tid('load-shooter').textContent()).includes('山田（右利き）') &&
      (await tid('video-pick-state').textContent()) === 'ファイル未選択',
    await tid('load-shooter').textContent(),
  );
  check('戻ると未保存の印が消える', (await tid('unsaved-dot').count()) === 0);
  await tid('video-file').setInputFiles(videoPath);
  await tid('run-analysis').click({ timeout: 60_000 });
  // 推定が終わると、自動で切り抜きへ進む
  await tid('clip-player').waitFor({ timeout: 15 * 60_000 });
  await waitSettled('clip-player');
  await tid('clip-confirm').click();
  await tid('shot-player').waitFor();
  await waitSettled('shot-player');
  check('音声のない動画は「音声なし」と出る', (await page.locator('.wave-none').count()) === 1);
  await tid('shot-set').click();
  await tid('form-summary').waitFor({ timeout: 15_000 });
  check(
    'タイトルが空だと保存できない',
    await (async () => {
      await tid('form-title').fill('   ');
      return tid('form-submit').isDisabled();
    })(),
  );
  await tid('form-title').fill('1 本目');
  await tid('form-memo').fill('引き金が軽く切れた');
  await tid('form-favorite').click();
  await tid('form-submit').click();
  await tid('save-done').waitFor({ timeout: 30_000 });
  const recordA = Number(await tid('save-done').getAttribute('data-saved-id'));
  check('保存すると未保存の印が消える', (await tid('unsaved-dot').count()) === 0);
  await tid('save-next').click();
  check(
    '「次の動画を保存する」で射手の選択に戻り、前回の射手が選ばれている',
    (await tid('save-screen').getAttribute('data-step')) === 'shooter' &&
      (await tid('shooter-select').locator('option:checked').textContent()) === '山田（右利き）',
  );

  // 2 本目（佐藤・左利き、お気に入りなし）
  await tid('shooter-select').selectOption({ label: '佐藤（左利き）' });
  await tid('shooter-next').click();
  await tid('video-file').setInputFiles(videoPath);
  await tid('run-analysis').click({ timeout: 60_000 });
  // 推定が終わると、自動で切り抜きへ進む
  await tid('clip-player').waitFor({ timeout: 15 * 60_000 });
  await waitSettled('clip-player');
  await tid('clip-confirm').click();
  await tid('shot-player').waitFor();
  await waitSettled('shot-player');
  await tid('shot-set').click();
  await tid('form-summary').waitFor({ timeout: 15_000 });
  await tid('form-title').fill('2 本目');
  await tid('form-submit').click();
  await tid('save-done').waitFor({ timeout: 30_000 });
  const recordB = Number(await tid('save-done').getAttribute('data-saved-id'));
  summary.records = { recordA, recordB };

  // ── 一覧：絞り込み・お気に入り
  await tid('tab-library').click();
  await waitItems(2);
  check('件数が出る', (await tid('library-count').textContent()) === '2 件');
  await tid('filter-shooter').selectOption({ label: '佐藤（1）' });
  await waitItems(1);
  check('射手で絞り込める', (await tid('lib-title').textContent()) === '2 本目');
  await tid('filter-shooter').selectOption({ index: 0 });
  await waitItems(2);
  await tid('filter-favorite').click();
  await waitItems(1);
  check('お気に入りだけに絞り込める', (await tid('lib-title').textContent()) === '1 本目');
  await tid('filter-favorite').click();
  await waitItems(2);
  const itemB = page.locator(`[data-testid=lib-item][data-record-id="${recordB}"]`);
  await itemB.locator('[data-testid=lib-favorite]').click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(`[data-testid=lib-item][data-record-id="${id}"]`)?.dataset.favorite ===
      'true',
    recordB,
  );
  check('一覧の ★ でお気に入りを切り替えられる', true);

  // ── 詳細と編集
  await page
    .locator(`[data-testid=lib-item][data-record-id="${recordA}"] [data-testid=lib-open]`)
    .click();
  await tid('record-detail').waitFor();
  check('詳細に射手名と利き手', (await tid('detail-shooter').textContent()) === '山田・右利き');
  check('詳細にメモ', (await tid('detail-memo').textContent()) === '引き金が軽く切れた');
  check(
    '動画本体が保存されていて、再生と修正のボタンが押せる',
    (await tid('detail-video').getAttribute('data-has-video')) === 'true' &&
      (await tid('detail-play').isEnabled()),
  );
  await tid('detail-edit').click();
  await tid('record-form').waitFor();
  check(
    '編集の窓に今の内容が入っている',
    (await tid('form-title').inputValue()) === '1 本目' &&
      (await tid('form-memo').inputValue()) === '引き金が軽く切れた',
  );
  await page.locator('[data-testid=form-shooter]', { hasText: '佐藤' }).click();
  await tid('form-title').fill('直した 1 本目');
  await tid('form-shot-at').fill('2026-09-30T16:20');
  await tid('form-memo').fill('');
  await tid('form-submit').click();
  await tid('edit-dialog').waitFor({ state: 'detached' });
  await page.waitForFunction(
    () => document.querySelector('[data-testid=detail-shooter]')?.textContent === '佐藤・左利き',
  );
  check(
    'タイトル・射手・日時・メモの編集が反映される',
    (await tid('detail-title').textContent()) === '直した 1 本目' &&
      (await tid('detail-date').textContent()) === '9/30（水）16:20' &&
      (await tid('detail-memo').count()) === 0,
  );
  await page.evaluate(() => window.history.back());
  await waitItems(2);
  check('ブラウザの「戻る」で一覧へ戻る', (await tid('record-detail').count()) === 0);

  // ── 削除
  await page
    .locator(`[data-testid=lib-item][data-record-id="${recordB}"] [data-testid=lib-open]`)
    .click();
  await tid('detail-remove').click();
  await tid('remove-dialog').waitFor();
  await tid('remove-dialog').locator('[data-testid=confirm-cancel]').click();
  check('削除の確認でキャンセルすると消えない', (await tid('record-detail').count()) === 1);
  await tid('detail-remove').click();
  await tid('remove-dialog').locator('[data-testid=confirm-ok]').click();
  await waitItems(1);
  check('削除すると一覧から消える', (await tid('lib-title').textContent()) === '直した 1 本目');
  await page.locator('[data-testid=lib-open]').click();
  await tid('detail-remove').click();
  await tid('remove-dialog').locator('[data-testid=confirm-ok]').click();
  await tid('library-empty').waitFor();
  check('0 件になると案内とボタンが出る', (await tid('library-go-load').count()) === 1);
  await tid('library-go-load').click();
  await tid('shooter-step').waitFor({ timeout: 5000 });
  await tid('shooter-next').click();
  await tid('video-pick').waitFor({ timeout: 5000 });
  check(
    '案内のボタンで「動画の保存」へ移り、射手の選択から新しい動画を受け入れる',
    (await tid('video-pick').isEnabled()) &&
      (await tid('video-pick-state').textContent()) === 'ファイル未選択',
  );

  // ── 段階③で保存した記録（保存形式の版 1）が、消えずに開ける。タイトルは撮影日時、範囲は全体になる
  const context = await browser.newContext({ viewport: VIEWPORT });
  page = await context.newPage();
  watch(page);
  await page.route('**/__blank', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>blank</title>' }),
  );
  await page.goto(`${base}/__blank`);
  await page.evaluate(async () => {
    const jpeg = async (w, h) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#446';
      ctx.fillRect(0, 0, w, h);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      return { bytes: await blob.arrayBuffer(), type: 'image/jpeg' };
    };
    const still = await jpeg(640, 480);
    const thumb = await jpeg(180, 240);
    const p = (x, y) => ({ x, y, visibility: 1 });
    const landmarks = {
      nose: p(320, 80),
      rightEar: p(315, 82),
      leftEar: p(330, 82),
      rightShoulder: p(270, 130),
      leftShoulder: p(370, 140),
      rightHip: p(290, 260),
      leftHip: p(350, 260),
      rightWrist: p(120, 125),
      leftWrist: p(380, 270),
      rightAnkle: p(270, 440),
      leftAnkle: p(370, 440),
    };
    // Dexie（IndexedDB を扱う部品）の版 1 は、IndexedDB の版 10 にあたる
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('pistol-kamae', 10);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('shooters', { keyPath: 'id', autoIncrement: true }).createIndex(
          'name',
          'name',
          { unique: true },
        );
        const records = d.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
        records.createIndex('shooterId', 'shooterId');
        records.createIndex('shotAt', 'shotAt');
        d.createObjectStore('recordData', { keyPath: 'id' });
        d.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['shooters', 'records', 'recordData'], 'readwrite');
      tx.objectStore('shooters').put({
        id: 1,
        name: '旧データ',
        handedness: 'right',
        createdAt: 1,
      });
      tx.objectStore('records').put({
        id: 1,
        shooterId: 1,
        shotAt: '2026-09-20T10:00',
        score: 10.1,
        memo: '段階③で保存',
        favorite: true,
        thumb,
        createdAt: 1,
        updatedAt: 1,
      });
      tx.objectStore('recordData').put({
        id: 1,
        formatVersion: 1,
        analysis: {
          backendId: 'mediapipe-full-video',
          width: 640,
          height: 480,
          fps: 30,
          durationSec: 0.1,
          frames: [
            { timeSec: 0, landmarks },
            { timeSec: 1 / 30, landmarks },
            { timeSec: 2 / 30, landmarks },
          ],
        },
        marks: [{ id: 'shot', kind: 'shot', label: '', timeSec: 1 / 30 }],
        still,
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.goto(base);
  await tid('tab-library').click();
  await waitItems(1);
  check(
    '版 1 で保存した記録が一覧に残り、タイトルは撮影日時になる',
    (await tid('lib-title').textContent()) === '2026-09-20 10:00',
    await tid('lib-title').textContent(),
  );
  check(
    '一覧の 2 行目に射手・長さ・メモ',
    (await tid('lib-sub').textContent()) === '旧データ・0.1 秒・段階③で保存',
    await tid('lib-sub').textContent(),
  );
  await tid('lib-open').click();
  await tid('record-detail').waitFor();
  check(
    '版 1 の記録を開ける（長さは全体、撃発は 0.03 秒）',
    (await tid('detail-length').textContent()) === '0.1 秒' &&
      (await tid('detail-shot').textContent()) === '0.03 秒',
    `${await tid('detail-length').textContent()} / ${await tid('detail-shot').textContent()}`,
  );
  await tid('detail-video').waitFor();
  check(
    '版 1 の記録は「動画：なし」で、再生と修正は押せず、動画を付けるボタンがある',
    (await tid('detail-video').getAttribute('data-has-video')) === 'false' &&
      (await tid('detail-play').isDisabled()) &&
      (await tid('detail-attach').count()) === 1,
  );
  await page.screenshot({
    path: join(here, 'results', `library-${browserName}-old.png`),
    fullPage: true,
  });
} catch (e) {
  fatal = e instanceof Error ? (e.stack ?? e.message) : String(e);
  await page
    .screenshot({ path: join(here, 'results', `library-${browserName}-error.png`), fullPage: true })
    .catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `library-${browserName}.json`);
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
