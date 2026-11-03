# Dam Odds

How likely is it that Oregon State makes the College Football Playoff? Bryan and a friend (big
OSU fans) wanted an elaborate, phone-first (desktop too) dashboard. In 2026 OSU is in the new
Pac-12, a Group of 6 league; one CFP spot goes to the highest-ranked G6 team in the committee's
final ranking (not required to be a conference champion). Scope: the G6 race only. Power 4
teams matter only through G6 teams' schedules (ratings, strength of schedule, quality wins).

## Layout
- `site/` is the whole website (GitHub Pages serves it). No build step, plain ES modules.
  - `site/engine/` is the shared model code. The browser (Web Worker) and Node pipeline both
    import it, so keep it dependency-free and DOM-free.
  - `site/data/` is generated JSON: `snapshot.json` (built by `pipeline/build.js`),
    `model.json` + `history-seasons.json` (built by `pipeline/train.js`), `history.json`
    (odds over time, appended by the build).
- `pipeline/` Node scripts. `node pipeline/train.js` fits the committee model on 2014-2025 CFP
  rankings. `node pipeline/build.js` pulls the 2026 season from ESPN and runs the sims.
  Raw ESPN responses cache in `pipeline/cache/` (gitignored).
- `.github/workflows/refresh.yml` runs the build on a schedule on GitHub's machines and deploys
  Pages, so the Unraid server does none of the work.

## Data
- ESPN public JSON only (no keys): site.api.espn.com scoreboard/standings/rankings and
  sports.core.api.espn.com for historical CFP rankings (ranking id 21). CORS is open, so the
  browser polls the scoreboard directly for live mode.
- ESPN `odds[0].spread` is the HOME team's handicap (negative = home favored).

## Rules baked in (check each season)
- 2026: 12-team CFP; G6 bid = top-ranked G6 team (SI reported; commissioners may revert to
  "top-ranked G6 champion"; the engine has a `rule` switch).
- Pac-12 Week 13 flex games count as non-conference; the title game pair is set after Week 12;
  the league may swap flex opponents to avoid a title-game rematch.
- NDSU (MWC) and Sacramento State (MAC) are in FBS transition: ineligible for conference title
  games and the CFP in 2026 (`pipeline/config.js`).

## Hosting
- Public repo bnichols024/dam-odds (Bryan approved public on 2026-11-03), Pages from Actions:
  https://bnichols024.github.io/dam-odds/
- `refresh.yml`: on push, daily 13:17 UTC, hourly Saturday game windows, Tuesday nights after
  CFP rankings. It commits `site/data/snapshot.json` + `history.json` as "dam-odds bot", so
  `git pull` before pushing.
- `screens.yml` (manual): Playwright screenshots of every page, phone chunks + desktop;
  download with `gh run download <id> -n screenshots`. This server has no Chromium; don't
  pull browser images here.
- ESPN returns 403 to "HeadlessChrome" user agents/client hints; real browsers are fine.

## Model decisions
- Committee model: pairwise logistic on final CFP rankings 2014-2025, sign-constrained, variant
  picked by leave-one-season-out hits then log score. Current: no raw wins, lambda 1, 10/12
  seasons right (same as "fewest losses" baseline; misses 2014, 2025).
- ESPN marks canceled games as state "post" with 0-0: parseEvent maps them to "canceled".
- Live re-sims in the browser reuse the baseline's n and seed (20261103) so only changed games
  move the odds. Leverage and What-If runs use smaller samples and are shown as shifts on top
  of the headline odds (`anchored()` in components.js, `shift` in whatif.js).

## Games Today / win-out (added 2026-11-03)
- Rooting numbers lead with "if OSU wins out" (`leverage(..., { extra: { forceTeams: { 204: 'win' } } })`,
  stored as `snapshot.leverage.winOut`). OSU's overall odds (~1%) are too small for paired sims to
  resolve weeknight games; the win-out view has ~10x the resolution. Tiers in `site/js/rooting.js`.
- `focus.ladder` / `winOutAll` / `bidIfWinOut` come from the sims (correlated), not multiplied odds.
- Days are the viewer's local day (`dayKey` in util.js); screenshots run in America/Los_Angeles.
- Logos: ESPN CDN by team id (`logo()` in components.js), light + dark imgs, dot fallback.
- Unpaired flex slots (away unknown) are excluded from rooting lists (they're usually OSU's game).

## Notes
- Created 2026-11-03 from Bryan's phone session.
- Dev checks: `node pipeline/probe.js <gameId> [n]` for paired what-ifs at scale.
- Never put `..` in a Bash command (server ask-rule). Use Write/Edit for files.
- Server is shared and was overloaded on Nov 2; keep local runs light (sims are seconds).
