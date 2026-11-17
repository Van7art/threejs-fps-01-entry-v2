// Palette and procedural textures for Sunscorch Yard.
//
// No image assets ship with the game at all: every surface is painted on
// a canvas at load time, so the whole game is plain files and the browser
// makes zero network requests. The palette is a desert refinery at noon —
// bleached sand, rusted orange steel, sun-faded teal paint, oil-stained
// concrete, a hard pale sky — chosen so the two teams read at a glance:
// attackers in rust orange, defenders in deep teal-blue.

import * as THREE from 'three';

export const COLORS = {
  sand: 0xd9b380,
  sandDark: 0xb98d5e,
  rust: 0xb4552a,
  rustDark: 0x7e3a1e,
  teal: 0x2e7f7a,
  tealDark: 0x1f5753,
  concrete: 0x9a938a,
  concreteDark: 0x6f6a62,
  wallTop: 0xe8d9b8,
  pipe: 0x8a8f94,
  pipeDark: 0x565b60,
  tank: 0xc8a24a,
  tankDark: 0x9c7c33,
  sky: 0xbfd9e8,
  sun: 0xfff2d0,
  attacker: 0xd95d1e,
  defender: 0x1e7fa8,
};

// A tiny deterministic LCG just for painting textures, so the grain is the
// same on every load. It is separate from the match rng in rng.js.
function textureRng() {
  let s = 987654321;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function paintSpeckles(ctx, w, h, base, flecks, count, rng) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = flecks[Math.floor(rng() * flecks.length)];
    ctx.globalAlpha = 0.08 + rng() * 0.16;
    const s = 1 + rng() * 4;
    ctx.fillRect(rng() * w, rng() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

function canvasTexture(size, painter) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  painter(ctx, size, textureRng());
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function sandTexture() {
  return canvasTexture(256, (ctx, s, rng) => {
    paintSpeckles(ctx, s, s, '#d9b380', ['#c9a06e', '#e8c99a', '#b98d5e', '#f0d4a8'], 2600, rng);
    // Wind ripples: faint wavy horizontal bands.
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = '#8a6a42';
    for (let y = 8; y < s; y += 14) {
      ctx.beginPath();
      for (let x = 0; x <= s; x += 16) {
        ctx.lineTo(x, y + Math.sin(x * 0.05 + y) * 2);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });
}

export function metalTexture(base, streak) {
  return canvasTexture(128, (ctx, s, rng) => {
    paintSpeckles(ctx, s, s, base, [streak, '#00000022', '#ffffff18'], 900, rng);
    // Vertical rust streaks running down the metal.
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = streak;
    for (let i = 0; i < 22; i++) {
      const x = rng() * s;
      ctx.fillRect(x, rng() * s * 0.4, 2 + rng() * 3, 20 + rng() * 60);
    }
    ctx.globalAlpha = 1;
  });
}

export function concreteTexture() {
  return canvasTexture(128, (ctx, s, rng) => {
    paintSpeckles(ctx, s, s, '#9a938a', ['#8a837a', '#a8a29a', '#6f6a62'], 1400, rng);
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = '#5d5850';
    ctx.strokeRect(0.5, 0.5, s - 1, s - 1);
    ctx.globalAlpha = 1;
  });
}

export function hazardTexture() {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#d8c24a';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#22201c';
    for (let i = -2; i < 6; i++) {
      ctx.save();
      ctx.translate(i * 32, 0);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(0, -20, 16, s + 40);
      ctx.restore();
    }
  });
}

// One shared material set for the whole map. Textures are created once
// here; map.js clones the sand material so the ground can repeat it.
export function materials() {
  return {
    sand: new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 1, metalness: 0 }),
    concrete: new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95, metalness: 0 }),
    rust: new THREE.MeshStandardMaterial({ map: metalTexture('#b4552a', '#5e2a12'), roughness: 0.8, metalness: 0.35 }),
    rustDark: new THREE.MeshStandardMaterial({ map: metalTexture('#7e3a1e', '#3e1c0c'), roughness: 0.85, metalness: 0.3 }),
    teal: new THREE.MeshStandardMaterial({ map: metalTexture('#2e7f7a', '#123f3c'), roughness: 0.75, metalness: 0.35 }),
    tealDark: new THREE.MeshStandardMaterial({ map: metalTexture('#1f5753', '#0e2c2a'), roughness: 0.8, metalness: 0.3 }),
    pipe: new THREE.MeshStandardMaterial({ map: metalTexture('#8a8f94', '#3c4045'), roughness: 0.5, metalness: 0.7 }),
    pipeDark: new THREE.MeshStandardMaterial({ map: metalTexture('#565b60', '#2a2d30'), roughness: 0.55, metalness: 0.7 }),
    tank: new THREE.MeshStandardMaterial({ map: metalTexture('#c8a24a', '#6e5620'), roughness: 0.6, metalness: 0.5 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.9, metalness: 0 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.9, metalness: 0.1 }),
  };
}
