/**
 * Central tunables for Blocky. Lengths are in metres (Babylon world units).
 *
 * We use a *scaled-down* LEGO ratio so a 20x20 baseplate comfortably fits on a
 * real desk. Real LEGO is 8mm stud pitch; here STUD_PITCH is a touch larger so
 * bricks are easy to grab with imprecise hand tracking, and the whole build can
 * be scaled at runtime anyway.
 */
export const UNITS = {
  /** Horizontal distance between adjacent studs (X/Z grid pitch). */
  STUD_PITCH: 0.02,
  /** Height of one "plate" layer. A standard brick is 3 plates tall. */
  PLATE_HEIGHT: 0.0064,
  /** Plates per full-height brick. */
  PLATES_PER_BRICK: 3,
  /** Stud (the bump on top) radius and protruding height. */
  STUD_RADIUS: 0.006,
  STUD_HEIGHT: 0.0032,
} as const;

/** Height of a full brick body (excludes the protruding stud). */
export const BRICK_HEIGHT = UNITS.PLATE_HEIGHT * UNITS.PLATES_PER_BRICK;

export const BASEPLATE = {
  /** Studs across each axis. The PRD asks for 20x20 notches. */
  STUDS_X: 20,
  STUDS_Z: 20,
  /** Thickness of the baseplate slab under the studs. */
  THICKNESS: 0.004,
} as const;

export const SURFACE = {
  /** A horizontal plane between these heights (m, relative to floor) is a "table". */
  TABLE_MIN_HEIGHT: 0.5,
  TABLE_MAX_HEIGHT: 1.25,
  /** Minimum area (m^2) for a plane to be considered a usable build surface. */
  MIN_AREA: 0.06,
  /** How far in front of the user (m) to place the build if we must guess. */
  FALLBACK_DISTANCE: 0.5,
} as const;

export const INTERACTION = {
  /** Pinch distance (thumb tip <-> index tip, m) below which a pinch is "closed". */
  PINCH_CLOSE: 0.022,
  PINCH_OPEN: 0.035,
  /** Snap search tolerance: how close (in stud pitches) a held brick must be. */
  SNAP_RADIUS_STUDS: 1.5,
  /** Hand speed (m/s) at release above which a held brick is thrown away. */
  THROW_DISMISS_SPEED: 1.6,
  /** Yaw is snapped to 90° increments while a brick is near the grid. */
  YAW_SNAP_RAD: Math.PI / 2,
  /** Shake-to-break: speed (m/s) and number of direction reversals within window. */
  SHAKE_SPEED: 0.9,
  SHAKE_REVERSALS: 4,
  SHAKE_WINDOW_MS: 700,
} as const;

export const SCALE = {
  MIN: 0.5,
  MAX: 3.0,
  /** Overshoot fraction used for the "hit the limit" bounce animation. */
  BOUNCE_OVERSHOOT: 0.08,
} as const;

/** A few starter colors for the brick bank (name -> hex). */
export const BRICK_COLORS: Record<string, string> = {
  red: "#d01012",
  yellow: "#f5c518",
  blue: "#1b6ec2",
  green: "#2f9e44",
  white: "#f2f2f2",
};

export const STORAGE_KEY = "blocky.save.v1";
