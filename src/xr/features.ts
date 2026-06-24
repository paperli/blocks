import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import { WebXRFeatureName } from "@babylonjs/core/XR/webXRFeaturesManager";
import { WebXRPlaneDetector } from "@babylonjs/core/XR/features/WebXRPlaneDetector";
import { WebXRHandTracking } from "@babylonjs/core/XR/features/WebXRHandTracking";
import { WebXRAnchorSystem } from "@babylonjs/core/XR/features/WebXRAnchorSystem";
import type { DebugHud } from "../world/debugHud";

export interface XrFeatures {
  planes?: WebXRPlaneDetector;
  hands?: WebXRHandTracking;
  anchors?: WebXRAnchorSystem;
}

/**
 * Enable the mixed-reality features Blocky relies on. Each is wrapped in a
 * try/catch + capability log so an unsupported feature degrades gracefully
 * rather than aborting the whole session (e.g. plane-detection missing -> we
 * fall back to manual placement later).
 *
 * Call this BEFORE entering the session so the features are added to the
 * session's requested feature set.
 */
export function enableFeatures(xr: WebXRDefaultExperience, hud: DebugHud): XrFeatures {
  const fm = xr.baseExperience.featuresManager;
  const result: XrFeatures = {};

  try {
    result.planes = fm.enableFeature(WebXRFeatureName.PLANE_DETECTION, "latest", {
      // No options needed; Quest returns horizontal/vertical rectangles.
    }) as WebXRPlaneDetector;
    hud.log("✓ plane-detection enabled");
  } catch (e) {
    hud.error("plane-detection unavailable", e);
  }

  try {
    result.anchors = fm.enableFeature(WebXRFeatureName.ANCHOR_SYSTEM, "latest", {
      doNotRemoveAnchorsOnSessionEnded: false,
    }) as WebXRAnchorSystem;
    hud.log("✓ anchors enabled");
  } catch (e) {
    hud.error("anchors unavailable", e);
  }

  try {
    result.hands = fm.enableFeature(WebXRFeatureName.HAND_TRACKING, "latest", {
      xrInput: xr.input,
      jointMeshes: { enablePhysics: false },
    }) as WebXRHandTracking;
    hud.log("✓ hand-tracking enabled");
  } catch (e) {
    hud.error("hand-tracking unavailable", e);
  }

  return result;
}
