// Tiny synthesized sound manager (no audio files, no autoplay before user interaction).
import { store } from "./ui.js";

let ctx = null;
const state = { muted: store.get("muted", false), volume: store.get("volume", 0.5) };

function ac() {
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}
function tone({ f = 440, t = 0.08, type = "sine", g = 0.2, at = 0, slide = 0 }) {
  if (state.muted) return;
  const a = ac(); if (!a) return;
  const o = a.createOscillator(), v = a.createGain(), s = a.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(f, s);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, f + slide), s + t);
  v.gain.setValueAtTime(0.0001, s);
  v.gain.exponentialRampToValueAtTime(g * state.volume, s + 0.01);
  v.gain.exponentialRampToValueAtTime(0.0001, s + t);
  o.connect(v).connect(a.destination); o.start(s); o.stop(s + t + 0.02);
}
function noise(t = 0.05, g = 0.15) {
  if (state.muted) return;
  const a = ac(); if (!a) return;
  const b = a.createBuffer(1, a.sampleRate * t, a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length); // cosmetic noise only
  const s = a.createBufferSource(), v = a.createGain(), f = a.createBiquadFilter();
  f.type = "highpass"; f.frequency.value = 1800; v.gain.value = g * state.volume;
  s.buffer = b; s.connect(f).connect(v).connect(a.destination); s.start();
}

export const sfx = {
  ui: () => tone({ f: 660, t: 0.04, type: "triangle", g: 0.08 }),
  chip: () => { noise(0.04, 0.12); tone({ f: 1800, t: 0.03, type: "square", g: 0.03 }); },
  tick: () => tone({ f: 2400, t: 0.015, type: "square", g: 0.025 }),
  card: () => noise(0.07, 0.1),
  win: () => [523, 659, 784].forEach((f, i) => tone({ f, t: 0.18, type: "triangle", g: 0.14, at: i * 0.08 })),
  bigWin: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone({ f, t: 0.35, type: "triangle", g: 0.16, at: i * 0.1 })),
  loss: () => tone({ f: 220, t: 0.25, type: "sine", g: 0.08, slide: -80 }),
  cash: () => { tone({ f: 988, t: 0.08, type: "square", g: 0.05 }); tone({ f: 1319, t: 0.2, type: "square", g: 0.05, at: 0.08 }); },
  error: () => tone({ f: 180, t: 0.12, type: "sawtooth", g: 0.05 }),
};
export const soundSettings = {
  get: () => ({ ...state }),
  setMuted(m) { state.muted = !!m; store.set("muted", state.muted); },
  setVolume(v) { state.volume = Math.min(1, Math.max(0, v)); store.set("volume", state.volume); },
};
