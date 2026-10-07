import * as THREE from "three";

// 초저폴리 캐릭터 (CHARACTER_CONCEPT.md). 단위 m, 키 약 1.7, 발 y=0, 정면 -Z, 캐릭터 오른쪽 +X.
// 모든 부위는 BufferGeometry 정점/인덱스를 직접 조립하고 VertexColor만 사용한다.

const PAL = {
  hood: "#2A2A2A",
  skin: "#D9A891",
  shirt: "#E8DCC8",
  pants: "#8B7355",
  boots: "#1A1A1A",
  metal: "#808080",
  metalDark: "#4a4a4a",
  energy: "#00D9FF",
  lens: "#1a3a4d",
  belt: "#3a3a3a",
  grip: "#111111",
  pin: "#C9C9C9",
};

type V3 = [number, number, number];

class Builder {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  /** 정점 추가. 반환값은 시작 인덱스. */
  private add(points: V3[], colors: THREE.Color[]): number {
    const base = this.pos.length / 3;
    points.forEach((p, i) => {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(colors[i].r, colors[i].g, colors[i].b);
    });
    return base;
  }

  /** 볼록 입체: 삼각형 각각을 부위 중심 기준 바깥쪽으로 감는다. */
  private convex(points: V3[], colors: THREE.Color[], tris: number[][]): void {
    const base = this.add(points, colors);
    const c = new THREE.Vector3();
    points.forEach((p) => c.add(new THREE.Vector3(...p)));
    c.multiplyScalar(1 / points.length);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    for (const [i, j, k] of tris) {
      a.set(...points[i]); b.set(...points[j]); d.set(...points[k]);
      const n = b.clone().sub(a).cross(d.clone().sub(a));
      const mid = a.clone().add(b).add(d).multiplyScalar(1 / 3).sub(c);
      if (n.dot(mid) >= 0) this.idx.push(base + i, base + j, base + k);
      else this.idx.push(base + i, base + k, base + j);
    }
  }

  /** 평면 조각: 지정한 방향(dir)을 앞면으로 감는다. */
  private flat(points: V3[], colors: THREE.Color[], tris: number[][], dir: V3): void {
    const base = this.add(points, colors);
    const w = new THREE.Vector3(...dir);
    for (const [i, j, k] of tris) {
      const a = new THREE.Vector3(...points[i]);
      const n = new THREE.Vector3(...points[j]).sub(a).cross(new THREE.Vector3(...points[k]).sub(a));
      if (n.dot(w) >= 0) this.idx.push(base + i, base + j, base + k);
      else this.idx.push(base + i, base + k, base + j);
    }
  }

