import { describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

// Coverage for the parts of the game the other suites don't reach: the HUD,
// note naming and frequencies, single-note levels, level 5's bass rule,
// voice leading, and how checkChords dispatches per level.

type ScaleName = "major" | "dorian" | "phrygian" | "lydian" | "mixolydian" | "minor" | "locrian";

interface PlayedNote {
  noteName: string;
  midiNumber: number;
}

interface Circle {
  element: FakeElement;
  noteOrChordName: string;
  noteOrChordNotes: string[];
  y: number;
  speed: number;
  destroyed: boolean;
  size: number;
  xFraction: number;
}

interface App {
  updateScore(): void;
  updateLives(): void;
  matchesLevel1to3(chordNotes: string[]): boolean;
  matchesLevel4(chordNotes: string[]): boolean;
  matchesLevel5(chordNotes: string[]): boolean;
  checkChords(): void;
  midiNoteToName(note: number): string;
  toSharpName(name: string): string;
  freqFromMidiNote(midi: number): number;
  noteNameToFreq(name: string): number;
  noteNameToMidi(name: string, octave?: number): number;
  createBassForLevel5(baseChord: string[]): string;
  buildChordFromRoot(root: string, quality: string): string[];
  chordQualityToLabel(quality: string): string;
  getChordFullName(root: string, quality: string): string;
  invertChord(notes: string[], inversion: number): string[];
  noteDistance(a: string, b: string): number;
  closestInversion(
    previous: string[] | null,
    chord: string[],
  ): { inv: string[]; inversion: number };
  getNextSingleNote(): string;
  generateNoteCircle(): void;
  generateChordCircle(): void;
  buildScale(tonic: string, scale: ScaleName): string[];
  noteOnStack: PlayedNote[];
  circles: Circle[];
  score: number;
  lives: number;
  chosenKey: string;
  chosenMode: ScaleName;
  chosenGenre: string;
  selectedLevel: number;
  chordIndex: number;
  showNotes: boolean;
  document: {
    getElementById: (id: string) => FakeElement | null;
    createElement: (tag: string) => FakeElement;
  };
  window: { innerWidth: number; innerHeight: number };
  AudioContext: unknown;
  setTimeout: (fn: () => void, ms: number) => number;
}

class FakeClassList {
  private classes = new Set<string>();
  add(name: string) {
    this.classes.add(name);
  }
  remove(name: string) {
    this.classes.delete(name);
  }
  contains(name: string) {
    return this.classes.has(name);
  }
}

class FakeElement {
  className = "";
  innerText = "";
  innerHTML = "";
  style: Record<string, string> = {};
  classList = new FakeClassList();
  parentNode: FakeElement | null = null;
  children: FakeElement[] = [];
  clientWidth = 1000;
  clientHeight = 800;
  offsetWidth = 0;
  appendChild(child: FakeElement) {
    child.parentNode = this;
    this.children.push(child);
  }
  removeChild(child: FakeElement) {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
  }
  querySelectorAll(): FakeElement[] {
    return [];
  }
}

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
  currentTime = 0;
  destination = {};
  state = "running";
  createOscillator() {
    return new FakeNode();
  }
  createGain() {
    return new FakeNode();
  }
}

function loadApp() {
  const app = loadAppPureLogic() as unknown as App;
  const elements: Record<string, FakeElement> = {
    gameArea: new FakeElement(),
    scoreDisplay: new FakeElement(),
    livesDisplay: new FakeElement(),
  };
  app.document = {
    getElementById: (id: string) => elements[id] ?? null,
    createElement: () => new FakeElement(),
  };
  app.window = { innerWidth: 1000, innerHeight: 800 };
  app.AudioContext = FakeAudioContext;
  app.setTimeout = (() => 0) as unknown as App["setTimeout"];
  return { app, elements };
}

function played(...midiNumbers: number[]): PlayedNote[] {
  return midiNumbers.map((midiNumber) => ({ noteName: "", midiNumber }));
}

function fakeCircle(notes: string[]): Circle {
  return {
    element: new FakeElement(),
    noteOrChordName: "",
    noteOrChordNotes: notes,
    y: 0,
    speed: 1,
    destroyed: false,
    size: 150,
    xFraction: 0,
  };
}

describe("HUD", () => {
  it("writes the score as a bare number", () => {
    const { app, elements } = loadApp();
    app.score = 42;
    app.updateScore();
    expect(elements.scoreDisplay.innerText).toBe("42");
  });

  it("draws spent lives as dimmed pips rather than removing them", () => {
    const { app, elements } = loadApp();
    app.lives = 2;
    app.updateLives();
    const html = elements.livesDisplay.innerHTML;
    expect((html.match(/♥/g) ?? []).length).toBe(3);
    expect((html.match(/lifeSpent/g) ?? []).length).toBe(1);
  });

  it("draws three spent pips at zero lives, and never negative", () => {
    const { app, elements } = loadApp();
    app.lives = -1;
    app.updateLives();
    expect((elements.livesDisplay.innerHTML.match(/lifeSpent/g) ?? []).length).toBe(3);
  });
});

