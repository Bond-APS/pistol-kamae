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
import { hidePersonInScreenshots } from './hidePerson.mjs';
import { pictureTools } from './picture.mjs';
import { presentedTools } from './presented.mjs';

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
hidePersonInScreenshots(page);
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
/** プレイヤーが表示中のコマ（番号と、そのコマの始まりの時刻） */
const frameOf = async (playerId) => ({
  index: Number(await tid(playerId).getAttribute('data-frame-index')),
  sec: Number(await tid(playerId).getAttribute('data-frame-sec')),
});
/** 動画の時刻 t が、時刻 frameSec から始まるコマ（30 fps）の中にあるか（境目の誤差は少し許す） */
const inFrame = (t, frameSec) => t >= frameSec - 0.002 && t < frameSec + 1 / 30 + 0.004;
const shotPng = (name) =>
  page.screenshot({
    path: join(here, 'results', `save-${browserName}-${name}.png`),
    fullPage: true,
  });
/** 画面に実際に出ている動画の絵を撮って比べる（picture.mjs） */
const { pictureOf, pixelsOf, brightness, difference } = pictureTools(page);
/** 再生中に実際に表示されたコマの時刻の記録（presented.mjs） */
const presented = presentedTools(page);

let fatal = null;
const summary = {};
try {
  console.log(`open ${base} (${browserName})`);
  await page.goto(base);

  check('入口は 2 つ（動画の保存・ライブラリ）', (await page.locator('.tab').count()) === 2);
  const stepOf = () => tid('save-screen').getAttribute('data-step');
  /**
   * 静止画の撮影（最終-3）を確かめるための細工：ページ側で video の currentTime の書き込み（シーク）を、
   * 指定した回数だけ順に横取りする。drop＝書き込まない（完了の通知が来ない）、delay＝1.2 秒遅らせる、
   * shift＝1 コマ後へ着ける。指定を使い切ると元に戻る
   */
  const patchSeek = (modes) =>
    page.evaluate((queue) => {
      const proto = HTMLMediaElement.prototype;
      const original = Object.getOwnPropertyDescriptor(proto, 'currentTime');
      const restore = () => Object.defineProperty(proto, 'currentTime', original);
      window.__seekPatch = { queue: [...queue], restore };
      Object.defineProperty(proto, 'currentTime', {
        configurable: true,
        get: original.get,
        set(value) {
          const m = window.__seekPatch.queue.shift();
          if (window.__seekPatch.queue.length === 0) restore();
          if (m === 'drop') return;
          if (m === 'delay') {
            setTimeout(() => original.set.call(this, value), 1200);
            return;
          }
          original.set.call(this, value + 1 / 30);
        },
      });
    }, modes);
  /** 細工が使われずに残っていたら元に戻す */
  const unpatchSeek = () =>
    page.evaluate(() => {
      const patch = window.__seekPatch;
      if (patch && patch.queue.length > 0) patch.restore();
      window.__seekPatch = undefined;
    });
  /** 「撃発ポイントを確定」のあと、失敗の案内が出る（failed）か、保存の段階へ進む（form）かを待つ */
  const captureOutcome = async () => {
    const handle = await page.waitForFunction(
      () => {
        if (document.querySelector('[data-testid=shot-capture-failed]')) return 'failed';
        if (document.querySelector('[data-testid=form-summary]')) return 'form';
        return false;
      },
      null,
      { timeout: 10_000 },
    );
    return handle.jsonValue();
  };
  /** 保存の段階から撃発の段階へ戻り、落ち着くのを待つ */
  const backToShot = async () => {
    await tid('form-back').click();
    await tid('shot-player').waitFor();
    await waitSettled('shot-player');
  };
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

  // ③ 切り抜き：推定が終わると、ボタンを押さなくても自動で進む
  await tid('clip-player').waitFor({ timeout: 15 * 60_000 });
  check(
    '推定が終わると自動で切り抜きの段階へ進む（3 切り抜き）',
    (await stepOf()) === 'clip' && (await tid('step-title').textContent()) === '3 切り抜き',
    await tid('step-title').textContent(),
  );
  await tid('clip-player').waitFor();
  await waitSettled('clip-player');
  check('切り抜きの取っ手が 2 つある', (await page.locator('.wave-handle').count()) === 2);
  check(
    '切り抜きのつまみは丸いまま（▲ ではない）',
    (await page.locator('[data-testid=clip-player-bar] .wave-arrow').count()) === 0,
  );
  await tid('clip-player-bar-wave').waitFor({ timeout: 15_000 });
  check('音のグラフが出る', (await tid('clip-player-bar-wave').count()) === 1);
  const total = Number(await tid('clip-player-bar-slider').getAttribute('max'));
  summary.durationSec = total;
  check('バーの右端が動画の長さ', near(total, 5, 0.2), total);

  // 画面に出ている動画の絵が、黒くなく、時点を変えると変わる
  await slideTo('clip-player-bar', 0.5);
  await waitSettled('clip-player');
  await page.waitForTimeout(400);
  const pic1 = await pixelsOf(await pictureOf('clip-player-stage'));
  // 4.9 秒では銃を下ろし始めているので、据銃中（0.5 秒）と絵が違う
  await slideTo('clip-player-bar', 4.9);
  await waitSettled('clip-player');
  await page.waitForTimeout(400);
  const pic2 = await pixelsOf(await pictureOf('clip-player-stage'));
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
  check(
    '撃発の説明が新しい文言',
    (await page.locator('[data-testid=save-screen] > p.muted').first().textContent()) ===
      '撃発の発射音に合わせてあります。修正が必要な場合は指定しなおしてください。',
  );
  check(
    '撃発のつまみが ▲',
    (await page.locator('[data-testid=shot-player-bar] .wave-arrow').count()) === 1,
  );
  check(
    '骨格の色の説明（緑：見えている点…）は出ない',
    !(await page.locator('body').textContent()).includes('見えている点'),
  );
  check(
    'ボタンは「撃発ポイントを確定」だけで、「保存へ」は出ない',
    (await tid('shot-set').textContent()) === '撃発ポイントを確定' &&
      (await tid('shot-to-save').count()) === 0,
    await tid('shot-set').textContent(),
  );
  // まず、つまみを触らずに確定する（音の最大のコマが撃発ポイントになる）
  await shotPng('shot');
  await tid('shot-set').click();
  await tid('form-summary').waitFor({ timeout: 15_000 });
  const firstSummary = await tid('form-summary').locator('strong').textContent();
  // 保存から戻ると、つまみは確定した撃発ポイントにいる。動かさずに確定し直しても、撃発ポイントは変わらない
  await tid('form-back').click();
  await tid('shot-player').waitFor();
  await waitSettled('shot-player');
  const backSec = await valueSecOf('shot-player-bar');
  check(
    '触らずに確定して保存から戻ると、つまみが確定した撃発ポイントにいる',
    near(backSec, loudest, 0.04) && firstSummary.includes(backSec.toFixed(2)),
    `${backSec} / ${firstSummary}`,
  );
  await tid('shot-set').click();
  await tid('form-summary').waitFor({ timeout: 15_000 });
  check(
    '動かさずに確定し直しても、撃発ポイントは変わらない',
    (await tid('form-summary').locator('strong').textContent()) === firstSummary,
    await tid('form-summary').locator('strong').textContent(),
  );
  // 「再生 → 止める → 撃発ポイントを確定」とすると、止めたときに見えていたコマが撃発ポイントになる（最終-1）。
  // 止めた直後の動画の時刻が、骨格・コマ番号のコマの中にあることと、確定した撃発ポイントがそのコマであることを確かめる
  await tid('form-back').click();
  await tid('shot-player').waitFor();
  await waitSettled('shot-player');
  const shotVideo = '[data-testid=shot-player-stage] video';
  const recording = await presented.record(shotVideo);
  await tid('shot-player-play').click();
  await presented.waitPlaying(shotVideo);
  await page.waitForTimeout(650);
  await tid('shot-player-play').click();
  await waitSettled('shot-player');
  await page.waitForTimeout(300);
  const pausedShot = await videoState('shot-player');
  const pausedFrame = await frameOf('shot-player');
  const seenSec = await presented.whilePlaying();
  check(
    '撃発の段階で止めると、止めた瞬間に見えていたコマ（止める直前に表示されたコマ）がそのまま選ばれる',
    // コマの時刻は解析のときに同じ通知から記録したものだが、Chrome では 1 ミリ秒ほど違うことがあるので半コマまで許す
    recording && seenSec !== null && near(seenSec, pausedFrame.sec, 1 / 60),
    `見えていた ${seenSec} / 選ばれた コマ ${pausedFrame.index}（${pausedFrame.sec.toFixed(4)} 秒）`,
  );
  check(
    '撃発の段階で止めると、動画の時刻が表示中のコマの中にある',
    inFrame(pausedShot.t, pausedFrame.sec),
    `t=${pausedShot.t.toFixed(4)} コマ ${pausedFrame.index}（${pausedFrame.sec.toFixed(4)} 秒〜）`,
  );
  await tid('shot-set').click();
  await tid('form-summary').waitFor({ timeout: 15_000 });
  const pausedSummary = await tid('form-summary').locator('strong').textContent();
  check(
    '止めたあとに確定すると、見えていたコマが撃発ポイントになる',
    // 30 fps では小数 2 桁で隣のコマと区別できる（コマ番号の数え方は最終-25 で変わるので見ない）
    pausedSummary.includes(`${pausedFrame.sec.toFixed(2)} 秒`),
    `${pausedSummary}（コマ ${pausedFrame.index}、${pausedFrame.sec.toFixed(2)} 秒）`,
  );
  await tid('form-back').click();
  await tid('shot-player').waitFor();
  await waitSettled('shot-player');
  await slideTo('shot-player-bar', loudest);
  await waitSettled('shot-player');
  // 音の最大のコマで確定し直し、保存の段階に戻しておく（この先の流れは保存の段階から始まる）
  await tid('shot-set').click();
  await tid('form-summary').waitFor({ timeout: 15_000 });

  // 静止画は必ず撃発のコマから作られる（最終-3）。シークに細工をして確かめる
  // 確定済みの撃発ポイントと同じコマで押すと撮影を省略して進むので、細工の前に 1 コマ動かして必ず撮影させる
  const moveOneFrame = async () => {
    await tid('shot-player-prev').click();
    await waitSettled('shot-player');
  };
  // (a) シークの完了の通知が来ない → 時間切れ（3 秒）は失敗として案内し、保存の段階へ進まない
  await backToShot();
  await moveOneFrame();
  await patchSeek(['drop']);
  await tid('shot-set').click();
  const dropOutcome = await captureOutcome();
  await unpatchSeek();
  check(
    'シークが終わらないときは「静止画を作れませんでした」と出て、保存の段階へ進まない',
    dropOutcome === 'failed' && (await stepOf()) === 'shot',
    dropOutcome,
  );
  if ((await stepOf()) === 'shot') {
    // もう一度押すと撮れる
    await tid('shot-set').click();
    await tid('form-summary').waitFor({ timeout: 15_000 });
    check('失敗のあと、もう一度押すと撮れて保存の段階へ進む', true);
  }
  // (b) シークを 1.2 秒遅らせる → 撮っている間は、バー・◀ ▶・再生が押せず、ボタンの表示が変わる
  await backToShot();
  await moveOneFrame();
  await patchSeek(['delay']);
  await tid('shot-set').click();
  await page.waitForTimeout(400);
  const duringCapture = {
    button: await tid('shot-set').textContent(),
    bar: await tid('shot-player-bar-slider').isDisabled(),
    prev: await tid('shot-player-prev').isDisabled(),
    next: await tid('shot-player-next').isDisabled(),
    play: await tid('shot-player-play').isDisabled(),
  };
  const delayOutcome = await captureOutcome();
  await unpatchSeek();
  check(
    '静止画を作っている間は、バー・◀ ▶・再生が押せず、ボタンが「静止画を作っています…」',
    duringCapture.button === '静止画を作っています…' &&
      duringCapture.bar &&
      duringCapture.prev &&
      duringCapture.next &&
      duringCapture.play &&
      delayOutcome === 'form',
    `${JSON.stringify(duringCapture)} → ${delayOutcome}`,
  );
  if ((await stepOf()) === 'shot') {
    await tid('shot-set').click();
    await tid('form-summary').waitFor({ timeout: 15_000 });
  }
  // (c) シークが狙いと別のコマ（1 コマ後）に着く → 失敗にする（写真だけ別のコマの記録を作らない）。
  // 画面側は着いたコマがずれていると直しのシークをするので、それも 1 回だけ無効にして、別のコマが出たままにする
  await backToShot();
  await moveOneFrame();
  await patchSeek(['shift', 'drop']);
  await tid('shot-set').click();
  const shiftOutcome = await captureOutcome();
  await unpatchSeek();
  check(
    'シークが別のコマに着いたときは失敗として案内する（写真だけ別のコマにならない）',
    shiftOutcome === 'failed' && (await stepOf()) === 'shot',
    shiftOutcome,
  );
  if ((await stepOf()) === 'shot') {
    await tid('shot-set').click();
    await tid('form-summary').waitFor({ timeout: 15_000 });
  }
  // (d) 再生中は「撃発ポイントを確定」が押せず、案内が出る。止めると押せる
  await backToShot();
  await tid('shot-player-play').click();
  await presented.waitPlaying(shotVideo);
  // 画面の「再生中」の状態は、再生の開始から少し遅れて反映されるので、案内が出るのを待ってから読む
  await tid('shot-stop-note')
    .waitFor({ timeout: 3000 })
    .catch(() => {});
  const whilePlaying = {
    setDisabled: await tid('shot-set').isDisabled(),
    note: (await tid('shot-stop-note').count()) === 1,
  };
  await tid('shot-player-play').click();
  await waitSettled('shot-player');
  await tid('shot-stop-note')
    .waitFor({ state: 'detached', timeout: 3000 })
    .catch(() => {});
  const afterPause = {
    setDisabled: await tid('shot-set').isDisabled(),
    note: (await tid('shot-stop-note').count()) === 1,
  };
  check(
    '再生中は「撃発ポイントを確定」が押せず「止めると確定できます」の案内。止めると押せる',
    whilePlaying.setDisabled && whilePlaying.note && !afterPause.setDisabled && !afterPause.note,
    `再生中 ${JSON.stringify(whilePlaying)} 停止後 ${JSON.stringify(afterPause)}`,
  );
  // 音の最大のコマで確定し直し、保存の段階へ
  await slideTo('shot-player-bar', loudest);
  await waitSettled('shot-player');
  await tid('shot-set').click();
  await tid('form-summary').waitFor({ timeout: 15_000 });
  // 戻って 1 コマ前に直し、確定する
  await tid('form-back').click();
  await tid('shot-player').waitFor();
  await waitSettled('shot-player');
  await tid('shot-player-prev').click();
  await waitSettled('shot-player');
  const shotSec = await valueSecOf('shot-player-bar');
  await tid('shot-set').click();

  // ⑤ 保存：「撃発ポイントを確定」を押すと、自動で進む
  await tid('form-summary').waitFor({ timeout: 15_000 });
  check(
    '「撃発ポイントを確定」で自動で保存の段階へ進む（5 保存）',
    (await stepOf()) === 'form' && (await tid('step-title').textContent()) === '5 保存',
    await tid('step-title').textContent(),
  );
  check(
    '保存の段階に、確定した撃発ポイントの時刻が出る',
    (await tid('form-summary').textContent()).includes(shotSec.toFixed(2)),
    await tid('form-summary').textContent(),
  );
  // 保存の段階から戻ると、確定した撃発ポイントの印が出ていて、もう一度確定すれば保存へ進む
  await tid('form-back').click();
  await tid('shot-player').waitFor();
  await waitSettled('shot-player');
  check(
    '保存から戻ると、確定した撃発ポイントの印と時刻が出る',
    (await tid('shot-player-bar-marker-shot').count()) === 1 &&
      (await tid('shot-status').textContent()).includes(shotSec.toFixed(2)),
    await tid('shot-status').textContent(),
  );
  await tid('shot-set').click();
  await tid('form-summary').waitFor({ timeout: 15_000 });
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
  // 再生中の画面の更新は、コマが変わるときだけ（最終-14）。1 倍で 1 秒間に、つまみの時刻が変わる回数を数える
  await tid('player-rate-100').click();
  await slideTo('player-bar', 1.5);
  await waitSettled('player');
  await tid('player-play').click();
  await page.waitForTimeout(200);
  const updates = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const el = document.querySelector('[data-testid=player-bar]');
        let n = 0;
        const observer = new MutationObserver((list) => (n += list.length));
        observer.observe(el, { attributes: true, attributeFilter: ['data-value-sec'] });
        setTimeout(() => {
          observer.disconnect();
          resolve(n);
        }, 1000);
      }),
  );
  await tid('player-play').click();
  await page.waitForTimeout(300);
  check('再生中の時刻の更新は 1 秒にコマ数（30）以下', updates <= 33, `${updates} 回/秒`);
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
  // 再生中は「撃発ポイントを確定」が押せず、止めると押せる（保存の流れと同じ）
  await tid('player-play').click();
  await presented.waitPlaying('[data-testid=player-stage] video');
  await tid('shot-stop-note')
    .waitFor({ timeout: 3000 })
    .catch(() => {});
  const fixWhilePlaying = {
    setDisabled: await tid('shot-set').isDisabled(),
    note: (await tid('shot-stop-note').count()) === 1,
  };
  await tid('player-play').click();
  await waitSettled('player');
  await tid('shot-stop-note')
    .waitFor({ state: 'detached', timeout: 3000 })
    .catch(() => {});
  check(
    '撃発ポイントの修正でも、再生中は確定が押せず案内が出る。止めると押せる',
    fixWhilePlaying.setDisabled &&
      fixWhilePlaying.note &&
      !(await tid('shot-set').isDisabled()) &&
      (await tid('shot-stop-note').count()) === 0,
    JSON.stringify(fixWhilePlaying),
  );
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
  check(
    '範囲の修正のつまみも丸いまま（▲ ではない）',
    (await page.locator('[data-testid=player-bar] .wave-arrow').count()) === 0,
  );
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
