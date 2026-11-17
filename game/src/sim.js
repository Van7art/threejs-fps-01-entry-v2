// The fixed-step simulation for Sunscorch Yard: player movement and
// shooting, grenades, the charge, rounds and the economy. This module owns
// the match state; bots.js owns bot decisions; main.js owns rendering and
// wires the two together through the `world` object.
//
// Time is in seconds, distances in metres. The loop runs at a fixed 60 Hz
// step, so the simulation is the same on every machine.

import { WEAPONS, GRENADES, currentWeapon, shotSpread, damageAt, newLoadout, buyWeapon, buyGrenade } from './weapons.js';
import { resolveCollision } from './map.js';
import { EYE_HEIGHT, BODY_RADIUS } from './entities.js';
import { assignRoundJobs } from './bots.js';

export const ROUND_TIME = 100;
export const BOMB_TIME = 35;
export const FREEZE_TIME = 5;
export const END_TIME = 4.5;
export const PLANT_TIME = 4;
export const DEFUSE_TIME = 5;
export const WIN_ROUNDS = 7;
export const SWAP_AFTER = 6;

export function createMatch(rng) {
  return {
    rng,
    round: 1,
    phase: 'freeze',
    phaseTime: FREEZE_TIME,
    timer: ROUND_TIME,
    score: { attackers: 0, defenders: 0 },
    lossStreak: { attackers: 0, defenders: 0 },
    bomb: { planted: false, site: null, timer: 0, planter: null },
    carrier: null,
    winner: null,
    matchOver: false,
    roundWinner: null,
    roundReason: '',
    kills: [],
    plantSite: null,
  };
}

export function createPlayer(spawn) {
  return {
    id: 'player',
    team: 'attackers',
    name: 'You',
    isPlayer: true,
    alive: true,
    health: 100,
    x: spawn[0],
    z: spawn[1],
    y: 0,
    vy: 0,
    vx: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    speed: 0,
    crouched: false,
    money: 800,
    kills: 0,
    deaths: 0,
    loadout: newLoadout(),
    fireTimer: 0,
    reloadUntil: 0,
    bloom: 0,
    recoil: 0,
    ads: false,
    plantProgress: 0,
    defuseProgress: 0,
    blindUntil: 0,
    blindStrength: 0,
    grenadeCooldown: 0,
    walkPhase: 0,
    group: null,
  };
}

// Which team a side plays on this round: the player starts on attackers
// and the sides swap after round 6.
function teamOf(match, side) {
  const swapped = match.round > SWAP_AFTER;
  if (side === 'player') return swapped ? 'defenders' : 'attackers';
  return swapped ? 'attackers' : 'defenders';
}

export function startRound(match, world) {
  const player = world.player;
  const bots = world.bots;
  match.phase = 'freeze';
  match.phaseTime = FREEZE_TIME;
  match.timer = ROUND_TIME;
  match.bomb = { planted: false, site: null, timer: 0, planter: null };
  match.roundWinner = null;
  match.roundReason = '';
  world.roundPhase = 'freeze';
  world.plantedSite = null;

  const playerTeam = teamOf(match, 'player');
  const enemyTeam = playerTeam === 'attackers' ? 'defenders' : 'attackers';
  player.team = playerTeam;
  player.alive = true;
  player.health = 100;
  player.blindUntil = 0;
  player.plantProgress = 0;
  player.defuseProgress = 0;
  const spawn = world.spawns[playerTeam][0];
  player.x = spawn[0];
  player.z = spawn[1];
  player.y = 0;
  player.vy = 0;
  player.vx = 0;
  player.vz = 0;
  // Face the yard: attackers look north-east, defenders south-west.
  player.yaw = playerTeam === 'attackers' ? Math.PI * 0.25 : -Math.PI * 0.75;
  player.pitch = 0;
  // Fresh ammo each round, keep owned weapons.
  for (const id of Object.keys(player.loadout.ammo)) {
    player.loadout.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
  }
  player.loadout.grenades = { he: 0, flash: 0 };

  let i = 0;
  for (const bot of bots) {
    const team = i < 4 ? playerTeam : enemyTeam;
    bot.team = team;
    bot.alive = true;
    bot.health = 100;
    bot.blindUntil = 0;
    bot.plantProgress = 0;
    bot.defuseProgress = 0;
    const s = world.spawns[team][(i % 4) + 1];
    bot.x = s[0];
    bot.z = s[1];
    bot.yaw = team === 'attackers' ? Math.PI * 0.25 : -Math.PI * 0.75;
    bot.path = [];
    bot.pathIndex = 0;
    bot.target = null;
    bot.hasCharge = false;
    i++;
  }
  // The charge: the player carries on odd rounds, a bot on even ones, so
  // the round always has a planter even if the player camps the spawn.
  assignRoundJobs(bots, match.round, world.rng);
  if (match.round % 2 === 1) {
    for (const bot of bots) bot.hasCharge = false;
    match.carrier = player;
  } else {
    const carrier = bots.find((b) => b.hasCharge);
    match.carrier = carrier || null;
  }
  world.fx.roundStart();
}

