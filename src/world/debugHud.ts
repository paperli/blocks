import { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";

/**
 * Dual debug surface: mirrors a rolling log to both the DOM (#debugLog, visible
 * in the flat browser / chrome://inspect) and an in-VR billboarded panel that
 * floats in front of the user so you can read state without taking the headset
 * off. Also shows live FPS.
 */
export class DebugHud {
  private lines: string[] = [];
  private readonly maxLines = 14;
  private domEl: HTMLElement | null;
  private guiText?: TextBlock;
  private fpsText?: TextBlock;
  private panel?: Mesh;

  constructor(private scene: Scene) {
    this.domEl = document.getElementById("debugLog");
    this.buildVrPanel();
    scene.onBeforeRenderObservable.add(() => this.tickFps());
  }

  private buildVrPanel(): void {
    // A small plane that lives ~0.6m in front of the camera, billboarded.
    const panel = MeshBuilder.CreatePlane("debugPanel", { width: 0.4, height: 0.28 }, this.scene);
    panel.position = new Vector3(0.35, 1.3, 0.7);
    panel.billboardMode = Mesh.BILLBOARDMODE_ALL;
    panel.isPickable = false;
    panel.renderingGroupId = 2;
    const adt = AdvancedDynamicTexture.CreateForMesh(panel, 1024, 720, false);

    const bg = new Rectangle();
    bg.background = "rgba(0,0,0,0.55)";
    bg.thickness = 0;
    bg.cornerRadius = 18;
    adt.addControl(bg);

    const fps = new TextBlock("fps", "");
    fps.color = "#7ee0ff";
    fps.fontSize = 34;
    fps.fontFamily = "monospace";
    fps.height = "56px";
    fps.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_LEFT;
    fps.paddingLeft = "20px";
    fps.top = "-330px";
    bg.addControl(fps);

    const text = new TextBlock("log", "");
    text.color = "#9ef0c5";
    text.fontSize = 24;
    text.fontFamily = "monospace";
    text.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_LEFT;
    text.textVerticalAlignment = TextBlock.VERTICAL_ALIGNMENT_TOP;
    text.paddingLeft = "20px";
    text.paddingTop = "60px";
    text.textWrapping = true;
    bg.addControl(text);

    this.panel = panel;
    this.guiText = text;
    this.fpsText = fps;
  }

  private tickFps(): void {
    if (this.fpsText) {
      const fps = (this.scene.getEngine() as Engine).getFps();
      this.fpsText.text = `Blocky · ${fps.toFixed(0)} fps`;
    }
  }

  /** Show or hide the in-VR panel (e.g. toggled from the palm menu). */
  setVisible(v: boolean): void {
    if (this.panel) this.panel.setEnabled(v);
  }

  log(msg: string): void {
    // eslint-disable-next-line no-console
    console.log("[blocky]", msg);
    this.lines.push(msg);
    if (this.lines.length > this.maxLines) this.lines.shift();
    const joined = this.lines.join("\n");
    if (this.domEl) this.domEl.textContent = joined;
    if (this.guiText) this.guiText.text = joined;
  }

  error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? `${msg}: ${err.message}` : msg;
    // eslint-disable-next-line no-console
    console.error("[blocky]", detail, err);
    this.log(`⚠ ${detail}`);
  }
}
