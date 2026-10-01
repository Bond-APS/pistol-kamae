// 段階④（2 件の比較・水平校正）の自動テスト。実際の画面をブラウザで操作して確かめる。
// 開発サーバ（npm run dev）を起動した状態で使う。
//   node apps/web/e2e/comparetest.mjs webkit   … Safari と同じ描画エンジン
//   node apps/web/e2e/comparetest.mjs chromium … Chrome と同じ描画エンジン
// 動画は apps/web/e2e/videos/ の motion.mp4（腕を上げる動き）、static0.mp4（据銃区間）、
// test_3s_30fps.mp4（人物のいない縦長の試験用の絵）。前の 2 本の作り方は marktest.mjs の冒頭。
// 毎回、保存データが空のブラウザで始める（テストで作った記録は、終了時にブラウザごと消える）。
// 結果は apps/web/e2e/results/compare-<ブラウザ名>.json / .png に保存する（git 管理外）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const [browserName = 'webkit'] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:5173';
const videoA = join(here, 'videos', 'motion.mp4');
const videoB = join(here, 'videos', 'static0.mp4');
const videoNoPerson = join(here, 'videos', 'test_3s_30fps.mp4');
const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });

const launcher = { chromium, webkit }[browserName];
if (!launcher) throw new Error(`unknown browser: ${browserName}`);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`  ${ok ? 'OK  ' : 'NG  '} ${name}${detail === '' ? '' : `  [${detail}]`}`);
};

// 通常は画面を表示して動かす。Mac の画面がロック中・消灯中は、表示したウィンドウの描画更新が
// 約 50 秒で止まるので、HEADLESS=1 を付けて画面を出さずに動かす（操作の確認用。速度の計測には使わない）
const browser = await launcher.launch({ headless: process.env.HEADLESS === '1' });
const VIEWPORT = { width: 393, height: 760 };
// iPhone に近い幅と高さで確かめる
let page = await browser.newPage({ viewport: VIEWPORT });
const logs = [];
const watch = (p) => {
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
  });
  p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
};
watch(page);

const tid = (id) => page.locator(`[data-testid=${id}]`);
const waitFrame = (index) =>
  page.waitForFunction(
    (i) => {
      const label = document.querySelector('[data-testid=frame-label]');
      const video = document.querySelector('.video-box video');
      return label?.getAttribute('data-frame-index') === String(i) && video && !video.seeking;
    },
    index,
    { timeout: 10_000 },
  );
const slideTo = async (index) => {
  await tid('frame-slider').evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, index);
  await waitFrame(index);
  await page.waitForTimeout(300);
};
const registerShooter = async (name, hand) => {
  await tid('shooter-name').fill(name);
  await tid(`shooter-${hand}`).click();
  await tid('shooter-submit').click();
  await tid('shooter-dialog').waitFor({ state: 'detached' });
};
/** 動画を選び、姿勢推定をして、フレームの position（0〜1）の位置に撃発マークを付けて保存する */
const analyzeAndSave = async (path, position, fields) => {
  await tid('tab-load').click();
  await tid('video-file').setInputFiles(path);
  await page.waitForFunction(
    () => document.querySelector('[data-testid=run-analysis]')?.disabled === false,
    null,
    { timeout: 60_000 },
  );
  await tid('run-analysis').click({ timeout: 60_000 });
  await tid('analysis-done').waitFor({ timeout: 15 * 60_000 });
  await tid('go-mark').click();
  await tid('frame-slider').waitFor();
  const total = Number(await tid('frame-slider').getAttribute('max')) + 1;
  await slideTo(Math.floor(total * position));
  await tid('mark-shot').click();
  await tid('save-open').click();
  await tid('record-form').waitFor();
  if (fields.favorite) await tid('form-favorite').click();
  if (fields.score) await tid('form-score').fill(fields.score);
  await tid('form-shot-at').fill(fields.shotAt);
  await tid('form-submit').click();
  await tid('save-done').waitFor({ timeout: 20_000 });
  return Number(await tid('save-block').getAttribute('data-saved-id'));
};

/** 角度表（開いた記録）を読む */
const detailTable = () =>
  tid('detail-table')
    .locator('tr[data-metric]')
    .evaluateAll((trs) =>
      Object.fromEntries(
        trs.map((tr) => [
          tr.dataset.metric,
          tr.dataset.value === '' ? null : Number(tr.dataset.value),
        ]),
      ),
    );
/** 差分表を読む */
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
              texts: [...tr.children].slice(1).map((td) => td.textContent),
              colored: tr.children[3].classList.contains(tr.dataset.level),
            },
          ];
        }),
      ),
    );
/** 骨格の点の位置（関節の順）と線の数。scope は骨格の入った図の data-testid */
const skeleton = (layer, scope = 'still') =>
  page.evaluate(
    ([l, s]) => {
      const g = document.querySelector(`[data-testid=${s}] [data-testid=${l}]`);
      if (!g) return null;
      const lines = [...g.querySelectorAll('line')];
      return {
        lines: lines.length,
        dashed: lines.filter((el) => el.getAttribute('stroke-dasharray')).length,
        points: [...g.querySelectorAll('circle')].map((c) => ({
          x: Number(c.getAttribute('cx')),
          y: Number(c.getAttribute('cy')),
        })),
      };
    },
    [layer, scope],
  );
// 関節の順は engine の LANDMARK_NAMES：鼻、左耳、右耳、左肩、右肩、左腰、右腰、左手首、右手首、左足首、右足首
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const anchorOf = (points) => {
  const hip = mid(points[5], points[6]);
  return { hip, trunk: dist(hip, mid(points[3], points[4])) };
};
const openDetail = async (recordId) => {
  await tid('tab-library').click();
  if ((await tid('record-detail').count()) > 0) await tid('detail-back').click();
  await page
    .locator(`[data-testid=lib-item][data-record-id="${recordId}"] [data-testid=lib-open]`)
    .click();
  await tid('detail-table').waitFor();
};
/**
 * 絵の指紋：16×16 画素に縮めた明るさの並び。どの時点の絵かを見分けるのに使う（librarytest.mjs と同じ作り方）。
 */
const SIGNATURE = `(source, w, h) => {
  const mid = document.createElement('canvas');
  mid.width = 256; mid.height = 256;
  const midCtx = mid.getContext('2d');
  midCtx.imageSmoothingQuality = 'high';
  midCtx.drawImage(source, 0, 0, w, h, 0, 0, 256, 256);
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mid, 0, 0, 256, 256, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  const out = [];
  for (let i = 0; i < d.length; i += 4) out.push((d[i] + d[i + 1] + d[i + 2]) / 3);
  return out;
}`;
const pictureGap = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
/** 開いた記録の静止画（撃発の瞬間）の指紋 */
const stillSignature = () =>
  page.evaluate(`(async () => {
    const href = document.querySelector('[data-testid=still-image]')?.getAttribute('href');
    const img = new Image();
    img.src = href;
    await img.decode();
    return (${SIGNATURE})(img, img.naturalWidth, img.naturalHeight);
  })()`);
/** 比較画面の動画（role は base か current）：いま出ている絵の指紋と、時刻・濃さ */
const stageVideo = (role) =>
  page.evaluate(`(() => {
    const v = document.querySelector('[data-testid=stage-video-${role}]');
    if (!v) return null;
    const layer = v.closest('.stage-layer');
    return {
      ready: v.readyState,
      width: v.videoWidth,
      time: v.currentTime,
      paused: v.paused,
      seeking: v.seeking,
      opacity: Number(getComputedStyle(layer).opacity),
      sig: v.readyState >= 2 ? (${SIGNATURE})(v, v.videoWidth, v.videoHeight) : null,
    };
  })()`);
