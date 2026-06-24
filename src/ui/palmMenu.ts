import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { StackPanel } from "@babylonjs/gui/2D/controls/stackPanel";
import { Button } from "@babylonjs/gui/2D/controls/button";
import type { InputManager } from "../xr/input";

export interface PalmMenuActions {
  undo: () => void;
  redo: () => void;
  restart: () => void;
  save: () => void;
  load: () => void;
}

/**
 * A wrist/palm menu. Summoned by turning the RIGHT palm toward your face (the
 * left-palm pinch is reserved by the Quest system menu, so we deliberately use
 * the right hand). Renders a billboarded button panel anchored to the wrist;
 * press buttons with the other hand's finger via near interaction.
 */
export class PalmMenu {
  private root: Mesh;
  private visible = false;

  constructor(
    private scene: Scene,
    private input: InputManager,
    actions: PalmMenuActions,
  ) {
    this.root = MeshBuilder.CreatePlane("palmMenu", { width: 0.14, height: 0.2 }, scene);
    this.root.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.root.renderingGroupId = 2;

    const adt = AdvancedDynamicTexture.CreateForMesh(this.root, 512, 720, false);
    const panel = new StackPanel();
    panel.width = "92%";
    panel.paddingTop = "16px";
    adt.addControl(panel);

    const mk = (label: string, color: string, onClick: () => void) => {
      const btn = Button.CreateSimpleButton(`pm_${label}`, label);
      btn.height = "120px";
      btn.paddingBottom = "14px";
      btn.thickness = 0;
      btn.cornerRadius = 18;
      btn.color = "white";
      btn.fontSize = 44;
      btn.background = color;
      if (btn.textBlock) btn.textBlock.color = "white";
      btn.onPointerUpObservable.add(onClick);
      panel.addControl(btn);
      return btn;
    };

    mk("↶ Undo", "#2f6fb0", actions.undo);
    mk("↷ Redo", "#2f6fb0", actions.redo);
    mk("Save", "#2f9e44", actions.save);
    mk("Load", "#2f9e44", actions.load);
    mk("Restart", "#c0392b", actions.restart);

    this.root.setEnabled(false);
    scene.onBeforeRenderObservable.add(() => this.update());
  }

  private update(): void {
    const sample = this.input.getHandSample("right");
    const cam = this.scene.activeCamera;
    if (!sample.tracked || !cam) {
      this.setVisible(false);
      return;
    }
    const toHead = cam.globalPosition.subtract(sample.wrist);
    const facing = Vector3.Dot(sample.palmNormal.normalizeToNew(), toHead.normalizeToNew());

    // Show when the right palm is turned toward the face.
    this.setVisible(facing > 0.5);
    if (this.visible) {
      // Float just above the wrist, offset out of the palm so it doesn't clip.
      const pos = sample.wrist
        .add(sample.palmNormal.scale(0.04))
        .add(new Vector3(0, 0.04, 0));
      this.root.position.copyFrom(pos);
    }
  }

  private setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.root.setEnabled(v);
  }
}
