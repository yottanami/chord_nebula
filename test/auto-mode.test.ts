import { describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

interface App {
  applyAutoRamp(): void;
  score: number;
  selectedLevel: number;
  showNotes: boolean;
  showFunctions: boolean;
  autoModeUnlocked: boolean;
}

function loadApp(): App {
  return loadAppPureLogic() as unknown as App;
}

describe("Auto mode difficulty ramp", () => {
  it("starts at stage 0: level 3, notes and functions shown", () => {
    const app = loadApp();
    app.score = 0;
    app.applyAutoRamp();
    expect(app.selectedLevel).toBe(3);
    expect(app.showNotes).toBe(true);
    expect(app.showFunctions).toBe(true);
  });

  it("hides notes but keeps functions once score reaches the second stage", () => {
    const app = loadApp();
    app.autoModeUnlocked = true;
    app.score = 6;
    app.applyAutoRamp();
    expect(app.selectedLevel).toBe(4);
    expect(app.showNotes).toBe(false);
    expect(app.showFunctions).toBe(true);
  });

  it("hides both notes and functions and steps up chord complexity at later stages", () => {
    const app = loadApp();
    app.autoModeUnlocked = true;
    app.score = 14;
    app.applyAutoRamp();
    expect(app.selectedLevel).toBe(6);
    expect(app.showNotes).toBe(false);
    expect(app.showFunctions).toBe(false);
  });

  it("never regresses to an earlier stage as score keeps climbing", () => {
    const app = loadApp();
    app.autoModeUnlocked = true;
    app.score = 100;
    app.applyAutoRamp();
    expect(app.selectedLevel).toBe(7);
  });

  it("clamps to the free level cap when the paid unlock hasn't been purchased", () => {
    const app = loadApp();
    app.autoModeUnlocked = false;
    app.score = 24; // stage level would be 7, a paid level
    app.applyAutoRamp();
    expect(app.selectedLevel).toBe(3); // FREE_LEVEL_MAX
  });

  it("advances into paid levels once the license key has been verified", () => {
    const app = loadApp();
    app.autoModeUnlocked = true;
    app.score = 24;
    app.applyAutoRamp();
    expect(app.selectedLevel).toBe(7);
  });
});