export function aliveCount(fighters, team) {
  return fighters.filter((f) => f.alive && f.team === team).length;
}

export function damageFighter(target, amount, head, attacker, world, match) {
  if (!target.alive) return;
  target.health -= amount;
  if (target.isPlayer) {
    world.fx.hurt();
    world.hudFlash();
  } else if (attacker && attacker.isPlayer) {
    world.fx.hit(head);
    world.hudHitmarker(head);
  }
  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;
    target.deaths = (target.deaths || 0) + 1;
    if (attacker) {
      attacker.kills = (attacker.kills || 0) + 1;
      if (attacker.isPlayer) {
        attacker.money += 300;
        world.fx.kill();
      }
      if (match && match.carrier === target) {
        // The charge drops where its carrier fell.
        match.carrier = null;
        world.dropCharge(target.x, target.z);
      }
    }
    world.onKill(attacker, target, head);
    if (target.group) target.group.visible = false;
  }
}

function endRound(match, winner, reason, world) {
  if (match.phase === 'end' || match.matchOver) return;
  match.phase = 'end';
  match.phaseTime = END_TIME;
  match.roundWinner = winner;
  match.roundReason = reason;
  match.score[winner] += 1;
  const loser = winner === 'attackers' ? 'defenders' : 'attackers';
  match.lossStreak[winner] = 0;
  match.lossStreak[loser] += 1;
  // Bots remember the result for next round's buy.
  for (const bot of world.bots) bot.lastRoundWon = bot.team === winner;
  world.roundPhase = 'end';
  // Economy: winners take $3250, losers $1900 plus $500 per consecutive
  // loss, capped at $3400; the planter pockets $300.
  const player = world.player;
  const playerWon = player.team === winner;
  const lossBonus = Math.min(1500, (match.lossStreak[player.team] - 1) * 500);
  player.money += playerWon ? 3250 : 1900 + lossBonus;
  if (match.bomb.planter === player) player.money += 300;
  if (playerWon) world.fx.roundWin();
  else world.fx.roundLose();
  if (match.score[winner] >= WIN_ROUNDS || match.round >= 13) {
    match.matchOver = true;
    match.winner = match.score.attackers > match.score.defenders ? 'attackers'
      : match.score.defenders > match.score.attackers ? 'defenders' : 'draw';
  }
}

export function nextRound(match, world) {
  if (match.matchOver) return;
  match.round += 1;
  startRound(match, world);
}

export function plantCharge(match, planter, world) {
  match.bomb.planted = true;
  match.bomb.site = planter.targetSite || planter.plantSite || world.nearestSite(planter.x, planter.z).id;
  match.bomb.timer = BOMB_TIME;
  match.bomb.planter = planter;
  match.phase = 'planted';
  match.timer = BOMB_TIME;
  world.roundPhase = 'planted';
  world.plantedSite = match.bomb.site;
  world.onEvent(`${planter.name} planted the charge at Site ${match.bomb.site}`);
  world.fx.plant();
}

