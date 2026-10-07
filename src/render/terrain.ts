import * as THREE from "three";
import { PILLARS, terrainHeight } from "../game/world";

export function buildTerrain(): THREE.Object3D {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(300, 300, 75, 75).toNonIndexed();
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const lo = new THREE.Color("#5e9b5a"), hi = new THREE.Color("#c9d98a");
  for (let i = 0; i < pos.count; i++) {
    const y = terrainHeight(pos.getX(i), pos.getZ(i));
    pos.setY(i, y);
    const c = lo.clone().lerp(hi, THREE.MathUtils.clamp((y + 6) / 12, 0, 1));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));

  const rock = new THREE.MeshLambertMaterial({ color: "#8d8aa3", flatShading: true });
  const cap = new THREE.MeshLambertMaterial({ color: "#b9d8a0", flatShading: true });
  for (const p of PILLARS) {
    const base = terrainHeight(p.x, p.z) - 8;
    const h = p.top - base;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 1.12, h, 9), rock);
    body.position.set(p.x, base + h / 2, p.z);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.98, p.r * 0.98, 0.25, 9), cap);
    top.position.set(p.x, p.top - 0.12, p.z);
    group.add(body, top);
  }
  return group;
}
