import { rotate, type Vec2 } from '../core/math';
import type { Leg, Spider } from './spider';
import type { BodyShape, JointShape, Skin } from './skins';

/**
 * Every spider is drawn as its own rig, like a technical diagram:
 * - the two colors are the two gait groups (four legs lift together, then the other four),
 * - crosses mark where each foot would like to stand,
 * - dashed arcs are steps in flight,
 * - joints are the hips and knees the IK solver places.
 * Skins only change shapes and colors.
 */

export interface SpiderDrawOptions {
  /** 0..1 multiplier for the cast shadow. */
  shadow: number;
  /** Shadow offset per unit of height (direction away from the light). */
  light: Vec2;
  /** Device pixels per world unit (glow blur is specified in device pixels). */
  px: number;
}

export const DEFAULT_DRAW: SpiderDrawOptions = { shadow: 1, light: { x: 0.42, y: 0.78 }, px: 1 };

const SHADOW_RGB = '20, 18, 46';

interface BodyGeometry {
  ceph: Vec2;
  cephR: Vec2;
  abd: Vec2;
  abdR: Vec2;
  abdAngle: number;
  pedicel: Vec2;
}

function at(sp: Spider, x: number, y: number): Vec2 {
  const r = rotate({ x, y }, sp.heading);
  return { x: sp.pos.x + r.x, y: sp.pos.y + r.y };
}

function bodyGeometry(sp: Spider): BodyGeometry {
  const s = sp.scale;
  const skin = sp.skin;
  const pedicel = at(sp, -3.5 * s, 0);
  const abdR = { x: 15 * skin.abdomen.length * s, y: 11.5 * skin.abdomen.width * s };
  const abdAngle = sp.heading + sp.abdomenSwing;
  const off = rotate({ x: -abdR.x * 0.9, y: 0 }, abdAngle);
  return {
    ceph: at(sp, 6 * s, 0),
    cephR: { x: 10.5 * s, y: 8.6 * s },
    abd: { x: pedicel.x + off.x, y: pedicel.y + off.y },
    abdR,
    abdAngle,
    pedicel,
  };
}

/** Build a body-part path (the caller fills and strokes it). */
function shapePath(ctx: CanvasRenderingContext2D, shape: BodyShape, c: Vec2, rx: number, ry: number, angle: number): void {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(angle);
  ctx.beginPath();
  switch (shape) {
    case 'ellipse':
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      break;
    case 'circle':
      ctx.arc(0, 0, (rx + ry) / 2, 0, Math.PI * 2);
      break;
    case 'rect':
      ctx.roundRect(-rx, -ry, rx * 2, ry * 2, Math.min(rx, ry) * 0.28);
      break;
    case 'hex':
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const x = Math.cos(a) * rx;
        const y = Math.sin(a) * ry * 1.12;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(rx * 1.08, 0);
      ctx.lineTo(0, ry * 1.08);
      ctx.lineTo(-rx * 1.08, 0);
      ctx.lineTo(0, -ry * 1.08);
      ctx.closePath();
      break;
  }
  ctx.restore();
}

function jointPath(ctx: CanvasRenderingContext2D, shape: JointShape, p: Vec2, r: number, angle: number): void {
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    return;
  }
  // Squares line up with the femur; diamonds are squares turned 45°.
  const a0 = shape === 'diamond' ? angle + Math.PI / 4 : angle;
  const d = shape === 'diamond' ? r * 1.35 : r * 1.25;
  for (let k = 0; k < 4; k++) {
    const a = a0 + Math.PI / 4 + (k * Math.PI) / 2;
    const x = p.x + Math.cos(a) * d;
    const y = p.y + Math.sin(a) * d;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Stroke the current path in the skin's style: white halo underneath, or a neon glow. */
function stroke(ctx: CanvasRenderingContext2D, skin: Skin, color: string, width: number, s: number, opts: SpiderDrawOptions): void {
  if (skin.halo) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = width + 3.2 * s;
    ctx.stroke();
  }
  if (skin.glow > 0) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 10 * skin.glow * opts.px * s;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  if (skin.glow > 0) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }
}

