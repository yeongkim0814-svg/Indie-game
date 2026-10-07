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

  const settle = () => page.waitForFunction(() => window.__game.sim.player.grounded, null, { timeout: 10000 });
  const press = async (sel) => {
    const box = await page.locator(sel).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
  };
  await settle();
  const y0 = await page.evaluate(() => window.__game.sim.player.pos.y);

  // Jump method 3: view on the floor + Jump button => launcher jump along the view.
  await page.evaluate(() => { window.__game.input.pitch = -1.5; });
  await press("#btn-jump");
  await page.waitForTimeout(100);
  const m3 = await page.evaluate(() => ({ shots: window.__game.sim.shots, vy: window.__game.sim.player.vel.y, lookingDown: window.__game.sim.lookingDown }));
  await page.screenshot({ path: "screenshots/m1-recoil.png" });
  if (m3.shots !== 1 || m3.vy < 3 || !m3.lookingDown) errors.push("jump method 3 (look at floor + Jump) failed: " + JSON.stringify(m3));
  await settle();

  // Jump method 2: Launcher-jump button => fires opposite the stick direction (idle stick = straight up).
  await page.evaluate(() => { window.__game.input.pitch = -0.25; });
  await press("#btn-lj");
  await page.waitForTimeout(100);
  const m2 = await page.evaluate(() => ({ shots: window.__game.sim.shots, vy: window.__game.sim.player.vel.y }));
  if (m2.shots !== 2 || m2.vy < 3) errors.push("jump method 2 (launcher jump) failed: " + JSON.stringify(m2));
  await settle();

  // Jump method 1: plain Jump button with a level view => leg jump, no shot.
  await press("#btn-jump");
  await page.waitForTimeout(100);
  const m1 = await page.evaluate(() => ({ shots: window.__game.sim.shots, vy: window.__game.sim.player.vel.y }));
  if (m1.shots !== 2 || m1.vy < 3) errors.push("jump method 1 (leg jump) failed: " + JSON.stringify(m1));
  info.jumps = { m1, m2, m3 };
  const after = await page.evaluate(() => {
    const g = window.__game.sim;
    return { y: g.player.pos.y, vy: g.player.vel.y, shots: g.shots, energy: Math.round(g.energy.value), maxHeight: g.maxHeight };
  });
  info.state = { y0, ...after };
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
