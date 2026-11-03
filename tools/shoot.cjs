// Screenshot every route (used by .github/workflows/screens.yml).
//   node tools/shoot.cjs <outdir> [route ...]
// Set ALL=1 to shoot light mode for every page too.
const { chromium, devices } = require('playwright');

const out = process.argv[2] || 'shots';
const routes = process.argv.slice(3).length ? process.argv.slice(3) : ['odds', 'gameday', 'race', 'whatif', 'pac12', 'model', 'team/68', 'team/204'];

(async () => {
  const browser = await chromium.launch();
  const configs = [
    { name: 'phone', ctx: { ...devices['iPhone 13'] } },
    { name: 'desk', ctx: { viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 } },
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
        const file = `${out}/${c.name}-${scheme}-${r.replace('/', '_')}.png`;
        await page.screenshot({ path: file, fullPage: true });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        report.push(`${file}${overflow > 0 ? ` HORIZONTAL OVERFLOW ${overflow}px` : ''}`);
      }
      // what-if interaction: OSU wins out
      if (scheme === 'dark') {
        await page.goto('http://localhost:8799/#/whatif');
        await page.waitForTimeout(800);
        await page.getByText('Beavers win out').click();
        await page.waitForTimeout(9000);
        await page.screenshot({ path: `${out}/${c.name}-dark-whatif-winout.png`, fullPage: true });
        report.push(`${out}/${c.name}-dark-whatif-winout.png`);
      }
      if (errors.length) report.push(`${c.name} ${scheme} ERRORS: ${errors.join(' | ')}`);
      await context.close();
    }
  }
  await browser.close();
  console.log(report.join('\n'));
  require('fs').writeFileSync(`${out}/report.txt`, report.join('\n'));
})();
