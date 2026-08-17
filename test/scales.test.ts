import { describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

// Scales are derived, not tabulated: every diatonic mode is a rotation of
// some major scale, so majorScales is the only spelled table in the app.
// The risk that buys is spelling -- picking C# major where Db major was
// meant gives the right pitches under wrong names -- so that is what most
// of these tests are about.

type ScaleName = "major" | "dorian" | "phrygian" | "lydian" | "mixolydian" | "minor" | "locrian";

interface App {
  buildScale(tonic: string, scale: ScaleName): string[];
  getKeysForScale(scale: ScaleName): string[];
  spellNoteInScale(note: string, scale: string[]): string;
  pitchClass(note: string): number;
  majorScales: { [key: string]: string[] };
  MODE_ROTATION: { [key: string]: number };
  MAJOR_KEY_ORDER: string[];
}

function loadApp(): App {
  return loadAppPureLogic() as unknown as App;
}

/** The minor-scale table the app used to carry, kept here as the reference
    the derived aeolian output must reproduce exactly, spellings included. */
const LEGACY_MINOR_SCALES: { [key: string]: string[] } = {
  A: ["A", "B", "C", "D", "E", "F", "G"],
  E: ["E", "F#", "G", "A", "B", "C", "D"],
  B: ["B", "C#", "D", "E", "F#", "G", "A"],
  "F#": ["F#", "G#", "A", "B", "C#", "D", "E"],
  "C#": ["C#", "D#", "E", "F#", "G#", "A", "B"],
  "G#": ["G#", "A#", "B", "C#", "D#", "E", "F#"],
  "D#": ["D#", "E#", "F#", "G#", "A#", "B", "C#"],
  "A#": ["A#", "B#", "C#", "D#", "E#", "F#", "G#"],
  D: ["D", "E", "F", "G", "A", "Bb", "C"],
  G: ["G", "A", "Bb", "C", "D", "Eb", "F"],
  C: ["C", "D", "Eb", "F", "G", "Ab", "Bb"],
  F: ["F", "G", "Ab", "Bb", "C", "Db", "Eb"],
  Bb: ["Bb", "C", "Db", "Eb", "F", "Gb", "Ab"],
  Eb: ["Eb", "F", "Gb", "Ab", "Bb", "Cb", "Db"],
};

/** Semitones above the tonic for each degree of each mode. */
const EXPECTED_STEPS: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
};

const ALL_SCALES = Object.keys(EXPECTED_STEPS) as ScaleName[];

describe("buildScale", () => {
  it("returns the major table unchanged for major", () => {
    const app = loadApp();
    for (const key of app.MAJOR_KEY_ORDER) {
      expect(app.buildScale(key, "major")).toEqual(app.majorScales[key]);
    }
  });

  it("reproduces the old hardcoded minor table exactly, spellings included", () => {
    const app = loadApp();
    for (const tonic of Object.keys(LEGACY_MINOR_SCALES)) {
      expect(app.buildScale(tonic, "minor")).toEqual(LEGACY_MINOR_SCALES[tonic]);
    }
  });

  it("spells the modes the way they are written", () => {
    const app = loadApp();
    expect(app.buildScale("D", "dorian")).toEqual(["D", "E", "F", "G", "A", "B", "C"]);
    expect(app.buildScale("E", "phrygian")).toEqual(["E", "F", "G", "A", "B", "C", "D"]);
    expect(app.buildScale("F", "lydian")).toEqual(["F", "G", "A", "B", "C", "D", "E"]);
    expect(app.buildScale("G", "mixolydian")).toEqual(["G", "A", "B", "C", "D", "E", "F"]);
    expect(app.buildScale("B", "locrian")).toEqual(["B", "C", "D", "E", "F", "G", "A"]);
  });

  it("picks the parent key that spells the tonic, not merely one that sounds it", () => {
    const app = loadApp();
    // Db major and C# major share every pitch, but only Db major's 2nd
    // degree is spelled "Eb" -- pick C# and the scale comes out as
    // D# E# F# G# A# B# C#, right notes under wrong names.
    expect(app.buildScale("Eb", "dorian")).toEqual(["Eb", "F", "Gb", "Ab", "Bb", "C", "Db"]);
    expect(app.buildScale("Bb", "mixolydian")).toEqual(["Bb", "C", "D", "Eb", "F", "G", "Ab"]);
  });

  it("gives every mode its defining interval pattern, in every key it offers", () => {
    const app = loadApp();
    for (const scale of ALL_SCALES) {
      for (const tonic of app.getKeysForScale(scale)) {
        const notes = app.buildScale(tonic, scale);
        const steps = notes.map(
          (note) => ((app.pitchClass(note) - app.pitchClass(notes[0])) % 12 + 12) % 12,
        );
        expect(steps).toEqual(EXPECTED_STEPS[scale]);
      }
    }
  });

  it("gives every scale seven notes on seven distinct pitches", () => {
    const app = loadApp();
    for (const scale of ALL_SCALES) {
      for (const tonic of app.getKeysForScale(scale)) {
        const notes = app.buildScale(tonic, scale);
        expect(notes).toHaveLength(7);
        expect(new Set(notes.map((n) => app.pitchClass(n))).size).toBe(7);
        expect(notes.every((n) => app.pitchClass(n) >= 0)).toBe(true);
      }
    }
  });

  it("falls back to the enharmonic parent for a tonic no major key spells", () => {
    const app = loadApp();
    // No major key has "Cb" as its 2nd degree, so this can only resolve
    // through the pitch-class fallback. The pitches must still be right.
    const notes = app.buildScale("Cb", "dorian");
    expect(notes).toHaveLength(7);
    expect(app.pitchClass(notes[0])).toBe(app.pitchClass("Cb"));
  });
});

describe("getKeysForScale", () => {
  it("offers the major keys in circle-of-fifths order", () => {
    const app = loadApp();
    expect(app.getKeysForScale("major")).toEqual(app.MAJOR_KEY_ORDER);
  });

  it("offers exactly the minor keys the old table had, in the same order", () => {
    const app = loadApp();
    expect(app.getKeysForScale("minor")).toEqual(Object.keys(LEGACY_MINOR_SCALES));
  });

  it("covers all twelve pitches for every mode", () => {
    const app = loadApp();
    for (const scale of ALL_SCALES) {
      const keys = app.getKeysForScale(scale);
      expect(new Set(keys.map((k) => app.pitchClass(k))).size).toBe(12);
    }
  });
});

describe("spellNoteInScale", () => {
  it("uses the scale's own spelling rather than the matcher's sharps", () => {
    const app = loadApp();
    const eFlatMajor = app.buildScale("Eb", "major");
    expect(app.spellNoteInScale("A#", eFlatMajor)).toBe("Bb");
    expect(app.spellNoteInScale("D#", eFlatMajor)).toBe("Eb");
    expect(app.spellNoteInScale("G", eFlatMajor)).toBe("G");
  });

  it("leaves a pitch the scale doesn't contain alone", () => {
    const app = loadApp();
    const cMajor = app.buildScale("C", "major");
    expect(app.spellNoteInScale("F#", cMajor)).toBe("F#");
  });
});
