// 段階⑤のライブラリの自動テスト：射手、保存していない動画の印、一覧の絞り込み、お気に入り、編集、削除、
// 古い版（段階③の版 1）で保存した記録の移し替え。保存の流れそのものは savetest.mjs、比較は comparetest.mjs。
// 開発サーバ（npm run dev）を起動した状態で使う。
//   node apps/web/e2e/librarytest.mjs webkit
//   node apps/web/e2e/librarytest.mjs chromium
// 動画は motion.mp4（音声なし、4 秒。腕を上げる動きのある切り出し）。
//   作り方：ffmpeg -ss 1.0 -to 5.0 -i sample.mov -vf "setpts=PTS-STARTPTS,fps=30" \
//           -c:v libx264 -bf 0 -crf 18 -pix_fmt yuv420p -an motion.mp4
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
const watch = async (p) => {
  // メモリの検査（最終-5）：ファイルを丸ごと読んだか（Blob.arrayBuffer の大きさ）を数える
  await p.addInitScript(() => {
    const reads = [];
    window.__blobReads = reads;
    const original = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function () {
      reads.push(this.size);
      return original.call(this);
    };
  });
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
  });
  p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  // 解析結果があって保存していないときは、再読込・ページ移動の前にブラウザの確認（beforeunload）が出る（最終-10）。
  // 自動テストでは、その確認を受け入れて先へ進める（受け入れないと goto・reload が止まる）
  p.on('dialog', (d) => void d.accept());
};

