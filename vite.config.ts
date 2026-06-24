import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";

// WebXR requires a secure context (HTTPS). vite-plugin-mkcert generates a
// locally-trusted certificate so the Quest browser can enter immersive sessions.
//
// Reach the dev server from the headset either by:
//   - LAN IP:   https://<your-computer-ip>:8081   (same Wi-Fi)
//   - adb:      adb reverse tcp:8081 tcp:8081  ->  https://localhost:8081
export default defineConfig({
  plugins: [mkcert()],
  server: {
    host: true, // listen on 0.0.0.0 so the headset can reach it over LAN
    port: 8081,
    strictPort: true,
  },
  // Havok ships a large .wasm; don't inline it.
  build: {
    target: "es2020",
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    // The Havok wasm glue must not be pre-bundled or the wasm path breaks.
    exclude: ["@babylonjs/havok"],
  },
});
