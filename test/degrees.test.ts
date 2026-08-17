import { describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

// Chord qualities and roman numerals used to be six hardcoded tables that
// only knew major and minor. They are now read off the scale itself, which
// is what lets five more modes exist. These tests hold that derivation to
// the answers the old tables gave, and to standard notation for the modes
// the old tables never covered.

type ScaleName = "major" | "dorian" | "phrygian" | "lydian" | "mixolydian" | "minor" | "locrian";

interface App {
  buildScale(tonic: string, scale: ScaleName): string[];
  diatonicChordNotes(scale: string[], degreeIndex: number, size: number): string[];
  diatonicQuality(scale: string[], degreeIndex: number, size: number): string;
  degreeLabel(scale: string[], degreeIndex: number, quality: string): string;
  qualityFromIntervals(semitones: number[]): string | null;
  chordQualityToIntervals(quality: string): number[];
  intervalAbove(root: string, note: string, atLeast: number): number;
  isDominantDegree(degreeIndex: number): boolean;
  QUALITY_INTERVALS: { [key: string]: number[] };
}

function loadApp(): App {
  return loadAppPureLogic() as unknown as App;
}

function qualities(app: App, tonic: string, scale: ScaleName, size: number): string[] {
  const notes = app.buildScale(tonic, scale);
  return [0, 1, 2, 3, 4, 5, 6].map((degree) => app.diatonicQuality(notes, degree, size));
}

function labels(app: App, tonic: string, scale: ScaleName): string[] {
  const notes = app.buildScale(tonic, scale);
  return [0, 1, 2, 3, 4, 5, 6].map((degree) =>
    app.degreeLabel(notes, degree, app.diatonicQuality(notes, degree, 3)),
  );
}

describe("diatonicQuality: triads", () => {
  it("matches the old major table", () => {
    const app = loadApp();
    expect(qualities(app, "C", "major", 3)).toEqual([
      "maj", "min", "min", "maj", "maj", "min", "dim",
    ]);
  });

  it("matches the old minor table", () => {
    const app = loadApp();
    expect(qualities(app, "A", "minor", 3)).toEqual([
      "min", "dim", "maj", "min", "min", "maj", "maj",
    ]);
  });

  it("rotates correctly for the modes the old tables never had", () => {
    const app = loadApp();
    expect(qualities(app, "D", "dorian", 3)).toEqual([
      "min", "min", "maj", "maj", "min", "dim", "maj",
    ]);
    expect(qualities(app, "E", "phrygian", 3)).toEqual([
      "min", "maj", "maj", "min", "dim", "maj", "min",
    ]);
    expect(qualities(app, "F", "lydian", 3)).toEqual([
      "maj", "maj", "min", "dim", "maj", "min", "min",
    ]);
    expect(qualities(app, "G", "mixolydian", 3)).toEqual([
      "maj", "min", "dim", "maj", "min", "min", "maj",
    ]);
    expect(qualities(app, "B", "locrian", 3)).toEqual([
      "dim", "maj", "min", "min", "maj", "maj", "min",
    ]);
  });

  it("gives the same answer in every key, not just the white-note one", () => {
    const app = loadApp();
    for (const tonic of ["Eb", "F#", "Bb", "C#"]) {
      expect(qualities(app, tonic, "major", 3)).toEqual(qualities(app, "C", "major", 3));
      expect(qualities(app, tonic, "dorian", 3)).toEqual(qualities(app, "D", "dorian", 3));
    }
  });
});

describe("diatonicQuality: sevenths", () => {
  it("matches the old major seventh table", () => {
    const app = loadApp();
    expect(qualities(app, "C", "major", 4)).toEqual([
      "maj7", "min7", "min7", "maj7", "dom7", "min7", "hdim7",
    ]);
  });

  it("matches the old minor seventh table", () => {
    const app = loadApp();
    expect(qualities(app, "A", "minor", 4)).toEqual([
      "min7", "hdim7", "maj7", "min7", "min7", "maj7", "dom7",
    ]);
  });

  it("resolves to a real seventh chord on every degree of every mode", () => {
    const app = loadApp();
    const sevenths = ["maj7", "min7", "dom7", "hdim7"];
    const scales: ScaleName[] = [
      "major", "dorian", "phrygian", "lydian", "mixolydian", "minor", "locrian",
    ];
    for (const scale of scales) {
      for (const quality of qualities(app, "C", scale, 4)) {
        expect(sevenths).toContain(quality);
      }
    }
  });
});

describe("diatonicChordNotes", () => {
  it("stacks every other scale note, wrapping the scale", () => {
    const app = loadApp();
    const cMajor = app.buildScale("C", "major");
    expect(app.diatonicChordNotes(cMajor, 0, 3)).toEqual(["C", "E", "G"]);
    expect(app.diatonicChordNotes(cMajor, 4, 4)).toEqual(["G", "B", "D", "F"]);
    expect(app.diatonicChordNotes(cMajor, 6, 3)).toEqual(["B", "D", "F"]);
  });
});

describe("intervalAbove", () => {
  it("keeps a stack of thirds ascending instead of folding into one octave", () => {
    const app = loadApp();
    // A ninth is 14 semitones up, not the 2 it folds to.
    expect(app.intervalAbove("C", "D", 12)).toBe(14);
    expect(app.intervalAbove("C", "E", 0)).toBe(4);
    expect(app.intervalAbove("C", "B", 8)).toBe(11);
  });
});

describe("qualityFromIntervals", () => {
  it("round-trips every quality the game can build", () => {
    const app = loadApp();
    for (const quality of Object.keys(app.QUALITY_INTERVALS)) {
      expect(app.qualityFromIntervals(app.chordQualityToIntervals(quality))).toBe(quality);
    }
  });

  it("returns null for a stack that isn't in the vocabulary", () => {
    const app = loadApp();
    expect(app.qualityFromIntervals([0, 1, 2])).toBeNull();
    expect(app.qualityFromIntervals([0, 4])).toBeNull();
  });
});

describe("degreeLabel", () => {
  it("writes major degrees the way they have always been written", () => {
    const app = loadApp();
    expect(labels(app, "C", "major")).toEqual(["I", "ii", "iii", "IV", "V", "vi", "vii°"]);
  });

  it("marks the flattened degrees of a minor key", () => {
    const app = loadApp();
    expect(labels(app, "A", "minor")).toEqual(["i", "ii°", "bIII", "iv", "v", "bVI", "bVII"]);
  });

  it("marks phrygian's flat second and dorian's natural sixth", () => {
    const app = loadApp();
    expect(labels(app, "E", "phrygian")).toEqual(["i", "bII", "bIII", "iv", "v°", "bVI", "bvii"]);
    expect(labels(app, "D", "dorian")).toEqual(["i", "ii", "bIII", "IV", "v", "vi°", "bVII"]);
  });

  it("marks lydian's raised fourth and mixolydian's flat seventh", () => {
    const app = loadApp();
    expect(labels(app, "F", "lydian")).toEqual(["I", "II", "iii", "#iv°", "V", "vi", "vii"]);
    expect(labels(app, "G", "mixolydian")).toEqual(["I", "ii", "iii°", "IV", "v", "vi", "bVII"]);
  });

  it("is identical in every key, since it describes the degree not the pitch", () => {
    const app = loadApp();
    for (const tonic of ["Eb", "F#", "Bb", "Db"]) {
      expect(labels(app, tonic, "minor")).toEqual(labels(app, "A", "minor"));
    }
  });

  it("marks augmented chords, and every diminished flavour alike", () => {
    const app = loadApp();
    const cMajor = app.buildScale("C", "major");
    expect(app.degreeLabel(cMajor, 0, "aug")).toBe("I+");
    expect(app.degreeLabel(cMajor, 6, "dim")).toBe("vii°");
    expect(app.degreeLabel(cMajor, 6, "hdim7")).toBe("vii°");
    expect(app.degreeLabel(cMajor, 6, "dim7")).toBe("vii°");
  });
});

describe("isDominantDegree", () => {
  it("is the fifth degree, whatever the scale calls it", () => {
    const app = loadApp();
    expect(app.isDominantDegree(4)).toBe(true);
    expect(app.isDominantDegree(0)).toBe(false);
    expect(app.isDominantDegree(6)).toBe(false);
  });
});
