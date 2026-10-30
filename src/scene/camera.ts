import { smoothDamp, type Rect, type Vec2 } from '../core/math';

/** A smooth follow camera. World → screen: (p - center) * zoom + viewport center. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  tx = 0;
  ty = 0;
  tz = 1;
  smoothTime = 0.5;
  zoomSmoothTime = 0.9;
  private vx = 0;
  private vy = 0;
  private vz = 0;

  set(x: number, y: number, zoom = this.tz): void {
    this.tx = x;
    this.ty = y;
    this.tz = zoom;
  }

  snap(): void {
    this.x = this.tx;
    this.y = this.ty;
    this.zoom = this.tz;
    this.vx = this.vy = this.vz = 0;
  }

  update(dt: number): void {
    [this.x, this.vx] = smoothDamp(this.x, this.tx, this.vx, this.smoothTime, dt);
    [this.y, this.vy] = smoothDamp(this.y, this.ty, this.vy, this.smoothTime, dt);
    [this.zoom, this.vz] = smoothDamp(this.zoom, this.tz, this.vz, this.zoomSmoothTime, dt);
  }

  /** Apply as the canvas transform (dpr = backing-store pixels per CSS pixel). */
  apply(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number): void {
    const z = this.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, dpr * (w / 2 - this.x * this.zoom), dpr * (h / 2 - this.y * this.zoom));
  }

  toScreen(p: Vec2, w: number, h: number): Vec2 {
    return { x: (p.x - this.x) * this.zoom + w / 2, y: (p.y - this.y) * this.zoom + h / 2 };
  }

  toWorld(p: Vec2, w: number, h: number): Vec2 {
    return { x: (p.x - w / 2) / this.zoom + this.x, y: (p.y - h / 2) / this.zoom + this.y };
  }

  view(w: number, h: number, margin = 0): Rect {
    const hw = w / 2 / this.zoom + margin;
    const hh = h / 2 / this.zoom + margin;
    return { x: this.x - hw, y: this.y - hh, w: hw * 2, h: hh * 2 };
  }
}
