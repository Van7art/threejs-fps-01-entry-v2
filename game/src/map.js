// Sunscorch Yard: a daytime desert refinery. Two charge sites, three
// lanes, and a waypoint graph the bots walk. Attackers (Sand Vipers) spawn
// in the south-west corner, defenders (Dune Wardens) in the north-east.
// Site A, the Pump House, sits north-west; Site B, the Tank Farm, sits
// south-east. The middle lane runs under a gantry; the north lane hugs the
// pipe run; the south lane passes the container stacks.
//
// Coordinates: x east, z south, metres, ground at y = 0. The yard is
// 56 x 40 m inside a 4 m perimeter wall. Colliders are axis-aligned boxes
// and circles in the XZ plane; movement and sight resolve against them.

import * as THREE from 'three';
import { COLORS, materials } from './palette.js';

// Waypoints: id -> [x, z]. Edges join neighbours in both directions, so
// findPath can route any bot from anywhere to any site.
export const WAYPOINTS = {
  atkSpawn: [-22, 14],
  westGate: [-16, 10],
  southLane: [-8, 8],
  midWest: [-8, -2],
  yardCentre: [0, 0],
  midEast: [8, -6],
  southEast: [8, 8],
  tankApproach: [16, 4],
  northWest: [-14, -10],
  siteA: [-16, -12],
  southB: [14, 14],
  siteB: [16, 12],
  defSpawn: [22, -14],
  defNorth: [14, -10],
  defLane: [6, -12],
  defEast: [20, -4],
  defEastLow: [18, 2],
  northMid: [-2, -14],
  westLane: [-20, 2],
  midNorth: [-4, -8],
};

export const EDGES = [
  ['atkSpawn', 'westGate'], ['westGate', 'southLane'], ['southLane', 'midWest'],
  ['midWest', 'yardCentre'], ['midWest', 'northWest'], ['northWest', 'siteA'],
  ['northWest', 'northMid'], ['northMid', 'defLane'], ['defLane', 'defNorth'],
  ['defNorth', 'defSpawn'], ['yardCentre', 'midEast'], ['yardCentre', 'southEast'],
  ['midEast', 'defNorth'], ['midEast', 'tankApproach'], ['tankApproach', 'siteB'],
  ['southEast', 'tankApproach'], ['southEast', 'southB'], ['southB', 'siteB'],
  ['tankApproach', 'defEastLow'], ['defEastLow', 'defEast'], ['defEast', 'defSpawn'],
  ['westGate', 'westLane'], ['westLane', 'midWest'], ['midWest', 'midNorth'],
  ['midNorth', 'northMid'], ['southLane', 'southEast'],
];

export const SITES = {
  A: { id: 'A', name: 'Pump House', center: [-16, -12], radius: 5.5 },
  B: { id: 'B', name: 'Tank Farm', center: [16, 12], radius: 5.5 },
};

export const SPAWNS = {
  attackers: [
    [-23, 12], [-22, 15], [-20, 13], [-24, 15], [-21, 17],
  ],
  defenders: [
    [23, -12], [22, -15], [20, -13], [24, -15], [21, -17],
  ],
};

// Defender hold spots: [waypoint, yaw to face down the lane].
export const HOLD_SPOTS = [
  { at: 'siteA', yaw: Math.PI * 0.75 },
  { at: 'siteB', yaw: -Math.PI * 0.25 },
  { at: 'yardCentre', yaw: Math.PI },
  { at: 'defLane', yaw: Math.PI * 0.5 },
  { at: 'southEast', yaw: -Math.PI * 0.5 },
];

