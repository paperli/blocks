import { Scene } from "@babylonjs/core/scene";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import {
  WebXRHandTracking,
  WebXRHandJoint,
} from "@babylonjs/core/XR/features/WebXRHandTracking";
import type { WebXRInputSource } from "@babylonjs/core/XR/webXRInputSource";
import { INTERACTION } from "../config";

export type Handedness = "left" | "right";

/** A unified grab source — either a pinching hand or a squeezing controller. */
export interface Grabber {
  handedness: Handedness;
  kind: "hand" | "controller";
  /** World-space grab point (pinch midpoint or controller grip). */
  position: Vector3;
  /** World-space orientation that follows the hand/controller. */
  rotation: Quaternion;
  /** Smoothed linear velocity (m/s) — used for throw + shake. */
  velocity: Vector3;
  pinching: boolean;
}

/** Richer per-hand sample for gesture detection (menu, shake). */
export interface HandSample {
  handedness: Handedness;
  tracked: boolean;
  wrist: Vector3;
  /** Unit vector pointing out of the back of the hand / palm direction. */
  palmNormal: Vector3;
  pinchStrength: number;
  pinching: boolean;
  position: Vector3;
  velocity: Vector3;
}

interface HandState {
  handedness: Handedness;
  present: boolean;
  kind: "hand" | "controller";
  position: Vector3;
  rotation: Quaternion;
  velocity: Vector3;
  lastPos: Vector3;
  pinching: boolean;
  palmNormal: Vector3;
  wrist: Vector3;
  pinchStrength: number;
}

const VEL_SMOOTH = 0.55;

/**
 * Bridges WebXR hand-tracking and Touch controllers into one model. Per frame
 * it resolves each hand's pose + pinch state (preferring tracked hands, falling
 * back to a controller of the same handedness) and fires grab start/end events
 * carrying a velocity snapshot for throwing and shake detection.
 */
export class InputManager {
  readonly onGrabStartObservable = new Observable<Grabber>();
  readonly onGrabEndObservable = new Observable<Grabber>();

  private states: Record<Handedness, HandState> = {
    left: newState("left"),
    right: newState("right"),
  };

  constructor(
    private scene: Scene,
    private xr: WebXRDefaultExperience,
    private hands: WebXRHandTracking | undefined,
  ) {
    scene.onBeforeRenderObservable.add(() => this.update());
  }

  private update(): void {
    const dt = Math.max(this.scene.getEngine().getDeltaTime() / 1000, 1 / 120);
    for (const h of ["left", "right"] as Handedness[]) {
      const prevPinch = this.states[h].pinching;
      const updated = this.sampleHand(h, dt) || this.sampleController(h, dt);
      const st = this.states[h];
      if (!updated) {
        st.present = false;
        st.pinching = false;
        if (prevPinch) this.onGrabEndObservable.notifyObservers(this.toGrabber(st));
        continue;
      }
      if (st.pinching && !prevPinch) this.onGrabStartObservable.notifyObservers(this.toGrabber(st));
      if (!st.pinching && prevPinch) this.onGrabEndObservable.notifyObservers(this.toGrabber(st));
    }
  }

  /** Returns true if a tracked hand provided this frame's sample. */
  private sampleHand(h: Handedness, dt: number): boolean {
    const hand = this.hands?.getHandByHandedness(h);
    if (!hand) return false;
    const thumb = jointPos(hand, WebXRHandJoint.THUMB_TIP);
    const index = jointPos(hand, WebXRHandJoint.INDEX_FINGER_TIP);
    const wrist = jointPos(hand, WebXRHandJoint.WRIST);
    const indexMeta = jointPos(hand, WebXRHandJoint.INDEX_FINGER_METACARPAL);
    const pinkyMeta = jointPos(hand, WebXRHandJoint.PINKY_FINGER_METACARPAL);
    if (!thumb || !index || !wrist || !indexMeta || !pinkyMeta) return false;

    const st = this.states[h];
    const pinchPoint = Vector3.Center(thumb, index);
    const pinchDist = Vector3.Distance(thumb, index);

    // Hysteresis on the pinch so it doesn't chatter near the threshold.
    if (pinchDist < INTERACTION.PINCH_CLOSE) st.pinching = true;
    else if (pinchDist > INTERACTION.PINCH_OPEN) st.pinching = false;
    st.pinchStrength = clamp01(
      (INTERACTION.PINCH_OPEN - pinchDist) / (INTERACTION.PINCH_OPEN - INTERACTION.PINCH_CLOSE),
    );

    // Palm normal from the metacarpal fan (sign flips per handedness).
    const a = indexMeta.subtract(wrist);
    const b = pinkyMeta.subtract(wrist);
    let normal = Vector3.Cross(a, b).normalize();
    if (h === "right") normal.scaleInPlace(-1);

    // Orientation that tracks the hand: face down the wrist->pinch axis.
    const rot = orientationFromForward(pinchPoint.subtract(wrist).normalize(), normal);

    this.applySample(st, "hand", pinchPoint, rot, dt);
    st.wrist = wrist;
    st.palmNormal = normal;
    return true;
  }

