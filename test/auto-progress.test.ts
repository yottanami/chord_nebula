import { beforeEach, describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

// The ramp is driven entirely by `score` (see difficulty-ramp.test.ts), so
// persisting "Auto-mode progress" (ideas#211) just means persisting the
// highest score reached and starting the next run from it -- there's no
// separate stage/progress variable that could drift out of sync with score.

interface App {
  AUTO_PROGRESS_STORAGE_KEY: string;
  loadSavedProgress(): number;
  saveProgress(currentScore: number): void;
  resetProgress(): void;
  updateScore(): void;
  score: number;
  localStorage: {
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
    removeItem: (k: string) => void;
  };
  document: { getElementById: (id: string) => null };
}

function createFakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

function loadApp(): App {
  const app = loadAppPureLogic() as unknown as App;
  app.localStorage = createFakeLocalStorage();
  // updateScore() looks up 'scoreDisplay' before calling saveProgress();
  // a no-op stub is enough since these tests don't assert on the HUD.
  app.document = { getElementById: () => null };
  return app;
}

describe("Auto-mode progress persistence", () => {
  let app: App;

  beforeEach(() => {
    app = loadApp();
  });

  it("has nothing saved on a first run", () => {
    expect(app.loadSavedProgress()).toBe(0);
  });

  it("ignores garbage/negative stored values as if nothing were saved", () => {
    app.localStorage.setItem(app.AUTO_PROGRESS_STORAGE_KEY, "not-a-number");
    expect(app.loadSavedProgress()).toBe(0);

    app.localStorage.setItem(app.AUTO_PROGRESS_STORAGE_KEY, "-5");
    expect(app.loadSavedProgress()).toBe(0);
  });

  it("saves a new best score", () => {
    app.saveProgress(14);
    expect(app.loadSavedProgress()).toBe(14);
  });

  it("never lowers the saved best from a worse run", () => {
    app.saveProgress(36);
    app.saveProgress(6);
    expect(app.loadSavedProgress()).toBe(36);
  });

  it("raises the saved best when a later run beats it", () => {
    app.saveProgress(6);
    app.saveProgress(24);
    expect(app.loadSavedProgress()).toBe(24);
  });

  it("clears the saved value on reset", () => {
    app.saveProgress(24);
    app.resetProgress();
    expect(app.loadSavedProgress()).toBe(0);
  });

  it("persists automatically as score updates during play", () => {
    app.score = 14;
    app.updateScore();
    expect(app.loadSavedProgress()).toBe(14);
  });

  it("survives storage being unavailable instead of throwing", () => {
    app.localStorage = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
      removeItem: () => {
        throw new Error("storage disabled");
      },
    };
    expect(() => app.loadSavedProgress()).not.toThrow();
    expect(app.loadSavedProgress()).toBe(0);
    expect(() => app.saveProgress(10)).not.toThrow();
    expect(() => app.resetProgress()).not.toThrow();
  });
});