describe("note naming and frequencies", () => {
  it("names MIDI notes by pitch class", () => {
    const { app } = loadApp();
    expect(app.midiNoteToName(60)).toBe("C");
    expect(app.midiNoteToName(69)).toBe("A");
    expect(app.midiNoteToName(70)).toBe("A#");
  });

  it("normalises flats, and the E#/B# spellings scale tables use", () => {
    const { app } = loadApp();
    expect(app.toSharpName("Bb")).toBe("A#");
    expect(app.toSharpName("Cb")).toBe("B");
    expect(app.toSharpName("E#")).toBe("F");
    expect(app.toSharpName("B#")).toBe("C");
    expect(app.toSharpName("G")).toBe("G");
  });

  it("puts A4 at 440Hz and an octave at double the frequency", () => {
    const { app } = loadApp();
    expect(app.freqFromMidiNote(69)).toBeCloseTo(440, 6);
    expect(app.freqFromMidiNote(81)).toBeCloseTo(880, 6);
  });

  it("sounds chord notes in one octave from A", () => {
    const { app } = loadApp();
    expect(app.noteNameToFreq("A")).toBeCloseTo(440, 6);
    // Bb is a semitone up from A, in the same octave.
    expect(app.noteNameToFreq("Bb")).toBeCloseTo(440 * Math.pow(2, 1 / 12), 6);
  });

  it("maps note names to MIDI numbers in a given octave", () => {
    const { app } = loadApp();
    expect(app.noteNameToMidi("C", 2)).toBe(24);
    expect(app.noteNameToMidi("Bb", 2)).toBe(34);
  });
});

describe("single-note levels", () => {
  it("walks the scale in order on level 1, then wraps", () => {
    const { app } = loadApp();
    app.chosenKey = "C";
    app.chosenMode = "major";
    app.selectedLevel = 1;
    app.chordIndex = 0;

    const notes = [];
    for (let i = 0; i < 8; i++) notes.push(app.getNextSingleNote());

    expect(notes).toEqual(["C", "D", "E", "F", "G", "A", "B", "C"]);
  });

  it("stays inside the scale on level 2, in whatever key", () => {
    const { app } = loadApp();
    app.chosenKey = "Eb";
    app.chosenMode = "minor";
    app.selectedLevel = 2;
    const scale = app.buildScale("Eb", "minor");

    for (let i = 0; i < 50; i++) {
      expect(scale).toContain(app.getNextSingleNote());
    }
  });

  it("spawns a note orb showing the note", () => {
    const { app } = loadApp();
    app.chosenKey = "C";
    app.chosenMode = "major";
    app.selectedLevel = 1;
    app.chordIndex = 0;

    app.generateNoteCircle();

    expect(app.circles).toHaveLength(1);
    expect(app.circles[0].noteOrChordNotes).toEqual(["C"]);
    expect(app.circles[0].element.innerHTML).toBe("C");
  });
});

describe("level 5: root in the bass", () => {
  it("accepts the chord only when the listed bass is the lowest note played", () => {
    const { app } = loadApp();
    app.noteOnStack = played(48, 60, 64, 67); // C3, C4, E4, G4
    expect(app.matchesLevel5(["C", "C", "E", "G"])).toBe(true);
  });

  it("rejects a voicing whose lowest note is not the listed bass", () => {
    const { app } = loadApp();
    app.noteOnStack = played(52, 60, 64, 67); // E3 in the bass instead of C3
    expect(app.matchesLevel5(["C", "C", "E", "G"])).toBe(false);
  });

  it("puts the chord root under the triad when spawning a level 5 orb", () => {
    const { app } = loadApp();
    app.chosenGenre = "pop";
    app.chosenKey = "C";
    app.chosenMode = "major";
    app.selectedLevel = 5;
    app.showNotes = true;

    app.generateChordCircle();

    const circle = app.circles[0];
    // Four notes: the added bass plus the triad.
    expect(circle.noteOrChordNotes).toHaveLength(4);
    expect(circle.noteOrChordNotes[0]).toBe(app.createBassForLevel5(circle.noteOrChordNotes.slice(1)));
  });

  it("names the bass note as the chord's root pitch", () => {
    const { app } = loadApp();
    expect(app.createBassForLevel5(["G", "B", "D"])).toBe("G");
    expect(app.createBassForLevel5(["A#", "C#", "F"])).toBe("A#");
  });
});

