import {
  clamp,
  dampAngle,
  dist,
  easeInOutCubic,
  easeOutCubic,
  lerp,
  rotate,
  smoothDamp,
  vec,
  wrapAngle,
  type Vec2,
} from '../core/math';
import { solveTwoBone } from './ik';
import type { Skin } from './skins';

/**
 * A procedurally animated spider. Nothing here is keyframed: the body chases a goal point,
 * each foot stays planted until it drifts too far from where it would like to be, and then it
 * steps, in two alternating groups of four (the tetrapod gait real spiders use).
 */

export type SpiderMode = 'walk' | 'jump' | 'rappel';

export interface Leg {
  side: -1 | 1;
  pair: number;
  group: 0 | 1;
  /** Body-frame hip and resting-foot offsets (x forward, y to the right). */
  hip: Vec2;
  rest: Vec2;
  /** Femur and tibia lengths. */
  a: number;
  b: number;
  /** Planted foot position (world). */
  foot: Vec2;
  footZ: number;
  stepping: boolean;
  stepT: number;
  stepDur: number;
  stepFrom: Vec2;
  stepTo: Vec2;
  /** Solved each frame for drawing. */
  hipW: Vec2;
  kneeW: Vec2;
  endW: Vec2;
  kneeZ: number;
  /** Small per-leg variation so the gait doesn't look mechanical. */
  jitter: number;
}

interface JumpState {
  from: Vec2;
  to: Vec2;
  height: number;
  t: number;
  crouch: number;
  flight: number;
  land: number;
  landed: boolean;
}

interface RappelState {
  anchor: Vec2;
  from: Vec2;
  to: Vec2;
  t: number;
  dur: number;
}

// Base rig, body frame (units ≈ page points). Mirrored for the right side.
const BASE_LEGS: Array<{ hip: Vec2; rest: Vec2; a: number; b: number }> = [
  { hip: vec(9.5, 3.6), rest: vec(50, 32), a: 30, b: 34 },
  { hip: vec(6.5, 5.6), rest: vec(20, 52), a: 30, b: 36 },
  { hip: vec(2.5, 6.0), rest: vec(-14, 50), a: 27, b: 32 },
  { hip: vec(-1.0, 4.6), rest: vec(-42, 35), a: 30, b: 37 },
];

export const BODY_Z = 9;

export class Spider {
  pos: Vec2;
  vel = vec();
  heading: number;
  angVel = 0;
  z = BODY_Z;
  mode: SpiderMode = 'walk';
  legs: Leg[] = [];
  skin: Skin;
  /** Body-center goal; the director moves it, the spider chases it. */
  goal: Vec2;
  /** Desired facing when standing still (null = keep current). */
  face: number | null = null;
  speedLimit = 420;
  /** Abdomen lag when turning (secondary motion). */
  abdomenSwing = 0;
  private abdomenSwingVel = 0;
  /** 0..1, palps tap and the body leans in. */
  tasting = 0;
  /** 0..1, used for the idle "looking around" palps. */
  curiosity = 0;
  time = 0;
  steps = 0;
  /** Distance walked, in world units (the silk counter uses it). */
  traveled = 0;
  bobPhase = 0;
  jump: JumpState | null = null;
  rappel: RappelState | null = null;
  onStep?: (leg: Leg) => void;
  onLand?: () => void;

  constructor(pos: Vec2, skin: Skin, heading = 0) {
    this.pos = { ...pos };
    this.goal = { ...pos };
    this.heading = heading;
    this.skin = skin;
    this.rig();
  }

  get scale(): number {
    return this.skin.scale;
  }

