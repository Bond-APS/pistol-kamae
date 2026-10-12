// 段階⑥の自動テスト：JSON / CSV / PNG の書き出しと JSON の読込。
// 開発サーバ（npm run dev）を起動した状態で使う。
//   node apps/web/e2e/exporttest.mjs webkit
//   node apps/web/e2e/exporttest.mjs chromium
// 動画は shot.mp4（発射音入り、5 秒）と motion.mp4（音声なし、4 秒。作り方は savetest.mjs / librarytest.mjs）。
// 共有シートは自動テストでは出ないので、navigator.canShare を false にしてダウンロードの経路を確かめる
// （共有シートの経路は、navigator.share を差し替えて「呼ばれたか」だけを見る）。
// 結果は apps/web/e2e/results/export-<ブラウザ名>.json に保存する（git 管理外）。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { hidePersonInScreenshots } from './hidePerson.mjs';
import { pictureTools } from './picture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [browserName = 'webkit'] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:5173';
const videos = {
  shot: join(here, 'videos', 'shot.mp4'),
  motion: join(here, 'videos', 'motion.mp4'),
};
const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });
/** 書き出したファイルの置き場所（読込のテストで使う） */
const workDir = join(outDir, `export-${browserName}-files`);
mkdirSync(workDir, { recursive: true });

const launcher = { chromium, webkit }[browserName];
if (!launcher) throw new Error(`unknown browser: ${browserName}`);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`  ${ok ? 'OK  ' : 'NG  '} ${name}${detail === '' ? '' : `  [${detail}]`}`);
};

const browser = await launcher.launch({ headless: process.env.HEADLESS === '1' });
const page = await browser.newPage({
  viewport: { width: 430, height: 900 },
  acceptDownloads: true,
});
hidePersonInScreenshots(page);
// 共有シートは出せないので、ダウンロードの経路に固定する
await page.addInitScript(() => {
  Object.defineProperty(Navigator.prototype, 'canShare', {
    value: () => false,
    configurable: true,
  });
});
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('dialog', (d) => void d.accept());

const tid = (id) => page.locator(`[data-testid=${id}]`);
const { pixelsOf, brightness } = pictureTools(page);
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
const waitItems = (n) =>
  page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid=lib-item]').length === count,
    n,
    { timeout: 10_000 },
  );
const item = (id) => page.locator(`[data-testid=lib-item][data-record-id="${id}"]`);
/** ボタンを押して、ダウンロードされたファイルを読む（名前と中身） */
const downloadBy = async (click, saveAs) => {
  const waiting = page.waitForEvent('download', { timeout: 30_000 });
  await click();
  const download = await waiting;
  const path = join(workDir, saveAs);
  await download.saveAs(path);
  // WebKit は濁点を分解した形（NFD）で名前を返すことがあるので、比べる前に合成形（NFC）にそろえる
  return { name: download.suggestedFilename().normalize('NFC'), path, bytes: readFileSync(path) };
};
/** 書き出しの状態の行が「✓ 書き出しました」になるのを待つ */
const waitExported = (statusId) =>
  page.waitForFunction(
    (id) => document.querySelector(`[data-testid=${id}]`)?.dataset.status === 'done',
    statusId,
    { timeout: 30_000 },
  );
/** 読込の部品が、処理を終えて結果（done）か問題（problem）を出すのを待つ */
const waitImportSettled = () =>
  page.waitForFunction(
    () => {
      const phase = document.querySelector('[data-testid=import-json]')?.dataset.phase;
      return phase === 'done' || phase === 'problem' || phase === 'idle';
    },
    null,
    { timeout: 60_000 },
  );
const importFile = async (path) => {
  await tid('import-json-file').setInputFiles(path);
};
/** データベースから記録の中身（recordData の行）を直接読む */
const readRecordData = (id) =>
  page.evaluate(async (recordId) => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('pistol-kamae');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const row = await new Promise((resolve, reject) => {
      const req = db.transaction('recordData').objectStore('recordData').get(recordId);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!row) return null;
    return {
      analysis: row.analysis,
      marks: row.marks,
      clip: row.clip,
      stillBytes: row.still.bytes.byteLength,
    };
  }, id);
