import { Scene } from "@babylonjs/core/scene";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { BRICK_DEFS, BrickDef, createBrickMesh } from "../build/brickDefs";
import { GRID } from "../build/grid";
import { UNITS } from "../config";
import { Brick } from "../build/brick";
import type { BuildRoot } from "../build/buildRoot";
import type { PhysicsWorld } from "../physics/havok";
import type { DebugHud } from "../world/debugHud";

interface BankSlot {
  def: BrickDef;
  colorName: string;
  display: Mesh;
}

/** Slot recipe: a few basic bricks/colors, infinite supply each. */
const SLOT_RECIPES: { defId: string; colorName: string }[] = [
  { defId: "2x4", colorName: "red" },
  { defId: "2x2", colorName: "yellow" },
  { defId: "1x4", colorName: "blue" },
  { defId: "1x2", colorName: "green" },
  { defId: "1x1", colorName: "white" },
];

/**
 * The Brick Bank: a fixed row of dispenser slots laid out along the near edge
 * of the baseplate. Each slot shows a slowly-spinning sample brick and dispenses
 * an unlimited supply — pinch near a slot to spawn a fresh brick into the hand.
 * Slots are parented to the build root so they travel with the creation.
 */
export class BrickBank {
  private slots: BankSlot[] = [];
  /** Proximity (m) within which a pinch grabs from a slot. */
  readonly pickRadius = 0.05;

  constructor(
    private scene: Scene,
    private physics: PhysicsWorld,
    private build: BuildRoot,
    private hud: DebugHud,
  ) {}

  layout(): void {
    this.dispose();
    const depth = GRID.STUDS_Z * UNITS.STUD_PITCH;
    const nearZ = -(depth / 2) - UNITS.STUD_PITCH * 3; // just outside the near edge
    const spacing = UNITS.STUD_PITCH * 6;
    const startX = -((SLOT_RECIPES.length - 1) * spacing) / 2;
    const y = UNITS.STUD_PITCH * 2.5; // float a touch above the surface

    SLOT_RECIPES.forEach((recipe, idx) => {
      const def = BRICK_DEFS.find((d) => d.id === recipe.defId)!;
      const display = createBrickMesh(this.scene, def, recipe.colorName);
      display.name = `bankSlot_${recipe.defId}`;
      display.isPickable = false;
      display.parent = this.build.node;
      display.position.set(startX + idx * spacing, y, nearZ);
      display.rotationQuaternion = Quaternion.Identity();
      this.slots.push({ def, colorName: recipe.colorName, display });
    });

    // Gentle idle spin so the bank reads as interactive.
    this.scene.onBeforeRenderObservable.add(() => {
      const t = performance.now() / 1000;
      for (const s of this.slots) {
        s.display.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), t * 0.6);
      }
    });

    this.hud.log(`Brick Bank ready: ${this.slots.length} slots.`);
  }

  /** Slot whose display is within pickRadius of the world point, if any. */
  slotAt(worldPos: Vector3): BankSlot | null {
    let best: BankSlot | null = null;
    let bestD = this.pickRadius;
    for (const s of this.slots) {
      const d = Vector3.Distance(s.display.getAbsolutePosition(), worldPos);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** Spawn a fresh brick from a slot, matching the slot's current spin angle. */
  spawn(slot: BankSlot): Brick {
    const brick = new Brick(this.scene, this.physics, slot.def, slot.colorName);
    brick.setWorldPose(
      slot.display.getAbsolutePosition(),
      slot.display.absoluteRotationQuaternion,
    );
    return brick;
  }

  dispose(): void {
    for (const s of this.slots) s.display.dispose(false, true);
    this.slots = [];
  }
}
