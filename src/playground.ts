/** Rig playground: tune the spider without loading a document. Open /playground.html in dev. */
import { Spider } from './spider/spider';
import { drawSpider, DEFAULT_DRAW } from './spider/draw';
import { SKINS, skinById } from './spider/skins';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const dpr = Math.min(2, window.devicePixelRatio || 1);
const zoom = Number(params.get('zoom') ?? 2.2);
let W = 0;
let H = 0;
const resize = () => {
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
};
resize();
addEventListener('resize', resize);

const spider = new Spider({ x: 0, y: 0 }, skinById(params.get('skin')));
let mouse: { x: number; y: number } | null = null;
const toWorld = (x: number, y: number) => ({ x: (x - W / 2) / zoom, y: (y - H / 2) / zoom });
addEventListener('pointermove', (e) => (mouse = toWorld(e.clientX, e.clientY)));
addEventListener('pointerdown', (e) => spider.jumpTo(toWorld(e.clientX, e.clientY)));
addEventListener('keydown', (e) => {
  const i = Number(e.key) - 1;
  if (SKINS[i]) spider.setSkin(SKINS[i]);
});

const auto = params.has('auto');
if (params.has('clean')) document.getElementById('hud')!.hidden = true;
let t = 0;
function step(dt: number) {
  t += dt;
  if (auto) {
    const r = 120;
    spider.goal = { x: Math.sin(t * 0.9) * r * 1.6, y: Math.sin(t * 1.8) * r * 0.6 };
  } else if (mouse) {
    spider.goal = mouse;
  }
  spider.update(dt);
}
function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#f7f7f3';
  ctx.fillRect(0, 0, W, H);
  if (!params.has('clean')) {
    ctx.fillStyle = '#c9cbd6';
    ctx.font = '15px Georgia';
    for (let y = 40; y < H; y += 28) ctx.fillText('Spider silk is a protein fiber spun by spiders. They use it to make webs or other structures.'.repeat(3), 20, y);
  }
  const cx = params.has('follow') ? spider.pos.x : 0;
  const cy = params.has('follow') ? spider.pos.y : 0;
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, (dpr * W) / 2 - cx * zoom * dpr, (dpr * H) / 2 - cy * zoom * dpr);
  drawSpider(ctx, spider, { ...DEFAULT_DRAW, px: zoom * dpr });
}

const until = params.get('t');
if (until) {
  // Deterministic: simulate to time t then render once (used for screenshots).
  const target = Number(until);
  while (t < target) step(1 / 60);
  render();
  (window as unknown as { __ready: boolean }).__ready = true;
} else {
  let last = performance.now();
  const loop = (now: number) => {
    step(Math.min(0.05, (now - last) / 1000));
    last = now;
    render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
