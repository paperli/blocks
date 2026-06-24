import { Scene } from "@babylonjs/core/scene";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import { Brick } from "../build/brick";
import type { Grabber, Handedness, InputManager } from "../xr/input";
import type { BrickBank } from "../bank/brickBank";
import type { BuildRoot } from "../build/buildRoot";
import type { DebugHud } from "../world/debugHud";
import { ShakeTracker } from "./breakConn";

export interface ReleaseContext {
  brick: Brick;
  grabber: Grabber;
}

/** Tried in order on release; first to return true consumes the event. */
export type ReleaseResolver = (ctx: ReleaseContext) => boolean;

interface HeldInfo {
  brick: Brick;
  offsetPos: Vector3;
  offsetRot: Quaternion;
}

interface BreakInfo {
  brick: Brick;
  tracker: ShakeTracker;
}

/** Radius (m) within which a pinch can grab an existing loose/snapped brick. */
const GRAB_RADIUS = 0.05;

/**
 * Routes pinch/grip start+end into: picking from the bank, picking up loose
 * bricks, and shake-to-break of snapped bricks. Held bricks follow the hand
 * with full rotation; releases pass through the resolver chain (snap → throw).
 */
export class GrabManager {
  /** All live bricks (loose, held, and snapped). */
  readonly bricks = new Set<Brick>();
  readonly onPickObservable = new Observable<Brick>();
  readonly onBreakObservable = new Observable<Brick>();

  private held: Partial<Record<Handedness, HeldInfo>> = {};
  private pendingBreak: Partial<Record<Handedness, BreakInfo>> = {};
  private resolvers: ReleaseResolver[] = [];

  constructor(
    scene: Scene,
    private input: InputManager,
    private bank: BrickBank,
    private build: BuildRoot,
    private hud: DebugHud,
  ) {
    input.onGrabStartObservable.add((g) => this.onGrabStart(g));
    input.onGrabEndObservable.add((g) => this.onGrabEnd(g));
    scene.onBeforeRenderObservable.add(() => this.tick());
  }

  /** Resolvers run in registration order; register snapping before throwing. */
  addResolver(r: ReleaseResolver): void {
    this.resolvers.push(r);
  }

  register(brick: Brick): void {
    this.bricks.add(brick);
  }

  unregister(brick: Brick): void {
    this.bricks.delete(brick);
  }

  isHolding(h: Handedness): boolean {
    return !!this.held[h];
  }

  heldBrick(h: Handedness): Brick | undefined {
    return this.held[h]?.brick;
  }

  /** True if this hand is occupied (holding or mid-break) — used by build move. */
  isBusy(h: Handedness): boolean {
    return !!this.held[h] || !!this.pendingBreak[h];
  }

  private onGrabStart(grabber: Grabber): void {
    const h = grabber.handedness;
    if (this.held[h] || this.pendingBreak[h]) return;

    // 1) Bank slot? Spawn a fresh brick into the hand.
    const slot = this.bank.slotAt(grabber.position);
    if (slot) {
      const brick = this.bank.spawn(slot);
      this.register(brick);
      this.hud.log(`Picked ${brick.def.id}/${brick.colorName} from bank.`);
      this.attachHeld(grabber, brick);
      return;
    }

    // 2) Nearest loose brick in range.
    const loose = this.nearest(grabber.position, (b) => b.state === "dynamic");
    if (loose) {
      this.attachHeld(grabber, loose);
      return;
    }

    // 3) Nearest snapped brick → arm shake-to-break.
    const snapped = this.nearest(grabber.position, (b) => b.state === "snapped");
    if (snapped) {
      this.pendingBreak[h] = { brick: snapped, tracker: new ShakeTracker() };
    }
  }

  private attachHeld(grabber: Grabber, brick: Brick): void {
    brick.hold();
    this.onPickObservable.notifyObservers(brick);
    const gRot = grabber.rotation;
    const invG = Quaternion.Inverse(gRot);
    const bPos = brick.mesh.getAbsolutePosition();
    const bRot = brick.mesh.rotationQuaternion ?? Quaternion.Identity();
    const offsetRot = invG.multiply(bRot);
    const offsetPos = bPos.subtract(grabber.position).applyRotationQuaternion(invG);
    this.held[grabber.handedness] = { brick, offsetPos, offsetRot };
  }

  private onGrabEnd(grabber: Grabber): void {
    const h = grabber.handedness;
    // Abandoned break attempt (released before shaking enough).
    if (this.pendingBreak[h]) delete this.pendingBreak[h];

    const info = this.held[h];
    if (!info) return;
    delete this.held[h];

    const ctx: ReleaseContext = { brick: info.brick, grabber };
    for (const r of this.resolvers) {
      if (r(ctx)) return;
    }
    info.brick.dropDynamic(grabber.velocity);
  }

  private tick(): void {
    const now = performance.now();
    for (const h of ["left", "right"] as Handedness[]) {
      this.tickBreak(h, now);
      this.tickHeld(h);
    }
  }

  /** Detect a shake on a pending-break hand and detach the brick if so. */
  private tickBreak(h: Handedness, now: number): void {
    const pb = this.pendingBreak[h];
    if (!pb) return;
    const sample = this.input.getHandSample(h);
    if (!sample.tracked || !sample.pinching) {
      delete this.pendingBreak[h];
      return;
    }
    if (pb.tracker.update(sample.velocity, now)) {
      // Break it out of the build and hand it to the same hand as held.
      this.build.grid.remove(pb.brick.id);
      pb.brick.placement = undefined;
      delete this.pendingBreak[h];
      const grabber = this.input.getGrabber(h);
      if (grabber) {
        this.attachHeld(grabber, pb.brick);
        this.onBreakObservable.notifyObservers(pb.brick);
        this.hud.log(`Broke ${pb.brick.def.id} off the build.`);
      }
    }
  }

  private tickHeld(h: Handedness): void {
    const info = this.held[h];
    if (!info) return;
    const grabber = this.input.getGrabber(h);
    if (!grabber) {
      info.brick.dropDynamic(Vector3.Zero());
      delete this.held[h];
      return;
    }
    const worldRot = grabber.rotation.multiply(info.offsetRot);
    const worldPos = grabber.position.add(info.offsetPos.applyRotationQuaternion(grabber.rotation));
    info.brick.mesh.position.copyFrom(worldPos);
    info.brick.mesh.rotationQuaternion = worldRot;
  }

  private nearest(worldPos: Vector3, pred: (b: Brick) => boolean): Brick | undefined {
    let best: Brick | undefined;
    let bestD = GRAB_RADIUS;
    for (const b of this.bricks) {
      if (!pred(b)) continue;
      const d = Vector3.Distance(b.mesh.getAbsolutePosition(), worldPos);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }
}