export function defuseCharge(match, defuser, world) {
  match.bomb.planted = false;
  world.roundPhase = 'end';
  world.onEvent(`${defuser.name} defused the charge`);
  endRound(match, 'defenders', 'Charge defused', world);
}

function throwGrenade(player, type, world, match) {
  if (player.loadout.grenades[type] <= 0 || player.grenadeCooldown > world.time) return;
  player.loadout.grenades[type] -= 1;
  player.grenadeCooldown = world.time + 0.8;
  const dir = {
    x: -Math.sin(player.yaw) * Math.cos(player.pitch),
    y: Math.sin(player.pitch) + 0.25,
    z: -Math.cos(player.yaw) * Math.cos(player.pitch),
  };
  world.grenades.push({
    type,
    x: player.x,
    y: EYE_HEIGHT,
    z: player.z,
    vx: dir.x * 14,
    vy: dir.y * 14 + 2,
    vz: dir.z * 14,
    fuse: GRENADES[type].fuseMs / 1000,
    owner: player,
  });
  world.fx.throwSound();
}

function updateGrenades(match, dt, world) {
  for (let i = world.grenades.length - 1; i >= 0; i--) {
    const g = world.grenades[i];
    g.vy -= 18 * dt;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.z += g.vz * dt;
    if (g.y < 0.08) {
      g.y = 0.08;
      g.vy *= -0.4;
      g.vx *= 0.7;
      g.vz *= 0.7;
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      world.grenades.splice(i, 1);
      if (g.type === 'he') {
        world.fx.explosion(g.x, g.z);
        for (const f of world.fighters) {
          if (!f.alive || f === g.owner) continue;
          const d = Math.hypot(f.x - g.x, f.z - g.z);
          if (d < GRENADES.he.radius) {
            const dmg = GRENADES.he.damage * (1 - d / GRENADES.he.radius);
            damageFighter(f, dmg, false, g.owner, world, match);
          }
        }
      } else {
        world.fx.flash(g.x, g.z);
        for (const f of world.fighters) {
          if (!f.alive || f === g.owner) continue;
          const d = Math.hypot(f.x - g.x, f.z - g.z);
          if (d > GRENADES.flash.radius) continue;
          // Blinded only when facing the flash (or very close to it).
          const fx = g.x - f.x;
          const fz = g.z - f.z;
          const facing = -Math.sin(f.yaw) * fx + -Math.cos(f.yaw) * fz;
          const facingNorm = facing / Math.max(0.01, d);
          if (facingNorm > 0.2 || d < 4) {
            f.blindUntil = world.time + GRENADES.flash.blindMs / 1000;
            f.blindStrength = 1 - d / GRENADES.flash.radius;
            if (f.isPlayer) world.fx.flashScreen(f.blindStrength);
          }
        }
      }
    }
  }
}

