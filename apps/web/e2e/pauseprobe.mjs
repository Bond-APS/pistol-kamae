// 比較画面で「止めた直後の②の絵」が骨格のコマと一致するかを、何度も止めて数える計測（最終-1 の追補）。
// 合否の自動テストではなく、稀なずれの頻度を見るための道具。開発サーバを起動した状態で使う。
//   HEADLESS=1 node apps/web/e2e/pauseprobe.mjs webkit 60     … 60 回止める（既定 40 回）
//   NOMINAL=1 HEADLESS=1 node apps/web/e2e/pauseprobe.mjs chromium 40
//     … 記録から実時刻の印（exact）を外し、古い記録（名目の時刻）と同じ条件で数える
// 1 回ごとに、止めた瞬間の currentTime・シークの有無・表示されたコマの時刻（requestVideoFrameCallback）と、
// 絵が「同じコマへ動かし直した絵」と一致するか（NG＝次のコマの絵のまま）を出す。
import { chromium, webkit } from 'playwright';
import { pictureTools } from './picture.mjs';
const [browserName = 'chromium', trialsArg = '40'] = process.argv.slice(2);
const TRIALS = Number(trialsArg);
const base = 'http://localhost:5173';
const here = `${process.cwd()}/apps/web/e2e/videos`;
const browser = await { chromium, webkit }[browserName].launch({
  headless: process.env.HEADLESS === '1',
});
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('dialog', (d) => void d.accept());
const tid = (id) => page.locator(`[data-testid=${id}]`);
const { pictureOf, pixelsOf, difference } = pictureTools(page);
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
const waitBothReady = () =>
  page.waitForFunction(
    () => {
      const vs = document.querySelectorAll(
        '[data-testid=stage-video-base], [data-testid=stage-video-current]',
      );
      return vs.length === 2 && [...vs].every((v) => v.readyState >= 2 && !v.seeking);
    },
    null,
    { timeout: 20_000 },
  );
async function saveVideo(path, title, { shotSec } = {}) {
  await tid('tab-save').click();
  if ((await tid('save-screen').getAttribute('data-step')) === 'done')
    await tid('save-next').click();
  await tid('shooter-next').click();
  await tid('video-file').setInputFiles(path);
  await tid('run-analysis').click({ timeout: 60_000 });
  await tid('clip-player').waitFor({ timeout: 15 * 60_000 });
  await waitSettled('clip-player');
  await tid('clip-confirm').click();
  await tid('shot-player').waitFor();
  await waitSettled('shot-player');
  await page.waitForTimeout(1500);
  if (shotSec !== undefined) {
    await slideTo('shot-player-bar', shotSec);
    await waitSettled('shot-player');
  }
  await tid('shot-set').click();
  await tid('form-summary').waitFor({ timeout: 15_000 });
  await tid('form-title').fill(title);
  await tid('form-submit').click();
  await tid('save-done').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  return Number(await tid('save-done').getAttribute('data-saved-id'));
}
await page.goto(base);
await page
  .locator('[data-testid=shooter-register], [data-testid=shooter-select]')
  .first()
  .waitFor();
