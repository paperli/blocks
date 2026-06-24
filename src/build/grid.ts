import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { BASEPLATE, BRICK_HEIGHT, INTERACTION, UNITS } from "../config";

/**
 * The build grid is defined in the *local* space of the build root transform.
 * - i runs along local +X over [0, STUDS_X)
 * - j runs along local +Z over [0, STUDS_Z)
 * - layer runs vertically in "plate" units; layer 0 = a brick resting on the
 *   baseplate. A full brick is PLATES_PER_BRICK plates tall.
 *
 * Snapping is deterministic integer-grid math (no physics joints): a brick is
 * valid at (i, j, layer) if all its footprint cells across its height are free
 * and it is supported from below.
 */

export const GRID = {
  STUDS_X: BASEPLATE.STUDS_X,
  STUDS_Z: BASEPLATE.STUDS_Z,
} as const;

/** Top surface of the baseplate in build-root local space (studs sit above). */
export const BASEPLATE_TOP_Y = BASEPLATE.THICKNESS;

/** Local X of stud column i (centered around the build-root origin). */
export function studLocalX(i: number): number {
  return (i - (GRID.STUDS_X - 1) / 2) * UNITS.STUD_PITCH;
}

/** Local Z of stud row j. */
export function studLocalZ(j: number): number {
  return (j - (GRID.STUDS_Z - 1) / 2) * UNITS.STUD_PITCH;
}

/** Local Y of the bottom face of a brick resting at the given plate layer. */
export function layerBottomY(layer: number): number {
  return BASEPLATE_TOP_Y + layer * UNITS.PLATE_HEIGHT;
}

/** Local Y of the center of a full brick occupying [layer, layer+height). */
export function brickCenterY(layer: number, heightPlates: number): number {
  return layerBottomY(layer) + (heightPlates * UNITS.PLATE_HEIGHT) / 2;
}

export interface FootprintCell {
  i: number;
  j: number;
}

/** Grid placement of a snapped brick (build-root local), saved & restored. */
export interface BrickPlacement {
  /** Min-corner stud indices. */
  i0: number;
  j0: number;
  /** Plate layer (0 = on baseplate). */
  layer: number;
  /** Yaw quarter-turns (0..3) about +Y. */
  quarter: number;
}

/** Cells covered by a w×d footprint anchored at its min corner (i0, j0). */
export function footprintCells(i0: number, j0: number, w: number, d: number): FootprintCell[] {
  const cells: FootprintCell[] = [];
  for (let di = 0; di < w; di++) {
    for (let dj = 0; dj < d; dj++) cells.push({ i: i0 + di, j: j0 + dj });
  }
  return cells;
}

export function inBounds(i: number, j: number): boolean {
  return i >= 0 && i < GRID.STUDS_X && j >= 0 && j < GRID.STUDS_Z;
}

const FULL_BRICK_PLATES = Math.round(BRICK_HEIGHT / UNITS.PLATE_HEIGHT);

function cellKey(i: number, j: number, layer: number): string {
  return `${i}:${j}:${layer}`;
}

/**
 * Occupancy of the build. Each placed brick claims one (i, j, layer) cell per
 * footprint stud per plate-layer it spans. Powers snap validation, stacking
 * support checks, removal, undo, and save/load.
 */
export class BuildGrid {
  /** cellKey -> brick id occupying it. */
  private cells = new Map<string, string>();
  /** brick id -> the cell keys it owns (for fast removal). */
  private byBrick = new Map<string, string[]>();

  /** Plate-layers a brick of the given height occupies starting at `layer`. */
  private spannedLayers(layer: number, heightPlates: number): number[] {
    const out: number[] = [];
    for (let l = 0; l < heightPlates; l++) out.push(layer + l);
    return out;
  }

  /** True if every footprint cell across the brick's height is free + in-bounds. */
  canPlace(cells: FootprintCell[], layer: number, heightPlates: number): boolean {
    for (const c of cells) {
      if (!inBounds(c.i, c.j)) return false;
      for (const l of this.spannedLayers(layer, heightPlates)) {
        if (this.cells.has(cellKey(c.i, c.j, l))) return false;
      }
    }
    return true;
  }

  /**
   * A brick is "supported" if it rests on the baseplate (layer 0) or at least
   * one footprint cell sits directly on top of an occupied cell below.
   */
  isSupported(cells: FootprintCell[], layer: number): boolean {
    if (layer <= 0) return true;
    const below = layer - 1;
    return cells.some((c) => this.cells.has(cellKey(c.i, c.j, below)));
  }

  place(brickId: string, cells: FootprintCell[], layer: number, heightPlates: number): void {
    const keys: string[] = [];
    for (const c of cells) {
      for (const l of this.spannedLayers(layer, heightPlates)) {
        const k = cellKey(c.i, c.j, l);
        this.cells.set(k, brickId);
        keys.push(k);
      }
    }
    this.byBrick.set(brickId, keys);
  }

  remove(brickId: string): void {
    const keys = this.byBrick.get(brickId);
    if (!keys) return;
    for (const k of keys) this.cells.delete(k);
    this.byBrick.delete(brickId);
  }

  has(brickId: string): boolean {
    return this.byBrick.has(brickId);
  }

  clear(): void {
    this.cells.clear();
    this.byBrick.clear();
  }

  /**
   * Lowest layer at which a footprint can rest given current occupancy: one
   * above the tallest occupied cell under the footprint (0 if none).
   */
  restingLayerFor(cells: FootprintCell[]): number {
    let top = 0;
    for (const c of cells) {
      for (let l = GRID.STUDS_X * FULL_BRICK_PLATES; l >= 0; l--) {
        if (this.cells.has(cellKey(c.i, c.j, l))) {
          top = Math.max(top, l + 1);
          break;
        }
      }
    }
    return top;
  }

  static get fullBrickPlates(): number {
    return FULL_BRICK_PLATES;
  }
}

/** Local-space position of the center of a footprint anchored at (i0, j0). */
export function footprintCenterLocal(
  i0: number,
  j0: number,
  w: number,
  d: number,
  layer: number,
  heightPlates: number,
): Vector3 {
  const cx = (studLocalX(i0) + studLocalX(i0 + w - 1)) / 2;
  const cz = (studLocalZ(j0) + studLocalZ(j0 + d - 1)) / 2;
  return new Vector3(cx, brickCenterY(layer, heightPlates), cz);
}

export interface PlacementGeometry {
  cells: FootprintCell[];
  localPos: Vector3;
  localRot: Quaternion;
  effW: number;
  effD: number;
}

/**
 * Resolve a placement back into concrete local transform + footprint cells.
 * Shared by snapping (live), undo/redo, and save/load so a placement always
 * reconstructs identically. Odd quarter-turns swap the footprint dimensions.
 */
export function placementGeometry(w: number, d: number, p: BrickPlacement): PlacementGeometry {
  const swap = p.quarter % 2 === 1;
  const effW = swap ? d : w;
  const effD = swap ? w : d;
  const heightPlates = FULL_BRICK_PLATES;
  const cells = footprintCells(p.i0, p.j0, effW, effD);
  const localPos = footprintCenterLocal(p.i0, p.j0, effW, effD, p.layer, heightPlates);
  const localRot = Quaternion.RotationAxis(Vector3.Up(), p.quarter * INTERACTION.YAW_SNAP_RAD);
  return { cells, localPos, localRot, effW, effD };
}
