import * as THREE from "three";

/**
 * Placeholder figure: a small dark silhouette (long coat, hood, launcher on the back).
 * At game distance it reads as the lone wanderer of the reference images.
 */
export function buildWanderer() {
  const root = new THREE.Group();
  const coat = new THREE.MeshLambertMaterial({ color: "#1c2130" });
  const pants = new THREE.MeshLambertMaterial({ color: "#2a2c33" });
  const metal = new THREE.MeshLambertMaterial({ color: "#5d6878" });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color("#7ff0d0").multiplyScalar(2.2) });

  const legL = new THREE.Group(), legR = new THREE.Group();
  for (const [leg, x] of [[legL, -0.1], [legR, 0.1]] as const) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.62, 3, 8), pants);
    m.position.y = -0.4;
    leg.add(m);
    leg.position.set(x, 0.86, 0);
    root.add(leg);
  }
  // coat: a flared lathe from shoulders to knees
  const prof = [
    new THREE.Vector2(0.0, 1.52), new THREE.Vector2(0.17, 1.5), new THREE.Vector2(0.21, 1.4),
    new THREE.Vector2(0.19, 1.1), new THREE.Vector2(0.24, 0.62), new THREE.Vector2(0.0, 0.62),
  ];
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 10), coat);
  body.scale.z = 0.72;
  root.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), coat);
  head.position.y = 1.66;
  head.scale.set(1, 1.1, 1.05);
  root.add(head);
  const armL = new THREE.Group(), armR = new THREE.Group();
  for (const [arm, x] of [[armL, -0.22], [armR, 0.22]] as const) {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.52, 3, 6), coat);
    m.position.y = -0.3;
    arm.add(m);
    arm.position.set(x, 1.45, 0);
    root.add(arm);
  }
  // launcher slung on the back, diagonal
  const launcher = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.25, 8), metal);
  barrel.rotation.z = Math.PI / 2;
  const line = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.025, 0.025), glow);
  line.position.set(0, 0.075, 0.03);
  launcher.add(barrel, line);
  launcher.position.set(0, 1.25, 0.2);
  launcher.rotation.z = 0.6;
  root.add(launcher);

  let phase = 0;
  return {
    root,
    glow: glow.color,
    animate(dt: number, speed: number, grounded: boolean) {
      phase += dt * (2.2 + speed * 1.1);
      const amp = grounded ? Math.min(speed / 7, 1) * 0.65 : 0.25;
      const s = Math.sin(phase) * amp;
      legL.rotation.x = s; legR.rotation.x = -s;
      armL.rotation.x = -s * 0.8; armR.rotation.x = s * 0.8;
      if (!grounded) { legL.rotation.x = 0.4; legR.rotation.x = -0.2; }
    },
  };
}
