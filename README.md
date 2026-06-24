# 🧱 Blocky

A LEGO-style block-building game for **Meta Quest 3** that runs in the browser as a
**WebXR** app in **AR / passthrough** mode. Detect a table (or floor), place a 20×20
baseplate, and build by pinching bricks out of an infinite Brick Bank — snap them to the
stud grid, stack, break connections by shaking, scale the whole creation, and save/load
your work from a palm menu.

Built with **Babylon.js** + **Havok physics** + **TypeScript** + **Vite**. Hand tracking is
primary, with Touch controllers as a fallback.

## Run it on your Quest 3

WebXR needs HTTPS. The dev server uses a locally-trusted cert (`vite-plugin-mkcert`).

```bash
npm install
npm run dev          # serves on https://0.0.0.0:8081
```

Then, from the **Meta Quest Browser**, open either:

- **LAN (same Wi-Fi):** `https://<your-computer-ip>:8081`
  (this machine right now: `https://192.168.50.215:8081`)
- **USB via adb:** `adb reverse tcp:8081 tcp:8081` then open `https://localhost:8081`

Accept the self-signed certificate warning, then tap **Enter AR**. If your room hasn't been
scanned, run **Space Setup** in the Quest settings first so plane detection has surfaces.

### Debugging
- `chrome://inspect/#devices` in desktop Chrome → **Inspect** the Quest browser tab for a
  full DevTools console.
- An in-VR debug panel (FPS + rolling log) floats to your right; the same log mirrors to the
  bottom of the flat browser page.
- `window.blocky` exposes the live `Game` instance for console poking.

## Controls

| Action | Hands | Controllers |
| --- | --- | --- |
| Pick a brick from the bank / pick up a loose brick | Pinch near it | Squeeze grip |
| Rotate the held brick | Rotate your hand (snaps to 90° near the grid) | Rotate controller |
| Place / snap | Release near a valid stud position (green ghost) | Release |
| Throw away | Release while moving fast | Release while moving fast |
| Break a brick out of the build | Pinch it + **shake** | Squeeze + shake |
| Move the whole build | One free hand near the build, pinch + drag | Grip + drag |
| Scale the build | Two free hands, pinch + change distance (bounces at limits) | Two grips |
| Palm menu (Undo/Redo/Save/Load/Restart) | Turn your **right palm** toward your face | — |

> The **left**-palm pinch is reserved by the Quest system menu, so Blocky's menu uses the
> right palm.

## Scripts
- `npm run dev` — HTTPS dev server (port 8081)
- `npm run build` — typecheck + production build
- `npm run typecheck` — types only
- `npm run preview` — serve the production build over HTTPS

## Architecture

```
src/
  main.ts            boot: engine/scene, support gate, Enter-AR button
  game.ts            wires every subsystem once the AR session is live
  config.ts          all tunables (stud pitch, thresholds, scale clamps, colors)
  feedback.ts        synthesized click/whoosh audio + controller haptics
  xr/
    session.ts       immersive-ar + transparent clear (passthrough)
    features.ts      plane-detection / hand-tracking / anchors
    input.ts         unifies hand pinch + controller grip into grabbers + hand samples
  world/
    surfaces.ts      plane outlines + best-surface (table/floor) selection
    debugHud.ts      in-VR + DOM debug log and FPS
  build/
    grid.ts          stud↔world math + occupancy grid + placement geometry
    brickDefs.ts     brick set, materials, instanced-stud mesh factory
    brick.ts         brick entity (held / dynamic / snapped lifecycle)
    buildRoot.ts     build transform + 20×20 baseplate + room anchor
    snapping.ts      ghost preview + grid-snap-on-release resolver
  interaction/
    grab.ts          pick up / follow hand / shake-to-break, resolver chain
    throw.ts         release → dynamic drop or throw-to-dismiss
    breakConn.ts     shake gesture detector
    buildManip.ts    one-hand move + two-hand scale with spring bounce
  bank/
    brickBank.ts     fixed infinite dispenser slots
  state/
    commands.ts      undo/redo command stack
    persistence.ts   serialize/restore build to localStorage + file export
  ui/
    palmMenu.ts       right-palm wrist menu
```

### Key design choices
- **Snapping is deterministic grid math, not physics joints.** Only loose (dropped / thrown /
  falling) bricks are simulated by Havok; snapped bricks are static and parented under the
  build root, so builds stay rigid and cheap.
- **Occupancy grid** (`build/grid.ts`) keyed by `(i, j, layer)` validates placements, supports
  stacking, and powers undo/redo + save/load.
- The build is **world-anchored**; manual move/scale temporarily releases anchor control so
  transforms stick.
