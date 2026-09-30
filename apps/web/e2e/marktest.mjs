// 段階②（マーク付け・撃発フレームの角度表）の自動テスト。段階③（保存・ライブラリ）は librarytest.mjs。実際の画面をブラウザで操作して確かめる。
// 開発サーバ（npm run dev）を起動した状態で使う。
//   node apps/web/e2e/marktest.mjs webkit   … Safari と同じ描画エンジン
//   node apps/web/e2e/marktest.mjs chromium … Chrome と同じ描画エンジン
// 動画は apps/web/e2e/videos/static0.mp4（据銃区間の切り出し）を使う。VIDEO=… で変更できる。
// どちらも先頭フレームが 0 秒から始まるように切り出す（0.033 秒始まりだと先頭付近の絵がブラウザごとに変わる）
//   static0.mp4 … 撃発フレームの角度を段階①の実測と照合する
//     作り方：motion.mp4 と同じで、区間を -ss 4.7 -to 8.5、画質を -crf 16 にする
//   motion.mp4 … 腕を上げる動きのある切り出し。画面の絵がフレームに合わせて変わるかを確かめる
//     作り方：ffmpeg -ss 1.0 -to 5.0 -i sample.mov -vf "setpts=PTS-STARTPTS,fps=30" \
//             -c:v libx264 -bf 0 -crf 18 -pix_fmt yuv420p -an motion.mp4
// 結果は apps/web/e2e/results/mark-<ブラウザ名>.json / .png に保存する（git 管理外）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const [browserName = 'webkit'] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:5173';
const videoPath = process.env.VIDEO ?? join(here, 'videos', 'static0.mp4');
const hasMotion = videoPath.endsWith('motion.mp4');

// 段階①で測った据銃区間の平均値（MediaPipe full・動画モード、Mac）。
// 1 フレームの値は平均から SD の数倍は外れうるので、許容幅は ±1.5° とする
const EXPECTED = { shoulderTilt: 13.5, trunkTilt: -6.4, armElevation: 5.0 };
const TOLERANCE_DEG = 1.5;

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
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
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
      // 番号が合うだけでなく、動画のシーク（指定時刻への移動）が終わっていること
      return label?.getAttribute('data-frame-index') === String(i) && video && !video.seeking;
    },
    index,
    { timeout: 10_000 },
  );
/** スライダーを動かす（React が値の変化に気付くよう、ブラウザ本来の設定手段を使う） */
const slideTo = async (index) => {
  await tid('frame-slider').evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, index);
  await waitFrame(index);
};
const marks = () =>
  tid('mark-item').evaluateAll((items) =>
    items.map((li) => ({
      id: li.dataset.markId,
      kind: li.dataset.markKind,
      frame: Number(li.dataset.frameIndex),
      name: li.querySelector('strong')?.textContent ?? '',
    })),
  );
/** 骨格の線を隠して、動画の絵だけを撮る（画面に実際に出ている絵を確かめるため） */
const pictureAt = async (index) => {
  await slideTo(index);
  await page.waitForTimeout(400);
  await page.addStyleTag({ content: '.video-box .overlay { visibility: hidden !important; }' });
  const png = await page.locator('.video-box').screenshot();
  await page.evaluate(() => document.head.lastElementChild?.remove());
  return png;
};
const table = async () => {
  if ((await tid('shot-table').count()) === 0) return null;
  const frame = Number(await tid('shot-table').getAttribute('data-frame-index'));
  const rows = await tid('shot-table')
    .locator('tr[data-metric]')
    .evaluateAll((trs) =>
      trs.map((tr) => ({
        id: tr.dataset.metric,
        value: tr.dataset.value === '' ? null : Number(tr.dataset.value),
        // 項目は 2 行：1 行目が名称、2 行目（small）が基準と記号
        name: tr.children[0].firstChild?.textContent ?? '',
        basis: tr.children[0].querySelector('small')?.textContent ?? '',
        text: tr.children[1].textContent,
        grey: tr.classList.contains('unavailable'),
      })),
    );
  return { frame, rows };
};

