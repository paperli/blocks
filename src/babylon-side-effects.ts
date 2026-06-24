/**
 * Babylon's ES6 build is tree-shaken: many capabilities are installed by
 * importing a module purely for its side effects. If you only reference a
 * feature class as a *type* (e.g. `x as WebXRPlaneDetector`), TypeScript elides
 * the import and its self-registration never runs — so the feature reports
 * "feature not found" at runtime. Likewise `Mesh.thinInstanceAdd` only exists
 * once `thinInstanceMesh` is imported.
 *
 * Import this module FIRST (before any Babylon usage) to guarantee everything
 * Blocky relies on is registered. These are bare imports on purpose.
 */

// Thin-instance API (Mesh.thinInstanceAdd, used for studs).
import "@babylonjs/core/Meshes/thinInstanceMesh";

// WebXR mixed-reality features — bare imports register them with the
// WebXRFeaturesManager regardless of how their classes are referenced.
import "@babylonjs/core/XR/features/WebXRPlaneDetector";
import "@babylonjs/core/XR/features/WebXRAnchorSystem";
import "@babylonjs/core/XR/features/WebXRHandTracking";
import "@babylonjs/core/XR/features/WebXRControllerPointerSelection";
import "@babylonjs/core/XR/features/WebXRNearInteraction";

// Havok physics plugin glue.
import "@babylonjs/core/Physics/v2/physicsEngineComponent";
