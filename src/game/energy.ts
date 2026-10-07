import { ENERGY_MAX, ENERGY_REGEN_AIR, ENERGY_REGEN_GROUND } from "./config";

/** Launcher energy gauge (BotW-stamina-like). Upgradeable fields are public. */
export class EnergyGauge {
  max = ENERGY_MAX;
  value = ENERGY_MAX;
  regenGround = ENERGY_REGEN_GROUND;
  regenAir = ENERGY_REGEN_AIR;

  step(dt: number, grounded: boolean): void {
    const rate = grounded ? this.regenGround : this.regenAir;
    this.value = Math.min(this.max, this.value + rate * dt);
  }

  canAfford(cost: number): boolean {
    return this.value >= cost;
  }

  spend(cost: number): boolean {
    if (cost > this.value) return false;
    this.value -= cost;
    return true;
  }

  get fraction(): number {
    return this.value / this.max;
  }
}
