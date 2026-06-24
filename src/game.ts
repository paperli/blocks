import { Scene } from "@babylonjs/core/scene";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";

import { DebugHud } from "./world/debugHud";
import { SurfaceManager, type ChosenSurface } from "./world/surfaces";
import type { XrFeatures } from "./xr/features";
import { InputManager } from "./xr/input";
import { BuildRoot } from "./build/buildRoot";
import { BrickBank } from "./bank/brickBank";
import { GrabManager } from "./interaction/grab";
import { makeThrowResolver } from "./interaction/throw";
import { SnapSystem } from "./build/snapping";
import { PhysicsWorld } from "./physics/havok";
import { BASEPLATE_TOP_Y, placementGeometry, type BrickPlacement } from "./build/grid";
import { Brick } from "./build/brick";
import { brickDefById, BRICK_PLATES } from "./build/brickDefs";
import { CommandStack } from "./state/commands";
import { serializeBuild, saveToLocal, loadFromLocal } from "./state/persistence";
import { PalmMenu } from "./ui/palmMenu";
import { Feedback } from "./feedback";
import { SURFACE } from "./config";

/**
 * Top-level game wiring, constructed once the immersive-ar session is live.
 * Owns every subsystem and connects them: surface → build placement → physics
 * ground → brick bank → grab/throw. Phases 3+ register additional resolvers and
 * UI onto the same instances.
 */
export class Game {
  readonly build: BuildRoot;
  readonly physics: PhysicsWorld;
  readonly input: InputManager;
  bank!: BrickBank;
  grab!: GrabManager;
  snap!: SnapSystem;
  menu!: PalmMenu;
  feedback!: Feedback;
  readonly commands = new CommandStack();

  private placed = false;

  constructor(
    private scene: Scene,
    private hud: DebugHud,
    private xr: WebXRDefaultExperience,
    private features: XrFeatures,
    private surfaces?: SurfaceManager,
  ) {
    this.build = new BuildRoot(scene, hud);
    this.physics = new PhysicsWorld(scene, hud);
    this.input = new InputManager(scene, xr, features.hands);
  }

  async start(): Promise<void> {
    await this.physics.init();

    this.bank = new BrickBank(this.scene, this.physics, this.build, this.hud);
    this.grab = new GrabManager(this.scene, this.input, this.bank, this.build, this.hud);

    // Resolver order matters: snapping gets first refusal on every release, and
    // throw/dismiss is the terminal fallback when no valid snap exists.
    this.feedback = new Feedback(this.xr);

    this.snap = new SnapSystem(this.scene, this.build, this.grab);
    this.snap.onSnapObservable.add((b) => {
      this.recordPlacement(b);
      this.feedback.click();
      this.feedback.pulse();
    });
    this.grab.onBreakObservable.add(() => {
      this.feedback.click();
      this.feedback.pulse();
    });
    this.grab.addResolver(
      makeThrowResolver({
        unregister: (b) => this.grab.unregister(b),
        hud: this.hud,
        onDismiss: () => this.feedback.whoosh(),
      }),
    );

    // NOTE: whole-build move/scale (BuildManipulator) is intentionally disabled.
    // Scaling broke snapping (held bricks stay at 1x while the build scaled), and
    // the one-hand drag conflicted with pinch-to-grab. The build stays anchored
    // on the desk. Re-enable later once held bricks inherit the build scale.

    this.menu = new PalmMenu(this.scene, this.input, {
      undo: () => this.commands.undo(),
      redo: () => this.commands.redo(),
      restart: () => this.restart(),
      save: () => this.save(),
      load: () => this.load(),
    });

    this.startDiagnostics();
    this.runPlacement();
    (window as unknown as { blocky: unknown }).blocky = this;
  }

