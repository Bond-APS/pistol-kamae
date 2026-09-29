// 自動テストの実行役。開発サーバ（npm run dev）を起動した状態で使う。
//   node apps/web/e2e/autotest.mjs webkit   … Safari と同じ描画エンジン
//   node apps/web/e2e/autotest.mjs chromium … Chrome と同じ描画エンジン
// 追加の引数は ?autotest=1 に続く URL パラメータとして渡す（例：video=/_test/static.mp4）。
// 結果は apps/web/e2e/results/<ブラウザ名>.json に保存する（git 管理外）。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const [browserName = 'webkit', ...extra] = process.argv.slice(2);
const base = process.env.BASE_URL ?? 'http://localhost:5173';
const query = ['autotest=1', ...extra].join('&');
const url = `${base}/?${query}`;
const timeoutMs = Number(process.env.TIMEOUT_MS ?? 30 * 60 * 1000);

const launcher = { chromium, webkit }[browserName];
if (!launcher) throw new Error(`unknown browser: ${browserName}`);

// 画面を実際に表示して動かす（非表示だとフレーム時刻の通知や GPU の挙動が実機と変わるため）
const browser = await launcher.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

console.log(`open ${url} (${browserName})`);
await page.goto(url);

let last = '';
const started = Date.now();
let report;
for (;;) {
  report = await page.evaluate(() => window.__autotest ?? null);
  if (report?.done) break;
  if (Date.now() - started > timeoutMs) {
    console.error('timeout');
    break;
  }
  const progress = await page
    .locator('[data-testid=autotest-progress]')
    .textContent()
    .catch(() => '');
  const head = progress?.split('：')[0] ?? '';
  if (head !== last) {
    last = head;
    console.log(`  ${progress}`);
  }
  await new Promise((r) => setTimeout(r, 1000));
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'results');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${browserName}.json`);
writeFileSync(outFile, JSON.stringify({ url, report, logs }, null, 2));
await page.screenshot({ path: join(outDir, `${browserName}.png`), fullPage: true });
await browser.close();

console.log(`saved ${outFile}`);
if (report?.fatal) console.log(`FATAL: ${report.fatal}`);
if (report?.video)
  console.log(`video: ${JSON.stringify(report.video)} visibility=${report.visibility}`);
for (const r of report?.results ?? []) {
  if (r.error) {
    console.log(`${r.backend}\tERROR ${r.error}`);
    continue;
  }
  const n = r.frames || 1;
  console.log(
    [
      r.backend,
      `${(r.timing.totalMs / 1000).toFixed(1)}s`,
      `infer mean ${(r.timing.inferenceMs / n).toFixed(0)} / median ${r.timing.inferenceMedianMs.toFixed(0)} / first ${r.timing.firstInferenceMs.toFixed(0)} ms`,
      `seek ${(r.timing.seekMs / n).toFixed(0)}ms`,
      `frames ${r.frames} (det ${r.detected}, range ${r.statsCount})`,
      `SD a=${r.stats.shoulderTilt.sd?.toFixed(2)} b=${r.stats.hipTilt.sd?.toFixed(2)} c=${r.stats.trunkTilt.sd?.toFixed(2)}`,
      r.notes?.join(',') ?? '',
    ].join('\t'),
  );
}
if (logs.length) console.log(`console: ${logs.length} 件（結果ファイル参照）`);
