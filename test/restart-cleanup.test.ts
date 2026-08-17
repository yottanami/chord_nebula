import { describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

// startGame reset the `circles` array but never detached the orb elements
// it had appended to #gameArea, so losing and restarting began the new game
// with the previous game's dead orbs still on screen. clearCircles is the
// fix; these tests cover both halves of it (tracked orbs and strays) and
// that it leaves the decorative canvas alone.

class FakeElement {
  className = "";
  style: Record<string, string> = {};
  parentNode: FakeElement | null = null;
  children: FakeElement[] = [];
  constructor(className = "") {
    this.className = className;
  }
  appendChild(child: FakeElement) {
    child.parentNode = this;
    this.children.push(child);
  }
  removeChild(child: FakeElement) {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
  }
  /** Supports only the comma-separated class selectors clearCircles uses. */
  querySelectorAll(selector: string): FakeElement[] {
    const wanted = selector.split(",").map((s) => s.trim().replace(/^\./, ""));
    return this.children.filter((c) => wanted.includes(c.className));
  }
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
  clearCircles(): void;
  endGame(): void;
  circles: Circle[];
  gameRunning: boolean;
  document: { getElementById: (id: string) => FakeElement | null };
}

function loadApp(gameArea: FakeElement | null) {
  const app = loadAppPureLogic() as unknown as App;
  app.document = { getElementById: (id: string) => (id === "gameArea" ? gameArea : null) };
  return app;
}

/** An orb attached to the play area, as spawnCircle would leave it. */
function attachOrb(app: App, gameArea: FakeElement): Circle {
  const element = new FakeElement("chordCircle");
  gameArea.appendChild(element);
  const circle: Circle = {
    element,
    noteOrChordName: "C",
    noteOrChordNotes: ["C", "E", "G"],
    y: 0,
    speed: 1,
    destroyed: false,
    size: 150,
    xFraction: 0.5,
  };
  app.circles.push(circle);
  return circle;
}

describe("clearCircles", () => {
  it("detaches every tracked orb and empties the array", () => {
    const gameArea = new FakeElement("gameArea");
    const app = loadApp(gameArea);
    const first = attachOrb(app, gameArea);
    const second = attachOrb(app, gameArea);

    app.clearCircles();

    expect(app.circles).toHaveLength(0);
    expect(gameArea.children).toHaveLength(0);
    expect(first.element.parentNode).toBeNull();
    expect(second.element.parentNode).toBeNull();
  });

  it("sweeps orb elements that are no longer tracked", () => {
    const gameArea = new FakeElement("gameArea");
    const app = loadApp(gameArea);
    // A match pop mid-animation, plus an orb element whose circle entry has
    // already been spliced out: neither is reachable through `circles`.
    gameArea.appendChild(new FakeElement("matchPop"));
    gameArea.appendChild(new FakeElement("chordCircle"));

    app.clearCircles();

    expect(gameArea.children).toHaveLength(0);
  });

  it("leaves the decorative canvas in place", () => {
    const gameArea = new FakeElement("gameArea");
    const app = loadApp(gameArea);
    const canvas = new FakeElement("");
    gameArea.appendChild(canvas);
    attachOrb(app, gameArea);

    app.clearCircles();

    expect(gameArea.children).toEqual([canvas]);
  });

  it("does not throw when there is no play area", () => {
    const app = loadApp(null);
    const orphan = new FakeElement("chordCircle");
    app.circles.push({
      element: orphan,
      noteOrChordName: "C",
      noteOrChordNotes: ["C"],
      y: 0,
      speed: 1,
      destroyed: false,
      size: 150,
      xFraction: 0,
    });

    expect(() => app.clearCircles()).not.toThrow();
    expect(app.circles).toHaveLength(0);
  });
});

describe("endGame", () => {
  it("leaves the play area empty, so a restart cannot show dead orbs", () => {
    const gameArea = new FakeElement("gameArea");
    const app = loadApp(gameArea);
    app.gameRunning = true;
    attachOrb(app, gameArea);
    attachOrb(app, gameArea);

    app.endGame();

    expect(app.gameRunning).toBe(false);
    expect(app.circles).toHaveLength(0);
    expect(gameArea.children).toHaveLength(0);
  });
});
