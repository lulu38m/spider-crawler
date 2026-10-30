import type { Camera } from './camera';
import { PALETTE } from './palette';

/** The drafting table: navy gradient in screen space, a blueprint grid in world space. */
export function drawBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, cam: Camera, alpha = 1): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
  g.addColorStop(0, PALETTE.duskCenter);
  g.addColorStop(0.55, PALETTE.dusk);
  g.addColorStop(1, PALETTE.duskEdge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (alpha <= 0) return;

  // Grid lines move with the camera, so panning reads as motion.
  cam.apply(ctx, w, h, dpr);
  const view = cam.view(w, h, 10);
  const minor = 40;
  const major = 200;
  const px = 1 / cam.zoom;
  const lines = (step: number, a: number, width: number) => {
    ctx.strokeStyle = `rgba(${PALETTE.grid}, ${a * alpha})`;
    ctx.lineWidth = width * px;
    ctx.beginPath();
    for (let x = Math.floor(view.x / step) * step; x <= view.x + view.w; x += step) {
      ctx.moveTo(x, view.y);
      ctx.lineTo(x, view.y + view.h);
    }
    for (let y = Math.floor(view.y / step) * step; y <= view.y + view.h; y += step) {
      ctx.moveTo(view.x, y);
      ctx.lineTo(view.x + view.w, y);
    }
    ctx.stroke();
  };
  if (cam.zoom * minor > 9) lines(minor, 0.06, 1);
  lines(major, 0.12, 1.2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
