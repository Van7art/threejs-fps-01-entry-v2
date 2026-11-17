// Rendering for Sunscorch Yard: the three.js scene, the desert sun and
// sky, and the short-lived effects (tracers, muzzle flash, explosions, the
// charge marker). The simulation never touches the renderer directly; it
// asks this module for effects through the fx object main.js builds.
//
// Tracers are pooled: a fixed ring of pre-built Line objects is reused, so
// firing never allocates geometry in the hot loop.

import * as THREE from 'three';
import { COLORS } from './palette.js';

const TRACER_POOL = 24;
const TRACER_LIFE_MS = 90;

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(COLORS.sky, 55, 140);

  const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.08, 300);
  camera.rotation.order = 'YXZ';

  // Hard desert sun from the south-east, plus a sky bounce so shadows
  // never go black.
  const sun = new THREE.DirectionalLight(COLORS.sun, 2.6);
  sun.position.set(30, 42, 18);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xcfe4f2, 0xb98d5e, 1.1);
  scene.add(hemi);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera };
}

// Short-lived effects. Tracers come from a fixed pool; the explosion is
// one reusable sphere whose scale and opacity animate; the muzzle flash is
// a single plane on the camera.
export function createEffects(scene) {
  const tracerMatAtk = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
  const tracerMatDef = new THREE.LineBasicMaterial({ color: 0xff9a7a, transparent: true, opacity: 0.9 });
  const pool = [];
  for (let i = 0; i < TRACER_POOL; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMatAtk);
    line.visible = false;
    line.userData.born = -1;
    scene.add(line);
    pool.push(line);
  }
  let poolCursor = 0;

  const flashMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8, transparent: true, opacity: 0 });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), flashMat);
  flash.position.set(0, 0, -0.7);
  flash.visible = false;

  // The charge: a small blinking case on the ground, or on the carrier.
  const charge = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.2, 0.24),
    new THREE.MeshStandardMaterial({ color: 0xffd23e, emissive: 0xaa7700, emissiveIntensity: 0.8, roughness: 0.4 }),
  );
  charge.visible = false;
  scene.add(charge);

  // One reusable explosion sphere, grown and faded by update().
  const boomMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0 });
  const boom = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), boomMat);
  boom.position.set(0, 0.6, 0);
  boom.visible = false;
  boom.scale.setScalar(0.5);
  scene.add(boom);
  let boomStart = -1;

  return {
    flashMesh: flash,
    chargeMesh: charge,
    tracer(x1, y1, z1, x2, y2, z2, team) {
      const line = pool[poolCursor];
      poolCursor = (poolCursor + 1) % TRACER_POOL;
      const pos = line.geometry.attributes.position;
      pos.setXYZ(0, x1, y1, z1);
      pos.setXYZ(1, x2, y2, z2);
      pos.needsUpdate = true;
      line.material = team === 'attackers' ? tracerMatAtk : tracerMatDef;
      line.visible = true;
      line.userData.born = performance.now();
    },
    muzzle() {
      flashMat.opacity = 0.85;
      flash.visible = true;
      setTimeout(() => {
        flashMat.opacity = 0;
        flash.visible = false;
      }, 45);
    },
    explosion(x, z) {
      boom.position.set(x, 0.6, z);
      boom.scale.setScalar(0.5);
      boomMat.opacity = 0.85;
      boom.visible = true;
      boomStart = performance.now();
    },
    update(now) {
      for (const line of pool) {
        if (line.visible && now - line.userData.born > TRACER_LIFE_MS) line.visible = false;
      }
      if (charge.visible) {
        charge.material.emissiveIntensity = 0.6 + Math.sin(now / 180) * 0.5;
      }
      if (boom.visible && boomStart >= 0) {
        const t = (now - boomStart) / 500;
        if (t >= 1) {
          boom.visible = false;
          boomStart = -1;
        } else {
          boom.scale.setScalar(0.5 + t * 6);
          boomMat.opacity = 0.85 * (1 - t);
        }
      }
    },
  };
}
