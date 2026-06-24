import { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { BrickDef, createBrickMesh } from "./brickDefs";
import type { BrickPlacement } from "./grid";
import type { PhysicsWorld } from "../physics/havok";

export type BrickState = "held" | "dynamic" | "snapped";

let nextId = 1;

/**
 * A single brick instance. Owns its mesh and (when loose) its physics body, and
 * transitions between held / dynamic / snapped. Only dynamic bricks carry a
 * Havok aggregate; held and snapped bricks are moved kinematically.
 */
export class Brick {
  readonly id: string;
  readonly def: BrickDef;
  readonly colorName: string;
  readonly mesh: Mesh;
  state: BrickState = "dynamic";
  placement?: BrickPlacement;

  private aggregate?: PhysicsAggregate;

  constructor(
    scene: Scene,
    private physics: PhysicsWorld,
    def: BrickDef,
    colorName: string,
    id?: string,
  ) {
    this.def = def;
    this.colorName = colorName;
    this.id = id ?? `brick_${nextId++}`;
    this.mesh = createBrickMesh(scene, def, colorName);
    this.mesh.rotationQuaternion = Quaternion.Identity();
    this.mesh.metadata = { brickId: this.id };
    this.mesh.isPickable = true;
  }

  setWorldPose(position: Vector3, rotation: Quaternion): void {
    this.mesh.setParent(null);
    this.mesh.position.copyFrom(position);
    this.mesh.rotationQuaternion = rotation.clone();
  }

  /** Pick up: drop any physics body and move kinematically with the hand. */
  hold(): void {
    this.disposeBody();
    this.mesh.setParent(null);
    this.state = "held";
  }

  /** Release as a free rigid body with the given launch velocity. */
  dropDynamic(linearVelocity: Vector3, angularVelocity?: Vector3): void {
    this.disposeBody();
    this.mesh.setParent(null);
    this.aggregate = this.physics.makeDynamic(this.mesh);
    this.state = "dynamic";
    if (this.aggregate) {
      this.aggregate.body.setLinearVelocity(linearVelocity);
      if (angularVelocity) this.aggregate.body.setAngularVelocity(angularVelocity);
    }
  }

  /** Lock into the build at a local transform under the build root. */
  snap(parent: TransformNode, localPos: Vector3, localRot: Quaternion, placement: BrickPlacement): void {
    this.disposeBody();
    this.mesh.setParent(parent);
    this.mesh.position.copyFrom(localPos);
    this.mesh.rotationQuaternion = localRot.clone();
    this.placement = placement;
    this.state = "snapped";
  }

  private disposeBody(): void {
    if (this.aggregate) {
      this.aggregate.dispose();
      this.aggregate = undefined;
    }
  }

  dispose(): void {
    this.disposeBody();
    this.mesh.dispose(false, true);
  }
}
