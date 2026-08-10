import React, { useState, useRef, useMemo } from 'react';
import {
  Skull, Droplet, Package, Home, Maximize, Minimize, Flame, Map, Wrench,
  Zap, Slash, X, Binoculars, Diamond, Shield, Undo2, Swords, Radiation
} from 'lucide-react';

/* ============================================================================
   WASTELAND SCAVENGER  ·  v17
   ----------------------------------------------------------------------------
   Design changes from v16:
     · Raiders now strike three times (T4/T8/T12) with escalating demands, and
       defense is capped so you can never fully no-sell a raid.
     · Upkeep is every turn (1 Food or Water), not every third turn.
     · Radiation zones are spread one-per-band instead of clustering on a 3d6
       bell curve, and radioactive zones now pay a guaranteed Treasure roll —
       a gamble rather than a toll booth.
     · Fuel accepts "two of a kind + a neighbour" (3.2%/box/turn) instead of
       exact triples (0.5%), which were statistically dead content.
     · Exploration scores its zone number, so deep zones are worth the dice.
       Tier bonuses retuned to counts that are actually reachable.
     · Sacrifice is once per turn and only yields Scrap; Scout pays 7.
     · Structures capped at 2, gated behind Shelter, with escalating cost.
     · All state lives in one object mutated through `commit`, which fixes the
       v16 bugs where two gains in one action overwrote each other.
     · Seeded RNG (shareable/comparable games) + full undo.
   ========================================================================== */

const TRACK = 15;
const MAX_TURNS = 12;
const MAX_STRUCTURES = 2;
const RAD_DEATH = 4;
const RES_KEYS = ['water', 'food', 'scrap', 'fuel'];

const RES_VP = { water: 3, food: 4, scrap: 2, fuel: 5 };
const RAID_TURNS = { 4: 2, 8: 4, 12: 6 };

const BOX_VP = { scrap: 3, water: 7, food: 11, fuel: 12, shelter: 15, scout: 7, fortify: 2 };
const FORTIFY_COMPLETE_VP = 10;
// Tier counts are set against the 36-dice lifetime budget. Reaching N zones
// costs at minimum sum(ceil(z/6)) dice and realistically ~1.4x that, since you
// rarely roll the exact sum you need. 5 / 8 / 11 zones is ~7 / 16 / 24 dice in
// practice — the top tier is a genuine all-in explorer build, and unlike v16's
// 16- and 17-zone tiers (35 dice minimum) it is actually reachable.
const ZONE_TIERS = [
  { count: 5, vp: 10 },
  { count: 8, vp: 20 },
  { count: 11, vp: 35 },
];

/* Costs are paid in Scrap and Fuel — never in Water or Food. With upkeep due
   every day, a structure priced in the survival currency is a trap rather than a
   decision: bot testing showed a Scrap Recycler costing 2 Water spending exactly
   the buffer that keeps you alive, and dying for it. The Fuel Refinery is the one
   deliberate gamble — Fuel is the best-scoring resource, so it is priced highest
   and pays out slowest. Real tension comes from the 2-slot cap, the +1 escalation
   and the Shelter gate, not from accidentally killing yourself. */
const STRUCTURE_DEFS = {
  waterCollector: { name: 'Water Collector', res: 'scrap', base: 2, interval: 1, gives: 'water', effect: '+1 Water every turn' },
  foodGarden: { name: 'Food Garden', res: 'scrap', base: 3, interval: 2, gives: 'food', effect: '+1 Food every 2 turns' },
  scrapRecycler: { name: 'Scrap Recycler', res: 'fuel', base: 1, interval: 1, gives: 'scrap', effect: '+1 Scrap every turn' },
  fuelRefinery: { name: 'Fuel Refinery', res: 'scrap', base: 4, interval: 2, gives: 'fuel', effect: '+1 Fuel every 2 turns' },
};

const TOOL_DEFS = {
  wrench: { name: 'Wrench', cap: 6, effect: '±1 to one die' },
  multitool: { name: 'Multitool', cap: 4, effect: 'Reroll one die' },
  charm: { name: 'Lucky Charm', cap: 2, effect: 'Reroll all unspent dice' },
};

const TREASURE_ZONES = [6, 12, 17];
// Radiation is seeded one zone per band so the hazard is always somewhere you
// will actually walk through, instead of parked past your realistic reach.
const RAD_BANDS = [[3, 7], [8, 12], [13, 18]];

const PAR_TIERS = [
  { min: 260, label: 'WASTELAND LEGEND' },
  { min: 200, label: 'WASTELORD' },
  { min: 140, label: 'SURVIVOR' },
  { min: 0, label: 'SCAVENGER' },
];

/* ---------------------------------------------------------------- seeded RNG */

const hashSeed = (str) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};

