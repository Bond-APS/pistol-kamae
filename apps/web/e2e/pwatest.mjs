// 段階⑦の自動テスト：PWA（マニフェスト・サービスワーカー・オフラインで開ける）と初回の案内。
// サービスワーカーは公開用ビルドだけで働くので、ビルド結果（npm run build → npm run preview）に対して回す。
//   BASE_URL=http://localhost:4173/pistol-kamae/ HEADLESS=1 node apps/web/e2e/pwatest.mjs webkit
//   BASE_URL=http://localhost:4173/pistol-kamae/ HEADLESS=1 node apps/web/e2e/pwatest.mjs chromium
// 開発サーバ（BASE_URL 省略）に対して回すと、マニフェストとサービスワーカーの検査は飛ばし、初回の案内だけを見る。
// 結果は apps/web/e2e/results/pwa-<ブラウザ名>.json に保存する（git 管理外）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const [browserName = 'webkit'] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:5173/';
const built = !base.includes(':5173');

const launcher = { chromium, webkit }[browserName];
if (!launcher) throw new Error(`unknown browser: ${browserName}`);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  console.log(`  ${ok ? 'OK  ' : 'NG  '} ${name}${detail === '' ? '' : `  [${detail}]`}`);
};
const logs = [];
/** 道具の制約で確かめられない検査（合否に数えない。実機で確かめる） */
const skipped = [];
const skip = (name, reason) => {
  skipped.push({ name, reason });
  console.log(`  SKIP ${name}  [${reason}]`);
};

const browser = await launcher.launch({ headless: process.env.HEADLESS === '1' });
const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('dialog', (d) => void d.accept());
const tid = (id) => page.locator(`[data-testid=${id}]`);