const browser = await launcher.launch({ headless: process.env.HEADLESS === '1' });
let page = await browser.newPage({ viewport: VIEWPORT });
await watch(page);
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
  await watch(page);
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

  // ── 開けない記録の扱い（最終-6）：壊れた中身の記録（番号 2）と、古い版（版 2）の中身の記録（番号 3）を直接書き込む
  await page.goto(`${base}/__blank`);
  await page.evaluate(async () => {
    const jpeg = async (w, h) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').fillRect(0, 0, w, h);
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
    const frames = [0, 1, 2].map((i) => ({ timeSec: i / 30, landmarks }));
    const analysis = {
      backendId: 'mediapipe-full-video',
      width: 640,
      height: 480,
      fps: 30,
      durationSec: 0.1,
      frames,
    };
    const marks = [{ id: 'shot', kind: 'shot', label: '', timeSec: 1 / 30 }];
    // 今の版のデータベースをそのまま開く（版を指定しない）
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('pistol-kamae');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['records', 'recordData'], 'readwrite');
      const row = (id, title, memo) => ({
        id,
        shooterId: 1,
        title,
        shotAt: '2026-09-21T10:00',
        score: null,
        memo,
        favorite: false,
        thumb,
        clipSec: 0.1,
        createdAt: 2,
        updatedAt: 2,
      });
      tx.objectStore('records').put(row(2, '壊れた記録', '中身が壊れている'));
      // 壊れた中身：コマが 0 個（形式の検査に落ちる）
      tx.objectStore('recordData').put({
        id: 2,
        formatVersion: 3,
        analysis: { ...analysis, frames: [] },
        marks,
        clip: null,
        level: null,
        still,
      });
      tx.objectStore('records').put(row(3, '古い版の記録', '版 2 の中身'));
      // 古い版（版 2）の中身：切り抜きの範囲の項目がない
      tx.objectStore('recordData').put({
        id: 3,
        formatVersion: 2,
        analysis,
        marks,
        level: null,
        still,
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.goto(base);
  await tid('tab-library').click();
  await waitItems(3);
  const item = (id) => page.locator(`[data-testid=lib-item][data-record-id="${id}"]`);
  // 壊れた記録：開くと「開けませんでした」。削除は確認の窓を通る
  await item(2).locator('[data-testid=lib-open]').click();
  await tid('detail-not-found').waitFor();
  check(
    '壊れた記録を開くと「形が合わない」の案内が出て、「もう一度読む」は出ない',
    (await tid('detail-not-found').textContent()).includes('壊れているか') &&
      (await tid('detail-retry').count()) === 0,
    await tid('detail-not-found').textContent(),
  );
  await tid('detail-remove').click();
  const confirmShown = await tid('remove-dialog')
    .waitFor({ timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  if (confirmShown) {
    await tid('remove-dialog').locator('[data-testid=confirm-cancel]').click();
    const stillThere = (await tid('detail-not-found').count()) === 1;
    await tid('detail-remove').click();
    await tid('remove-dialog').locator('[data-testid=confirm-ok]').click();
    await waitItems(2);
    check('壊れた記録の削除は確認の窓を通り、キャンセルで残り、「削除する」で消える', stillThere);
  } else {
    await waitItems(2).catch(() => {});
    check(
      '壊れた記録の削除は確認の窓を通り、キャンセルで残り、「削除する」で消える',
      false,
      '確認なしに消えた',
    );
  }
  // 古い版の記録：読み替えて開ける
  await item(3).locator('[data-testid=lib-open]').click();
  const oldOpened = await tid('record-detail')
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check(
    '古い版（版 2）の中身の記録は、読み替えて開ける（長さは全体）',
    oldOpened && (await tid('detail-length').textContent()) === '0.1 秒',
    oldOpened ? await tid('detail-length').textContent() : 'not opened',
  );
  await tid('detail-back').click();
  await tid('lib-item').first().waitFor();
  // 読み出しの失敗：記録の表（records）の読み出しを、旗が立っている間だけ失敗させる細工 → 「もう一度読む」で開ける。
  // ほかの表の読み出し（動画本体の有無の確認など）はそのまま通す。回数で制御しないのは、開発サーバでは React の
  // 開発用の二重実行で読み出しが 2 回走り、公開用ビルドでは 1 回で、回数が環境で変わるため
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.get;
    window.__failRecordsRead = true;
    IDBObjectStore.prototype.get = function (...args) {
      if (this.name !== 'records' || !window.__failRecordsRead) return original.apply(this, args);
      throw new DOMException('simulated read failure', 'InvalidStateError');
    };
  });
  await item(1).locator('[data-testid=lib-open]').click();
  const readFailed = await tid('detail-read-failed')
    .waitFor({ timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  await page.evaluate(() => {
    window.__failRecordsRead = false;
  });
  if (readFailed) {
    await tid('detail-retry').click();
    await tid('record-detail').waitFor({ timeout: 5000 });
    check('読み出しに失敗すると「読み出せませんでした」と出て、「もう一度読む」で開ける', true);
  } else {
    check(
      '読み出しに失敗すると「読み出せませんでした」と出て、「もう一度読む」で開ける',
      false,
      `shown: not-found=${await tid('detail-not-found').count()} detail=${await tid('record-detail').count()}`,
    );
  }

  // ── 200 MB を超える動画（最終-5）：音のグラフは出る（ファイルの必要な部分だけ読む）、動画本体は保存しない、
  //    「動画ファイルを選び直す」でも断られる。201 MB の動画はページの中で組み立てる（shot.mp4 の末尾に空の箱 free を足す）
  const MB = 1024 * 1024;
  const injectBig = (inputTestId) =>
    page.evaluate(
      async ([id, big]) => {
        const head = await (await fetch('/_test/shot.mp4')).arrayBuffer();
        const padSize = big - head.byteLength;
        const pad = new Uint8Array(padSize);
        new DataView(pad.buffer).setUint32(0, padSize);
        pad.set([0x66, 0x72, 0x65, 0x65], 4); // 'free'
        const file = new File([head, pad], 'big.mp4', { type: 'video/mp4' });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.querySelector(`[data-testid=${id}]`);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return file.size;
      },
      [inputTestId, 201 * MB],
    );
  console.log('  201 MB の動画で保存の流れ（姿勢推定を実行中）…');
  await tid('tab-save').click();
  if ((await tid('save-next').count()) === 1) await tid('save-next').click();
  await tid('shooter-next').click();
  await page.evaluate(() => (window.__blobReads.length = 0));
  await injectBig('video-file');
  await tid('run-analysis').and(page.locator(':enabled')).waitFor({ timeout: 60_000 });
  await tid('run-analysis').click();
  await tid('clip-player').waitFor({ timeout: 15 * 60_000 });
  await waitSettled('clip-player');
  await tid('clip-confirm').click();
  await tid('shot-player').waitFor();
  await waitSettled('shot-player');
  await page.waitForTimeout(1500);
  const bigReads = await page.evaluate(() => window.__blobReads.slice());
  check(
    '201 MB の動画でも音のグラフが出る（発射音の位置に置かれる）',
    (await page.locator('.wave-none').count()) === 0 &&
      Math.abs(Number(await tid('shot-player-bar').getAttribute('data-value-sec')) - 2.5) < 0.3,
    await tid('shot-player-bar').getAttribute('data-value-sec'),
  );
  check(
    '音のグラフのためにファイルを丸ごと読まない（読んだ 1 回の最大が 1 MB 未満）',
    bigReads.length > 0 && Math.max(...bigReads) < MB,
    `reads=${bigReads.length} max=${(Math.max(0, ...bigReads) / MB).toFixed(2)} MB`,
  );
  await tid('shot-set').click();
  await tid('form-summary').waitFor({ timeout: 15_000 });
  await tid('form-title').fill('大きい動画');
  await tid('form-submit').click();
  await tid('save-done').waitFor({ timeout: 30_000 });
  const bigId = Number(await tid('save-done').getAttribute('data-saved-id'));
  check(
    '200 MB を超える動画は、記録だけ保存して「動画本体は保存しませんでした」と出る',
    (await tid('save-video-too-large').count()) === 1 &&
      (await tid('save-video-failed').count()) === 0,
  );
  const savedReads = await page.evaluate(() => window.__blobReads.slice());
  check(
    '保存のときも 201 MB を読まない',
    Math.max(0, ...savedReads) < MB,
    `max=${(Math.max(0, ...savedReads) / MB).toFixed(2)} MB`,
  );
  await tid('save-next').click();
  await tid('tab-library').click();
  await item(bigId).locator('[data-testid=lib-open]').click();
  await tid('record-detail').waitFor();
  await tid('detail-attach').waitFor();
  check(
    '大きすぎた記録は「動画：なし」で、「動画ファイルを選び直す」が出る',
    (await tid('detail-video').getAttribute('data-has-video')) === 'false' &&
      (await tid('detail-attach').textContent()) === '動画ファイルを選び直す',
    await tid('detail-attach').textContent(),
  );
  await page.evaluate(() => (window.__blobReads.length = 0));
  await injectBig('detail-attach-file');
  await tid('detail-attach-error').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(500);
  const attachReads = await page.evaluate(() => window.__blobReads.slice());
  check(
    '「動画ファイルを選び直す」で 200 MB を超える動画を選ぶと、読まずに断られる',
    (await tid('detail-attach-error').textContent()) ===
      '！ 動画が 200 MB を超えています。動画を短く切るか、画質を下げてください。' &&
      (await tid('detail-video').getAttribute('data-has-video')) === 'false' &&
      attachReads.length === 0,
    `${await tid('detail-attach-error').textContent()} reads=${attachReads.length}`,
  );
  await tid('detail-back').click();
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
