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
  await page.evaluate(() => { localStorage.removeItem("stash.grid"); localStorage.removeItem("research.points"); localStorage.removeItem("progress"); });
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
  const vis = (sel) => ev((q) => { const e = document.querySelector(q); return !!e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0; }, sel);
  expect(await vis("#sun-dial"), "sun dial should be shown without celestial");
  expect(!(await vis("#raid-timer")), "mm:ss timer should be hidden without celestial");
  expect(!(await vis("#btn-dash")), "#btn-dash should be hidden without mechanics");
  expect(!(await ev(() => window.__game.raid.canDash)), "canDash without mechanics");

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

  // Floating stick: overdrag far right, then a short move back must already steer left
  await page.mouse.move(100, 200);
  await page.mouse.down();
  await page.mouse.move(250, 200, { steps: 6 });
  await page.mouse.move(185, 200, { steps: 4 }); // 65 px back ≈ 2R
  const rev = await ev(() => ({ ...window.__game.input.state.move }));
  await page.mouse.up();
  info.joystickReverse = rev;
  expect(rev.x < -0.9, "reversing the stick needed a drag all the way back to the touch-down point");

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
  expect((await ev(() => JSON.parse(localStorage.getItem("progress")).points)) === pts1, "points not persisted in progress");

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

  // ---- M3: facilities + knowledge tree --------------------------------------
  await ev(() => {
    const g = window.__game, G = g.stashGrid;
    // clear the stash, then hand over exactly 3 quartz + 1 ore + 1 bio
    for (const it of [...G.items]) G.remove(it);
    const mk = (kind, uid) => ({ uid, kind, age: 0, fresh: 1 });
    for (const [k, u] of [["quartz", 9001], ["quartz", 9002], ["quartz", 9003], ["ore", 9004], ["bio", 9005]]) if (!G.autoPlace(mk(k, u))) throw new Error("stash full");
    g.progress.points = 300;
    localStorage.setItem("stash.grid", JSON.stringify(G));
    g.refreshResearch();
  });
  await page.click("#tab-research");
  await frames(3);
  expect((await page.locator("#btn-build-workbench").count()) === 0, "workbench should not have a build button");
  expect(await ev(() => document.getElementById("btn-research-celestial").disabled), "celestial should be locked before the observatory");
  info.lockedReason = await ev(() => document.getElementById("btn-research-celestial").textContent);
  await page.screenshot({ path: "screenshots/play-research-before.png" });
  for (const id of ["btn-build-lab", "btn-build-observatory", "btn-research-mechanics", "btn-research-radiochem", "btn-research-physiology", "btn-research-celestial"]) {
    await page.locator("#" + id).scrollIntoViewIfNeeded();
    await page.click("#" + id);
    await frames(2);
  }
  const m3 = await ev(() => ({ k: [...window.__game.progress.knowledge], f: [...window.__game.progress.facilities], pts: window.__game.points, stash: window.__game.stashGrid.items.map((i) => i.kind), saved: JSON.parse(localStorage.getItem("progress")) }));
  info.m3 = m3;
  expect(["mechanics", "radiochem", "physiology", "celestial"].every((k) => m3.k.includes(k)), "not all four knowledge nodes learned: " + m3.k);
  expect(m3.f.includes("lab") && m3.f.includes("observatory"), "facilities not built");
  expect(m3.pts === 300 - 40 - 60 - 30 - 40 - 40 - 50, "points mismatch: " + m3.pts);
  expect(m3.stash.length === 0, "build materials did not leave the stash: " + m3.stash);
  expect(m3.saved.knowledge.length === 4 && m3.saved.points === m3.pts, "progress not persisted");
  await ev(() => document.getElementById("research-pane").scrollTo(0, 0));
  await frames(2);
  await page.screenshot({ path: "screenshots/play-research.png" });
  expect(await vis("#btn-start"), "#btn-start not reachable from the research view");

  // raid with knowledge
  await page.click("#btn-start");
  await page.waitForFunction(() => window.__game.screen === "raid", null, { timeout: 5000 });
  await frames(10);
  expect(await ev(() => window.__game.raid.canDash), "raid.canDash should be true");
  expect(await vis("#raid-timer"), "mm:ss timer should be shown with celestial");
  expect(!(await vis("#sun-dial")), "sun dial should be hidden with celestial");
  expect(await vis("#btn-dash"), "#btn-dash should be shown with mechanics");
  expect(await vis("#crawler-activity"), "crawler activity line missing");
  const timerText = await ev(() => document.getElementById("raid-timer").textContent);
  expect(/^\d\d:\d\d$/.test(timerText), "timer text: " + timerText);
  info.activity = await ev(() => document.getElementById("crawler-activity").textContent);
  // put a crawler near the player for the aggro ring + an ore off to the side for the arrow
  await ev(() => {
    const r = window.__game.raid, c = r.crawlers.find((q) => q.alive);
    if (c) { c.pos.x = r.player.pos.x + 5; c.pos.y = r.player.pos.y; }
  });
  const dashBox = await page.locator("#btn-dash").boundingBox();
  const fireBox = await page.locator("#btn-fire").boundingBox();
  expect(dashBox.y + dashBox.height <= fireBox.y, "dash button should sit above the fire button");
  const before = await ev(() => ({ x: window.__game.raid.player.pos.x, y: window.__game.raid.player.pos.y }));
  await page.click("#btn-dash");
  let maxAir = 0, maxV = 0;
  for (let i = 0; i < 12; i++) {
    await frames(1);
    const s = await ev(() => ({ a: window.__game.raid.player.airborne, v: Math.hypot(window.__game.raid.player.vel.x, window.__game.raid.player.vel.y), cd: window.__game.raid.player.dashCooldown }));
    maxAir = Math.max(maxAir, s.a); maxV = Math.max(maxV, s.v);
  }
  info.dash = { maxAir, maxV: +maxV.toFixed(2) };
  expect(maxAir > 0 && maxV > 4, "#btn-dash did not trigger a dash: " + JSON.stringify(info.dash));
  expect((await ev(() => window.__game.raid.player.dashCooldown)) > 0 || maxAir > 0, "dash cooldown not started");
  // keyboard dash too
  await frames(120);
  await page.keyboard.press("k");
  await frames(2);
  expect((await ev(() => window.__game.raid.player.airborne)) > 0, "K did not dash");
  await frames(20);
  await page.screenshot({ path: "screenshots/play-raid-m3.png" });


  // ---- M4: crafting, mods, loadout --------------------------------------------------------------
  const toExtraction = async () => {
    await ev(() => { const g = window.__game.raid; g.player.pos.x = g.map.extraction.x; g.player.pos.y = g.map.extraction.y; g.player.vel.x = 0; g.player.vel.y = 0; g.player.hp = 6; });
    await frames(12);
    await page.waitForFunction(() => window.__game.screen === "results", null, { timeout: 90000 });
  };
  await toExtraction();
  await page.click("#btn-hideout");
  await page.waitForFunction(() => window.__game.screen === "hideout", null, { timeout: 5000 });
  await frames(3);
  // hand over resources through the page: points, knowledge, observatory, and materials in the stash
  await ev(() => {
    const g = window.__game, G = g.stashGrid, P = g.progress;
    for (const it of [...G.items]) G.remove(it);
    const mk = (kind, uid) => ({ uid, kind, age: 0, fresh: 1 });
    for (const [k, u] of [["ore", 9101], ["ore", 9102], ["ore", 9103], ["bio", 9104], ["bio", 9105], ["quartz", 9106], ["quartz", 9107], ["quartz", 9108], ["quartz", 9109]]) if (!G.autoPlace(mk(k, u))) throw new Error("stash full");
    P.points = 500;
    for (const k of ["mechanics", "celestial"]) if (!P.knowledge.includes(k)) P.knowledge.push(k);
    if (!P.facilities.includes("observatory")) P.facilities.push("observatory");
    g.saveAll();
    g.refreshResearch();
  });
  await page.click("#tab-craft");
  await frames(3);
  expect(await ev(() => document.getElementById("btn-craft-coilgun").disabled), "coilgun should be locked without electrochem");
  info.coilgunReason = await ev(() => document.getElementById("btn-craft-coilgun").textContent);
  expect(info.coilgunReason.includes("지식"), "coilgun lock reason: " + info.coilgunReason);
  const cardText = await ev(() => document.querySelector('[data-recipe="launcher"]').innerText);
  expect(cardText.includes("J = 120") && cardText.includes("반동"), "launcher card should show law and weakness: " + cardText);
  await ev(() => document.getElementById("craft-pane").scrollTo(0, 0));
  await page.screenshot({ path: "screenshots/play-craft-before.png" });
  const quiet = () => page.waitForFunction(() => !document.querySelector(".toast"), null, { timeout: 15000 });
  const kindsIn = (gr) => ev((g) => window.__game[g].items.map((i) => i.kind), gr);
  for (const out of ["launcher", "stock", "scope"]) {
    await page.locator("#btn-craft-" + out).scrollIntoViewIfNeeded();
    expect(!(await ev((o) => document.getElementById("btn-craft-" + o).disabled, out)), `btn-craft-${out} should be enabled`);
    await page.click("#btn-craft-" + out);
    await frames(2);
  }
  const crafted = await ev(() => ({ pts: window.__game.points, stash: window.__game.stashGrid.items.map((i) => i.kind), saved: JSON.parse(localStorage.getItem("progress")).points }));
  info.crafted = crafted;
  const cnt = (k) => crafted.stash.filter((x) => x === k).length;
  expect(["launcher", "stock", "scope"].every((k) => cnt(k) === 1), "crafted items missing from the stash: " + crafted.stash);
  expect(crafted.pts === 500 - 20 - 10 - 15 && crafted.saved === crafted.pts, "craft points mismatch: " + crafted.pts);
  expect(cnt("ore") === 1 && cnt("bio") === 1 && cnt("quartz") === 2, "craft materials mismatch: " + crafted.stash);
  // a full stash refuses BEFORE spending
  const refused = await ev(() => {
    const g = window.__game, G = g.stashGrid, held = [...G.placed];
    const p0 = g.points;
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.canPlace({ uid: 1, kind: "quartz", age: 0, fresh: 1 }, x, y, false)) G.place({ uid: 80000 + y * 20 + x, kind: "quartz", age: 0, fresh: 1 }, x, y, false);
    const fillers = G.placed.filter((q) => q.item.uid >= 80000).map((q) => q.item);
    g.progress.points = 500; // enough points, but also materials: add ore so only the room is missing
    const why = g.craft("stock");
    const out = { why, pts: g.progress.points, p0 };
    for (const f of fillers) G.remove(f);
    g.progress.points = p0;
    g.refreshResearch();
    return out;
  });
  info.refused = refused;
  expect(refused.why !== null && refused.pts === 500, "crafting into a full stash should be refused without spending: " + JSON.stringify(refused));

  // mods: select the launcher, then the stock -> attach; the launcher grows by one cell
  await page.click("#tab-stash");
  await frames(3);
  const sizeOf = () => ev(() => { const p = window.__game.stashGrid.placed.find((q) => q.item.kind === "launcher"); const d = p.rot ? { w: 1, h: 3 } : { w: 3, h: 1 }; return { rot: p.rot, w: d.w + (p.item.mods?.stock ? (p.rot ? 0 : 1) : 0), h: d.h + (p.item.mods?.stock && p.rot ? 1 : 0), mods: Object.keys(p.item.mods ?? {}) }; });
  const size0 = await sizeOf();
  const pick = async (kind) => { await page.locator(`#grid-stash [data-kind="${kind}"]`).first().click(); await frames(2); };
  expect(await ev(() => document.getElementById("btn-attach").disabled), "attach should start disabled");
  await pick("launcher");
  expect(await ev(() => document.getElementById("btn-analyze").disabled), "analyze must be disabled for gear");
  await pick("stock");
  expect(!(await ev(() => document.getElementById("btn-attach").disabled)), "attach should be enabled with launcher + stock chosen");
  await page.click("#btn-attach");
  await frames(3);
  const size1 = await sizeOf();
  expect(size1.w + size1.h === size0.w + size0.h + 1 && size1.mods.includes("stock"), `stock should lengthen the launcher: ${JSON.stringify([size0, size1])}`);
  await pick("launcher");
  await pick("scope");
  await page.click("#btn-attach");
  await frames(3);
  // detach + re-attach the scope through the buttons
  await pick("launcher");
  expect(!(await ev(() => document.getElementById("btn-detach-sight").disabled)), "detach-sight should be enabled");
  await page.click("#btn-detach-sight");
  await frames(3);
  expect((await kindsIn("stashGrid")).includes("scope") && !(await sizeOf()).mods.includes("sight"), "detached scope should return to the stash");
  await pick("scope");
  await pick("launcher");
  await pick("scope");
  await page.click("#btn-attach");
  await frames(3);
  const size2 = await sizeOf();
  info.mods = { size0, size1, size2 };
  expect(size2.mods.includes("stock") && size2.mods.includes("sight"), "launcher should carry stock and scope: " + JSON.stringify(size2));
  expect(!(await kindsIn("stashGrid")).some((k) => k === "stock" || k === "scope"), "mods should be consumed from the stash on attach");
  // pack a quartz, equip the launcher
  info.beforePack = await ev(() => window.__game.stashGrid.items.map((i) => i.kind));
  await quiet();
  await page.screenshot({ path: "screenshots/play-mods.png" });
  await pick("quartz");
  await page.click("#btn-pack");
  await frames(3);
  expect((await kindsIn("packGrid")).includes("quartz"), "quartz should be in the pre-raid pack");
  await pick("launcher");
  await page.click("#btn-equip");
  await frames(3);
  const eq = await ev(() => ({ kind: window.__game.equipped?.kind, mods: Object.keys(window.__game.equipped?.mods ?? {}), inStash: window.__game.stashGrid.items.some((i) => i.kind === "launcher"), saved: localStorage.getItem("loadout.weapon") }));
  info.equip = eq;
  expect(eq.kind === "launcher" && eq.mods.length === 2 && !eq.inStash && eq.saved, "equip failed: " + JSON.stringify(eq));
  expect((await ev(() => document.getElementById("equip-slot").innerText)).includes("개머리판"), "equip slot should show the stock badge");
  await quiet();
  await page.screenshot({ path: "screenshots/play-loadout.png" });
  await page.click("#tab-craft");
  await frames(3);
  await ev(() => document.getElementById("craft-pane").scrollTo(0, 0));
  await page.screenshot({ path: "screenshots/play-craft.png" });
  await page.click("#tab-stash");
  await frames(2);

  // raid with the launcher: recoil pushes the player backwards
  await page.click("#btn-start");
  await page.waitForFunction(() => window.__game.screen === "raid", null, { timeout: 5000 });
  await frames(5);
  await quiet();
  const r4 = await ev(() => ({ kind: window.__game.raid.weaponKind, stock: !!window.__game.raid.weapon?.mods?.stock, pack: window.__game.raid.backpack.items.map((i) => i.kind), packLeft: window.__game.packGrid.items.length, equipped: window.__game.equipped }));
  info.raid4 = r4;
  expect(r4.kind === "launcher" && r4.stock, "raid should use the equipped launcher: " + JSON.stringify(r4));
  expect(r4.pack.includes("quartz") && r4.packLeft === 0 && r4.equipped === null, "pack should move into the raid backpack: " + JSON.stringify(r4));
  expect(await vis("#weapon-hud"), "weapon HUD missing");
  info.weaponHud = await ev(() => document.getElementById("weapon-hud").textContent);
  await ev(() => { const r = window.__game.raid, c = r.crawlers.find((q) => q.alive); if (c) { c.pos.x = r.player.pos.x + 4; c.pos.y = r.player.pos.y; c.vel.x = 0; c.vel.y = 0; } });
  await frames(4);
  const q0 = await ev(() => ({ ...window.__game.raid.player.pos }));
  const n0 = await ev(() => window.__game.shots);
  await page.keyboard.down("Space");
  await page.waitForFunction((n) => window.__game.shots > n, n0, { timeout: 20000 });
  await frames(2);
  await page.screenshot({ path: "screenshots/play-raid-m4.png" });
  await page.keyboard.up("Space");
  await frames(6);
  const q1 = await ev(() => ({ ...window.__game.raid.player.pos, f: { ...window.__game.raid.player.facing } }));
  const push = (q1.x - q0.x) * q1.f.x + (q1.y - q0.y) * q1.f.y;
  info.recoil = { push: +push.toFixed(3) };
  expect(push < -0.02, "launcher recoil did not push the player backwards: " + push);

  // extract: the launcher comes home equipped, mods intact
  await toExtraction();
  await page.click("#btn-hideout");
  await page.waitForFunction(() => window.__game.screen === "hideout", null, { timeout: 5000 });
  await frames(3);
  const back = await ev(() => ({ kind: window.__game.equipped?.kind, mods: Object.keys(window.__game.equipped?.mods ?? {}).sort(), stash: window.__game.stashGrid.items.map((i) => i.kind) }));
  info.back = back;
  expect(back.kind === "launcher" && back.mods.join() === "sight,stock" && !back.stash.includes("launcher"), "launcher should be equipped again with its mods: " + JSON.stringify(back));
  // persisted across a reload
  await page.reload();
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  await frames(3);
  const reloaded = await ev(() => ({ kind: window.__game.equipped?.kind, mods: Object.keys(window.__game.equipped?.mods ?? {}).length }));
  expect(reloaded.kind === "launcher" && reloaded.mods === 2, "equipped weapon not persisted: " + JSON.stringify(reloaded));
  // unequip returns it to the stash
  await page.click("#btn-unequip");
  await frames(3);
  expect((await ev(() => window.__game.equipped)) === null && (await kindsIn("stashGrid")).includes("launcher"), "unequip should return the launcher to the stash");

  // ---- M5: vista layers, lookout, knowledge reveals --------------------------------------------
  const setKnowledge = (list) => ev((k) => {
    const P = JSON.parse(localStorage.getItem("progress") ?? "{}");
    P.knowledge = k;
    localStorage.setItem("progress", JSON.stringify(P));
  }, list);
  const raidAtCliff = async (time) => {
    await page.reload();
    await page.evaluate(() => { window.__toasts = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.textContent) window.__toasts.push(n.textContent); }).observe(document.body, { childList: true, subtree: true }); });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
    await frames(3);
    await page.click("#btn-start");
    await page.waitForFunction(() => window.__game.screen === "raid", null, { timeout: 5000 });
    await frames(5);
    await ev((tm) => {
      const r = window.__game.raid;
      if (tm !== null) r.time = tm;
      for (const c of r.crawlers) c.alive = false; // keep the lookout undisturbed
      r.player.pos.x = 38.5; r.player.pos.y = 4.5; r.player.vel.x = 0; r.player.vel.y = 0; r.player.hp = 6; // 1.5 m from the east cliff
    }, time);
  };
  const waitLookout = async () => {
    for (let i = 0; i < 400; i++) {
      await frames(2);
      if ((await ev(() => window.__game.lookout)) >= 0.9) return true;
    }
    return false;
  };
  const settle = () => ev(() => { const r = window.__game.raid; r.player.hp = 6; for (const c of r.crawlers) c.alive = false; });

  await setKnowledge([]);
  await raidAtCliff(null);
  expect(await waitLookout(), "plain: lookout never reached 0.9");
  await frames(6);
  const plain = await ev(() => ({ look: window.__game.lookout, zoom: window.__game.zoom, rev: window.__game.revealed, hud: getComputedStyle(document.getElementById("weapon-hud")).opacity, hp: getComputedStyle(document.querySelector(".hp")).opacity }));
  info.vistaPlain = plain;
  expect(plain.zoom > 1.5, "plain: zoom too small " + plain.zoom);
  expect(plain.rev.length === 0, "plain: no reveals expected without knowledge: " + plain.rev);
  expect(+plain.hud < 0.35 && +plain.hp === 1, "HUD should fade (except HP): " + JSON.stringify(plain));
  await page.screenshot({ path: "screenshots/play-vista-plain.png" });

  await setKnowledge(["mechanics", "radiochem", "physiology", "celestial", "electrochem"]);
  await raidAtCliff(211.2);
  expect(await waitLookout(), "known: lookout never reached 0.9");
  await settle();
  await frames(10);
  const known = await ev(() => ({ look: window.__game.lookout, zoom: window.__game.zoom, rev: [...window.__game.revealed].sort(), dl: window.__game.raid.daylight, toasts: window.__toasts.filter((x) => x.startsWith("관측")) }));
  info.vistaKnown = known;
  expect(known.rev.join() === "celestial,electrochem,physiology,radiochem", "known: reveals " + known.rev);
  expect(known.toasts.length === 4 && known.toasts.some((x) => x.includes("지층의 나이가 보인다 (방사화학)")), "known: reveal toasts " + JSON.stringify(known.toasts));
  expect(known.dl > 0.2 && known.dl < 0.6, "known: should be dusk, daylight " + known.dl);
  await page.screenshot({ path: "screenshots/play-vista-known.png" });
  // moving cancels the zoom quickly
  await page.keyboard.down("a");
  await frames(14);
  const moving = await ev(() => ({ look: window.__game.lookout, zoom: window.__game.zoom }));
  await page.keyboard.up("a");
  info.vistaMoving = moving;
  expect(moving.look < 0.1 && moving.zoom < 1.1, "moving did not cancel the lookout: " + JSON.stringify(moving));
  expect(await ev(() => window.__game.raid.state) === "running", "raid must keep running during lookout");

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
