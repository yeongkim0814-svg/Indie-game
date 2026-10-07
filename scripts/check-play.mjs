// Headless check of the 2D quarter-view raid: hideout -> raid -> move/aim/fire -> extract -> results.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const PORT = 4174;
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const errors = [];
const info = {};
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 915, height: 412 } });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  // Count rendered frames, not wall time: software rendering can be slow.
  const frames = async (n) => {
    const f0 = await page.evaluate(() => window.__frame);
    await page.waitForFunction((t) => window.__frame >= t, f0 + n, { timeout: 60000 });
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const expect = (cond, msg) => { if (!cond) errors.push(msg); };
  mkdirSync("screenshots", { recursive: true });

  await frames(5);
  expect((await ev(() => window.__game.screen)) === "hideout", "should start on hideout");
  await page.evaluate(() => { localStorage.removeItem("stash.grid"); localStorage.removeItem("research.points"); });
  await page.reload();
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  await frames(3);
  await page.screenshot({ path: "screenshots/play-hideout.png" });

  // Start the raid
  await page.click("#btn-start");
  await page.waitForFunction(() => window.__game.screen === "raid", null, { timeout: 5000 });
  expect((await ev(() => window.__game.raid.state)) === "running", "raid should be running");
  await frames(10);
  await page.screenshot({ path: "screenshots/play-raid.png" });

  // Keyboard: hold D
  const x0 = await ev(() => window.__game.raid.player.pos.x);
  await page.keyboard.down("d");
  await frames(25);
  await page.keyboard.up("d");
  const x1 = await ev(() => window.__game.raid.player.pos.x);
  info.keyboard = { x0: +x0.toFixed(2), x1: +x1.toFixed(2) };
  expect(x1 > x0 + 0.3, "holding D did not move the player right");

  // Virtual joystick: drag down in the left half with the mouse
  const p0 = await ev(() => ({ ...window.__game.raid.player.pos }));
  await page.mouse.move(120, 200);
  await page.mouse.down();
  await page.mouse.move(120, 260, { steps: 5 });
  const joyMove = await ev(() => ({ ...window.__game.input.state.move }));
  await frames(25);
  await page.screenshot({ path: "screenshots/play-joystick.png" });
  await page.mouse.up();
  const p1 = await ev(() => ({ ...window.__game.raid.player.pos }));
  info.joystick = { joyMove, dy: +(p1.y - p0.y).toFixed(2) };
  expect(Math.hypot(p1.x - p0.x, p1.y - p0.y) > 0.3 && joyMove.y > 0.9, "joystick drag did not move the player");

  // Fire with Space
  const s0 = await ev(() => window.__game.shots);
  await page.keyboard.down("Space");
  await frames(20);
  await page.screenshot({ path: "screenshots/play-fire.png" });
  await page.keyboard.up("Space");
  const s1 = await ev(() => window.__game.shots);
  info.space = { shots: s1 - s0 };
  expect(s1 > s0, "Space did not fire");

  // Fire with the on-screen button
  const box = await page.locator("#btn-fire").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await frames(15);
  const held = await ev(() => window.__game.input.state.fire);
  await page.mouse.up();
  const s2 = await ev(() => window.__game.shots);
  info.fireButton = { held, shots: s2 - s1 };
  expect(held && s2 > s1, "FIRE button did not fire");

  // ---- M2: grid inventory --------------------------------------------------
  const tp = (kind) => ev((k) => {
    const g = window.__game.raid;
    const sm = g.samples.find((q) => !q.taken && q.item.kind === k);
    if (!sm) return -1;
    g.player.pos.x = sm.pos.x; g.player.pos.y = sm.pos.y; g.player.vel.x = 0; g.player.vel.y = 0; g.player.hp = 6;
    return sm.item.uid;
  }, kind);
  const kinds = (grid) => ev((gr) => window.__game.raid[gr].items.map((i) => i.kind), grid);

  const oreUid = await tp("ore");
  expect(oreUid > 0, "no ore sample on the map");
  await frames(3);
  expect((await kinds("backpack")).includes("ore"), "ore was not picked up into the backpack");
  expect((await page.locator(".toast").count()) > 0, "no pickup toast");
  await ev(() => { const g = window.__game.raid; g.player.pos.x = g.map.start.x; g.player.pos.y = g.map.start.y; });

  // open the bag; fire must be disabled but the joystick still works
  await page.click("#btn-bag");
  await frames(3);
  expect(await ev(() => window.__game.bagOpen), "bag did not open");
  const fireShown = await ev(() => getComputedStyle(document.getElementById("btn-fire")).display);
  expect(fireShown === "none", "fire button should be disabled while the bag is open");
  const panelBox = await page.locator("#bag-panel").boundingBox();
  expect(panelBox.x >= 915 * 0.35, "bag panel intrudes on the left 35%: " + panelBox.x);
  const cellPx = await ev(() => document.querySelector("#grid-backpack").getBoundingClientRect().width / 5);
  expect(cellPx >= 44, "cells smaller than 44px: " + cellPx);
  await page.mouse.move(100, 200); await page.mouse.down(); await page.mouse.move(100, 260, { steps: 4 });
  const jm = await ev(() => window.__game.input.state.move.y);
  await page.mouse.up();
  expect(jm > 0.9, "joystick broken while bag open");
  await frames(5);
  await page.screenshot({ path: "screenshots/play-bag.png" });

  // real mouse drag: ore from backpack to notebook
  const src = await page.locator(`#grid-backpack [data-kind="ore"]`).boundingBox();
  const dst = await page.locator("#grid-notebook").boundingBox();
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(dst.x + src.width / 2 + 2, dst.y + src.height / 2 + 2, { steps: 12 });
  await frames(2);
  await page.screenshot({ path: "screenshots/play-bag-drag.png" });
  await page.mouse.up();
  await frames(3);
  const nbKinds = await kinds("notebook"), bpKinds = await kinds("backpack");
  info.bag = { notebook: nbKinds, backpack: bpKinds };
  expect(nbKinds.includes("ore") && !bpKinds.includes("ore"), "drag did not move ore to the notebook");

  // quartz into the backpack, then die
  const quartzUid = await tp("quartz");
  await frames(3);
  expect((await kinds("backpack")).includes("quartz"), "quartz not picked up");
  await page.screenshot({ path: "screenshots/play-bag2.png" });
  await ev(() => { window.__game.openBag(false); window.__game.raid.player.hp = 0; });
  await page.waitForFunction(() => window.__game.screen === "results", null, { timeout: 90000 });
  const deadText = await ev(() => document.querySelector("#screen-results").innerText);
  info.deadResult = deadText;
  expect(deadText.includes("수첩"), "death result should mention the notebook");
  const st1 = await ev(() => window.__game.stashGrid.items.map((i) => i.uid + ":" + i.kind));
  info.stashAfterDeath = st1;
  expect(st1.length === 1 && st1[0] === `${oreUid}:ore`, "stash should hold only the notebook ore: " + st1);
  expect(!st1.some((s) => s.startsWith(quartzUid + ":")), "backpack quartz leaked into the stash");
  const persisted = await ev(() => localStorage.getItem("stash.grid"));
  expect(persisted && persisted.includes('"ore"'), "stash not persisted");

  // hideout: select the ore, analyze it
  await page.click("#btn-hideout");
  await page.waitForFunction(() => window.__game.screen === "hideout", null, { timeout: 5000 });
  await frames(3);
  await page.locator(`#grid-stash [data-kind="ore"]`).click();
  await frames(2);
  await page.screenshot({ path: "screenshots/play-stash.png" });
  const pts0 = await ev(() => window.__game.points);
  const expectPts = await ev(() => { const i = window.__game.stashGrid.items[0]; return Math.round(60 * Math.pow(2, -i.age / 90)); });
  await page.click("#btn-analyze");
  await frames(2);
  const pts1 = await ev(() => window.__game.points);
  info.analyze = { pts0, pts1, expectPts };
  expect(pts1 === pts0 + expectPts && pts1 > pts0, "research points did not increase by the ore value");
  expect((await ev(() => window.__game.stashGrid.items.length)) === 0, "analyzed ore still in stash");
  expect((await ev(() => localStorage.getItem("research.points"))) === String(pts1), "points not persisted");

  // second raid: normal extraction carries backpack + notebook home
  await page.click("#btn-start");
  await page.waitForFunction(() => window.__game.screen === "raid", null, { timeout: 5000 });
  await frames(3);
  const u1 = await tp("ore"); await frames(3);
  const u2 = await tp("quartz"); await frames(3);
  const u3 = await tp("bio"); await frames(3);
  const carriedNow = await ev(() => window.__game.raid.carriedItems.map((i) => i.uid));
  expect([u1, u2, u3].every((u) => carriedNow.includes(u)), "second raid pickups missing: " + carriedNow);
  await ev(() => window.__game.openBag(true));
  await frames(3);
  await page.screenshot({ path: "screenshots/play-bag3.png" });
  await ev(() => window.__game.openBag(false));
  // drop test: drag the quartz out onto the trash zone, then it must lie on the ground
  await ev(() => window.__game.openBag(true)); await frames(2);
  const qb = await page.locator(`#grid-backpack [data-kind="quartz"]`).boundingBox();
  const tb = await page.locator("#bag-trash").boundingBox();
  await page.mouse.move(qb.x + qb.width / 2, qb.y + qb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 10 });
  await page.mouse.up();
  await frames(3);
  const afterDrop = await ev(() => ({ held: window.__game.raid.carriedItems.map((i) => i.kind), ground: window.__game.raid.samples.filter((s) => !s.taken && s.blocked).length }));
  info.drop = afterDrop;
  expect(!afterDrop.held.includes("quartz") && afterDrop.ground >= 1, "dropping on the trash zone failed");
  await ev(() => window.__game.openBag(false));
  const expectUids = await ev(() => window.__game.raid.carriedItems.map((i) => i.uid));
  await ev(() => { const g = window.__game.raid; g.player.pos.x = g.map.extraction.x; g.player.pos.y = g.map.extraction.y; g.player.vel.x = 0; g.player.vel.y = 0; g.player.hp = 6; });
  await frames(12);
  await page.waitForFunction(() => window.__game.screen === "results", null, { timeout: 90000 });
  const res = await ev(() => ({ state: window.__game.raid.state, text: document.querySelector("#screen-results").innerText }));
  info.result = res;
  expect(res.state === "extracted" && res.text.includes("탈출") && res.text.includes("총 가치"), "extraction result not shown: " + JSON.stringify(res));
  await page.screenshot({ path: "screenshots/play-result.png" });
  const stashUids = await ev(() => window.__game.stashGrid.items.map((i) => i.uid));
  expect(expectUids.length >= 2 && expectUids.every((u) => stashUids.includes(u)), `stash ${stashUids} missing ${expectUids}`);
  await page.click("#btn-hideout");
  await page.waitForFunction(() => window.__game.screen === "hideout", null, { timeout: 5000 });
  await frames(3);
  await page.screenshot({ path: "screenshots/play-stash2.png" });
  info.fps = await ev(() => window.__fps);
} catch (e) {
  errors.push("exception: " + (e?.stack || e));
} finally {
  console.log(JSON.stringify({ ...info, errors }, null, 1));
  if (errors.length) code = 1;
  await browser.close();
  server.kill();
}
process.exit(code);
