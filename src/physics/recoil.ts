/**
 * Pure momentum math for the launcher. No rendering imports so it can be
 * unit-tested and reused by any scene code.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Δv of the shooter for a slug of mass m fired at speed u along `dir` (unit vector). M·Δv = −m·u. */
export function recoilDeltaV(shooterMass: number, slugMass: number, slugSpeed: number, dir: Vec3): Vec3 {
  const k = -(slugMass * slugSpeed) / shooterMass;
  return { x: dir.x * k, y: dir.y * k, z: dir.z * k };
}

/** Momentum magnitude p = m·u. */
export function slugMomentum(slugMass: number, slugSpeed: number): number {
  return slugMass * slugSpeed;
}

/** Kinetic energy cost E = ½·m·u² = p²/(2m). */
export function slugEnergy(slugMass: number, slugSpeed: number): number {
  return 0.5 * slugMass * slugSpeed * slugSpeed;
}

/** Muzzle speed for a spring-driven charge: ½kx² = ½mu² ⇒ u = x·√(k/m). */
export function springMuzzleSpeed(k: number, compression: number, slugMass: number): number {
  return compression * Math.sqrt(k / slugMass);
}
