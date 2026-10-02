// 段階③（射手の登録・保存・ライブラリ）の自動テスト。実際の画面をブラウザで操作して確かめる。
// 開発サーバ（npm run dev）を起動した状態で使う。
//   node apps/web/e2e/librarytest.mjs webkit   … Safari と同じ描画エンジン
//   node apps/web/e2e/librarytest.mjs chromium … Chrome と同じ描画エンジン
// 動画は apps/web/e2e/videos/motion.mp4（腕を上げる動きのある切り出し）と static0.mp4（据銃区間）。
// 作り方は marktest.mjs の冒頭。
// 毎回、保存データが空のブラウザで始める（テストで作った記録は、終了時にブラウザごと消える）。
// 結果は apps/web/e2e/results/library-<ブラウザ名>.json / .png に保存する（git 管理外）。

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const [browserName = 'webkit'] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:5173';
const videoPath = process.env.VIDEO ?? join(here, 'videos', 'motion.mp4');
const secondVideoPath = join(here, 'videos', 'static0.mp4');
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
// iPhone に近い幅と高さで確かめる
const page = await browser.newPage({ viewport: { width: 393, height: 760 } });
// 角度の数値は既定では隠れている。このテストは数値を読むので、最初から「表示」にしておく
await page.addInitScript(() => window.localStorage.setItem('kamae.showNumbers', '1'));
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const tid = (id) => page.locator(`[data-testid=${id}]`);
const frameIndex = async () => Number(await tid('frame-label').getAttribute('data-frame-index'));
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
/** 角度表を読む（マーク画面は shot-table、開いた記録は detail-table） */
const table = async (id) => {
  if ((await tid(id).count()) === 0) return null;
  const frame = Number(await tid(id).getAttribute('data-frame-index'));
  const rows = await tid(id)
    .locator('tr[data-metric]')
    .evaluateAll((trs) =>
      trs.map((tr) => ({
        id: tr.dataset.metric,
        value: tr.dataset.value === '' ? null : Number(tr.dataset.value),
        text: tr.children[1].textContent,
      })),
    );
  return { frame, rows };
};
const valueOf = (t, id) => t?.rows.find((r) => r.id === id)?.value ?? null;
const sameValues = (a, b) =>
  a && b && a.rows.length === b.rows.length && a.rows.every((r, i) => r.value === b.rows[i].value);

/**
 * 絵の指紋：16×16 画素に縮めた明るさの並び。どのフレームの絵かを見分けるのに使う。
 * 動画と画像では縮め方（画素の拾い方）がブラウザ内部で違うため、いったん 256×256 の canvas に
 * 写してから、同じ手順で 16×16 に縮める。
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
/** いま動画に出ている絵の指紋 */
const videoSignature = () =>
  page.evaluate(`(() => {
    const v = document.querySelector('.video-box video');
    return (${SIGNATURE})(v, v.videoWidth, v.videoHeight);
  })()`);
/** 開いた記録の静止画（保存した画像そのもの）の指紋と大きさ */
const stillSignature = () =>
  page.evaluate(`(async () => {
    const href = document.querySelector('[data-testid=still-image]')?.getAttribute('href');
    if (!href) return null;
    const img = new Image();
    img.src = href;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight,
      sig: (${SIGNATURE})(img, img.naturalWidth, img.naturalHeight) };
  })()`);
const distance = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;

const items = () =>
  tid('lib-item').evaluateAll((lis) =>
    lis.map((li) => ({
      id: Number(li.dataset.recordId),
      favorite: li.dataset.favorite === 'true',
      date: li.querySelector('[data-testid=lib-date]')?.textContent ?? '',
      sub: li.querySelector('[data-testid=lib-sub]')?.textContent ?? '',
      score: li.querySelector('.score')?.textContent ?? '',
      thumbWidth: li.querySelector('img.thumb')?.naturalWidth ?? 0,
      thumbHeight: li.querySelector('img.thumb')?.naturalHeight ?? 0,
    })),
  );
