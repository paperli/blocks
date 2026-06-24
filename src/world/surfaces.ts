import { Scene } from "@babylonjs/core/scene";
import { Vector3, Quaternion, Matrix } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { IWebXRPlane, WebXRPlaneDetector } from "@babylonjs/core/XR/features/WebXRPlaneDetector";
import { SURFACE } from "../config";
import type { DebugHud } from "./debugHud";

export interface ChosenSurface {
  /** World-space center of the surface. */
  position: Vector3;
  /** Orientation that maps local +Y to the surface normal. */
  rotation: Quaternion;
  /** True if this looks like a table/desk (vs the floor). */
  isTable: boolean;
}

/** Quest semantic labels (from Space Setup) we treat as a build surface. */
const TABLE_LABELS = new Set(["table", "desk", "desktop"]);
const FLOOR_LABELS = new Set(["floor"]);

interface TrackedPlane {
  plane: IWebXRPlane;
  outline?: LinesMesh;
  center: Vector3;
  area: number;
  horizontal: boolean;
  label: string;
}

/**
 * Tracks WebXR detected planes. Classifies them by Quest's `semanticLabel`
 * (table/desk/floor) — the reliable signal from Space Setup — and picks the
 * nearest table-like horizontal plane to anchor the build, falling back to the
 * floor, then to a guess in front of the user. Draws debug outlines and logs
 * every plane's label so detection issues are visible on-device.
 */
export class SurfaceManager {
  private tracked = new Map<IWebXRPlane, TrackedPlane>();
  private showOutlines = true;

  constructor(
    private scene: Scene,
    detector: WebXRPlaneDetector,
    private hud: DebugHud,
  ) {
    detector.onPlaneAddedObservable.add((p) => this.upsert(p, true));
    detector.onPlaneUpdatedObservable.add((p) => this.upsert(p, false));
    detector.onPlaneRemovedObservable.add((p) => this.remove(p));
  }

  setOutlinesVisible(v: boolean): void {
    this.showOutlines = v;
    for (const t of this.tracked.values()) t.outline?.setEnabled(v);
  }

  private planeLabel(plane: IWebXRPlane): string {
    // semanticLabel is a Meta/real-world-geometry extension, not yet in @types/webxr.
    const native = plane.xrPlane as XRPlane & { semanticLabel?: string };
    return (native?.semanticLabel ?? "").toLowerCase();
  }

  private upsert(plane: IWebXRPlane, isNew: boolean): void {
    const matrix = plane.transformationMatrix ?? Matrix.Identity();
    const poly = plane.polygonDefinition ?? [];
    if (poly.length < 3) return;

    const worldPts = poly.map((p) => Vector3.TransformCoordinates(p, matrix));
    const center = worldPts
      .reduce((acc, p) => acc.addInPlace(p), new Vector3())
      .scaleInPlace(1 / worldPts.length);
    const area = shoelaceArea(poly);
    const horizontal = plane.xrPlane?.orientation === "horizontal";
    const label = this.planeLabel(plane);

    let t = this.tracked.get(plane);
    if (!t) {
      t = { plane, center, area, horizontal, label };
      this.tracked.set(plane, t);
    } else {
      t.center = center;
      t.area = area;
      t.horizontal = horizontal;
      t.label = label;
    }

    if (isNew) {
      this.hud.log(
        `plane +"${label || "?"}" ${horizontal ? "horiz" : "vert"} ` +
          `y=${center.y.toFixed(2)} a=${area.toFixed(2)}`,
      );
    }

    t.outline?.dispose();
    const loop = [...worldPts, worldPts[0]];
    const lines = MeshBuilder.CreateLines("planeOutline", { points: loop, updatable: false }, this.scene);
    lines.color = TABLE_LABELS.has(label)
      ? new Color3(1, 0.8, 0.2)
      : horizontal
        ? new Color3(0.3, 1, 0.6)
        : new Color3(0.4, 0.6, 1);
    lines.isPickable = false;
    lines.renderingGroupId = 1;
    lines.setEnabled(this.showOutlines);
    t.outline = lines;
  }

  private remove(plane: IWebXRPlane): void {
    const t = this.tracked.get(plane);
    t?.outline?.dispose();
    this.tracked.delete(plane);
  }

  /**
   * Best build surface, or null if none yet. Scoring mirrors spatial-twin:
   * prefer table/desk (0) over floor (5) over unlabeled horizontal (8), then
   * break ties by distance to the user — nearest wins.
   */
  getBestSurface(): ChosenSurface | null {
    const cam = this.scene.activeCamera;
    const userPos = cam ? cam.globalPosition : new Vector3(0, 1.4, 0);

    let best: { center: Vector3; isTable: boolean; score: number } | null = null;
    for (const t of this.tracked.values()) {
      if (!t.horizontal || t.area < SURFACE.MIN_AREA) continue;
      const isTable = TABLE_LABELS.has(t.label);
      const isFloor = FLOOR_LABELS.has(t.label) || t.center.y < 0.2;
      const base = isTable ? 0 : isFloor ? 5 : 8;
      const score = base + Vector3.Distance(userPos, t.center);
      if (!best || score < best.score) {
        best = { center: t.center.clone(), isTable, score };
      }
    }
    if (!best) return null;
    return { position: best.center, rotation: Quaternion.Identity(), isTable: best.isTable };
  }

  get planeCount(): number {
    return this.tracked.size;
  }
}

/** Polygon area via the shoelace formula over local (x, z) coordinates. */
function shoelaceArea(poly: Vector3[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) / 2;
}
