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
  await page.evaluate(() => localStorage.removeItem("stash.samples"));
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

  // Pick up the first sample, then teleport into the extraction zone
  await ev(() => { const g = window.__game.raid; g.player.pos.x = g.samples[0].pos.x; g.player.pos.y = g.samples[0].pos.y; g.player.hp = 6; });
  await frames(3);
  const carried = await ev(() => window.__game.raid.player.carried);
  expect(carried >= 1, "sample was not picked up");
  await ev(() => { const g = window.__game.raid; g.player.pos.x = g.map.extraction.x; g.player.pos.y = g.map.extraction.y; g.player.vel.x = 0; g.player.vel.y = 0; g.player.hp = 6; });
  await frames(12);
  const prog = await ev(() => window.__game.raid.extractProgress);
  info.extractProgress = +prog.toFixed(2);
  await page.waitForFunction(() => window.__game.screen === "results", null, { timeout: 90000 });
  const res = await ev(() => ({ state: window.__game.raid.state, text: document.querySelector("#screen-results").innerText }));
  info.result = res;
  expect(res.state === "extracted" && res.text.includes("탈출"), "extraction result not shown: " + JSON.stringify(res));
  await page.screenshot({ path: "screenshots/play-result.png" });

  await page.click("#btn-hideout");
  await page.waitForFunction(() => window.__game.screen === "hideout", null, { timeout: 5000 });
  const stash = await ev(() => window.__game.stash);
  info.stash = { carried, stash };
  expect(stash === carried, `stash ${stash} != carried ${carried}`);
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
