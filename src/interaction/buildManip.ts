import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { SCALE } from "../config";
import type { InputManager, Handedness, Grabber } from "../xr/input";
import type { GrabManager } from "./grab";
import type { BuildRoot } from "../build/buildRoot";
import type { DebugHud } from "../world/debugHud";

/** A free pinching hand not currently holding/breaking a brick. */
interface FreeHand {
  h: Handedness;
  grabber: Grabber;
}

type Mode = "none" | "move" | "scale";

/** Proximity (m) to the build origin for a one-hand grab to move the build. */
const MOVE_GRAB_RADIUS = 0.35;

/**
 * Whole-build manipulation:
 *  - One free hand grabbing near the build → drag it around the surface.
 *  - Two free hands → uniform scale (pinch distance) + translate (midpoint).
 * Scale is clamped to [MIN, MAX]; pushing past a limit rubber-bands, and on
 * release the build springs back to the limit with a visible bounce.
 */
export class BuildManipulator {
  private mode: Mode = "none";
  private startCenter = new Vector3();
  private startDist = 1;
  private startScale = 1;
  private startHandPos = new Vector3();
  private startBuildPos = new Vector3();
  private overLimit = false;

  // Release-settle spring (gives the bounce).
  private settling = false;
  private springVel = 0;
  private springTarget = 1;

  constructor(
    private scene: Scene,
    private input: InputManager,
    private grab: GrabManager,
    private build: BuildRoot,
    private hud: DebugHud,
  ) {
    scene.onBeforeRenderObservable.add(() => this.tick());
  }

  private tick(): void {
    const dt = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 1 / 30);
    const free = this.freeHands();

    if (free.length >= 2) {
      this.settling = false;
      this.scaleAndMove(free[0], free[1]);
      return;
    }
    if (free.length === 1 && this.nearBuild(free[0].grabber.position)) {
      this.settling = false;
      this.moveOne(free[0]);
      return;
    }
    if (this.mode !== "none") this.endGesture();
    this.tickSettle(dt);
  }

  private freeHands(): FreeHand[] {
    const out: FreeHand[] = [];
    for (const h of ["left", "right"] as Handedness[]) {
      const g = this.input.getGrabber(h);
      if (g && g.pinching && !this.grab.isBusy(h)) out.push({ h, grabber: g });
    }
    return out;
  }

  private scaleAndMove(a: FreeHand, b: FreeHand): void {
    const center = Vector3.Center(a.grabber.position, b.grabber.position);
    const dist = Vector3.Distance(a.grabber.position, b.grabber.position);

    if (this.mode !== "scale") {
      this.mode = "scale";
      this.startCenter = center.clone();
      this.startDist = Math.max(dist, 1e-3);
      this.startScale = this.build.uniformScale;
      this.startBuildPos = this.build.node.position.clone();
      this.build.releaseAnchorControl();
    }

    const target = this.startScale * (dist / this.startDist);
    this.build.node.position.copyFrom(this.startBuildPos.add(center.subtract(this.startCenter)));
    this.build.uniformScale = this.rubberBand(target);
  }

  private moveOne(hand: FreeHand): void {
    if (this.mode !== "move") {
      this.mode = "move";
      this.startHandPos = hand.grabber.position.clone();
      this.startBuildPos = this.build.node.position.clone();
      this.build.releaseAnchorControl();
    }
    const delta = hand.grabber.position.subtract(this.startHandPos);
    this.build.node.position.copyFrom(this.startBuildPos.add(delta));
  }

  /** Soft over-limit response; records whether we ended past a clamp. */
  private rubberBand(target: number): number {
    const o = SCALE.BOUNCE_OVERSHOOT;
    if (target > SCALE.MAX) {
      this.overLimit = true;
      this.springTarget = SCALE.MAX;
      return SCALE.MAX + SCALE.MAX * o * (1 - SCALE.MAX / target);
    }
    if (target < SCALE.MIN) {
      this.overLimit = true;
      this.springTarget = SCALE.MIN;
      return SCALE.MIN - SCALE.MIN * o * (1 - target / SCALE.MIN);
    }
    this.overLimit = false;
    this.springTarget = target;
    return target;
  }

  private endGesture(): void {
    if (this.mode === "scale" && this.overLimit) {
      this.settling = true;
      this.springVel = 0;
      this.hud.log(`Scale limit reached — bounce (target ${this.springTarget.toFixed(1)}x).`);
    }
    this.mode = "none";
    this.overLimit = false;
  }

  /** Critically-underdamped spring back to the clamped scale → a bounce. */
  private tickSettle(dt: number): void {
    if (!this.settling) return;
    const cur = this.build.uniformScale;
    const k = 140;
    const damp = 13;
    this.springVel += (this.springTarget - cur) * k * dt;
    this.springVel -= this.springVel * damp * dt;
    const next = cur + this.springVel * dt;
    this.build.uniformScale = next;
    if (Math.abs(next - this.springTarget) < 0.002 && Math.abs(this.springVel) < 0.01) {
      this.build.uniformScale = this.springTarget;
      this.settling = false;
    }
  }

  private nearBuild(pos: Vector3): boolean {
    return Vector3.Distance(pos, this.build.node.getAbsolutePosition()) < MOVE_GRAB_RADIUS * this.build.uniformScale;
  }
}
