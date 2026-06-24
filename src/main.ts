// Must be first: registers Babylon side-effect APIs (thin instances, WebXR
// features, physics) before anything below uses them.
import "./babylon-side-effects";

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";

import { DebugHud } from "./world/debugHud";
import { createXR, enterAR, isArSupported } from "./xr/session";
import { enableFeatures } from "./xr/features";
import { SurfaceManager } from "./world/surfaces";
import { Game } from "./game";

async function boot(): Promise<void> {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
  const statusEl = document.getElementById("status") as HTMLElement;
  const enterBtn = document.getElementById("enterButton") as HTMLButtonElement;
  const overlay = document.getElementById("overlay") as HTMLElement;

  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    xrCompatible: true,
  });
  const scene = new Scene(engine);

  // A flat-mode camera so the 2D browser preview isn't black before entering AR.
  const camera = new FreeCamera("flatCam", new Vector3(0, 1.4, -0.6), scene);
  camera.setTarget(new Vector3(0, 1.0, 0.5));
  camera.attachControl(canvas, true);

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.9;
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.3), scene);
  sun.intensity = 0.6;

  const hud = new DebugHud(scene);
  hud.log("Booting Blocky…");

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());

  const supported = await isArSupported();
  if (!supported) {
    statusEl.textContent =
      "immersive-ar not available. Open this page in the Meta Quest Browser.";
    hud.log("immersive-ar NOT supported in this browser.");
    return;
  }
  statusEl.textContent = "Ready. Put on your headset and tap Enter AR.";
  enterBtn.disabled = false;

  const xr = await createXR(scene);
  const features = enableFeatures(xr, hud);
  const surfaces = features.planes ? new SurfaceManager(scene, features.planes, hud) : undefined;

  enterBtn.addEventListener("click", async () => {
    enterBtn.disabled = true;
    try {
      await enterAR(xr, scene, hud);
      overlay.style.display = "none";
      const game = new Game(scene, hud, xr, features, surfaces);
      await game.start();
    } catch (e) {
      hud.error("Failed to enter AR", e);
      overlay.style.display = "";
      enterBtn.disabled = false;
    }
  });
}

boot().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Fatal boot error", e);
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = `Boot error: ${(e as Error).message}`;
});
