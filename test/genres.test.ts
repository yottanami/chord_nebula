import { describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

// Progressions are stored as scale degrees per genre, and each genre lists
// only the scales its harmony lives in. These tests check the data is
// well-formed, that the genre-to-scale narrowing holds, and that the
// progression cursor walks and wraps.

type ScaleName = "major" | "dorian" | "phrygian" | "lydian" | "mixolydian" | "minor" | "locrian";

interface Progression {
  label: string;
  scale: ScaleName;
  degrees: number[];
}

interface Genre {
  id: string;
  label: string;
  progressions: Progression[];
}

interface ChordSpec {
  root: string;
  quality: string;
  notes: string[];
  functionLabel: string;
}

interface App {
  GENRES: Genre[];
  MODE_ROTATION: { [key: string]: number };
  getGenre(id: string): Genre;
  getScalesForGenre(id: string): ScaleName[];
  getProgressionsFor(genreId: string, scale: ScaleName): Progression[];
  getProgressions(): number[][];
  getNextChordDegree(): number;
  getChordSpecForLevel(degreeIndex: number): ChordSpec;
  buildScale(tonic: string, scale: ScaleName): string[];
  getKeysForScale(scale: ScaleName): string[];
  pitchClass(note: string): number;
  chosenGenre: string;
  chosenMode: ScaleName;
  chosenKey: string;
  selectedLevel: number;
  progressionIndex: number;
  chordIndex: number;
}

function loadApp(): App {
  return loadAppPureLogic() as unknown as App;
}

describe("genre data", () => {
  it("covers the genres the setup screen offers", () => {
    const app = loadApp();
    expect(app.GENRES.map((g) => g.id)).toEqual([
      "pop", "rock", "jazz", "blues", "classical", "folk", "funk", "edm",
    ]);
  });

  it("gives every genre a label and at least one progression", () => {
    const app = loadApp();
    for (const genre of app.GENRES) {
      expect(genre.label.length).toBeGreaterThan(0);
      expect(genre.progressions.length).toBeGreaterThan(0);
    }
  });

  it("keeps every progression inside a seven-note scale", () => {
    const app = loadApp();
    for (const genre of app.GENRES) {
      for (const progression of genre.progressions) {
        expect(progression.label.length).toBeGreaterThan(0);
        expect(progression.degrees.length).toBeGreaterThan(1);
        expect(Object.keys(app.MODE_ROTATION)).toContain(progression.scale);
        for (const degree of progression.degrees) {
          expect(degree).toBeGreaterThanOrEqual(0);
          expect(degree).toBeLessThanOrEqual(6);
        }
      }
    }
  });

});

describe("getScalesForGenre", () => {
  it("lists exactly the scales a genre's progressions use, without repeats", () => {
    const app = loadApp();
    for (const genre of app.GENRES) {
      const scales = app.getScalesForGenre(genre.id);
      expect(new Set(scales).size).toBe(scales.length);
      expect(new Set(scales)).toEqual(new Set(genre.progressions.map((p) => p.scale)));
    }
  });

  it("keeps each genre to its own scales rather than offering all seven", () => {
    const app = loadApp();
    expect(app.getScalesForGenre("pop")).toEqual(["major", "minor"]);
    expect(app.getScalesForGenre("blues")).toEqual(["mixolydian", "minor"]);
    expect(app.getScalesForGenre("edm")).toContain("phrygian");
    expect(app.getScalesForGenre("classical")).not.toContain("phrygian");
  });

  it("falls back to the first genre for an unknown id", () => {
    const app = loadApp();
    expect(app.getGenre("nope")).toEqual(app.GENRES[0]);
  });
});

describe("getProgressionsFor", () => {
  it("returns only the progressions of the requested scale", () => {
    const app = loadApp();
    for (const genre of app.GENRES) {
      for (const scale of app.getScalesForGenre(genre.id)) {
        const found = app.getProgressionsFor(genre.id, scale);
        expect(found.length).toBeGreaterThan(0);
        expect(found.every((p) => p.scale === scale)).toBe(true);
      }
    }
  });

  it("still returns something for a scale the genre does not cover", () => {
    const app = loadApp();
    // Only reachable by tampering with the selects, but the game must have
    // something to spawn rather than crash on an empty list.
    expect(app.getProgressionsFor("classical", "locrian").length).toBeGreaterThan(0);
  });
});

describe("getNextChordDegree", () => {
  function collect(app: App, count: number): number[] {
    const degrees: number[] = [];
    for (let i = 0; i < count; i++) degrees.push(app.getNextChordDegree());
    return degrees;
  }

  it("walks the current progression, then moves on to the next one", () => {
    const app = loadApp();
    app.chosenGenre = "pop";
    app.chosenMode = "major";
    const [first, second] = app.getProgressions();

    expect(collect(app, first.length)).toEqual(first);
    expect(collect(app, second.length)).toEqual(second);
  });

  it("wraps back to the first progression after the last one", () => {
    const app = loadApp();
    app.chosenGenre = "blues";
    app.chosenMode = "mixolydian";
    const progressions = app.getProgressions();
    const total = progressions.reduce((sum, p) => sum + p.length, 0);

    collect(app, total);

    expect(collect(app, progressions[0].length)).toEqual(progressions[0]);
  });

  it("only ever asks for degrees that exist in the scale", () => {
    const app = loadApp();
    for (const genre of app.GENRES) {
      app.chosenGenre = genre.id;
      for (const scale of app.getScalesForGenre(genre.id)) {
        app.chosenMode = scale;
        app.progressionIndex = 0;
        app.chordIndex = 0;
        for (const degree of collect(app, 40)) {
          expect(degree).toBeGreaterThanOrEqual(0);
          expect(degree).toBeLessThanOrEqual(6);
        }
      }
    }
  });
});

describe("chords across every genre, scale and key", () => {
  it("builds a playable, correctly named chord for every combination", () => {
    const app = loadApp();
    app.selectedLevel = 3;

    for (const genre of app.GENRES) {
      app.chosenGenre = genre.id;
      for (const scale of app.getScalesForGenre(genre.id)) {
        app.chosenMode = scale;
        for (const key of app.getKeysForScale(scale)) {
          app.chosenKey = key;
          const notes = app.buildScale(key, scale);
          for (let degree = 0; degree < 7; degree++) {
            const spec = app.getChordSpecForLevel(degree);
            // Root is the scale's own spelling of that degree.
            expect(spec.root).toBe(notes[degree]);
            // Three distinct, real pitches to play.
            expect(spec.notes).toHaveLength(3);
            expect(new Set(spec.notes.map((n) => app.pitchClass(n))).size).toBe(3);
            expect(spec.notes.every((n) => app.pitchClass(n) >= 0)).toBe(true);
            expect(spec.functionLabel.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("builds seventh chords the same way at level 6", () => {
    const app = loadApp();
    app.selectedLevel = 6;
    for (const genre of app.GENRES) {
      app.chosenGenre = genre.id;
      for (const scale of app.getScalesForGenre(genre.id)) {
        app.chosenMode = scale;
        app.chosenKey = app.getKeysForScale(scale)[0];
        for (let degree = 0; degree < 7; degree++) {
          const spec = app.getChordSpecForLevel(degree);
          expect(spec.notes).toHaveLength(4);
          expect(new Set(spec.notes.map((n) => app.pitchClass(n))).size).toBe(4);
        }
      }
    }
  });
});