  /** Build legs from the skin (sizes) and plant them around the body. */
  rig(): void {
    const s = this.skin.scale;
    const L = this.skin.legLength;
    this.legs = [];
    for (const side of [-1, 1] as const) {
      BASE_LEGS.forEach((base, pair) => {
        const hip = vec(base.hip.x * s, base.hip.y * side * s);
        // Longer legs reach further out from the hip.
        const restRel = vec((base.rest.x - base.hip.x) * L, (base.rest.y - base.hip.y) * L);
        const rest = vec(hip.x + restRel.x * s, hip.y + restRel.y * side * s);
        this.legs.push({
          side,
          pair,
          group: ((pair + (side === 1 ? 1 : 0)) % 2) as 0 | 1,
          hip,
          rest,
          a: base.a * s * L,
          b: base.b * s * L,
          foot: vec(),
          footZ: 0,
          stepping: false,
          stepT: 0,
          stepDur: 0.15,
          stepFrom: vec(),
          stepTo: vec(),
          hipW: vec(),
          kneeW: vec(),
          endW: vec(),
          kneeZ: 0,
          jitter: ((pair * 7 + (side + 1) * 3) % 5) / 5,
        });
      });
    }
    this.plantAll();
    this.solveLegs();
  }

  setSkin(skin: Skin): void {
    this.skin = skin;
    this.rig();
  }

  plantAll(at: Vec2 = this.pos): void {
    for (const leg of this.legs) {
      leg.foot = this.restWorld(leg, at);
      leg.stepping = false;
      leg.footZ = 0;
    }
  }

  restWorld(leg: Leg, at: Vec2 = this.pos, heading = this.heading, shrink = 1): Vec2 {
    const r = rotate({ x: leg.rest.x * shrink, y: leg.rest.y * shrink }, heading);
    return { x: at.x + r.x, y: at.y + r.y };
  }

  /** Leg reach used for step thresholds. */
  get reach(): number {
    return 48 * this.skin.scale * Math.sqrt(this.skin.legLength);
  }

  get headPos(): Vec2 {
    const r = rotate({ x: 15 * this.scale, y: 0 }, this.heading);
    return { x: this.pos.x + r.x, y: this.pos.y + r.y };
  }

