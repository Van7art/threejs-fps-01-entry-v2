// The yard: a 56 x 40 m desert refinery with three lanes, two plant sites,
// a mid gantry, and a waypoint graph the bots walk.
// Coordinates: x east-west (-28..28), z north-south (-20..20), y up.
// Attackers (Sand Vipers) spawn west, defenders (Dune Wardens) east.
export const YARD = { halfX: 28, halfZ: 20, wallH: 4.2 };

export const SITES = {
  A: { name: 'Pump House', cx: 19, cz: -12, r: 4.2 },
  B: { name: 'Tank Farm', cx: 19, cz: 12, r: 4.6 },
};

export const SPAWNS = {
  attack: [
    [-25.5, -6], [-25.5, -2], [-25.5, 2], [-25.5, 6], [-24, 0],
  ],
  defend: [
    [25.5, -8], [25.5, -3], [25.5, 3], [25.5, 8], [23.5, 0],
  ],
};

// Solid boxes: [cx, cz, halfX, halfZ, height, kind]
// kind drives the render material: crate, tank, wall, pipe, pump, gantry.
export const SOLIDS = [
  // perimeter walls (also enforced by bounds, but visible)
  [0, -20.6, 28.6, 0.6, 4.2, 'wall'],
  [0, 20.6, 28.6, 0.6, 4.2, 'wall'],
  [-28.6, 0, 0.6, 20.6, 4.2, 'wall'],
  [28.6, 0, 0.6, 20.6, 4.2, 'wall'],
  // mid gantry pillars + deck base (deck is visual, pillars block)
  [-1.2, -3.2, 0.7, 0.7, 5.0, 'gantry'],
  [-1.2, 3.2, 0.7, 0.7, 5.0, 'gantry'],
  [1.2, -3.2, 0.7, 0.7, 5.0, 'gantry'],
  [1.2, 3.2, 0.7, 0.7, 5.0, 'gantry'],
  // north lane container row
  [-14, -13.5, 3.2, 1.3, 2.6, 'crate'],
  [-8, -13.5, 3.2, 1.3, 2.6, 'crate'],
  [-11, -13.5, 2.4, 1.2, 5.0, 'crate'], // stacked pair reads as one tall block
  [6, -14.5, 2.6, 1.3, 2.6, 'crate'],
  [12, -14.5, 2.6, 1.3, 2.6, 'crate'],
  // south lane container row
  [-14, 13.5, 3.2, 1.3, 2.6, 'crate'],
  [-8, 13.5, 3.2, 1.3, 2.6, 'crate'],
  [6, 14.5, 2.6, 1.3, 2.6, 'crate'],
  [12, 14.5, 2.6, 1.3, 2.6, 'crate'],
  // mid lane cover
  [-18, 0, 1.4, 2.2, 2.4, 'crate'],
  [-6, -6.5, 1.8, 1.0, 1.2, 'crate'],
  [-6, 6.5, 1.8, 1.0, 1.2, 'crate'],
  [8, -6, 1.6, 1.0, 1.2, 'crate'],
  [8, 6, 1.6, 1.0, 1.2, 'crate'],
  // Tank Farm: two big storage tanks at Site B
  [17, 9.5, 2.6, 2.6, 6.0, 'tank'],
  [21.5, 14.5, 2.6, 2.6, 6.0, 'tank'],
  // Pump House block at Site A
  [19, -12, 3.0, 2.2, 3.4, 'pump'],
  [15.5, -16.5, 1.6, 1.2, 2.2, 'pump'],
  // pipe racks along the north and south edges
  [-2, -18.4, 12, 0.8, 1.6, 'pipe'],
  [-2, 18.4, 12, 0.8, 1.6, 'pipe'],
  // defender-side cover near the sites
  [14, -6, 1.4, 1.4, 2.2, 'crate'],
  [14, 6, 1.4, 1.4, 2.2, 'crate'],
  [22, -2, 1.2, 2.0, 2.0, 'crate'],
  [22, 2, 1.2, 2.0, 2.0, 'crate'],
];

// Low hazard pads (visual + slight slow): [cx, cz, halfX, halfZ]
export const HAZARDS = [
  [0, 0, 3.4, 3.4],
  [19, 12, 4.6, 4.6],
];

