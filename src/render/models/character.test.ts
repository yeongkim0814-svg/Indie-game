import { describe, expect, it } from "vitest";
import { createCharacterMesh } from "./character";

describe("createCharacterMesh", () => {
  const mesh = createCharacterMesh();
  const g = mesh.geometry;
  const pos = g.getAttribute("position");
  it("정점 예산 이내이고 색상/법선이 있다", () => {
    expect(pos.count).toBeLessThanOrEqual(180);
    expect(g.getAttribute("color").count).toBe(pos.count);
    expect(g.getAttribute("normal").count).toBe(pos.count);
  });
  it("인덱스가 유효하고 퇴화 삼각형이 없다", () => {
    const idx = g.getIndex()!;
    expect(idx.count % 3).toBe(0);
    for (let i = 0; i < idx.count; i++) expect(idx.getX(i)).toBeLessThan(pos.count);
    for (let i = 0; i < pos.count * 3; i++) expect(Number.isFinite((pos.array as Float32Array)[i])).toBe(true);
    const n = g.getAttribute("normal");
    for (let i = 0; i < n.count; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeGreaterThan(0.5);
  });
  it("키가 약 1.7m", () => {
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 1);
    expect(g.boundingBox!.max.y).toBeGreaterThan(1.5);
    expect(g.boundingBox!.max.y).toBeLessThan(2);
  });
});