let fatal = null;
const summary = {};
try {
  console.log(`open ${base} (${browserName})`);
  await page.goto(base);

  // 姿勢推定の前にマーク画面を開くと案内が出る
  await tid('tab-mark').click();
  check('推定前のマーク画面にプレイヤーが出ない', (await tid('frame-slider').count()) === 0);
  await tid('tab-load').click();

  // 射手を登録する（利き手は射手ごとに決める。登録するまで姿勢推定は実行できない）
  await tid('shooter-register').click();
  await tid('shooter-name').fill('テスト射手');
  await tid('shooter-right').click();
  await tid('shooter-submit').click();
  await tid('shooter-select').waitFor();

  console.log('  姿勢推定を実行中…');
  await tid('video-file').setInputFiles(videoPath);
  await tid('run-analysis').click({ timeout: 60_000 });
  await tid('analysis-done').waitFor({ timeout: 15 * 60_000 });

  await tid('tab-mark').click();
  await tid('frame-slider').waitFor();
  const total = Number(await tid('frame-slider').getAttribute('max')) + 1;
  summary.totalFrames = total;
  check('フレーム数が 10 以上ある', total >= 10, total);
  check('マーク画面の動画が表示されている', await page.locator('.video-box video').isVisible());

  // A：コマ送り・戻し・スライダー
  await slideTo(0);
  for (let i = 1; i <= 5; i++) {
    await tid('next-frame').click();
    await waitFrame(i);
  }
  check('1 コマ送り ×5 で 6 フレーム目になる', (await frameIndex()) === 4 + 1, await frameIndex());
  await tid('prev-frame').click();
  await waitFrame(4);
  check('1 コマ戻しで 5 フレーム目になる', (await frameIndex()) === 4, await frameIndex());
  const last = total - 1;
  await slideTo(last);
  check('スライダーで最後のフレームへ移動', (await frameIndex()) === last, await frameIndex());
  await tid('next-frame').click();
  await page.waitForTimeout(500);
  check('最後のフレームより先へは進まない', (await frameIndex()) === last, await frameIndex());

  // A：骨格だけでなく、動画の絵そのものがフレームに合わせて変わる。
  // 動きのある動画（motion.mp4）のときだけ確かめる（静止した動画では絵の違いが出ない）
  const pictures = hasMotion ? [10, 20, 30] : [];
  const pics = [];
  for (const i of pictures) pics.push(await pictureAt(i));
  if (hasMotion) {
    check(
      'スライダーを動かすと動画の絵が変わる',
      !pics[0].equals(pics[1]) && !pics[1].equals(pics[2]) && !pics[0].equals(pics[2]),
    );
    check('同じフレームに戻ると同じ絵に戻る', pics[0].equals(await pictureAt(10)));
    pictures.forEach((i, n) =>
      writeFileSync(join(here, 'results', `mark-${browserName}-picture-${i}.png`), pics[n]),
    );
  }

  // A：再生・一時停止
  await slideTo(0);
  await tid('toggle-play').click();
  await page.waitForFunction(
    () =>
      Number(
        document.querySelector('[data-testid=frame-label]')?.getAttribute('data-frame-index'),
      ) > 3,
    null,
    { timeout: 10_000 },
  );
  await tid('toggle-play').click();
  // 一時停止の直後は表示の更新が 1 コマ遅れて届くことがあるので、少し待ってから 2 回読む
  await page.waitForTimeout(500);
  const paused1 = await frameIndex();
  const videoPaused = await page.locator('.video-box video').evaluate((v) => v.paused);
  await page.waitForTimeout(700);
  const paused2 = await frameIndex();
  check(
    '再生で進み、一時停止で止まる',
    videoPaused && paused1 > 3 && paused2 === paused1,
    `paused=${videoPaused} ${paused1}→${paused2}`,
  );

  // E：撃発マークが無いうちは表が出ない
  check('撃発マーク前は角度表が出ない', (await table()) === null);
  check('撃発マーク前は案内が出る', (await tid('shot-table-empty').count()) === 1);

  // B：撃発マークを付ける
  const shotA = Math.floor(total / 3);
  await slideTo(shotA);
  await tid('mark-shot').click();
  let list = await marks();
  check(
    '撃発マークが付く',
    list.length === 1 && list[0].kind === 'shot' && list[0].frame === shotA,
    JSON.stringify(list),
  );
  const tableA = await table();
  check('角度表が撃発フレームを指す', tableA?.frame === shotA, tableA?.frame);
  check('角度表は 9 項目', tableA?.rows.length === 9, tableA?.rows.length);
  check(
    'すべての行に名称と、基準・記号がある',
    tableA?.rows.every((r) => r.name !== '' && /^.+ \([a-j]\)$/.test(r.basis)),
    tableA?.rows.map((r) => `${r.name}/${r.basis}`).join(', '),
  );
  check(
    '値のない行は「—」とグレー、値のある行は数値（角度は符号と ° 付き、比は小数 2 桁）',
    tableA?.rows.every((r) =>
      r.value === null
        ? r.text === '—' && r.grey
        : !r.grey && /^[+−]\d+\.\d°$|^-?\d+\.\d{2}$/.test(r.text) && Number.isFinite(r.value),
    ),
    tableA?.rows.map((r) => r.text).join(' '),
  );

  // B：付け直す（1 つのまま、場所だけ変わる）
  const shotB = Math.floor(total / 2);
  await slideTo(shotB);
  await tid('mark-shot').click();
  list = await marks();
  check(
    '撃発マークを付け直しても 1 つ',
    list.filter((m) => m.kind === 'shot').length === 1 && list[0].frame === shotB,
    JSON.stringify(list),
  );
  const tableB = await table();
  check('角度表が付け直した先を指す', tableB?.frame === shotB, tableB?.frame);
  summary.shotFrame = shotB;
  summary.shotTable = tableB?.rows;

  // E：①の実測値と照合
  // 据銃区間の動画（static.mp4）のときだけ照合する
  for (const [id, expected] of videoPath.endsWith('static0.mp4') ? Object.entries(EXPECTED) : []) {
    const v = tableB?.rows.find((r) => r.id === id)?.value;
    check(
      `${id} が①の平均 ${expected}° の ±${TOLERANCE_DEG}° 以内`,
      typeof v === 'number' && Math.abs(v - expected) <= TOLERANCE_DEG,
      typeof v === 'number' ? v.toFixed(2) : v,
    );
  }

  // C：任意マーク
  check('名前が空のうちは追加ボタンが押せない', await tid('add-custom').isDisabled());
  await tid('custom-label').fill('   ');
  check('空白だけの名前でも追加ボタンが押せない', await tid('add-custom').isDisabled());
  const customLate = total - 3;
  const customEarly = 2;
  await slideTo(customLate);
  await tid('custom-label').fill('フォロースルー');
  await tid('add-custom').click();
  await slideTo(customEarly);
  await tid('custom-label').fill(' 振り上げ開始 ');
  await tid('add-custom').click();
  list = await marks();
  check(
    '任意マークを 2 つ追加でき、時刻順に並ぶ',
    JSON.stringify(list.map((m) => [m.name, m.frame])) ===
      JSON.stringify([
        ['振り上げ開始', customEarly],
        ['撃発', shotB],
        ['フォロースルー', customLate],
      ]),
    JSON.stringify(list.map((m) => [m.name, m.frame])),
  );
  check('追加後は入力欄が空に戻る', (await tid('custom-label').inputValue()) === '');
  for (const name of [' フォロースルー', '撃発']) {
    await tid('custom-label').fill(name);
    check(
      `すでにある名前「${name.trim()}」は追加できず、案内が出る`,
      (await tid('add-custom').isDisabled()) && (await tid('custom-duplicate').count()) === 1,
    );
  }
  await tid('custom-label').fill('');
  check('名前を消すと案内も消える', (await tid('custom-duplicate').count()) === 0);
  check('任意マークを足しても角度表は撃発のまま', (await table())?.frame === shotB);

  // D：一覧を押すと移動
  await tid('mark-jump').nth(2).click();
  await waitFrame(customLate);
  check('一覧の 3 番目を押すとそのフレームへ', (await frameIndex()) === customLate);
  await tid('mark-jump').nth(1).click();
  await waitFrame(shotB);
  check('一覧の撃発を押すと撃発フレームへ', (await frameIndex()) === shotB);
  await tid('mark-jump').nth(0).click();
  await waitFrame(customEarly);
  check('一覧の 1 番目を押すとそのフレームへ', (await frameIndex()) === customEarly);

  // 画面を切り替えてもマークが残り、動画も戻ってくる
  await tid('tab-load').click();
  check('読込画面でも動画が表示されている', await page.locator('.video-box video').isVisible());
  await tid('next-frame').click();
  await waitFrame(customEarly + 1);
  check('読込画面でもコマ送りできる', (await frameIndex()) === customEarly + 1);
  await tid('tab-noise').click();
  check('ノイズ測定画面では動画が隠れる', !(await page.locator('.video-box video').isVisible()));
  await tid('tab-library').click();
  check('ライブラリ画面でも動画が隠れる', !(await page.locator('.video-box video').isVisible()));
  await tid('tab-mark').click();
  await tid('frame-slider').waitFor();
  list = await marks();
  check('画面を切り替えてもマークが残る', list.length === 3, list.length);
  check('戻ったあとも動画が表示されている', await page.locator('.video-box video').isVisible());
  await slideTo(shotA);
  check('戻ったあともスライダーで動かせる', (await frameIndex()) === shotA);
  if (hasMotion) {
    const back = [];
    for (const i of pictures) back.push(await pictureAt(i));
    check('戻ったあとも動画の絵が変わる', !back[0].equals(back[2]));
    check(
      '戻る前と同じ絵が出る',
      back.every((png, n) => png.equals(pics[n])),
    );
  }

  await page.screenshot({ path: join(here, 'results', `mark-${browserName}.png`), fullPage: true });

  // C：削除
  await tid('mark-remove').nth(0).click();
  list = await marks();
  check(
    '任意マークを削除できる',
    JSON.stringify(list.map((m) => m.name)) === JSON.stringify(['撃発', 'フォロースルー']),
    JSON.stringify(list.map((m) => m.name)),
  );
  await tid('mark-remove').nth(0).click();
  list = await marks();
  check(
    '撃発マークを削除すると角度表が消える',
    list.length === 1 && (await table()) === null,
    JSON.stringify(list),
  );
} catch (e) {
  fatal = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  const state = await page
    .evaluate(async () => {
      const v = document.querySelector('.video-box video');
      const label = document.querySelector('[data-testid=frame-label]');
      // 描画の更新回数（1 秒あたり）。ウィンドウが他のウィンドウに隠れると 0 に近づく
      const raf = await new Promise((resolve) => {
        let n = 0;
        const tick = () => {
          n++;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        setTimeout(() => resolve(n), 1000);
      });
      return `raf=${raf}/s focus=${document.hasFocus()} frame=${label?.getAttribute('data-frame-index')} t=${v?.currentTime} seeking=${v?.seeking} ready=${v?.readyState} paused=${v?.paused} visibility=${document.visibilityState}`;
    })
    .catch(() => 'unknown');
  fatal += ` / ${state}`;
  await page
    .screenshot({ path: join(here, 'results', `mark-${browserName}-error.png`), fullPage: true })
    .catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `mark-${browserName}.json`);
writeFileSync(
  outFile,
  JSON.stringify({ browser: browserName, base, videoPath, fatal, summary, checks, logs }, null, 2),
);
await browser.close();

console.log(`saved ${outFile}`);
if (fatal) console.log(`FATAL: ${fatal}`);
// テスト用ウィンドウが他のウィンドウに隠れると、ブラウザが描画の更新を止めてテストが進まなくなる。
// アプリの不具合ではないので、区別できるよう終了コードを変える（2 なら再実行する）
// 通常は毎秒 60 回前後。10 回未満なら隠れている（画面の消灯・ロック中も同じ）とみなす
const hiddenWindow = Number(/raf=(\d+)\/s/.exec(fatal ?? '')?.[1] ?? 60) < 10;
if (hiddenWindow) console.log('テスト用ウィンドウが隠れて描画が止まりました。再実行してください。');
if (logs.length) console.log(`console: ${logs.length} 件（結果ファイル参照）`);
console.log(`${checks.length - failed.length} / ${checks.length} 合格`);
process.exit(hiddenWindow ? 2 : fatal || failed.length ? 1 : 0);
