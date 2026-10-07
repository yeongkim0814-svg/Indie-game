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
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    return { webgl2: !!gl, fps: window.__fps ?? null };
  });
  mkdirSync("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/m0.png" });
  console.log(JSON.stringify({ ...info, errors }));
  if (!info.webgl2 || errors.length) code = 1;
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await browser.close();
  server.kill();
}
process.exit(code);