export function updatePlayer(match, dt, input, world) {
  const player = world.player;
  const now = world.time;
  if (!player.alive || match.phase === 'end' || match.matchOver) return;

  // Look.
  player.yaw -= input.mouseDX * 0.0022 * (player.ads ? 0.6 : 1);
  player.pitch -= input.mouseDY * 0.0022 * (player.ads ? 0.6 : 1);
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));

  // Move: acceleration toward the wish direction, friction when idle.
  const crouched = input.crouch;
  player.crouched = crouched;
  const baseSpeed = crouched ? 2.6 : player.ads ? 3.4 : 5.2;
  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  let wishX = 0;
  let wishZ = 0;
  if (input.forward) { wishX += -sin; wishZ += -cos; }
  if (input.back) { wishX += sin; wishZ += cos; }
  if (input.left) { wishX += -cos; wishZ += sin; }
  if (input.right) { wishX += cos; wishZ += -sin; }
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 0) {
    wishX /= wishLen;
    wishZ /= wishLen;
  }
  const accel = 42;
  player.vx += wishX * accel * dt;
  player.vz += wishZ * accel * dt;
  const speed = Math.hypot(player.vx, player.vz);
  if (speed > baseSpeed) {
    player.vx *= baseSpeed / speed;
    player.vz *= baseSpeed / speed;
  }
  if (wishLen === 0) {
    const damp = Math.max(0, 1 - 10 * dt);
    player.vx *= damp;
    player.vz *= damp;
  }
  const nx = player.x + player.vx * dt;
  const nz = player.z + player.vz * dt;
  const [rx, rz] = resolveCollision(nx, nz, BODY_RADIUS, world.colliders, world.circles);
  player.x = rx;
  player.z = rz;
  player.speed = Math.hypot(player.vx, player.vz);
  player.walkPhase += dt * player.speed * 2.4;

  // Jump and gravity.
  if (input.jump && player.y === 0) player.vy = 5.2;
  player.vy -= 16 * dt;
  player.y += player.vy * dt;
  if (player.y <= 0) {
    player.y = 0;
    player.vy = 0;
  }

  // Recoil recovery and bloom decay.
  player.recoil = Math.max(0, player.recoil - dt * 0.05);
  player.bloom = Math.max(0, player.bloom - dt * 0.02);

  const weapon = currentWeapon(player.loadout);
  const ammo = player.loadout.ammo[weapon.id];

  // Reload.
  if (input.reload && ammo.mag < weapon.mag && ammo.reserve > 0 && now >= player.reloadUntil) {
    player.reloadUntil = now + weapon.reloadMs / 1000;
    world.fx.reload();
  }
  if (player.reloadUntil > 0 && now >= player.reloadUntil) {
    const need = weapon.mag - ammo.mag;
    const take = Math.min(need, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
    player.reloadUntil = 0;
  }

  // Fire.
  player.fireTimer -= dt;
  const wantFire = weapon.auto ? input.fire : input.firePressed;
  if (wantFire && player.fireTimer <= 0 && player.reloadUntil === 0 && match.phase !== 'freeze') {
    if (ammo.mag <= 0) {
      world.fx.dryFire();
      player.fireTimer = 0.25;
    } else {
      ammo.mag -= 1;
      player.fireTimer = weapon.fireMs / 1000;
      player.bloom = Math.min(0.03, player.bloom + weapon.bloom);
      player.recoil += weapon.recoil;
      player.pitch += weapon.recoil * 0.6;
      firePlayerWeapon(player, weapon, world, match);
    }
  }

  // Grenades.
  if (input.grenadeHE) throwGrenade(player, 'he', world, match);
  if (input.grenadeFlash) throwGrenade(player, 'flash', world, match);

  // Buy menu purchases, keyed by the buy menu's item ids.
  if (input.buyKey) {
    const id = input.buyKey;
    if (WEAPONS[id]) {
      const res = buyWeapon(player.loadout, id, player.money);
      if (res.ok) {
        player.money = res.money;
        world.fx.buy();
      } else world.fx.denied();
    } else if (GRENADES[id]) {
      const res = buyGrenade(player.loadout, id, player.money);
      if (res.ok) {
        player.money = res.money;
        world.fx.buy();
      } else world.fx.denied();
    }
  }

  // Plant / defuse: hold E on the right site.
  const site = world.nearestSite(player.x, player.z);
  const onSite = site && Math.hypot(player.x - site.center[0], player.z - site.center[1]) <= site.radius;
  if (input.use && match.phase === 'live' && onSite && match.carrier === player && !match.bomb.planted) {
    player.plantProgress += dt;
    if (Math.floor(player.plantProgress * 2) !== Math.floor((player.plantProgress - dt) * 2)) world.fx.beep(player.x, player.z, 'plant');
    if (player.plantProgress >= PLANT_TIME) {
      player.plantSite = site.id;
      plantCharge(match, player, world);
      player.plantProgress = 0;
    }
  } else if (input.use && match.phase === 'planted' && onSite && site.id === match.bomb.site && player.team === 'defenders') {
    player.defuseProgress += dt;
    if (Math.floor(player.defuseProgress * 2) !== Math.floor((player.defuseProgress - dt) * 2)) world.fx.beep(player.x, player.z, 'defuse');
    if (player.defuseProgress >= DEFUSE_TIME) {
      defuseCharge(match, player, world);
      player.defuseProgress = 0;
    }
  } else {
    player.plantProgress = 0;
    player.defuseProgress = 0;
  }
}

