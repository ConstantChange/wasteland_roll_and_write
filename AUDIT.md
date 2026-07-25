# Project Audit — Wasteland Scavenger

**Date:** 2026-07-25
**Scope:** entire repository (one file, `wasteland_scavenger_game.jsx`, 1526 lines)

---

## 1. Repository health

The repository contains exactly one file. There is no `package.json`, no build
config, no README, no tests, no `.gitignore`, and no license.

| Missing | Consequence |
|---|---|
| `package.json` | `react` and `lucide-react` are imported but undeclared. Nobody can install and run this. |
| Bundler config (Vite/Next/CRA) | The file uses JSX + ES modules and Tailwind utility classes. It cannot execute in a browser as-is. |
| Tailwind setup | Every style in the file is a Tailwind class. Without a Tailwind build the UI renders unstyled. |
| README | No statement of what the project is, how to run it, or what the rules are (rules exist only inside the rendered UI). |
| Tests | Game logic is fully entangled with the view, so nothing is testable without a refactor. |
| `.gitignore` | `node_modules/` will be committed the moment anyone runs `npm install`. |

Git history is a single commit whose message (`Update print statement from
'Hello' to 'Goodbye'`) has no relationship to the contents — the project has no
usable history.

**Bottom line:** this is a working artifact pasted into a repo, not yet a
project. The single highest-value change is scaffolding it so it runs.

---

## 2. Correctness bugs

### 2.1 Resource gains silently overwrite each other (stale-state writes) — HIGH

`gainResource` and `spendResourceCost` both read track state from the render
closure and call `setTrack(...)` with a fresh copy. React does not update state
mid-handler, so **two writes to the same track inside one event handler cause
the second to discard the first.**

Two places hit this in practice:

**a) Barter refunds itself.** `confirmBarter` (line 509) spends two resources,
then gains one. If the gained type is one of the spent types — e.g. spend
1 Water + 1 Scrap, gain Water — `gainResource('water')` re-reads the pre-spend
`waterTrack` and overwrites it. The water spend is erased and the gain is
applied: **the player gets a free resource.** Repeatable at will.

**b) Exploration treasures lose resources.** In `markExploration` (line 440) the
Find Roll may gain Scrap or Food (lines 466–467), and then a Treasure Roll on
zones 6/12/17 may gain `+2 Food, +2 Scrap` (lines 478–479). When both touch the
same track, the find result is discarded — the player gets 2 instead of 3.

**Fix:** make `gainResource`/`spendResourceCost` use functional updates
(`setTrack(prev => …)`), or batch a whole turn's resource deltas into one write.
This is the single most important defect in the file; `gainResource` is called
from 16 sites and any future pairing will hit the same trap.

### 2.2 Softlock: the game can become unplayable instead of ending — HIGH

The END TURN button (line 1128) is disabled when:

```js
(isSurvivalTurn && !survivalPaid) && (resourceCounts.water + resourceCounts.food === 0)
```

That is precisely the state that `endTurn` is written to handle as a loss
(line 695: *"You had no Food or Water to spend to survive Day N!"*). Because the
button is disabled, that branch is unreachable. On a survival day (turns 3, 6,
9, 12) with all dice allocated and zero food and water, the player has **no
legal action at all** — the modifier panel is hidden once `canEndTurn` is true,
and Barter/Build both require `!rolled`. The only exit is reloading the page.

**Fix:** delete the `disabled` condition and let `endTurn` deliver the loss.

### 2.3 Resource-track "undo" restores resources spent for anything, on any turn — HIGH

`handleResourceClick` (line 394) lets the player click any box in state `'used'`
and flip it back to `'acquired'`. It is gated only on *being* a survival or
raider turn — never on *when* or *why* that box was spent.

On turn 3, every box consumed during turns 1–3 by building, bartering, or dice
modifiers is sitting in `'used'` state and is one click away from being
refunded. This is a free, unbounded resource exploit.

**Fix:** record which boxes were spent this turn for this payment (e.g. keep an
index list in state) and only allow undoing those.

### 2.4 Survival payment can be undone without clearing `survivalPaid` — MEDIUM