let fatal = null;
const summary = {};
try {
  console.log(`open ${base} (${browserName}${built ? '、公開用ビルド' : '、開発サーバ'})`);
  await page.goto(base);
  await tid('tab-save').waitFor();

  // ---- 初回の案内：ホーム画面から開いていないので出る。「閉じる」で消え、開き直しても出ない
  await tid('install-notice').waitFor({ timeout: 5000 });
  const noticeText = await tid('install-notice').textContent();
  check(
    '初回の案内が出る（ホーム画面に追加と、JSON で控えを取る）',
    noticeText.includes('ホーム画面に追加すると') &&
      noticeText.includes('すべての記録を JSON で書き出す'),
    noticeText.slice(0, 60),
  );
  check(
    'Mac のブラウザでは iPhone 向けの手順ではなく、一般の手順が出る',
    (await tid('install-notice').getAttribute('data-ios')) === 'false' &&
      noticeText.includes('ブラウザのメニューから'),
  );
  await tid('tab-library').click();
  check('ライブラリのタブでも案内が出たまま', (await tid('install-notice').count()) === 1);
  await tid('install-notice-close').click();
  check('「閉じる」で案内が消える', (await tid('install-notice').count()) === 0);
  await page.reload();
  await tid('tab-save').waitFor();
  await page.waitForTimeout(300);
  check(
    '開き直しても案内は出ない（端末に覚えている）',
    (await tid('install-notice').count()) === 0,
  );
  // ホーム画面から開いたとき（standalone）は、閉じていなくても出ない
  await page.evaluate(() => window.localStorage.removeItem('kamae.installNoticeClosed'));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  });
  await page.reload();
  await tid('tab-save').waitFor();
  await page.waitForTimeout(300);
  check('ホーム画面から開いたときは案内を出さない', (await tid('install-notice').count()) === 0);

  if (built) {
    // ---- マニフェスト
    const manifestHref = await page.locator('link[rel=manifest]').getAttribute('href');
    check('マニフェストへのリンクがある', manifestHref !== null, manifestHref);
    const manifest = await page.evaluate(async (href) => {
      const res = await fetch(href);
      return res.ok ? res.json() : null;
    }, manifestHref ?? '');
    summary.manifest = manifest;
    check(
      'マニフェスト：名前・説明・全画面・向きは固定しない・アイコン 192 と 512 と丸抜き用',
      manifest?.name === 'Pistol Kamae' &&
        manifest.description.includes('エアピストル') &&
        manifest.display === 'standalone' &&
        manifest.orientation === undefined &&
        manifest.lang === 'ja' &&
        manifest.icons.some((i) => i.sizes === '192x192') &&
        manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === undefined) &&
        manifest.icons.some((i) => i.purpose === 'maskable'),
      JSON.stringify(manifest).slice(0, 120),
    );
    const iconsOk = await page.evaluate(async (icons) => {
      const results = await Promise.all(icons.map((i) => fetch(i.src).then((r) => r.ok)));
      return results.every(Boolean);
    }, manifest?.icons ?? []);
    const appleIcon = await page.locator('link[rel=apple-touch-icon]').getAttribute('href');
    const appleOk = await page.evaluate(
      async (href) => (await fetch(href)).ok,
      appleIcon ?? 'missing',
    );
    check('アイコンの画像が読める（マニフェストと iPhone 用）', iconsOk && appleOk, appleIcon);
    check(
      'iPhone でアプリのように開くための印と、説明文（ja.ts から差し込み）がある',
      (await page.locator('meta[name=apple-mobile-web-app-capable]').count()) === 1 &&
        (await page.locator('meta[name=apple-mobile-web-app-title]').getAttribute('content')) ===
          'Kamae' &&
        (await page.locator('meta[name=description]').getAttribute('content')).includes(
          'エアピストル',
        ) &&
        (await page.locator('meta[name=theme-color]').count()) === 2,
    );

    // ---- サービスワーカー：登録され、取り置きが終わるのを待つ
    const sw = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false };
      const reg = await navigator.serviceWorker.ready;
      return { supported: true, scope: reg.scope, active: Boolean(reg.active) };
    });
    summary.sw = sw;
    check('サービスワーカーが登録され、動いている', sw.supported && sw.active, JSON.stringify(sw));
    // 取り置き（事前キャッシュ）に wasm とモデルが入っている
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) urls.push(req.url);
      }
      return urls;
    });
    summary.cachedCount = cached.length;
    summary.cached = cached.map((u) => u.replace(/^.*\/pistol-kamae\//, ''));
    check(
      '取り置きに、画面の部品・wasm・モデルが入っている',
      cached.some((u) => u.includes('.wasm')) &&
        cached.some((u) => u.includes('pose_landmarker_full.task')) &&
        cached.some((u) => /\/assets\/index-.*\.js/.test(u)) &&
        // 取り置きの鍵には版の印（?__WB_REVISION__=…）が付くことがあるので、含むかで見る
        cached.some((u) => u.includes('index.html')),
      `${cached.length} 件`,
    );

    // ---- 通信を切って開き直しても画面が出る（取り置きから）
    // 開き直しがサービスワーカーの管理下で行われるよう、一度読み直して controller が付くのを待つ
    await page.reload();
    await tid('tab-save').waitFor();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 10_000,
    });
    // 通信を切る（context.setOffline）。サービスワーカーからの通信も止まるので、取り置きに無いものを網から取りに
    // 行っていればそこで失敗する（要求の遮断 context.route だと、サービスワーカーの通信には効かない）
    await context.setOffline(true);
    let offlineOk = false;
    let offlineError = null;
    try {
      await page.reload({ timeout: 15_000 });
      await tid('tab-save').waitFor({ timeout: 10_000 });
      offlineOk = (await tid('tab-library').count()) === 1;
    } catch (e) {
      offlineError = e.message;
    }
    // Playwright の WebKit は、遮断をサービスワーカーより手前で効かせるため（内部エラー／Blocked by Web Inspector）、
    // 取り置きからの開き直しを確かめられない。iPhone の実機（機内モード）で確かめる
    if (
      !offlineOk &&
      browserName === 'webkit' &&
      /internal error|Web Inspector/.test(offlineError ?? '')
    ) {
      skip(
        '通信を切っても、開き直すと画面が出る（オフラインで使える）',
        'Playwright の WebKit では遮断がサービスワーカーに届かない。iPhone で確認',
      );
    } else {
      check(
        '通信を切っても、開き直すと画面が出る（オフラインで使える）',
        offlineOk,
        offlineError ?? '',
      );
    }
    // オフラインのまま、姿勢推定に要る wasm とモデルも取り置きから読める
    const assetsOffline = await page.evaluate(async () => {
      const names = await caches.keys();
      let wasm = false;
      let model = false;
      for (const name of names) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          if (req.url.includes('.wasm') && (await cache.match(req))) wasm = true;
          if (req.url.includes('.task') && (await cache.match(req))) model = true;
        }
      }
      return wasm && model;
    });
    check('オフラインでも wasm とモデルが取り置きから読める', assetsOffline);
    // 通信を切ったまま、姿勢推定が最後まで走る（Worker から読む wasm とモデルも取り置きから返る）。
    // Chrome だけ（WebKit は上と同じ制約で開き直せない。iPhone の機内モードで確かめる）
    if (offlineOk) {
      const videoPath = join(here, 'videos', 'motion.mp4');
      await tid('shooter-register').click();
      await tid('shooter-name').fill('オフライン射手');
      await tid('shooter-right').click();
      await tid('shooter-submit').click();
      await tid('shooter-select').waitFor();
      await tid('shooter-next').click();
      await tid('video-file').setInputFiles(videoPath);
      await tid('run-analysis').and(page.locator(':enabled')).waitFor({ timeout: 60_000 });
      await tid('run-analysis').click();
      let analysed = false;
      try {
        await tid('clip-player').waitFor({ timeout: 5 * 60_000 });
        analysed = true;
      } catch (e) {
        logs.push(`[offline-analysis] ${e.message}`);
      }
      check(
        '通信を切ったまま、姿勢推定が最後まで走る（wasm とモデルが取り置きから読める）',
        analysed,
      );
    }
    await context.setOffline(false);
  } else {
    console.log('  （開発サーバなので、マニフェストとサービスワーカーの検査は飛ばす）');
  }
} catch (e) {
  fatal = e instanceof Error ? (e.stack ?? e.message) : String(e);
  await page
    .screenshot({ path: join(here, 'results', `pwa-${browserName}-error.png`), fullPage: true })
    .catch(() => {});
}

const failed = checks.filter((c) => !c.ok);
const outDir = join(here, 'results');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `pwa-${browserName}.json`);
writeFileSync(
  outFile,
  JSON.stringify({ browser: browserName, base, fatal, summary, checks, skipped, logs }, null, 2),
);
await browser.close();

console.log(`saved ${outFile}`);
if (fatal) console.log(`FATAL: ${fatal}`);
if (logs.length) console.log(`console: ${logs.length} 件（結果ファイル参照）`);
console.log(
  `${checks.length - failed.length} / ${checks.length} 合格${skipped.length ? `（${skipped.length} 件は実機で確認）` : ''}`,
);
process.exit(fatal || failed.length ? 1 : 0);
