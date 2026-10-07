// Launches headless Chromium against the built app and verifies WebGL renders.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const PORT = 4173;
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } }); // Galaxy-ish portrait
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  const info = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    return { webgl2: !!gl, fps: window.__fps ?? null };
  });
  mkdirSync("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/m1-idle.png" });

  // Scenario: push the stick far forward and release -> sprint locks and keeps running.
  await page.evaluate(() => { window.__game.input.pitch = -0.25; window.__game.input.yaw = 0; });
  const z0 = await page.evaluate(() => window.__game.sim.player.pos.z);
  await page.mouse.move(80, 600);
  await page.mouse.down();
  await page.mouse.move(80, 540, { steps: 4 });
  await page.mouse.move(80, 480, { steps: 4 }); // 120px up: well past the rim
  await page.mouse.up();
  await page.waitForTimeout(900);
  const lock = await page.evaluate(() => {
    const g = window.__game;
    return { locked: g.input.sprintLock, speed: Math.hypot(g.sim.player.vel.x, g.sim.player.vel.z), z: g.sim.player.pos.z };
  });
  info.sprintLock = { ...lock, dz: +(lock.z - z0).toFixed(2) };
  if (!lock.locked || lock.speed < 7 || lock.z >= z0 - 3) errors.push("sprint lock did not keep the player running forward");
  await page.screenshot({ path: "screenshots/m1-sprint.png" });
  // Touching the stick again cancels the lock.
  await page.mouse.move(80, 600);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  const unlocked = await page.evaluate(() => !window.__game.input.sprintLock);
  if (!unlocked) errors.push("touching the stick did not cancel sprint lock");
  // A partial push (below the lock zone) must not lock.
  await page.mouse.move(80, 600);
  await page.mouse.down();
  await page.mouse.move(80, 560, { steps: 3 });
  await page.mouse.up();
  const partial = await page.evaluate(() => window.__game.input.sprintLock);
  if (partial) errors.push("a partial push locked sprint");
  await page.waitForTimeout(500);

  // Scenario: aim straight down, jump, fire a charged heavy slug mid-air via the real UI buttons.
  const y0 = await page.evaluate(() => window.__game.sim.player.pos.y);
  await page.evaluate(() => { window.__game.input.pitch = -1.5; });
  const jump = await page.locator("#btn-jump").boundingBox();
  const fire = await page.locator("#btn-fire").boundingBox();
  await page.mouse.move(jump.x + 30, jump.y + 30);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.mouse.move(fire.x + 40, fire.y + 40);
  await page.mouse.down(); // hold = charge
  await page.waitForTimeout(250);
  const before = await page.evaluate(() => ({ vy: window.__game.sim.player.vel.y, air: !window.__game.sim.player.grounded }));
  await page.mouse.up();   // release = fire (mid-air, aimed straight down)
  await page.waitForTimeout(60);
  const vyAfter = await page.evaluate(() => window.__game.sim.player.vel.y);
  await page.waitForTimeout(190);
  await page.screenshot({ path: "screenshots/m1-recoil.png" });
  const after = await page.evaluate(() => {
    const g = window.__game.sim;
    return { y: g.player.pos.y, vy: g.player.vel.y, shots: g.shots, energy: Math.round(g.energy.value), maxHeight: g.maxHeight };
  });
  info.scenario = { y0, ...after, airborneAtFire: before.air, vyBefore: +before.vy.toFixed(2), vyAfter: +vyAfter.toFixed(2) };
  if (!before.air) errors.push("scenario: player was not airborne when firing (timing)");
  else if (after.shots < 1 || vyAfter - before.vy < 2) errors.push("scenario: firing down did not add upward velocity");
  console.log(JSON.stringify({ ...info, errors }, null, 1));
  if (!info.webgl2 || errors.length) code = 1;
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await browser.close();
  server.kill();
}
process.exit(code);
