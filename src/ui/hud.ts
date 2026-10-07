import { SLUGS } from "../game/config";
import type { GameSim } from "../game/sim";
import { SUMMIT, terrainHeight } from "../game/world";

export function createHud(root: HTMLElement) {
  const el = document.createElement("div");
  el.id = "game-hud";
  el.innerHTML = `
    <div id="energy"><div id="e-fill"></div><div id="e-cost"></div></div>
    <div id="info"></div>
    <div id="toast"></div>
    <div id="cross"></div>
    <div id="lookhint">▼ 점프 = 반동 점프</div>
    <div id="jbar"><div id="jfill"></div></div>`;
  root.appendChild(el);
  const style = document.createElement("style");
  style.textContent = `
    #game-hud { position: fixed; inset: 0; pointer-events: none; font: 13px/1.4 system-ui, sans-serif; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.6); }
    #energy { position: absolute; left: 50%; top: max(14px, env(safe-area-inset-top)); transform: translateX(-50%); width: min(60vw, 360px); height: 14px;
      border-radius: 8px; background: rgba(10,16,34,.55); border: 1px solid rgba(255,255,255,.5); overflow: hidden; }
    #e-fill { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg,#69e3c0,#ffe27a); }
    #e-cost { position: absolute; inset: 0 auto 0 0; background: rgba(255,80,80,.65); }
    #info { position: absolute; left: 12px; top: 40px; white-space: pre; }
    #toast { position: absolute; left: 50%; top: 30%; transform: translateX(-50%); font-size: 22px; font-weight: 700; opacity: 0; transition: opacity .4s; text-align: center; }
    #lookhint { position: absolute; left: 50%; top: calc(50% + 24px); transform: translateX(-50%); display: none; padding: 3px 10px; border-radius: 12px;
      background: rgba(255,210,94,.85); color: #1b2238; font-weight: 700; text-shadow: none; }
    #jbar { position: absolute; left: 50%; top: calc(50% + 52px); transform: translateX(-50%); width: 90px; height: 8px; border-radius: 5px; display: none;
      background: rgba(10,16,34,.55); border: 1px solid rgba(255,255,255,.6); overflow: hidden; }
    #jfill { height: 100%; width: 0; background: #ffd25e; }
    #cross { position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; border: 2px solid rgba(255,255,255,.8); border-radius: 50%; }`;
  document.head.appendChild(style);

  const fill = el.querySelector<HTMLElement>("#e-fill")!;
  const cost = el.querySelector<HTMLElement>("#e-cost")!;
  const info = el.querySelector<HTMLElement>("#info")!;
  const lookhint = el.querySelector<HTMLElement>("#lookhint")!;
  const jbar = el.querySelector<HTMLElement>("#jbar")!;
  const jfill = el.querySelector<HTMLElement>("#jfill")!;
  const toast = el.querySelector<HTMLElement>("#toast")!;
  let toastShown = false;

  return (sim: GameSim, fps: number) => {
    lookhint.style.display = sim.lookingDown ? "block" : "none";
    fill.style.width = `${sim.energy.fraction * 100}%`;
    // red segment: energy the pending shot would consume
    const jp = sim.jumpCharging ? sim.jumpPreview() : null;
    const c = jp ? jp.cost : sim.charging ? sim.predictedCost(Math.max(sim.charge, 0.3)) : 0;
    jbar.style.display = jp ? "block" : "none";
    jfill.style.width = `${sim.jumpCharge * 100}%`;
    cost.style.width = `${Math.min(sim.energy.fraction, c / sim.energy.max) * 100}%`;
    cost.style.left = `${Math.max(0, sim.energy.fraction - c / sim.energy.max) * 100}%`;
    const t = SLUGS[sim.slugId];
    const dv = jp ? jp.dv : sim.predictedDeltaV(Math.max(sim.charge, 0.3));
    info.textContent =
      (jp ? `반동 점프 차지 · 중량탄\n` : `${t.name}  m=${t.mass}kg\n`) +
      `예상 반동 Δv ${dv.toFixed(1)} m/s\n` +
      `고도 ${(sim.player.pos.y - terrainHeight(0, 0)).toFixed(1)} m · 정상까지 ${(SUMMIT.top - sim.player.pos.y).toFixed(1)} m\n` +
      `발사 ${sim.shots}회 · ${fps} fps`;
    if (sim.summitReached && !toastShown) {
      toastShown = true;
      toast.textContent = `정상 도달!\n발사 ${sim.shots}회`;
      toast.style.whiteSpace = "pre";
      toast.style.opacity = "1";
      setTimeout(() => (toast.style.opacity = "0"), 4000);
    }
  };
}