if (await tid('shooter-register').count()) {
  await tid('shooter-register').click();
  await tid('shooter-name').fill('計測');
  await tid('shooter-right').click();
  await tid('shooter-submit').click();
  await tid('shooter-select').waitFor();
}
const a = await saveVideo(`${here}/shot.mp4`, '30fps');
const b = await saveVideo(`${here}/motion.mp4`, 'motion', { shotSec: 2.0 });
// NOMINAL=1 なら、記録から実時刻の印（exact）を外して古い記録と同じ（名目の時刻）にする
if (process.env.NOMINAL === '1') {
  await page.evaluate(
    async (ids) => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('pistol-kamae');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (const id of ids) {
        await new Promise((resolve, reject) => {
          const store = db.transaction('recordData', 'readwrite').objectStore('recordData');
          const get = store.get(id);
          get.onsuccess = () => {
            const row = get.result;
            row.analysis.frames = row.analysis.frames.map((f) => {
              const rest = { ...f };
              delete rest.exact;
              return rest;
            });
            const put = store.put(row);
            put.onsuccess = () => resolve();
            put.onerror = () => reject(put.error);
          };
          get.onerror = () => reject(get.error);
        });
      }
      db.close();
    },
    [a, b],
  );
  await page.reload();
  await tid('save-screen').waitFor();
}
await tid('tab-library').click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid=lib-item]').length >= 2);
const item = (id) => page.locator(`[data-testid=lib-item][data-record-id="${id}"]`);
await item(a).locator('[data-testid=lib-pick]').click();
await item(b).locator('[data-testid=lib-pick]').click();
await tid('pick-compare').click();
await tid('compare-overlay').waitFor({ timeout: 30000 });
await waitBothReady();
// ②の video の出来事を記録
await page.evaluate(() => {
  const v = document.querySelector('[data-testid=stage-video-current]');
  const log = [];
  window.__log = log;
  const t0 = performance.now();
  const push = (kind, extra = {}) =>
    log.push({ kind, at: Math.round(performance.now() - t0), t: v.currentTime, ...extra });
  for (const kind of ['play', 'pause', 'seeking', 'seeked'])
    v.addEventListener(kind, () => push(kind));
  const onFrame = (_now, meta) => {
    push('frame', { media: meta.mediaTime });
    v.requestVideoFrameCallback(onFrame);
  };
  v.requestVideoFrameCallback(onFrame);
});
const currentPicture = async () =>
  pixelsOf(await pictureOf('still', ['[data-testid=stage-layer-base]']));
const results = [];
await tid('compare-rate-100').click();
for (let i = 0; i < TRIALS; i++) {
  await slideTo('compare-bar', -1.45);
  await waitBothReady();
  await page.evaluate(() => (window.__log.length = 0));
  await tid('compare-play').click();
  await page.waitForFunction(
    () => !document.querySelector('[data-testid=stage-video-current]').paused,
    null,
    { timeout: 5000 },
  );
  await page.waitForTimeout(250 + Math.floor(Math.random() * 400));
  await tid('compare-play').click();
  await waitBothReady();
  await page.waitForTimeout(250);
  const log = await page.evaluate(() => window.__log.slice());
  const chosenSec = Number(await tid('compare-time').getAttribute('data-current-sec'));
  const t = await page.evaluate(
    () => document.querySelector('[data-testid=stage-video-current]').currentTime,
  );
  const atPausePic = await currentPicture();
  await tid('compare-next').click();
  await waitBothReady();
  const nextPic = await currentPicture();
  await tid('compare-prev').click();
  await waitBothReady();
  const samePic = await currentPicture();
  await tid('compare-prev').click();
  await waitBothReady();
  const prevPic = await currentPicture();
  const diff = {
    same: difference(atPausePic, samePic),
    next: difference(atPausePic, nextPic),
    prev: difference(atPausePic, prevPic),
    neighbors: difference(samePic, nextPic),
  };
  const bad = !(diff.same <= 1.0 && diff.same < diff.next && diff.same < diff.prev);
  const pauseIdx = log.findIndex((e) => e.kind === 'pause');
  const after = log.slice(pauseIdx);
  const brief = after
    .map(
      (e) =>
        `${e.kind}@${e.at}${e.kind === 'frame' ? `:${e.media.toFixed(3)}` : `:${e.t.toFixed(3)}`}`,
    )
    .join(' ');
  results.push({ i, bad, chosenSec, t, diff, brief });
  const pauseT = log[pauseIdx]?.t ?? NaN;
  const seeked = after.some((e) => e.kind === 'seeking');
  console.log(
    `${bad ? 'NG' : 'ok'} #${i} chosen=${chosenSec.toFixed(3)} pauseT-start=${((pauseT - chosenSec) * 1000).toFixed(2)}ms seek=${seeked ? 'y' : 'n'} same=${diff.same.toFixed(2)} next=${diff.next.toFixed(2)} prev=${diff.prev.toFixed(2)} | ${brief}`,
  );
}
console.log(`NG ${results.filter((r) => r.bad).length} / ${TRIALS}`);
await browser.close();
