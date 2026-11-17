// Renderer: turns match state into a three.js desert refinery.
// The sim never touches three.js; this module only reads fighters, grenades
// and events, and keeps every mesh it reuses in pools.
import * as THREE from 'three';
import { SWATCH, sandTexture, rustTexture, hazardTexture, concreteTexture, glowTexture } from './palette.js';
import { SOLIDS, SITES, HAZARDS, YARD } from './map.js';
import { eyeY } from './actors.js';

const TRACER_POOL = 24;
const PUFF_POOL = 10;

export function makeRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SWATCH.skyHorizon);
  scene.fog = new THREE.Fog(0xe8c48d, 55, 130);

  const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.08, 220);
  camera.rotation.order = 'YXZ';
  scene.add(camera); // the camera must be in the scene for its children to render

  // --- lights ------------------------------------------------------------
  const sun = new THREE.DirectionalLight(SWATCH.sun, 2.6);
  sun.position.set(28, 42, -18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfd9ee, 0xc9a06a, 0.85));
  const fill = new THREE.DirectionalLight(0xffd9a0, 0.35);
  fill.position.set(-20, 12, 24);
  scene.add(fill);

  // --- sky dome + sun glare ----------------------------------------------
  const skyGeo = new THREE.SphereGeometry(160, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(SWATCH.skyTop) },
      bottom: { value: new THREE.Color(SWATCH.skyHorizon) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 bottom; void main(){ float h = normalize(vP).y * 0.5 + 0.5; gl_FragColor = vec4(mix(bottom, top, pow(h, 0.75)), 1.0); }',
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(THREE), transparent: true, depthWrite: false, fog: false }));
  glare.position.set(70, 95, -55);
  glare.scale.set(46, 46, 1);
  scene.add(glare);

  // --- ground --------------------------------------------------------------
  const groundMat = new THREE.MeshStandardMaterial({ map: sandTexture(THREE), roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 90), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- materials -----------------------------------------------------------
  const mats = {
    crateRed: new THREE.MeshStandardMaterial({ map: rustTexture(THREE, '#8f3b2c', '#6a2418'), roughness: 0.85 }),
    crateBlue: new THREE.MeshStandardMaterial({ map: rustTexture(THREE, '#2e5d7a', '#1d4258'), roughness: 0.85 }),
    crateGreen: new THREE.MeshStandardMaterial({ map: rustTexture(THREE, '#4a6b3a', '#334d28'), roughness: 0.85 }),
    tank: new THREE.MeshStandardMaterial({ map: rustTexture(THREE, '#d8c9a3', '#8a6a3a'), roughness: 0.55, metalness: 0.35 }),
    tankTeal: new THREE.MeshStandardMaterial({ map: rustTexture(THREE, '#3f7a72', '#2a554e'), roughness: 0.55, metalness: 0.35 }),
    steel: new THREE.MeshStandardMaterial({ color: SWATCH.steel, roughness: 0.5, metalness: 0.6 }),
    steelDark: new THREE.MeshStandardMaterial({ color: SWATCH.steelDark, roughness: 0.6, metalness: 0.5 }),
    pipe: new THREE.MeshStandardMaterial({ color: SWATCH.pipe, roughness: 0.55, metalness: 0.45 }),
    pump: new THREE.MeshStandardMaterial({ map: rustTexture(THREE, '#7a5a34', '#543d20'), roughness: 0.7, metalness: 0.3 }),
    concrete: new THREE.MeshStandardMaterial({ map: concreteTexture(THREE), roughness: 0.95 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTexture(THREE), roughness: 0.9 }),
    gantry: new THREE.MeshStandardMaterial({ color: 0x8a6a2e, roughness: 0.5, metalness: 0.55 }),
  };
  const crateMats = [mats.crateRed, mats.crateBlue, mats.crateGreen];

  // --- yard geometry from the shared solid list ----------------------------
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 20);
  let crateIdx = 0;
  for (const s of SOLIDS) {
    let mesh;
    if (s[5] === 'tank') {
      mesh = new THREE.Mesh(cylGeo, crateIdx % 2 ? mats.tankTeal : mats.tank);
      mesh.scale.set(s[2], s[4], s[3]);
      mesh.position.set(s[0], s[4] / 2, s[1]);
      crateIdx++;
    } else if (s[5] === 'wall') {
      mesh = new THREE.Mesh(boxGeo, mats.concrete);
      mesh.scale.set(s[2] * 2, s[4], s[3] * 2);
      mesh.position.set(s[0], s[4] / 2, s[1]);
    } else if (s[5] === 'pipe') {
      mesh = new THREE.Mesh(cylGeo, mats.pipe);
      mesh.rotation.z = Math.PI / 2;
      mesh.scale.set(s[3] * 0.9, s[2] * 2, s[3] * 0.9);
      mesh.position.set(s[0], 1.1, s[1]);
    } else if (s[5] === 'gantry') {
      mesh = new THREE.Mesh(boxGeo, mats.gantry);
      mesh.scale.set(s[2] * 2, s[4], s[3] * 2);
      mesh.position.set(s[0], s[4] / 2, s[1]);
    } else if (s[5] === 'pump') {
      mesh = new THREE.Mesh(boxGeo, mats.pump);
      mesh.scale.set(s[2] * 2, s[4], s[3] * 2);
      mesh.position.set(s[0], s[4] / 2, s[1]);
    } else {
      mesh = new THREE.Mesh(boxGeo, crateMats[crateIdx++ % crateMats.length]);
      mesh.scale.set(s[2] * 2, s[4], s[3] * 2);
      mesh.position.set(s[0], s[4] / 2, s[1]);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  // gantry deck over mid
  const deck = new THREE.Mesh(boxGeo, mats.gantry);
  deck.scale.set(9, 0.35, 9);
  deck.position.set(0, 5.1, 0);
  deck.castShadow = true;
  deck.receiveShadow = true;
  scene.add(deck);
  // tank caps
  for (const s of SOLIDS) {
    if (s[5] !== 'tank') continue;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.steelDark);
    cap.scale.set(s[2], 1.1, s[3]);
    cap.position.set(s[0], s[4], s[1]);
    scene.add(cap);
  }
  // hazard pads
  for (const h of HAZARDS) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(h[2] * 2, h[3] * 2), mats.hazard);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(h[0], 0.02, h[1]);
    pad.receiveShadow = true;
    scene.add(pad);
  }
  // site markers: glowing rings + letter boards
  function siteRing(site, color) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(site.r, 0.09, 8, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(site.cx, 0.06, site.cz);
    scene.add(ring);
    return ring;
  }
  const ringA = siteRing(SITES.A, 0xffc95e);
  const ringB = siteRing(SITES.B, 0xffc95e);
  // distant dunes + a few dry shrubs for the horizon
  const duneMat = new THREE.MeshStandardMaterial({ color: 0xb8935c, roughness: 1 });
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + 0.3;
    const dune = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), duneMat);
    const dx = Math.cos(ang) * 70, dz = Math.sin(ang) * 70;
    dune.scale.set(26 + (i % 3) * 8, 5 + (i % 2) * 2, 18);
    dune.position.set(dx, -0.5, dz);
    scene.add(dune);
  }
  const shrubMat = new THREE.MeshStandardMaterial({ color: SWATCH.foliage, roughness: 1 });
  const shrubGeo = new THREE.IcosahedronGeometry(0.55, 0);
  const shrubSpots = [[-22, -16], [20, -17], [-24, 15], [24, 17], [-4, 17], [3, -18], [-20, 8], [16, -5]];
  for (const [sx, sz] of shrubSpots) {
    const sh = new THREE.Mesh(shrubGeo, shrubMat);
    sh.position.set(sx, 0.35, sz);
    sh.scale.y = 0.6;
    scene.add(sh);
  }

  // --- fighters ------------------------------------------------------------
  const bodyGeo = new THREE.CapsuleGeometry(0.34, 0.85, 4, 10);
  const headGeo = new THREE.SphereGeometry(0.21, 12, 10);
  const visorGeo = new THREE.BoxGeometry(0.3, 0.09, 0.06);
  const gunGeo = new THREE.BoxGeometry(0.09, 0.13, 0.72);
  const teamMats = {
    attack: new THREE.MeshStandardMaterial({ color: 0xc96a2e, roughness: 0.8 }),
    defend: new THREE.MeshStandardMaterial({ color: 0x3a6ea8, roughness: 0.8 }),
  };
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.2, metalness: 0.7 });
  const fighterMeshes = new Map();
  function fighterMesh(f) {
    let rec = fighterMeshes.get(f.id);
    if (rec) return rec;
    const group = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, teamMats[f.team]);
    body.position.y = 0.95;
    body.castShadow = true;
    const head = new THREE.Mesh(headGeo, darkMat);
    head.position.y = 1.62;
    head.castShadow = true;
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 1.62, -0.19);
    const gun = new THREE.Mesh(gunGeo, darkMat);
    gun.position.set(0.28, 1.15, -0.42);
    group.add(body, head, visor, gun);
    // name sprite above the head for teammates
    scene.add(group);
    rec = { group, body, head, gun };
    fighterMeshes.set(f.id, rec);
    return rec;
  }

  // --- viewmodel gun -------------------------------------------------------
  const vmGroup = new THREE.Group();
  const vmBody = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.16, 0.62), new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.45, metalness: 0.6 }));
  const vmBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0x16191c, roughness: 0.35, metalness: 0.7 }));
  vmBarrel.rotation.x = Math.PI / 2;
  vmBarrel.position.set(0, 0.02, -0.48);
  const vmGrip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.1), new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 0.8 }));
  vmGrip.position.set(0, -0.14, 0.12);
  vmGroup.add(vmBody, vmBarrel, vmGrip);
  vmGroup.position.set(0.34, -0.34, -0.62);
  camera.add(vmGroup); // rides with the camera, so it reads as a held weapon

  // --- charge model ----------------------------------------------------------
  const chargeGroup = new THREE.Group();
  const chargeBox = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0x8f2a1a, roughness: 0.6 }));
  const chargeLight = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
  chargeLight.position.set(0, 0.18, 0);
  chargeGroup.add(chargeBox, chargeLight);
  chargeGroup.visible = false;
  scene.add(chargeGroup);

  // --- pooled tracers --------------------------------------------------------
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIdx = 0;
  function spawnTracer(x0, y0, z0, x1, y1, z1, color) {
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % TRACER_POOL;
    const pos = t.line.geometry.attributes.position.array;
    pos[0] = x0; pos[1] = y0; pos[2] = z0;
    pos[3] = x1; pos[4] = y1; pos[5] = z1;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.line.material.opacity = 0.9;
    t.life = 0.09;
  }

  // --- pooled impact puffs -----------------------------------------------------
  const puffs = [];
  for (let i = 0; i < PUFF_POOL; i++) {
    const p = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(THREE), color: 0xd8b47e, transparent: true, opacity: 0, depthWrite: false }));
    p.scale.set(0.7, 0.7, 1);
    scene.add(p);
    puffs.push({ sprite: p, life: 0 });
  }
  let puffIdx = 0;
  function spawnPuff(x, y, z, scale) {
    const p = puffs[puffIdx];
    puffIdx = (puffIdx + 1) % PUFF_POOL;
    p.sprite.position.set(x, y, z);
    p.sprite.scale.set(scale, scale, 1);
    p.sprite.material.opacity = 0.85;
    p.life = 0.35;
  }

  // --- pooled grenade spheres (created once, reused every frame) ----------
  const grenadeMeshes = [];
  {
    const grenadeGeo = new THREE.SphereGeometry(0.14, 10, 8);
    const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2e4a2a, roughness: 0.6 });
    for (let i = 0; i < 6; i++) {
      const gm = new THREE.Mesh(grenadeGeo, grenadeMat);
      gm.visible = false;
      gm.castShadow = true;
      scene.add(gm);
      grenadeMeshes.push(gm);
    }
  }

  // --- explosion flash ---------------------------------------------------------
  const boomLight = new THREE.PointLight(0xffa040, 0, 22, 1.6);
  scene.add(boomLight);
  let boomLife = 0;

  // --- flash overlay -------------------------------------------------------------
  const flashDiv = document.createElement('div');
  flashDiv.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:5';
  document.body.appendChild(flashDiv);

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);

  return {
    resize,
    render(m, player, dt, time) {
      // camera from the player
      if (player) {
        camera.position.set(player.x, eyeY(player), player.z);
        camera.rotation.y = player.yaw + (player.recoilPitch || 0) * 0.4;
        camera.rotation.x = player.pitch - (player.recoilPitch || 0);
        const targetFov = player.ads ? 52 : 78;
        if (Math.abs(camera.fov - targetFov) > 0.2) {
          camera.fov += (targetFov - camera.fov) * Math.min(1, 10 * dt);
          camera.updateProjectionMatrix();
        }
        // viewmodel sway + recoil kick
        vmGroup.position.x = 0.34 + Math.sin(time * 1.4) * 0.004;
        vmGroup.position.y = -0.34 - (player.recoilPitch || 0) * 0.9 + (player.ads ? 0.1 : 0);
        vmGroup.position.z = -0.62 + (player.recoilPitch || 0) * 1.2;
        vmGroup.visible = player.alive;
        // flash blindness
        flashDiv.style.opacity = player.flashTime > 0 ? Math.min(0.95, player.flashTime) : 0;
      }
      // fighters
      const seen = new Set();
      for (const f of m.fighters) {
        seen.add(f.id);
        const rec = fighterMesh(f);
        rec.group.visible = f.alive && !f.isPlayer;
        if (!f.alive || f.isPlayer) continue;
        rec.group.position.set(f.x, f.y, f.z);
        rec.group.rotation.y = f.yaw + Math.PI;
        const bob = f.moving ? Math.sin(time * 11 + f.id) * 0.04 : 0;
        rec.body.position.y = 0.95 + bob;
        rec.group.scale.y = f.crouch ? 0.78 : 1;
      }
      for (const [id, rec] of fighterMeshes) {
        if (!seen.has(id)) { scene.remove(rec.group); fighterMeshes.delete(id); }
      }
      // charge: carried blip, dropped box, planted box with blinking light
      if (m.planted) {
        chargeGroup.visible = true;
        chargeGroup.position.set(m.plantX, 0.2, m.plantZ);
        chargeLight.material.color.setHex(Math.sin(time * 9) > 0 ? 0xff3020 : 0x40100a);
      } else if (m.chargeDropped) {
        chargeGroup.visible = true;
        chargeGroup.position.set(m.chargeDropped.x, 0.2, m.chargeDropped.z);
        chargeLight.material.color.setHex(0xffc95e);
      } else {
        chargeGroup.visible = false;
      }
      // grenades in flight, drawn from the pooled dark spheres
      for (let i = 0; i < grenadeMeshes.length; i++) {
        const g = m.grenades[i];
        if (g) {
          grenadeMeshes[i].visible = true;
          grenadeMeshes[i].position.set(g.x, g.y, g.z);
        } else {
          grenadeMeshes[i].visible = false;
        }
      }
      // site rings pulse while the charge is live there
      const pulse = 0.55 + Math.sin(time * 5) * 0.25;
      ringA.material.opacity = m.planted && m.plantSite === 'A' ? pulse : 0.4;
      ringB.material.opacity = m.planted && m.plantSite === 'B' ? pulse : 0.4;
      // consume sim events
      for (const ev of m.events) {
        if (ev.kind === 'tracer') spawnTracer(ev.x0, ev.y0, ev.z0, ev.x1, ev.y1, ev.z1, ev.color);
        else if (ev.kind === 'impact') spawnPuff(ev.x, ev.y, ev.z, 0.8);
        else if (ev.kind === 'explosion') {
          boomLight.position.set(ev.x, ev.y + 1, ev.z);
          boomLight.intensity = 60;
          boomLife = 0.5;
          spawnPuff(ev.x, ev.y + 0.5, ev.z, 4);
        }
      }
      m.events.length = 0;
      // fade tracers / puffs / boom light
      for (const t of tracers) {
        if (t.life > 0) {
          t.life -= dt;
          if (t.life <= 0) t.line.material.opacity = 0;
          else t.line.material.opacity = t.life / 0.09 * 0.9;
        }
      }
      for (const p of puffs) {
        if (p.life > 0) {
          p.life -= dt;
          p.sprite.material.opacity = Math.max(0, p.life / 0.35) * 0.85;
        }
      }
      if (boomLife > 0) {
        boomLife -= dt;
        boomLight.intensity = Math.max(0, boomLife / 0.5) * 60;
      }
      renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener('resize', resize);
      flashDiv.remove();
      renderer.dispose();
    },
  };
}