  /** 8정점 상자. topScale로 위쪽 XZ를 줄여 사다리꼴로 만든다. */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, bottom: string, top = bottom, topScale = 1): void {
    const pts: V3[] = [];
    const cols: THREE.Color[] = [];
    for (const [y, s, c] of [[-0.5, 1, bottom], [0.5, topScale, top]] as const) {
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pts.push([cx + x * 0.5 * sx * s, cy + y * sy, cz + z * 0.5 * sz * s]);
        cols.push(new THREE.Color(c));
      }
    }
    this.convex(pts, cols, [
      [0, 1, 2], [0, 2, 3], [4, 5, 6], [4, 6, 7],
      [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
    ]);
  }

  /** n각 프리즘(2n 정점). axis 방향으로 length만큼, 시작면은 start 쪽. */
  prism(n: number, axis: "y" | "z", start: V3, length: number, r0: number, r1: number, c0: string, c1 = c0): void {
    const pts: V3[] = [];
    const cols: THREE.Color[] = [];
    for (const [t, r, c] of [[0, r0, c0], [length, r1, c1]] as const) {
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const u = Math.cos(ang) * r, v = Math.sin(ang) * r;
        pts.push(axis === "y" ? [start[0] + u, start[1] + t, start[2] + v] : [start[0] + u, start[1] + v, start[2] + t]);
        cols.push(new THREE.Color(c));
      }
    }
    const tris: number[][] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tris.push([i, j, n + j], [i, n + j, n + i]);
    }
    for (let i = 1; i < n - 1; i++) tris.push([0, i, i + 1], [n, n + i, n + i + 1]);
    this.convex(pts, cols, tris);
  }

  /** 정면(-Z)을 향한 n각 원판 (n정점 팬). */
  disc(n: number, cx: number, cy: number, cz: number, r: number, color: string): void {
    const pts: V3[] = [];
    const cols: THREE.Color[] = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, cz]);
      cols.push(new THREE.Color(color));
    }
    const tris: number[][] = [];
    for (let i = 1; i < n - 1; i++) tris.push([0, i, i + 1]);
    this.flat(pts, cols, tris, [0, 0, -1]);
  }

  /** 삼각형 한 장(독립 정점 3개). */
  tri(a: V3, b: V3, c: V3, color: string, dir: V3): void {
    this.flat([a, b, c], [new THREE.Color(color), new THREE.Color(color), new THREE.Color(color)], [[0, 1, 2]], dir);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(this.idx), 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

export function createCharacterGeometry(): THREE.BufferGeometry {
  const b = new Builder();

  // 다리 x2 (6각, 부츠->바지 그라디언트) : 24
  for (const x of [-0.13, 0.13]) b.prism(6, "y", [x, 0, 0], 0.8, 0.1, 0.12, PAL.boots, PAL.pants);

  // 몸통: 사다리꼴 (허리 넓고 어깨 좁음) : 8
  b.box(0, 1.1, 0, 0.5, 0.5, 0.28, PAL.shirt, PAL.shirt, 0.85);
  // 벨트 : 8
  b.box(0, 0.86, 0, 0.54, 0.08, 0.32, PAL.belt);

  // 팔 x2 (6각, 소매->살색) : 24. 오른팔은 발사기 쪽으로 앞으로 뻗음
  b.prism(6, "y", [-0.33, 0.85, 0], 0.7, 0.07, 0.08, PAL.skin, PAL.shirt);
  b.prism(6, "z", [0.33, 1.2, 0.0], -0.55, 0.07, 0.07, PAL.shirt, PAL.skin);

  // 머리 : 10각 프리즘 (20) — 얼굴은 후드/고글로 가림
  b.prism(10, "y", [0, 1.4, 0], 0.28, 0.17, 0.17, PAL.hood);
  // 후드: 뒤/옆으로 흘러내리는 삼각형 4장 (12)
  b.tri([-0.18, 1.68, 0.1], [0.18, 1.68, 0.1], [0, 1.12, 0.3], PAL.hood, [0, 0, 1]);
  b.tri([0.18, 1.68, 0.1], [0.19, 1.5, -0.1], [0.3, 1.2, 0.08], PAL.hood, [1, 0, 0]);
  b.tri([-0.18, 1.68, 0.1], [-0.19, 1.5, -0.1], [-0.3, 1.2, 0.08], PAL.hood, [-1, 0, 0]);
  b.tri([-0.2, 1.4, 0.1], [0.2, 1.4, 0.1], [0, 1.0, 0.28], PAL.hood, [0, 0, 1]);

  // 고글: 정면(-Z)에 렌즈 2개 (16)
  for (const x of [-0.07, 0.07]) b.disc(8, x, 1.56, -0.172, 0.055, PAL.lens);

  // 발사기 (오른쪽 어깨, 앞=-Z) : 52
  b.prism(6, "z", [0.4, 1.38, 0.05], -1.1, 0.035, 0.035, PAL.metal, PAL.metalDark); // 포신 12
  b.box(0.4, 1.38, 0.2, 0.14, 0.14, 0.45, PAL.metalDark, PAL.metal); // 챔버 8
  b.box(0.4, 1.47, -0.05, 0.08, 0.05, 0.4, PAL.energy); // 코일 발광선 8
  b.box(0.4, 1.22, 0.0, 0.07, 0.2, 0.14, PAL.metalDark); // 탄창 8
  b.box(0.4, 1.2, 0.3, 0.06, 0.22, 0.08, PAL.grip); // 손잡이 8
  b.box(0.4, 1.52, 0.26, 0.02, 0.05, 0.02, PAL.pin); // 세이프티 핀 8

  return b.build();
}

export function createCharacterMesh(): THREE.Mesh {
  const material = new THREE.MeshPhongMaterial({
    vertexColors: true,
    flatShading: true,
    side: THREE.FrontSide,
    specular: 0x222222,
    shininess: 20,
  });
  return new THREE.Mesh(createCharacterGeometry(), material);
}