describe("voice leading", () => {
  it("measures the shorter way round the octave", () => {
    const { app } = loadApp();
    expect(app.noteDistance("C", "B")).toBe(1);
    expect(app.noteDistance("C", "F#")).toBe(6);
    expect(app.noteDistance("C", "C")).toBe(0);
  });

  it("rotates a chord into its inversions", () => {
    const { app } = loadApp();
    expect(app.invertChord(["C", "E", "G"], 1)).toEqual(["E", "G", "C"]);
    expect(app.invertChord(["C", "E", "G"], 2)).toEqual(["G", "C", "E"]);
    expect(app.invertChord(["C", "E", "G"], 0)).toEqual(["C", "E", "G"]);
  });

  it("leaves the first chord of a game in root position", () => {
    const { app } = loadApp();
    expect(app.closestInversion(null, ["C", "E", "G"])).toEqual({
      inv: ["C", "E", "G"],
      inversion: 0,
    });
  });

  it("picks the inversion that moves the voices least", () => {
    const { app } = loadApp();
    // From C-E-G to F-A-C: the second inversion (C-F-A) keeps the top voice
    // and moves the others by two and one semitones, which beats root
    // position's four-and-two.
    const chosen = app.closestInversion(["C", "E", "G"], ["F", "A", "C"]);
    expect(chosen.inv).toEqual(["C", "F", "A"]);
  });
});

describe("chord naming", () => {
  it("builds chords by interval from the root", () => {
    const { app } = loadApp();
    expect(app.buildChordFromRoot("C", "maj")).toEqual(["C", "E", "G"]);
    expect(app.buildChordFromRoot("A", "min7")).toEqual(["A", "C", "E", "G"]);
    expect(app.buildChordFromRoot("B", "hdim7")).toEqual(["B", "D", "F", "A"]);
    // Enharmonic roots resolve rather than silently falling back to C.
    expect(app.buildChordFromRoot("Eb", "maj")).toEqual(["D#", "G", "A#"]);
    expect(app.buildChordFromRoot("E#", "min")).toEqual(["F", "G#", "C"]);
  });

  it("writes the quality the way players read it", () => {
    const { app } = loadApp();
    expect(app.chordQualityToLabel("maj")).toBe("");
    expect(app.chordQualityToLabel("min")).toBe("m");
    expect(app.chordQualityToLabel("dom7")).toBe("7");
    expect(app.chordQualityToLabel("hdim7")).toBe("m7b5");
  });

  it("keeps the scale's spelling of the root in the chord's name", () => {
    const { app } = loadApp();
    expect(app.getChordFullName("Eb", "maj")).toBe("Eb");
    expect(app.getChordFullName("Eb", "min7")).toBe("Ebm7");
    expect(app.getChordFullName("Bb", "dom7")).toBe("Bb7");
  });
});

describe("checkChords dispatch per level", () => {
  it("requires ascending order at level 4", () => {
    const { app } = loadApp();
    app.selectedLevel = 4;
    const circle = fakeCircle(["C", "E", "G"]);
    app.circles = [circle];

    app.noteOnStack = played(55, 60, 64); // G3 below C4: right pitches, wrong voicing
    app.checkChords();
    expect(circle.destroyed).toBe(false);

    app.noteOnStack = played(60, 64, 67);
    app.checkChords();
    expect(circle.destroyed).toBe(true);
    expect(app.score).toBe(1);
  });

  it("accepts any voicing at level 6, where the chords are sevenths", () => {
    const { app } = loadApp();
    app.selectedLevel = 6;
    const circle = fakeCircle(["G", "B", "D", "F"]);
    app.circles = [circle];

    app.noteOnStack = played(53, 55, 59, 62); // F3 at the bottom, third inversion
    app.checkChords();

    expect(circle.destroyed).toBe(true);
  });

  it("ignores orbs already matched", () => {
    const { app } = loadApp();
    app.selectedLevel = 3;
    const circle = fakeCircle(["C", "E", "G"]);
    circle.destroyed = true;
    app.circles = [circle];

    app.noteOnStack = played(60, 64, 67);
    app.checkChords();

    expect(app.score).toBe(0);
  });

  it("matches the one orb that was played, not all of them", () => {
    const { app } = loadApp();
    app.selectedLevel = 3;
    const cMajor = fakeCircle(["C", "E", "G"]);
    const gMajor = fakeCircle(["G", "B", "D"]);
    app.circles = [cMajor, gMajor];

    app.noteOnStack = played(60, 64, 67);
    app.checkChords();

    expect(cMajor.destroyed).toBe(true);
    expect(gMajor.destroyed).toBe(false);
    expect(app.score).toBe(1);
  });
});
