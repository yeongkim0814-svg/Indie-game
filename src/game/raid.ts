/**
 * One expedition ("raid"): move, shoot, collect samples, reach extraction before sunset.
 * Pure simulation in SI units (1 tile = 1 m); no rendering imports.
 */
import { FIRST_MAP, parseMap, type ParsedMap } from "./raidMap";
import { Grid } from "./inventory";
import { ageItem, itemMass, itemValue, makeItem, temperature, type Item } from "./items";
import type { KnowledgeId } from "./knowledge";
import { BATTERY_CAPACITY, MODS, WEAPONS, type BeamWeapon, type ProjectileWeapon, type WeaponKind, type WeaponStats } from "./weapons";

export const RAID = {
  duration: 240, // s until sunset; staying out after that = lost
  nightFrom: 0.7, // fraction of the day after which night creatures start arriving
  extractHold: 3, // s standing in the extraction zone
  player: {
    bodyMass: 70, // kg
    radius: 0.32,
    hp: 6,
    drive: 2600, // N, max push force
    drag: 580, // N·s/m, so top speed = drive/drag ≈ 4.5 m/s and τ = M/drag ≈ 0.12 s
  },
  /** recoil dash (needs "mechanics"): a heavy slug fired backwards; feet leave the ground so drag is off while airborne */
  dash: { impulse: 600, airTime: 0.3, cooldown: 1.5 },
  bullet: { life: 0.9, radius: 0.12 },
  sample: { radius: 0.6 },
  backpack: { w: 5, h: 3 },
  notebook: { w: 2, h: 2 }, // secure container: survives death and sunset
  crawler: { mass: 20, radius: 0.35, hp: 4, drive: 300, drag: 100, aggro: 10, touchDamage: 1, touchCooldown: 0.8,
    /** a hit with knockback Δv above this lifts it off its feet (no drag, no drive) for knockAir s */
    knockDv: 1.5, knockAir: 0.4 },
  /** ectotherm metabolism: drive scales by Q10^((T − T_ref)/10); balanced at noon heat */
  metabolism: { q10: 1.4, refTemp: 30 },
};

export interface Vec2 { x: number; y: number }
export interface RaidInput { move: Vec2; fire: boolean; dash?: boolean }
export type RaidState = "running" | "extracted" | "dead" | "lost";
export type RaidEvent = { kind: "shot" | "hit" | "kill" | "pickup" | "full" | "drop" | "hurt" | "wall" | "dash" | "fall" | "empty"; x: number; y: number };

export interface Player { pos: Vec2; vel: Vec2; facing: Vec2; hp: number; cooldown: number; dashCooldown: number; airborne: number }
export interface Crawler { pos: Vec2; vel: Vec2; hp: number; alive: boolean; touchCooldown: number; airborne: number }
export interface Bullet { pos: Vec2; vel: Vec2; life: number; mass: number; damage: number; pierce: number; hit: Set<Crawler> }
export interface Loadout { weapon?: Item; pack?: Item[] }
/** An item lying on the ground. `blocked` stops a full pack from re-trying it every frame until the player steps away. */
export interface Sample { pos: Vec2; item: Item; taken: boolean; blocked: boolean }

export function idleRaidInput(): RaidInput {
  return { move: { x: 0, y: 0 }, fire: false };
}