const waitItems = (n) =>
  page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid=lib-item]').length === count,
    n,
    { timeout: 10_000 },
  );
/** 一覧の小さい静止画が読み込まれるまで待つ */
const waitThumbs = () =>
  page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid=lib-item]')].every(
        (li) => (li.querySelector('img.thumb')?.naturalWidth ?? 0) > 0,
      ),
    null,
    { timeout: 10_000 },
  );
const registerShooter = async (name, hand) => {
  await tid('shooter-name').fill(name);
  await tid(`shooter-${hand}`).click();
  await tid('shooter-submit').click();
  await tid('shooter-dialog').waitFor({ state: 'detached' });
};
const analyze = async () => {
  await tid('run-analysis').click({ timeout: 60_000 });
  await tid('analysis-done').waitFor({ timeout: 15 * 60_000 });
};
const openDetail = async (recordId) => {
  await page
    .locator(`[data-testid=lib-item][data-record-id="${recordId}"] [data-testid=lib-open]`)
    .click();
  await tid('detail-table').waitFor();
};

let fatal = null;
const summary = {};
try {
  console.log(`open ${base} (${browserName})`);
  await page.goto(base);

  // ── A：射手の登録（利き手は射手ごとに 1 回だけ決める）
  await tid('video-file').setInputFiles(videoPath);
  // 動画の情報（例：1280×720、4.0 秒）が出るまで待つ
  await page.waitForFunction(() => /\d+×\d+、/.test(document.body.textContent ?? ''), null, {
    timeout: 60_000,
  });
  await tid('shooter-register').waitFor();
  check('射手を登録するまで姿勢推定を実行できない', await tid('run-analysis').isDisabled());
  await tid('shooter-register').click();
  check('名前が空のうちは登録できない', await tid('shooter-submit').isDisabled());
  await registerShooter('山田', 'right');
  await tid('shooter-select').waitFor();
  const selectedLabel = () =>
    tid('shooter-select').evaluate((el) => el.options[el.selectedIndex].textContent);
  check(
    '登録した射手が選ばれる',
    (await selectedLabel()) === '山田（右利き）',
    await selectedLabel(),
  );
  check('射手を登録すると実行できる', !(await tid('run-analysis').isDisabled()));

  await tid('shooter-select').selectOption('add');
  await tid('shooter-name').fill(' 山田 ');
  check(
    '同じ名前の射手は登録できず、案内が出る',
    (await tid('shooter-submit').isDisabled()) && (await tid('shooter-duplicate').count()) === 1,
  );
  await registerShooter('佐藤', 'left');
  check(
    '2 人目（左利き）を登録できる',
    (await selectedLabel()) === '佐藤（左利き）',
    await selectedLabel(),
  );
  await tid('shooter-select').selectOption({ label: '山田（右利き）' });

  // ── B：姿勢推定
  console.log('  姿勢推定を実行中…');
  await analyze();
  check(
    '完了後は実行ボタンを出さない（同じ動画のやり直しは Safari で止まるため、選び直してもらう）',
    (await tid('run-analysis').count()) === 0,
  );
  await tid('go-mark').click();
  await tid('frame-slider').waitFor();
  const total = Number(await tid('frame-slider').getAttribute('max')) + 1;
  summary.totalFrames = total;
  check(
    '「マーク付けへ進む」でマーク画面に移る',
    await page.locator('.video-box video').isVisible(),
  );

  // ── C：保存
  check(
    '撃発マークが無いうちは保存できず、理由が出る',
    (await tid('save-open').isDisabled()) && (await tid('save-need-shot').count()) === 1,
  );
  check('マークが無いうちは未保存の印が出ない', (await tid('unsaved-dot').count()) === 0);
  const f1 = Math.floor(total / 4);
  const f2 = Math.floor((total * 3) / 4);
  await slideTo(f1);
  const sigF1 = await videoSignature();
  await tid('mark-shot').click();
  check('撃発マークを付けると保存ボタンが押せる', !(await tid('save-open').isDisabled()));
  check('未保存の印が「マーク」タブに出る', (await tid('unsaved-dot').count()) === 1);
  check(
    '撃発ボタンと保存ボタンが、スクロールせずに 1 画面に入る',
    await page.evaluate(() => {
      window.scrollTo(
        0,
        document.querySelector('.video-box').getBoundingClientRect().top + scrollY,
      );
      const r = document.querySelector('[data-testid=save-open]').getBoundingClientRect();
      return r.bottom <= window.innerHeight;
    }),
  );
  await slideTo(f2);
  const sigF2 = await videoSignature();
  summary.pictureDistanceF1F2 = distance(sigF1, sigF2);
  check(
    '2 つのフレームの絵が違う（動きのある動画）',
    summary.pictureDistanceF1F2 > 1,
    summary.pictureDistanceF1F2.toFixed(2),
  );

  // 別のフレームを表示したまま保存しても、静止画は撃発フレームのものになる
  await tid('save-open').click();
  await tid('record-form').waitFor();
  const chips = () =>
    tid('form-shooter').evaluateAll((bs) =>
      bs.map((b) => `${b.textContent}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`),
    );
  check(
    '読込画面で選んだ射手が選択済み',
    (await chips()).join(' ') === '山田（右）* 佐藤（左）',
    (await chips()).join(' '),
  );
  const mtime = statSync(videoPath).mtime;
  const pad = (n) => String(n).padStart(2, '0');
  const expectedShotAt = `${mtime.getFullYear()}-${pad(mtime.getMonth() + 1)}-${pad(mtime.getDate())}T${pad(mtime.getHours())}:${pad(mtime.getMinutes())}`;
  check(
    '撮影日時の初期値は動画ファイルの日時',
    (await tid('form-shot-at').inputValue()) === expectedShotAt,
    `${await tid('form-shot-at').inputValue()} / ${expectedShotAt}`,
  );
  check('何も入力しなくても保存できる状態', !(await tid('form-submit').isDisabled()));
  for (const [text, label] of [
    ['105', '範囲外（105）'],
    ['11', '範囲外（11）'],
    ['abc', '数字でない'],
    ['10.35', '小数 2 桁'],
  ]) {
    await tid('form-score').fill(text);
    check(
      `点数が${label}だと保存できず、案内が出る`,
      (await tid('form-submit').isDisabled()) && (await tid('form-score-error').count()) === 1,
    );
  }
  await tid('form-score').fill('10,3');
  check('「10,3」は 10.3 として受け付ける', !(await tid('form-submit').isDisabled()));
  await tid('form-favorite').click();
  await tid('form-shot-at').fill('2026-09-30T14:05');
  await tid('form-memo-toggle').click();
  await tid('form-memo').fill('引き金が軽く切れた');
  await tid('form-submit').click();
  await tid('save-done').waitFor({ timeout: 20_000 });
  check('保存すると入力の窓が閉じる', (await tid('record-form').count()) === 0);
  const summaryText = await tid('save-summary').textContent();
  check('保存した内容が帯に出る', summaryText === '9/30（水）14:05・山田・10.3 点', summaryText);
  check('保存すると未保存の印が消える', (await tid('unsaved-dot').count()) === 0);
  await waitFrame(f1).catch(() => {});
  check(
    '保存後、動画は撃発フレームを表示している',
    (await frameIndex()) === f1,
    await frameIndex(),
  );
  const recordA = Number(await tid('save-block').getAttribute('data-saved-id'));

  // ── D：保存後にマークを変えると上書き保存になる（件数は増えない）
  await slideTo(f2);
  await tid('mark-shot').click();
  check(
    '保存後に撃発を付け直すと「上書き保存」になる',
    (await tid('save-overwrite').count()) === 1 && (await tid('unsaved-dot').count()) === 1,
  );
  await slideTo(f1);
  await tid('save-overwrite').click();
  await tid('save-done').waitFor({ timeout: 20_000 });
  const tableA = await table('shot-table');
  check('上書き後の角度表は付け直した撃発フレーム', tableA?.frame === f2, tableA?.frame);
  check(
    '上書きしても同じ記録のまま',
    Number(await tid('save-block').getAttribute('data-saved-id')) === recordA,
  );

  // ── E：ライブラリで開く
  await tid('save-view').click();
  await waitItems(1);
  await waitThumbs();
  let list = await items();
  check('ライブラリに 1 件だけある（上書きで増えていない）', list.length === 1, list.length);
  check('ライブラリでは動画が隠れる', !(await page.locator('.video-box video').isVisible()));
  check(
    '一覧に日時・点数・射手名・メモ・お気に入りが出る',
    list[0].date === '9/30（水）14:05' &&
      list[0].score === '10.3点' &&
      list[0].sub === '山田・引き金が軽く切れた' &&
      list[0].favorite,
    JSON.stringify(list[0]),
  );
  check(
    '一覧の静止画が表示され、縦長（3:4）に切り抜かれている',
    list[0].thumbWidth === 180 && list[0].thumbHeight === 240,
    `${list[0].thumbWidth}×${list[0].thumbHeight}`,
  );
  check(
    '月の見出しが出る',
    (await tid('lib-month').allTextContents()).join('|') === '2026年9月（1 件）',
  );

  await openDetail(recordA);
  check('開いた記録に日時が出る', (await tid('detail-date').textContent()) === '9/30（水）14:05');
  check('射手名と利き手が出る', (await tid('detail-shooter').textContent()) === '山田・右利き');
  check('メモが出る', (await tid('detail-memo').textContent()) === 'メモ：引き金が軽く切れた');
  const detailA = await table('detail-table');
  check('角度表は 9 項目', detailA?.rows.length === 9, detailA?.rows.length);
  check(
    '角度がマーク画面の表と同じ',
    sameValues(detailA, tableA),
    `${valueOf(detailA, 'shoulderTilt')} / ${valueOf(tableA, 'shoulderTilt')}`,
  );
  check(
    '値のある行は単位付き、値のない行は「—」',
    detailA?.rows.every((r) =>
      r.value === null ? r.text === '—' : /^[+−]\d+\.\d°$|^-?\d+\.\d{2}$/.test(r.text),
    ),
    detailA?.rows.map((r) => r.text).join(' '),
  );
  const still = await stillSignature();
  summary.still = still && { width: still.width, height: still.height };
  check(
    '静止画が表示される',
    still !== null && still.width > 0,
    `${still?.width}×${still?.height}`,
  );
  if (still) {
    const toF2 = distance(still.sig, sigF2);
    const toF1 = distance(still.sig, sigF1);
    summary.stillDistance = { toF1, toF2 };
    // 保存の操作をしたとき動画は f1 を表示していたが、静止画は撃発フレーム（f2）の絵でなければならない
    check(
      '静止画は撃発フレームの絵（表示中だった別のフレームではない）',
      toF2 < 3 && toF2 < toF1,
      `撃発フレームとの差 ${toF2.toFixed(2)}、別フレームとの差 ${toF1.toFixed(2)}`,
    );
  }
  const skeleton = await tid('still-skeleton').evaluate((g) => ({
    lines: g.querySelectorAll('line').length,
    circles: g.querySelectorAll('circle').length,
  }));
  check(
    '静止画に骨格が重なっている',
    skeleton.lines === 20 && skeleton.circles === 11,
    JSON.stringify(skeleton),
  );
  const viewBox = () => tid('still').getAttribute('viewBox');
  const personView = (await viewBox()).split(' ').map(Number);
  await tid('fit-whole').click();
  const wholeView = (await viewBox()).split(' ').map(Number);
  check(
    '「人物に寄せる」は「全体」より狭い範囲を表示する',
    wholeView[0] === 0 && wholeView[1] === 0 && personView[2] < wholeView[2],
    `${personView.join(',')} / ${wholeView.join(',')}`,
  );
  await page.screenshot({
    path: join(outDir, `library-${browserName}-detail.png`),
    fullPage: true,
  });
  await tid('fit-person').click();

  await tid('detail-back').click();
  await waitItems(1);
  check('「‹ ライブラリ」で一覧へ戻る', (await tid('record-detail').count()) === 0);
  await openDetail(recordA);
  await page.evaluate(() => window.history.back());
  await waitItems(1);
  check('ブラウザの「戻る」でも一覧へ戻る', (await tid('record-detail').count()) === 0);

  // ── F：保存していないマークがあるときは、動画を選び直す前に確認する
  await tid('tab-mark').click();
  await tid('custom-label').fill('振り上げ開始');
  await tid('add-custom').click();
  check('保存後に任意マークを足すと未保存の印が出る', (await tid('unsaved-dot').count()) === 1);
  await tid('tab-load').click();
  await tid('video-file').click();
  await tid('discard-dialog').waitFor();
  await tid('confirm-cancel').click();
  await tid('tab-mark').click();
  check(
    '確認でキャンセルするとマークが残る',
    (await tid('mark-item').count()) === 2 && (await tid('save-overwrite').count()) === 1,
  );
  await tid('tab-load').click();
  await tid('video-file').click();
  await tid('discard-dialog').waitFor();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    tid('confirm-ok').click(),
  ]);
  // 別の動画（据銃区間の切り出し）を選ぶ
  await chooser.setFiles(secondVideoPath);
  await page.waitForFunction(() => !document.querySelector('[data-testid=unsaved-dot]'), null, {
    timeout: 10_000,
  });
  check('「保存せずに進む」で動画を選び直せ、マークが消える', true);
  await page.waitForFunction(
    () => document.querySelector('[data-testid=run-analysis]')?.disabled === false,
    null,
    { timeout: 60_000 },
  );

  // 2 件目：佐藤（左利き）、点数なし、別の月
  await tid('shooter-select').selectOption({ label: '佐藤（左利き）' });
  console.log('  姿勢推定を実行中（2 回目）…');
  await analyze();
  await tid('go-mark').click();
  await tid('frame-slider').waitFor();
  const total2 = Number(await tid('frame-slider').getAttribute('max')) + 1;
  await slideTo(Math.floor(total2 / 2));
  await tid('mark-shot').click();
  const tableLeft = await table('shot-table');
  // 読込画面で射手を替えると、マーク画面の角度表もその射手の利き手で出る
  await tid('tab-load').click();
  await tid('shooter-select').selectOption({ label: '山田（右利き）' });
  await tid('tab-mark').click();
  const tableRight = await table('shot-table');
  check(
    '射手を替えると利き手が替わり、同じフレームの角度の符号が逆になる',
    valueOf(tableRight, 'shoulderTilt') !== null &&
      Math.abs(valueOf(tableLeft, 'shoulderTilt') + valueOf(tableRight, 'shoulderTilt')) < 1e-6,
    `左 ${valueOf(tableLeft, 'shoulderTilt')} / 右 ${valueOf(tableRight, 'shoulderTilt')}`,
  );
  await tid('tab-load').click();
  await tid('shooter-select').selectOption({ label: '佐藤（左利き）' });
  await tid('tab-mark').click();
  await tid('save-open').click();
  check(
    '保存の入力でも佐藤が選択済み',
    (await chips()).join(' ') === '山田（右） 佐藤（左）*',
    (await chips()).join(' '),
  );
  await tid('form-shot-at').fill('2026-08-29T15:40');
  await tid('form-submit').click();
  await tid('save-done').waitFor({ timeout: 20_000 });
  check(
    '点数なしでも保存でき、帯に出る',
    (await tid('save-summary').textContent()) === '8/29（土）15:40・佐藤',
    await tid('save-summary').textContent(),
  );
  const recordB = Number(await tid('save-block').getAttribute('data-saved-id'));

  // ── G：一覧の並び・絞り込み・お気に入り
  await tid('save-view').click();
  await waitItems(2);
  await waitThumbs();
  list = await items();
  check(
    '撮影日時の新しい順に並ぶ',
    list.map((r) => r.id).join(',') === `${recordA},${recordB}`,
    list.map((r) => r.date).join(' / '),
  );
  check('点数が空欄の記録は「—」', list[1].score === '—', list[1].score);
  check(
    '月ごとに見出しが付く',
    (await tid('lib-month').allTextContents()).join('|') === '2026年9月（1 件）|2026年8月（1 件）',
    (await tid('lib-month').allTextContents()).join('|'),
  );
  check('件数が出る', (await tid('library-count').textContent()) === '2 件');
  await tid('filter-shooter').selectOption({ label: '佐藤（1）' });
  list = await items();
  check(
    '射手で絞り込める',
    list.length === 1 &&
      list[0].id === recordB &&
      (await tid('library-count').textContent()) === '2 件中 1 件',
    await tid('library-count').textContent(),
  );
  await tid('filter-favorite').click();
  check(
    '条件に合う記録が無いと案内が出る',
    (await tid('lib-item').count()) === 0 && (await tid('library-no-match').count()) === 1,
  );
  await tid('filter-clear').click();
  check('絞り込みを解除すると全件に戻る', (await tid('lib-item').count()) === 2);
  await tid('filter-favorite').click();
  list = await items();
  check('お気に入りだけに絞り込める', list.length === 1 && list[0].id === recordA);
  await tid('filter-favorite').click();
  await page
    .locator(`[data-testid=lib-item][data-record-id="${recordB}"] [data-testid=lib-favorite]`)
    .click();
  await page.waitForFunction(
    (id) =>
      document.querySelector(`[data-testid=lib-item][data-record-id="${id}"]`)?.dataset.favorite ===
      'true',
    recordB,
  );
  await tid('filter-favorite').click();
  check('一覧の ★ でお気に入りを切り替えられる（複数可）', (await tid('lib-item').count()) === 2);
  await tid('filter-favorite').click();
  await page.screenshot({ path: join(outDir, `library-${browserName}.png`), fullPage: true });

  // ── H：編集。射手を替えると利き手も替わり、角度を計算し直す
  await openDetail(recordA);
  await tid('detail-edit').click();
  await tid('record-form').waitFor();
  check(
    '編集の窓に今の内容が入っている',
    (await tid('form-score').inputValue()) === '10.3' &&
      (await tid('form-memo').inputValue()) === '引き金が軽く切れた',
  );
  await page.locator('[data-testid=form-shooter]', { hasText: '佐藤' }).click();
  await tid('form-score').fill('9.8');
  await tid('form-shot-at').fill('2026-09-30T16:20');
  await tid('form-memo').fill('');
  await tid('form-submit').click();
  await tid('record-form').waitFor({ state: 'detached' });
  await page.waitForFunction(
    () => document.querySelector('[data-testid=detail-shooter]')?.textContent === '佐藤・左利き',
  );
  const detailLeft = await table('detail-table');
  check(
    '射手を替えると利き手が替わり、角度の符号が逆になる',
    Math.abs(valueOf(detailLeft, 'shoulderTilt') + valueOf(detailA, 'shoulderTilt')) < 0.5,
    `${valueOf(detailLeft, 'shoulderTilt')} / ${valueOf(detailA, 'shoulderTilt')}`,
  );
  check(
    '点数・日時・メモの編集が反映される',
    (await tid('detail-date').textContent()) === '9/30（水）16:20' &&
      (await page.locator('[data-testid=record-detail] .score.big').textContent()) === '9.8点' &&
      (await tid('detail-memo').count()) === 0,
    await tid('detail-date').textContent(),
  );

  // ── I：射手の利き手を直すと、その射手の記録すべてに反映される
  await tid('tab-load').click();
  await tid('shooter-edit').click();
  await tid('shooter-dialog').waitFor();
  check('編集の窓に今の名前が入っている', (await tid('shooter-name').inputValue()) === '佐藤');
  await registerShooter('佐藤', 'right');
  check(
    '射手の利き手を直せる',
    (await selectedLabel()) === '佐藤（右利き）',
    await selectedLabel(),
  );
  await tid('tab-library').click();
  await waitItems(2);
  check('別のタブから戻ると一覧に戻っている', (await tid('record-detail').count()) === 0);
  await openDetail(recordA);
  const detailFixed = await table('detail-table');
  check(
    '射手の利き手を直すと、保存済みの記録の角度にも反映される',
    (await tid('detail-shooter').textContent()) === '佐藤・右利き' &&
      sameValues(detailFixed, detailA),
    await tid('detail-shooter').textContent(),
  );
  await tid('detail-favorite').click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid=detail-favorite]')?.getAttribute('aria-pressed') ===
      'false',
  );
  await tid('detail-back').click();
  await waitItems(2);
  list = await items();
  check(
    '開いた画面の ★ と編集内容が一覧にも反映される',
    !list[0].favorite &&
      list[0].date === '9/30（水）16:20' &&
      list[0].sub === '佐藤' &&
      list[0].score === '9.8点',
    JSON.stringify(list[0]),
  );

  // ── J：削除（確認付き）
  await openDetail(recordB);
  await tid('detail-remove').click();
  await tid('remove-dialog').waitFor();
  await tid('confirm-cancel').click();
  check('削除の確認でキャンセルすると消えない', (await tid('record-detail').count()) === 1);
  await tid('detail-remove').click();
  await tid('confirm-ok').click();
  await waitItems(1);
  list = await items();
  check('削除すると一覧から消える', list.length === 1 && list[0].id === recordA);
  await tid('tab-mark').click();
  check(
    '読み込み中の解析の保存先を削除すると、マーク画面は未保存に戻る',
    (await tid('save-open').count()) === 1 && (await tid('unsaved-dot').count()) === 1,
  );

  // ── K：ページを開き直しても残っている（端末内に保存されている）
  await page.reload();
  await tid('shooter-select').waitFor();
  check(
    '開き直しても、前回の射手が選ばれている',
    (await selectedLabel()) === '佐藤（右利き）',
    await selectedLabel(),
  );
  check(
    '開き直しても射手が 2 人残っている',
    (await tid('shooter-select').locator('option').count()) === 3,
  );
  await tid('tab-library').click();
  await waitItems(1);
  await waitThumbs();
  list = await items();
  check(
    '開き直しても記録が残っている',
    list.length === 1 && list[0].id === recordA && list[0].thumbWidth === 180,
  );
  await openDetail(recordA);
  const detailReloaded = await table('detail-table');
  const stillReloaded = await stillSignature();
  check(
    '開き直しても、角度と静止画が同じ',
    sameValues(detailReloaded, detailA) &&
      stillReloaded &&
      still &&
      distance(stillReloaded.sig, still.sig) === 0,
  );
  await tid('detail-remove').click();
  await tid('confirm-ok').click();
  await tid('library-empty').waitFor();
  check('0 件になると案内とボタンが出る', (await tid('library-go-load').count()) === 1);
  await tid('library-go-load').click();
  check('案内のボタンで読込画面へ移る', await tid('video-file').isVisible());
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
    .screenshot({ path: join(outDir, `library-${browserName}-error.png`), fullPage: true })
    .catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
const outFile = join(outDir, `library-${browserName}.json`);
writeFileSync(
  outFile,
  JSON.stringify({ browser: browserName, base, videoPath, fatal, summary, checks, logs }, null, 2),
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