The undo path tries to decide whether survival is still paid (lines 429–434):

```js
const stillHasWater = waterTrack.some((s, i) => i !== index && s === 'used');
const stillHasFood  = foodTrack.some((s, i) => i !== index && s === 'used');
```

`'used'` is a permanent, whole-game marker — it does not mean "spent this turn
for survival". Once any water or food has ever been spent for any reason, these
are `true` forever, so `survivalPaid` is never reset. The player can pay
survival, undo the payment (recovering the resource per 2.3), and still end the
turn.

Both reads are also stale — `waterTrack` here predates the `setTrack` call three
lines above.

### 2.5 Raider payment counter drifts — MEDIUM

`raidersPaymentCount` is incremented/decremented by clicks while
`isRaiderTurn` (`turn === 6 && !raidersPaid`) holds. After `raidersPaid` becomes
true, undoing a box no longer decrements the counter but *does* still refund the
resource (2.3). The counter can also go negative if the player's first click on
turn 6 is an undo of an older `'used'` box.

### 2.6 Radiation death leaves the game in an inconsistent state — LOW

The radiation effect (line 200) sets `gameLost` and `loseReason` but never
`gameOver`. The full-screen loss overlay happens to block interaction, so this
is contained today — but every guard in the file tests `gameOver`, not
`gameLost`, so the underlying board remains "live". Set both.

### 2.7 Winning the game has no restart — LOW

Surviving turn 12 sets `gameOver` and renders a single line of text in the top
bar (line 846). `resetGame` is only wired to the "Try Again" button inside the
**loss** overlay (line 1514). A player who wins cannot start a new game without
reloading, and gets no score breakdown.

### 2.8 Fuel is consumed even when the reroll does nothing — LOW

`spendResourceToModify('fuel_reroll_all')` (line 605) spends the fuel before
checking whether any die was actually rerolled. The `luckyCharm` branch gets
this right (it checks `rerolled` before decrementing). UI gating currently hides
the case, but the asymmetry is a latent bug.

---

## 3. React correctness

### 3.1 Direct mutation of nested state — MEDIUM

Two places take a shallow copy and then mutate the nested objects that are still
referenced by current state:

- `produceFromStructures` (line 228): `{...structures}` then
  `newStructures.waterCollector.lastProduced = turn` — mutates
  `structures.waterCollector` in place.
- `markExploration` (line 474): `{...tools}` then `newTools.wrench.uses = …` —
  mutates `tools.wrench` in place.

It renders correctly today only because the top-level reference changes. It will
break under StrictMode double-invocation or concurrent rendering, and it makes
any future memoization unsafe.

### 3.2 37 `useState` calls in one 1526-line component — MEDIUM

Game rules, RNG, scoring, payment flow, and the entire view live in one
function. Nothing can be unit-tested, and every state transition has to be
re-derived by reading the whole file. The correctness bugs above are a direct
consequence of this shape. A `useReducer` holding a single game-state object
would eliminate the entire class of stale-state bugs in §2.1 by construction.

### 3.3 `toggleFullScreen` has stale state and an unhandled rejection — LOW

`requestFullscreen()` has no `.catch()`, so a denied request produces an
unhandled promise rejection. There is no `fullscreenchange` listener, so exiting
fullscreen with Esc leaves `isFullScreen` stale and the icon wrong.

### 3.4 No persistence — LOW

A 12-turn game is entirely in memory. Any refresh loses it, which is
particularly harsh given the softlock in §2.2 makes reloading mandatory.

---

## 4. Accessibility

- Dice (line 963) and resource checkboxes (line 49) are `<div onClick>` with no
  `role`, `tabIndex`, or key handler — unreachable by keyboard, invisible to
  screen readers. These are the two most-used controls in the game.
- No `aria-label` anywhere; icon-only controls (fullscreen toggle, barter close
  `✕`) have no accessible name.
- State is conveyed by color alone across the board (marked/unmarked,
  radiation zones, resource states).
- Disabled buttons rely on `opacity-30`, which fails contrast requirements.

---

## 5. UI / content defects

### 5.1 Literal markdown asterisks rendered to the user — LOW, but visible

