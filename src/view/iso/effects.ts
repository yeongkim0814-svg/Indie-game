/** World-space particles and falling crawlers, spawned from raid.events and drawn through the projection. */
import type { Crawler, Raid } from "../../game/raid";
import { hexN } from "./raster";
import { ROCK } from "../palette";

const ROCK_L = ROCK.map(hexN);
const GRAV = 9.8;

export interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; g: number; life: number; max: number; color: number; size: number }
/** A crawler that slid or was knocked over a cliff edge: keeps its momentum, drops below the slab edge and fades. */
export interface Faller { x: number; y: number; vx: number; vy: number; t: number; seed: number }
export const FALL_TIME = 0.7;

interface SpawnOpt { g?: number; size?: number; up?: number; z?: number }

export class Effects {
  particles: Particle[] = [];
  fallers: Faller[] = [];
  /** screen red flash when the player is hurt, seconds left */
  flash = 0;
  private hitUntil = new WeakMap<Crawler, number>();

  clear() { this.particles.length = 0; this.fallers.length = 0; this.flash = 0; }
  hitFlash(c: Crawler, t: number) { return (this.hitUntil.get(c) ?? 0) > t; }

  private spawn(x: number, y: number, n: number, colors: number[], speed: number, life: number, opt: SpawnOpt = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (speed / 16) * (0.4 + Math.random() * 0.8); // speed given in px/s of the old art
      this.particles.push({
        x, y, z: opt.z ?? 0.3, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: ((opt.up ?? 0) + speed * 0.5 * Math.random()) / 16 + 0.6 * Math.random(),
        g: (opt.g ?? 0) / 16, life: life * (0.6 + Math.random() * 0.6), max: life, color: colors[i % colors.length], size: opt.size ?? 1,
      });
    }
  }

  /** Turn this step's sim events into particles. `now` is the renderer clock (s). */
  consume(raid: Raid, now: number) {
    for (const e of raid.events) {
      const { x, y } = e;
      switch (e.kind) {
        case "shot": {
          const f = raid.player.facing;
          this.spawn(x + f.x * 0.56, y + f.y * 0.56, 4, [0xfff4c0, 0xffd36b], 40, 0.07, { size: 2, z: 0.65 });
          break;
        }
        case "hit": {
          let best: Crawler | null = null, bd = 0.8;
          for (const c of raid.crawlers) { const d = Math.hypot(c.pos.x - x, c.pos.y - y); if (d < bd) { bd = d; best = c; } }
          if (best) this.hitUntil.set(best, now + 0.1);
          this.spawn(x, y, 6, [0xfff4c0, 0xffb36b, 0xffffff], 55, 0.25, { g: 120, z: 0.3 });
          break;
        }
        case "kill": this.spawn(x, y, 16, [0x8a4a3a, 0x5a2d2a, 0xffb36b, 0xfff4c0], 70, 0.5, { g: 140, size: 2, z: 0.3 }); break;
        case "pickup": this.spawn(x, y, 10, [0x6fe0d0, 0xc9fff4], 30, 0.6, { g: -40, up: 10, z: 0.3 }); break;
        case "empty": this.spawn(x, y, 4, [0x8a9aa4, 0xc9d6dc], 18, 0.25, { g: 20, z: 0.9 }); break; // dull "click" puff
        case "hurt": this.flash = 0.3; break;
        case "dash": {
          // puff + streak trailing behind the direction of travel
          const v = raid.player.vel, l = Math.hypot(v.x, v.y) || 1, bx = -v.x / l, by = -v.y / l;
          for (let i = 0; i < 7; i++) {
            const d = (4 + i * 3) / 16;
            this.particles.push({ x: x + bx * d, y: y + by * d, z: 0.2, vx: (bx * 12) / 16, vy: (by * 12) / 16, vz: 0.25, g: 0, life: 0.28 + i * 0.03, max: 0.5, color: i < 3 ? 0xffffff : 0xc9e6f0, size: i < 4 ? 2 : 1 });
          }
          break;
        }
        case "fall": {
          // the crawler is already marked dead; borrow its momentum
          let best: Crawler | null = null, bd = 1;
          for (const c of raid.crawlers) { if (c.alive) continue; const d = Math.hypot(c.pos.x - x, c.pos.y - y); if (d < bd) { bd = d; best = c; } }
          this.fallers.push({ x, y, vx: best?.vel.x ?? 0, vy: best?.vel.y ?? 0, t: 0, seed: this.fallers.length });
          break;
        }
        case "wall": this.spawn(x, y, 4, [ROCK_L[4], ROCK_L[3]], 22, 0.3, { size: 2, z: 0.7 }); break;
      }
    }
    raid.events.length = 0;
  }

  tick(dt: number) {
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    for (const p of this.particles) {
      p.vz -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.z < 0 && p.g > 0) { p.z = 0; p.vx = p.vy = p.vz = 0; }
    }
    for (const f of this.fallers) { f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; }
    this.fallers = this.fallers.filter((f) => f.t < FALL_TIME);
    if (this.flash > 0) this.flash -= dt;
  }

  /** Height of a falling crawler below the slab top: free fall, g = 9.8 m/s². */
  static fallZ(t: number) { return -0.5 * GRAV * t * t; }
}
