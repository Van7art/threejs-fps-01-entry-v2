# Sunscorch Yard

[![threejs-fps-01](https://make.fun/api/competitions/threejs-fps-01/badge?owner=Van7art&repo=threejs-fps-01-entry-v2)](https://make.fun/c/threejs-fps-01)
[![rank](https://make.fun/api/competitions/threejs-fps-01/rank-badge?owner=Van7art&repo=threejs-fps-01-entry-v2)](https://make.fun/c/threejs-fps-01)
[![reward](https://make.fun/api/competitions/threejs-fps-01/reward-badge?owner=Van7art&repo=threejs-fps-01-entry-v2)](https://make.fun/c/threejs-fps-01)

A round-based tactical FPS in the browser, built on three.js. Two teams of
five fight over a sun-baked desert oil refinery: the **Sand Vipers** attack
and the **Dune Wardens** defend. First to 7 rounds takes the yard.

## How a match plays

- **Best of 13.** Sides swap after round 6. A round lasts 100 seconds.
- **The objective.** Attackers plant a charge at Pump House (Site A) or Tank
  Farm (Site B) by holding **E** for 4 seconds. Defenders defuse by holding
  **E** for 5 seconds. A planted charge blows in 35 seconds. If the carrier
  goes down, the charge drops and any attacker can pick it back up.
- **Money.** Start with $800. A kill pays $300, a round win $3250, a round
  loss $1900 plus a growing loss-streak bonus, planting $300.
- **Buy menu.** Press **B** during the 6-second freeze time to buy the
  Sidewinder SMG ($1500), Boomer shotgun ($1700), Longhorn rifle ($2700),
  Rattler DMR ($3100), Sandcharge HE ($300), Flashpot ($200) or kevlar ($650).
- **Gunplay.** Hitscan weapons with distance falloff and headshot multipliers,
  spread that grows while moving or firing, recovering recoil, aim-down-sights
  zoom, crouching, jumping, and acceleration-based movement with collision.
- **Bots.** Eight bots walk a waypoint graph through three lanes, hold sites,
  rotate to a planted charge, plant and defuse it themselves, and turn toward
  gunfire they hear. They fire in bursts with distance-based accuracy.

## The map

A 56 × 40 m refinery: container lanes north and south, a pipe rack along each
edge, a gantry over the middle, two big storage tanks at Tank Farm, the Pump
House at Site A, and hazard pads that slow you down. Everything visual is
procedural — canvas-painted textures, three.js geometry, and synthesised Web
Audio sounds. No image or audio files, no network requests.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Aim (click the deploy button first to lock it) |
| Left click | Fire (hold for automatic weapons) |
| Right click | Aim down sights |
| R | Reload |
| 1–5 | Switch weapon · 6 / 7 throw HE / flash |
| G | Throw grenade |
| B | Buy menu (freeze time) |
| E (hold) | Plant / defuse the charge |
| Ctrl / C | Crouch · Space jump · Shift walk quietly |

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. Single-player against
bots; nothing is downloaded at runtime.

Deterministic screenshots: `?shot=start&seed=1`, `?shot=play&seed=1` and
`?shot=end&seed=1` stage the start screen, a mid-round firefight and a
finished round. The mapping lives in `game/shots.json`.

## Code layout

- `game/src/boot.js` — input, pointer lock, fixed-step loop, staging
- `game/src/match.js` — rounds, economy, plant/defuse, win checks
- `game/src/actors.js` — fighters, movement, hitscan, grenades
- `game/src/bots.js` — waypoint brains: hold, rotate, plant, defuse
- `game/src/map.js` — the yard: solids, sites, waypoint graph, collision
- `game/src/weapons.js` — weapon table and ballistics
- `game/src/render.js` — three.js scene, pooled tracers and puffs
- `game/src/hud.js` — DOM HUD
- `game/src/audio.js` — synthesised Web Audio sounds
- `game/src/palette.js` — desert palette and canvas textures
- `game/src/rng.js` — seeded random stream

The simulation steps at a fixed 60 Hz, apart from rendering, and the hot
loop allocates no new objects per frame — tracers and impact puffs are pooled.

## Entry

Built for the make.fun bounty
[threejs-fps-01](https://make.fun/c/threejs-fps-01) — play more entries at
https://make.fun/?ref=4e96xqxt

## License

MIT — see [LICENSE](LICENSE).
