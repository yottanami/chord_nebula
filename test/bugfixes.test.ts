import { describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

interface PlayedNote {
  noteName: string;
  midiNumber: number;
}

interface Circle {
  element: { style: Record<string, string>; parentNode: unknown };
  noteOrChordName: string;
  noteOrChordNotes: string[];
  y: number;
  speed: number;
  destroyed: boolean;
  size: number;
  xFraction: number;
}

interface ChordSpec {
  root: string;
  quality: string;
  notes: string[];
}

interface App {
  onMIDIMessage(event: { data: number[] }): void;
  checkChords(): void;
  updateCircles(deltaMs: number): void;
  getChordSpecForLevel(degreeIndex: number): ChordSpec;
  noteOnStack: PlayedNote[];
  circles: Circle[];
  chosenKey: string;
  chosenMode: "major" | "minor";
  selectedLevel: number;
  score: number;
  document: { getElementById: () => null };
  window: { innerWidth: number; innerHeight: number };
  AudioContext: new () => unknown;
  setTimeout: (fn: () => void, ms: number) => number;
}

// Minimal Web Audio stand-ins -- none of these tests care about actual
// sound, only that the code paths that touch AudioContext don't crash.
class FakeParam {
  setValueAtTime() {}
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
  currentTime = 0;
  destination = {};
  createOscillator() {
    return new FakeNode();
  }
  createGain() {
    return new FakeNode();
  }
}

function loadApp(): App {
  const app = loadAppPureLogic() as unknown as App;
  app.document = { getElementById: () => null };
  app.AudioContext = FakeAudioContext as unknown as new () => unknown;
  // playChordSound schedules osc.stop() via setTimeout; the real timer
  // firing doesn't matter for these tests, just that it doesn't crash.
  app.setTimeout = (() => 0) as unknown as App["setTimeout"];
  return app;
}

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;

describe("note-continuity bug: checkChords must also run on note-off", () => {
  it("detects a match completed by releasing an extra wrong note, not just by pressing a note", () => {
    const app = loadApp();
    app.chosenKey = "C";
    app.chosenMode = "major";
    app.selectedLevel = 4;

    const circle: Circle = {
      element: { style: {}, parentNode: null },
      noteOrChordName: "C",
      noteOrChordNotes: ["C", "E", "G"],
      y: 0,
      speed: 1,
      destroyed: false,
      size: 150,
      xFraction: 0,
    };
    app.circles = [circle];

    // Press a wrong extra note (A4=69) *first*, then the correct triad
    // (C4, E4, G4) -- so the chord is never an exact match while all four
    // notes are held, and only becomes correct once the wrong one is
    // released (rather than completing on the 3rd correct note-on, which
    // wouldn't exercise the note-off path at all).
    app.onMIDIMessage({ data: [NOTE_ON, 69, 100] });
    app.onMIDIMessage({ data: [NOTE_ON, 60, 100] });
    app.onMIDIMessage({ data: [NOTE_ON, 64, 100] });
    app.onMIDIMessage({ data: [NOTE_ON, 67, 100] });
    expect(circle.destroyed).toBe(false); // extra note present -> not a match yet

    // Release just the wrong note, correct notes stay held.
    app.onMIDIMessage({ data: [NOTE_OFF, 69, 0] });

    expect(circle.destroyed).toBe(true);
    expect(app.score).toBe(1);
  });

  it("still matches normally when only correct notes are ever played (no regression)", () => {
    const app = loadApp();
    app.chosenKey = "C";
    app.chosenMode = "major";
    app.selectedLevel = 4;

    const circle: Circle = {
      element: { style: {}, parentNode: null },
      noteOrChordName: "C",
      noteOrChordNotes: ["C", "E", "G"],
      y: 0,
      speed: 1,
      destroyed: false,
      size: 150,
      xFraction: 0,
    };
    app.circles = [circle];

    app.onMIDIMessage({ data: [NOTE_ON, 60, 100] });
    app.onMIDIMessage({ data: [NOTE_ON, 64, 100] });
    expect(circle.destroyed).toBe(false);
    app.onMIDIMessage({ data: [NOTE_ON, 67, 100] });

    expect(circle.destroyed).toBe(true);
  });
});

describe("enharmonic bug: E#/B# scale degrees must produce the right playable notes", () => {
  // `spec.root` intentionally stays as the raw scale-degree spelling
  // (e.g. "E#") for display -- that's the musically-correct spelling for
  // that key, not a bug. What the fix corrects is `spec.notes`, the
  // actual pitch list matched against what's played: before the fix,
  // toSharpName("E#") passed "E#" through unchanged, noteNames.indexOf
  // ("E#") was -1, and buildChordFromRoot's `if (rootIndex < 0) rootIndex
  // = 0` fallback silently rooted the chord on C instead of F -- a fully
  // wrong chord, not just a cosmetic display quirk.

  it("builds a real F minor triad for C# major's iii degree (scale-spelled as E#)", () => {
    const app = loadApp();
    app.chosenKey = "C#";
    app.chosenMode = "major";
    app.selectedLevel = 4;

    // C# major scale: C# D# E# F# G# A# B# -- degree iii is index 2, E#.
    const spec = app.getChordSpecForLevel(2);
    expect(spec.root).toBe("E#"); // correct spelling for C# major, unchanged
    expect(spec.quality).toBe("min");
    expect(spec.notes).toEqual(["F", "G#", "C"]); // the actually-playable pitches
  });

  it("builds a real F minor triad for A# minor's v degree (scale-spelled as E#)", () => {
    const app = loadApp();
    app.chosenKey = "A#";
    app.chosenMode = "minor";
    app.selectedLevel = 4;

    // A# minor scale: A# B# C# D# E# F# G# -- degree v is index 4, E#.
    const spec = app.getChordSpecForLevel(4);
    expect(spec.root).toBe("E#");
    expect(spec.quality).toBe("min");
    expect(spec.notes).toEqual(["F", "G#", "C"]);
  });
});

describe("timing bug: circle movement must be proportional to real elapsed time", () => {
  function fakeCircle(speed: number): Circle {
    return {
      element: { style: {}, parentNode: null },
      noteOrChordName: "",
      noteOrChordNotes: [],
      y: 0,
      speed,
      destroyed: false,
      size: 150,
      xFraction: 0,
    };
  }

  it("moves a full `speed` step at the 60fps reference frame time", () => {
    const app = loadApp();
    app.window = { innerWidth: 10000, innerHeight: 10000 };
    const circle = fakeCircle(2);
    app.circles = [circle];

    app.updateCircles(1000 / 60);

    expect(circle.y).toBeCloseTo(2, 5);
  });

  it("moves proportionally less when less real time has passed (e.g. a faster display)", () => {
    const app = loadApp();
    app.window = { innerWidth: 10000, innerHeight: 10000 };
    const circle = fakeCircle(2);
    app.circles = [circle];

    app.updateCircles(1000 / 60 / 3);

    expect(circle.y).toBeCloseTo(2 / 3, 5);
  });

  it("moves proportionally more when more real time has passed (e.g. a slow/dropped frame)", () => {
    const app = loadApp();
    app.window = { innerWidth: 10000, innerHeight: 10000 };
    const circle = fakeCircle(2);
    app.circles = [circle];

    app.updateCircles((1000 / 60) * 3);

    expect(circle.y).toBeCloseTo(6, 5);
  });
});
