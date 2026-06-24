import { Scene } from "@babylonjs/core/scene";
import { Vector3, Quaternion, Matrix } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Observable } from "@babylonjs/core/Misc/observable";
import { BRICK_HEIGHT, INTERACTION, UNITS } from "../config";
import {
  GRID,
  footprintCells,
  footprintCenterLocal,
  inBounds,
  type FootprintCell,
} from "./grid";
import { BRICK_PLATES } from "./brickDefs";
import type { Brick } from "./brick";
import type { BuildRoot } from "./buildRoot";
import type { GrabManager, ReleaseContext } from "../interaction/grab";
import type { Handedness } from "../xr/input";

interface SnapCandidate {
  i0: number;
  j0: number;
  layer: number;
  quarter: number;
  effW: number;
  effD: number;
  localPos: Vector3;
  localRot: Quaternion;
}

/**
 * The core LEGO mechanic: while a brick is held near the grid, compute the
 * nearest valid stud-aligned placement (deterministic integer math, not physics
 * joints), preview it with a green ghost, and on release snap the brick into the
 * occupancy grid. Invalid/too-far releases fall through to the throw resolver so
 * the brick free-falls instead.
 */
export class SnapSystem {
  readonly onSnapObservable = new Observable<Brick>();
  private ghost: Mesh;
  private ghostMat: StandardMaterial;

  private grab: GrabManager;

  constructor(
    scene: Scene,
    private build: BuildRoot,
    grab: GrabManager,
  ) {
    this.grab = grab;
    this.ghostMat = new StandardMaterial("ghostMat", scene);
    this.ghostMat.diffuseColor = new Color3(0.3, 1, 0.5);
    this.ghostMat.alpha = 0.35;
    this.ghostMat.disableLighting = true;
    this.ghostMat.emissiveColor = new Color3(0.2, 0.8, 0.4);

    this.ghost = MeshBuilder.CreateBox("snapGhost", { size: 1 }, scene);
    this.ghost.material = this.ghostMat;
    this.ghost.isPickable = false;
    this.ghost.parent = this.build.node;
    this.ghost.setEnabled(false);

    scene.onBeforeRenderObservable.add(() => this.updateGhost());
    // Snap runs BEFORE throw in the resolver chain.
    grab.addResolver((ctx) => this.tryResolve(ctx));
  }

  /** Per-frame ghost preview for whichever hand currently holds a brick. */
  private updateGhost(): void {
    const held = this.heldBrickHand();
    if (!held) {
      this.ghost.setEnabled(false);
      return;
    }
    const cand = this.computeCandidate(held.brick);
    if (!cand) {
      this.ghost.setEnabled(false);
      return;
    }
    this.ghost.setEnabled(true);
    // effW/effD already encode the quarter rotation in grid-aligned space, so
    // the ghost box is axis-aligned (identity) — applying localRot too would
    // double-rotate and desync the preview from the held brick at 90°/270°.
    this.ghost.scaling.set(cand.effW * UNITS.STUD_PITCH, BRICK_HEIGHT, cand.effD * UNITS.STUD_PITCH);
    this.ghost.position.copyFrom(cand.localPos);
    this.ghost.rotationQuaternion = Quaternion.Identity();
  }

  private heldBrickHand(): { hand: Handedness; brick: Brick } | null {
    for (const h of ["left", "right"] as Handedness[]) {
      const brick = this.grab.heldBrick(h);
      if (brick) return { hand: h, brick };
    }
    return null;
  }

  private tryResolve(ctx: ReleaseContext): boolean {
    const cand = this.computeCandidate(ctx.brick);
    if (!cand) return false;

    const cells = footprintCells(cand.i0, cand.j0, cand.effW, cand.effD);
    if (!this.placementValid(cells, cand.layer)) return false;

    ctx.brick.snap(this.build.node, cand.localPos, cand.localRot, {
      i0: cand.i0,
      j0: cand.j0,
      layer: cand.layer,
      quarter: cand.quarter,
    });
    this.build.grid.place(ctx.brick.id, cells, cand.layer, BRICK_PLATES);
    this.onSnapObservable.notifyObservers(ctx.brick);
    return true;
  }

  /** Compute the nearest valid candidate for a held brick, or null if too far. */
  private computeCandidate(brick: Brick): SnapCandidate | null {
    const inv = Matrix.Invert(this.build.node.getWorldMatrix());
    const localCenter = Vector3.TransformCoordinates(brick.mesh.getAbsolutePosition(), inv);

    // Yaw relative to the build root, snapped to a quarter turn.
    const rootRot = this.build.node.absoluteRotationQuaternion ?? Quaternion.Identity();
    const localRotRaw = Quaternion.Inverse(rootRot).multiply(
      brick.mesh.rotationQuaternion ?? Quaternion.Identity(),
    );
    const yaw = quaternionYaw(localRotRaw);
    const quarter = ((Math.round(yaw / INTERACTION.YAW_SNAP_RAD) % 4) + 4) % 4;
    const swap = quarter % 2 === 1;
    const effW = swap ? brick.def.d : brick.def.w;
    const effD = swap ? brick.def.w : brick.def.d;

    // Min-corner indices so the footprint center lands near localCenter.
    const centerIdxX = localCenter.x / UNITS.STUD_PITCH + (GRID.STUDS_X - 1) / 2;
    const centerIdxZ = localCenter.z / UNITS.STUD_PITCH + (GRID.STUDS_Z - 1) / 2;
    const i0 = Math.round(centerIdxX - (effW - 1) / 2);
    const j0 = Math.round(centerIdxZ - (effD - 1) / 2);

    const cells = footprintCells(i0, j0, effW, effD);
    if (!cells.every((c) => inBounds(c.i, c.j))) return null;

    // Rest on the lowest available support under the footprint.
    const layer = this.build.grid.restingLayerFor(cells);
    const localPos = footprintCenterLocal(i0, j0, effW, effD, layer, BRICK_PLATES);

    // Proximity gate: only snap when the brick is actually near the target.
    const dx = localCenter.x - localPos.x;
    const dz = localCenter.z - localPos.z;
    const horiz = Math.hypot(dx, dz);
    const vert = Math.abs(localCenter.y - localPos.y);
    if (horiz > INTERACTION.SNAP_RADIUS_STUDS * UNITS.STUD_PITCH) return null;
    if (vert > BRICK_HEIGHT * 4) return null;

    const localRot = Quaternion.RotationAxis(Vector3.Up(), quarter * INTERACTION.YAW_SNAP_RAD);
    return { i0, j0, layer, quarter, effW, effD, localPos, localRot };
  }

  private placementValid(cells: FootprintCell[], layer: number): boolean {
    return (
      this.build.grid.canPlace(cells, layer, BRICK_PLATES) &&
      this.build.grid.isSupported(cells, layer)
    );
  }
}

/** Extract the yaw (rotation about +Y) encoded in a quaternion. */
function quaternionYaw(q: Quaternion): number {
  // Rotate local forward (+Z) and read its heading in the XZ plane.
  const f = new Vector3(0, 0, 1).applyRotationQuaternion(q);
  return Math.atan2(f.x, f.z);
}