// Waypoint graph. Nodes are open yard points; edges are walkable links.
// Bots BFS through it. Node ids are indexes into this array.
export const NODES = [
  [-25, -4], [-25, 0], [-25, 4],          // 0-2 attacker spawn
  [-19, -13], [-19, 0], [-19, 13],        // 3-5 west junctions
  [-12, -13], [-12, 0], [-12, 13],        // 6-8 west-mid
  [-4, -13], [-4, 0], [-4, 13],            // 9-11 mid-west
  [0, -8], [0, 0], [0, 8],                 // 12-14 gantry ring
  [5, -13], [5, 0], [5, 13],               // 15-17 mid-east
  [11, -13], [11, 0], [11, 13],            // 18-20 east-mid
  [16, -8], [16, 0], [16, 8],              // 21-23 site approach
  [19, -12], [19, 12],                     // 24-25 sites A / B
  [25, -6], [25, 0], [25, 6],              // 26-28 defender spawn
  [-12, -18], [-12, 18], [12, -18], [12, 18], // 29-32 pipe-lane flanks
];

const LINK_PAIRS = [
  [0, 3], [1, 4], [2, 5],
  [3, 6], [4, 7], [5, 8],
  [6, 9], [7, 10], [8, 11],
  [9, 12], [10, 13], [11, 14],
  [12, 13], [13, 14], [12, 15], [13, 16], [14, 17],
  [15, 18], [16, 19], [17, 20],
  [18, 21], [19, 22], [20, 23],
  [21, 24], [23, 25], [22, 24], [22, 25],
  [24, 26], [25, 28], [22, 27],
  [26, 27], [27, 28],
  [3, 29], [5, 30], [9, 29], [11, 30],
  [15, 31], [17, 32], [18, 31], [20, 32],
  [29, 30], [31, 32],
  [6, 7], [7, 8], [9, 10], [10, 11],
  [15, 16], [16, 17], [18, 19], [19, 20],
  [21, 22], [22, 23],
];

export function buildGraph() {
  const adj = NODES.map(() => []);
  for (const [a, b] of LINK_PAIRS) {
    adj[a].push(b);
    adj[b].push(a);
  }
  return adj;
}

// Breadth-first shortest path between node ids. Returns an array of node
// ids including start and goal, or [] when unreachable.
export function findPath(adj, start, goal) {
  if (start === goal) return [start];
  const prev = new Int16Array(NODES.length).fill(-1);
  const seen = new Uint8Array(NODES.length);
  const queue = [start];
  seen[start] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    for (const nb of adj[cur]) {
      if (seen[nb]) continue;
      seen[nb] = 1;
      prev[nb] = cur;
      if (nb === goal) {
        const path = [goal];
        let n = goal;
        while (prev[n] !== -1) { n = prev[n]; path.push(n); }
        path.reverse();
        return path;
      }
      queue.push(nb);
    }
  }
  return [];
}

export function nearestNode(x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < NODES.length; i++) {
    const dx = NODES[i][0] - x, dz = NODES[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Circle (actor) vs solid boxes + yard bounds. Pushes the actor out and
// returns true when a collision happened. Hazard pads slow movement.
export function collideCircle(x, z, r) {
  let nx = x, nz = z, hit = false;
  for (let i = 0; i < SOLIDS.length; i++) {
    const s = SOLIDS[i];
    const minX = s[0] - s[2] - r, maxX = s[0] + s[2] + r;
    const minZ = s[1] - s[3] - r, maxZ = s[1] + s[3] + r;
    if (nx > minX && nx < maxX && nz > minZ && nz < maxZ) {
      const dxl = nx - minX, dxr = maxX - nx;
      const dzl = nz - minZ, dzr = maxZ - nz;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) nx = minX;
      else if (m === dxr) nx = maxX;
      else if (m === dzl) nz = minZ;
      else nz = maxZ;
      hit = true;
    }
  }
  const bx = YARD.halfX - r, bz = YARD.halfZ - r;
  if (nx < -bx) { nx = -bx; hit = true; }
  if (nx > bx) { nx = bx; hit = true; }
  if (nz < -bz) { nz = -bz; hit = true; }
  if (nz > bz) { nz = bz; hit = true; }
  return { x: nx, z: nz, hit };
}

export function inHazard(x, z) {
  for (const h of HAZARDS) {
    if (Math.abs(x - h[0]) < h[2] && Math.abs(z - h[1]) < h[3]) return true;
  }
  return false;
}

// Segment vs solid boxes: true when the line of sight is blocked.
// Used for bot vision and for tracer occlusion.
export function sightBlocked(x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return false;
  const steps = Math.ceil(len / 0.5);
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const px = x0 + dx * t, py = y0 + dy * t, pz = z0 + dz * t;
    if (py < 0.1 || py > YARD.wallH + 1) continue;
    for (let i = 0; i < SOLIDS.length; i++) {
      const b = SOLIDS[i];
      if (b[4] < py) continue;
      if (Math.abs(px - b[0]) < b[2] && Math.abs(pz - b[1]) < b[3]) return true;
    }
  }
  return false;
}
