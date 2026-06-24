import HavokPhysics from "@babylonjs/havok";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import type { DebugHud } from "../world/debugHud";

/**
 * Thin wrapper around the Havok plugin. Only *loose* bricks (dropped, falling,
 * thrown) are simulated; snapped bricks are static and parented under the build
 * root, so the physics world stays tiny. Provides a static ground collider at
 * the chosen surface height so dropped bricks come to rest on the real table.
 */
export class PhysicsWorld {
  private plugin?: HavokPlugin;
  private ground?: Mesh;
  ready = false;

  constructor(
    private scene: Scene,
    private hud: DebugHud,
  ) {}

  async init(): Promise<void> {
    try {
      const havok = await HavokPhysics({ locateFile: () => "/HavokPhysics.wasm" } as never);
      this.plugin = new HavokPlugin(true, havok);
      this.scene.enablePhysics(new Vector3(0, -9.81, 0), this.plugin);
      this.ready = true;
      this.hud.log("✓ Havok physics ready");
    } catch (e) {
      this.hud.error("Havok physics failed to init", e);
    }
  }

  /** Place an invisible static floor at world height y (the build surface). */
  setGround(y: number): void {
    if (!this.ready) return;
    this.ground?.dispose();
    const ground = MeshBuilder.CreateBox(
      "physGround",
      { width: 6, height: 0.05, depth: 6 },
      this.scene,
    );
    ground.position.set(0, y - 0.025, 0);
    ground.isVisible = false;
    ground.isPickable = false;
    new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0, friction: 0.7, restitution: 0.1 }, this.scene);
    this.ground = ground;
  }

  /** Make a brick mesh a dynamic rigid body. Returns the aggregate. */
  makeDynamic(mesh: Mesh, mass = 0.05): PhysicsAggregate | undefined {
    if (!this.ready) return undefined;
    const agg = new PhysicsAggregate(
      mesh,
      PhysicsShapeType.BOX,
      { mass, friction: 0.5, restitution: 0.2 },
      this.scene,
    );
    agg.body.setLinearDamping(0.1);
    agg.body.setAngularDamping(0.2);
    return agg;
  }
}
