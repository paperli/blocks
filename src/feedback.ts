import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import type { Handedness } from "./xr/input";

/**
 * Lightweight audio + haptic feedback with zero asset loading: clicks and
 * whooshes are synthesized via Web Audio, and haptics use the WebXR gamepad
 * actuators on whichever controller matches the handedness (hands have none).
 */
export class Feedback {
  private ctx?: AudioContext;

  constructor(private xr: WebXRDefaultExperience) {}

  private audio(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Satisfying snap "tick". */
  click(): void {
    const ctx = this.audio();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.06);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** Airy noise burst for a thrown-away brick. */
  whoosh(): void {
    const ctx = this.audio();
    const dur = 0.25;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1100;
    const gain = ctx.createGain();
    gain.gain.value = 0.12;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  /** Pulse the controller (if any) for the given hand. */
  pulse(h?: Handedness, intensity = 0.4, ms = 50): void {
    for (const c of this.xr.input.controllers) {
      if (h && c.inputSource.handedness !== h) continue;
      const actuator = c.inputSource.gamepad?.hapticActuators?.[0] as
        | (GamepadHapticActuator & { pulse?: (v: number, d: number) => void })
        | undefined;
      actuator?.pulse?.(intensity, ms);
    }
  }
}
