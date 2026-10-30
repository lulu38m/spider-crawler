/**
 * Skins are plain data: every spider is drawn as its own procedural rig (a "skeleton"),
 * so a skin only picks proportions, shapes and colors. Adding one is a great first
 * contribution: copy a skin, change the numbers, and it shows up in the picker.
 */

export type BodyShape = 'ellipse' | 'rect' | 'hex' | 'diamond' | 'circle';
export type JointShape = 'circle' | 'square' | 'diamond';
export type EyeStyle = 'pair' | 'visor' | 'cyclops' | 'quad';

export interface Skin {
  id: string;
  name: string;
  /** One line shown in the picker. */
  blurb: string;
  /** Overall size multiplier. */
  scale: number;
  /** Leg reach multiplier. */
  legLength: number;
  /** Line thickness multiplier. */
  legWidth: number;
  abdomen: { length: number; width: number };
  body: BodyShape;
  joints: JointShape;
  eyes: EyeStyle;
  colors: {
    /** The two alternating gait groups (each lifts four legs at a time). */
    legs: [string, string];
    /** Outlines, foot targets and planted feet. */
    ink: string;
    /** Translucent body fill. */
    fill: string;
    eye: string;
    /** Glints, visor lights, velocity arrow. */
    accent: string;
  };
  /** Neon glow strength (0 = none). */
  glow: number;
  /** White underlay so dark ink reads on any background. */
  halo: boolean;
}

export const SKINS: Skin[] = [
  {
    id: 'blueprint',
    name: 'Blueprint',
    blurb: 'The original rig: hips, knees, foot targets and steps in flight.',
    scale: 1.15,
    legLength: 1,
    legWidth: 1,
    abdomen: { length: 1, width: 1 },
    body: 'ellipse',
    joints: 'circle',
    eyes: 'pair',
    colors: { legs: ['#f4b400', '#ff4f86'], ink: '#3f9cf0', fill: 'rgba(63, 156, 240, 0.22)', eye: '#0d1b2a', accent: '#f4b400' },
    glow: 0,
    halo: false,
  },
  {
    id: 'boxy',
    name: 'Boxy',
    blurb: 'Built from rectangles, with square rivets and a robot visor.',
    scale: 1.15,
    legLength: 0.95,
    legWidth: 1.3,
    abdomen: { length: 1, width: 1.05 },
    body: 'rect',
    joints: 'square',
    eyes: 'visor',
    colors: { legs: ['#ff6b4a', '#00b3a4'], ink: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.2)', eye: '#1b1530', accent: '#5ef2ff' },
    glow: 0,
    halo: false,
  },
  {
    id: 'hexa',
    name: 'Hexa',
    blurb: 'Hexagonal plates and diamond joints, like a low-poly bug.',
    scale: 1.15,
    legLength: 1.05,
    legWidth: 1.05,
    abdomen: { length: 1.12, width: 0.95 },
    body: 'hex',
    joints: 'diamond',
    eyes: 'quad',
    colors: { legs: ['#6fb800', '#3f9cf0'], ink: '#14b8a6', fill: 'rgba(20, 184, 166, 0.2)', eye: '#0b2420', accent: '#7cc800' },
    glow: 0,
    halo: false,
  },
  {
    id: 'neon',
    name: 'Neon',
    blurb: 'Glowing diamonds and one big eye. Best at night.',
    scale: 1.1,
    legLength: 1.1,
    legWidth: 0.95,
    abdomen: { length: 1.05, width: 0.92 },
    body: 'diamond',
    joints: 'circle',
    eyes: 'cyclops',
    colors: { legs: ['#ff2bd6', '#00c8ff'], ink: '#a979ff', fill: 'rgba(169, 121, 255, 0.16)', eye: '#14002a', accent: '#00e5ff' },
    glow: 1,
    halo: false,
  },
  {
    id: 'stilts',
    name: 'Stilts',
    blurb: 'A tiny round body on eight enormous legs.',
    scale: 0.95,
    legLength: 2,
    legWidth: 0.8,
    abdomen: { length: 0.8, width: 0.85 },
    body: 'circle',
    joints: 'circle',
    eyes: 'pair',
    colors: { legs: ['#8b5cf6', '#ff8a00'], ink: '#f97316', fill: 'rgba(249, 115, 22, 0.18)', eye: '#2a1405', accent: '#8b5cf6' },
    glow: 0,
    halo: false,
  },
  {
    id: 'sketch',
    name: 'Sketch',
    blurb: 'Drawn in ink, like a margin doodle that walked off.',
    scale: 1.15,
    legLength: 1,
    legWidth: 1.05,
    abdomen: { length: 1, width: 1 },
    body: 'ellipse',
    joints: 'circle',
    eyes: 'pair',
    colors: { legs: ['#23253a', '#6b6e88'], ink: '#23253a', fill: 'rgba(255, 255, 255, 0.8)', eye: '#23253a', accent: '#ff4f86' },
    glow: 0,
    halo: true,
  },
];

export const skinById = (id: string | null | undefined): Skin => SKINS.find((s) => s.id === id) ?? SKINS[0];
