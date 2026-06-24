import { Brick } from "../build/brick";
import { INTERACTION } from "../config";
import type { ReleaseResolver } from "./grab";
import type { DebugHud } from "../world/debugHud";

/**
 * Terminal release resolver: if the hand was moving fast at release, fling the
 * brick away and despawn it ("throw to dismiss"); otherwise drop it as a normal
 * dynamic body that falls to the surface and can be re-picked.
 */
export function makeThrowResolver(opts: {
  unregister: (b: Brick) => void;
  hud: DebugHud;
  onDismiss?: () => void;
}): ReleaseResolver {
  return ({ brick, grabber }) => {
    const speed = grabber.velocity.length();
    if (speed > INTERACTION.THROW_DISMISS_SPEED) {
      brick.dropDynamic(grabber.velocity.scale(1.3));
      opts.onDismiss?.();
      opts.hud.log(`Threw away ${brick.def.id} (${speed.toFixed(1)} m/s)`);
      // Let it fly, then clean it up.
      window.setTimeout(() => {
        opts.unregister(brick);
        brick.dispose();
      }, 2500);
    } else {
      brick.dropDynamic(grabber.velocity);
    }
    return true;
  };
}