/** 比較画面の動画が、指定の時点の絵を出し終えるまで待つ */
const waitStageVideos = () =>
  page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid^=stage-video-]')].every(
        (v) => v.readyState >= 2 && !v.seeking,
      ),
    null,
    { timeout: 20_000 },
  );
const timeIndex = async (role) =>
  Number(await tid(`time-${role}`).getAttribute('data-frame-index'));
/** 時点のバーを動かす */
const slideTime = async (role, index) => {
  await tid(`time-${role}-slider`).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, index);
  await page.waitForFunction(
    ([r, i]) => document.querySelector(`[data-testid=time-${r}]`)?.dataset.frameIndex === String(i),
    [role, index],
  );
  await waitStageVideos();
  await page.waitForTimeout(150);
};
/** ブラウザ内データベースを直接見る（動画本体の表の件数、削除） */
const videoRows = (deleteId = null) =>
  page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('pistol-kamae');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('recordVideos', 'readwrite');
          const store = tx.objectStore('recordVideos');
          if (id !== null) store.delete(id);
          const keys = store.getAllKeys();
          tx.oncomplete = () => {
            db.close();
            resolve(keys.result);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    deleteId,
  );
const waitCompare = () => tid('diff-table').waitFor({ timeout: 10_000 });
/** 記録を選ぶ窓が開き、一覧（または「候補なし」の案内）が出るまで待つ */
const waitPicker = () =>
  page
    .locator('[data-testid=picker-item], [data-testid=picker-empty], [data-testid=picker-no-match]')
    .first()
    .waitFor();
/** 画面の右端からはみ出している部品（横スクロールの原因）を挙げる */
const overflowing = () =>
  page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[data-testid=compare] *')) {
      if (el.closest('svg') && el.tagName !== 'svg') continue;
      // 動画の枠の中身は、枠で切り取られるので数えない
      if (el.closest('.stage') && !el.classList.contains('stage')) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 0.5) {
        out.push(
          `${el.tagName.toLowerCase()}.${el.className} +${Math.round(r.right - window.innerWidth)}`,
        );
      }
    }
    if (document.documentElement.scrollWidth > window.innerWidth) out.push('page');
    return out;
  });
const pairIds = async () => [
  await tid('pair-base').getAttribute('data-record-id'),
  await tid('pair-current').getAttribute('data-record-id'),
];

/** 水平の線を引く画面：読み取りと操作 */
const level = {
  readout: async () => ({
    tilt: Number(await tid('level-readout').getAttribute('data-tilt')),
    kind: await tid('level-readout').getAttribute('data-kind'),
    text: await tid('level-readout').textContent(),
  }),
  end: async (n) => ({
    x: Number(await tid(`level-handle-${n}`).getAttribute('data-x')),
    y: Number(await tid(`level-handle-${n}`).getAttribute('data-y')),
  }),
  /** 線の端 n を、画像の座標 (x, y) まで、つまみを引きずって動かす */
  dragTo: async (n, x, y) => {
    const from = await level.end(n);
    const box = await tid(`level-handle-${n}`).boundingBox();
    // 画像の 1 画素が画面上で何 px か
    const scale = await tid('level-svg').evaluate((svg) => svg.getScreenCTM().a);
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const goal = { x: start.x + (x - from.x) * scale, y: start.y + (y - from.y) * scale };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move((start.x + goal.x) / 2, (start.y + goal.y) / 2, { steps: 4 });
    await page.mouse.move(goal.x, goal.y, { steps: 4 });
    await page.mouse.up();
  },
};

