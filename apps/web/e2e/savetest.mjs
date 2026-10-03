// 段階⑤「動画の保存」の流れ（射手の選択 → 動画の指定 → 切り抜き → 撃発ポイントの特定 → 保存）と、ライブラリの詳細・動画を再生・
// 撃発ポイントの修正・切り抜き範囲の修正の自動テスト。実際の画面をブラウザで操作して確かめる。
// 開発サーバ（npm run dev）を起動した状態で使う。
//   node apps/web/e2e/savetest.mjs webkit   … Safari と同じ描画エンジン
//   node apps/web/e2e/savetest.mjs chromium … Chrome と同じ描画エンジン
// 動画は apps/web/e2e/videos/shot.mp4（発射音入り、5 秒、撃発は約 2.5 秒）。
//   作り方：ffmpeg -ss 19 -to 24 -i friend-good-1.mov -vf "setpts=PTS-STARTPTS,fps=30,scale=540:-2" \
//           -c:v libx264 -bf 0 -crf 20 -pix_fmt yuv420p -c:a aac -b:a 96k -af asetpts=PTS-STARTPTS \
//           -movflags +faststart shot.mp4
// 結果は apps/web/e2e/results/save-<ブラウザ名>.json に保存する（git 管理外）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const [browserName = 'webkit'] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:5173';
const videoPath = process.env.VIDEO ?? join(here, 'videos', 'shot.mp4');
/** 発射音の時刻（秒）とその許容幅 */
const SHOT_SEC = 2.5;
const SHOT_TOLERANCE_SEC = 0.3;

const launcher = { chromium, webkit }[browserName];
if (!launcher) throw new Error(`unknown browser: ${browserName}`);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`  ${ok ? 'OK  ' : 'NG  '} ${name}${detail === '' ? '' : `  [${detail}]`}`);
};

const browser = await launcher.launch({ headless: process.env.HEADLESS === '1' });
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const tid = (id) => page.locator(`[data-testid=${id}]`);
const valueSecOf = async (barId) => Number(await tid(barId).getAttribute('data-value-sec'));
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
    { timeout: 10_000 },
  );
const videoState = (playerId) =>
  page
    .locator(`[data-testid=${playerId}-stage] video`)
    .evaluate((v) => ({ t: v.currentTime, paused: v.paused, rate: v.playbackRate }));
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const shotPng = (name) =>
  page.screenshot({
    path: join(here, 'results', `save-${browserName}-${name}.png`),
    fullPage: true,
  });
/** 骨格の線を隠して、動画の絵だけを撮る（画面に実際に出ている絵を確かめるため） */
const pictureOf = async (playerId) => {
  await page.addStyleTag({ content: '.stage-svg { visibility: hidden !important; }' });
  const png = await page.locator(`[data-testid=${playerId}-stage]`).screenshot();
  await page.evaluate(() => document.head.lastElementChild?.remove());
  return png;
};
/** 撮った絵（PNG）を 64×64 に縮めた画素の並び。ブラウザの canvas で読む（Node に画像の部品を足さないため） */
const pixelsOf = (png) =>
  page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 64, 64);
    return Array.from(ctx.getImageData(0, 0, 64, 64).data);
  }, png.toString('base64'));
/** 絵の明るさの平均（0〜255） */
const brightness = (px) => {
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
  return sum / (px.length / 4);
};
/** 2 枚の違い（画素の差の平均、0〜255） */
const difference = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4)
    sum +=
      (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
  return sum / (a.length / 4);
};