function firePlayerWeapon(player, weapon, world, match) {
  const spread = shotSpread(weapon, player.speed, player.crouched, player.bloom) * (player.ads ? 0.55 : 1);
  const origin = { x: player.x, y: EYE_HEIGHT + player.y, z: player.z };
  const baseYaw = player.yaw;
  const basePitch = player.pitch - player.recoil;
  for (let p = 0; p < weapon.pellets; p++) {
    const yaw = baseYaw + (world.rng.normal() * spread);
    const pitch = basePitch + (world.rng.normal() * spread);
    const dir = {
      x: -Math.sin(yaw) * Math.cos(pitch),
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * Math.cos(pitch),
    };
    const hit = world.raycast(origin, dir, weapon.range);
    world.fx.tracer(origin.x, origin.y, origin.z, hit ? hit.point.x : origin.x + dir.x * weapon.range, hit ? hit.point.y : origin.y + dir.y * weapon.range, hit ? hit.point.z : origin.z + dir.z * weapon.range, player.team);
    if (hit && hit.fighter) {
      const dmg = damageAt(weapon, hit.dist, hit.head);
      damageFighter(hit.fighter, dmg, hit.head, player, world, match);
    }
  }
  world.fx.shot(player.x, player.z, weapon.kind, true);
  world.noise(player.x, player.z, 30);
  world.fx.muzzle();
}

export function updateMatch(match, dt, world) {
  if (match.matchOver) return;

  if (match.phase === 'freeze') {
    match.phaseTime -= dt;
    if (match.phaseTime <= 0) {
      match.phase = 'live';
      world.roundPhase = 'live';
      world.onEvent(`Round ${match.round} — plant the charge or wipe the enemy team`);
    }
  } else if (match.phase === 'live' || match.phase === 'planted') {
    match.timer -= dt;
    if (match.phase === 'planted') {
      match.bomb.timer -= dt;
      if (match.bomb.timer <= 0) {
        match.bomb.planted = false;
        endRound(match, 'attackers', 'Charge detonated', world);
        world.fx.explosion(world.sites[match.bomb.site].center[0], world.sites[match.bomb.site].center[1]);
        return;
      }
    }
    // Elimination wins.
    const atkAlive = aliveCount(world.fighters, 'attackers');
    const defAlive = aliveCount(world.fighters, 'defenders');
    if (atkAlive === 0 && defAlive > 0) {
      endRound(match, 'defenders', 'Enemy team eliminated', world);
      return;
    }
    if (defAlive === 0 && atkAlive > 0) {
      if (match.phase !== 'planted') {
        endRound(match, 'attackers', 'Enemy team eliminated', world);
        return;
      }
      // Bomb still ticks: defenders dead but the charge can still win it.
    }
    if (match.phase === 'live' && match.timer <= 0) {
      endRound(match, 'defenders', 'Time expired', world);
      return;
    }
  } else if (match.phase === 'end') {
    match.phaseTime -= dt;
    if (match.phaseTime <= 0) nextRound(match, world);
  }

  updateGrenades(match, dt, world);

  // A dropped charge is picked up by any living attacker walking over it.
  if (world.droppedCharge && !match.bomb.planted) {
    for (const f of world.fighters) {
      if (!f.alive || f.team !== 'attackers') continue;
      if (Math.hypot(f.x - world.droppedCharge.x, f.z - world.droppedCharge.z) < 1.4) {
        match.carrier = f;
        if (f.isPlayer) world.onEvent('You picked up the charge');
        else world.onEvent(`${f.name} picked up the charge`);
        world.droppedCharge = null;
        break;
      }
    }
  }
}
