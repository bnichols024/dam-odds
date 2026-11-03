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

## Notes
- Created 2026-11-03 from Bryan's phone session.
- Never put `..` in a Bash command (server ask-rule). Use Write/Edit for files.
- Server is shared and was overloaded on Nov 2; keep local runs light (sims are seconds).
