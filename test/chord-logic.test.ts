import { describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

interface PlayedNote {
  noteName: string;
  midiNumber: number;
}

interface ChordSpec {
  root: string;
  quality: string;
  notes: string[];
}

interface App {
  matchesLevel1to3(chordNotes: string[]): boolean;
  matchesLevel4(chordNotes: string[]): boolean;
  matchesLevel5(chordNotes: string[]): boolean;
  getChordSpecForLevel(degreeIndex: number): ChordSpec;
  noteOnStack: PlayedNote[];
  chosenKey: string;
  chosenMode: "major" | "minor";
  selectedLevel: number;
}

function loadApp(): App {
  return loadAppPureLogic() as unknown as App;
}

/** Builds PlayedNote entries from raw MIDI numbers (noteName is unused by the matchers). */
function played(...midiNumbers: number[]): PlayedNote[] {
  return midiNumbers.map((midiNumber) => ({ noteName: "", midiNumber }));
}

describe("matchesLevel1to3 (order-independent set match)", () => {
  it("matches a C major triad played in any order", () => {
    const app = loadApp();
    app.noteOnStack = played(67, 60, 64); // G4, C4, E4 -- deliberately out of order
    expect(app.matchesLevel1to3(["C", "E", "G"])).toBe(true);
  });

  it("rejects a wrong note", () => {
    const app = loadApp();
    app.noteOnStack = played(60, 64, 68); // C4, E4, G#4
    expect(app.matchesLevel1to3(["C", "E", "G"])).toBe(false);
  });

  it("rejects a missing note", () => {
    const app = loadApp();
    app.noteOnStack = played(60, 64); // C4, E4 only
    expect(app.matchesLevel1to3(["C", "E", "G"])).toBe(false);
  });
});

describe("matchesLevel4 (ascending pitch order must match ascending pitch-class order)", () => {
  it("matches a root-position C major triad (C below E below G)", () => {
    const app = loadApp();
    app.noteOnStack = played(60, 64, 67); // C4, E4, G4
    expect(app.matchesLevel4(["C", "E", "G"])).toBe(true);
  });

  it("rejects a voicing where a higher pitch-class note sits below a lower one", () => {
    const app = loadApp();
    // Same three pitch classes as C/E/G, but G is voiced below C -- not
    // root-position, and matchesLevel4 requires pitch order == pitch-class order.
    app.noteOnStack = played(55, 60, 64); // G3, C4, E4
    expect(app.matchesLevel4(["C", "E", "G"])).toBe(false);
  });
});

describe("matchesLevel5 (chordNotes order must match the played order exactly)", () => {
  it("matches when chordNotes are listed low-to-high, same as played", () => {
    const app = loadApp();
    app.noteOnStack = played(60, 64, 67); // C4, E4, G4
    expect(app.matchesLevel5(["C", "E", "G"])).toBe(true);
  });

  it("rejects when the given note order doesn't match the played order", () => {
    const app = loadApp();
    app.noteOnStack = played(60, 64, 67); // C4, E4, G4
    expect(app.matchesLevel5(["E", "C", "G"])).toBe(false);
  });
});

describe("getChordSpecForLevel", () => {
  it("builds a C major I triad at level 4 (triads)", () => {
    const app = loadApp();
    app.chosenKey = "C";
    app.chosenMode = "major";
    app.selectedLevel = 4;
    // Degrees are 0-based scale indices now, so the tonic is 0 and the
    // dominant is 4 -- the roman numeral is generated from the scale.
    const spec = app.getChordSpecForLevel(0);
    expect(spec.root).toBe("C");
    expect(spec.quality).toBe("maj");
    expect(spec.notes).toEqual(["C", "E", "G"]);
  });

  it("builds a G dominant-seventh V chord at level 6 (sevenths)", () => {
    const app = loadApp();
    app.chosenKey = "C";
    app.chosenMode = "major";
    app.selectedLevel = 6;
    const spec = app.getChordSpecForLevel(4);
    expect(spec.root).toBe("G");
    expect(spec.quality).toBe("dom7");
    expect(spec.notes).toEqual(["G", "B", "D", "F"]);
  });

  it("resolves the root from the chosen key's scale degree, not just C", () => {
    const app = loadApp();
    app.chosenKey = "G";
    app.chosenMode = "major";
    app.selectedLevel = 4;
    // Degree V in G major is D (G major scale: G A B C D E F#).
    const spec = app.getChordSpecForLevel(4);
    expect(spec.root).toBe("D");
  });
});
