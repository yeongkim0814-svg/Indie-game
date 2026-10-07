import { RAID, type Raid, type RaidState } from "../game/raid";
import type { Renderer } from "./render";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = "", parent?: HTMLElement) {
  const e = document.createElement(tag);
  e.className = cls; e.textContent = text;
  parent?.append(e);
  return e;
}

/** Native-resolution DOM: rotate notice, hideout, in-raid HUD, results. */
export class Hud {
  private rotate = el("div", "overlay", "가로로 돌려 주세요");
  private hideout = el("div", "overlay screen");
  private stashText: HTMLElement;
  readonly startBtn: HTMLButtonElement;
  private results = el("div", "overlay screen");
  private resultTitle: HTMLElement;
  private resultSub: HTMLElement;
  readonly hideoutBtn: HTMLButtonElement;
  private hud = el("div", "hud");
  private pips: HTMLElement[] = [];
  private timer: HTMLElement;
  private samples: HTMLElement;
  private bar = el("div", "extract-bar");
  private barFill: HTMLElement;
  private arrow = el("div", "arrow", "▶");
  private last = { hp: -1, t: -1, n: -1 };

  constructor(root: HTMLElement, private renderer: Renderer) {
    this.rotate.id = "rotate";
    this.hideout.id = "screen-hideout"; this.results.id = "screen-results";

    el("div", "title", "아지트", this.hideout);
    el("div", "sub", "해가 지기 전에 표본을 모아 탈출하세요", this.hideout);
    this.stashText = el("div", "stash", "", this.hideout);
    this.startBtn = el("button", "btn", "원정 출발", this.hideout);
    this.startBtn.id = "btn-start";

    this.resultTitle = el("div", "title", "", this.results);
    this.resultSub = el("div", "stash", "", this.results);
    this.hideoutBtn = el("button", "btn", "아지트로", this.results);
    this.hideoutBtn.id = "btn-hideout";

    const hp = el("div", "hp", "", this.hud);
    for (let i = 0; i < RAID.player.hp; i++) this.pips.push(el("div", "pip", "", hp));
    this.timer = el("div", "timer", "", this.hud);
    this.samples = el("div", "samples", "", this.hud);
    el("i", "gem", "", this.samples);
    this.samples.append(document.createTextNode(""));
    this.barFill = el("div", "extract-fill", "", this.bar);
    el("div", "extract-label", "탈출 중", this.bar);
    this.hud.append(this.bar);
    this.hud.id = "hud";

    root.append(this.hud, this.arrow, this.hideout, this.results, this.rotate);
    this.show("hideout");
    this.setPortrait(false);
  }

  setPortrait(p: boolean) { this.rotate.style.display = p ? "flex" : "none"; }

  show(screen: "hideout" | "raid" | "results") {
    this.hideout.style.display = screen === "hideout" ? "flex" : "none";
    this.results.style.display = screen === "results" ? "flex" : "none";
    this.hud.style.display = screen === "raid" ? "block" : "none";
    if (screen !== "raid") this.arrow.style.display = "none";
    this.last = { hp: -1, t: -1, n: -1 };
  }

  setStash(n: number) { this.stashText.textContent = `보관 중인 표본  ${n}개`; }

  showResults(state: RaidState, samples: number, stash: number) {
    this.resultTitle.textContent = state === "extracted" ? `탈출 성공 — 표본 ${samples}개 확보` : state === "dead" ? "사망 — 소지품을 잃었습니다" : "일몰 — 실종";
    this.resultTitle.dataset.state = state;
    this.resultSub.textContent = `보관 중인 표본  ${stash}개`;
    this.show("results");
  }

  update(raid: Raid) {
    const hp = Math.max(0, raid.player.hp);
    if (hp !== this.last.hp) { this.pips.forEach((p, i) => p.classList.toggle("off", i >= hp)); this.last.hp = hp; }
    const t = Math.ceil(raid.timeLeft);
    if (t !== this.last.t) {
      this.timer.textContent = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
      this.timer.classList.toggle("low", raid.timeLeft < 30);
      this.last.t = t;
    }
    if (raid.player.carried !== this.last.n) { this.samples.lastChild!.textContent = ` 표본 ${raid.player.carried}`; this.last.n = raid.player.carried; }
    const prog = raid.extractProgress;
    this.bar.style.display = prog > 0 ? "block" : "none";
    if (prog > 0) this.barFill.style.width = `${Math.min(100, prog * 100).toFixed(1)}%`;

    // arrow to the extraction zone when it is off-screen
    const e = raid.map.extraction, s = this.renderer.worldToScreen(e.x, e.y);
    const m = 28;
    const off = s.x < 0 || s.x > innerWidth || s.y < 0 || s.y > innerHeight;
    this.arrow.style.display = off && e.r > 0 && this.hud.style.display === "block" ? "block" : "none";
    if (off) {
      const cx = innerWidth / 2, cy = innerHeight / 2, dx = s.x - cx, dy = s.y - cy;
      const k = Math.min((cx - m) / Math.max(1e-6, Math.abs(dx)), (cy - m) / Math.max(1e-6, Math.abs(dy)));
      this.arrow.style.left = `${cx + dx * k}px`; this.arrow.style.top = `${cy + dy * k}px`;
      this.arrow.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(dy, dx)}rad)`;
    }
  }
}
