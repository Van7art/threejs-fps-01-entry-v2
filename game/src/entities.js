// Fighters: the low-poly humanoid meshes for bots and the view model for
// the player, plus the hitboxes the shooting code raycasts against.
//
// A fighter is a group of boxes: legs, torso with a vest, head with a team
// band, arms and a gun. Team colour marks the torso and the head band, so a
// silhouette reads at a glance — rust orange for attackers, deep blue for
// defenders. The hitbox is two volumes, a head sphere and a body cylinder;
// the raycaster tests those analytic volumes, never the visible meshes, so
// a shot that clips a gun barrel does not count as a hit.

import * as THREE from 'three';
import { COLORS } from './palette.js';

export const BODY_HEIGHT = 1.75;
export const EYE_HEIGHT = 1.62;
export const HEAD_Y = 1.58;
export const BODY_RADIUS = 0.42;

export function makeFighter(team, name) {
  const colour = team === 'attackers' ? COLORS.attacker : COLORS.defender;
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2723, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc79b6d, roughness: 0.8 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.62, 0.3), cloth);
  torso.position.y = 1.12;
  group.add(torso);

  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.3, 0.34), dark);
  vest.position.y = 1.18;
  group.add(vest);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skin);
  head.position.y = HEAD_Y;
  group.add(head);

  const band = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.32), cloth);
  band.position.y = 1.66;
  group.add(band);

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.78, 0.22), dark);
  legL.position.set(-0.14, 0.39, 0);
  group.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.14;
  group.add(legR);

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.16), cloth);
  armL.position.set(-0.36, 1.15, 0.12);
  armL.rotation.x = -0.9;
  group.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.36;
  group.add(armR);

  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.75), dark);
  gun.position.set(0.18, 1.25, 0.45);
  group.add(gun);

  // Invisible hit volumes, named so a raycast can tell head from body.
  const headHit = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  headHit.position.y = HEAD_Y;
  headHit.name = 'head';
  group.add(headHit);
  const bodyHit = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.35, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
  bodyHit.position.y = 0.95;
  bodyHit.name = 'body';
  group.add(bodyHit);

  group.userData = { team, name, legL, legR, armL, armR, headHit, bodyHit };
  return group;
}

// Walk cycle: legs swing opposite, arms counter-swing a little.
export function animateFighter(group, phase, speed) {
  const swing = Math.min(1, speed / 4) * 0.6;
  const { legL, legR, armL, armR } = group.userData;
  legL.rotation.x = Math.sin(phase) * swing;
  legR.rotation.x = -Math.sin(phase) * swing;
  armL.rotation.x = -0.9 + Math.sin(phase) * swing * 0.4;
  armR.rotation.x = -0.9 - Math.sin(phase) * swing * 0.4;
}

// A first-person view model: a simple gun that bobs with movement and kicks
// when fired. It lives on the camera, so it never collides with the world.
export function makeViewModel() {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x6b655f, roughness: 0.7, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({ color: COLORS.rust, roughness: 0.6, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), dark);
  group.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.42);
  group.add(barrel);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.08), accent);
  sight.position.set(0, 0.1, -0.15);
  group.add(sight);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.1), dark);
  grip.position.set(0, -0.14, 0.12);
  grip.rotation.x = 0.35;
  group.add(grip);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.1), accent);
  mag.position.set(0, -0.14, -0.08);
  group.add(mag);
  // Small and low in the frame: a view model should read as a gun in the
  // player's hands, not a wall in front of the camera.
  group.scale.setScalar(0.42);
  group.position.set(0.22, -0.2, -0.7);
  return group;
}
