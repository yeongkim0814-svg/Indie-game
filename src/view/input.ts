import type { RaidInput } from "../game/raid";

const JOY_RADIUS = 40; // CSS px of drag for full move magnitude

/** Soul Knight style input: floating joystick (left half), FIRE button (right), keyboard fallback. */
export class Input {
  /** Live values handed to Raid.step. */
  readonly state: RaidInput = { move: { x: 0, y: 0 }, fire: false };
  private enabled = false;
  private fireLocked = false;
  private joyId: number | null = null;
  private fireId: number | null = null;
  private origin = { x: 0, y: 0 };
  private joy = { x: 0, y: 0 };
  private keys = new Set<string>();
  private readonly layer = div("touch");
  private readonly base = div("joy-base");
  private readonly knob = div("joy-knob");
  private readonly fireBtn = div("btn-fire", "발사");

  constructor(root: HTMLElement) {
    this.base.style.display = this.knob.style.display = "none";
    this.layer.append(this.base, this.knob);
    root.append(this.layer, this.fireBtn);
    this.setEnabled(false);

    const L = this.layer;
    L.addEventListener("pointerdown", (e) => {
      if (!this.enabled || this.joyId !== null || e.clientX >= innerWidth / 2) return;
      e.preventDefault();
      this.joyId = e.pointerId;
      L.setPointerCapture(e.pointerId);
      this.origin = { x: e.clientX, y: e.clientY };
      this.base.style.display = this.knob.style.display = "block";
      place(this.base, e.clientX, e.clientY);
      this.drag(e.clientX, e.clientY);
    });
    L.addEventListener("pointermove", (e) => { if (e.pointerId === this.joyId) this.drag(e.clientX, e.clientY); });
    const endJoy = (e: PointerEvent) => { if (e.pointerId === this.joyId) this.releaseJoy(); };
    L.addEventListener("pointerup", endJoy);
    L.addEventListener("pointercancel", endJoy);
    L.addEventListener("lostpointercapture", endJoy);

    const F = this.fireBtn;
    F.addEventListener("pointerdown", (e) => {
      if (!this.enabled || this.fireLocked || this.fireId !== null) return;
      e.preventDefault();
      this.fireId = e.pointerId;
      F.setPointerCapture(e.pointerId);
      F.classList.add("down");
      this.refresh();
    });
    const endFire = (e: PointerEvent) => { if (e.pointerId === this.fireId) { this.fireId = null; F.classList.remove("down"); this.refresh(); } };
    F.addEventListener("pointerup", endFire);
    F.addEventListener("pointercancel", endFire);
    F.addEventListener("lostpointercapture", endFire);

    addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      const k = key(e);
      if (!k) return;
      if (this.fireLocked && k === "fire") return;
      e.preventDefault();
      this.keys.add(k); this.refresh();
    });
    addEventListener("keyup", (e) => { const k = key(e); if (k) { this.keys.delete(k); this.refresh(); } });
    addEventListener("blur", () => { this.keys.clear(); this.refresh(); });
    for (const el of [L, F]) el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.layer.style.display = on ? "block" : "none";
    this.fireBtn.style.display = on && !this.fireLocked ? "block" : "none";
    if (!on) { this.releaseJoy(); this.fireId = null; this.fireBtn.classList.remove("down"); this.keys.clear(); }
    this.refresh();
  }

  /** Disable (and hide) the fire button, e.g. while the bag is open; the joystick keeps working. */
  setFireLocked(lock: boolean) {
    this.fireLocked = lock;
    if (lock) { this.fireId = null; this.fireBtn.classList.remove("down"); this.keys.delete("fire"); }
    this.fireBtn.style.display = this.enabled && !lock ? "block" : "none";
    this.refresh();
  }

  private drag(x: number, y: number) {
    let dx = x - this.origin.x, dy = y - this.origin.y;
    const len = Math.hypot(dx, dy);
    const mag = Math.min(1, len / JOY_RADIUS);
    if (len > 0) { dx /= len; dy /= len; }
    this.joy = { x: dx * mag, y: dy * mag };
    place(this.knob, this.origin.x + this.joy.x * JOY_RADIUS, this.origin.y + this.joy.y * JOY_RADIUS);
    this.refresh();
  }

  private releaseJoy() {
    this.joyId = null; this.joy = { x: 0, y: 0 };
    this.base.style.display = this.knob.style.display = "none";
    this.refresh();
  }

  private refresh() {
    const k = this.keys;
    let kx = (k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0), ky = (k.has("down") ? 1 : 0) - (k.has("up") ? 1 : 0);
    const kl = Math.hypot(kx, ky);
    if (kl > 0) { kx /= kl; ky /= kl; }
    const usingJoy = this.joyId !== null;
    this.state.move.x = usingJoy ? this.joy.x : kx;
    this.state.move.y = usingJoy ? this.joy.y : ky;
    this.state.fire = !this.fireLocked && (this.fireId !== null || k.has("fire"));
  }
}

function key(e: KeyboardEvent): string | null {
  switch (e.key.toLowerCase()) {
    case "w": case "arrowup": return "up";
    case "s": case "arrowdown": return "down";
    case "a": case "arrowleft": return "left";
    case "d": case "arrowright": return "right";
    case " ": case "j": return "fire";
  }
  return null;
}

function div(id: string, text = ""): HTMLElement {
  const d = document.createElement("div");
  d.id = id; d.textContent = text;
  return d;
}

function place(el: HTMLElement, x: number, y: number) {
  el.style.left = `${x}px`; el.style.top = `${y}px`;
}