let fatal = null;
const summary = {};
try {
  console.log(`open ${base} (${browserName})`);
  await page.goto(base);

  // ── A：タブ。5 つが iPhone の幅に収まる
  const tabTexts = await page.locator('nav.tabs .tab').allTextContents();
  check(
    'タブは 5 つ（読込・マーク・ライブラリ・比較・ノイズ）',
    tabTexts.join('|') === '読込|マーク|ライブラリ|比較|ノイズ',
    tabTexts.join('|'),
  );
  const tabsFit = () =>
    page.evaluate(() => {
      const nav = document.querySelector('nav.tabs');
      const tabs = [...nav.querySelectorAll('.tab')];
      return {
        nav: nav.scrollWidth <= nav.clientWidth,
        tabs: tabs.every((t) => t.scrollWidth <= t.clientWidth),
        page: document.documentElement.scrollWidth <= window.innerWidth,
        minWidth: Math.min(...tabs.map((t) => Math.round(t.getBoundingClientRect().width))),
      };
    });
  let fit = await tabsFit();
  check(
    '幅 393px でタブの文字がはみ出さない',
    fit.nav && fit.tabs && fit.page,
    JSON.stringify(fit),
  );
  await page.setViewportSize({ width: 320, height: 700 });
  fit = await tabsFit();
  check(
    '幅 320px でもタブの文字がはみ出さない',
    fit.nav && fit.tabs && fit.page,
    JSON.stringify(fit),
  );
  await page.setViewportSize(VIEWPORT);

  // ── B：まだ何も選んでいない比較画面
  await tid('tab-compare').click();
  await tid('compare-start').waitFor();
  check('初めての比較画面に案内と「基準を選ぶ」が出る', true);
  await tid('compare-start').click();
  await tid('picker-empty').waitFor();
  check('記録が無いと、基準を選ぶ窓に案内が出る', (await tid('picker-item').count()) === 0);
  await tid('picker-go-library').click();
  await tid('library-empty').waitFor();
  check(
    '「ライブラリを開く」でライブラリへ移り、窓が閉じる',
    (await tid('record-picker').count()) === 0 && (await tid('library-empty').count()) === 1,
  );

  // ── C：記録を 2 件作る（同じ射手。A はお気に入り＝基準の候補）
  await tid('tab-load').click();
  await tid('shooter-register').click();
  await registerShooter('山田', 'right');
  console.log('  姿勢推定を実行中（1 本目）…');
  const recordA = await analyzeAndSave(videoA, 0.75, {
    favorite: true,
    score: '10.5',
    shotAt: '2026-08-29T15:40',
  });
  console.log('  姿勢推定を実行中（2 本目）…');
  const recordB = await analyzeAndSave(videoB, 0.5, { score: '9.1', shotAt: '2026-09-30T13:52' });
  check('保存した直後の帯に「基準と比べる」が出る', (await tid('save-compare').count()) === 1);

  // それぞれの記録の角度（水平の線を引く前）と、骨格の位置を控えておく
  await openDetail(recordA);
  const rawA = await detailTable();
  const skeletonA = await skeleton('still-skeleton');
  check(
    '開いた記録に「水平の線：なし」と「線を引く」が出る',
    (await tid('detail-level').getAttribute('data-has-level')) === 'false' &&
      (await tid('detail-level').textContent()).includes('水平の線：なし') &&
      (await tid('detail-level-open').textContent()) === '線を引く',
    await tid('detail-level').textContent(),
  );
  check('線を引く前は、角度表に補正の注記が出ない', (await tid('metric-note').count()) === 0);
  await tid('detail-video').waitFor();
  check(
    '保存した記録に、動画本体が保存されている',
    (await tid('detail-video').getAttribute('data-has-video')) === 'true' &&
      (await tid('detail-attach').count()) === 0 &&
      (await videoRows()).join(',') === `${recordA},${recordB}`,
    (await videoRows()).join(','),
  );
  const stillSigA = await stillSignature();
  await openDetail(recordB);
  const rawB = await detailTable();
  const skeletonB = await skeleton('still-skeleton');
  summary.rawA = rawA;
  summary.rawB = rawB;

  // ── D：保存直後の帯から比較へ。基準が未選択なので、先に基準を選ぶ窓が開く
  await tid('tab-mark').click();
  await tid('save-compare').click();
  await waitPicker();
  check('「基準と比べる」を押すと、基準を選ぶ窓が先に開く', true);
  let pickerIds = await tid('picker-item').evaluateAll((els) => els.map((e) => e.dataset.recordId));
  check(
    '基準の候補はお気に入りの記録だけ',
    pickerIds.join(',') === String(recordA),
    pickerIds.join(','),
  );
  await tid('picker-pick').first().click();
  await waitCompare();
  check(
    '行を押すと決まり、2 件の欄に基準と今回が出る',
    (await pairIds()).join(',') === `${recordA},${recordB}` &&
      (await tid('pair-base-date').textContent()) === '8/29（土）15:40' &&
      (await tid('pair-current-date').textContent()) === '9/30（水）13:52',
    (await pairIds()).join(','),
  );
  check(
    '「比較」タブが選択中になる',
    (await tid('tab-compare').getAttribute('aria-current')) === 'page',
  );
  check('比較画面では動画が隠れる', !(await page.locator('.video-box video').isVisible()));

  // ── E：重ね描き
  const current1 = await skeleton('still-skeleton');
  const base1 = await skeleton('still-skeleton-base');
  check(
    '今回の骨格（実線）と基準の骨格（点線）が重なって出る',
    current1?.lines === 20 &&
      current1.dashed === 0 &&
      current1.points.length === 11 &&
      base1?.lines === 20 &&
      base1.dashed === 10 &&
      base1.points.length === 11,
    JSON.stringify({ current: current1?.lines, base: base1?.lines, dashed: base1?.dashed }),
  );
  check(
    '今回の骨格は、写真の上の元の位置のまま',
    current1.points.every((p, i) => dist(p, skeletonB.points[i]) < 1e-6),
  );
  const a1 = anchorOf(base1.points);
  const c1 = anchorOf(current1.points);
  summary.normalized = { hipGap: dist(a1.hip, c1.hip), trunkRatio: a1.trunk / c1.trunk };
  check(
    '揃える：腰の中心が重なり、体幹の長さが同じ',
    dist(a1.hip, c1.hip) < 0.01 && Math.abs(a1.trunk / c1.trunk - 1) < 1e-6,
    JSON.stringify(summary.normalized),
  );
  check(
    '既定は「重ねる」「位置と大きさを揃える」',
    (await tid('toggle-side').getAttribute('aria-pressed')) === 'false' &&
      (await tid('align-normalized').getAttribute('aria-pressed')) === 'true' &&
      (await tid('compare-overlay').getAttribute('data-align')) === 'normalized',
  );

  // ── E2：動画どうしの重ね描きと、時点のバー
  await waitStageVideos();
  let vBase = await stageVideo('base');
  let vCurrent = await stageVideo('current');
  check(
    '基準と今回の動画が、どちらも表示されている',
    vBase?.width > 0 && vCurrent?.width > 0 && vBase.paused && vCurrent.paused,
    `${vBase?.width} / ${vCurrent?.width}`,
  );
  check(
    '今回の動画の上に、基準の動画が半透明（濃さ 50%）で重なる',
    vCurrent.opacity === 1 && Math.abs(vBase.opacity - 0.5) < 1e-6,
    `${vCurrent.opacity} / ${vBase.opacity}`,
  );
  const shotA = await timeIndex('base');
  const shotB = await timeIndex('current');
  check(
    '開いた直後は、どちらも撃発の瞬間',
    (await tid('time-base-label').textContent()) === '撃発の瞬間' &&
      (await tid('time-current-label').textContent()) === '撃発の瞬間' &&
      (await tid('diff-title').textContent()) === '撃発の瞬間の差',
    `${shotA} / ${shotB}`,
  );
  summary.shotPictureGap = pictureGap(vBase.sig, stillSigA);
  check(
    '基準の動画に出ている絵は、撃発フレームの絵（保存した静止画と同じ）',
    summary.shotPictureGap < 3,
    summary.shotPictureGap.toFixed(2),
  );
  const diffsAtShot = await diffTable();
  // 基準のバーを 1 秒前（30 コマ前）へ。腕を上げる途中なので、絵も骨格も角度も変わる
  await slideTime('base', shotA - 30);
  vBase = await stageVideo('base');
  summary.movedPictureGap = pictureGap(vBase.sig, stillSigA);
  check(
    '基準のバーを動かすと、基準の動画の絵が変わる（動きのある動画）',
    summary.movedPictureGap > 1 && summary.movedPictureGap > summary.shotPictureGap * 2,
    `撃発 ${summary.shotPictureGap.toFixed(2)} → 1 秒前 ${summary.movedPictureGap.toFixed(2)}`,
  );
  check(
    '時点が「撃発の 1.00 秒前」と出て、表の題が「選んだ時点の差」になる',
    (await tid('time-base-label').textContent()) === '撃発の 1.00 秒前' &&
      (await tid('diff-title').textContent()) === '選んだ時点の差' &&
      (await tid('diff-times').textContent()) === '基準：撃発の 1.00 秒前／今回：撃発の瞬間',
    await tid('diff-times').textContent(),
  );
  const movedBaseSkeleton = await skeleton('still-skeleton-base');
  const diffsMoved = await diffTable();
  check(
    '基準の骨格と、差分表の基準の列が、その時点のものに変わる（今回の列は変わらない）',
    dist(movedBaseSkeleton.points[8], base1.points[8]) > 5 &&
      diffsMoved.armElevation.base !== diffsAtShot.armElevation.base &&
      Object.keys(diffsMoved).every((id) => diffsMoved[id].current === diffsAtShot[id].current) &&
      (await timeIndex('current')) === shotB,
    `腕の挙上角 ${diffsAtShot.armElevation.base} → ${diffsMoved.armElevation.base}`,
  );
  const hipMoved = anchorOf(movedBaseSkeleton.points).hip;
  check(
    '位置合わせは撃発の瞬間で決めたまま（時点を動かしても合わせ直さない）',
    (await skeleton('still-skeleton')).points.every((p, i) => dist(p, current1.points[i]) < 1e-6) &&
      dist(hipMoved, a1.hip) < a1.trunk * 0.2,
  );
  await tid('time-base-next').click();
  await page.waitForFunction(
    (i) => document.querySelector('[data-testid=time-base]')?.dataset.frameIndex === String(i),
    shotA - 29,
  );
  check('「1 コマ ▶」で 1 コマ進む', (await timeIndex('base')) === shotA - 29);
  // 2 本を一緒に動かす：今回を 15 コマ（0.5 秒）戻すと、基準も 0.5 秒戻る
  await tid('toggle-linked').click();
  await slideTime('current', shotB - 15);
  check(
    '「2 本を一緒に動かす」を入れると、片方を動かした秒数だけ、もう片方も動く',
    (await timeIndex('base')) === shotA - 29 - 15 &&
      (await tid('time-current-label').textContent()) === '撃発の 0.50 秒前',
    `${await timeIndex('base')} / ${await tid('time-current-label').textContent()}`,
  );
  await tid('toggle-linked').click();
  await tid('time-current-shot').click();
  await tid('time-base-shot').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=diff-title]')?.textContent === '撃発の瞬間の差',
  );
  await waitStageVideos();
  const diffsBack = await diffTable();
  check(
    '「撃発へ」で撃発の瞬間に戻り、表も元に戻る（連動を切ると片方だけ動く）',
    (await timeIndex('base')) === shotA &&
      (await timeIndex('current')) === shotB &&
      Object.keys(diffsBack).every((id) => diffsBack[id].diff === diffsAtShot[id].diff),
  );
  // 押している間は基準だけ
  await tid('still').scrollIntoViewIfNeeded();
  const stageBox = await tid('still').boundingBox();
  await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
  await page.mouse.down();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=compare-overlay]')?.dataset.holding === 'true',
  );
  vBase = await stageVideo('base');
  vCurrent = await stageVideo('current');
  check(
    '絵を押している間は、基準の動画と基準の骨格だけが出る',
    vBase.opacity === 1 &&
      vCurrent.opacity === 0 &&
      (await skeleton('still-skeleton')) === null &&
      (await skeleton('still-skeleton-base'))?.lines === 20,
    `${vBase.opacity} / ${vCurrent.opacity}`,
  );
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=compare-overlay]')?.dataset.holding === 'false',
  );
  check(
    '離すと、今回の動画の上に基準が半透明で重なる表示に戻る',
    (await stageVideo('current')).opacity === 1 &&
      Math.abs((await stageVideo('base')).opacity - 0.5) < 1e-6 &&
      (await skeleton('still-skeleton'))?.lines === 20,
  );
  await tid('base-opacity').fill('0');
  check(
    '「基準の濃さ」を 0 にすると、基準の動画が見えなくなる',
    (await stageVideo('base')).opacity === 0,
  );
  await tid('base-opacity').fill('50');
  await tid('toggle-skeleton').click();
  check(
    '「骨格を表示」を切ると、骨格が消える（動画だけになる）',
    (await skeleton('still-skeleton')) === null && (await skeleton('still-skeleton-base')) === null,
  );
  await tid('toggle-skeleton').click();
  // 2 本を再生
  await slideTime('base', shotA - 45);
  await slideTime('current', shotB - 45);
  await tid('compare-play').click();
  await page.waitForFunction(
    ([a, b]) =>
      Number(document.querySelector('[data-testid=time-base]')?.dataset.frameIndex) > a + 5 &&
      Number(document.querySelector('[data-testid=time-current]')?.dataset.frameIndex) > b + 5,
    [shotA - 45, shotB - 45],
    { timeout: 10_000 },
  );
  check(
    '「2 本を再生」で 2 本とも進み、バーと骨格がついていく',
    !(await stageVideo('base')).paused && !(await stageVideo('current')).paused,
  );
  await tid('compare-play').click();
  await page.waitForTimeout(300);
  const pausedAt = [await timeIndex('base'), await timeIndex('current')];
  await page.waitForTimeout(400);
  check(
    '一時停止で 2 本とも止まる',
    (await stageVideo('base')).paused &&
      (await stageVideo('current')).paused &&
      (await timeIndex('base')) === pausedAt[0] &&
      (await timeIndex('current')) === pausedAt[1],
    pausedAt.join(' / '),
  );
  // 止めたあと、動画の絵と、骨格・バーが同じコマを指している
  await waitStageVideos();
  const afterPause = await page.evaluate(() => {
    const fps = 30;
    return ['base', 'current'].map((role) => ({
      index: Number(document.querySelector(`[data-testid=time-${role}]`).dataset.frameIndex),
      videoFrame: Math.floor(
        document.querySelector(`[data-testid=stage-video-${role}]`).currentTime * fps + 1e-6,
      ),
    }));
  });
  check(
    '止めたあと、動画の絵と骨格・バーが同じコマ',
    afterPause.every((v) => v.index === v.videoFrame),
    JSON.stringify(afterPause),
  );
  // 再生中に「横に並べる」へ切り替えても、時点が先頭に戻らない
  await tid('compare-play').click();
  await page.waitForTimeout(300);
  await tid('toggle-side').click();
  await tid('compare-side').waitFor();
  await waitStageVideos();
  const afterToggle = [await timeIndex('base'), await timeIndex('current')];
  summary.afterToggleDebug = [
    await stageVideo('base').then((v) => ({ t: v.time, rs: v.ready, seeking: v.seeking })),
    await page.waitForTimeout(700),
    await stageVideo('base').then((v) => ({ t: v.time, rs: v.ready, seeking: v.seeking })),
    await page.evaluate(() => document.querySelectorAll('[data-testid=stage-video-base]').length),
  ];
  check(
    '再生中に「横に並べる」へ切り替えると止まり、時点はそのまま（先頭に戻らない）',
    afterToggle[0] >= pausedAt[0] &&
      afterToggle[1] >= pausedAt[1] &&
      (await stageVideo('base')).paused &&
      Math.abs((await stageVideo('base')).time * 30 - afterToggle[0]) < 1,
    `${afterToggle.join(' / ')}、止めた位置 ${pausedAt.join(' / ')}、基準の動画 ${((await stageVideo('base')).time * 30).toFixed(2)} コマ目`,
  );
  await tid('toggle-side').click();
  await waitStageVideos();
  // 連動：片方を端まで動かして戻しても、入れたときの対応に戻る
  await slideTime('base', shotA - 20);
  await slideTime('current', shotB - 5);
  await tid('toggle-linked').click();
  // 基準のほうが撃発までが長いので、基準を先頭へ動かすと、今回は先頭で止まる
  await slideTime('base', 0);
  check(
    '連動中、相手が先頭より前へは行かない（0 で止まる）',
    (await timeIndex('current')) === 0,
    await timeIndex('current'),
  );
  await slideTime('base', shotA - 20);
  check(
    '端に当たってから戻しても、連動を入れたときの対応に戻る',
    (await timeIndex('current')) === shotB - 5,
    await timeIndex('current'),
  );
  await tid('toggle-linked').click();
  await page.screenshot({ path: join(outDir, `compare-${browserName}-video.png`), fullPage: true });

  // 動画のない記録：撃発の瞬間の写真と骨格だけが出る。あとから動画を付けられる
  await videoRows(recordB);
  await tid('tab-library').click();
  await tid('tab-compare').click();
  await tid('compare-no-video').waitFor();
  check(
    '動画のない記録を選ぶと案内が出て、撃発の瞬間は保存してある静止画が出る',
    (await tid('compare-no-video').textContent()).includes('「今回」の記録に動画がありません') &&
      (await tid('stage-still-current').count()) === 1 &&
      (await tid('stage-video-current').count()) === 0 &&
      (await tid('compare-play').isDisabled()),
  );
  await slideTime('current', shotB - 10);
  const diffsNoVideo = await diffTable();
  check(
    '動画がなくても、バーを動かすと骨格と差分表は変わる（写真は出ない）',
    (await tid('stage-still-current').count()) === 0 &&
      (await skeleton('still-skeleton'))?.lines === 20 &&
      (await tid('diff-title').textContent()) === '選んだ時点の差' &&
      Object.keys(diffsNoVideo).length === 9,
  );
  await tid('attach-current-file').setInputFiles(videoA);
  await tid('attach-current-error').waitFor();
  check(
    '別の動画（長さが違う）を選ぶと、付けずに理由を出す',
    (await tid('attach-current-error').textContent()).includes('この記録の動画ではないようです') &&
      (await videoRows()).join(',') === String(recordA),
  );
  await tid('attach-current-file').setInputFiles(videoB);
  await tid('stage-video-current').waitFor({ timeout: 20_000 });
  await waitStageVideos();
  check(
    '記録を作ったときの動画を選ぶと、動画が付き、案内が消える',
    (await tid('compare-no-video').count()) === 0 &&
      (await videoRows()).join(',') === `${recordA},${recordB}` &&
      (await stageVideo('current')).width > 0,
  );
  await tid('time-current-shot').click();
  await waitStageVideos();

  // ── F：差分表
  let diffs = await diffTable();
  const ids = Object.keys(diffs);
  const round = (id, v) => {
    const scale = id.endsWith('Tilt') || id.startsWith('arm') ? 10 : 100;
    return Math.round(v * scale) / scale;
  };
  const sameNumber = (a, b) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-9);
  check('差分表は 9 項目', ids.length === 9, ids.length);
  check(
    '基準・今回の列は、それぞれの記録の角度（表示の桁に丸めた値）',
    ids.every(
      (id) =>
        sameNumber(diffs[id].base, rawA[id] === null ? null : round(id, rawA[id])) &&
        sameNumber(diffs[id].current, rawB[id] === null ? null : round(id, rawB[id])),
    ),
    `肩線 基準 ${diffs.shoulderTilt.base} / 今回 ${diffs.shoulderTilt.current}`,
  );
  check(
    '差は「今回 − 基準」で、表の数字どうしの引き算と合う',
    ids.every((id) =>
      diffs[id].base === null || diffs[id].current === null
        ? diffs[id].diff === null
        : Math.abs(diffs[id].diff - (diffs[id].current - diffs[id].base)) < 1e-6,
    ),
    `肩線の差 ${diffs.shoulderTilt.diff}`,
  );
  // 色分けの境目：角度は 0.6° と 0.9°、腕と肩線のなす角は 0.8° と 1.2°、比は 0.02 と 0.03
  const expectedLevel = (id, diff) => {
    if (diff === null) return 'none';
    const width =
      id === 'armShoulderAngle' ? 0.4 : id.endsWith('Tilt') || id.startsWith('arm') ? 0.3 : 0.01;
    const size = Math.abs(diff) + 1e-9;
    return size >= width * 3 ? 'large' : size >= width * 2 ? 'notable' : 'none';
  };
  check(
    '色分けは、揺れの 2 倍以上で黄（◇）、3 倍以上で赤（◆）',
    ids.every((id) => diffs[id].level === expectedLevel(id, diffs[id].diff)),
    ids.map((id) => `${diffs[id].diff}:${diffs[id].level}`).join(' '),
  );
  check(
    '色の付いた差には印も付き（色だけに頼らない）、色のない差には印がない',
    ids.every((id) => {
      const text = diffs[id].texts[2];
      if (diffs[id].level === 'notable') return text.startsWith('◇ ') && diffs[id].colored;
      if (diffs[id].level === 'large') return text.startsWith('◆ ') && diffs[id].colored;
      return !/[◇◆]/.test(text);
    }),
    ids.map((id) => diffs[id].texts[2]).join(' / '),
  );
  check(
    '数値は単位付き（角度は °、比は小数 2 桁）。計測できない項目は「—」',
    ids.every((id) =>
      diffs[id].texts.every((t, i) => {
        const v = [diffs[id].base, diffs[id].current, diffs[id].diff][i];
        if (v === null) return t === '—';
        return /^(?:[◇◆] )?[+−]?\d+\.\d°$|^(?:[◇◆] )?[+−-]?\d+\.\d{2}$/.test(t);
      }),
    ),
    diffs.shoulderTilt.texts.join(' / '),
  );
  summary.levels = Object.fromEntries(ids.map((id) => [id, diffs[id].level]));

  // ── G：水平の線がないと案内が出る。比較画面から線を引ける
  check(
    'どちらにも水平の線がないと、案内と 2 つのボタンが出る',
    (await tid('compare-no-level').textContent()).includes('どちらにも水平の線がありません') &&
      (await tid('compare-level-base').count()) === 1 &&
      (await tid('compare-level-current').count()) === 1,
  );
  await page.screenshot({ path: join(outDir, `compare-${browserName}.png`), fullPage: true });

  await tid('compare-level-current').click();
  await tid('level-editor').waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid=level-loupe] image') !== null,
  );
  let readout = await level.readout();
  check(
    '線を引く画面：最初の線は水平（傾き 0°）で、そのまま決められる',
    readout.tilt === 0 &&
      readout.kind === 'horizontal' &&
      !(await tid('level-submit').isDisabled()),
    readout.text,
  );
  check('まだ線のない記録では「線を消す」が出ない', (await tid('level-remove').count()) === 0);
  const sizeB = await tid('level-svg').evaluate((svg) => {
    const image = svg.querySelector('image');
    return {
      width: Number(image.getAttribute('width')),
      height: Number(image.getAttribute('height')),
    };
  });
  // つまみが指で押せる大きさ（44px 以上）か
  const grab = await tid('level-handle-1').boundingBox();
  check(
    'つまみは指で押せる大きさ（44px 以上）で、線の端より下にある',
    grab.width >= 44 &&
      grab.height >= 44 &&
      (await tid('level-handle-1').evaluate(
        (c) => Number(c.getAttribute('cy')) > Number(c.dataset.y),
      )),
    `${grab.width.toFixed(1)}×${grab.height.toFixed(1)}`,
  );
  // 右の端を下げる → 右下がり
  const end2 = await level.end(2);
  await level.dragTo(2, end2.x, end2.y + sizeB.height * 0.03);
  readout = await level.readout();
  const moved2 = await level.end(2);
  check(
    'つまみを引きずると線の端が動く（指の位置からのずれを保つ）',
    Math.abs(moved2.y - (end2.y + sizeB.height * 0.03)) < 3 && Math.abs(moved2.x - end2.x) < 3,
    `${moved2.x.toFixed(1)}, ${moved2.y.toFixed(1)}`,
  );
  check(
    '右の端を下げると「右下がり」と出て、傾きは正',
    readout.tilt > 1 && readout.tilt < 5 && readout.text.includes('右下がり'),
    readout.text,
  );
  // 矢印キーで 1 画素ずつ動かせる
  await tid('level-handle-1').focus();
  const before1 = await level.end(1);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowLeft');
  const after1 = await level.end(1);
  check(
    '矢印キーで 1 画素、Shift を押しながらで 10 画素動く',
    Math.abs(after1.y - (before1.y - 1)) < 1e-6 && Math.abs(after1.x - (before1.x - 10)) < 1e-6,
    `${after1.x}, ${after1.y}`,
  );
  await page.screenshot({ path: join(outDir, `compare-${browserName}-level.png`) });
  readout = await level.readout();
  const tiltB = readout.tilt;
  await tid('level-submit').click();
  await tid('level-editor').waitFor({ state: 'detached' });
  await page.waitForFunction(
    () => document.querySelector('[data-testid=compare-level-current]') === null,
  );
  check(
    '決めると窓が閉じ、案内は「基準」だけになる',
    (await tid('compare-no-level').textContent()).includes('「基準」に水平の線がありません') &&
      (await tid('compare-level-base').count()) === 1,
    await tid('compare-no-level').textContent(),
  );
  diffs = await diffTable();
  summary.tiltB = tiltB;
  // 右利き：画面が時計回りに回って写っていた分、肩線・腰線・腕の角度は減り、体軸は増える
  const shift = (id) => diffs[id].current - round(id, rawB[id]);
  check(
    '今回の水平基準の角度が、カメラの傾きの分だけ補正される',
    Math.abs(shift('shoulderTilt') + tiltB) < 0.11 &&
      Math.abs(shift('armElevation') + tiltB) < 0.11 &&
      Math.abs(shift('trunkTilt') - tiltB) < 0.11,
    `傾き ${tiltB.toFixed(2)}、肩線 ${shift('shoulderTilt').toFixed(2)}、体軸 ${shift('trunkTilt').toFixed(2)}`,
  );
  check(
    '身体基準の角度と、基準の列は変わらない',
    Math.abs(shift('armShoulderAngle')) < 1e-9 &&
      ids.every((id) => sameNumber(diffs[id].base, rawA[id] === null ? null : round(id, rawA[id]))),
  );

  // ── H：ライブラリで開いた記録から線を引く（鉛直な線、使えない線）
  await openDetail(recordA);
  await tid('detail-level-open').click();
  await tid('level-editor').waitFor();
  const sizeA = sizeB; // どちらも同じ元動画からの切り出しで、同じ大きさ
  // 使えない線 1：傾きすぎ（約 20°）
  await level.dragTo(1, sizeA.width * 0.2, sizeA.height * 0.5);
  await level.dragTo(
    2,
    sizeA.width * 0.8,
    sizeA.height * 0.5 + sizeA.width * 0.6 * Math.tan(Math.PI / 9),
  );
  readout = await level.readout();
  check(
    '10° を超える傾きは案内が出て、決められない',
    (await tid('level-too-tilted').count()) === 1 && (await tid('level-submit').isDisabled()),
    readout.text,
  );
  // 使えない線 2：短すぎ
  await level.dragTo(2, sizeA.width * 0.3, sizeA.height * 0.5);
  check(
    '短すぎる線は案内が出て、決められない',
    (await tid('level-too-short').count()) === 1 && (await tid('level-submit').isDisabled()),
  );
  // 射手から離れた鉛直な線：決められるが、注意が出る
  await level.dragTo(1, sizeA.width * 0.1, sizeA.height * 0.15);
  await level.dragTo(2, sizeA.width * 0.1, sizeA.height * 0.85);
  check(
    '射手から離れた鉛直の線には注意が出る（決めることはできる）',
    (await tid('level-far').count()) === 1 && !(await tid('level-submit').isDisabled()),
  );
  // 鉛直な線：上の端が右へ倒れている（時計回り）→ カメラの傾きは正
  await level.dragTo(1, sizeA.width * 0.72, sizeA.height * 0.15);
  await level.dragTo(2, sizeA.width * 0.7, sizeA.height * 0.85);
  readout = await level.readout();
  const tiltA = readout.tilt;
  summary.tiltA = tiltA;
  check(
    '立った線は鉛直の線として扱い、鉛直からのずれを傾きとする',
    readout.kind === 'vertical' &&
      tiltA > 0.5 &&
      tiltA < 3 &&
      (await tid('level-editor').textContent()).includes('鉛直なもの'),
    readout.text,
  );
  check('射手の近くの鉛直の線には注意が出ない', (await tid('level-far').count()) === 0);
  const drawnA = [await level.end(1), await level.end(2)];
  await tid('level-submit').click();
  await tid('level-editor').waitFor({ state: 'detached' });
  await page.waitForFunction(
    () => document.querySelector('[data-testid=detail-level]')?.dataset.hasLevel === 'true',
  );
  check(
    '開いた記録に「水平の線：あり」と補正した傾きが出る',
    (await tid('detail-level').textContent()).includes('✓ 水平の線：あり') &&
      (await tid('detail-level').textContent()).includes(`${tiltA.toFixed(1)}° を補正`) &&
      (await tid('detail-level-open').textContent()) === '引き直す',
    await tid('detail-level').textContent(),
  );
  const leveledA = await detailTable();
  check(
    '角度表が補正した値になり、その注記が出る',
    Math.abs(leveledA.shoulderTilt - (rawA.shoulderTilt - tiltA)) < 1e-6 &&
      Math.abs(leveledA.trunkTilt - (rawA.trunkTilt + tiltA)) < 1e-6 &&
      (await tid('metric-note').textContent()).includes('を補正した値です'),
    `肩線 ${rawA.shoulderTilt.toFixed(2)} → ${leveledA.shoulderTilt.toFixed(2)}`,
  );
  check(
    '写真の上の骨格は回さない（写真と合ったまま）',
    (await skeleton('still-skeleton')).points.every((p, i) => dist(p, skeletonA.points[i]) < 1e-6),
  );
  await tid('detail-level-open').click();
  await tid('level-editor').waitFor();
  const reopened = [await level.end(1), await level.end(2)];
  check(
    '引き直すときは、保存した線が出る',
    reopened.every((p, i) => dist(p, drawnA[i]) < 1e-6) &&
      (await tid('level-remove').count()) === 1,
  );
  await level.dragTo(2, sizeA.width * 1.3, sizeA.height * 1.2);
  const outside = await level.end(2);
  check(
    '端を写真の外へ引きずっても、写真の中に留まる',
    Math.abs(outside.x - sizeA.width) < 1e-6 && Math.abs(outside.y - sizeA.height) < 1e-6,
    `${outside.x}, ${outside.y}`,
  );
  await tid('level-cancel').click();
  await tid('level-editor').waitFor({ state: 'detached' });
  check(
    '動かしてからキャンセルすると、保存した線は変わらない',
    (await tid('detail-level').textContent()).includes(`${tiltA.toFixed(1)}° を補正`),
  );

  // 線を消す（今回の記録 B で）
  await openDetail(recordB);
  check(
    '比較画面から引いた線が、開いた記録にも出る',
    (await tid('detail-level').getAttribute('data-has-level')) === 'true',
  );
  await tid('detail-level-open').click();
  await tid('level-remove').click();
  await tid('level-editor').waitFor({ state: 'detached' });
  await page.waitForFunction(
    () => document.querySelector('[data-testid=detail-level]')?.dataset.hasLevel === 'false',
  );
  const removedB = await detailTable();
  check(
    '「線を消す」で補正をやめ、角度が元に戻る',
    ids.every((id) => sameNumber(removedB[id], rawB[id])) &&
      (await tid('metric-note').count()) === 0,
  );

  // ── I：開いた記録の「基準と比べる」。基準は前回のまま
  await tid('detail-compare').click();
  await waitCompare();
  check(
    '「基準と比べる」で、その記録を今回として比較画面が開く（基準は前回のまま）',
    (await pairIds()).join(',') === `${recordA},${recordB}` &&
      (await tid('record-picker').count()) === 0,
  );
  check(
    '線を消した「今回」だけ、水平の線の案内が出る',
    (await tid('compare-no-level').textContent()).includes('「今回」に水平の線がありません') &&
      (await tid('compare-level-base').count()) === 0,
  );
  // もう一度引く（今度は右上がり）
  await tid('compare-level-current').click();
  await tid('level-editor').waitFor();
  const e2 = await level.end(2);
  await level.dragTo(2, e2.x, e2.y - sizeB.height * 0.02);
  readout = await level.readout();
  const tiltB2 = readout.tilt;
  check(
    '右の端を上げると「右上がり」と出て、傾きは負',
    tiltB2 < -0.5 && readout.text.includes('右上がり'),
    readout.text,
  );
  await tid('level-submit').click();
  await tid('level-editor').waitFor({ state: 'detached' });
  await page.waitForFunction(
    () => document.querySelector('[data-testid=compare-no-level]') === null,
  );
  check('両方に線があると、案内は出ない', true);
  diffs = await diffTable();
  check(
    '両方を補正した値どうしの差になる',
    Math.abs(diffs.shoulderTilt.base - round('shoulderTilt', rawA.shoulderTilt - tiltA)) < 1e-9 &&
      Math.abs(diffs.shoulderTilt.current - round('shoulderTilt', rawB.shoulderTilt - tiltB2)) <
        1e-9,
    `基準 ${diffs.shoulderTilt.base} / 今回 ${diffs.shoulderTilt.current}`,
  );
  // カメラの傾きの差の分だけ、基準の骨格を回して重ねる
  const current2 = await skeleton('still-skeleton');
  const base2 = await skeleton('still-skeleton-base');
  const angleOf = (points) =>
    (Math.atan2(points[3].y - points[4].y, points[3].x - points[4].x) * 180) / Math.PI;
  const turned = angleOf(base2.points) - angleOf(skeletonA.points);
  summary.overlayRotation = { turned, expected: tiltB2 - tiltA };
  check(
    '重ね描きの基準の骨格は、2 件のカメラの傾きの差の分だけ回る',
    Math.abs(turned - (tiltB2 - tiltA)) < 1e-6,
    `${turned.toFixed(3)}° / ${(tiltB2 - tiltA).toFixed(3)}°`,
  );
  check(
    '回しても、腰の中心と体幹の長さは揃ったまま',
    dist(anchorOf(base2.points).hip, anchorOf(current2.points).hip) < 0.01 &&
      Math.abs(anchorOf(base2.points).trunk / anchorOf(current2.points).trunk - 1) < 1e-6,
  );

  // ── J：表示の切替
  await tid('align-raw').click();
  const baseRaw = await skeleton('still-skeleton-base');
  check(
    '撮ったまま：基準の骨格は、基準の画面の中の位置のまま',
    (await tid('compare-overlay').getAttribute('data-align')) === 'raw' &&
      baseRaw.points.every((p, i) => dist(p, skeletonA.points[i]) < 1e-6),
  );
  check(
    '同じカメラ位置の 2 件では、カメラの位置の案内は出ない',
    (await tid('compare-camera-moved').count()) === 0,
  );
  await tid('toggle-side').click();
  await tid('compare-side').waitFor();
  const sideBase = await skeleton('still-skeleton', 'still-base');
  const sideCurrent = await skeleton('still-skeleton', 'still-current');
  check(
    '横に並べる：それぞれの写真に、それぞれの骨格（基準は点線）',
    sideBase?.lines === 20 &&
      sideBase.dashed === 10 &&
      sideCurrent?.lines === 20 &&
      sideCurrent.dashed === 0 &&
      sideBase.points.every((p, i) => dist(p, skeletonA.points[i]) < 1e-6),
  );
  const sideBoxes = await page.evaluate(() =>
    ['still-base', 'still-current'].map((id) => {
      const svg = document.querySelector(`[data-testid=${id}-svg]`);
      const r = svg.getBoundingClientRect();
      const [, , w, h] = svg.getAttribute('viewBox').split(' ').map(Number);
      return {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        viewWidth: w,
        viewHeight: h,
      };
    }),
  );
  // 画面上の体幹の長さ（px）＝ 体幹の長さ（画素）× 画面上の幅 ÷ 表示範囲の幅
  const onScreen = (points, box) => (anchorOf(points).trunk * box.width) / box.viewWidth;
  summary.sideTrunkPx = [
    onScreen(sideBase.points, sideBoxes[0]),
    onScreen(sideCurrent.points, sideBoxes[1]),
  ];
  check(
    '横に並べる：2 枚が横に並び、人物が同じ大きさに見える',
    Math.abs(sideBoxes[0].top - sideBoxes[1].top) < 1 &&
      sideBoxes[0].left + sideBoxes[0].width <= sideBoxes[1].left &&
      Math.abs(summary.sideTrunkPx[0] / summary.sideTrunkPx[1] - 1) < 0.01,
    summary.sideTrunkPx.map((v) => v.toFixed(1)).join(' / '),
  );
  check('横に並べている間は、揃え方の切替を出さない', (await tid('align-raw').count()) === 0);
  await page.screenshot({ path: join(outDir, `compare-${browserName}-side.png`), fullPage: true });
  await waitStageVideos();
  check(
    '横に並べても、それぞれの動画が出る',
    (await stageVideo('base')).width > 0 && (await stageVideo('current')).width > 0,
  );
  await tid('toggle-side').click();
  await tid('align-normalized').click();

  // ── K：記録の選び直し
  await tid('pick-current').click();
  await waitPicker();
  pickerIds = await tid('picker-item').evaluateAll((els) => els.map((e) => e.dataset.recordId));
  check(
    '今回の候補は、基準に選んだ記録を除くすべて',
    pickerIds.join(',') === String(recordB) && (await page.locator('.picker-check').count()) === 1,
    pickerIds.join(','),
  );
  await tid('picker-cancel').click();
  await tid('record-picker').waitFor({ state: 'detached' });
  check(
    'キャンセルすると、選んでいた 2 件のまま',
    (await pairIds()).join(',') === `${recordA},${recordB}`,
  );

  // ── L：利き手が違う 2 人
  await tid('tab-load').click();
  await tid('shooter-select').selectOption('add');
  await registerShooter('佐藤', 'left');
  await tid('shooter-select').selectOption({ label: '山田（右利き）' });
  await openDetail(recordB);
  await tid('detail-edit').click();
  await tid('record-form').waitFor();
  await page.locator('[data-testid=form-shooter]', { hasText: '佐藤' }).click();
  await tid('form-submit').click();
  await tid('record-form').waitFor({ state: 'detached' });
  await tid('tab-compare').click();
  await waitCompare();
  check(
    '利き手が違う 2 件を選ぶと、左右反転して重ねている旨の案内が出る',
    (await tid('compare-handedness').textContent()).includes('利き手が違う 2 人です'),
  );
  const mirroredBase = await skeleton('still-skeleton-base');
  const currentL = await skeleton('still-skeleton');
  // 基準（右利き）の右手首（銃側）は、反転すると、今回の骨格の腰より右側（今回の銃側＝左手首の側）へ来る
  const hipX = anchorOf(currentL.points).hip.x;
  check(
    '基準の骨格が左右反転して重なる（銃を持つ腕が同じ側に来る）',
    Math.sign(mirroredBase.points[8].x - hipX) ===
      -Math.sign(skeletonA.points[8].x - anchorOf(skeletonA.points).hip.x) &&
      dist(anchorOf(mirroredBase.points).hip, anchorOf(currentL.points).hip) < 0.01,
  );
  diffs = await diffTable();
  check(
    '左利きにした今回の角度は、銃側を＋として符号が逆になる',
    Math.abs(diffs.shoulderTilt.current + round('shoulderTilt', rawB.shoulderTilt - tiltB2)) < 0.11,
    diffs.shoulderTilt.current,
  );
  await tid('pick-base').click();
  await waitPicker();
  check(
    '射手が 2 人以上いると、選ぶ窓に射手の絞り込みが出る（相手の記録の射手が選択済み）',
    (await tid('picker-shooter').evaluate((el) => el.options[el.selectedIndex].textContent)) ===
      '佐藤（0）' && (await tid('picker-no-match').count()) === 1,
    await tid('picker-shooter').evaluate((el) => el.options[el.selectedIndex].textContent),
  );
  await tid('picker-shooter').selectOption({ index: 0 });
  check('絞り込みを外すと、基準の候補が出る', (await tid('picker-item').count()) === 1);
  await tid('picker-cancel').click();

  // ── M：人物のいない・縦横比の違う記録
  console.log('  姿勢推定を実行中（3 本目：人物のいない縦長の絵）…');
  const recordC = await analyzeAndSave(videoNoPerson, 0.5, { shotAt: '2026-10-01T09:00' });
  await tid('save-compare').click();
  await tid('compare-overlay').waitFor();
  check(
    '保存直後の「基準と比べる」は、基準が決まっていればすぐ比較を出す',
    (await pairIds()).join(',') === `${recordA},${recordC}` &&
      (await tid('record-picker').count()) === 0,
    (await pairIds()).join(','),
  );
  check(
    '人物を検出できず縦横比も違う 2 件は、重ねずに理由を出す（切替も出さない）',
    (await tid('compare-cannot-overlay').count()) === 1 &&
      (await tid('align-normalized').count()) === 0 &&
      (await skeleton('still-skeleton-base')) === null,
  );
  check(
    '計測できないときは、差分表の代わりに理由が出る',
    (await tid('diff-table').count()) === 0 &&
      (await tid('compare').textContent()).includes('人物を検出できなかった'),
  );

  // ── N：開き直しても、選んだ 2 件と水平の線が残る
  await page.reload();
  await tid('tab-compare').click();
  await tid('compare-overlay').waitFor();
  check(
    '開き直しても、前回比べた 2 件が出る',
    (await pairIds()).join(',') === `${recordA},${recordC}`,
    (await pairIds()).join(','),
  );
  await openDetail(recordA);
  const reloadedA = await detailTable();
  check(
    '開き直しても、水平の線と補正した角度が残る',
    (await tid('detail-level').getAttribute('data-has-level')) === 'true' &&
      ids.every((id) => sameNumber(reloadedA[id], leveledA[id])),
  );

  // ── O：比べていた記録を削除すると、選び直しになる
  await openDetail(recordC);
  await tid('detail-remove').click();
  await tid('confirm-ok').click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid=lib-item]').length === 2,
  );
  check(
    '記録を削除すると、動画本体も消える',
    (await videoRows()).join(',') === `${recordA},${recordB}`,
    (await videoRows()).join(','),
  );
  check(
    'ライブラリに、端末で使っている保存容量が出る',
    /約 \d+ MB/.test(
      (await tid('library-usage')
        .textContent()
        .catch(() => '')) ?? '',
    ),
    await tid('library-usage')
      .textContent()
      .catch(() => '（表示なし）'),
  );
  await tid('tab-compare').click();
  await tid('compare-choose-rest').waitFor();
  check(
    '今回の記録を削除すると、基準は残り、今回は未選択になる',
    (await pairIds()).join(',') === `${recordA},` &&
      (await tid('compare-choose-rest').textContent()) === '今回の記録を選ぶ' &&
      (await tid('pair-current').textContent()).includes('未選択'),
    (await pairIds()).join(','),
  );
  await tid('tab-library').click();
  await tid('tab-compare').click();
  await tid('compare-choose-rest').waitFor();
  check(
    '比較タブを開き直しても、選ぶ窓は勝手に開かない（「基準と比べる」で来たときだけ）',
    (await tid('record-picker').count()) === 0,
  );
  await tid('compare-choose-rest').click();
  await waitPicker();
  await tid('picker-shooter').selectOption({ index: 0 });
  await tid('picker-favorite').click();
  check(
    '今回を選ぶ窓は「お気に入りのみ」で絞り込める',
    (await tid('picker-no-match').count()) === 1,
  );
  await tid('picker-favorite').click();
  await tid('picker-pick').first().click();
  await waitCompare();
  check('選び直すと比較に戻る', (await pairIds()).join(',') === `${recordA},${recordB}`);
  // ── P：幅 320px でも比較画面が横にはみ出さない
  let over = await overflowing();
  check('幅 393px で比較画面が横にはみ出さない', over.length === 0, over.join(' '));
  await page.setViewportSize({ width: 320, height: 700 });
  over = await overflowing();
  check('幅 320px でも比較画面が横にはみ出さない', over.length === 0, over.join(' '));
  await page.setViewportSize(VIEWPORT);

  // 基準を削除すると、今回は残り、基準は未選択になる
  await openDetail(recordA);
  await tid('detail-remove').click();
  await tid('confirm-ok').click();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid=lib-item]').length === 1,
  );
  await tid('tab-compare').click();
  await tid('compare-choose-rest').waitFor();
  check(
    '基準の記録を削除すると、今回は残り、基準は未選択になる',
    (await pairIds()).join(',') === `,${recordB}` &&
      (await tid('compare-choose-rest').textContent()) === '基準を選ぶ' &&
      (await tid('record-picker').count()) === 0,
    (await pairIds()).join(','),
  );
  await tid('compare-choose-rest').click();
  await waitPicker();
  check(
    'お気に入りの記録が無くなると、基準を選ぶ窓に案内が出る',
    (await tid('picker-empty').count()) === 1,
  );
  await tid('picker-cancel').click();
  await tid('record-picker').waitFor({ state: 'detached' });

  // ── Q：段階③までに保存した記録（保存形式の版 1）が、消えずに開ける
  // 別の空のブラウザ（保存データが別）で、アプリを開く前に、版 1 の形のデータベースを直接作る
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
    // まっすぐ立った右利き射手。銃側の肩（画面左）が 10px 上 → 肩線の傾き atan(10/100) ≒ 5.71°
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
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid=lib-item]').length === 1,
  );
  check('版 1 で保存した記録が、一覧に残っている', true);
  await tid('lib-open').click();
  await tid('detail-table').waitFor();
  const old = await detailTable();
  check(
    '版 1 の記録を開け、角度が出て、水平の線は「なし」',
    Math.abs(old.shoulderTilt - 5.71) < 0.01 &&
      (await tid('detail-level').getAttribute('data-has-level')) === 'false' &&
      (await tid('detail-date').textContent()) === '9/20（日）10:00',
    old.shoulderTilt,
  );
  await tid('detail-video').waitFor();
  check(
    '版 1 の記録は「動画：なし」と出て、動画を付けるボタンがある',
    (await tid('detail-video').getAttribute('data-has-video')) === 'false' &&
      (await tid('detail-attach').count()) === 1,
  );
  await tid('detail-level-open').click();
  await tid('level-editor').waitFor();
  const oldEnd = await level.end(2);
  await level.dragTo(2, oldEnd.x, oldEnd.y + 12);
  const oldTilt = (await level.readout()).tilt;
  await tid('level-submit').click();
  await tid('level-editor').waitFor({ state: 'detached' });
  await page.waitForFunction(
    () => document.querySelector('[data-testid=detail-level]')?.dataset.hasLevel === 'true',
  );
  const oldLeveled = await detailTable();
  check(
    '版 1 だった記録にも水平の線を引いて保存できる',
    Math.abs(oldLeveled.shoulderTilt - (old.shoulderTilt - oldTilt)) < 1e-6,
    `${old.shoulderTilt.toFixed(2)} → ${oldLeveled.shoulderTilt.toFixed(2)}`,
  );
  await page.reload();
  await tid('tab-library').click();
  await tid('lib-open').click();
  await tid('detail-table').waitFor();
  check(
    '開き直しても残っている',
    (await tid('detail-level').getAttribute('data-has-level')) === 'true',
  );
} catch (e) {
  fatal = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const state = await page
    .evaluate(async () => {
      const raf = await new Promise((resolve) => {
        let n = 0;
        const tick = () => {
          n++;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        setTimeout(() => resolve(n), 1000);
      });
      return `raf=${raf}/s focus=${document.hasFocus()} visibility=${document.visibilityState}`;
    })
    .catch(() => 'unknown');
  fatal += ` / ${state}`;
  await page
    .screenshot({ path: join(outDir, `compare-${browserName}-error.png`), fullPage: true })
    .catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
const outFile = join(outDir, `compare-${browserName}.json`);
writeFileSync(
  outFile,
  JSON.stringify({ browser: browserName, base, fatal, summary, checks, logs }, null, 2),
);
await browser.close();

console.log(`saved ${outFile}`);
if (fatal) console.log(`FATAL: ${fatal}`);
// テスト用ウィンドウが他のウィンドウに隠れると、ブラウザが描画の更新を止めてテストが進まなくなる。
// アプリの不具合ではないので、区別できるよう終了コードを変える（2 なら再実行する）
const hiddenWindow = Number(/raf=(\d+)\/s/.exec(fatal ?? '')?.[1] ?? 60) < 10;
if (hiddenWindow) console.log('テスト用ウィンドウが隠れて描画が止まりました。再実行してください。');
if (logs.length) console.log(`console: ${logs.length} 件（結果ファイル参照）`);
console.log(`${checks.length - failed.length} / ${checks.length} 合格`);
process.exit(hiddenWindow ? 2 : fatal || failed.length ? 1 : 0);