JSX does not process markdown. Ten lines contain `**bold**` that renders as
literal asterisks on screen, including the survival warning the player sees on
every third turn:

> You must spend 1 \*\*Food or Water\*\* to survive.

Affected lines: 1113, 1120, 1145, 1444, 1462, 1470, 1477, 1480, 1496, 1497,
1498. Replace with `<strong>` (already used correctly elsewhere in the same
block).

### 5.2 Rules text contradicts the code

- Line 1477 lists survival days as "turns 3, 9, and 12", omitting 6. Turn 6 does
  require survival payment (`turn % 3 === 0`); the omission is corrected three
  lines later, which reads as a contradiction.
- Line 1480 says click **"Confirm Raider Payment"**; the actual button (line
  1104) reads "Confirm Payment".
- The heading says `v16.1` (lines 1432, 1434) while the logic comment says
  `v16.2` (line 117).

### 5.3 Fortify track is misleading

All four Fortify boxes call `markFortify()` (line 1303), which always marks the
next unmarked box. Clicking the "+10 VP" box marks "-1 Cost" instead. Either
render it as a single progress control or make the boxes individually
addressable.

### 5.4 Raider prompt when nothing is owed

With 3+ Shelter/Fortify marks, `raiderCost` is 0, but the panel still announces
"You must pay 0 resources" and demands a confirmation click.

### 5.5 Modifier use clears the die selection

`updateDice` (line 553) resets `selectedDiceIndices`, so after spending a
resource to adjust a die the player must reselect it before spending another.
This makes stacked modifiers needlessly tedious.

---

## 6. Dead and confusing code

- **Unused imports:** `AlertTriangle` and `RefreshCw` (line 2) are never
  rendered.
- **Dead branches** in `spendResourceToModify` (lines 622–626):
  ```js
  if (selectedDiceIndices.length !== 1 && action !== 'sacrifice') {
    if (action !== 'sacrifice') return;
  }
  ```
  The inner condition is implied by the outer one, and no caller ever passes
  `'sacrifice'` — sacrificing goes through the separate `sacrificeDice`.
  All the `action !== 'sacrifice'` guards below it are unreachable-as-written.
- **`tools[*].max` does not mean what it says.** It is only ever used as
  `max * 3` (lines 481–485), so `wrench.max = 3` actually caps uses at 9. Either
  the field or the multiplier is wrong; at minimum it needs renaming.
- **Vestigial comments:** `{/* REMOVED Barter Section */}` (1379),
  `{/* REMOVED: All Modals */}` (1519).
- **`getAvailableResourceCount` is recomputed constantly** — `canAffordStructure`
  alone scans four 15-element arrays on every render for each of four cards.
  Harmless at this size, but `resourceCounts` (line 787) already holds the
  answer and should be reused.

---

## 7. Security

No meaningful attack surface: no network calls, no `dangerouslySetInnerHTML`, no
user-controlled strings reaching the DOM, no storage, no dependencies beyond
React and an icon library. The injected `<style>` block (line 802) is a static
literal.

`Math.random()` is used for all dice. That is fine for a local single-player
game; it would need replacing only if scores ever became competitive or
server-verified.

---

## 8. Recommended order of work

1. **Scaffold the project** — `package.json`, Vite + Tailwind, README,
   `.gitignore`. Nothing else can be verified until the app runs.
2. **Fix §2.2 (softlock)** — one-line change, removes the only
   unrecoverable state.
3. **Fix §2.1 (stale-state resource writes)** — convert `gainResource` and
   `spendResourceCost` to functional updates.
4. **Fix §2.3 / §2.4 / §2.5 (payment and undo tracking)** — track
   spent-this-turn indices explicitly rather than inferring from `'used'`.
5. **Fix §2.6 / §2.7** — set `gameOver` on radiation death; add a proper
   victory screen with score breakdown and restart.
6. **Extract game state into a reducer**, then add tests for scoring, payments,
   and dice-matching. This retires §3.1 and §3.2 and makes items 3–5 permanent.
7. **Accessibility pass** on dice and resource checkboxes (§4).
8. **Content cleanup** — markdown asterisks, rules/code contradictions, dead
   code (§5, §6).