// Shortest path over the waypoint graph (Dijkstra), as a list of [x, z]
// points including the destination. Used by bots, never by the player.
export function findPath(fromId, toId) {
  const dist = new Map();
  const prev = new Map();
  const open = new Set(Object.keys(WAYPOINTS));
  for (const id of open) dist.set(id, Infinity);
  dist.set(fromId, 0);
  while (open.size > 0) {
    let best = null;
    let bestDist = Infinity;
    for (const id of open) {
      const d = dist.get(id);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    if (best === null) break;
    open.delete(best);
    if (best === toId) break;
    const [bx, bz] = WAYPOINTS[best];
    for (const [a, b] of EDGES) {
      const other = a === best ? b : b === best ? a : null;
      if (other === null || !open.has(other)) continue;
      const [ox, oz] = WAYPOINTS[other];
      const d = bestDist + Math.hypot(ox - bx, oz - bz);
      if (d < dist.get(other)) {
        dist.set(other, d);
        prev.set(other, best);
      }
    }
  }
  const path = [];
  let cur = toId;
  while (cur !== undefined) {
    path.unshift(WAYPOINTS[cur]);
    if (cur === fromId) break;
    cur = prev.get(cur);
  }
  if (path.length === 0 || path[0] !== WAYPOINTS[fromId]) return [WAYPOINTS[toId]];
  return path;
}

export function nearestWaypoint(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const [id, [wx, wz]] of Object.entries(WAYPOINTS)) {
    const d = (wx - x) ** 2 + (wz - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

function boxMesh(parent, mat, x, y, z, w, h, d, ry = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  parent.add(mesh);
  return mesh;
}

function cylMesh(parent, mat, x, y, z, rTop, rBottom, h, segments = 20) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// Build the yard into `scene`. Returns the colliders, circles, sites and
// spawns the simulation reads; the meshes themselves stay in the scene.
export function buildMap(scene) {
  const mats = materials();
  const colliders = []; // {minX,maxX,minZ,maxZ,h} — h is the top in metres
  const circles = []; // {x,z,r}
  const addBox = (minX, maxX, minZ, maxZ, h = 4) => colliders.push({ minX, maxX, minZ, maxZ, h });
  const addCircle = (x, z, r) => circles.push({ x, z, r });

  // Ground: sand, repeated so the grain stays fine at yard scale.
  const sand = mats.sand.clone();
  sand.map = sand.map.clone();
  sand.map.repeat.set(14, 10);
  sand.map.needsUpdate = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 90), sand);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Perimeter walls, 4 m high, with a pale sand-coloured cap.
  const capMat = new THREE.MeshStandardMaterial({ color: COLORS.wallTop, roughness: 0.9 });
  const wall = (x, z, w, d) => {
    boxMesh(scene, mats.concrete, x, 2, z, w, 4, d);
    boxMesh(scene, capMat, x, 4.1, z, w + 0.2, 0.25, d + 0.2);
    addBox(x - w / 2, x + w / 2, z - d / 2, z + d / 2);
  };
  wall(0, -20.5, 58, 1);
  wall(0, 20.5, 58, 1);
  wall(-28.5, 0, 1, 42);
  wall(28.5, 0, 1, 42);

  // Shipping containers: rust and teal, placed where the lanes bend so
  // each lane has cover and a corner to clear.
  const container = (x, z, ry, mat) => {
    const g = new THREE.Group();
    boxMesh(g, mat, 0, 1.3, 0, 6, 2.6, 2.6);
    boxMesh(g, mats.dark, 0, 2.62, 0, 6.1, 0.08, 2.7);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    scene.add(g);
    const hw = ry === 0 ? 3 : 1.3;
    const hd = ry === 0 ? 1.3 : 3;
    addBox(x - hw, x + hw, z - hd, z + hd, 2.6);
  };
  container(-4, 3.2, 0, mats.rust);
  container(5, -2.8, 0, mats.teal);
  container(-9, -4.6, Math.PI / 2, mats.tealDark);
  container(13, 7.2, 0, mats.rustDark);
  container(-2, 12.5, 0, mats.rust);
  container(22, -6, Math.PI / 2, mats.teal);

  // Crates: low cover scattered through the lanes.
  const crate = (x, z, s = 1.2, mat = mats.rustDark) => {
    boxMesh(scene, mat, x, s / 2, z, s, s, s);
    addBox(x - s / 2, x + s / 2, z - s / 2, z + s / 2, s);
  };
  crate(-12, 4, 1.2);
  crate(-11, 4, 1.2, mats.tealDark);
  crate(2, 6, 1.2);
  crate(3.4, 6, 1.2);
  crate(-6, -10, 1.4);
  crate(10, -12, 1.2);
  crate(12, 15.5, 1.4);
  crate(-20, -4, 1.2);
  crate(18, -8, 1.2);
  crate(0, -6, 1.2, mats.tealDark);
  crate(1.4, -6, 1.2, mats.tealDark);

  // A stacked pair at the mid cross: tall cover, not a ladder.
  boxMesh(scene, mats.rust, -1, 0.6, -6, 1.2, 1.2, 1.2);
  boxMesh(scene, mats.rustDark, -1, 1.8, -6, 1.2, 1.2, 1.2);
  addBox(-1.6, -0.4, -6.6, -5.4, 2.4);

  // Site A — Pump House: a low concrete block, a pump rig and pipe runs.
  boxMesh(scene, mats.concrete, -19, 1.1, -15, 5, 2.2, 1.2);
  addBox(-21.5, -16.5, -15.6, -14.4, 2.2);
  boxMesh(scene, mats.tealDark, -13, 0.9, -16, 4, 1.8, 1.2);
  addBox(-15, -11, -16.6, -15.4, 1.8);
  cylMesh(scene, mats.pipe, -16, 0.8, -12, 0.55, 0.55, 1.6, 12);
  cylMesh(scene, mats.pipeDark, -14.2, 0.6, -10.6, 0.4, 0.4, 1.2, 12);
  addCircle(-16, -12, 0.8);
  addCircle(-14.2, -10.6, 0.6);
  // Pipe run along the north wall, with elbow joints.
  const pipeRun = cylMesh(scene, mats.pipe, 0, 3.4, -19.4, 0.35, 0.35, 56, 12);
  pipeRun.rotation.z = Math.PI / 2;
  cylMesh(scene, mats.pipeDark, -8, 3.4, -19.4, 0.5, 0.5, 0.5, 12).rotation.z = Math.PI / 2;
  cylMesh(scene, mats.pipeDark, 10, 3.4, -19.4, 0.5, 0.5, 0.5, 12).rotation.z = Math.PI / 2;

  // Site B — Tank Farm: two big storage tanks on a hazard pad.
  cylMesh(scene, mats.tank, 13.5, 2.5, 9.5, 2.8, 2.8, 5, 24);
  cylMesh(scene, mats.tank, 19, 2.5, 15, 2.8, 2.8, 5, 24);
  addCircle(13.5, 9.5, 3);
  addCircle(19, 15, 3);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), mats.hazard);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(16, 0.02, 12);
  scene.add(pad);

  // A gantry over the mid lane: two posts and a beam, a landmark for calls.
  boxMesh(scene, mats.pipeDark, -3, 2.5, -1.5, 0.5, 5, 0.5);
  boxMesh(scene, mats.pipeDark, 3, 2.5, -1.5, 0.5, 5, 0.5);
  boxMesh(scene, mats.rust, 0, 5, -1.5, 6.5, 0.6, 0.8);
  addBox(-3.25, -2.75, -1.75, -1.25, 5);
  addBox(2.75, 3.25, -1.75, -1.25, 5);

  // Site markers: flat rings on the ground in each site's colour.
  const siteRing = (site, color) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.35, site.radius, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.center[0], 0.03, site.center[1]);
    scene.add(ring);
  };
  siteRing(SITES.A, COLORS.teal);
  siteRing(SITES.B, COLORS.rust);

  // Distant dunes and a sun-bleached skyline, outside the walls.
  const duneMat = new THREE.MeshStandardMaterial({ color: 0xc99e6b, roughness: 1 });
  for (const [x, z, s] of [[-45, -35, 22], [30, -42, 26], [48, 20, 20], [-40, 38, 24], [0, -48, 30]]) {
    const dune = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 8), duneMat);
    dune.scale.y = 0.28;
    dune.position.set(x, 0, z);
    scene.add(dune);
  }

  return { colliders, circles, sites: SITES, spawns: SPAWNS };
}

