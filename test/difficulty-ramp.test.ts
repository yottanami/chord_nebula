import { describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

// There is one mode, and one ramp: the player picks the level (which chord
// vocabulary to practise) and the score decides how much help they get and
// how fast it comes. Note names go away early; the chord name and its
// function stay for good, since those are what the game is teaching.

interface Stage {
  minScore: number;
  showNotes: boolean;
  speed: number;
  spawnMs: number;
}

interface Circle {
  element: FakeElement;
  noteOrChordNotes: string[];
  speed: number;
}

interface App {
  currentStage(): Stage;
  orbInnerHtml(functionLabel: string, chordLabel: string, notes: string[], withNotes: boolean): string;
  generateCircleByLevel(): void;
  DIFFICULTY_STAGES: Stage[];
  score: number;
  showNotes: boolean;
  selectedLevel: number;
  chosenKey: string;
  chosenMode: "major" | "minor";
  circles: Circle[];
  document: {
    getElementById: (id: string) => FakeElement | null;
    createElement: (tag: string) => FakeElement;
  };
  window: { innerWidth: number; innerHeight: number };
}

class FakeElement {
  className = "";
  innerHTML = "";
  style: Record<string, string> = {};
  parentNode: FakeElement | null = null;
  children: FakeElement[] = [];
  clientWidth = 1000;
  clientHeight = 800;
  /** 0 the way a detached/unstyled node measures, so ORB_SIZE_PX is used. */
  offsetWidth = 0;
  appendChild(child: FakeElement) {
    child.parentNode = this;
    this.children.push(child);
  }
}

function loadApp(): App {
  const app = loadAppPureLogic() as unknown as App;
  const gameArea = new FakeElement();
  app.document = {
    getElementById: (id: string) => (id === "gameArea" ? gameArea : null),
    createElement: () => new FakeElement(),
  };
  app.window = { innerWidth: 1000, innerHeight: 800 };
  return app;
}

describe("currentStage", () => {
  it("starts with note names visible at the slowest pace", () => {
    const app = loadApp();
    app.score = 0;
    const stage = app.currentStage();
    expect(stage.showNotes).toBe(true);
    expect(stage).toEqual(app.DIFFICULTY_STAGES[0]);
  });

  it("holds the first stage until its score threshold is actually passed", () => {
    const app = loadApp();
    app.score = 5;
    expect(app.currentStage().showNotes).toBe(true);
  });

  it("drops the note names at the second stage", () => {
    const app = loadApp();
    app.score = 6;
    expect(app.currentStage().showNotes).toBe(false);
    expect(app.currentStage().speed).toBeGreaterThan(app.DIFFICULTY_STAGES[0].speed);
  });

  it("keeps getting faster, stage after stage, and never regresses", () => {
    const app = loadApp();
    let previous = app.DIFFICULTY_STAGES[0];
    for (const stage of app.DIFFICULTY_STAGES.slice(1)) {
      expect(stage.minScore).toBeGreaterThan(previous.minScore);
      expect(stage.speed).toBeGreaterThan(previous.speed);
      expect(stage.spawnMs).toBeLessThan(previous.spawnMs);
      previous = stage;
    }
  });

  it("never hides the note names again once they are gone", () => {
    const app = loadApp();
    for (let score = 6; score < 200; score++) {
      app.score = score;
      expect(app.currentStage().showNotes).toBe(false);
    }
  });

  it("tops out at the last stage rather than running off the end", () => {
    const app = loadApp();
    app.score = 100000;
    expect(app.currentStage()).toEqual(app.DIFFICULTY_STAGES[app.DIFFICULTY_STAGES.length - 1]);
  });
});

describe("orbInnerHtml", () => {
  it("shows function, chord name and notes while the ramp is still helping", () => {
    const app = loadApp();
    const html = app.orbInnerHtml("I", "C", ["C", "E", "G"], true);
    expect(html).toContain('<div class="ccFunction">I</div>');
    expect(html).toContain('<div class="ccLabel">C</div>');
    expect(html).toContain('<div class="ccNotes">C-E-G</div>');
  });

  it("keeps the chord name and its function once the notes are hidden", () => {
    const app = loadApp();
    const html = app.orbInnerHtml("I", "C", ["C", "E", "G"], false);
    expect(html).toContain('<div class="ccFunction">I</div>');
    expect(html).toContain('<div class="ccLabel">C</div>');
    expect(html).not.toContain("ccNotes");
  });
});

describe("the ramp applied to real spawns", () => {
  function spawn(app: App): FakeElement {
    app.generateCircleByLevel();
    return app.circles[app.circles.length - 1].element;
  }

  it("spells the notes out on a fresh game", () => {
    const app = loadApp();
    app.chosenKey = "C";
    app.chosenMode = "major";
    app.selectedLevel = 3;
    app.score = 0;

    expect(spawn(app).innerHTML).toContain("ccNotes");
    expect(app.showNotes).toBe(true);
  });

  it("stops spelling them out once the player is scoring", () => {
    const app = loadApp();
    app.chosenKey = "C";
    app.chosenMode = "major";
    app.selectedLevel = 3;
    app.score = 6;

    const html = spawn(app).innerHTML;
    expect(html).not.toContain("ccNotes");
    expect(html).toContain("ccFunction");
    expect(app.showNotes).toBe(false);
  });

  it("speeds up later spawns while leaving orbs already falling alone", () => {
    const app = loadApp();
    app.chosenKey = "C";
    app.chosenMode = "major";
    app.selectedLevel = 3;

    app.score = 0;
    app.generateCircleByLevel();
    const early = app.circles[0].speed;

    app.score = 24;
    app.generateCircleByLevel();
    const late = app.circles[1].speed;

    expect(early).toBe(app.DIFFICULTY_STAGES[0].speed);
    expect(late).toBeGreaterThan(early);
    // The first orb keeps the pace it started at.
    expect(app.circles[0].speed).toBe(early);
  });
});