/** Draw a spider in world space (the caller sets the camera transform). */
export function drawSpider(ctx: CanvasRenderingContext2D, sp: Spider, opts: SpiderDrawOptions = DEFAULT_DRAW): void {
  const skin = sp.skin;
  const s = sp.scale;
  const geo = bodyGeometry(sp);
  const lw = 1.7 * s * skin.legWidth;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (opts.shadow > 0) drawShadow(ctx, sp, geo, opts, lw);

  // Rest targets: where each foot would like to stand.
  ctx.strokeStyle = skin.colors.ink;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 0.9 * s;
  ctx.beginPath();
  const c = 2.8 * s;
  for (const leg of sp.legs) {
    const r = sp.restWorld(leg);
    ctx.moveTo(r.x - c, r.y - c);
    ctx.lineTo(r.x + c, r.y + c);
    ctx.moveTo(r.x + c, r.y - c);
    ctx.lineTo(r.x - c, r.y + c);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Steps in flight: dashed arcs bulging away from the body.
  ctx.setLineDash([3 * s, 3 * s]);
  ctx.lineWidth = 1.1 * s;
  for (const leg of sp.legs) {
    if (!leg.stepping) continue;
    const mx = (leg.stepFrom.x + leg.stepTo.x) / 2;
    const my = (leg.stepFrom.y + leg.stepTo.y) / 2;
    const ox = mx - sp.pos.x;
    const oy = my - sp.pos.y;
    const ol = Math.hypot(ox, oy) || 1;
    const bulge = Math.hypot(leg.stepTo.x - leg.stepFrom.x, leg.stepTo.y - leg.stepFrom.y) * 0.35;
    ctx.strokeStyle = skin.colors.legs[leg.group];
    ctx.beginPath();
    ctx.moveTo(leg.stepFrom.x, leg.stepFrom.y);
    ctx.quadraticCurveTo(mx + (ox / ol) * bulge, my + (oy / ol) * bulge, leg.stepTo.x, leg.stepTo.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const leg of sp.legs) drawLeg(ctx, sp, leg, lw, opts);

  // Body plates.
  ctx.fillStyle = skin.colors.fill;
  shapePath(ctx, skin.body, geo.abd, geo.abdR.x, geo.abdR.y, geo.abdAngle);
  ctx.fill();
  stroke(ctx, skin, skin.colors.ink, 1.4 * s, s, opts);
  ctx.fillStyle = skin.colors.fill;
  shapePath(ctx, skin.body, geo.ceph, geo.cephR.x, geo.cephR.y, sp.heading);
  ctx.fill();
  stroke(ctx, skin, skin.colors.ink, 1.4 * s, s, opts);

  // Construction lines: the body axis and an inner plate.
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = skin.colors.ink;
  ctx.lineWidth = 0.8 * s;
  ctx.setLineDash([2.5 * s, 2.5 * s]);
  ctx.beginPath();
  const tail = rotate({ x: -geo.abdR.x * 1.15, y: 0 }, geo.abdAngle);
  ctx.moveTo(geo.abd.x + tail.x, geo.abd.y + tail.y);
  ctx.lineTo(geo.pedicel.x, geo.pedicel.y);
  const nose = at(sp, 24 * s, 0);
  ctx.lineTo(nose.x, nose.y);
  ctx.stroke();
  ctx.setLineDash([]);
  shapePath(ctx, skin.body, geo.abd, geo.abdR.x * 0.55, geo.abdR.y * 0.55, geo.abdAngle);
  ctx.stroke();
  ctx.restore();

  // Pedicel: the waist joint.
  jointPath(ctx, skin.joints, geo.pedicel, 1.8 * s, sp.heading);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = skin.colors.ink;
  ctx.lineWidth = 1.2 * s;
  ctx.stroke();

  drawEyes(ctx, sp, geo, opts);

  // Velocity vector.
  const v = { x: sp.vel.x * 0.11, y: sp.vel.y * 0.11 };
  const vl = Math.hypot(v.x, v.y);
  if (vl > 4 * s) {
    const tip = { x: sp.pos.x + v.x, y: sp.pos.y + v.y };
    const ux = v.x / vl;
    const uy = v.y / vl;
    ctx.beginPath();
    ctx.moveTo(sp.pos.x, sp.pos.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.moveTo(tip.x - ux * 4 * s - uy * 2.6 * s, tip.y - uy * 4 * s + ux * 2.6 * s);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(tip.x - ux * 4 * s + uy * 2.6 * s, tip.y - uy * 4 * s - ux * 2.6 * s);
    stroke(ctx, skin, skin.colors.accent, 1.2 * s, s, opts);
  }
  ctx.restore();
}

function drawLeg(ctx: CanvasRenderingContext2D, sp: Spider, leg: Leg, lw: number, opts: SpiderDrawOptions): void {
  const skin = sp.skin;
  const s = sp.scale;
  const color = skin.colors.legs[leg.group];
  ctx.beginPath();
  ctx.moveTo(leg.hipW.x, leg.hipW.y);
  ctx.lineTo(leg.kneeW.x, leg.kneeW.y);
  ctx.lineTo(leg.endW.x, leg.endW.y);
  stroke(ctx, skin, color, lw, s, opts);
  const femur = Math.atan2(leg.kneeW.y - leg.hipW.y, leg.kneeW.x - leg.hipW.x);
  for (const p of [leg.hipW, leg.kneeW]) {
    jointPath(ctx, skin.joints, p, 2.2 * s, femur);
    ctx.fillStyle = skin.colors.eye;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2 * s;
    ctx.stroke();
  }
  // Feet: solid when planted, hollow and larger while stepping.
  jointPath(ctx, skin.joints, leg.endW, (leg.stepping ? 2.8 : 2) * s, femur);
  if (leg.stepping) {
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2 * s;
    ctx.stroke();
  } else {
    ctx.fillStyle = skin.colors.ink;
    ctx.fill();
  }
}

function drawShadow(ctx: CanvasRenderingContext2D, sp: Spider, geo: BodyGeometry, opts: SpiderDrawOptions, lw: number): void {
  const skin = sp.skin;
  const off = { x: opts.light.x * sp.z, y: opts.light.y * sp.z };
  const a = Math.max(0.35, 1 - (sp.z - 9 * sp.scale) / 160);
  ctx.strokeStyle = `rgba(${SHADOW_RGB}, ${0.13 * opts.shadow * a})`;
  ctx.lineWidth = lw * 2.2;
  ctx.beginPath();
  for (const leg of sp.legs) {
    const k = leg.footZ / Math.max(1, sp.z);
    ctx.moveTo(leg.hipW.x + off.x, leg.hipW.y + off.y);
    ctx.lineTo(leg.kneeW.x + off.x * 1.6, leg.kneeW.y + off.y * 1.6);
    ctx.lineTo(leg.endW.x + off.x * k, leg.endW.y + off.y * k);
  }
  ctx.stroke();
  ctx.fillStyle = `rgba(${SHADOW_RGB}, ${0.1 * opts.shadow * a})`;
  shapePath(ctx, skin.body, { x: geo.abd.x + off.x, y: geo.abd.y + off.y }, geo.abdR.x, geo.abdR.y, geo.abdAngle);
  ctx.fill();
  shapePath(ctx, skin.body, { x: geo.ceph.x + off.x, y: geo.ceph.y + off.y }, geo.cephR.x, geo.cephR.y, sp.heading);
  ctx.fill();
}

function drawEyes(ctx: CanvasRenderingContext2D, sp: Spider, geo: BodyGeometry, opts: SpiderDrawOptions): void {
  const skin = sp.skin;
  const s = sp.scale;
  const dot = (p: Vec2, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const glint = (p: Vec2, r: number) => dot({ x: p.x - r * 0.33, y: p.y - r * 0.38 }, Math.max(0.4, r * 0.34), '#ffffff');
  const glow = (on: boolean, blur: number) => {
    ctx.shadowColor = on ? skin.colors.accent : 'transparent';
    ctx.shadowBlur = on ? blur * opts.px * s : 0;
  };
  switch (skin.eyes) {
    case 'pair':
      for (const side of [-1, 1]) {
        const e = at(sp, 14 * s, side * 3.2 * s);
        dot(e, 2.4 * s, skin.colors.eye);
        glint(e, 2.4 * s);
      }
      break;
    case 'quad':
      for (const k of [-1.5, -0.5, 0.5, 1.5]) {
        const e = at(sp, (14.2 - Math.abs(k) * 1.3) * s, k * 2.7 * s);
        dot(e, 1.55 * s, skin.colors.eye);
        glint(e, 1.55 * s);
      }
      break;
    case 'visor': {
      // A dark band across the front with two lights in it.
      const rx = geo.cephR.x;
      const ry = geo.cephR.y;
      ctx.save();
      ctx.translate(geo.ceph.x, geo.ceph.y);
      ctx.rotate(sp.heading);
      ctx.fillStyle = skin.colors.eye;
      ctx.beginPath();
      ctx.roundRect(rx * 0.32, -ry * 0.74, rx * 0.5, ry * 1.48, 2.2 * s);
      ctx.fill();
      ctx.restore();
      glow(true, 6);
      for (const side of [-1, 1]) dot(at(sp, 6 * s + rx * 0.57, side * ry * 0.38), 1.5 * s, skin.colors.accent);
      glow(false, 0);
      break;
    }
    case 'cyclops': {
      const e = at(sp, 6 * s + geo.cephR.x * 0.42, 0);
      const r = geo.cephR.y * 0.5;
      dot(e, r, skin.colors.eye);
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 0.62, 0, Math.PI * 2);
      ctx.strokeStyle = skin.colors.accent;
      ctx.lineWidth = 1.1 * s;
      glow(skin.glow > 0, 8);
      ctx.stroke();
      glow(false, 0);
      glint(e, r);
      break;
    }
  }
}
