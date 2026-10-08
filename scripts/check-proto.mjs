// Headless check of the two-camera prototype (/?proto): arena in camera II, see-through rock, swing to camera I on the
// ledge, walk the ledge, swing back to camera II in the east arena. Build first (npm run build).
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const PORT = 4175;
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
  await page.goto(`http://localhost:${PORT}/?proto`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
  const frames = async (n) => {
    const f0 = await page.evaluate(() => window.__frame);
    await page.waitForFunction((t) => window.__frame >= t, f0 + n, { timeout: 60000 });
  };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const expect = (cond, msg) => { if (!cond) errors.push(msg); };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const cam = () => ev(() => ({ ...window.__proto.cam }));
  const teleport = (x, y) => ev(([x, y]) => {
    const r = window.__proto.raid;
    r.player.pos.x = x; r.player.pos.y = y; r.player.vel.x = r.player.vel.y = 0;
    window.__proto.snap();
  }, [x, y]);
  mkdirSync("screenshots", { recursive: true });

  await frames(10);
  // tests drive the sim by hand: no damage, no wandering crawlers (except in the arena shot)
  await ev(() => { window.__proto.raid.player.hp = 99; });

  // 1. arena, camera II
  await frames(15);
  let c = await cam();
  info.arena = c;
  expect(c.mode === "II" && near(c.yaw, 45, 0.5) && near(c.pitch, 30, 0.5), "arena should start in camera II 45/30: " + JSON.stringify(c));
  expect(c.background === 0, "no background in camera II");
  expect((await ev(() => window.__proto.zone)) === "arena", "start zone should be arena");
  await page.screenshot({ path: "screenshots/proto-arena.png" });

  // 2. see-through: stand directly behind a rock as seen from the camera (camera is toward (-sin45, +cos45))
  const rock = await ev(() => {
    const rows = window.__proto.raid.map.rows;
    for (let y = 1; y < rows.length - 1; y++) for (let x = 8; x < 20; x++) if (rows[y][x] === "#" && rows[y][x + 1] === "#") return { x: x + 1, y: y + 0.5 };
    return null;
  });
  expect(rock, "no rock found");
  await ev(() => { window.__proto.raid.crawlers.forEach((k) => (k.alive = false)); });
  await teleport(rock.x + 0.9, rock.y - 0.9);
  await frames(20);
  info.seeThrough = await ev(() => window.__proto.seeThrough);
  expect(info.seeThrough > 0, "no rock drawn see-through when standing behind it");
  await page.screenshot({ path: "screenshots/proto-occlude.png" });

  // 3. walk onto the ledge: hold D+W in camera II
  await teleport(15.5, 10);
  await frames(5);
  // (in camera II the stick is screen-relative: world-east is screen right+up, so hold D+W until the ledge)
  await page.keyboard.down("d");
  await page.keyboard.down("w");
  // wait for the transition to be about halfway, then freeze time and screenshot the swing
  await page.waitForFunction(() => {
    const p = window.__proto;
    if (p.zone === "path" && p.cam.u > 0.35 && p.cam.u < 0.65) { p.paused = true; return true; }
    return false;
  }, null, { timeout: 60000, polling: "raf" });
  const mid = await cam();
  info.transition = mid;
  expect(mid.yaw > 5 && mid.yaw < 40 && mid.pitch > 14 && mid.pitch < 28, "mid-transition yaw/pitch should be between: " + JSON.stringify(mid));
  expect(near(mid.yaw / 45, (mid.pitch - 12) / 18, 0.02), "yaw and pitch should swing together");
  expect(mid.background > 0.2 && mid.background < 0.8, "background should be fading in mid-transition: " + mid.background);
  await page.screenshot({ path: "screenshots/proto-transition.png" });
  await ev(() => { window.__proto.paused = false; });
  await page.keyboard.up("w");

  // 4. settled camera I
  await page.waitForFunction(() => window.__proto.cam.u === 0, null, { timeout: 60000 });
  await frames(5);
  c = await cam();
  info.path = c;
  expect(c.mode === "I" && near(c.yaw, 0, 0.01) && near(c.pitch, 12, 0.01), "path should settle at camera I 0/12: " + JSON.stringify(c));
  expect(c.background === 1, "background should be fully visible in camera I");
  await page.screenshot({ path: "screenshots/proto-path.png" });

  // 5. walk the ledge with D: x grows, y stays on the lane
  const x0 = await ev(() => window.__proto.raid.player.pos.x);
  let maxDev = 0;
  for (let i = 0; i < 12; i++) {
    await frames(20);
    const p = await ev(() => ({ ...window.__proto.raid.player.pos, zone: window.__proto.zone }));
    if (p.zone === "path") maxDev = Math.max(maxDev, Math.abs(p.y - 10));
    if (p.x > 40) break;
  }
  const x1 = await ev(() => window.__proto.raid.player.pos.x);
  info.walk = { x0: +x0.toFixed(2), x1: +x1.toFixed(2), maxLaneDeviation: +maxDev.toFixed(2) };
  expect(x1 > x0 + 3, "holding D on the path did not move the player east");
  expect(maxDev < 0.6, "player left the lane: " + maxDev);
  expect((await ev(() => window.__proto.raid.state)) === "running", "raid should still be running");
  await page.screenshot({ path: "screenshots/proto-walk.png" });

  // 6. through the east end back into camera II
  await page.waitForFunction(() => window.__proto.raid.player.pos.x > 49.6, null, { timeout: 60000 });
  await page.keyboard.up("d");
  await page.waitForFunction(() => window.__proto.cam.u === 1, null, { timeout: 60000 });
  c = await cam();
  info.east = c;
  expect(c.mode === "II" && near(c.yaw, 45, 0.01) && near(c.pitch, 30, 0.01), "east arena should be camera II again: " + JSON.stringify(c));
  expect((await ev(() => window.__proto.zone)) === "arena", "east zone should be arena");
  await frames(10);
  await page.screenshot({ path: "screenshots/proto-east.png" });

  // 6b. crawlers give up at the ledge mouth: put one west of the ledge, the player on it, and watch for 400 frames
  await ev(() => {
    const r = window.__proto.raid;
    r.crawlers.length = 0;
    r.crawlers.push({ pos: { x: 16.5, y: 10 }, vel: { x: 0, y: 0 }, hp: 4, alive: true, touchCooldown: 0, airborne: 0 });
    r.player.pos.x = 26; r.player.pos.y = 10; r.player.vel.x = r.player.vel.y = 0;
    window.__proto.snap();
    window.__proto.watch = { onPath: 0, maxX: 0 };
    const w = window.__proto.watch;
    const tick = () => { const c = r.crawlers[0]; if (window.__proto.tileAt(c.pos.x, c.pos.y) === "=") w.onPath++; w.maxX = Math.max(w.maxX, c.pos.x); requestAnimationFrame(tick); };
    tick();
  });
  await frames(400);
  info.crawler = await ev(() => ({ ...window.__proto.watch, hp: window.__proto.raid.player.hp }));
  expect(info.crawler.onPath === 0, "a crawler stepped onto a '=' tile");
  expect(info.crawler.maxX > 17 && info.crawler.maxX < 19, "crawler should have chased to the ledge mouth: " + info.crawler.maxX);
  expect(info.crawler.hp === 99, "a crawler bit the player on the ledge");

  // 7. extraction
  const ex = await ev(() => window.__proto.raid.map.extraction);
  await teleport(ex.x, ex.y);
  await page.waitForFunction(() => window.__proto.raid.state === "extracted", null, { timeout: 60000 });
  await frames(5);
  expect(await ev(() => getComputedStyle(document.querySelector("button").parentElement).display) === "flex", "result overlay should show");
  await page.screenshot({ path: "screenshots/proto-extracted.png" });
} catch (e) {
  errors.push("exception: " + (e?.stack || e));
} finally {
  console.log(JSON.stringify({ ...info, errors }, null, 1));
  if (errors.length) code = 1;
  await browser.close();
  server.kill();
}
process.exit(code);