  /** Periodic on-device HUD line: what's detected and tracked right now. */
  private startDiagnostics(): void {
    let last = 0;
    this.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now();
      if (t - last < 2000) return;
      last = t;
      const l = this.input.getHandSample("left").tracked ? "Y" : "n";
      const r = this.input.getHandSample("right").tracked ? "Y" : "n";
      this.hud.log(
        `diag planes=${this.surfaces?.planeCount ?? 0} hands L:${l}/R:${r} bricks=${this.grab.bricks.size}`,
      );
    });
  }

  /** Push an undoable command for a freshly snapped brick. */
  private recordPlacement(brick: Brick): void {
    this.hud.log(`Snapped ${brick.def.id} ✓`);
    if (!brick.placement) return;
    const defId = brick.def.id;
    const color = brick.colorName;
    const placement: BrickPlacement = { ...brick.placement };
    let current = brick;
    this.commands.push({
      label: `place ${defId}`,
      undo: () => this.removeSnapped(current),
      redo: () => {
        current = this.spawnSnapped(defId, color, placement);
      },
    });
  }

  /** Recreate a snapped brick from saved data (redo / load). */
  spawnSnapped(defId: string, color: string, placement: BrickPlacement): Brick {
    const def = brickDefById(defId)!;
    const brick = new Brick(this.scene, this.physics, def, color);
    const geo = placementGeometry(def.w, def.d, placement);
    brick.snap(this.build.node, geo.localPos, geo.localRot, placement);
    this.build.grid.place(brick.id, geo.cells, placement.layer, BRICK_PLATES);
    this.grab.register(brick);
    return brick;
  }

  private removeSnapped(brick: Brick): void {
    this.build.grid.remove(brick.id);
    this.grab.unregister(brick);
    brick.dispose();
  }

  /** Clear the whole build (palm-menu Restart). */
  restart(): void {
    for (const brick of [...this.grab.bricks]) {
      this.grab.unregister(brick);
      brick.dispose();
    }
    this.build.grid.clear();
    this.commands.clear();
    this.hud.log("Restarted — clean baseplate.");
  }

  save(): void {
    const data = serializeBuild(this.grab.bricks, this.build.uniformScale);
    saveToLocal(data);
    this.hud.log(`Saved ${data.bricks.length} bricks.`);
  }

  load(): void {
    const data = loadFromLocal();
    if (!data) {
      this.hud.log("No saved build found.");
      return;
    }
    this.restart();
    for (const sb of data.bricks) {
      if (brickDefById(sb.defId)) this.spawnSnapped(sb.defId, sb.color, sb.placement);
    }
    this.build.uniformScale = data.scale || 1;
    this.hud.log(`Loaded ${data.bricks.length} bricks.`);
  }

  /** Wait for a surface (or fall back), then place the build + bank + ground. */
  private runPlacement(): void {
    let frames = 0;
    const FALLBACK_FRAMES = 72 * 4;
    const obs = this.scene.onBeforeRenderObservable.add(() => {
      if (this.placed) return;
      frames++;
      const surface = this.surfaces?.getBestSurface() ?? null;
      if (!surface && frames < FALLBACK_FRAMES) return;

      this.placed = true;
      this.scene.onBeforeRenderObservable.remove(obs);
      this.finishPlacement(surface ?? this.fallbackSurface());
    });
  }

  private finishPlacement(surface: ChosenSurface): void {
    // Lift the build slightly so tracking jitter can't sink it into the table.
    const lifted: ChosenSurface = {
      ...surface,
      position: surface.position.add(new Vector3(0, SURFACE.PLACEMENT_LIFT, 0)),
    };
    this.build.placeOnSurface(lifted, this.features.anchors);
    // Ground collider sits at the baseplate top so dropped bricks rest on it.
    this.physics.setGround(lifted.position.y + BASEPLATE_TOP_Y);
    this.bank.layout();
    this.surfaces?.setOutlinesVisible(false);
    this.hud.log("Ready — pinch a brick from the bank to start building.");
  }

  private fallbackSurface(): ChosenSurface {
    const cam = this.scene.activeCamera;
    const origin = cam ? cam.globalPosition.clone() : new Vector3(0, 1.2, 0);
    const fwd = cam ? cam.getForwardRay().direction : new Vector3(0, 0, 1);
    const flat = new Vector3(fwd.x, 0, fwd.z).normalize().scaleInPlace(SURFACE.FALLBACK_DISTANCE);
    this.hud.log("No plane detected — using fallback placement.");
    return {
      position: new Vector3(origin.x + flat.x, 0.9, origin.z + flat.z),
      rotation: Quaternion.Identity(),
      isTable: false,
    };
  }
}
