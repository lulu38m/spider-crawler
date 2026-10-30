#!/usr/bin/env node
/**
 * Renders a frame-perfect demo video of a crawl, no screen recorder needed.
 *
 *   npm run demo:render -- --frame 9:16 --sample arachnid-reading.pdf
 *
 * Options (all optional):
 *   --file    path to any document of yours (PDF, Word, Markdown…)
 *   --sample  spider-silk.md | arachnid-reading.pdf | code   (default spider-silk.md)
 *   --frame   16:9 | 9:16 | 1:1                               (default 16:9)
 *   --skin    blueprint | boxy | hexa | neon | stilts | sketch
 *   --speed   0.5 | 1 | 2 | 4                                 (default 1)
 *   --intro   seconds of landing page before the crawl         (default 2.5)
 *   --hold    seconds to hold the end card                     (default 2)
 *   --fps     frames per second                                (default 30)
 *   --out     output .mp4                                      (default docs/demo.mp4)
 *   --gif     also write a GIF (2× speed, 12 fps, 800 px wide) to this path
 *
 * Needs ffmpeg on your PATH and a Chromium for Playwright:
 *   npx playwright-core install chromium      (or set CHROME_PATH to an existing Chrome)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const file = opt('file', null);
const sample = opt('sample', 'spider-silk.md');
const frame = opt('frame', '16:9');
const skin = opt('skin', 'blueprint');
const speed = opt('speed', '1');
const fps = Number(opt('fps', '30'));
const intro = Number(opt('intro', '2.5'));
const hold = Number(opt('hold', '2'));
const out = resolve(root, opt('out', 'docs/demo.mp4'));
const gif = argv.includes('--gif') ? resolve(root, opt('gif', 'docs/demo.gif')) : null;
const SIZES = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] };
if (!SIZES[frame]) throw new Error(`Unknown frame ${frame}. Use 16:9, 9:16 or 1:1.`);
const [width, height] = SIZES[frame];

function run(cmd, args, input) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', fail);
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited with ${code}\n${err.slice(-2000)}`))));
    if (input) input(p);
  });
}

const server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const base = server.resolvedUrls.local[0];

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
} catch (err) {
  await server.close();
  console.error('Could not start Chromium. Run `npx playwright-core install chromium` or set CHROME_PATH.\n', err.message);
  process.exit(1);
}

const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('[page]', e.message));
const query = new URLSearchParams({ capture: '1', fps: String(fps), frame, skin, speed, hideui: '1' });
await page.goto(`${base}?${query}`);
await page.waitForFunction(() => window.__spider);
await page.evaluate(() => window.__spider.preload());

mkdirSync(dirname(out), { recursive: true });
const tmp = out.replace(/\.mp4$/, '.part.mp4');
let ffmpeg;
const encoder = run(
  'ffmpeg',
  ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp],
  (p) => (ffmpeg = p),
);
const write = (buf) => new Promise((ok) => (ffmpeg.stdin.write(buf) ? ok() : ffmpeg.stdin.once('drain', ok)));

let frames = 0;
async function shoot(n = 1) {
  for (let i = 0; i < n; i++) {
    const data = await page.evaluate(() => {
      window.__spider.step(1);
      return window.__spider.frame('image/jpeg', 0.92);
    });
    await write(Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
    frames++;
    if (frames % (fps * 5) === 0) process.stdout.write(`\r  ${Math.round(frames / fps)} s rendered`);
  }
}

console.log(`Rendering ${file ?? sample} at ${width}×${height}, ${fps} fps…`);
// Landing page: a pointer drifts across the sheet and the spider follows it.
const introFrames = Math.round(intro * fps);
for (let i = 0; i < introFrames; i++) {
  const t = i / Math.max(1, introFrames - 1);
  await page.evaluate(([x, y]) => window.__spider.pointer(x, y), [width * (0.3 + 0.4 * t), height * (0.42 + 0.08 * Math.sin(t * Math.PI))]);
  await shoot();
}
if (file) {
  if (!existsSync(file)) throw new Error(`No such file: ${file}`);
  await page.setInputFiles('#file-input', resolve(file));
} else {
  await page.evaluate((s) => window.__spider.open(s), sample);
}
await page.waitForFunction(() => ['leaving', 'crawl'].includes(window.__spider.phase), null, { timeout: 60000 });
// Film the leap, then make sure every page is rasterized before the spider lands.
while ((await page.evaluate(() => window.__spider.phase)) === 'leaving') await shoot();
await page.evaluate(() => window.__spider.preload());
const maxFrames = fps * 180;
while (frames < maxFrames && !(await page.evaluate(() => window.__spider.settled))) await shoot(fps / 2);
await shoot(Math.round(hold * fps));
ffmpeg.stdin.end();
await encoder;
renameSync(tmp, out);
console.log(`\r  wrote ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB, ${(frames / fps).toFixed(1)} s)`);

await browser.close();
await server.close();

if (gif) {
  // A smaller copy for the README: twice as fast, 12 fps, 800 px wide, 96-color palette.
  const w = Math.min(800, width);
  const filter = `setpts=0.5*PTS,fps=12,scale=${w}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  const tmpGif = gif.replace(/\.gif$/, '.part.gif');
  if (existsSync(tmpGif)) rmSync(tmpGif);
  await run('ffmpeg', ['-y', '-i', out, '-vf', filter, '-loop', '0', tmpGif]);
  renameSync(tmpGif, gif);
  console.log(`  wrote ${gif} (${(statSync(gif).size / 1e6).toFixed(1)} MB)`);
}
