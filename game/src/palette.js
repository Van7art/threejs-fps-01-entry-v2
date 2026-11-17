// Sun-baked desert palette and the procedural canvas textures that paint the yard.
// No image files: every surface is drawn once at boot from these swatches.
export const SWATCH = {
  sand: 0xc9a06a,
  sandDark: 0xa67c46,
  sandLight: 0xe0bd85,
  rust: 0x8a4a26,
  rustLight: 0xb06a35,
  steel: 0x5d6b73,
  steelDark: 0x3d484e,
  pipe: 0x7a6a4a,
  tankCream: 0xd8c9a3,
  tankTeal: 0x3f7a72,
  hazard: 0xd8a013,
  containerRed: 0x8f3b2c,
  containerBlue: 0x2e5d7a,
  containerGreen: 0x4a6b3a,
  concrete: 0x9a8f7c,
  skyTop: 0x7fb2d9,
  skyHorizon: 0xf2cf9a,
  sun: 0xfff2c8,
  foliage: 0x6b7a3a,
};

// Build a small canvas texture from a painter callback, then hand it back as a
// THREE.CanvasTexture with repeat wrapping so the renderer can tile it.
export function paintTexture(THREE, w, h, painter, repeatX, repeatY) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  painter(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX || 1, repeatY || 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function speckle(g, w, h, count, shades, sizeMax) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = shades[(Math.random() * shades.length) | 0];
    const s = 1 + Math.random() * sizeMax;
    g.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

export function sandTexture(THREE) {
  return paintTexture(THREE, 256, 256, (g, w, h) => {
    g.fillStyle = '#c9a06a';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2600, ['#b8935c', '#d8b47e', '#a8824e', '#e0bd85'], 3);
    g.strokeStyle = 'rgba(120,90,50,0.25)';
    for (let i = 0; i < 26; i++) {
      g.beginPath();
      const y = Math.random() * h;
      g.moveTo(0, y);
      g.bezierCurveTo(w * 0.3, y + 8, w * 0.7, y - 8, w, y + 4);
      g.stroke();
    }
  }, 14, 10);
}

export function rustTexture(THREE, base, streak) {
  return paintTexture(THREE, 256, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1800, ['#00000022', '#ffffff18', streak], 4);
    g.fillStyle = 'rgba(60,30,10,0.35)';
    for (let i = 0; i < 30; i++) {
      const x = Math.random() * w;
      g.fillRect(x, Math.random() * h * 0.4, 2 + Math.random() * 4, 30 + Math.random() * 90);
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 3;
    g.strokeRect(2, 2, w - 4, h - 4);
  }, 2, 2);
}

export function hazardTexture(THREE) {
  return paintTexture(THREE, 128, 128, (g, w, h) => {
    g.fillStyle = '#d8a013';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1c1a16';
    for (let i = -2; i < 6; i++) {
      g.save();
      g.translate(i * 32, 0);
      g.rotate(Math.PI / 4);
      g.fillRect(0, -40, 16, 220);
      g.restore();
    }
  }, 6, 1);
}

export function concreteTexture(THREE) {
  return paintTexture(THREE, 256, 256, (g, w, h) => {
    g.fillStyle = '#9a8f7c';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, 2200, ['#8a7f6c', '#a89d88', '#7a6f5c'], 3);
    g.strokeStyle = 'rgba(60,50,40,0.4)';
    g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke();
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke();
    }
  }, 8, 6);
}

// A soft radial blob used for the sun glare sprite and dust puffs.
export function glowTexture(THREE) {
  return paintTexture(THREE, 128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,242,200,1)');
    grad.addColorStop(0.5, 'rgba(255,220,140,0.45)');
    grad.addColorStop(1, 'rgba(255,220,140,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, 1, 1);
}
