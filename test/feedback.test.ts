import { describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

// Minimal fake DOM: just enough for flashMatch/flashMiss to operate
// against a #gameArea element (classList + appendChild), matching the
// same "no real document, no crash" approach bugfixes.test.ts uses.

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
  style: Record<string, string> = {};
  classList = new FakeClassList();
  parentNode: FakeElement | null = null;
  children: FakeElement[] = [];
  appendChild(child: FakeElement) {
    child.parentNode = this;
    this.children.push(child);
  }
  removeChild(child: FakeElement) {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
  }
}

interface App {
  flashMatch(circleElement: { style: { left: string; top: string } }): void;
  flashMiss(): void;
  playMissSound(): void;
  document: {
    getElementById: (id: string) => FakeElement | null;
    createElement: (tag: string) => FakeElement;
  };
  AudioContext: new () => unknown;
  setTimeout: (fn: () => void, ms: number) => number;
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

function loadApp() {
  const app = loadAppPureLogic() as unknown as App;
  const gameArea = new FakeElement();
  app.document = {
    getElementById: (id: string) => (id === "gameArea" ? gameArea : null),
    createElement: () => new FakeElement(),
  };
  app.AudioContext = FakeAudioContext as unknown as new () => unknown;
  // Captures the scheduled cleanup instead of running it immediately, so
  // tests can assert the "flash is showing" state before firing it
  // themselves and asserting the "cleaned up" state after -- running it
  // synchronously would make both states identical and prove nothing.
  const pendingTimeouts: Array<() => void> = [];
  app.setTimeout = ((fn: () => void) => {
    pendingTimeouts.push(fn);
    return pendingTimeouts.length;
  }) as unknown as App["setTimeout"];
  const runPendingTimeout = () => {
    const fn = pendingTimeouts.shift();
    if (fn) fn();
  };
  return { app, gameArea, runPendingTimeout };
}

describe("flashMatch", () => {
  it("adds a positioned matchPop element, then removes it after the animation window", () => {
    const { app, gameArea, runPendingTimeout } = loadApp();
    app.flashMatch({ style: { left: "42px", top: "7px" } });

    expect(gameArea.children).toHaveLength(1);
    expect(gameArea.children[0].className).toBe("matchPop");
    expect(gameArea.children[0].style.left).toBe("42px");
    expect(gameArea.children[0].style.top).toBe("7px");

    runPendingTimeout();
    expect(gameArea.children).toHaveLength(0);
  });
});

describe("flashMiss", () => {
  it("adds the missFlash class, then removes it after the animation window", () => {
    const { app, gameArea, runPendingTimeout } = loadApp();
    app.flashMiss();

    expect(gameArea.classList.contains("missFlash")).toBe(true);

    runPendingTimeout();
    expect(gameArea.classList.contains("missFlash")).toBe(false);
  });
});

describe("playMissSound", () => {
  it("does not throw without a real AudioContext", () => {
    const { app } = loadApp();
    expect(() => app.playMissSound()).not.toThrow();
  });
});
