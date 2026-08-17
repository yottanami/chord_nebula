import { describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

// Two browser realities the app has to survive: Safari below 14.1 only has
// the prefixed AudioContext constructor, and Chrome hands back a suspended
// context when it wasn't created during a user gesture (playing a MIDI note
// is not one), which stays silent until something resumes it.

class FakeParam {
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  linearRampToValueAtTime() {}
}
class FakeNode {
  frequency = new FakeParam();
  gain = new FakeParam();
  connect() {
    return this;
  }
  start() {}
  stop() {}
}
class FakeAudioContext {
  static created = 0;
  currentTime = 0;
  destination = {};
  state = "running";
  resumeCalls = 0;
  constructor() {
    FakeAudioContext.created++;
  }
  resume() {
    this.resumeCalls++;
    this.state = "running";
  }
  createOscillator() {
    return new FakeNode();
  }
  createGain() {
    return new FakeNode();
  }
}

interface App {
  ensureAudioContext(): void;
  audioContextConstructor(): unknown;
  playChordSound(chord: string[]): void;
  startEngineDrone(): void;
  audioContext: FakeAudioContext | null;
  engineTimer: number | null;
  AudioContext?: unknown;
  window?: { webkitAudioContext?: unknown };
  setTimeout: (fn: () => void, ms: number) => number;
}

function loadApp(): App {
  const app = loadAppPureLogic() as unknown as App;
  app.setTimeout = (() => 0) as unknown as App["setTimeout"];
  return app;
}

describe("audioContextConstructor", () => {
  it("prefers the standard constructor", () => {
    const app = loadApp();
    app.AudioContext = FakeAudioContext;
    expect(app.audioContextConstructor()).toBe(FakeAudioContext);
  });

  it("falls back to Safari's prefixed constructor", () => {
    const app = loadApp();
    app.window = { webkitAudioContext: FakeAudioContext };
    expect(app.audioContextConstructor()).toBe(FakeAudioContext);
  });

  it("returns null when the browser has no Web Audio at all", () => {
    const app = loadApp();
    app.window = {};
    expect(app.audioContextConstructor()).toBeNull();
  });
});

describe("ensureAudioContext", () => {
  it("creates the context once and reuses it", () => {
    const app = loadApp();
    app.AudioContext = FakeAudioContext;
    FakeAudioContext.created = 0;

    app.ensureAudioContext();
    app.ensureAudioContext();

    expect(FakeAudioContext.created).toBe(1);
  });

  it("resumes a context the autoplay policy left suspended", () => {
    const app = loadApp();
    app.AudioContext = FakeAudioContext;

    app.ensureAudioContext();
    const ctx = app.audioContext!;
    ctx.state = "suspended";
    app.ensureAudioContext();

    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.state).toBe("running");
  });

  it("leaves a running context alone", () => {
    const app = loadApp();
    app.AudioContext = FakeAudioContext;

    app.ensureAudioContext();
    app.ensureAudioContext();

    expect(app.audioContext!.resumeCalls).toBe(0);
  });
});

describe("with no Web Audio available", () => {
  it("plays nothing instead of throwing", () => {
    const app = loadApp();
    app.window = {};

    expect(() => app.ensureAudioContext()).not.toThrow();
    expect(() => app.playChordSound(["C", "E", "G"])).not.toThrow();
    expect(app.audioContext).toBeNull();
  });

  it("does not start the engine pulse", () => {
    const app = loadApp();
    app.window = {};

    app.startEngineDrone();

    expect(app.engineTimer).toBeNull();
  });
});
