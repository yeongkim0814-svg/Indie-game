/** Touch + keyboard/mouse input → a plain state object the game reads each frame. */

export interface InputState {
  moveX: number;
  moveY: number;
  run: boolean;
  jumpHeld: boolean;
  fireHeld: boolean;
  switchPressed: boolean;
  yaw: number;
  pitch: number;
}

const AIM_SENS = 0.0055;
const PITCH_MIN = -1.5, PITCH_MAX = 0.9;

export function createInput(root: HTMLElement): InputState {
  const s: InputState = {
    moveX: 0, moveY: 0, run: false, jumpHeld: false, fireHeld: false, switchPressed: false, yaw: 0, pitch: -0.25,
  };

  // ---- on-screen controls ----
  const ui = document.createElement("div");
  ui.id = "controls";
  ui.innerHTML = `
    <div id="stick"><div id="knob"></div></div>
    <button class="btn" id="btn-slug">탄 교체</button>
    <button class="btn" id="btn-jump">점프</button>
    <button class="btn" id="btn-fire">발사<br><small>꾹 눌러 차지</small></button>`;
  root.appendChild(ui);
  const style = document.createElement("style");
  style.textContent = `
    #controls { position: fixed; inset: 0; pointer-events: none; user-select: none; -webkit-user-select: none; }
    .btn { position: absolute; pointer-events: auto; border: 2px solid rgba(255,255,255,.55); color: #fff;
      background: rgba(20,30,60,.45); border-radius: 50%; font: 600 14px system-ui, sans-serif; touch-action: none;
      -webkit-tap-highlight-color: transparent; }
    .btn small { font-weight: 400; font-size: 10px; opacity: .8; }
    .btn.on { background: rgba(255,210,94,.6); }
    #btn-fire { right: max(18px, env(safe-area-inset-right)); bottom: max(34px, env(safe-area-inset-bottom)); width: 104px; height: 104px; }
    #btn-jump { right: 138px; bottom: 28px; width: 76px; height: 76px; }
    #btn-slug { right: 30px; bottom: 156px; width: 64px; height: 64px; font-size: 12px; }
    #stick { position: absolute; width: 120px; height: 120px; border-radius: 50%; border: 2px solid rgba(255,255,255,.4);
      background: rgba(255,255,255,.08); display: none; }
    #knob { position: absolute; left: 36px; top: 36px; width: 48px; height: 48px; border-radius: 50%; background: rgba(255,255,255,.55); }`;
  document.head.appendChild(style);

  const stick = ui.querySelector<HTMLElement>("#stick")!;
  const knob = ui.querySelector<HTMLElement>("#knob")!;
  const bind = (id: string, down: () => void, up: () => void) => {
    const el = ui.querySelector<HTMLElement>(id)!;
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); el.classList.add("on"); down(); });
    const end = (e: PointerEvent) => { e.stopPropagation(); el.classList.remove("on"); up(); };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };
  bind("#btn-fire", () => (s.fireHeld = true), () => (s.fireHeld = false));
  bind("#btn-jump", () => (s.jumpHeld = true), () => (s.jumpHeld = false));
  bind("#btn-slug", () => (s.switchPressed = true), () => (s.switchPressed = false));

  // ---- free touch: left half = stick, right half = aim drag ----
  const roles = new Map<number, { kind: "stick" | "aim"; x: number; y: number; ox: number; oy: number }>();
  window.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest?.(".btn")) return;
    const kind = e.clientX < window.innerWidth * 0.45 ? "stick" : "aim";
    roles.set(e.pointerId, { kind, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY });
    if (kind === "stick") {
      stick.style.display = "block";
      stick.style.left = `${e.clientX - 60}px`;
      stick.style.top = `${e.clientY - 60}px`;
    }
  });
  window.addEventListener("pointermove", (e) => {
    const r = roles.get(e.pointerId);
    if (!r) return;
    if (r.kind === "aim") {
      s.yaw -= (e.clientX - r.x) * AIM_SENS;
      s.pitch = clamp(s.pitch - (e.clientY - r.y) * AIM_SENS, PITCH_MIN, PITCH_MAX);
      r.x = e.clientX; r.y = e.clientY;
    } else {
      const dx = e.clientX - r.ox, dy = e.clientY - r.oy;
      const len = Math.hypot(dx, dy), max = 50;
      const k = len > max ? max / len : 1;
      s.moveX = (dx * k) / max;
      s.moveY = (-dy * k) / max;
      s.run = len > max * 0.9;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    }
  });
  const release = (e: PointerEvent) => {
    const r = roles.get(e.pointerId);
    if (!r) return;
    roles.delete(e.pointerId);
    if (r.kind === "stick") {
      s.moveX = s.moveY = 0; s.run = false;
      stick.style.display = "none";
      knob.style.transform = "";
    }
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);

  // ---- keyboard (desktop) ----
  const keys = new Set<string>();
  const refresh = () => {
    s.moveX = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    s.moveY = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    s.run = keys.has("ShiftLeft") || keys.has("ShiftRight");
    s.jumpHeld = keys.has("Space");
    s.fireHeld = keys.has("KeyF");
    s.switchPressed = keys.has("KeyQ");
    const turn = (keys.has("ArrowLeft") ? 1 : 0) - (keys.has("ArrowRight") ? 1 : 0);
    const look = (keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0);
    s.yaw += turn * 0.04;
    s.pitch = clamp(s.pitch + look * 0.03, PITCH_MIN, PITCH_MAX);
  };
  window.addEventListener("keydown", (e) => { keys.add(e.code); refresh(); });
  window.addEventListener("keyup", (e) => { keys.delete(e.code); refresh(); });
  // arrow keys repeat via keydown; the per-frame refresh keeps held arrows turning
  setInterval(() => { if (keys.size) refresh(); }, 16);

  return s;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