let fatal = null;
const summary = {};
try {
  console.log(`open ${base} (${browserName})`);
  await page.goto(base);

  check('入口は 2 つ（動画の保存・ライブラリ）', (await page.locator('.tab').count()) === 2);
  const stepOf = () => tid('save-screen').getAttribute('data-step');
  check(
    '手順は 5 段階（射手・動画・切り抜き・撃発・保存）',
    (await tid('steps').locator('li').allTextContents()).join('|') ===
      '1 射手|2 動画|3 切り抜き|4 撃発|5 保存',
    (await tid('steps').locator('li').allTextContents()).join('|'),
  );
  check(
    '最初の段階は「1 射手の選択」',
    (await stepOf()) === 'shooter' && (await tid('step-title').textContent()) === '1 射手の選択',
    await tid('step-title').textContent(),
  );
  check(
    '射手の選択では、動画を選ぶボタンは出ない',
    !(await tid('video-pick').isVisible()) && !(await tid('run-analysis').isVisible()),
  );

  // ① 射手を登録して、動画の指定へ進む
  await tid('shooter-register').waitFor();
  check('射手を登録するまで「次へ」を押せない', await tid('shooter-next').isDisabled());
  await tid('shooter-register').click();
  await tid('shooter-name').fill('テスト射手');
  await tid('shooter-right').click();
  await tid('shooter-submit').click();
  await tid('shooter-select').waitFor();
  await shotPng('shooter');
  await tid('shooter-next').click();
  check(
    '「次へ」で「2 動画の指定」へ進む',
    (await stepOf()) === 'video' && (await tid('step-title').textContent()) === '2 動画の指定',
    await tid('step-title').textContent(),
  );
  check(
    '動画の指定には、選んだ射手が出て、射手の選択欄は出ない',
    (await tid('load-shooter').textContent()).includes('テスト射手（右利き）') &&
      (await tid('shooter-select').count()) === 0,
    await tid('load-shooter').textContent(),
  );

  // ② 動画を読み込む前：形式の案内と「下のボタンを押して動画を選ぶ」が出て、ボタンの右は「ファイル未選択」
  check(
    '読み込む前は形式の案内と「下のボタンを押して動画を選ぶ」が出る',
    (await tid('load-format-hint').isVisible()) &&
      (await tid('video-pick-label').textContent()) === '下のボタンを押して動画を選ぶ',
    await tid('video-pick-label').textContent(),
  );
  check(
    '読み込む前は「ファイルを選択」の右に「ファイル未選択」と出る',
    (await tid('video-pick').textContent()) === 'ファイルを選択' &&
      (await tid('video-pick-state').textContent()) === 'ファイル未選択',
    await tid('video-pick-state').textContent(),
  );
  check(
    'ブラウザ本来のファイル選択欄は画面に出ない',
    (await tid('video-file').count()) === 1 && !(await tid('video-file').isVisible()),
  );
  await shotPng('open-before');
  // 自前のボタンからファイルの選択を開き、そこで動画を選ぶ（ボタン → 隠した欄 → 読み込みがつながっている）
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
  await tid('video-pick').click();
  const chooser = await chooserPromise;
  check('「ファイルを選択」を押すとファイルの選択が開く', chooser !== null);

  console.log('  姿勢推定を実行中…');
  if (chooser) await chooser.setFiles(videoPath);
  else await tid('video-file').setInputFiles(videoPath);
  // 動画を読み込んだあと：形式の案内と「下のボタンを押して…」が消え、選び直しの案内と「選択済み」が出る
  await tid('run-analysis').and(page.locator(':enabled')).waitFor({ timeout: 60_000 });
  check(
    '読み込んだあとは形式の案内と「下のボタンを押して動画を選ぶ」が消える',
    (await tid('load-format-hint').count()) === 0 &&
      !(await page.locator('body').textContent()).includes('下のボタンを押して動画を選ぶ'),
  );
  check(
    '読み込んだあとは選び直しの案内が出る',
    (await tid('video-pick-label').textContent()) ===
      '動画を選び直すときは「ファイルを選択」を押してください。',
    await tid('video-pick-label').textContent(),
  );
  check(
    '読み込んだあとは「ファイルを選択」の右に「選択済み」と出る',
    (await tid('video-pick-state').textContent()) === '選択済み' &&
      !(await page.locator('body').textContent()).includes('ファイル未選択'),
    await tid('video-pick-state').textContent(),
  );
  await shotPng('open-after');
  // 射手の選択へ戻っても、読み込んだ動画は消えない
  await tid('back-to-shooter').click();
  check(
    '「射手を選び直す」で射手の選択へ戻る',
    (await stepOf()) === 'shooter' && (await tid('shooter-select').isVisible()),
  );
  await tid('shooter-next').click();
  check(
    '射手の選択から戻ってきても「選択済み」のままで、姿勢推定を実行できる',
    (await tid('video-pick-state').textContent()) === '選択済み' &&
      (await tid('run-analysis').isEnabled()),
  );
  check(
    '番号付きの「手順 1：」「手順 2：」は出ない',
    !(await page.locator('body').textContent()).includes('手順 1') &&
      (await tid('run-analysis').textContent()) === '姿勢推定を実行',
    await tid('run-analysis').textContent(),
  );
  await tid('run-analysis').click({ timeout: 60_000 });
  check('推定の実行中は射手の選択へ戻れない', await tid('back-to-shooter').isDisabled());
  check('推定の実行中は「ファイルを選択」を押せない', await tid('video-pick').isDisabled());
  await tid('analysis-done').waitFor({ timeout: 15 * 60_000 });
  check(
    '推定が終わると「ファイルを選択」が押せて、「選択済み」のまま',
    (await tid('video-pick').isEnabled()) &&
      (await tid('video-pick-state').textContent()) === '選択済み',
  );
  // 推定が終わったあとに射手の選択へ戻っても、推定の結果は消えない
  await tid('back-to-shooter').click();
  check('推定のあとも射手の選択へ戻れる', (await stepOf()) === 'shooter');
  await tid('shooter-next').click();
  check(
    '射手の選択から戻ってきても、推定の結果が残っていて切り抜きへ進める',
    (await tid('analysis-done').isVisible()) && (await tid('go-clip').isVisible()),
  );
  await tid('go-clip').click();

  // ③ 切り抜き
  check(
    '切り抜きの段階へ進む（3 切り抜き）',
    (await stepOf()) === 'clip' && (await tid('step-title').textContent()) === '3 切り抜き',
    await tid('step-title').textContent(),
  );
  await tid('clip-player').waitFor();
  await waitSettled('clip-player');
  check('切り抜きの取っ手が 2 つある', (await page.locator('.wave-handle').count()) === 2);
  await tid('clip-player-bar-wave').waitFor({ timeout: 15_000 });
  check('音のグラフが出る', (await tid('clip-player-bar-wave').count()) === 1);
  const total = Number(await tid('clip-player-bar-slider').getAttribute('max'));
  summary.durationSec = total;
  check('バーの右端が動画の長さ', near(total, 5, 0.2), total);

  // 画面に出ている動画の絵が、黒くなく、時点を変えると変わる
  await slideTo('clip-player-bar', 0.5);
  await waitSettled('clip-player');
  await page.waitForTimeout(400);
  const pic1 = await pixelsOf(await pictureOf('clip-player'));
  // 4.9 秒では銃を下ろし始めているので、据銃中（0.5 秒）と絵が違う
  await slideTo('clip-player-bar', 4.9);
  await waitSettled('clip-player');
  await page.waitForTimeout(400);
  const pic2 = await pixelsOf(await pictureOf('clip-player'));
  check(
    '動画の絵が出ている（黒くない）',
    brightness(pic1) > 20 && brightness(pic2) > 20,
    `${brightness(pic1).toFixed(0)} / ${brightness(pic2).toFixed(0)}`,
  );
  check(
    '時点を変えると動画の絵が変わる',
    difference(pic1, pic2) > 2,
    difference(pic1, pic2).toFixed(2),
  );
  await shotPng('clip');

  await slideTo('clip-player-bar', 1.0);
  await waitSettled('clip-player');
  await tid('clip-set-start').click();
  await slideTo('clip-player-bar', 4.0);
  await waitSettled('clip-player');
  await tid('clip-set-end').click();
  const lengthText = await tid('clip-length').textContent();
  check('切り抜いた長さが 3.0 秒', lengthText.includes('3.0 秒'), lengthText);
  check(
    '取っ手の位置が開始 1.0・終了 4.0',
    /開始 1\.0 s/.test(await page.locator('.wave-handle.start').textContent()) &&
      /終了 4\.0 s/.test(await page.locator('.wave-handle.end').textContent()),
  );
  // 取っ手を引いて動かせる（開始を 0.5 秒へ）
  const track = await page.locator('.wave-track').first().boundingBox();
  const handle = await page.locator('.wave-handle.start').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + (0.5 / total) * track.width, handle.y + handle.height / 2, {
    steps: 5,
  });
  await page.mouse.up();
  check(
    '取っ手を引くと開始が動く',
    /開始 0\.5 s/.test(await page.locator('.wave-handle.start').textContent()),
    await page.locator('.wave-handle.start').textContent(),
  );
  await slideTo('clip-player-bar', 1.0);
  await waitSettled('clip-player');
  await tid('clip-set-start').click();
  await tid('clip-confirm').click();

  // ④ 撃発ポイント
  check(
    '撃発の段階へ進む（4 撃発ポイントの特定）',
    (await stepOf()) === 'shot' &&
      (await tid('step-title').textContent()) === '4 撃発ポイントの特定',
    await tid('step-title').textContent(),
  );
  await tid('shot-player').waitFor();
  await waitSettled('shot-player');
  const min = Number(await tid('shot-player-bar-slider').getAttribute('min'));
  const max = Number(await tid('shot-player-bar-slider').getAttribute('max'));
  check(
    'バーが切り抜いた範囲だけ（1.0〜4.0）',
    near(min, 1, 0.05) && near(max, 4, 0.05),
    `${min}〜${max}`,
  );
  const loudest = await valueSecOf('shot-player-bar');
  summary.loudestSec = loudest;
  check(
    'つまみが音の最大（発射音）に置かれている',
    near(loudest, SHOT_SEC, SHOT_TOLERANCE_SEC),
    loudest,
  );
  check('「音の最大」の印が出る', (await tid('shot-player-bar-marker-loudest').count()) === 1);
  check('撃発ポイントを付けるまで「保存へ」は押せない', await tid('shot-to-save').isDisabled());
  // 1 コマ戻してから付ける
  await tid('shot-player-prev').click();
  await waitSettled('shot-player');
  const shotSec = await valueSecOf('shot-player-bar');
  await tid('shot-set').click();
  await tid('shot-player-bar-marker-shot').waitFor({ timeout: 15_000 });
  check('撃発ポイントの印が出る', (await tid('shot-player-bar-marker-shot').count()) === 1);
  check(
    '撃発ポイントの時刻が表示される',
    (await tid('shot-status').textContent()).includes(shotSec.toFixed(2)),
    await tid('shot-status').textContent(),
  );
  check('撃発ポイントを付けると「保存へ」が押せる', await tid('shot-to-save').isEnabled());
  await shotPng('shot');
  await tid('shot-to-save').click();

  // ⑤ 保存
  check(
    '保存の段階へ進む（5 保存）',
    (await stepOf()) === 'form' && (await tid('step-title').textContent()) === '5 保存',
    await tid('step-title').textContent(),
  );
  const title = await tid('form-title').inputValue();
  check('タイトルの初期値が日付・時刻', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(title), title);
  await tid('form-title').fill('テスト 1 発目');
  await tid('form-memo').fill('肩が上がり気味');
  await shotPng('form');
  await tid('form-submit').click();
  await tid('save-done').waitFor({ timeout: 30_000 });
  const recordId = Number(await tid('save-done').getAttribute('data-saved-id'));
  check('保存できた', recordId > 0, recordId);
  check('保存後は「保存していない」印が消える', (await tid('unsaved-dot').count()) === 0);

  // ライブラリ
  await tid('tab-library').click();
  await tid('lib-item').first().waitFor();
  check('一覧に 1 件', (await tid('lib-item').count()) === 1);
  check('一覧にタイトル', (await tid('lib-title').textContent()) === 'テスト 1 発目');
  const sub = await tid('lib-sub').textContent();
  check(
    '一覧の 2 行目に射手・長さ・メモ',
    sub.includes('テスト射手') && sub.includes('3.0 秒') && sub.includes('肩が上がり気味'),
    sub,
  );

  await shotPng('library');
  await tid('lib-open').click();
  await tid('record-detail').waitFor();
  await page.waitForTimeout(500);
  await shotPng('detail');
  check('詳細のタイトル', (await tid('detail-title').textContent()) === 'テスト 1 発目');
  const lengthLine = await tid('detail-length').textContent();
  check(
    '詳細の長さに元の長さと範囲',
    lengthLine.includes('3.0 秒') && lengthLine.includes('1.0〜4.0'),
    lengthLine,
  );
  check(
    '詳細の撃発ポイント',
    (await tid('detail-shot').textContent()).includes(shotSec.toFixed(2)),
    await tid('detail-shot').textContent(),
  );

  // 動画を再生：止めているときだけ角度表
  await tid('detail-play').click();
  await tid('record-player').waitFor();
  await waitSettled('player');
  check('再生画面を開くと撃発の瞬間', near(await valueSecOf('player-bar'), shotSec, 0.02));
  check('止めているときは角度表が出る', (await tid('player-table').count()) === 1);
  await shotPng('player');
  await tid('player-rate-50').click();
  await tid('player-play').click();
  await page.waitForTimeout(800);
  const playing = await videoState('player');
  check('1/2 の速さで再生される', !playing.paused && playing.rate === 0.5, JSON.stringify(playing));
  check(
    '再生中は角度表が消える',
    (await tid('player-table').count()) === 0 && (await tid('player-table-playing').count()) === 1,
  );
  await tid('player-play').click();
  await page.waitForTimeout(500);
  check('止めると角度表が戻る', (await tid('player-table').count()) === 1);
  // 繰り返し：範囲の終わり（4.0 秒）で先頭（1.0 秒）に戻って続く
  await tid('player-rate-100').click();
  await tid('player-loop').click();
  await slideTo('player-bar', 3.7);
  await waitSettled('player');
  await tid('player-play').click();
  await page.waitForTimeout(1500);
  const looped = await videoState('player');
  check(
    '繰り返しで範囲の先頭に戻って再生が続く',
    !looped.paused && looped.t >= 1.0 && looped.t < 3.0,
    JSON.stringify(looped),
  );
  await tid('player-play').click();
  await tid('player-loop').click();
  // 繰り返しなし：範囲の終わりで止まる
  await slideTo('player-bar', 3.8);
  await waitSettled('player');
  await tid('player-play').click();
  await page.waitForTimeout(1200);
  const stopped = await videoState('player');
  check(
    '繰り返しなしでは範囲の終わりで止まる',
    stopped.paused && near(stopped.t, 4.0, 0.15),
    JSON.stringify(stopped),
  );
  await tid('player-back').click();

  // 撃発ポイントの修正
  await tid('detail-fix-shot').click();
  await tid('record-player').waitFor();
  await waitSettled('player');
  await tid('player-next').click();
  await tid('player-next').click();
  await waitSettled('player');
  const newShot = await valueSecOf('player-bar');
  await tid('shot-set').click();
  await tid('player-saved').waitFor({ timeout: 15_000 });
  await tid('player-back').click();
  await tid('record-detail').waitFor();
  check(
    '撃発ポイントを直すと詳細に反映',
    (await tid('detail-shot').textContent()).includes(newShot.toFixed(2)),
    `${newShot} / ${await tid('detail-shot').textContent()}`,
  );

  // 切り抜き範囲の修正：撃発ポイントを外す範囲は断られる
  await tid('detail-fix-clip').click();
  await tid('record-player').waitFor();
  await waitSettled('player');
  const wholeMax = Number(await tid('player-bar-slider').getAttribute('max'));
  check('範囲の修正では動画の全体を動ける', near(wholeMax, 5, 0.2), wholeMax);
  await slideTo('player-bar', 2.0);
  await waitSettled('player');
  await tid('clip-set-end').click();
  await tid('clip-confirm').click();
  check('撃発ポイントを外す範囲は断られる', (await tid('clip-problem').count()) === 1);
  await slideTo('player-bar', 4.5);
  await waitSettled('player');
  await tid('clip-set-end').click();
  await slideTo('player-bar', 0.5);
  await waitSettled('player');
  await tid('clip-set-start').click();
  await tid('clip-confirm').click();
  await tid('player-saved').waitFor({ timeout: 15_000 });
  await tid('player-back').click();
  await tid('record-detail').waitFor();
  const fixedLength = await tid('detail-length').textContent();
  check(
    '範囲を直すと詳細に反映（4.0 秒、0.5〜4.5）',
    fixedLength.includes('4.0 秒') && fixedLength.includes('0.5〜4.5'),
    fixedLength,
  );
  await tid('detail-back').click();
  await tid('lib-item').first().waitFor();
  check(
    '一覧の長さも更新される',
    (await tid('lib-sub').textContent()).includes('4.0 秒'),
    await tid('lib-sub').textContent(),
  );

  // タイトル・メモの編集
  await tid('lib-open').click();
  await tid('detail-edit').click();
  await tid('form-title').fill('直した題名');
  await tid('form-submit').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=detail-title]')?.textContent === '直した題名',
    null,
    { timeout: 10_000 },
  );
  check('タイトルを編集できる', true);
  await tid('detail-back').click();
} catch (e) {
  fatal = e instanceof Error ? (e.stack ?? e.message) : String(e);
  await page
    .screenshot({ path: join(here, 'results', `save-${browserName}-error.png`), fullPage: true })
    .catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `save-${browserName}.json`);
writeFileSync(
  outFile,
  JSON.stringify({ browser: browserName, base, videoPath, fatal, summary, checks, logs }, null, 2),
);
await browser.close();

console.log(`saved ${outFile}`);
if (fatal) console.log(`FATAL: ${fatal}`);
if (logs.length) console.log(`console: ${logs.length} 件（結果ファイル参照）`);
console.log(`${checks.length - failed.length} / ${checks.length} 合格`);
process.exit(fatal || failed.length ? 1 : 0);