/** PNG の上の帯（高さ band）を元の大きさのまま読み、明るさの平均と明るい画素（文字）の数を返す */
const bandStats = (png, band) =>
  page.evaluate(
    async ([b64, h]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, canvas.width, h).data;
      let sum = 0;
      let bright = 0;
      for (let i = 0; i < px.length; i += 4) {
        const v = (px[i] + px[i + 1] + px[i + 2]) / 3;
        sum += v;
        if (v > 200) bright++;
      }
      return { mean: sum / (px.length / 4), bright };
    },
    [png.toString('base64'), band],
  );
const pngSize = (bytes) => ({
  width: bytes.readUInt32BE(16),
  height: bytes.readUInt32BE(20),
});
const writeJson = (name, value) => {
  const path = join(workDir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
};

/** 動画を 1 本保存する（comparetest と同じ） */
async function saveVideo(path, title, { clip, shotSec } = {}) {
  await tid('tab-save').click();
  await tid('shooter-next').click();
  await tid('video-file').setInputFiles(path);
  await tid('run-analysis').click({ timeout: 60_000 });
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
  await page.waitForTimeout(1500);
  if (shotSec !== undefined) {
    await slideTo('shot-player-bar', shotSec);
    await waitSettled('shot-player');
  }
  const sec = Number(await tid('shot-player-bar').getAttribute('data-value-sec'));
  await tid('shot-set').click();
  await tid('form-summary').waitFor({ timeout: 15_000 });
  await tid('form-title').fill(title);
  await tid('form-submit').click();
  await tid('save-done').waitFor({ timeout: 30_000 });
  const id = Number(await tid('save-done').getAttribute('data-saved-id'));
  await tid('save-next').click();
  return { id, shotSec: sec };
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

  // 一覧が空でも「JSON を読み込む」は出る（全件の書き出しは出ない）
  await tid('tab-library').click();
  await tid('library-empty').waitFor();
  check(
    '一覧が空でも「JSON を読み込む」が出て、「すべての記録を JSON で書き出す」は出ない',
    (await tid('import-json-button').isVisible()) && (await tid('export-all').count()) === 0,
  );
  check(
    'ブラウザ本来のファイル選択欄は画面に出ない',
    (await tid('import-json-file').count()) === 1 && !(await tid('import-json-file').isVisible()),
  );
  // 読めないファイル
  const badPath = join(workDir, 'bad.json');
  writeFileSync(badPath, '{"app":"other"}');
  await importFile(badPath);
  await waitImportSettled();
  check(
    'Pistol Kamae の JSON でなければ案内が出る',
    (await tid('import-json-problem').textContent()) ===
      '！ このファイルは Pistol Kamae の JSON ではありません。',
    await tid('import-json-problem').textContent(),
  );

  console.log('  動画を 2 本保存中…');
  const a = await saveVideo(videos.shot, '発射音あり', { clip: [1.0, 4.0] });
  const b = await saveVideo(videos.motion, '音声なし', { shotSec: 2.0 });
  summary.records = { a, b };

  // ---- 詳細：JSON（記録だけ）
  await tid('tab-library').click();
  await waitItems(2);
  await item(a.id).locator('[data-testid=lib-open]').click();
  await tid('record-detail').waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=detail-video]')?.dataset.hasVideo === 'true',
  );
  const detailShot = await tid('detail-shot').textContent();
  const detailLength = await tid('detail-length').textContent();
  await tid('detail-export-json').click();
  await tid('json-choice-dialog').waitFor();
  check(
    '動画のある記録では、JSON の書き出しで「記録だけ／動画も含めて」の窓が出る',
    (await tid('json-record-only').isVisible()) && (await tid('json-with-video').isVisible()),
  );
  const jsonA = await downloadBy(() => tid('json-record-only').click(), 'a.json');
  await waitExported('detail-export-status');
  check(
    'JSON のファイル名は kamae_<射手名>_<撮影日時>.json',
    /^kamae_テスト射手_\d{4}-\d{2}-\d{2}_\d{4}\.json$/.test(jsonA.name),
    jsonA.name,
  );
  const fileA = JSON.parse(jsonA.bytes.toString('utf8'));
  const recA = fileA.records?.[0];
  const originalA = await readRecordData(a.id);
  const framesInClip = originalA.analysis.frames.filter(
    (f) =>
      f.timeSec >= recA.record.clip.startSec - 1e-6 && f.timeSec <= recA.record.clip.endSec + 1e-6,
  ).length;
  check(
    'JSON の外側：app・exportVersion・exportedAt・records 1 件',
    fileA.app === 'pistol-kamae' &&
      fileA.exportVersion === 1 &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(fileA.exportedAt) &&
      fileA.records.length === 1,
    `${fileA.app} v${fileA.exportVersion} ${fileA.exportedAt} ${fileA.records?.length}`,
  );
  check(
    'JSON の記録は、データベースの中身（関節の位置・マーク・範囲）と同じ',
    JSON.stringify(recA.record.analysis) === JSON.stringify(originalA.analysis) &&
      JSON.stringify(recA.record.marks) === JSON.stringify(originalA.marks) &&
      JSON.stringify(recA.record.clip) === JSON.stringify(originalA.clip),
  );
  check(
    'JSON の記録に、タイトル・射手名・利き手・撮影日時が入っている',
    recA.record.meta.title === '発射音あり' &&
      recA.record.meta.shooterName === 'テスト射手' &&
      recA.record.meta.handedness === 'right' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(recA.record.meta.shotAt),
    JSON.stringify(recA.record.meta),
  );
  check(
    '記録だけの JSON：動画は null、静止画 2 枚と音のグラフは入っている',
    recA.video === null &&
      recA.still?.type === 'image/jpeg' &&
      recA.still.base64.length > 1000 &&
      recA.thumb?.base64.length > 100 &&
      Array.isArray(recA.audio?.values) &&
      recA.audio.values.length > 100,
    `still ${recA.still?.base64.length} thumb ${recA.thumb?.base64.length} audio ${recA.audio?.values?.length}`,
  );
  check(
    'JSON の角度時系列は、切り抜きの範囲の中のコマの数だけ',
    recA.metrics.length === framesInClip && framesInClip > 0,
    `${recA.metrics.length} / ${framesInClip}`,
  );
  const shotRow = recA.metrics.find((m) => Math.abs(m.relSec) < 1e-6);
  check(
    '角度時系列に撃発（relSec = 0）のコマがあり、9 項目の値が入っている',
    shotRow && shotRow.values && Object.keys(shotRow.values).length === 9,
    JSON.stringify(shotRow?.values),
  );

  // ---- 詳細：JSON（動画も含めて）
  await tid('detail-export-json').click();
  await tid('json-choice-dialog').waitFor();
  const jsonAV = await downloadBy(() => tid('json-with-video').click(), 'a-video.json');
  await waitExported('detail-export-status');
  const fileAV = JSON.parse(jsonAV.bytes.toString('utf8'));
  const videoSize = readFileSync(videos.shot).length;
  const decodedVideo = Buffer.from(fileAV.records[0].video?.base64 ?? '', 'base64');
  check(
    '動画も含めた JSON：動画本体がそのまま入っている（元のファイルと同じバイト列）',
    fileAV.records[0].video?.type.startsWith('video/') &&
      decodedVideo.length === videoSize &&
      decodedVideo.equals(readFileSync(videos.shot)),
    `${decodedVideo.length} / ${videoSize} ${fileAV.records[0].video?.type}`,
  );

  // ---- 詳細：CSV
  const csvA = await downloadBy(() => tid('detail-export-csv').click(), 'a.csv');
  await waitExported('detail-export-status');
  const csvText = csvA.bytes.toString('utf8');
  const csvLines = csvText.replace(/^\uFEFF/, '').split('\r\n');
  check(
    'CSV のファイル名は kamae_<射手名>_<撮影日時>.csv',
    /^kamae_テスト射手_\d{4}-\d{2}-\d{2}_\d{4}\.csv$/.test(csvA.name),
    csvA.name,
  );
  check(
    'CSV は BOM 付き UTF-8、改行は CRLF',
    csvA.bytes[0] === 0xef &&
      csvA.bytes[1] === 0xbb &&
      csvA.bytes[2] === 0xbf &&
      csvText.includes('\r\n'),
  );
  check(
    'CSV の見出し：コマ番号・時刻・9 項目（単位付き）',
    csvLines[0] ===
      'コマ番号,時刻〔秒、撃発＝0〕,(a) 肩線の傾き（水平基準）〔°〕,(b) 腰線の傾き（水平基準）〔°〕,(c) 体軸の傾き（鉛直基準）〔°〕,(d) 首の傾き（鉛直基準）〔°〕,(f) 腕の挙上角（水平基準）〔°〕,(g) 腕と肩線のなす角（身体基準）〔°〕,(h) 腰中心の横ずれ（体幹長比）〔比〕,(i) スタンス幅（体幹長比）〔比〕,(j) 手首と顔の水平距離（体幹長比）〔比〕',
    csvLines[0],
  );
  const csvRows = csvLines.slice(1).filter((l) => l !== '');
  check(
    'CSV の行数は範囲の中のコマの数。コマ番号は 1 から',
    csvRows.length === framesInClip &&
      csvRows[0].startsWith('1,') &&
      csvRows.at(-1).startsWith(`${framesInClip},`),
    `${csvRows.length} rows`,
  );
  check(
    'CSV に撃発（時刻 0.000）の行があり、角度は小数 1 桁',
    csvRows.some((r) => {
      const c = r.split(',');
      return c[1] === '0.000' && /^-?\d+\.\d$/.test(c[2]);
    }),
    csvRows.find((r) => r.split(',')[1] === '0.000'),
  );

  // ---- 共有シートの経路：navigator.share が使えるときは呼ばれ、ダウンロードはしない
  await page.evaluate(() => {
    window.__shared = [];
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      value: async (data) => {
        const f = data.files[0];
        window.__shared.push({ name: f.name, type: f.type, size: f.size });
      },
      configurable: true,
    });
  });
  let downloaded = false;
  const onDownload = () => {
    downloaded = true;
  };
  page.on('download', onDownload);
  await tid('detail-export-csv').click();
  await waitExported('detail-export-status');
  await page.waitForTimeout(500);
  page.off('download', onDownload);
  const shared = await page.evaluate(() => window.__shared);
  check(
    '共有シートが使える端末では navigator.share にファイルを渡し、ダウンロードしない',
    shared.length === 1 &&
      shared[0].name === csvA.name &&
      shared[0].type === 'text/csv' &&
      !downloaded,
    JSON.stringify(shared),
  );
  // 共有シートを閉じた（AbortError）ときは、何も出さずに元へ戻る
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'share', {
      value: async () => {
        throw new DOMException('cancel', 'AbortError');
      },
      configurable: true,
    });
  });
  await tid('detail-export-csv').click();
  await page.waitForTimeout(800);
  check(
    '共有シートを閉じただけなら、「書き出しました」も失敗も出ない',
    (await tid('detail-export-status').count()) === 0,
  );
  // 押した直後でないため開けなかった（NotAllowedError）ときは「共有する」ボタンを出し、押し直せば渡せる
  await page.evaluate(() => {
    window.__shared = [];
    window.__shareCalls = 0;
    Object.defineProperty(navigator, 'share', {
      value: async (data) => {
        window.__shareCalls++;
        if (window.__shareCalls === 1) throw new DOMException('gesture', 'NotAllowedError');
        const f = data.files[0];
        window.__shared.push({ name: f.name, type: f.type, size: f.size });
      },
      configurable: true,
    });
  });
  await tid('detail-export-csv').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=detail-export-status]')?.dataset.status === 'ready',
    null,
    { timeout: 10_000 },
  );
  check(
    '共有シートを開けなかったときは「共有する」ボタンが出る',
    (await tid('detail-export-status-share').textContent()) === '共有する',
  );
  await tid('detail-export-status-share').click();
  await waitExported('detail-export-status');
  const sharedAgain = await page.evaluate(() => window.__shared);
  check(
    '「共有する」を押すと、押した直後に共有シートへ同じファイルを渡す',
    sharedAgain.length === 1 && sharedAgain[0].name === csvA.name,
    JSON.stringify(sharedAgain),
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
  });

  // ---- 一覧：すべての記録を JSON で書き出す（動画なし）
  await tid('detail-back').click();
  await waitItems(2);
  const jsonAll = await downloadBy(() => tid('export-all').click(), 'all.json');
  await waitExported('export-all-status');
  const fileAll = JSON.parse(jsonAll.bytes.toString('utf8'));
  check(
    '全件の JSON：kamae_すべて_<日時>.json、2 件、動画は含めない',
    /^kamae_すべて_\d{4}-\d{2}-\d{2}_\d{4}\.json$/.test(jsonAll.name) &&
      fileAll.records.length === 2 &&
      fileAll.records.every((r) => r.video === null),
    `${jsonAll.name} ${fileAll.records.length}`,
  );

  // ---- 読込（往復）：A を削除してから、A の JSON を読み込む
  await item(a.id).locator('[data-testid=lib-open]').click();
  await tid('record-detail').waitFor();
  await tid('detail-remove').click();
  await tid('remove-dialog').locator('[data-testid=confirm-ok]').click();
  await waitItems(1);
  await importFile(jsonA.path);
  await waitImportSettled();
  check(
    '読み込むと「✓ 1 件を読み込みました」',
    (await tid('import-json-done').textContent()).includes('✓ 1 件を読み込みました'),
    await tid('import-json-done').textContent(),
  );
  await waitItems(2);
  const newA = Number(
    await page
      .locator('[data-testid=lib-item]')
      .evaluateAll(
        (els, old) => els.map((e) => Number(e.dataset.recordId)).find((id) => id !== old),
        b.id,
      ),
  );
  summary.importedA = newA;
  const importedA = await readRecordData(newA);
  check(
    '読み込んだ記録の中身（関節の位置・マーク・範囲）が元と同じ（往復）',
    JSON.stringify(importedA.analysis) === JSON.stringify(originalA.analysis) &&
      JSON.stringify(importedA.marks) === JSON.stringify(originalA.marks) &&
      JSON.stringify(importedA.clip) === JSON.stringify(originalA.clip) &&
      importedA.stillBytes === originalA.stillBytes,
  );
  await item(newA).locator('[data-testid=lib-open]').click();
  await tid('record-detail').waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=detail-video]')?.dataset.hasVideo !== undefined,
  );
  check(
    '読み込んだ記録の詳細：タイトル・射手・撃発・長さが同じで、「動画：なし」',
    (await tid('detail-title').textContent()) === '発射音あり' &&
      (await tid('detail-shooter').textContent()) === 'テスト射手・右利き' &&
      (await tid('detail-shot').textContent()) === detailShot &&
      (await tid('detail-length').textContent()) === detailLength &&
      (await tid('detail-video').getAttribute('data-has-video')) === 'false' &&
      (await tid('detail-attach').count()) === 1,
    `${await tid('detail-title').textContent()} / ${await tid('detail-shot').textContent()} / ${await tid('detail-video').getAttribute('data-has-video')}`,
  );
  check(
    '動画のない記録でも JSON・CSV は書き出せる',
    (await tid('detail-export-json').isEnabled()) && (await tid('detail-export-csv').isEnabled()),
  );
  // 動画がなければ窓なしでそのまま書き出す
  const jsonA2 = await downloadBy(() => tid('detail-export-json').click(), 'a2.json');
  await waitExported('detail-export-status');
  check(
    '動画のない記録の JSON は窓を出さずに書き出し、音のグラフも残っている',
    (await tid('json-choice-dialog').count()) === 0 &&
      JSON.parse(jsonA2.bytes.toString('utf8')).records[0].audio?.values.length ===
        recA.audio.values.length,
  );
  await tid('detail-back').click();
  await waitItems(2);

  // ---- 重複：同じ JSON をもう一度
  await importFile(jsonA.path);
  await tid('import-duplicate-dialog').waitFor();
  check(
    '同じ記録があると「同じ記録がすでにあります」の窓。1 件なら「それでも読み込む」',
    (await tid('import-all').textContent()) === 'それでも読み込む' &&
      (await tid('import-skip-duplicates').count()) === 0,
  );
  await tid('import-duplicate-dialog').locator('[data-testid=confirm-cancel]').click();
  await page.waitForTimeout(300);
  check(
    'キャンセルすると何も読み込まない',
    (await page.locator('[data-testid=lib-item]').count()) === 2 &&
      (await tid('import-json').getAttribute('data-phase')) === 'idle',
  );
  await importFile(jsonA.path);
  await tid('import-duplicate-dialog').waitFor();
  await tid('import-all').click();
  await waitImportSettled();
  await waitItems(3);
  check(
    '「それでも読み込む」で 3 件になる',
    (await page.locator('[data-testid=lib-item]').count()) === 3,
  );

  // ---- 重複が複数：全件の JSON（2 件とも重複）
  await importFile(jsonAll.path);
  await tid('import-duplicate-dialog').waitFor();
  check(
    '複数件で重複があれば「重複を除いて読み込む／すべて読み込む」を 1 回だけ聞く',
    (await tid('import-skip-duplicates').isVisible()) &&
      (await tid('import-all').textContent()) === 'すべて読み込む' &&
      (await tid('import-duplicate-dialog').textContent()).includes('2 件のうち 2 件'),
    await tid('import-duplicate-dialog').textContent(),
  );
  await tid('import-skip-duplicates').click();
  await waitImportSettled();
  check(
    '重複を除くと読み込む記録がなく、その旨が出る',
    (await tid('import-json-done').textContent()).includes('読み込む記録はありませんでした') &&
      (await tid('import-json-done').textContent()).includes('2 件は重複のため飛ばしました') &&
      (await page.locator('[data-testid=lib-item]').count()) === 3,
    await tid('import-json-done').textContent(),
  );

  // ---- 動画込みの JSON を読み込む（別の撮影日時にして重複を避ける）
  fileAV.records[0].record.meta.shotAt = '2026-01-02T03:04';
  fileAV.records[0].record.meta.title = '動画込み';
  const avPath = writeJson('a-video-2.json', fileAV);
  await importFile(avPath);
  await waitImportSettled();
  await waitItems(4);
  const avId = Number(
    await page
      .locator('[data-testid=lib-item]')
      .evaluateAll((els) => Math.max(...els.map((e) => Number(e.dataset.recordId)))),
  );
  await item(avId).locator('[data-testid=lib-open]').click();
  await tid('record-detail').waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=detail-video]')?.dataset.hasVideo !== undefined,
  );
  check(
    '動画込みの JSON を読み込むと「動画：保存済み」になり、再生できる',
    (await tid('detail-title').textContent()) === '動画込み' &&
      (await tid('detail-video').getAttribute('data-has-video')) === 'true' &&
      (await tid('detail-play').isEnabled()),
  );
  await tid('detail-play').click();
  await tid('record-player').waitFor();
  await waitSettled('player');
  const pic = await pixelsOf(await tid('player-stage').screenshot());
  check('読み込んだ動画の絵が出る（黒くない）', brightness(pic) > 20, brightness(pic).toFixed(0));
  await tid('player-back').click();
  await tid('record-detail').waitFor();
  await tid('detail-back').click();
  await waitItems(4);

  // ---- 形式の合わない記録が混じった JSON：その記録だけ飛ばす
  const mixed = JSON.parse(jsonAll.bytes.toString('utf8'));
  mixed.records[0].record.meta.shotAt = '2026-02-03T04:05';
  mixed.records[1].record.marks = [];
  await importFile(writeJson('mixed.json', mixed));
  await waitImportSettled();
  check(
    '形式の合わない記録は飛ばし、残りを読み込んで件数を出す',
    (await tid('import-json-done').textContent()).includes('✓ 1 件を読み込みました') &&
      (await tid('import-json-done').textContent()).includes(
        '1 件は形式が合わないため飛ばしました',
      ),
    await tid('import-json-done').textContent(),
  );
  await waitItems(5);

  // ---- 利き手の食い違い
  const leftFile = JSON.parse(jsonA.bytes.toString('utf8'));
  leftFile.records[0].record.meta.handedness = 'left';
  leftFile.records[0].record.meta.shotAt = '2026-03-04T05:06';
  leftFile.records[0].record.meta.title = '左利きで保存';
  await importFile(writeJson('left.json', leftFile));
  await tid('import-handedness-dialog').waitFor();
  check(
    '利き手が違うと案内が出て、どちらを使うか選べる',
    (await tid('import-handedness-dialog').textContent()).includes(
      '「テスト射手」は左利きとして保存されていますが、登録は右利きです',
    ) &&
      (await tid('import-keep-registered').textContent()) === '登録どおり右利きにする' &&
      (await tid('import-use-file').textContent()).startsWith('左利きにする'),
    await tid('import-handedness-dialog').textContent(),
  );
  await tid('import-keep-registered').click();
  await waitImportSettled();
  await waitItems(6);
  check(
    '「登録どおり」を選ぶと射手の利き手は変わらない',
    (await tid('filter-shooter').count()) === 0 &&
      (await page.locator('[data-testid=lib-item]').count()) === 6,
  );
  // もう一度（別の日時で）読み込み、今度はファイルの利き手にする → 射手の登録が左利きに直る
  leftFile.records[0].record.meta.shotAt = '2026-03-04T05:07';
  await importFile(writeJson('left2.json', leftFile));
  await tid('import-handedness-dialog').waitFor();
  await tid('import-use-file').click();
  await waitImportSettled();
  await waitItems(7);
  await page.locator('[data-testid=lib-item]').first().locator('[data-testid=lib-open]').click();
  await tid('record-detail').waitFor();
  check(
    '「左利きにする」を選ぶと射手の登録が左利きに直り、詳細にも反映される',
    (await tid('detail-shooter').textContent()) === 'テスト射手・左利き',
    await tid('detail-shooter').textContent(),
  );
  await tid('detail-back').click();
  await waitItems(7);
  // 新しい射手（未登録）は登録される。読込中は一覧の記録を押せない（属性の変化を見張って確かめる）
  const newShooter = JSON.parse(jsonA.bytes.toString('utf8'));
  newShooter.records[0].record.meta.shooterName = '別の射手';
  await page.evaluate(() => {
    window.__disabledSeen = { open: false, pick: false, exportAll: false };
    const watch = (selector, key) => {
      const el = document.querySelector(selector);
      new MutationObserver(() => {
        if (el.disabled) window.__disabledSeen[key] = true;
      }).observe(el, { attributes: true, attributeFilter: ['disabled'] });
    };
    watch('[data-testid=lib-open]', 'open');
    watch('[data-testid=lib-pick]', 'pick');
    watch('[data-testid=export-all]', 'exportAll');
  });
  await importFile(writeJson('newshooter.json', newShooter));
  await waitImportSettled();
  await waitItems(8);
  const disabledSeen = await page.evaluate(() => window.__disabledSeen);
  check(
    '読込中は、一覧の記録を開く・選ぶと全件の書き出しを押せない',
    disabledSeen.open && disabledSeen.pick && disabledSeen.exportAll,
    JSON.stringify(disabledSeen),
  );
  check(
    '読込が終わると、また押せる',
    (await page.locator('[data-testid=lib-open]').first().isEnabled()) &&
      (await tid('export-all').isEnabled()),
  );
  check(
    '未登録の射手は登録され、射手の絞り込みに現れる',
    (await tid('filter-shooter').count()) === 1 &&
      (await tid('filter-shooter').locator('option').allTextContents()).some((t) =>
        t.startsWith('別の射手'),
      ),
    (await tid('filter-shooter').locator('option').allTextContents()).join('|'),
  );

  // ---- 比較画面：PNG
  // A（動画込みで読み込んだもの）を①、B を②に
  await item(avId).locator('[data-testid=lib-pick]').click();
  await item(b.id).locator('[data-testid=lib-pick]').click();
  await tid('pick-compare').click();
  await tid('compare-bar').waitFor();
  await page.waitForFunction(
    () => {
      const vs = document.querySelectorAll(
        '[data-testid=stage-video-base], [data-testid=stage-video-current]',
      );
      return vs.length === 2 && [...vs].every((v) => v.readyState >= 2 && !v.seeking);
    },
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(500);
  check('重ねた表示では「PNG で書き出す」を押せる', await tid('compare-export-png').isEnabled());
  const viewBox = (await tid('still-svg').getAttribute('viewBox')).split(' ').map(Number);
  const png = await downloadBy(() => tid('compare-export-png').click(), 'compare.png');
  await waitExported('compare-export-status');
  const size = pngSize(png.bytes);
  const expectedW = Math.round(viewBox[2]);
  const expectedH = Math.round(viewBox[3]);
  const band = Math.round(Math.min(96, Math.max(28, expectedW * 0.045)));
  summary.png = { ...size, viewBox, band };
  check(
    'PNG の名前は kamae_比較_<①>_<②>.png',
    png.name === 'kamae_比較_動画込み_音声なし.png',
    png.name,
  );
  check(
    'PNG の大きさは表示範囲（②の動画の画素）＋上の帯',
    png.bytes.subarray(1, 4).toString() === 'PNG' &&
      size.width === expectedW &&
      size.height === expectedH + band,
    `${size.width}×${size.height}（期待 ${expectedW}×${expectedH + band}）`,
  );
  const pngPixels = await pixelsOf(png.bytes, 64);
  // 帯の下の絵は黒くなく、骨格の緑か桃色がどこかにある（帯の行は除く）
  const bandRows = Math.max(1, Math.round((band / (expectedH + band)) * 64));
  const bodyPx = pngPixels.slice((bandRows + 1) * 64 * 4);
  let colored = 0;
  for (let i = 0; i < bodyPx.length; i += 4) {
    const [r, g, bl] = [bodyPx[i], bodyPx[i + 1], bodyPx[i + 2]];
    if ((g > 150 && r < 100 && bl < 150) || (r > 200 && g < 150 && bl > 150)) colored++;
  }
  check(
    'PNG の絵は黒くなく、骨格の色（緑・桃）が描かれている',
    brightness(bodyPx) > 20 && colored > 0,
    `明るさ ${brightness(bodyPx).toFixed(0)}、骨格色の画素 ${colored}`,
  );
  const bandInfo = await bandStats(png.bytes, band);
  check(
    'PNG の帯は暗い色で、文字（明るい画素）がある',
    bandInfo.mean < 120 && bandInfo.bright > 50,
    `帯の明るさ ${bandInfo.mean.toFixed(0)}、明るい画素 ${bandInfo.bright}`,
  );
  await tid('toggle-side').click();
  await page.waitForTimeout(300);
  check(
    '「横に並べる」では PNG を押せず、理由が出る',
    (await tid('compare-export-png').isDisabled()) &&
      (await tid('png-reason').textContent()).includes('重ねた表示'),
    await tid('png-reason').textContent(),
  );
  await tid('toggle-side').click();
} catch (e) {
  fatal = e instanceof Error ? (e.stack ?? e.message) : String(e);
  await page
    .screenshot({ path: join(outDir, `export-${browserName}-error.png`), fullPage: true })
    .catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
const outFile = join(outDir, `export-${browserName}.json`);
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
