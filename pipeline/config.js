// Season facts that ESPN's data doesn't tell us directly.

export const SEASON = 2026;
export const FOCUS = '204'; // Oregon State
export const TRAIN_SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

// ESPN conference (group) ids
export const CONF = {
  ACC: '1',
  BIG12: '4',
  BIG10: '5',
  SEC: '8',
  PAC12: '9',
  CUSA: '12',
  MAC: '15',
  MWC: '17',
  IND: '18',
  SBC: '37',
  AAC: '151',
};
export const FBS_CONFS = new Set(Object.values(CONF));
export const CONF_SHORT = {
  [CONF.ACC]: 'ACC',
  [CONF.BIG12]: 'Big 12',
  [CONF.BIG10]: 'Big Ten',
  [CONF.SEC]: 'SEC',
  [CONF.PAC12]: 'Pac-12',
  [CONF.CUSA]: 'C-USA',
  [CONF.MAC]: 'MAC',
  [CONF.MWC]: 'Mountain West',
  [CONF.IND]: 'Independent',
  [CONF.SBC]: 'Sun Belt',
  [CONF.AAC]: 'American',
};

export function powerConfs(season) {
  const s = new Set([CONF.ACC, CONF.BIG12, CONF.BIG10, CONF.SEC]);
  if (season <= 2023) s.add(CONF.PAC12);
  return s;
}
// Leagues whose teams can take the "Group of 5/6" spot.
export function groupConfs(season) {
  const s = new Set([CONF.AAC, CONF.CUSA, CONF.MAC, CONF.MWC, CONF.SBC]);
  if (season >= 2026) s.add(CONF.PAC12);
  return s;
}
export const NOTRE_DAME = '87';

// Teams in FBS transition: no conference title game, no CFP (2026).
export const INELIGIBLE = {
  2449: 'North Dakota State is in its FBS transition (ineligible for the MWC title game and the CFP until 2028)',
  16: 'Sacramento State is in its FBS transition (ineligible for the MAC title game and the CFP)',
};

// Championship-game format per league for 2026. Sun Belt uses divisions; the rest take the top two.
export const TITLE_FORMAT = {
  [CONF.SBC]: 'divisions',
};

// Title-game note headline -> conference id
export function titleConfFromNote(note) {
  const s = (note || '').toLowerCase();
  if (s.includes('pac-12')) return CONF.PAC12;
  if (s.includes('mountain west')) return CONF.MWC;
  if (s.includes('sun belt')) return CONF.SBC;
  if (s.includes('conference usa')) return CONF.CUSA;
  if (s.includes('mac')) return CONF.MAC;
  if (s.includes('american')) return CONF.AAC;
  if (s.includes('big 12')) return CONF.BIG12;
  if (s.includes('big ten')) return CONF.BIG10;
  if (s.includes('sec')) return CONF.SEC;
  if (s.includes('acc')) return CONF.ACC;
  return null;
}

// Pac-12 Week 13 flex games: tentative pairings from the league's schedule release (Feb 2026).
// Hosts are fixed; the league can swap opponents to avoid a title-game rematch.
export const PAC12_FLEX = {
  conf: CONF.PAC12,
  hosts: ['36', '278', '328', '265'], // Colorado State, Fresno State, Utah State, Washington State
  visitors: ['326', '21', '68', '204'], // Texas State, San Diego State, Boise State, Oregon State
};

// Model knobs (sdTeam/sdGame are re-estimated by train.js and stored in model.json)
export const PARAMS = {
  marginCap: 28,
  priorRegress: 0.55, // last season's rating carried into this one
  priorGames: 3, // prior strength in games
};
