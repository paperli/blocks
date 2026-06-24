import { Scene } from "@babylonjs/core/scene";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import { WebXRState } from "@babylonjs/core/XR/webXRTypes";
import type { DebugHud } from "../world/debugHud";

export interface XrBootResult {
  xr: WebXRDefaultExperience;
}

/**
 * Create the WebXR experience configured for Meta Quest passthrough AR.
 *
 * We disable Babylon's default Enter/Exit UI and teleportation; Blocky drives
 * the session from its own DOM button and uses hand/controller grabbing rather
 * than teleport locomotion. The session is NOT entered here — call enterAR().
 */
export async function createXR(scene: Scene): Promise<WebXRDefaultExperience> {
  const xr = await WebXRDefaultExperience.CreateAsync(scene, {
    disableDefaultUI: true,
    disableTeleportation: true,
    disableNearInteraction: false,
    // local-floor gives us a stable floor-relative origin for surface placement.
    optionalFeatures: false,
  });
  return xr;
}

/**
 * Enter immersive-ar. Sets a fully transparent clear color so the Quest camera
 * passthrough shows through behind our rendered bricks.
 */
export async function enterAR(
  xr: WebXRDefaultExperience,
  scene: Scene,
  hud: DebugHud,
): Promise<void> {
  scene.clearColor = new Color4(0, 0, 0, 0);
  scene.autoClear = true;

  xr.baseExperience.onStateChangedObservable.add((state) => {
    hud.log(`XR state: ${WebXRState[state]}`);
  });

  await xr.baseExperience.enterXRAsync("immersive-ar", "local-floor", xr.renderTarget);
  hud.log("Entered immersive-ar (passthrough).");
}

export async function isArSupported(): Promise<boolean> {
  const xrSystem = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xrSystem) return false;
  try {
    return await xrSystem.isSessionSupported("immersive-ar");
  } catch {
    return false;
  }
}
