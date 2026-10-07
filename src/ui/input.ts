/** Touch + keyboard/mouse input → a plain state object the game reads each frame. */

export interface InputState {
  moveX: number;
  moveY: number;
  run: boolean;
  jumpHeld: boolean;
  launchJumpHeld: boolean;
  fireHeld: boolean;
  switchPressed: boolean;
  /** Stick was released while pushed hard forward: keep sprinting forward until the stick is touched again. */
  sprintLock: boolean;
  yaw: number;
  pitch: number;
}

const AIM_SENS = 0.0055;
const PITCH_MIN = -1.5, PITCH_MAX = 0.9;

export function createInput(root: HTMLElement): InputState {
  const s: InputState = {
    moveX: 0, moveY: 0, run: false, jumpHeld: false, launchJumpHeld: false, fireHeld: false, switchPressed: false, sprintLock: false, yaw: 0, pitch: -0.25,
  };

  // ---- on-screen controls ----
  const ui = document.createElement("div");
  ui.id = "controls";
  ui.innerHTML = `
    <div id="stick"><div id="lockmark">▲</div><div id="knob"></div></div>
    <div id="sprintbadge">자동 달리기 ▲<small>조이스틱을 터치하면 해제</small></div>
    <button class="btn" id="btn-slug">탄 교체</button>
    <button class="btn" id="btn-jump">점프</button>
    <button class="btn" id="btn-lj">반동<br>점프<br><small>꾹 눌러 강도</small></button>
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
    #btn-lj { right: 126px; bottom: 112px; width: 74px; height: 74px; font-size: 12px; line-height: 1.15; }
    #btn-slug { right: 30px; bottom: 156px; width: 64px; height: 64px; font-size: 12px; }
    #stick { position: absolute; width: 120px; height: 120px; border-radius: 50%; border: 2px solid rgba(255,255,255,.4);
      background: rgba(255,255,255,.08); display: none; }
    #lockmark { position: absolute; left: 36px; top: -62px; width: 48px; height: 40px; border-radius: 20px; display: flex; align-items: center; justify-content: center;
      border: 2px solid rgba(255,255,255,.5); color: rgba(255,255,255,.7); font: 700 16px system-ui, sans-serif; background: rgba(20,30,60,.35); }
    #stick.lockready #lockmark { background: rgba(255,210,94,.75); color: #1b2238; border-color: #fff; }
    #sprintbadge { position: absolute; left: max(18px, env(safe-area-inset-left)); bottom: 40px; display: none; padding: 8px 14px; border-radius: 18px;
      background: rgba(255,210,94,.8); color: #1b2238; font: 700 14px system-ui, sans-serif; pointer-events: none; }
    #sprintbadge small { display: block; font-weight: 500; font-size: 10px; opacity: .8; }
    #knob { position: absolute; left: 36px; top: 36px; width: 48px; height: 48px; border-radius: 50%; background: rgba(255,255,255,.55); }`;
  document.head.appendChild(style);

  const stick = ui.querySelector<HTMLElement>("#stick")!;
  const knob = ui.querySelector<HTMLElement>("#knob")!;
  const badge = ui.querySelector<HTMLElement>("#sprintbadge")!;
  const setLock = (on: boolean) => {
    s.sprintLock = on;
    badge.style.display = on ? "block" : "none";
    if (on) { s.moveX = 0; s.moveY = 1; s.run = true; }
  };
  // `blocked` lets a button refuse a press while a conflicting one is held (fire vs launcher jump).
  const bind = (id: string, down: () => void, up: () => void, blocked: () => boolean = () => false) => {
    const el = ui.querySelector<HTMLElement>(id)!;
    let engaged = false;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (blocked()) return;
      engaged = true;
      el.setPointerCapture(e.pointerId); el.classList.add("on"); down();
    });
    const end = (e: PointerEvent) => {
      e.stopPropagation();
      if (!engaged) return;
      engaged = false;
      el.classList.remove("on"); up();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };
  bind("#btn-fire", () => (s.fireHeld = true), () => (s.fireHeld = false), () => s.launchJumpHeld);
  bind("#btn-jump", () => (s.jumpHeld = true), () => (s.jumpHeld = false));
  bind("#btn-lj", () => (s.launchJumpHeld = true), () => (s.launchJumpHeld = false), () => s.fireHeld);
  bind("#btn-slug", () => (s.switchPressed = true), () => (s.switchPressed = false));

  // ---- free touch: left half = stick, right half = aim drag ----
  const roles = new Map<number, { kind: "stick" | "aim"; x: number; y: number; ox: number; oy: number; lockReady: boolean }>();
  // Releasing inside this zone (pushed to the rim, within ±30° of straight up) locks sprint.
  const LOCK_ANGLE = (30 * Math.PI) / 180;
  window.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest?.(".btn")) return;
    const kind = e.clientX < window.innerWidth * 0.45 ? "stick" : "aim";
    roles.set(e.pointerId, { kind, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY, lockReady: false });
    if (kind === "stick") {
      if (s.sprintLock) { setLock(false); s.moveX = s.moveY = 0; s.run = false; }
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
      const fromUp = Math.abs(Math.atan2(dx, -dy));
      r.lockReady = len >= max * 1.15 && fromUp <= LOCK_ANGLE;
      stick.classList.toggle("lockready", r.lockReady);
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    }
  });
  const release = (e: PointerEvent) => {
    const r = roles.get(e.pointerId);
    if (!r) return;
    roles.delete(e.pointerId);
    if (r.kind === "stick") {
      s.moveX = s.moveY = 0; s.run = false;
      stick.classList.remove("lockready");
      if (r.lockReady) setLock(true);
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
    const f = keys.has("KeyF"), e = keys.has("KeyE");
    // Fire and launcher jump never run together: the one already held keeps it.
    s.fireHeld = f && !(e && s.launchJumpHeld);
    s.launchJumpHeld = e && !(f && s.fireHeld);
    s.switchPressed = keys.has("KeyQ");
    const turn = (keys.has("ArrowLeft") ? 1 : 0) - (keys.has("ArrowRight") ? 1 : 0);
    const look = (keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0);
    s.yaw += turn * 0.04;
    s.pitch = clamp(s.pitch + look * 0.03, PITCH_MIN, PITCH_MAX);
  };
  window.addEventListener("keydown", (e) => {
    if (s.sprintLock && ["KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) setLock(false);
    keys.add(e.code);
    refresh();
  });
  window.addEventListener("keyup", (e) => { keys.delete(e.code); refresh(); });
  // arrow keys repeat via keydown; the per-frame refresh keeps held arrows turning
  setInterval(() => { if (keys.size) refresh(); }, 16);

  return s;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
