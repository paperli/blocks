import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { WebXRAnchorSystem } from "@babylonjs/core/XR/features/WebXRAnchorSystem";
import { BASEPLATE, UNITS } from "../config";
import { BuildGrid, GRID, BASEPLATE_TOP_Y, studLocalX, studLocalZ } from "./grid";
import type { ChosenSurface } from "../world/surfaces";
import type { DebugHud } from "../world/debugHud";

/**
 * The build root: a single TransformNode that parents the baseplate and every
 * snapped brick. Moving/scaling the build = transforming this node, which keeps
 * the whole creation rigid. Holds the authoritative occupancy grid.
 */
export class BuildRoot {
  readonly node: TransformNode;
  readonly grid = new BuildGrid();
  private baseplate!: Mesh;
  private anchor?: { remove(): void; detach(): void };

  constructor(
    private scene: Scene,
    private hud: DebugHud,
  ) {
    this.node = new TransformNode("buildRoot", scene);
    this.node.rotationQuaternion = Quaternion.Identity();
    this.buildBaseplate();
    // Stay hidden at the origin until placed on a real surface, otherwise the
    // baseplate would appear sitting on the floor at world (0,0,0).
    this.node.setEnabled(false);
  }

  private buildBaseplate(): void {
    const width = GRID.STUDS_X * UNITS.STUD_PITCH;
    const depth = GRID.STUDS_Z * UNITS.STUD_PITCH;

    const plate = MeshBuilder.CreateBox(
      "baseplate",
      { width, height: BASEPLATE.THICKNESS, depth },
      this.scene,
    );
    plate.parent = this.node;
    plate.position.y = BASEPLATE.THICKNESS / 2;
    // The baseplate is fixed to the desk — never grabbable/movable.
    plate.isPickable = false;

    const mat = new StandardMaterial("baseplateMat", this.scene);
    mat.diffuseColor = new Color3(0.18, 0.42, 0.24);
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    plate.material = mat;

    // Studs across the whole 20x20 grid, one draw call via thin instances.
    const stud = MeshBuilder.CreateCylinder(
      "baseStuds",
      { diameter: UNITS.STUD_RADIUS * 2, height: UNITS.STUD_HEIGHT, tessellation: 10 },
      this.scene,
    );
    stud.parent = this.node;
    stud.material = mat;
    stud.isPickable = false;

    const y = BASEPLATE_TOP_Y + UNITS.STUD_HEIGHT / 2;
    const matrices: Matrix[] = [];
    for (let i = 0; i < GRID.STUDS_X; i++) {
      for (let j = 0; j < GRID.STUDS_Z; j++) {
        matrices.push(Matrix.Translation(studLocalX(i), y, studLocalZ(j)));
      }
    }
    stud.thinInstanceAdd(matrices);

    this.baseplate = plate;
    this.hud.log(`Baseplate ${GRID.STUDS_X}x${GRID.STUDS_Z} built (${matrices.length} studs).`);
  }

  /** Position the build on a detected surface and (optionally) world-anchor it. */
  placeOnSurface(surface: ChosenSurface, anchors?: WebXRAnchorSystem): void {
    this.node.position.copyFrom(surface.position);
    this.node.rotationQuaternion = surface.rotation.clone();
    this.node.setEnabled(true);
    this.hud.log(`Build placed on ${surface.isTable ? "TABLE" : "floor"} at ${vecStr(surface.position)}.`);
    // Anchor in the background — never block bank/menu setup on it.
    if (anchors) void this.anchorHere(anchors);
  }

  private async anchorHere(anchors: WebXRAnchorSystem): Promise<void> {
    try {
      const rot = this.node.rotationQuaternion ?? Quaternion.Identity();
      const anchor = await anchors.addAnchorAtPositionAndRotationAsync(this.node.position, rot);
      anchor.attachedNode = this.node;
      this.anchor = {
        remove: () => anchor.remove(),
        detach: () => {
          anchor.attachedNode = undefined;
        },
      };
      this.hud.log("Build anchored to room.");
    } catch (e) {
      this.hud.error("Could not anchor build (will float locally)", e);
    }
  }

  get baseplateMesh(): Mesh {
    return this.baseplate;
  }

  /** Stop the room anchor from driving the node so manual move/scale sticks. */
  releaseAnchorControl(): void {
    this.anchor?.detach();
  }

  get uniformScale(): number {
    return this.node.scaling.x;
  }
  set uniformScale(s: number) {
    this.node.scaling.setAll(s);
  }

  /** Remove all snapped bricks and clear occupancy (palm-menu Restart). */
  reset(): void {
    this.grid.clear();
    // Bricks are parented under the node; callers dispose brick entities.
  }

  dispose(): void {
    this.anchor?.remove();
    this.node.dispose(false, true);
  }
}

function vecStr(v: Vector3): string {
  return `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
}
