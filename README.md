# Sunscorch Yard — three.js tactical FPS

[![threejs-fps-01](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/Van7art/threejs-fps-01-entry-v2/rank.svg)](https://make.fun/bounty/threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/Van7art/threejs-fps-01-entry-v2/reward.svg)](https://make.fun/bounty/threejs-fps-01)

A daytime desert refinery, five against five. Sunscorch Yard is a round-based
tactical FPS built on three.js 0.187.0: plant the charge at the Pump House
(Site A) or the Tank Farm (Site B) — or wipe the enemy team. First to 7 rounds
takes the yard, with sides swapping after round 6.

## How it plays

- **First-person gunplay** — mouse look, WASD movement with acceleration,
  crouch, jump, aim-down-sights. Hits are raycast against head and body
  volumes (headshots hurt more); recoil, spread and bloom punish firing on
  the move, so stopping to aim pays.
- **Five weapons and two grenades** — the free Duster pistol, Sidewinder SMG,
  Boomer shotgun, Longhorn rifle and Rattler DMR, plus the Sandcharge (HE)
  and Flashpot (flash) grenades. Money earned each round buys them in the
  freeze-time buy menu (`B`, keys 1–7).
- **Bots that play the map** — eight bots walk a waypoint graph through three
  lanes, hold positions, rotate to a planted site, plant and defuse the
  charge, and react to gunfire they hear. They see through line of sight and
  miss more the further away — and the faster — their target moves.
- **Rounds and economy** — 100-second rounds, 35-second charge timer, win
  $3250 / loss $1900 with a loss-streak bonus, $300 per kill and $300 for the
  planter. Best of 13, first to 7.
- **The map** — an original 56 × 40 m refinery: container lanes, a pipe run,
  a gantry over mid, two storage tanks, a pump house, and a hazard pad.
  Everything is procedural — canvas-painted textures, Web Audio sounds, no
  image or audio files, no network requests at all.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome and click to play.

- `W A S D` move · mouse look · click fire · right-click aim
- `R` reload · `Ctrl`/`C` crouch · `Space` jump
- `B` buy menu (freeze time) · `6`/`7` throw grenade · `E` hold to plant/defuse

## Layout

- `game/index.html` — page, HUD and import map (`three` → vendored 0.187.0)
- `game/src/main.js` — bootstrap, fixed-step loop, raycasting, input, shots
- `game/src/sim.js` — match state: movement, shooting, grenades, rounds, economy
- `game/src/bots.js` — bot decisions: waypoints, holds, plant/defuse, hearing
- `game/src/map.js` — the yard: geometry, colliders, waypoint graph, line of sight
- `game/src/weapons.js` — weapon and grenade data, damage falloff, spread
- `game/src/render.js` — three.js scene, sun and sky, pooled tracers and effects
- `game/src/entities.js` — fighter meshes, hitboxes, view model
- `game/src/hud.js` — health, ammo, timer, score, buy menu, banners
- `game/src/palette.js` — desert palette and procedural canvas textures
- `game/src/audio.js` — synthesized Web Audio sounds
- `game/src/rng.js` — seeded random numbers (`?seed=N`, default 1)

## Screenshots

Staged deterministically with `?shot=start|play|end&seed=1` (see `shots.json`).
A headless self-test runs at `?selftest=1` and reports PASS/FAIL in
`#selftest` and the page title.

---

Built for the [threejs-fps-01 bounty](https://make.fun/?ref=4e96xqxt) on make.fun.