  get spinnerets(): Vec2 {
    const back = (14 + 15 * this.skin.abdomen.length) * this.scale;
    const r = rotate({ x: -back, y: 0 }, this.heading + this.abdomenSwing);
    return { x: this.pos.x + r.x, y: this.pos.y + r.y };
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.y);
  }

  get busy(): boolean {
    return this.mode !== 'walk';
  }

  /** Teleport (no animation). */
  place(p: Vec2, heading = this.heading): void {
    this.pos = { ...p };
    this.goal = { ...p };
    this.vel = vec();
    this.heading = heading;
    this.mode = 'walk';
    this.jump = null;
    this.rappel = null;
    this.plantAll();
    this.solveLegs();
  }

  jumpTo(to: Vec2, height?: number): void {
    const d = dist(this.pos, to);
    this.mode = 'jump';
    this.jump = {
      from: { ...this.pos },
      to: { ...to },
      height: height ?? clamp(30 + d * 0.22, 30, 140),
      t: 0,
      crouch: 0.12,
      flight: clamp(0.28 + d / 1500, 0.3, 0.75),
      land: 0.16,
      landed: false,
    };
  }

  /** Drop down on a thread from `anchor` (above) to `to`. */
  rappelTo(anchor: Vec2, to: Vec2, duration?: number): void {
    this.mode = 'rappel';
    const from = { x: to.x, y: anchor.y + 30 };
    this.place(from, Math.PI / 2);
    this.mode = 'rappel';
    this.rappel = { anchor: { ...anchor }, from, to: { ...to }, t: 0, dur: duration ?? clamp(0.6 + (to.y - from.y) / 1400, 0.7, 2.2) };
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    const prevHeading = this.heading;
    if (this.mode === 'walk') this.updateWalk(dt);
    else if (this.mode === 'jump') this.updateJump(dt);
    else this.updateRappel(dt);
    this.angVel = wrapAngle(this.heading - prevHeading) / dt;

    // Abdomen swings opposite to turns, like a trailer behind a car.
    const target = clamp(-this.angVel * 0.045, -0.5, 0.5);
    const k = 70;
    const c = 2 * Math.sqrt(k) * 0.55;
    this.abdomenSwingVel += (k * (target - this.abdomenSwing) - c * this.abdomenSwingVel) * dt;
    this.abdomenSwing += this.abdomenSwingVel * dt;

    this.tasting = Math.max(0, this.tasting - dt * 0.9);
    this.solveLegs();
  }

  private updateWalk(dt: number): void {
    const [x, vx] = smoothDamp(this.pos.x, this.goal.x, this.vel.x, 0.1, dt, this.speedLimit);
    const [y, vy] = smoothDamp(this.pos.y, this.goal.y, this.vel.y, 0.1, dt, this.speedLimit);
    const moved = Math.hypot(x - this.pos.x, y - this.pos.y);
    this.pos = { x, y };
    this.vel = { x: vx, y: vy };
    this.traveled += moved;
    const speed = this.speed;

    if (speed > 14) {
      const desired = Math.atan2(vy, vx);
      const halfLife = 0.05 + 0.09 * (1 - Math.min(speed / 260, 1));
      this.heading = dampAngle(this.heading, desired, halfLife, dt);
    } else if (this.face !== null) {
      this.heading = dampAngle(this.heading, this.face, 0.14, dt);
    }

    // Gentle bob, synced with the distance walked.
    this.bobPhase += moved / (26 * this.scale);
    const bob = speed > 8 ? Math.sin(this.bobPhase * Math.PI * 2) * 0.7 : Math.sin(this.time * 2.2) * 0.25;
    this.z = BODY_Z * this.scale - this.tasting * 2.5 + bob;

    this.updateGait(dt, speed);
  }

  private updateGait(dt: number, speed: number): void {
    const s = this.scale;
    const stepDur = clamp(0.2 - speed * 0.00016, 0.07, 0.2);
    const lift = clamp(5 + speed * 0.014, 5, 13) * s;
    const moving = speed > 10;
    // Faster means longer strides: a foot may drift further from home before it steps.
    const threshold = this.reach * (moving ? clamp(0.3 + speed / 900, 0.3, 0.7) : 0.16);
    // Feet land ahead of home (where the body will be), but never further than the threshold,
    // so a freshly planted foot has a whole stride to travel before it needs to step again.
    const leadLen = Math.min(speed * stepDur * 1.1, threshold * 0.85);
    const lead = speed > 1e-3 ? { x: (this.vel.x / speed) * leadLen, y: (this.vel.y / speed) * leadLen } : { x: 0, y: 0 };
    const steppingIn: [number, number] = [0, 0];
    for (const leg of this.legs) if (leg.stepping) steppingIn[leg.group]++;

    // How far each group's worst planted foot has drifted from home.
    const homes = this.legs.map((leg) => this.restWorld(leg));
    const err: [number, number] = [0, 0];
    this.legs.forEach((leg, i) => {
      if (!leg.stepping) err[leg.group] = Math.max(err[leg.group], dist(leg.foot, homes[i]));
    });

    this.legs.forEach((leg, i) => {
      const home = homes[i];
      const want = { x: home.x + lead.x, y: home.y + lead.y };
      if (leg.stepping) {
        leg.stepT += dt / leg.stepDur;
        // Track the moving target so feet don't land behind the body.
        leg.stepTo = { x: lerp(leg.stepTo.x, want.x, 0.3), y: lerp(leg.stepTo.y, want.y, 0.3) };
        if (leg.stepT < 0) return; // waiting for its stagger
        const t = Math.min(1, leg.stepT);
        const e = easeInOutCubic(t);
        leg.foot = { x: lerp(leg.stepFrom.x, leg.stepTo.x, e), y: lerp(leg.stepFrom.y, leg.stepTo.y, e) };
        leg.footZ = Math.sin(Math.PI * t) * lift;
        if (t >= 1) {
          leg.stepping = false;
          leg.footZ = 0;
          this.steps++;
          this.onStep?.(leg);
        }
        return;
      }
      const d = dist(leg.foot, home);
      const other = (1 - leg.group) as 0 | 1;
      // Tetrapod gait: a group may lift only while the other group is planted.
      const groupTurn = steppingIn[other] === 0 && err[leg.group] >= threshold && err[leg.group] >= err[other] * 0.8;
      const emergency = d > Math.max(threshold * 1.6, this.reach * 0.75);
      const settle = !moving && steppingIn[other] === 0 && d > 3.5 * s && err[leg.group] >= err[other];
      if ((groupTurn && d > threshold * 0.5) || emergency || settle) {
        leg.stepping = true;
        leg.stepT = -leg.jitter * 0.15; // slight stagger inside the group
        leg.stepDur = stepDur * (0.92 + leg.jitter * 0.16);
        leg.stepFrom = { ...leg.foot };
        leg.stepTo = want;
        steppingIn[leg.group]++;
      }
    });
  }

  private updateJump(dt: number): void {
    const j = this.jump!;
    j.t += dt;
    const base = BODY_Z * this.scale;
    if (j.t < j.crouch) {
      this.z = base - 4 * this.scale * easeOutCubic(j.t / j.crouch);
      this.vel = vec();
      this.heading = dampAngle(this.heading, Math.atan2(j.to.y - j.from.y, j.to.x - j.from.x), 0.04, dt);
      return;
    }
    const ft = j.t - j.crouch;
    if (ft < j.flight) {
      const u = ft / j.flight;
      const e = easeInOutCubic(u);
      const prev = this.pos;
      this.pos = { x: lerp(j.from.x, j.to.x, e), y: lerp(j.from.y, j.to.y, e) };
      this.vel = { x: (this.pos.x - prev.x) / dt, y: (this.pos.y - prev.y) / dt };
      this.traveled += dist(prev, this.pos);
      this.z = base + j.height * 4 * u * (1 - u);
      this.heading = dampAngle(this.heading, Math.atan2(j.to.y - j.from.y, j.to.x - j.from.x), 0.05, dt);
      // Legs tuck in during flight and reach forward for the landing.
      const tuck = 0.55 + 0.35 * Math.max(0, u - 0.6) / 0.4;
      for (const leg of this.legs) {
        leg.stepping = false;
        leg.foot = this.restWorld(leg, this.pos, this.heading, tuck);
        leg.footZ = Math.max(0, this.z - 6 * this.scale);
      }
      return;
    }
    if (!j.landed) {
      j.landed = true;
      this.pos = { ...j.to };
      this.goal = { ...j.to };
      this.vel = vec();
      this.plantAll();
      this.onLand?.();
    }
    const lt = (ft - j.flight) / j.land;
    this.z = base - 3.5 * this.scale * Math.sin(Math.PI * Math.min(1, lt));
    if (lt >= 1) {
      this.mode = 'walk';
      this.jump = null;
      this.z = base;
    }
  }

  private updateRappel(dt: number): void {
    const r = this.rappel!;
    r.t += dt;
    const u = Math.min(1, r.t / r.dur);
    const e = easeOutCubic(u);
    const prev = this.pos;
    const sway = Math.sin(this.time * 2.6) * 7 * (1 - e);
    this.pos = { x: r.to.x + sway, y: lerp(r.from.y, r.to.y, e) };
    this.vel = { x: (this.pos.x - prev.x) / dt, y: (this.pos.y - prev.y) / dt };
    this.traveled += dist(prev, this.pos);
    this.heading = Math.PI / 2 + Math.sin(this.time * 1.7) * 0.12 * (1 - e);
    this.z = BODY_Z * this.scale + 70 * (1 - e) * this.scale;
    // Hanging pose: legs held close, gently paddling.
    this.legs.forEach((leg, i) => {
      leg.stepping = false;
      const paddle = 0.68 + 0.08 * Math.sin(this.time * 7 + i * 1.3);
      leg.foot = this.restWorld(leg, this.pos, this.heading, paddle);
      leg.footZ = Math.max(0, this.z - 5 * this.scale);
    });
    if (u >= 1) {
      this.rappel = null;
      this.mode = 'walk';
      this.pos = { ...r.to };
      this.goal = { ...r.to };
      this.vel = vec();
      this.z = BODY_Z * this.scale;
      this.plantAll();
      this.onLand?.();
    }
  }

  /** Solve IK for drawing. */
  solveLegs(): void {
    const center = this.pos;
    for (const leg of this.legs) {
      const h = rotate(leg.hip, this.heading);
      leg.hipW = { x: center.x + h.x, y: center.y + h.y };
      const res = solveTwoBone(leg.hipW, leg.foot, leg.a, leg.b, center);
      leg.kneeW = res.knee;
      leg.endW = res.end;
      // The more folded the leg, the higher the knee rises.
      leg.kneeZ = this.z + (10 + 12 * (1 - res.extension)) * this.scale + leg.footZ * 0.4;
    }
  }
}
