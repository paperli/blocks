import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { INTERACTION } from "../config";

/**
 * Detects a "shake" gesture: rapid back-and-forth hand motion. Used to break a
 * snapped brick out of a combined shape. We count velocity-direction reversals
 * (above a speed threshold) within a sliding time window; enough reversals =
 * shake. Time is supplied by the caller (performance.now) to stay testable.
 */
export class ShakeTracker {
  private last?: Vector3;
  private reversals: number[] = [];

  reset(): void {
    this.last = undefined;
    this.reversals = [];
  }

  /** Feed the current hand velocity; returns true once a shake is recognized. */
  update(velocity: Vector3, nowMs: number): boolean {
    const speed = velocity.length();
    if (this.last && speed > INTERACTION.SHAKE_SPEED && this.last.length() > INTERACTION.SHAKE_SPEED) {
      if (Vector3.Dot(this.last, velocity) < 0) this.reversals.push(nowMs);
    }
    this.last = velocity.clone();
    this.reversals = this.reversals.filter((t) => nowMs - t < INTERACTION.SHAKE_WINDOW_MS);
    return this.reversals.length >= INTERACTION.SHAKE_REVERSALS;
  }
}