// Mulberry32, advanced in place on the draft so undo restores the exact stream.
// That means undoing a roll and redoing it gives the same numbers — undo is for
// misclicks, not for fishing.
const nextRand = (s) => {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const d6 = (s) => Math.floor(nextRand(s) * 6) + 1;
const randInt = (s, lo, hi) => lo + Math.floor(nextRand(s) * (hi - lo + 1));

const clone = (s) => JSON.parse(JSON.stringify(s));

/* ------------------------------------------------------------- initial state */

const emptyTrack = () => Array(TRACK).fill('empty');

// Start with 2 Food and 2 Water, not 1 and 1. Daily upkeep means a 1+1 opening
// dies on day 3 unless you happen to roll a pair or a run in the first two
// turns (44% and 11% a turn) — a coin-flip the player cannot influence. Four
// days of buffer is exactly enough to mark 2 Scrap and get a structure online,
// which turns the opening into a plan instead of a dice check.
const STARTING_STOCK = { water: 2, food: 2 };

const createState = (seedText) => {
  const water = emptyTrack();
  const food = emptyTrack();
  for (let i = 0; i < STARTING_STOCK.water; i++) water[i] = 'acquired';
  for (let i = 0; i < STARTING_STOCK.food; i++) food[i] = 'acquired';

  const s = {
    seedText,
    rng: hashSeed(seedText),
    phase: 'setup',
    turn: 1,
    dice: [0, 0, 0],
    consumed: [false, false, false],
    findDie: 0,
    rolled: false,
    res: { water, food, scrap: emptyTrack(), fuel: emptyTrack() },
    marks: {
      scrap: Array(6).fill(false),
      fortify: Array(4).fill(false),
      scout: Array(11).fill(false),
      water: Array(6).fill(false),
      food: Array(4).fill(false),
      fuel: Array(6).fill(false),
      shelter: Array(7).fill(false),
      zones: Array(17).fill(false),
    },
    radZones: [],
    rad: 0,
    scoutTokens: 0,
    tools: { wrench: 0, multitool: 0, charm: 0 },
    structures: Object.fromEntries(
      Object.keys(STRUCTURE_DEFS).map((k) => [k, { built: false, last: 0 }])
    ),
    upkeepBox: null, // { type, index } — the ONE box that paid upkeep this turn
    raidPool: [], // [{ type, index }] boxes staged for the current raid
    raidsSettled: [],
    barterUsed: false,
    sacrificeUsed: false,
    log: [],
    gameOver: false,
    lost: false,
    reason: '',
  };
  return s;
};

/* ------------------------------------------------------- resource primitives */

const avail = (s, type) => s.res[type].filter((b) => b === 'acquired').length;

const gain = (s, type, n = 1) => {
  const track = s.res[type];
  let added = 0;
  for (let i = 0; i < track.length && added < n; i++) {
    if (track[i] === 'empty') {
      track[i] = 'acquired';
      added++;
    }
  }
  return added;
};

const canPay = (s, cost) => RES_KEYS.every((k) => !cost[k] || avail(s, k) >= cost[k]);

const pay = (s, cost) => {
  if (!canPay(s, cost)) return false;
  RES_KEYS.forEach((k) => {
    let left = cost[k] || 0;
    const track = s.res[k];
    for (let i = track.length - 1; i >= 0 && left > 0; i--) {
      if (track[i] === 'acquired') {
        track[i] = 'used';
        left--;
      }
    }
  });
  return true;
};

const note = (s, text) => {
  s.log = [...s.log, `T${s.turn}: ${text}`].slice(-9);
};

/* --------------------------------------------------------- derived quantities */

const countMarks = (s, key) => s.marks[key].filter(Boolean).length;

const fortifyDefense = (s) => Math.min(3, countMarks(s, 'fortify'));

const raidBase = (s) => RAID_TURNS[s.turn] || 0;

// Defense can never zero out a raid — it is capped at half the demand, so every
// raid costs you something real.
const raidDemand = (s) => {
  const base = raidBase(s);
  if (!base) return 0;
  const reduction = Math.min(countMarks(s, 'shelter') + fortifyDefense(s), Math.floor(base / 2));
  return base - reduction;
};

const isRaidTurn = (s) => !!RAID_TURNS[s.turn] && !s.raidsSettled.includes(s.turn);
const structuresBuilt = (s) => Object.values(s.structures).filter((x) => x.built).length;

const structureCost = (s, key) => {
  const def = STRUCTURE_DEFS[key];
  return { [def.res]: def.base + structuresBuilt(s) };
};

const allDiceSpent = (s) => s.rolled && s.consumed.every(Boolean);

const scoreLines = (s) => {
  const zoneNums = s.marks.zones.reduce((acc, m, i) => (m ? [...acc, i + 2] : acc), []);
  const zoneSum = zoneNums.reduce((a, b) => a + b, 0);
  const zoneCount = zoneNums.length;
  const tierVp = ZONE_TIERS.filter((t) => zoneCount >= t.count).reduce((a, t) => a + t.vp, 0);
  const fortCount = countMarks(s, 'fortify');

  const lines = [
    { label: 'Water in stock', detail: `${avail(s, 'water')} × 3`, vp: avail(s, 'water') * RES_VP.water },
    { label: 'Food in stock', detail: `${avail(s, 'food')} × 4`, vp: avail(s, 'food') * RES_VP.food },
    { label: 'Scrap in stock', detail: `${avail(s, 'scrap')} × 2`, vp: avail(s, 'scrap') * RES_VP.scrap },
    { label: 'Fuel in stock', detail: `${avail(s, 'fuel')} × 5`, vp: avail(s, 'fuel') * RES_VP.fuel },
    { label: 'Scrap boxes', detail: `${countMarks(s, 'scrap')} × 3`, vp: countMarks(s, 'scrap') * BOX_VP.scrap },
    { label: 'Water boxes', detail: `${countMarks(s, 'water')} × 7`, vp: countMarks(s, 'water') * BOX_VP.water },
    { label: 'Food boxes', detail: `${countMarks(s, 'food')} × 11`, vp: countMarks(s, 'food') * BOX_VP.food },
    { label: 'Fuel boxes', detail: `${countMarks(s, 'fuel')} × 12`, vp: countMarks(s, 'fuel') * BOX_VP.fuel },
    { label: 'Shelters', detail: `${countMarks(s, 'shelter')} × 15`, vp: countMarks(s, 'shelter') * BOX_VP.shelter },
    { label: 'Scout marks', detail: `${countMarks(s, 'scout')} × 7`, vp: countMarks(s, 'scout') * BOX_VP.scout },
    { label: 'Fortify boxes', detail: `${fortCount} × 2${fortCount === 4 ? ' +10 complete' : ''}`, vp: fortCount * BOX_VP.fortify + (fortCount === 4 ? FORTIFY_COMPLETE_VP : 0) },
    { label: 'Zones explored', detail: zoneCount ? `sum of ${zoneNums.join('+')}` : 'none', vp: zoneSum },
    { label: 'Exploration tiers', detail: `${zoneCount} zones`, vp: tierVp },
    { label: 'Radiation', detail: `${s.rad} × -10`, vp: s.rad * -10 },
  ];
  return lines;
};

const scoreTotal = (s) => Math.max(0, scoreLines(s).reduce((a, l) => a + l.vp, 0));
const parLabel = (score) => PAR_TIERS.find((t) => score >= t.min).label;

/* --------------------------------------------------------------- transitions */

const setupZones = (s) => {
  const zones = RAD_BANDS.map(([lo, hi]) => randInt(s, lo, hi) - 2);
  s.radZones = zones.sort((a, b) => a - b);
  s.phase = 'play';
  note(s, `Radiation detected in zones ${zones.map((z) => z + 2).join(', ')}.`);
};

const produce = (s) => {
  const batch = { water: 0, food: 0, scrap: 0, fuel: 0 };
  Object.entries(s.structures).forEach(([key, st]) => {
    const def = STRUCTURE_DEFS[key];
    if (st.built && s.turn - st.last >= def.interval) {
      batch[def.gives] += 1;
      st.last = s.turn;
    }
  });
  // Batched, then applied once per resource — v16 applied these one at a time
  // off a stale array and silently dropped gains.
  const gained = [];
  RES_KEYS.forEach((k) => {
    if (batch[k] > 0) {
      gain(s, k, batch[k]);
      gained.push(`+${batch[k]} ${k}`);
    }
  });
  if (gained.length) note(s, `Structures produced ${gained.join(', ')}.`);
};

const rollDice = (s) => {
  if (s.rolled || s.gameOver) return false;
  s.dice = [d6(s), d6(s), d6(s)];
  s.consumed = [false, false, false];
  s.findDie = 0;
  s.rolled = true;
  produce(s);
  return true;
};

const consume = (s, indices) => indices.forEach((i) => { s.consumed[i] = true; });

const findTable = (roll) => {
  if (roll === 1) return null;
  if (roll <= 3) return 'scrap';
  if (roll === 4) return 'food';
  if (roll === 5) return 'water';
  return 'fuel';
};

const treasureRoll = (s) => {
  const r = d6(s);
  if (r === 1) return 'nothing';
  if (r <= 3) {
    gain(s, 'food', 2);
    gain(s, 'scrap', 2);
    return '+2 Food, +2 Scrap';
  }
  if (r === 4) {
    s.tools.wrench = Math.min(s.tools.wrench + 3, TOOL_DEFS.wrench.cap);
    return '+3 Wrench uses';
  }
  if (r === 5) {
    s.tools.multitool = Math.min(s.tools.multitool + 2, TOOL_DEFS.multitool.cap);
    return '+2 Multitool uses';
  }
  s.tools.charm = Math.min(s.tools.charm + 1, TOOL_DEFS.charm.cap);
  return '+1 Lucky Charm use';
};

const applyRad = (s, n) => {
  s.rad = Math.min(RAD_DEATH, s.rad + n);
  if (s.rad >= RAD_DEATH) {
    s.gameOver = true;
    s.lost = true;
    s.reason = 'You absorbed a lethal dose of radiation.';
  }
};

/* Fuel: at least two dice show N, and all three dice fall inside N's window.
   The window is always 3 values wide, clamped to the die — otherwise boxes 1
   and 6 would be 4/216 against 7/216 for the middle boxes, since an end box has
   nowhere to put the third die. Clamping makes all six boxes exactly 7/216.
   Exact triples (v16) were 1/216 per box, which made the section dead content. */
const fuelWindow = (n) => {
  const lo = Math.min(Math.max(1, n - 1), 4);
  return [lo, lo + 2];
};

const fuelMatches = (vals, n) => {
  const [lo, hi] = fuelWindow(n);
  return vals.filter((v) => v === n).length >= 2 && vals.every((v) => v >= lo && v <= hi);
};

/* ============================================================================ */

const RenderCost = ({ cost }) => {
  const icon = { water: Droplet, food: Package, scrap: Wrench, fuel: Flame };
  const tint = { water: 'text-blue-400', food: 'text-green-400', scrap: 'text-amber-400', fuel: 'text-orange-400' };
  const out = [];
  RES_KEYS.forEach((k) => {
    const Ico = icon[k];
    for (let i = 0; i < (cost[k] || 0); i++) out.push(<Ico key={`${k}${i}`} className={`inline h-4 w-4 ${tint[k]}`} />);
  });
  return <div className="flex gap-1 items-center">{out}</div>;
};

const ResourceCheckbox = ({ type, state, onClick, clickable, highlight }) => {
  const ring = {
    water: 'border-blue-700', food: 'border-green-700',
    scrap: 'border-amber-700', fuel: 'border-orange-700',
  }[type];

  let cls = `w-6 h-6 sm:w-7 sm:h-7 rounded border-2 flex items-center justify-center transition-all ${ring}`;
  let inner = null;

  if (state === 'acquired') {
    inner = <Slash className="w-5 h-5 text-stone-300" />;
    cls += ' bg-stone-700';
    if (clickable) cls += ' cursor-pointer hover:bg-stone-600 hover:scale-110';
  } else if (state === 'used') {
    inner = <X className="w-5 h-5 text-red-500" />;
    cls += ' bg-stone-900 border-red-800 opacity-70';
    if (clickable) cls += ' cursor-pointer hover:opacity-100';
  } else {
    cls += ' bg-stone-800 border-stone-700 opacity-40';
  }
  if (highlight) cls += ' ring-2 ring-amber-300';

  return <div className={cls} onClick={clickable ? onClick : undefined}>{inner}</div>;
};

const Panel = ({ children, className = '' }) => (
  <div className={`bg-stone-900/80 border p-4 rounded ${className}`}>{children}</div>
);

/* ============================================================================ */

export default function WastelandScavenger() {
  const [seedInput, setSeedInput] = useState('');
  const [state, setState] = useState(() => createState('wasteland'));
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState([]);
  const [showBarter, setShowBarter] = useState(false);
  const [showScrapSet, setShowScrapSet] = useState(false);
  const [barterSpend, setBarterSpend] = useState([]);
  const [barterGain, setBarterGain] = useState(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const containerRef = useRef(null);

  /* Every mutation goes through here: one clone, one mutator, one snapshot.
     Because the mutator sees a single draft, stacking gains in one action
     (find roll + treasure roll, barter spend + gain) can no longer clobber
     each other the way it did in v16. */
  const commit = (mutator, { keepSelection = false, undoable = true } = {}) => {
    const next = clone(state);
    if (mutator(next) === false) return;
    if (undoable) setHistory((h) => [...h, state].slice(-50));
    setState(next);
    if (!keepSelection) setSelected([]);
    setShowScrapSet(false);
  };

  const undo = () => {
    if (!history.length) return;
    setState(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
    setSelected([]);
    setShowScrapSet(false);
  };

  const s = state;
  const counts = useMemo(
    () => Object.fromEntries(RES_KEYS.map((k) => [k, avail(s, k)])),
    [s]
  );
  const canEnd = allDiceSpent(s);
  const raidActive = isRaidTurn(s) && canEnd;
  const demand = raidDemand(s);
  const raidPaid = s.raidPool.length;
  const upkeepDue = !s.upkeepBox && canEnd && !s.gameOver;
  const selectionLive = selected.length > 0 && selected.every((i) => !s.consumed[i]);
  const one = selectionLive && selected.length === 1;
  const anyUnspent = s.rolled && !s.consumed.every(Boolean);
  const selectedVals = selected.map((i) => s.dice[i]);
  const selectedSum = selectedVals.reduce((a, b) => a + b, 0);
  const nextZone = s.marks.zones.findIndex((x) => !x);

  const toggleDie = (i) => {
    if (!s.rolled || s.consumed[i] || s.gameOver) return;
    setSelected((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]));
    setShowScrapSet(false);
  };

  /* ------------------------------------------------------------ sheet marking */

  const markSimple = (key, index, need, test, onOk) =>
    commit((d) => {
      if (d.gameOver || !d.rolled || d.marks[key][index]) return false;
      if (selected.length !== need || !selected.every((i) => !d.consumed[i])) return false;
      const vals = selected.map((i) => d.dice[i]);
      if (!test(vals, index)) return false;
      consume(d, selected);
      d.marks[key][index] = true;
      if (onOk) onOk(d, index);
      return true;
    });

  const markScrap = (i) =>
    markSimple('scrap', i, 1, (v) => v[0] === i + 1, (d) => { gain(d, 'scrap', 1); note(d, '+1 Scrap.'); });

  const markWater = (i) =>
    markSimple('water', i, 2, (v) => v[0] === i + 1 && v[1] === i + 1, (d) => { gain(d, 'water', 1); note(d, '+1 Water.'); });

  const markFood = (i) =>
    markSimple('food', i, 3, (v) => {
      const sorted = [...v].sort((a, b) => a - b);
      return sorted[0] === i + 1 && sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1;
    }, (d) => { gain(d, 'food', 1); note(d, '+1 Food.'); });

  const markFuel = (i) =>
    markSimple('fuel', i, 3, (v) => fuelMatches(v, i + 1), (d) => { gain(d, 'fuel', 1); note(d, '+1 Fuel.'); });

  const markShelter = (i) =>
    markSimple('shelter', i, 3, (v) => v.reduce((a, b) => a + b, 0) === i + 12);

  const markScout = (i) =>
    markSimple('scout', i, 2, (v) => v[0] + v[1] === i + 2, (d) => {
      d.scoutTokens = Math.min(3, d.scoutTokens + 1);
      note(d, 'Scouted — +1 Scout token.');
    });

  const markFortify = () =>
    commit((d) => {
      if (d.gameOver || !d.rolled || selected.length !== 1 || d.consumed[selected[0]]) return false;
      const box = d.marks.fortify.findIndex((x) => !x);
      if (box === -1) return false;
      consume(d, selected);
      d.marks.fortify[box] = true;
      note(d, box < 3 ? `Fortified (-1 raider demand).` : 'Fortifications complete (+10 VP).');
      return true;
    });

  const markZone = (index) =>
    commit((d) => {
      if (d.gameOver || !d.rolled || d.marks.zones[index]) return false;
      if (d.marks.zones.findIndex((x) => !x) !== index) return false;
      if (!selected.length || !selected.every((i) => !d.consumed[i])) return false;
      const sum = selected.reduce((a, i) => a + d.dice[i], 0);
      if (sum !== index + 2) return false;

      consume(d, selected);
      d.marks.zones[index] = true;
      const zone = index + 2;

      // Scout tokens are only ever useful here and stacking two on one roll
      // beats spreading them, so spend up to 2 automatically.
      const spendTokens = Math.min(d.scoutTokens, 2);
      d.scoutTokens -= spendTokens;
      const target = 6 - spendTokens;
      const roll = d6(d);
      d.findDie = roll;

      const parts = [`Zone ${zone}: find ${roll} vs ${target}`];
      if (roll >= target) {
        const found = findTable(d6(d));
        if (found) {
          gain(d, found, 1);
          parts.push(`found +1 ${found}`);
        } else parts.push('found nothing');
      } else parts.push('nothing found');

      const radioactive = d.radZones.includes(index);
      // Radioactive zones are now a gamble, not a toll: you eat the rad but
      // you are guaranteed a Treasure roll for pushing through.
      if (radioactive || TREASURE_ZONES.includes(zone)) {
        parts.push(`treasure: ${treasureRoll(d)}`);
      }
      if (radioactive) {
        applyRad(d, 1);
        parts.push('+1 RAD');
      }
      note(d, parts.join(', ') + '.');
      return true;
    });

  /* ------------------------------------------------------- dice manipulation */

  const modifySelected = (delta) =>
    commit((d) => {
      const i = selected[0];
      d.dice[i] = Math.max(1, Math.min(6, d.dice[i] + delta));
      return true;
    }, { keepSelection: true });

  const spendForDie = (cost, fn) =>
    commit((d) => {
      if (!pay(d, cost)) return false;
      return fn(d);
    }, { keepSelection: true });

  const rerollAll = (d) => {
    let any = false;
    for (let i = 0; i < 3; i++) {
      if (!d.consumed[i]) { d.dice[i] = d6(d); any = true; }
    }
    return any;
  };

  const useTool = (key, delta = 0) =>
    commit((d) => {
      if (d.tools[key] < 1) return false;
      if (key === 'charm') {
        if (!rerollAll(d)) return false;
      } else {
        if (selected.length !== 1 || d.consumed[selected[0]]) return false;
        const i = selected[0];
        if (key === 'wrench') d.dice[i] = Math.max(1, Math.min(6, d.dice[i] + delta));
        else d.dice[i] = d6(d);
      }
      d.tools[key] -= 1;
      return true;
    }, { keepSelection: true });

  const sacrifice = () =>
    commit((d) => {
      if (d.sacrificeUsed || selected.length !== 2) return false;
      if (!selected.every((i) => !d.consumed[i])) return false;
      consume(d, selected);
      d.sacrificeUsed = true;
      gain(d, 'scrap', 1);
      note(d, 'Stripped two dice for parts (+1 Scrap).');
      return true;
    });

  const scavengeFailed = () =>
    commit((d) => {
      if (!d.rolled || d.consumed.every(Boolean)) return false;
      d.consumed = [true, true, true];
      applyRad(d, 1);
      note(d, 'Scavenge failed — wandered the hot zone (+1 RAD).');
      return true;
    });

  /* ----------------------------------------------------- pre-roll: build/trade */

  const build = (key) =>
    commit((d) => {
      const st = d.structures[key];
      if (st.built || d.rolled || structuresBuilt(d) >= MAX_STRUCTURES) return false;
      // The FIRST structure is ungated — gating both behind a Shelter (3 dice on a
      // 12-18 sum) delayed the economy past the point where daily upkeep could be
      // met, and bot testing died of starvation on day 5 with 0 structures built.
      // Only the second slot costs you a Shelter.
      if (countMarks(d, 'shelter') < structuresBuilt(d)) return false;
      if (!pay(d, structureCost(d, key))) return false;
      st.built = true;
      st.last = d.turn;
      note(d, `Built ${STRUCTURE_DEFS[key].name}.`);
      return true;
    });

  const confirmBarter = () =>
    commit((d) => {
      if (d.barterUsed || barterSpend.length !== 2 || !barterGain) return false;
      const cost = {};
      barterSpend.forEach((r) => { cost[r] = (cost[r] || 0) + 1; });
      if (!pay(d, cost)) return false;
      gain(d, barterGain, 1);
      d.barterUsed = true;
      note(d, `Bartered ${barterSpend.join(' + ')} for 1 ${barterGain}.`);
      setBarterSpend([]);
      setBarterGain(null);
      return true;
    });

  const cleanse = () =>
    commit((d) => {
      if (d.rad < 1 || d.rolled) return false;
      if (!pay(d, { water: 2 })) return false;
      d.rad -= 1;
      note(d, 'Flushed contamination (-1 RAD, -2 Water).');
      return true;
    });

  /* ------------------------------------------------------- upkeep / raid / end */

  const clickResource = (type, index) =>
    commit((d) => {
      const box = d.res[type][index];
      // Derive from the draft rather than the render closure, and refuse the click
      // outright before the dice are spent — the UI already hides it, but the
      // handler should not depend on that.
      if (!allDiceSpent(d) || d.gameOver) return false;

      if (isRaidTurn(d)) {
        const at = d.raidPool.findIndex((p) => p.type === type && p.index === index);
        if (box === 'acquired' && at === -1) {
          if (d.raidPool.length >= raidDemand(d)) return false;
          d.res[type][index] = 'used';
          d.raidPool.push({ type, index });
          return true;
        }
        if (box === 'used' && at > -1) {
          d.res[type][index] = 'acquired';
          d.raidPool.splice(at, 1);
          return true;
        }
        return false;
      }

      if (type !== 'water' && type !== 'food') return false;
      // Upkeep tracks its exact box, so spending Water on a dice modifier can no
      // longer be mistaken for having paid upkeep (the v16 loophole).
      if (box === 'acquired' && !d.upkeepBox) {
        d.res[type][index] = 'used';
        d.upkeepBox = { type, index };
        return true;
      }
      if (box === 'used' && d.upkeepBox && d.upkeepBox.type === type && d.upkeepBox.index === index) {
        d.res[type][index] = 'acquired';
        d.upkeepBox = null;
        return true;
      }
      return false;
    });

  const settleRaid = () =>
    commit((d) => {
      if (!isRaidTurn(d)) return false;
      const need = raidDemand(d);
      if (d.raidPool.length < need) {
        d.gameOver = true;
        d.lost = true;
        d.reason = `The raiders demanded ${need} resources. You handed over ${d.raidPool.length}.`;
        return true;
      }
      d.raidsSettled.push(d.turn);
      note(d, `Paid off the raiders (${need} resources).`);
      return true;
    });

  const endTurn = () =>
    commit((d) => {
      if (d.gameOver || !allDiceSpent(d)) return false;
      if (isRaidTurn(d)) return false;
      if (!d.upkeepBox) {
        d.gameOver = true;
        d.lost = true;
        // Read the draft, not the component's `counts` — that closure is a render
        // behind and would occasionally print the wrong ending.
        d.reason =
          avail(d, 'water') + avail(d, 'food') > 0
            ? `You never ate or drank on day ${d.turn}.`
            : `Day ${d.turn} came with no food and no water left.`;
        return true;
      }
      if (d.turn >= MAX_TURNS) {
        d.gameOver = true;
        note(d, 'You survived the wasteland.');
        return true;
      }
      d.turn += 1;
      d.rolled = false;
      d.dice = [0, 0, 0];
      d.findDie = 0;
      d.consumed = [false, false, false];
      d.upkeepBox = null;
      d.raidPool = [];
      d.barterUsed = false;
      d.sacrificeUsed = false;
      return true;
    });

  const reset = (seed) => {
    const text = (seed ?? seedInput).trim() || 'wasteland';
    setState(createState(text));
    setHistory([]);
    setSelected([]);
    setBarterSpend([]);
    setBarterGain(null);
    setShowBarter(false);
    setShowScrapSet(false);
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen().then(() => setIsFullScreen(true));
    else document.exitFullscreen().then(() => setIsFullScreen(false));
  };

  const css = `
    .custom-scrollbar::-webkit-scrollbar { width: 20px; height: 20px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: #1c1917; border-radius: 10px; }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: #d97706; border-radius: 10px; border: 3px solid #1c1917; }
    .custom-scrollbar { scrollbar-width: thick; scrollbar-color: #d97706 #1c1917; }
    .grid-cols-15 { grid-template-columns: repeat(15, minmax(0, 1fr)); }
    .grid-cols-11 { grid-template-columns: repeat(11, minmax(0, 1fr)); }
    .grid-cols-17 { grid-template-columns: repeat(17, minmax(0, 1fr)); }
  `;

  /* ------------------------------------------------------------------ render */

  const sheetBtn = (marked, enabled, tint) =>
    `rounded flex items-center justify-center font-bold border-2 transition-all ${
      marked
        ? `${tint.on} text-white`
        : enabled
        ? `bg-stone-800 ${tint.hover} border-stone-700 text-stone-400 cursor-pointer`
        : 'bg-stone-800 border-stone-700 text-stone-600 cursor-not-allowed'
    }`;

  const TINT = {
    scrap: { on: 'bg-amber-600 border-amber-400', hover: 'hover:border-amber-500' },
    water: { on: 'bg-blue-600 border-blue-400', hover: 'hover:border-blue-500' },
    food: { on: 'bg-green-600 border-green-400', hover: 'hover:border-green-500' },
    fuel: { on: 'bg-orange-600 border-orange-400', hover: 'hover:border-orange-500' },
    shelter: { on: 'bg-purple-600 border-purple-400', hover: 'hover:border-purple-500' },
    scout: { on: 'bg-cyan-600 border-cyan-400', hover: 'hover:border-cyan-500' },
    fortify: { on: 'bg-gray-500 border-gray-300', hover: 'hover:border-gray-400' },
  };

  return (
    <div ref={containerRef} className="min-h-screen bg-gradient-to-b from-amber-900 via-orange-800 to-red-900 p-4 sm:p-8 overflow-auto custom-scrollbar text-stone-200">
      <style>{css}</style>
      <div className="max-w-7xl mx-auto">

        {/* ------------------------------------------------------------ header */}
        <div className="text-center mb-6 relative">
          <div className="absolute right-0 top-0 flex gap-2">
            <button onClick={undo} disabled={!history.length} title="Undo last action"
              className="p-2 bg-stone-900 border border-amber-700 rounded hover:bg-stone-800 disabled:opacity-30">
              <Undo2 size={20} />
            </button>
            <button onClick={toggleFullScreen} className="p-2 bg-stone-900 border border-amber-700 rounded hover:bg-stone-800">
              {isFullScreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-amber-100 mb-2 tracking-wider drop-shadow-md">WASTELAND SCAVENGER</h1>
          <p className="text-amber-200">A Dice Allocation Game of Survival · v17</p>
        </div>

        {/* ------------------------------------------------------------- setup */}
        {s.phase === 'setup' && (
          <div className="bg-stone-900 border-4 border-green-600 rounded-lg p-8 mb-6 text-center">
            <div className="text-3xl font-bold text-green-400 mb-3">☢️ SURVEY THE WASTELAND</div>
            <p className="text-stone-300 mb-6 max-w-2xl mx-auto">
              Three exploration zones are irradiated — one in the near stretch (3–7), one in the
              middle (8–12), one deep out (13–18). Enter a seed to play a specific wasteland, or
              leave it blank for the default.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-6">
              <input
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                placeholder="seed (optional)"
                className="px-4 py-3 bg-stone-800 border border-stone-600 rounded text-amber-100 placeholder-stone-500 w-full sm:w-64"
              />
              <button onClick={() => reset()} className="px-5 py-3 bg-stone-700 hover:bg-stone-600 rounded font-bold text-amber-100 w-full sm:w-auto">
                Use Seed
              </button>
            </div>
            <div className="text-xs text-stone-500 mb-4">Current seed: <span className="text-amber-400 font-mono">{s.seedText}</span></div>
            <button onClick={() => commit(setupZones, { undoable: false })} className="px-8 py-4 bg-green-700 hover:bg-green-600 text-white font-bold text-xl rounded-lg shadow-lg">
              🎲 Begin
            </button>
          </div>
        )}

        {s.phase === 'play' && (
        <>
          {/* ------------------------------------------------- turn / rad / res */}
          <div className="bg-stone-900 border-2 border-amber-700 rounded-lg p-4 mb-6">
            <div className="flex flex-wrap justify-between items-center gap-4 mb-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="bg-stone-800 px-4 py-2 rounded border border-stone-600">
                  <span className="text-amber-100 text-sm block">Day</span>
                  <span className="text-2xl text-amber-400 font-bold">{s.turn}/{MAX_TURNS}</span>
                </div>
                <div className="bg-stone-800 px-4 py-2 rounded border border-red-900">
                  <div className="flex items-center gap-2">
                    <Skull className="text-red-500" size={16} />
                    <span className="text-amber-100 text-sm">Rad {s.rad}/{RAD_DEATH}</span>
                  </div>
                  <div className="flex gap-1 mt-1">
                    {[...Array(RAD_DEATH)].map((_, i) => (
                      <div key={i} className={`w-4 h-2 rounded-sm ${i < s.rad ? 'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]' : 'bg-stone-700'}`} />
                    ))}
                  </div>
                </div>
                <div className="bg-stone-800 px-4 py-2 rounded border border-cyan-900">
                  <div className="flex items-center gap-2 text-cyan-300 text-sm"><Binoculars size={14} /> Scout tokens</div>
                  <div className="text-xl font-bold text-cyan-200">{s.scoutTokens}<span className="text-xs text-stone-500">/3</span></div>
                </div>
                <button
                  onClick={cleanse}
                  disabled={s.rad < 1 || s.rolled || counts.water < 2}
                  className="px-3 py-2 bg-emerald-900/60 border border-emerald-700 rounded text-xs text-emerald-200 hover:bg-emerald-800 disabled:opacity-30"
                >
                  <Radiation size={14} className="inline mr-1" />
                  2 Water → −1 Rad
                  <div className="text-[10px] text-emerald-400/70">pre-roll</div>
                </button>
              </div>
              <div className="text-right">
                <div className="text-xs text-stone-500">Running score</div>
                <div className="text-3xl font-black text-amber-400">{scoreTotal(s)}</div>
              </div>
            </div>

            {/* day strip */}
            <div className="grid grid-cols-12 gap-1 mb-4">
              {[...Array(MAX_TURNS)].map((_, i) => {
                const t = i + 1;
                const done = t < s.turn || (s.gameOver && t === s.turn);
                const cur = t === s.turn && !s.gameOver;
                const raid = !!RAID_TURNS[t];
                return (
                  <div key={i} className={`h-9 rounded flex flex-col items-center justify-center text-xs font-bold relative ${
                    done ? 'bg-green-800 text-green-200' : cur ? 'bg-amber-500 text-black ring-2 ring-white' : 'bg-stone-800 text-stone-600'
                  }`}>
                    {t}
                    {raid && (
                      <span className="absolute -top-1 -right-1 flex items-center">
                        <Swords size={11} className="text-red-400" />
                        <span className="text-[9px] text-red-300 font-black">{RAID_TURNS[t]}</span>
                      </span>
                    )}
                    <span className="text-[8px] opacity-70">upkeep</span>
                  </div>
                );
              })}
            </div>

            {/* resource tracks */}
            <div className="space-y-3">
              {RES_KEYS.map((k) => {
                const label = { water: 'Water', food: 'Food', scrap: 'Scrap', fuel: 'Fuel' }[k];
                const tint = { water: 'text-blue-400', food: 'text-green-400', scrap: 'text-amber-400', fuel: 'text-orange-400' }[k];
                const payingRaid = raidActive;
                const payingUpkeep = !raidActive && canEnd && (k === 'water' || k === 'food');
                const clickable = !s.gameOver && (payingRaid || payingUpkeep);
                return (
                  <div key={k} className="flex items-center gap-2">
                    <div className="w-20 flex-shrink-0 text-right">
                      <div className={`font-bold ${tint}`}>{label}</div>
                      <div className="text-sm text-stone-300">({counts[k]}) · {RES_VP[k]}vp</div>
                    </div>
                    <div className="grid grid-cols-15 gap-1.5 flex-grow">
                      {s.res[k].map((st, i) => (
                        <ResourceCheckbox
                          key={i}
                          type={k}
                          state={st}
                          clickable={clickable}
                          highlight={s.upkeepBox && s.upkeepBox.type === k && s.upkeepBox.index === i}
                          onClick={() => clickResource(k, i)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* --------------------------------------------- toolbelt / structures */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-cyan-950/50 border border-cyan-800 rounded p-3">
              <div className="text-xs text-cyan-300 font-bold mb-2 uppercase tracking-wider">Toolbelt</div>
              <div className="flex flex-col gap-1">
                {Object.entries(TOOL_DEFS).map(([k, def]) => (
                  <div key={k} className={`text-xs ${s.tools[k] > 0 ? 'text-cyan-100' : 'text-stone-500'}`}>
                    <strong>{def.name}:</strong> {def.effect} — {s.tools[k]}/{def.cap} uses
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-stone-800 border border-stone-700 p-3 rounded">
              <div className="text-xs text-stone-400 font-bold mb-2 uppercase tracking-wider">
                Structures {structuresBuilt(s)}/{MAX_STRUCTURES}
              </div>
              <div className="flex flex-col gap-1">
                {Object.entries(s.structures).filter(([, x]) => x.built).map(([k]) => (
                  <div key={k} className="text-xs bg-purple-900 border border-purple-500 text-white p-1 rounded">
                    <strong>{STRUCTURE_DEFS[k].name}:</strong> <span className="text-purple-200">{STRUCTURE_DEFS[k].effect}</span>
                  </div>
                ))}
                {structuresBuilt(s) === 0 && <div className="text-xs text-stone-500 italic">None yet — build one pre-roll.</div>}
              </div>
            </div>
            <div className="bg-stone-800 border border-stone-700 p-3 rounded">
              <div className="text-xs text-stone-400 font-bold mb-2 uppercase tracking-wider">Log</div>
              <div className="flex flex-col gap-0.5 max-h-24 overflow-y-auto custom-scrollbar">
                {s.log.length === 0 && <div className="text-xs text-stone-500 italic">Nothing yet.</div>}
                {[...s.log].reverse().map((l, i) => (
                  <div key={i} className={`text-[11px] leading-tight ${i === 0 ? 'text-amber-200' : 'text-stone-500'}`}>{l}</div>
                ))}
              </div>
            </div>
          </div>

          {/* ------------------------------------------------------------ dice */}
          <div className="bg-stone-800 border-2 border-stone-600 rounded-lg p-6 mb-6 shadow-xl">
            <div className="flex flex-col items-center gap-5">
              <div className="flex flex-wrap gap-4 justify-center">
                {s.dice.map((die, i) => (
                  <div key={i} onClick={() => toggleDie(i)}
                    className={`w-20 h-20 rounded-xl flex items-center justify-center text-4xl font-black border-4 transition-all
                      ${s.consumed[i] ? 'bg-stone-900 text-stone-700 border-stone-700 opacity-50'
                        : !s.rolled ? 'bg-stone-700 text-stone-600 border-stone-600'
                        : 'bg-amber-500 text-stone-900 border-amber-300 shadow-[0_4px_0_#78350f] cursor-pointer'}
                      ${selected.includes(i) && !s.consumed[i] ? 'ring-4 ring-white scale-110 z-10' : ''}`}>
                    {s.rolled ? die : '?'}
                  </div>
                ))}
                <div className="flex flex-col items-center">
                  <div className={`w-20 h-20 rounded-xl flex items-center justify-center text-4xl font-black border-4
                    ${s.findDie === 0 ? 'bg-stone-700 text-stone-600 border-stone-600' : 'bg-cyan-700 text-white border-cyan-400'}`}>
                    {s.findDie > 0 ? s.findDie : '?'}
                  </div>
                  <span className="text-xs text-cyan-300 font-bold mt-1">Find Die</span>
                </div>
              </div>

              {s.rolled && selected.length > 0 && (
                <div className="text-lg text-white font-bold bg-stone-900/50 px-4 py-2 rounded-lg">
                  Selected: {selectedVals.join(' · ')} — Sum {selectedSum}
                </div>
              )}

              {!s.rolled && !s.gameOver && (
                <div className="flex gap-2 w-full sm:w-auto flex-col sm:flex-row">
                  <button onClick={() => setShowBarter((v) => !v)} disabled={s.barterUsed}
                    className="px-6 py-3 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 rounded font-bold shadow text-white">
                    {s.barterUsed ? 'Bartered' : showBarter ? 'Hide Barter' : 'Barter'}
                  </button>
                  <button onClick={() => commit(rollDice)} className="px-12 py-3 bg-amber-600 hover:bg-amber-500 text-stone-900 text-xl font-black rounded shadow-lg hover:scale-105 transition-all flex-grow">
                    ROLL DICE
                  </button>
                </div>
              )}

              {s.rolled && !canEnd && !s.gameOver && (
                <div className="w-full max-w-3xl bg-stone-900/50 rounded-lg p-3 border border-stone-700">
                  <div className="text-xs text-stone-500 text-center mb-2 font-mono uppercase">
                    Dice Modifiers {one ? '' : '— select exactly one die'}
                  </div>

                  {!showScrapSet ? (
                    <>
                      <div className="flex flex-wrap justify-center gap-2">
                        <button disabled={counts.water < 1 || !one} onClick={() => spendForDie({ water: 1 }, (d) => { d.dice[selected[0]] = Math.min(6, d.dice[selected[0]] + 1); return true; })}
                          className="flex items-center gap-1 px-2 py-1 bg-blue-900/40 border border-blue-800 hover:bg-blue-800 disabled:opacity-30 text-xs rounded text-blue-200">
                          <Droplet size={12} /> −1 Water: +1 Die
                        </button>
                        <button disabled={counts.water < 1 || !one} onClick={() => spendForDie({ water: 1 }, (d) => { d.dice[selected[0]] = Math.max(1, d.dice[selected[0]] - 1); return true; })}
                          className="flex items-center gap-1 px-2 py-1 bg-blue-900/40 border border-blue-800 hover:bg-blue-800 disabled:opacity-30 text-xs rounded text-blue-200">
                          <Droplet size={12} /> −1 Water: −1 Die
                        </button>
                        <button disabled={counts.food < 1 || !one} onClick={() => spendForDie({ food: 1 }, (d) => { d.dice[selected[0]] = d6(d); return true; })}
                          className="flex items-center gap-1 px-2 py-1 bg-green-900/40 border border-green-800 hover:bg-green-800 disabled:opacity-30 text-xs rounded text-green-200">
                          <Package size={12} /> −1 Food: Reroll Die
                        </button>
                        <button disabled={counts.scrap < 1 || !one} onClick={() => setShowScrapSet(true)}
                          className="flex items-center gap-1 px-2 py-1 bg-amber-900/40 border border-amber-800 hover:bg-amber-800 disabled:opacity-30 text-xs rounded text-amber-200">
                          <Wrench size={12} /> −1 Scrap: Set Die
                        </button>
                        <button disabled={counts.fuel < 1 || !anyUnspent} onClick={() => spendForDie({ fuel: 1 }, rerollAll)}
                          className="flex items-center gap-1 px-2 py-1 bg-orange-900/40 border border-orange-800 hover:bg-orange-800 disabled:opacity-30 text-xs rounded text-orange-200">
                          <Flame size={12} /> −1 Fuel: Reroll All
                        </button>
                      </div>

                      <div className="h-px bg-stone-700 my-2" />

                      <div className="flex flex-wrap justify-center gap-2">
                        <button disabled={s.tools.wrench < 1 || !one} onClick={() => useTool('wrench', 1)}
                          className="flex items-center gap-1 px-2 py-1 bg-cyan-900/40 border border-cyan-800 hover:bg-cyan-800 disabled:opacity-30 text-xs rounded text-cyan-200">
                          <Wrench size={12} /> Wrench +1
                        </button>
                        <button disabled={s.tools.wrench < 1 || !one} onClick={() => useTool('wrench', -1)}
                          className="flex items-center gap-1 px-2 py-1 bg-cyan-900/40 border border-cyan-800 hover:bg-cyan-800 disabled:opacity-30 text-xs rounded text-cyan-200">
                          <Wrench size={12} /> Wrench −1
                        </button>
                        <button disabled={s.tools.multitool < 1 || !one} onClick={() => useTool('multitool')}
                          className="flex items-center gap-1 px-2 py-1 bg-cyan-900/40 border border-cyan-800 hover:bg-cyan-800 disabled:opacity-30 text-xs rounded text-cyan-200">
                          <Wrench size={12} /> Multitool: Reroll
                        </button>
                        <button disabled={s.tools.charm < 1 || !anyUnspent} onClick={() => useTool('charm')}
                          className="flex items-center gap-1 px-2 py-1 bg-cyan-900/40 border border-cyan-800 hover:bg-cyan-800 disabled:opacity-30 text-xs rounded text-cyan-200">
                          <Zap size={12} /> Charm: Reroll All
                        </button>
                      </div>

                      <div className="h-px bg-stone-700 my-2" />
                      <div className="flex flex-wrap justify-center items-center gap-3">
                        <button disabled={s.sacrificeUsed || selected.length !== 2 || !selectionLive} onClick={sacrifice}
                          className="flex items-center gap-1 px-3 py-1.5 bg-stone-700 border border-stone-500 hover:bg-stone-600 disabled:opacity-30 text-xs rounded text-stone-200">
                          <Wrench size={12} /> Strip 2 dice for +1 Scrap
                        </button>
                        <span className="text-[11px] text-stone-500">
                          {s.sacrificeUsed ? 'Already stripped this turn.' : 'Once per turn — a safety valve, not a plan.'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="text-center">
                      <div className="text-sm text-amber-200 mb-2">Set the selected die to:</div>
                      <div className="flex flex-wrap justify-center gap-2">
                        {[1, 2, 3, 4, 5, 6].map((v) => (
                          <button key={v} onClick={() => spendForDie({ scrap: 1 }, (d) => { d.dice[selected[0]] = v; return true; })}
                            className="w-10 h-10 rounded bg-stone-700 hover:bg-amber-600 hover:text-black font-bold text-white">{v}</button>
                        ))}
                      </div>
                      <button onClick={() => setShowScrapSet(false)} className="text-xs text-stone-400 hover:text-white mt-3">Cancel</button>
                    </div>
                  )}
                </div>
              )}

              {s.rolled && !canEnd && !s.gameOver && (
                <div className="flex gap-4 w-full justify-between items-center border-t border-stone-700 pt-4">
                  <button onClick={scavengeFailed} className="text-red-400 hover:text-red-300 text-sm flex items-center gap-1 px-3 py-2 hover:bg-stone-700 rounded">
                    <Skull size={16} /> Scavenge Failed (burn remaining dice, +1 Rad)
                  </button>
                  <div className="text-stone-500 text-sm italic">Every die must go somewhere…</div>
                </div>
              )}

              {/* raid */}
              {raidActive && !s.gameOver && (
                <div className="text-center p-4 bg-red-950 border-2 border-red-500 rounded-lg w-full max-w-2xl">
                  <h3 className="text-xl font-bold text-red-100 mb-1 flex items-center justify-center gap-2">
                    <Swords size={20} /> RAIDERS — DAY {s.turn}
                  </h3>
                  <p className="text-red-200 text-sm mb-1">
                    They demand <strong>{raidBase(s)}</strong>. Your {countMarks(s, 'shelter')} shelter(s) and{' '}
                    {fortifyDefense(s)} fortification(s) knock it down to <strong>{demand}</strong>
                    {raidBase(s) - demand < countMarks(s, 'shelter') + fortifyDefense(s) && (
                      <span className="text-red-400"> (reduction capped at half)</span>
                    )}.
                  </p>
                  <p className="text-red-200 mb-3">Click any resource boxes to pay: <strong>{raidPaid} / {demand}</strong></p>
                  <button onClick={settleRaid} disabled={raidPaid < demand}
                    className="px-6 py-2 bg-red-600 hover:bg-red-500 disabled:bg-stone-700 disabled:cursor-not-allowed text-white font-bold rounded">
                    Hand It Over
                  </button>
                </div>
              )}

              {/* upkeep */}
              {upkeepDue && !raidActive && (
                <div className="text-center p-4 bg-green-950 border-2 border-green-600 rounded-lg w-full max-w-2xl">
                  <h3 className="text-xl font-bold text-green-100 mb-1">UPKEEP — DAY {s.turn}</h3>
                  <p className="text-green-200 text-sm">
                    Spend <strong>1 Food or Water</strong> to see tomorrow. Click a slashed box in your Food or Water track.
                  </p>
                  {counts.water + counts.food === 0 && (
                    <p className="text-red-300 text-sm mt-2 font-bold">Nothing left to consume. This is the end.</p>
                  )}
                </div>
              )}

              {canEnd && !s.gameOver && !raidActive && (
                <button onClick={endTurn}
                  className="px-12 py-4 bg-red-700 hover:bg-red-600 text-white text-xl font-black rounded shadow-lg hover:scale-105 transition-all">
                  {s.upkeepBox ? (s.turn >= MAX_TURNS ? 'FINISH' : 'END DAY') : 'END DAY (unpaid upkeep = death)'}
                </button>
              )}
            </div>
          </div>

          {/* ---------------------------------------------------------- barter */}
          {showBarter && !s.rolled && !s.barterUsed && (
            <div className="bg-blue-950/50 border-2 border-blue-800 rounded-lg p-4 mb-6">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-xl font-bold text-blue-200">Barter — once per day, pre-roll</h2>
                <button onClick={() => { setShowBarter(false); setBarterSpend([]); setBarterGain(null); }} className="text-blue-200 font-bold text-2xl">✕</button>
              </div>
              <p className="text-sm text-blue-200 mb-3">Give up any <strong>2</strong> resources for <strong>1</strong> of your choice.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-stone-900/50 p-3 rounded">
                  <h3 className="font-bold text-white mb-2">1. Spend 2</h3>
                  <div className="flex flex-wrap gap-2">
                    {RES_KEYS.map((k) => (
                      <button key={k}
                        disabled={barterSpend.length >= 2 || counts[k] <= barterSpend.filter((r) => r === k).length}
                        onClick={() => setBarterSpend((p) => [...p, k])}
                        className="px-3 py-2 bg-stone-800 border border-stone-600 hover:bg-stone-700 disabled:opacity-30 text-xs rounded capitalize text-stone-200">
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bg-stone-900/50 p-3 rounded">
                  <h3 className="font-bold text-white mb-2">2. Gain 1</h3>
                  <div className="flex flex-wrap gap-2">
                    {RES_KEYS.map((k) => (
                      <button key={k} onClick={() => setBarterGain(k)}
                        className={`px-3 py-2 border text-xs rounded capitalize ${barterGain === k ? 'bg-blue-700 border-blue-400 text-white' : 'bg-stone-800 border-stone-600 text-stone-200 hover:bg-stone-700'}`}>
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="bg-stone-900/50 p-3 rounded">
                  <h3 className="font-bold text-white mb-2">3. Confirm</h3>
                  <div className="text-sm text-stone-400 mb-1 capitalize">Give: {barterSpend.join(', ') || '—'}</div>
                  <div className="text-sm text-stone-400 mb-2 capitalize">Get: {barterGain || '—'}</div>
                  <button disabled={barterSpend.length !== 2 || !barterGain} onClick={confirmBarter}
                    className="w-full px-3 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-30 text-sm rounded text-white font-bold">
                    Trade
                  </button>
                  <button onClick={() => { setBarterSpend([]); setBarterGain(null); }} className="w-full text-xs text-stone-400 hover:text-white mt-2">Reset</button>
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------ structures */}
          <div className="bg-purple-950/50 border-2 border-purple-800 rounded-lg p-4 mb-6">
            <div className="flex flex-wrap justify-between items-baseline gap-2 mb-1">
              <h2 className="text-2xl font-bold text-purple-200">Build (pre-roll)</h2>
              <span className="text-sm text-purple-300">
                Max {MAX_STRUCTURES} · build the first whenever you can afford it · the second also needs a marked
                Shelter (you have {countMarks(s, 'shelter')}) and costs +1
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
              {Object.entries(STRUCTURE_DEFS).map(([key, def]) => {
                const st = s.structures[key];
                const cost = structureCost(s, key);
                const gated = countMarks(s, 'shelter') < structuresBuilt(s);
                const full = structuresBuilt(s) >= MAX_STRUCTURES;
                const ok = !st.built && !s.rolled && !gated && !full && canPay(s, cost);
                return (
                  <div key={key} className={`p-4 rounded-lg border-2 flex flex-col justify-between ${st.built ? 'bg-purple-900 border-purple-600' : 'bg-stone-900 border-purple-800'} ${s.rolled ? 'opacity-50' : ''}`}>
                    <div>
                      <h3 className="font-bold text-lg text-white mb-1">{def.name}</h3>
                      <p className="text-sm text-purple-200 mb-2">{def.effect}</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs text-stone-400">COST:</span>
                        <RenderCost cost={cost} />
                      </div>
                      {st.built ? (
                        <button disabled className="w-full py-2 rounded font-bold bg-green-800 text-green-300 border border-green-700">✓ BUILT</button>
                      ) : (
                        <button disabled={!ok} onClick={() => build(key)}
                          className="w-full py-2 rounded font-bold bg-purple-700 text-white hover:bg-purple-600 disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed">
                          {full ? 'No capacity' : gated ? 'Need a Shelter' : 'Build'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ----------------------------------------------------- game sheet */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            <Panel className="border-amber-900">
              <h3 className="text-amber-400 font-bold mb-1 flex items-center gap-2"><Wrench size={18} /> Scrap · 1 die</h3>
              <p className="text-xs text-amber-200/70 mb-3">One die showing N. +1 Scrap, 3 VP.</p>
              <div className="grid grid-cols-6 gap-2">
                {[1, 2, 3, 4, 5, 6].map((n, i) => {
                  const ok = s.rolled && one && selectedVals[0] === n && !s.marks.scrap[i];
                  return (
                    <button key={i} disabled={!ok} onClick={() => markScrap(i)}
                      className={`aspect-square text-lg ${sheetBtn(s.marks.scrap[i], ok, TINT.scrap)}`}>{n}</button>
                  );
                })}
              </div>
            </Panel>

            <Panel className="border-gray-700">
              <h3 className="text-gray-300 font-bold mb-1 flex items-center gap-2"><Shield size={18} /> Fortify · 1 die (any value)</h3>
              <p className="text-xs text-gray-300/70 mb-3">
                Marks in order. First 3 cut every raid's demand by 1 each. 2 VP per box, +10 for all four.
              </p>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {s.marks.fortify.map((m, i) => (
                  <div key={i} className={`h-12 rounded flex items-center justify-center font-bold border-2 text-xs ${m ? 'bg-gray-500 border-gray-300 text-white' : 'bg-stone-800 border-stone-700 text-stone-600'}`}>
                    {i < 3 ? '−1 raid' : '+10 VP'}
                  </div>
                ))}
              </div>
              <button
                disabled={!s.rolled || !one || countMarks(s, 'fortify') >= 4}
                onClick={markFortify}
                className="w-full py-2 rounded font-bold bg-gray-600 hover:bg-gray-500 text-white disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed">
                {countMarks(s, 'fortify') >= 4 ? 'Fortifications complete' : 'Spend selected die to fortify'}
              </button>
            </Panel>

            <Panel className="border-blue-900">
              <h3 className="text-blue-400 font-bold mb-1 flex items-center gap-2"><Droplet size={18} /> Water · 2 dice</h3>
              <p className="text-xs text-blue-200/70 mb-3">A matching pair. +1 Water, 7 VP.</p>
              <div className="grid grid-cols-6 gap-2">
                {[1, 2, 3, 4, 5, 6].map((n, i) => {
                  const ok = s.rolled && selectionLive && selected.length === 2 && selectedVals.every((v) => v === n) && !s.marks.water[i];
                  return (
                    <button key={i} disabled={!ok} onClick={() => markWater(i)}
                      className={`aspect-square text-lg ${sheetBtn(s.marks.water[i], ok, TINT.water)}`}>{n}{n}</button>
                  );
                })}
              </div>
            </Panel>

            <Panel className="border-green-900">
              <h3 className="text-green-400 font-bold mb-1 flex items-center gap-2"><Package size={18} /> Food · 3 dice</h3>
              <p className="text-xs text-green-200/70 mb-3">A run of three. +1 Food, 11 VP.</p>
              <div className="grid grid-cols-4 gap-2">
                {['1-2-3', '2-3-4', '3-4-5', '4-5-6'].map((l, i) => {
                  const sorted = [...selectedVals].sort((a, b) => a - b);
                  const ok = s.rolled && selectionLive && selected.length === 3 && !s.marks.food[i]
                    && sorted[0] === i + 1 && sorted[1] === sorted[0] + 1 && sorted[2] === sorted[1] + 1;
                  return (
                    <button key={i} disabled={!ok} onClick={() => markFood(i)}
                      className={`h-12 text-sm ${sheetBtn(s.marks.food[i], ok, TINT.food)}`}>{l}</button>
                  );
                })}
              </div>
            </Panel>

            <Panel className="border-orange-900">
              <h3 className="text-orange-400 font-bold mb-1 flex items-center gap-2"><Flame size={18} /> Fuel · 3 dice</h3>
              <p className="text-xs text-orange-200/70 mb-3">
                At least <strong>two</strong> dice showing N, and all three inside N's range (e.g. <strong>3-3-4</strong>{' '}
                marks 3). +1 Fuel, 12 VP. Every box is equally likely — 7 in 216.
              </p>
              <div className="grid grid-cols-6 gap-2">
                {[1, 2, 3, 4, 5, 6].map((n, i) => {
                  const ok = s.rolled && selectionLive && selected.length === 3 && fuelMatches(selectedVals, n) && !s.marks.fuel[i];
                  const [lo, hi] = fuelWindow(n);
                  return (
                    <button key={i} disabled={!ok} onClick={() => markFuel(i)}
                      className={`aspect-square flex-col text-lg ${sheetBtn(s.marks.fuel[i], ok, TINT.fuel)}`}>
                      <span>{n}</span>
                      <span className="text-[9px] font-normal opacity-70">{lo}–{hi}</span>
                    </button>
                  );
                })}
              </div>
            </Panel>

            <Panel className="border-cyan-900">
              <h3 className="text-cyan-400 font-bold mb-1 flex items-center gap-2"><Binoculars size={18} /> Scout · 2 dice</h3>
              <p className="text-xs text-cyan-200/70 mb-3">
                Sum of two dice. 7 VP and +1 Scout token (tokens keep across days; up to 2 are auto-spent per Find roll).
              </p>
              <div className="grid grid-cols-11 gap-1.5">
                {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n, i) => {
                  const ok = s.rolled && selectionLive && selected.length === 2 && selectedSum === n && !s.marks.scout[i];
                  return (
                    <button key={i} disabled={!ok} onClick={() => markScout(i)}
                      className={`aspect-square text-sm ${sheetBtn(s.marks.scout[i], ok, TINT.scout)}`}>{n}</button>
                  );
                })}
              </div>
            </Panel>

            <Panel className="border-purple-900 lg:col-span-2">
              <h3 className="text-purple-400 font-bold mb-1 flex items-center gap-2"><Home size={18} /> Shelter · 3 dice</h3>
              <p className="text-xs text-purple-200/70 mb-3">
                Sum of all three dice, 12–18. 15 VP each, −1 to every raid's demand, and each one unlocks a Structure slot.
              </p>
              <div className="grid grid-cols-7 gap-2">
                {[12, 13, 14, 15, 16, 17, 18].map((n, i) => {
                  const ok = s.rolled && selectionLive && selected.length === 3 && selectedSum === n && !s.marks.shelter[i];
                  return (
                    <button key={i} disabled={!ok} onClick={() => markShelter(i)}
                      className={`aspect-square text-lg ${sheetBtn(s.marks.shelter[i], ok, TINT.shelter)}`}>{n}</button>
                  );
                })}
              </div>
            </Panel>

            <Panel className="border-cyan-900 lg:col-span-2">
              <div className="flex flex-col lg:flex-row justify-between gap-4">
                <div>
                  <h3 className="text-cyan-400 font-bold mb-1 flex items-center gap-2"><Map size={18} /> Exploration · 1–3 dice</h3>
                  <p className="text-xs text-cyan-200/70 mb-2 max-w-xl">
                    Zones must be taken in order, and your selected dice must sum <strong>exactly</strong> to the zone
                    number. <strong>Each zone scores its own number</strong> — zone 14 is worth 14 VP. Bonus at 5 / 8 / 11
                    zones: +10 / +20 / +35.
                  </p>
                  <p className="text-xs text-cyan-200/70">
                    Marking a zone rolls the Find Die (target 6, minus Scout tokens). ☢️ zones cost 1 Rad but
                    <strong> guarantee</strong> a Treasure roll. 💎 zones 6/12/17 also give one.
                  </p>
                </div>
                <div className="flex gap-3 flex-shrink-0">
                  <div className="text-xs bg-stone-800 p-2 rounded border border-stone-600">
                    <h4 className="font-bold text-white mb-1 text-center">Find (1d6)</h4>
                    <p>1: nothing</p><p>2–3: +1 Scrap</p><p>4: +1 Food</p><p>5: +1 Water</p><p>6: +1 Fuel</p>
                  </div>
                  <div className="text-xs bg-stone-800 p-2 rounded border border-stone-600">
                    <h4 className="font-bold text-white mb-1 text-center">Treasure (1d6)</h4>
                    <p>1: nothing</p><p>2–3: +2 Food, +2 Scrap</p><p>4: +3 Wrench</p><p>5: +2 Multitool</p><p>6: +1 Charm</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-9 lg:grid-cols-17 gap-1.5 mt-3">
                {[...Array(17)].map((_, i) => {
                  const zone = i + 2;
                  const rad = s.radZones.includes(i);
                  const marked = s.marks.zones[i];
                  const isNext = nextZone === i;
                  const treasure = TREASURE_ZONES.includes(zone);
                  const ok = s.rolled && isNext && selectionLive && selectedSum === zone;
                  return (
                    <button key={i} disabled={!ok} onClick={() => markZone(i)}
                      className={`h-14 rounded flex flex-col items-center justify-center font-bold border-2 transition-all relative text-sm
                        ${marked ? (rad ? 'bg-red-700 border-red-400 text-white' : 'bg-cyan-700 border-cyan-400 text-white')
                          : ok ? 'bg-amber-500 border-white text-black animate-pulse cursor-pointer'
                          : isNext ? 'bg-stone-700 border-white text-white'
                          : 'bg-stone-800 border-stone-700 text-stone-600'}`}>
                      <span>{zone}</span>
                      <span className="text-[9px] font-normal opacity-70">{zone} vp</span>
                      {rad && <Skull size={11} className={`absolute top-0.5 right-0.5 ${marked ? 'text-black' : 'text-red-400'}`} />}
                      {treasure && <Diamond size={11} className={`absolute bottom-0.5 right-0.5 ${marked ? 'text-black' : 'text-yellow-400'}`} />}
                    </button>
                  );
                })}
              </div>
              <div className="text-xs text-stone-400 mt-2">
                Explored {countMarks(s, 'zones')}/17 · next zone needs a sum of{' '}
                <strong className="text-amber-300">{nextZone === -1 ? '—' : nextZone + 2}</strong>
              </div>
            </Panel>
          </div>

          {/* ----------------------------------------------------------- rules */}
          <div className="mt-8 bg-stone-900/80 border-2 border-amber-900 rounded-lg p-6">
            <h3 className="text-2xl font-bold text-amber-100 mb-4">How to Play (v17)</h3>
            <div className="text-amber-200 text-sm space-y-4">
              <p className="font-bold text-base">
                <strong>GOAL:</strong> survive 12 days and score as high as you can. You start with 2 Food and 2 Water — four days of buffer to get an economy running.
                140 is a decent run; 200 is strong; 260+ is exceptional.
              </p>

              <div>
                <strong className="text-amber-100">EACH DAY</strong>
                <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                  <li><strong>Pre-roll:</strong> optionally Barter (once/day), Build (max 2 — the second needs a marked Shelter), or flush radiation (2 Water → −1 Rad).</li>
                  <li><strong>Roll</strong> 3 dice. Structures produce now.</li>
                  <li><strong>Modify</strong> dice by spending resources or tools — select exactly one die first.</li>
                  <li><strong>Allocate</strong> every die. Select dice, then click a legal box; legal boxes light up amber.</li>
                  <li><strong>Pay upkeep:</strong> 1 Food or Water, <em>every single day</em>. Click a slashed box in that track.</li>
                  <li><strong>End Day.</strong> Stuck? "Scavenge Failed" burns the rest of your dice for 1 Rad.</li>
                </ul>
              </div>

              <div>
                <strong className="text-red-400">RAIDERS — DAYS 4, 8 AND 12</strong>
                <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                  <li>They demand <strong>2</strong>, then <strong>4</strong>, then <strong>6</strong> resources of any kind.</li>
                  <li>Each marked Shelter and each of your first 3 Fortify boxes cuts the demand by 1 — but the total
                    reduction is capped at <strong>half</strong> the demand, so a raid always costs you something.</li>
                  <li>Come up short and you die. Pay the raid <em>and</em> that day's upkeep.</li>
                </ul>
              </div>

              <div>
                <strong className="text-red-400">RADIATION</strong>
                <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                  <li>Three zones are hot — one each in the 3–7, 8–12 and 13–18 stretches. You can see them from the start.</li>
                  <li>Entering one costs 1 Rad but <strong>guarantees a Treasure roll</strong>. Exploration is strictly in
                    order, so a hot zone is a gate you choose to force or stop at.</li>
                  <li>Failing a scavenge also costs 1 Rad. Each Rad is −10 VP. The <strong>4th kills you</strong>.</li>
                  <li>Pre-roll, 2 Water clears 1 Rad.</li>
                </ul>
              </div>

              <div>
                <strong className="text-amber-100">THE SHEET</strong>
                <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                  <li><strong>Scrap</strong> (1 die = N): +1 Scrap, 3 VP.</li>
                  <li><strong>Fortify</strong> (1 die, any value): fills in order. 2 VP each, +10 for all four, −1 per raid.</li>
                  <li><strong>Water</strong> (2 dice, pair): +1 Water, 7 VP.</li>
                  <li><strong>Scout</strong> (2 dice, sum): 7 VP, +1 Scout token.</li>
                  <li><strong>Food</strong> (3 dice, run): +1 Food, 11 VP.</li>
                  <li><strong>Fuel</strong> (3 dice, two of a kind plus a neighbour): +1 Fuel, 12 VP.</li>
                  <li><strong>Shelter</strong> (3 dice, sum 12–18): 15 VP, −1 per raid, unlocks a Structure slot.</li>
                  <li><strong>Exploration</strong> (1–3 dice, exact sum, in order): scores the zone's own number.</li>
                </ul>
              </div>

              <div>
                <strong className="text-amber-100">STOCK VALUES AT SCORING</strong>
                <p className="ml-4">Water 3 · Food 4 · Scrap 2 · Fuel 5. Anything you spend is VP you gave up — that is
                  the real cost of upkeep and raiders.</p>
              </div>

              <div>
                <strong className="text-stone-400">SEEDS &amp; UNDO</strong>
                <p className="ml-4">
                  All randomness comes from the seed (<span className="font-mono text-amber-400">{s.seedText}</span>), so
                  the same seed is the same wasteland — you and a friend can compare scores on identical rolls. Undo
                  rewinds the dice stream too, so undoing a bad roll and redoing it gives the same numbers. It's for
                  misclicks, not for fishing.
                </p>
              </div>
            </div>
          </div>
        </>
        )}

        {/* --------------------------------------------------------- end screen */}
        {s.gameOver && (
          <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 overflow-auto custom-scrollbar ${s.lost ? 'bg-red-950/95' : 'bg-stone-950/95'}`}>
            <div className="max-w-2xl w-full py-8">
              <div className="text-center mb-6">
                {s.lost ? <Skull className="w-20 h-20 mx-auto text-red-500 mb-3" /> : <Home className="w-20 h-20 mx-auto text-amber-400 mb-3" />}
                <h2 className={`text-4xl font-black mb-2 ${s.lost ? 'text-red-100' : 'text-amber-100'}`}>
                  {s.lost ? 'WASTED' : 'YOU MADE IT'}
                </h2>
                {s.lost && <p className="text-lg text-red-200 mb-2">{s.reason}</p>}
                <div className="text-5xl font-black text-amber-400 mt-4">{scoreTotal(s)}</div>
                <div className="text-lg tracking-widest text-amber-200 mt-1">{parLabel(scoreTotal(s))}</div>
                <div className="text-xs text-stone-400 mt-1">
                  Day {s.turn}/{MAX_TURNS} · seed <span className="font-mono text-amber-400">{s.seedText}</span>
                </div>
              </div>

              <div className="bg-stone-900 border border-stone-700 rounded-lg overflow-hidden mb-6">
                <table className="w-full text-sm">
                  <tbody>
                    {scoreLines(s).filter((l) => l.vp !== 0).map((l) => (
                      <tr key={l.label} className="border-b border-stone-800 last:border-0">
                        <td className="px-4 py-1.5 text-stone-300">{l.label}</td>
                        <td className="px-4 py-1.5 text-stone-500 text-xs">{l.detail}</td>
                        <td className={`px-4 py-1.5 text-right font-bold ${l.vp < 0 ? 'text-red-400' : 'text-amber-300'}`}>
                          {l.vp > 0 ? '+' : ''}{l.vp}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-stone-800">
                      <td className="px-4 py-2 font-bold text-amber-100" colSpan={2}>TOTAL</td>
                      <td className="px-4 py-2 text-right font-black text-amber-400">{scoreTotal(s)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button onClick={undo} disabled={!history.length}
                  className="px-6 py-3 bg-stone-700 hover:bg-stone-600 disabled:opacity-30 text-white font-bold rounded flex items-center justify-center gap-2">
                  <Undo2 size={18} /> Undo last move
                </button>
                <button onClick={() => reset(s.seedText)} className="px-6 py-3 bg-white text-stone-900 font-bold rounded hover:bg-stone-200">
                  Retry this seed
                </button>
                <button onClick={() => reset(`run-${Date.now()}`)} className="px-6 py-3 bg-amber-600 hover:bg-amber-500 text-stone-900 font-bold rounded">
                  New wasteland
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
