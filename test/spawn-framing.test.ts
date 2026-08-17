import { describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

// Orbs are absolutely positioned inside #gameArea, which is 70vw wide and
// centred, but spawn used to derive its horizontal range from
// window.innerWidth -- so anything past the play area's right edge was cut
// in half by its overflow:hidden. The miss line had the mirror-image bug in
// the other axis (window.innerHeight - 50, unrelated to where the play area
// actually ends). Both now measure the play area, which is what these tests
// pin down.

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

interface App {
  spawnLeftPx(fieldWidth: number, orbSize: number, fraction: number): number;
  playField(): { width: number; height: number };
  updateCircles(deltaMs: number): void;
  circles: Circle[];
  lives: number;
  document: { getElementById: (id: string) => unknown };
  window: { innerWidth: number; innerHeight: number };
  AudioContext: new () => unknown;
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

class FakeParam {
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
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

/** A stand-in #gameArea whose measured size the tests control. */
class FakeGameArea {
  classList = new FakeClassList();
  constructor(
    public clientWidth: number,
    public clientHeight: number,
  ) {}
  appendChild() {}
  removeChild() {}
}

function loadApp(gameArea: FakeGameArea | null) {
  const app = loadAppPureLogic() as unknown as App;
  app.document = { getElementById: (id: string) => (id === "gameArea" ? gameArea : null) };
  app.window = { innerWidth: 5000, innerHeight: 5000 };
  app.AudioContext = FakeAudioContext as unknown as new () => unknown;
  app.setTimeout = (() => 0) as unknown as App["setTimeout"];
  return app;
}

function fakeCircle(overrides: Partial<Circle> = {}): Circle {
  return {
    element: { style: {}, parentNode: null },
    noteOrChordName: "C",
    noteOrChordNotes: ["C", "E", "G"],
    y: 0,
    speed: 1,
    destroyed: false,
    size: 150,
    xFraction: 0,
    ...overrides,
  };
}

describe("spawnLeftPx", () => {
  it("puts fraction 0 flush against the left edge", () => {
    const app = loadApp(new FakeGameArea(1000, 800));
    expect(app.spawnLeftPx(1000, 150, 0)).toBe(0);
  });

  it("puts fraction 1 flush against the right edge, whole orb still inside", () => {
    const app = loadApp(new FakeGameArea(1000, 800));
    expect(app.spawnLeftPx(1000, 150, 1)).toBe(850);
    expect(app.spawnLeftPx(1000, 150, 1) + 150).toBe(1000);
  });

  it("keeps the whole orb inside for every fraction in between", () => {
    const app = loadApp(new FakeGameArea(1000, 800));
    for (let fraction = 0; fraction <= 1; fraction += 0.01) {
      const left = app.spawnLeftPx(1000, 150, fraction);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + 150).toBeLessThanOrEqual(1000);
    }
  });

  it("clamps to the left edge when the field is narrower than one orb", () => {
    const app = loadApp(new FakeGameArea(100, 800));
    expect(app.spawnLeftPx(100, 150, 0.9)).toBe(0);
  });

  it("clamps out-of-range fractions instead of trusting them", () => {
    const app = loadApp(new FakeGameArea(1000, 800));
    expect(app.spawnLeftPx(1000, 150, -0.5)).toBe(0);
    expect(app.spawnLeftPx(1000, 150, 1.5)).toBe(850);
  });
});

describe("playField", () => {
  it("measures the play area, not the window", () => {
    const app = loadApp(new FakeGameArea(900, 640));
    expect(app.playField()).toEqual({ width: 900, height: 640 });
  });

  it("falls back to the window when there is no play area to measure", () => {
    const app = loadApp(null);
    expect(app.playField()).toEqual({ width: 5000, height: 5000 });
  });

  it("falls back to the window when the play area has no layout yet", () => {
    const app = loadApp(new FakeGameArea(0, 0));
    expect(app.playField()).toEqual({ width: 5000, height: 5000 });
  });
});

describe("updateCircles keeps falling orbs inside the play area", () => {
  it("positions an orb from its fraction of the current field width", () => {
    const app = loadApp(new FakeGameArea(1000, 5000));
    const circle = fakeCircle({ xFraction: 1 });
    app.circles = [circle];

    app.updateCircles(1000 / 60);

    expect(circle.element.style.left).toBe("850px");
  });

  it("re-places orbs already falling when the field shrinks mid-game", () => {
    const gameArea = new FakeGameArea(1000, 5000);
    const app = loadApp(gameArea);
    const circle = fakeCircle({ xFraction: 1 });
    app.circles = [circle];

    app.updateCircles(1000 / 60);
    expect(circle.element.style.left).toBe("850px");

    gameArea.clientWidth = 400;
    app.updateCircles(1000 / 60);

    expect(circle.element.style.left).toBe("250px");
    expect(250 + circle.size).toBeLessThanOrEqual(400);
  });
});

describe("the miss line is the play area's bottom edge", () => {
  it("does not count a miss while any part of the orb is still visible", () => {
    const app = loadApp(new FakeGameArea(1000, 800));
    // One frame short of the bottom: bottom edge at 799 of 800.
    const circle = fakeCircle({ y: 648, speed: 1 });
    app.circles = [circle];

    app.updateCircles(1000 / 60);

    expect(app.circles).toHaveLength(1);
    expect(app.lives).toBe(3);
  });

  it("counts a miss as soon as the orb's bottom reaches the bottom edge", () => {
    const app = loadApp(new FakeGameArea(1000, 800));
    const circle = fakeCircle({ y: 649, speed: 1 });
    app.circles = [circle];

    app.updateCircles(1000 / 60);

    expect(app.circles).toHaveLength(0);
    expect(app.lives).toBe(2);
  });

  it("does not wait for the window's height when the play area is shorter", () => {
    // The old code missed at window.innerHeight - 50 = 4950, so an orb in a
    // 800px-tall play area stayed "playable" while invisible for ~4000px.
    const app = loadApp(new FakeGameArea(1000, 800));
    const circle = fakeCircle({ y: 900, speed: 1 });
    app.circles = [circle];

    app.updateCircles(1000 / 60);

    expect(app.circles).toHaveLength(0);
  });
});
