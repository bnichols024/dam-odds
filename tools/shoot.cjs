// Screenshot every route (used by .github/workflows/screens.yml).
//   node tools/shoot.cjs <outdir> [route ...]
// Phone pages are saved in 1,000px-tall chunks so they stay readable. ALL=1 adds light mode
// for every page.
const { chromium, devices } = require('playwright');
const fs = require('fs');

const out = process.argv[2] || 'shots';
const routes = process.argv.slice(3).length ? process.argv.slice(3) : ['odds', 'gameday', 'race', 'whatif', 'pac12', 'model', 'team/68', 'team/204'];
// ESPN rejects requests that identify as HeadlessChrome, so look like a normal browser.
const DESK_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HINTS = { 'sec-ch-ua': '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"' };

async function shoot(page, file, chunked) {
  if (!chunked) {
    await page.screenshot({ path: `${file}.png`, fullPage: true });
    return [`${file}.png`];
  }
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const width = page.viewportSize().width;
  const files = [];
  const step = 1000;
  for (let y = 0, k = 0; y < height && k < 6; y += step, k++) {
    const f = `${file}-${k}.png`;
    await page.screenshot({ path: f, fullPage: true, clip: { x: 0, y, width, height: Math.min(step, height - y) } });
    files.push(f);
  }
  return files;
}

(async () => {
  const browser = await chromium.launch();
  const configs = [
    { name: 'phone', ctx: { ...devices['iPhone 13'], extraHTTPHeaders: HINTS }, chunked: true },
    { name: 'desk', ctx: { viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1, userAgent: DESK_UA, extraHTTPHeaders: HINTS }, chunked: false },
  ];
  const report = [];
  for (const c of configs) {
    for (const scheme of ['dark', 'light']) {
      const context = await browser.newContext({ ...c.ctx, colorScheme: scheme });
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));
      for (const r of routes) {
        if (scheme === 'light' && !process.env.ALL && !['odds', 'race'].includes(r)) continue;
        await page.goto(`http://localhost:8799/#/${r}`);
        await page.waitForTimeout(1800);
        const files = await shoot(page, `${out}/${c.name}-${scheme}-${r.replace('/', '_')}`, c.chunked);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        report.push(`${files.join(' ')}${overflow > 0 ? ` HORIZONTAL OVERFLOW ${overflow}px` : ''}`);
      }
      if (scheme === 'dark') {
        await page.goto('http://localhost:8799/#/whatif');
        await page.waitForTimeout(800);
        await page.getByText('Beavers win out').click();
        await page.waitForTimeout(12000);
        const files = await shoot(page, `${out}/${c.name}-dark-whatif-winout`, c.chunked);
        report.push(files.join(' '));
        const live = await page.evaluate(() => document.getElementById('live-status')?.textContent);
        report.push(`${c.name} live status: ${live}`);
      }
      if (errors.length) report.push(`${c.name} ${scheme} ERRORS: ${errors.join(' | ')}`);
      await context.close();
    }
  }
  await browser.close();
  console.log(report.join('\n'));
  fs.writeFileSync(`${out}/report.txt`, report.join('\n'));
})();