// Push a circle (radius r) at (x, z) out of every collider it overlaps.
// Returns the corrected position; mutates nothing else.
export function resolveCollision(x, z, r, colliders, circles) {
  for (const c of colliders) {
    const cx = Math.max(c.minX, Math.min(x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(z, c.maxZ));
    const dx = x - cx;
    const dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // Centre inside the box: push out along the smallest penetration.
        const pl = x - c.minX;
        const pr = c.maxX - x;
        const pt = z - c.minZ;
        const pb = c.maxZ - z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) x = c.minX - r;
        else if (m === pr) x = c.maxX + r;
        else if (m === pt) z = c.minZ - r;
        else z = c.maxZ + r;
      }
    }
  }
  for (const c of circles) {
    const dx = x - c.x;
    const dz = z - c.z;
    const d = Math.hypot(dx, dz);
    const min = r + c.r;
    if (d < min && d > 1e-8) {
      x = c.x + (dx / d) * min;
      z = c.z + (dz / d) * min;
    }
  }
  return [x, z];
}

// Line of sight in the XZ plane: true when no box or circle blocks the
// segment from (x1, z1) to (x2, z2). Walls are 4 m high, so anything that
// blocks the plan view blocks sight; low crates block only a crouched
// sight line, which this check ignores for simplicity.
export function hasLineOfSight(x1, z1, x2, z2, colliders, circles) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  const steps = Math.ceil(len / 0.5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x1 + dx * t;
    const z = z1 + dz * t;
    for (const c of colliders) {
      if (x >= c.minX - 0.05 && x <= c.maxX + 0.05 && z >= c.minZ - 0.05 && z <= c.maxZ + 0.05) return false;
    }
    for (const c of circles) {
      if (Math.hypot(x - c.x, z - c.z) < c.r) return false;
    }
  }
  return true;
}
