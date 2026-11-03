# Dam Odds

How likely is Oregon State to make the College Football Playoff?

In 2026 the Beavers play in the new Pac-12, a Group of 6 league. One CFP spot goes to the
highest-ranked G6 team in the committee's final ranking. Dam Odds simulates the rest of the
season thousands of times, picks every league's title-game teams, and runs a committee model
trained on every final CFP ranking from 2014 to 2025 to see who gets that spot.

**Live site:** https://bnichols024.github.io/dam-odds/

## What's on it
- **Odds**: OSU's CFP chances, the paths (win the Pac-12 or not), odds by final record, who takes
  the spot instead, and the odds over the season.
- **Game Day**: every game this week ranked by how much it moves OSU's odds, with live scores
  and odds that update during games.
- **The Race**: every G6 contender's title-game, conference and CFP odds, and the committee's
  order if the season ended today.
- **What-If**: force results (single games or whole seasons) and re-simulate in the browser.
- **Pac-12**: standings, title-game odds, likely matchups, flex week.
- **How it works**: the model, its backtest, and its assumptions.

## How it runs
- `site/` is a static site (no build step). The simulator in `site/engine/` runs in a Web
  Worker for what-ifs and live updates.
- `pipeline/build.js` pulls ESPN's public data, fits ratings, runs the sims and writes
  `site/data/`. GitHub Actions runs it on a schedule (`.github/workflows/refresh.yml`).
- `pipeline/train.js` refits the committee model on past seasons (rarely needed).

```sh
node pipeline/train.js    # committee model -> site/data/model.json
node pipeline/build.js    # 2026 snapshot -> site/data/snapshot.json
python3 -m http.server 8799 --directory site
```

Unofficial fan project. Not affiliated with Oregon State University, the Pac-12 or the CFP.