/** Deterministic PRNG so tests and replays are stable. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Raid {
  readonly map: ParsedMap;
  time = 0;
  state: RaidState = "running";
  extractTimer = 0;
  player: Player;
  crawlers: Crawler[];
  bullets: Bullet[] = [];
  samples: Sample[];
  backpack = new Grid(RAID.backpack.w, RAID.backpack.h);
  notebook = new Grid(RAID.notebook.w, RAID.notebook.h);
  events: RaidEvent[] = [];
  private rand: () => number;
  private nightSpawnClock = 0;
  readonly knowledge: ReadonlySet<KnowledgeId>;
  /** equipped weapon item (null = the free rifle); lost unless extracted */
  readonly weapon: Item | null;
  /** focused-light beam this step, for the renderer */
  beam: { from: Vec2; to: Vec2; intensity: number } | null = null;

  constructor(mapRows: string[] = FIRST_MAP, seed = 1, knowledge: Iterable<KnowledgeId> = [], loadout: Loadout = {}) {
    this.knowledge = new Set(knowledge);
    this.weapon = loadout.weapon ?? null;
    for (const it of loadout.pack ?? []) this.backpack.autoPlace(it);
    this.map = parseMap(mapRows);
    this.rand = mulberry32(seed);
    const s = this.map.start;
    this.player = { pos: { ...s }, vel: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, hp: RAID.player.hp, cooldown: 0, dashCooldown: 0, airborne: 0 };
    this.crawlers = this.map.crawlers.map((c) => this.newCrawler(c));
    this.samples = this.map.samples.map((p) => ({ pos: { x: p.x, y: p.y }, item: makeItem(p.kind), taken: false, blocked: false }));
  }

  /** Total moving mass: body plus what is carried (F = M·a, so a heavy pack slows acceleration). */
  get playerMass() { return RAID.player.bodyMass + this.backpack.mass + this.notebook.mass + (this.weapon ? itemMass(this.weapon) : 0); }
  get weaponKind(): WeaponKind { return (this.weapon?.kind as WeaponKind | undefined) ?? "rifle"; }
  get weaponStats(): WeaponStats { return WEAPONS[this.weaponKind]; }
  /** Mass that takes the recoil: a stock braces the gun into the body. */
  get recoilMass() { return this.playerMass + (this.weapon?.mods?.stock ? MODS.stockBracing : 0); }
  get aimRange() { return this.weaponStats.range + (this.weapon?.mods?.sight ? MODS.scopeRange : 0); }
  /** Sunlight reaching a lens, 1 at noon → 0 at sunset. */
  get sunlight() { return this.daylight; }
  get batteryCharge() { return this.carriedItems.reduce((e, it) => e + (it.kind === "battery" ? it.charge ?? 0 : 0), 0); }
  get carriedItems(): Item[] { return [...this.backpack.items, ...this.notebook.items]; }
  get carriedValue() { return this.carriedItems.reduce((v, it) => v + itemValue(it), 0); }
  get temperature() { return temperature(this.daylight); }
  /** Crawler activity relative to noon: Q10^((T − T_ref)/10). */
  get crawlerActivity() { const m = RAID.metabolism; return Math.pow(m.q10, (this.temperature - m.refTemp) / 10); }
  get canDash() { return this.knowledge.has("mechanics"); }
  get timeLeft() { return Math.max(0, RAID.duration - this.time); }
  /** 1 = full day, 0 = sunset. Eases out over the last 30 % of the day. */
  get daylight() { return Math.min(1, Math.max(0, (RAID.duration - this.time) / (RAID.duration * (1 - RAID.nightFrom)))); }
  get extractProgress() { return this.extractTimer / RAID.extractHold; }

  tileAt(x: number, y: number): string {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (ty < 0 || ty >= this.map.h || tx < 0) return "#";
    return this.map.rows[ty][tx] ?? "#";
  }
  /** Walkers are stopped by rock and by the cliff edge. */
  /** Rock and the cliff edge stop everyone; ledge paths stop crawlers (they never leave their zone). */
  blocksWalker(x: number, y: number, crawler = false) { const t = this.tileAt(x, y); return t === "#" || t === "~" || (crawler && t === "="); }
  /** "path" = ledge between zones (side-view camera, movement only), "arena" = everything else. */
  zoneAt(x: number, y: number): "path" | "arena" { return this.tileAt(x, y) === "=" ? "path" : "arena"; }
  get onPath() { return this.zoneAt(this.player.pos.x, this.player.pos.y) === "path"; }
  blocksBullet(x: number, y: number) { return this.tileAt(x, y) === "#"; }

  /** Does a circle overlap any blocking tile? */
  private hits(x: number, y: number, r: number, crawler = false) {
    for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++) {
      for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) {
        if (!this.blocksWalker(tx + 0.5, ty + 0.5, crawler)) continue;
        const cx = Math.max(tx, Math.min(x, tx + 1)), cy = Math.max(ty, Math.min(y, ty + 1));
        if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
      }
    }
    return false;
  }

  /** Move by vel·dt with axis-separated collision; blocked axes lose their velocity. */
  private moveBody(pos: Vec2, vel: Vec2, r: number, dt: number, crawler = false) {
    const nx = pos.x + vel.x * dt;
    if (!this.hits(nx, pos.y, r, crawler)) pos.x = nx; else vel.x = 0;
    const ny = pos.y + vel.y * dt;
    if (!this.hits(pos.x, ny, r, crawler)) pos.y = ny; else vel.y = 0;
  }

  /** Driven body: F = drive·dir − drag·v, a = F/M (semi-implicit Euler). */
  private drive(vel: Vec2, dir: Vec2, drive: number, drag: number, mass: number, dt: number) {
    vel.x += ((dir.x * drive - drag * vel.x) / mass) * dt;
    vel.y += ((dir.y * drive - drag * vel.y) / mass) * dt;
  }

  private newCrawler(p: Vec2): Crawler {
    return { pos: { ...p }, vel: { x: 0, y: 0 }, hp: RAID.crawler.hp, alive: true, touchCooldown: 0, airborne: 0 };
  }

  /** Nearest living crawler within auto-aim range with a clear line of fire. */
  autoTarget(): Crawler | null {
    let best: Crawler | null = null, bd = this.aimRange;
    for (const c of this.crawlers) {
      if (!c.alive) continue;
      const d = Math.hypot(c.pos.x - this.player.pos.x, c.pos.y - this.player.pos.y);
      if (d < bd && this.clearLine(this.player.pos, c.pos)) { bd = d; best = c; }
    }
    return best;
  }

  private clearLine(a: Vec2, b: Vec2) {
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / 0.25);
    for (let i = 1; i < n; i++) if (this.blocksBullet(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n)) return false;
    return true;
  }

  step(dt: number, input: RaidInput) {
    if (this.state !== "running") return;
    this.time += dt;
    const P = RAID.player, p = this.player;

    // movement
    let mx = input.move.x, my = input.move.y;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    if (ml > 0.1) p.facing = { x: mx / Math.max(ml, 1e-6), y: my / Math.max(ml, 1e-6) };
    // recoil dash: Δv = J/M along the stick (or facing); airborne for a moment, so no foot drag
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    if (input.dash && this.canDash && p.dashCooldown <= 0) {
      const D = RAID.dash;
      const dl = Math.hypot(mx, my);
      const dir = dl > 0.1 ? { x: mx / dl, y: my / dl } : p.facing;
      const dv = D.impulse / this.playerMass;
      p.vel.x += dir.x * dv; p.vel.y += dir.y * dv;
      p.dashCooldown = D.cooldown;
      p.airborne = D.airTime;
      this.events.push({ kind: "dash", x: p.pos.x, y: p.pos.y });
    }
    if (p.airborne > 0) p.airborne = Math.max(0, p.airborne - dt);
    else this.drive(p.vel, { x: mx, y: my }, P.drive, P.drag, this.playerMass, dt);
    this.moveBody(p.pos, p.vel, P.radius, dt);

    // firing: auto-aim like Soul Knight; each weapon follows its own law (weapons.ts)
    p.cooldown = Math.max(0, p.cooldown - dt);
    this.beam = null;
    const W = this.weaponStats;
    const fire = input.fire && !this.onPath; // ledge paths are movement-only
    if (fire && W.type === "beam") this.fireBeam(W, dt);
    else if (fire && p.cooldown <= 0 && W.type === "projectile") this.fireProjectile(W);

    // slugs: impulse J = m·u transfers to the target as knockback Δv = J/m_target
    const C = RAID.crawler;
    for (const b of this.bullets) {
      b.life -= dt;
      b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt;
      if (this.blocksBullet(b.pos.x, b.pos.y)) { b.life = 0; this.events.push({ kind: "wall", x: b.pos.x, y: b.pos.y }); continue; }
      for (const c of this.crawlers) {
        if (!c.alive || b.hit.has(c) || Math.hypot(c.pos.x - b.pos.x, c.pos.y - b.pos.y) > C.radius + RAID.bullet.radius) continue;
        b.hit.add(c);
        c.hp -= b.damage;
        c.vel.x += (b.vel.x * b.mass) / C.mass; c.vel.y += (b.vel.y * b.mass) / C.mass;
        if ((b.mass * Math.hypot(b.vel.x, b.vel.y)) / C.mass > C.knockDv) c.airborne = C.knockAir;
        if (c.hp <= 0) { c.alive = false; this.events.push({ kind: "kill", x: c.pos.x, y: c.pos.y }); }
        else this.events.push({ kind: "hit", x: c.pos.x, y: c.pos.y });
        if (b.hit.size >= b.pierce) { b.life = 0; break; }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);

    // crawlers chase within aggro range and bite on contact
    for (const c of this.crawlers) {
      if (!c.alive) continue;
      const dx = p.pos.x - c.pos.x, dy = p.pos.y - c.pos.y, d = Math.hypot(dx, dy);
      const chase = d < C.aggro || this.time > RAID.duration * RAID.nightFrom;
      if (c.airborne > 0) {
        // knocked off its feet: no grip to stop at the edge, so it slides over and falls
        c.airborne = Math.max(0, c.airborne - dt);
        const sp = Math.hypot(c.vel.x, c.vel.y);
        const reach = C.radius + sp * dt + 0.02; // where its edge will be after this step
        const ahead = sp > 0 ? { x: c.pos.x + (c.vel.x / sp) * reach, y: c.pos.y + (c.vel.y / sp) * reach } : c.pos;
        if (this.tileAt(ahead.x, ahead.y) === "~") { c.alive = false; this.events.push({ kind: "fall", x: c.pos.x, y: c.pos.y }); continue; }
      } else {
        // on its feet it brakes at the edge and never walks off
        this.drive(c.vel, chase && d > 0 ? { x: dx / d, y: dy / d } : { x: 0, y: 0 }, C.drive * this.crawlerActivity, C.drag, C.mass, dt);
      }
      this.moveBody(c.pos, c.vel, C.radius, dt, true);
      c.touchCooldown = Math.max(0, c.touchCooldown - dt);
      if (d < C.radius + P.radius + 0.05 && c.touchCooldown <= 0) {
        c.touchCooldown = C.touchCooldown;
        p.hp -= C.touchDamage;
        this.events.push({ kind: "hurt", x: p.pos.x, y: p.pos.y });
      }
    }

    // night creatures arrive from the map edge after nightFrom
    if (this.time > RAID.duration * RAID.nightFrom) {
      this.nightSpawnClock -= dt;
      if (this.nightSpawnClock <= 0) { this.nightSpawnClock = 8; this.spawnAtEdge(); }
    }

    // samples age by their own law whether carried or lying on the ground
    const T = this.temperature;
    for (const it of this.carriedItems) ageItem(it, dt, T);
    for (const s of this.samples) if (!s.taken) ageItem(s.item, dt, T);

    // samples: walk over to pick up into the backpack if it fits
    for (const s of this.samples) {
      if (s.taken) continue;
      const near = Math.hypot(s.pos.x - p.pos.x, s.pos.y - p.pos.y) <= RAID.sample.radius;
      if (!near) { s.blocked = false; continue; }
      if (s.blocked) continue;
      if (this.backpack.autoPlace(s.item)) {
        s.taken = true;
        this.events.push({ kind: "pickup", x: s.pos.x, y: s.pos.y });
      } else {
        s.blocked = true;
        this.events.push({ kind: "full", x: s.pos.x, y: s.pos.y });
      }
    }

    // extraction: hold position inside the zone
    const e = this.map.extraction;
    if (Math.hypot(p.pos.x - e.x, p.pos.y - e.y) < e.r) this.extractTimer += dt; else this.extractTimer = 0;

    if (p.hp <= 0) this.state = "dead";
    else if (this.extractTimer >= RAID.extractHold) this.state = "extracted";
    else if (this.time >= RAID.duration) this.state = "lost";
  }

  private spawnAtEdge() {
    for (let i = 0; i < 20; i++) {
      const x = 1.5 + this.rand() * (this.map.w - 3), y = 1.5 + this.rand() * (this.map.h - 3);
      if (this.hits(x, y, RAID.crawler.radius, true) || Math.hypot(x - this.player.pos.x, y - this.player.pos.y) < 12) continue;
      this.crawlers.push(this.newCrawler({ x, y }));
      return;
    }
  }

  /** Take an item out of the pack or notebook and leave it on the ground at the player's feet. */
  dropItem(item: Item): boolean {
    if (!this.backpack.remove(item) && !this.notebook.remove(item)) return false;
    const p = this.player.pos;
    this.samples.push({ pos: { x: p.x, y: p.y }, item, taken: false, blocked: true });
    this.events.push({ kind: "drop", x: p.x, y: p.y });
    return true;
  }

  private aimDir(): Vec2 {
    const p = this.player, t = this.autoTarget();
    if (!t) return { ...p.facing };
    const d = Math.hypot(t.pos.x - p.pos.x, t.pos.y - p.pos.y);
    p.facing = { x: (t.pos.x - p.pos.x) / d, y: (t.pos.y - p.pos.y) / d };
    return { ...p.facing };
  }

  /** Slug weapons. Recoil on the shooter: Δv = −J/M_recoil. A coilgun first draws E = ½mu² from a battery. */
  private fireProjectile(W: ProjectileWeapon) {
    const p = this.player;
    p.cooldown = W.interval;
    if (W.energy > 0) {
      const cell = this.carriedItems.find((it) => it.kind === "battery" && (it.charge ?? 0) >= W.energy);
      if (!cell) { this.events.push({ kind: "empty", x: p.pos.x, y: p.pos.y }); return; }
      cell.charge = (cell.charge ?? BATTERY_CAPACITY) - W.energy;
    }
    const { x: dx, y: dy } = this.aimDir();
    this.bullets.push({
      pos: { x: p.pos.x + dx * 0.4, y: p.pos.y + dy * 0.4 }, vel: { x: dx * W.speed, y: dy * W.speed },
      life: RAID.bullet.life, mass: W.mass, damage: W.damage, pierce: W.pierce, hit: new Set(),
    });
    const k = (W.mass * W.speed) / this.recoilMass;
    p.vel.x -= dx * k; p.vel.y -= dy * k;
    this.events.push({ kind: "shot", x: p.pos.x, y: p.pos.y });
  }

  /** Focused sunlight: damage rate ∝ sunlight; photon momentum p = E/c is negligible, so no knockback or recoil. */
  private fireBeam(W: BeamWeapon, dt: number) {
    const p = this.player, t = this.autoTarget();
    if (!t) return;
    this.aimDir();
    const I = this.sunlight;
    this.beam = { from: { ...p.pos }, to: { ...t.pos }, intensity: I };
    t.hp -= W.dps * I * dt;
    if (t.hp <= 0) { t.alive = false; this.events.push({ kind: "kill", x: t.pos.x, y: t.pos.y }); }
  }

  /** What comes home: everything on extraction (weapon included), only the notebook otherwise. */
  result() {
    const items = this.state === "extracted" ? [...this.carriedItems, ...(this.weapon ? [this.weapon] : [])] : this.notebook.items;
    return { state: this.state, items, value: Math.round(items.reduce((v, it) => v + itemValue(it), 0)) };
  }
}
