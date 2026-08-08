import { describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

// The engine pulse ("ba ba ba") runs underneath playChordSound for most of
// a game, so the thing actually worth protecting is that it stays out of
// the chords' way: below them in pitch, well below them in level, and
// harmonically keyed to the tonic. Those are numeric properties, so they
// can be asserted directly off the scheduled Web Audio calls rather than
// by ear -- a recording fake stands in for AudioContext, in the same
// spirit as feedback.test.ts's fake DOM.

interface Scheduled {
  value: number;
  time: number;
}

class RecordingParam {
  setValues: Scheduled[] = [];
  linearValues: Scheduled[] = [];
  expValues: Scheduled[] = [];
  setValueAtTime(value: number, time: number) {
    this.setValues.push({ value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.linearValues.push({ value, time });
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.expValues.push({ value, time });
  }
}

// Real connect() returns the node it was given, which is what makes
// `osc.connect(gain).connect(dest)` chain -- the fakes must do the same.
class RecordingOscillator {
  type = "";
  frequency = new RecordingParam();
  startTime: number | null = null;
  stopTime: number | null = null;
  connect<T>(target: T): T {
    return target;
  }
  start(time: number) {
    this.startTime = time;
  }
  stop(time: number) {
    this.stopTime = time;
  }
}

class RecordingGain {
  gain = new RecordingParam();
  connect<T>(target: T): T {
    return target;
  }
}

class RecordingFilter {
  type = "";
  frequency = new RecordingParam();
  connect<T>(target: T): T {
    return target;
  }
}

class RecordingAudioContext {
  currentTime = 0;
  destination = {};
  oscillators: RecordingOscillator[] = [];
  gains: RecordingGain[] = [];
  filters: RecordingFilter[] = [];
  createOscillator() {
    const osc = new RecordingOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain() {
    const gain = new RecordingGain();
    this.gains.push(gain);
    return gain;
  }
  createBiquadFilter() {
    const filter = new RecordingFilter();
    this.filters.push(filter);
    return filter;
  }
}

interface App {
  startEngineDrone(): void;
  stopEngineDrone(): void;
  syncEngineDrone(): void;
  engineRootMidi(): number;
  noteNameToFreq(name: string): number;
  audioContext: RecordingAudioContext;
  engineTimer: number | null;
  chosenKey: string;
  gameRunning: boolean;
  circles: Array<{ destroyed: boolean }>;
  AudioContext: unknown;
  document: { hidden: boolean };
  setInterval: unknown;
  clearInterval: unknown;
}

function loadApp() {
  const app = loadAppPureLogic() as unknown as App;
  app.AudioContext = RecordingAudioContext;
  app.document = { hidden: false };

  // The scheduler's interval is driven by hand so tests can advance the
  // audio clock deterministically instead of waiting on real timers.
  const callbacks = new Map<number, () => void>();
  let nextId = 1;
  app.setInterval = (fn: () => void) => {
    const id = nextId++;
    callbacks.set(id, fn);
    return id;
  };
  app.clearInterval = (id: number) => {
    callbacks.delete(id);
  };
  const tick = () => callbacks.forEach((fn) => fn());

  return { app, tick };
}

/** Lowest note playChordSound can produce: noteNameToFreq maps to C4-B4. */
function lowestChordFreq(app: App): number {
  return app.noteNameToFreq("C");
}

describe("engine pulse", () => {
  it("is a square wave, for the 8-bit character", () => {
    const { app } = loadApp();
    app.startEngineDrone();

    expect(app.audioContext.oscillators.length).toBeGreaterThan(0);
    for (const osc of app.audioContext.oscillators) {
      expect(osc.type).toBe("square");
    }
  });

  it("stays below the register playChordSound occupies", () => {
    const { app, tick } = loadApp();
    app.chosenKey = "C";
    app.startEngineDrone();
    for (let t = 0; t <= 3; t += 0.1) {
      app.audioContext.currentTime = t;
      tick();
    }

    const floor = lowestChordFreq(app);
    const pitches = app.audioContext.oscillators.map((o) => o.frequency.setValues[0].value);
    expect(pitches.length).toBeGreaterThan(4);
    for (const hz of pitches) {
      expect(hz).toBeLessThan(floor);
    }
  });

  it("peaks far below the chords' level", () => {
    const { app } = loadApp();
    app.startEngineDrone();

    // Pulse envelopes ramp up via linearRampToValueAtTime; the bus gain
    // uses setValueAtTime and so is excluded here by construction.
    const peaks = app.audioContext.gains.flatMap((g) => g.gain.linearValues.map((v) => v.value));
    expect(peaks.length).toBeGreaterThan(0);
    for (const peak of peaks) {
      expect(peak).toBeLessThanOrEqual(0.06);
    }
    // playChordSound holds its triangles at 0.3.
    expect(Math.max(...peaks)).toBeLessThan(0.3 / 4);
  });

  it("is keyed to the current tonic, so it works as a pedal tone", () => {
    const { app } = loadApp();
    app.chosenKey = "C";
    expect(app.engineRootMidi()).toBe(36);
    app.chosenKey = "G";
    expect(app.engineRootMidi()).toBe(43);
    // Enharmonic spellings must resolve, not fall back to C.
    app.chosenKey = "Bb";
    expect(app.engineRootMidi()).toBe(46);
  });

  it("keeps a steady beat", () => {
    const { app, tick } = loadApp();
    app.startEngineDrone();
    for (let t = 0; t <= 2; t += 0.1) {
      app.audioContext.currentTime = t;
      tick();
    }

    const starts = app.audioContext.oscillators
      .map((o) => o.startTime)
      .filter((t): t is number => t !== null);
    expect(starts.length).toBeGreaterThan(3);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeCloseTo(0.42, 5);
    }
  });

  it("runs while a circle is falling and stops once the screen is clear", () => {
    const { app } = loadApp();
    app.gameRunning = true;

    app.circles = [{ destroyed: false }];
    app.syncEngineDrone();
    expect(app.engineTimer).not.toBeNull();

    // A circle already matched is on its way out, not still falling.
    app.circles = [{ destroyed: true }];
    app.syncEngineDrone();
    expect(app.engineTimer).toBeNull();

    app.circles = [{ destroyed: false }];
    app.syncEngineDrone();
    expect(app.engineTimer).not.toBeNull();

    app.circles = [];
    app.syncEngineDrone();
    expect(app.engineTimer).toBeNull();
  });

  it("does not run when the game is not running", () => {
    const { app } = loadApp();
    app.gameRunning = false;
    app.circles = [{ destroyed: false }];
    app.syncEngineDrone();
    expect(app.engineTimer).toBeNull();
  });

  it("schedules nothing while the tab is hidden", () => {
    const { app, tick } = loadApp();
    app.startEngineDrone();
    const scheduledWhileVisible = app.audioContext.oscillators.length;

    app.document.hidden = true;
    for (let t = 0; t <= 3; t += 0.1) {
      app.audioContext.currentTime = t;
      tick();
    }
    expect(app.audioContext.oscillators.length).toBe(scheduledWhileVisible);

    // ...and picks straight back up when it returns, without firing a
    // burst of catch-up pulses for the time it spent hidden.
    app.document.hidden = false;
    app.audioContext.currentTime = 3.1;
    tick();
    expect(app.audioContext.oscillators.length).toBeGreaterThan(scheduledWhileVisible);
    const starts = app.audioContext.oscillators
      .map((o) => o.startTime)
      .filter((t): t is number => t !== null);
    for (const start of starts) {
      expect(start).toBeLessThanOrEqual(3.1 + 0.3);
    }
  });
});