  private sampleController(h: Handedness, dt: number): boolean {
    const src = this.findController(h);
    const grip = src?.grip;
    if (!src || !grip) return false;
    const st = this.states[h];

    const mc = src.motionController;
    const squeeze = mc?.getComponentOfType("squeeze") ?? mc?.getMainComponent();
    st.pinching = !!squeeze?.pressed;
    st.pinchStrength = squeeze?.value ?? (st.pinching ? 1 : 0);

    const pos = grip.absolutePosition;
    const rot = grip.rotationQuaternion ?? Quaternion.Identity();
    this.applySample(st, "controller", pos, rot, dt);
    st.wrist = pos;
    // Controller "palm" ~ -up of the grip; good enough to summon the menu.
    st.palmNormal = new Vector3(0, 1, 0);
    return true;
  }

  private applySample(
    st: HandState,
    kind: "hand" | "controller",
    pos: Vector3,
    rot: Quaternion,
    dt: number,
  ): void {
    if (st.present) {
      const v = pos.subtract(st.lastPos).scaleInPlace(1 / dt);
      st.velocity = Vector3.Lerp(st.velocity, v, VEL_SMOOTH);
    } else {
      st.velocity.setAll(0);
    }
    st.present = true;
    st.kind = kind;
    st.position.copyFrom(pos);
    st.rotation.copyFrom(rot);
    st.lastPos.copyFrom(pos);
  }

  private findController(h: Handedness): WebXRInputSource | undefined {
    return this.xr.input.controllers.find(
      (c) => c.inputSource.handedness === h && !c.inputSource.hand,
    );
  }

  private toGrabber(st: HandState): Grabber {
    return {
      handedness: st.handedness,
      kind: st.kind,
      position: st.position.clone(),
      rotation: st.rotation.clone(),
      velocity: st.velocity.clone(),
      pinching: st.pinching,
    };
  }

  getGrabber(h: Handedness): Grabber | null {
    const st = this.states[h];
    return st.present ? this.toGrabber(st) : null;
  }

  getHandSample(h: Handedness): HandSample {
    const st = this.states[h];
    return {
      handedness: h,
      tracked: st.present,
      wrist: st.wrist.clone(),
      palmNormal: st.palmNormal.clone(),
      pinchStrength: st.pinchStrength,
      pinching: st.pinching,
      position: st.position.clone(),
      velocity: st.velocity.clone(),
    };
  }
}

function newState(handedness: Handedness): HandState {
  return {
    handedness,
    present: false,
    kind: "hand",
    position: new Vector3(),
    rotation: Quaternion.Identity(),
    velocity: new Vector3(),
    lastPos: new Vector3(),
    pinching: false,
    palmNormal: new Vector3(0, 1, 0),
    wrist: new Vector3(),
    pinchStrength: 0,
  };
}

function jointPos(hand: ReturnType<WebXRHandTracking["getHandByHandedness"]>, joint: WebXRHandJoint): Vector3 | null {
  if (!hand) return null;
  const mesh = hand.getJointMesh(joint);
  if (!mesh) return null;
  return mesh.getAbsolutePosition().clone();
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Build a quaternion whose local -Z aligns with `forward` and +Y near `up`. */
function orientationFromForward(forward: Vector3, up: Vector3): Quaternion {
  const f = forward.lengthSquared() > 1e-6 ? forward.normalize() : new Vector3(0, 0, 1);
  let u = up.lengthSquared() > 1e-6 ? up.normalize() : new Vector3(0, 1, 0);
  const right = Vector3.Cross(u, f).normalize();
  u = Vector3.Cross(f, right).normalize();
  return Quaternion.RotationQuaternionFromAxis(right, u, f);
}
