
import * as THREE from "three";

export function playAttackFX(attackerMesh: THREE.Mesh, yaw: number, scene: THREE.Scene) {
  // petite "lame" devant le joueur
  const w = 1, h = 0.5, d = 1.2; // largeur / hauteur / profondeur (vers l'avant)
  const geo = new THREE.BoxGeometry(w, h, d);

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffdd66,
    emissive: 0xffaa33,
    emissiveIntensity: 1.2,
    transparent: true,
    opacity: 0.9,
  });
  mat.depthWrite = false;
  mat.blending = THREE.AdditiveBlending;

  const fx = new THREE.Mesh(geo, mat);
  fx.castShadow = false;
  fx.receiveShadow = false;

  // place le FX devant l’attaquant
  fx.position.copy(attackerMesh.position);
  const forward = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(0, yaw, 0));
  fx.position.addScaledVector(forward, 0.8); // un peu devant
  //fx.position.y += 0.5;                        // hauteur du "coup"
  fx.rotation.y = yaw;

  // léger arc : on incline un peu
  fx.rotation.x = -0.25;

  scene.add(fx);

  // animation courte: scale + fade out (120 ms)
  const start = performance.now();
  const dur = 120;
  const startScale = new THREE.Vector3(0.6, 0.6, 0.6);
  const endScale   = new THREE.Vector3(1.2, 0.9, 1.1);

  function step() {
    const t = Math.min(1, (performance.now() - start) / dur);
    fx.scale.lerpVectors(startScale, endScale, t);
    (fx.material as THREE.MeshStandardMaterial).opacity = 0.9 * (1 - t);
    if (t < 1) requestAnimationFrame(step);
    else {
      scene.remove(fx);
      geo.dispose();
      (fx.material as THREE.Material).dispose();
    }
  }
  step();
}