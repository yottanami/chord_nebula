import { describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

// The setup screen's three selects narrow each other: genre decides which
// scales are on offer, scale decides which keys are. Getting that wrong
// strands the player on a combination the genre has no progressions for.

type ScaleName = "major" | "dorian" | "phrygian" | "lydian" | "mixolydian" | "minor" | "locrian";

interface FakeOption {
  value: string;
  innerText: string;
}

class FakeSelect {
  options: FakeOption[] = [];
  value = "";
  set innerHTML(html: string) {
    if (html === "") this.options = [];
  }
  appendChild(option: FakeOption) {
    this.options.push(option);
  }
  get values(): string[] {
    return this.options.map((o) => o.value);
  }
}

class FakeSpan {
  innerText = "";
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  children: FakeLink[] = [];
  appendChild(child: FakeLink) {
    this.children.push(child);
  }
}

class FakeLink {
  href = "";
  textContent = "";
}

interface App {
  populateGenreSelect(): void;
  populateScaleSelect(): void;
  populateKeySelect(): void;
  refreshSetupSelects(): void;
  renderContactEmail(): void;
  showMidiNotice(message: string): void;
  showSetupError(message: string): void;
  clearSetupError(): void;
  startGame(): Promise<void>;
  gameRunning: boolean;
  localStorage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
  getScalesForGenre(id: string): ScaleName[];
  chosenGenre: string;
  chosenMode: ScaleName;
  chosenKey: string;
  document: {
    getElementById: (id: string) => unknown;
    createElement: (tag: string) => unknown;
  };
}

function loadApp() {
  const app = loadAppPureLogic() as unknown as App;
  const elements: Record<string, FakeSelect | FakeSpan> = {
    genreSelect: new FakeSelect(),
    scaleSelect: new FakeSelect(),
    keySelect: new FakeSelect(),
    midiUnsupported: new FakeSpan(),
    setupError: new FakeSpan(),
    levelSelect: new FakeSelect(),
    startButton: new FakeSpan(),
    contactEmail: new FakeSpan(),
  };
  (elements.levelSelect as FakeSelect).value = "1"; // a free level
  app.document = {
    getElementById: (id: string) => elements[id] ?? null,
    createElement: (tag: string) => (tag === "a" ? new FakeLink() : { value: "", innerText: "" }),
  };
  return {
    app,
    genre: elements.genreSelect as FakeSelect,
    scale: elements.scaleSelect as FakeSelect,
    key: elements.keySelect as FakeSelect,
    notice: elements.midiUnsupported as FakeSpan,
    setupError: elements.setupError as FakeSpan,
    start: elements.startButton as FakeSpan & { disabled?: boolean },
    contact: elements.contactEmail as FakeSpan,
  };
}

describe("populateGenreSelect", () => {
  it("offers every genre and selects the current one", () => {
    const { app, genre } = loadApp();
    app.chosenGenre = "jazz";
    app.populateGenreSelect();
    expect(genre.values).toContain("pop");
    expect(genre.values).toContain("edm");
    expect(genre.value).toBe("jazz");
  });
});

describe("populateScaleSelect", () => {
  it("offers only the scales the chosen genre uses", () => {
    const { app, scale } = loadApp();
    app.chosenGenre = "blues";
    app.populateScaleSelect();
    expect(scale.values).toEqual(["mixolydian", "minor"]);
  });

  it("keeps the current scale when the new genre also uses it", () => {
    const { app, scale } = loadApp();
    app.chosenGenre = "pop";
    app.chosenMode = "minor";
    app.populateScaleSelect();
    expect(app.chosenMode).toBe("minor");
    expect(scale.value).toBe("minor");
  });

  it("moves off a scale the new genre does not have", () => {
    const { app } = loadApp();
    app.chosenGenre = "edm";
    app.chosenMode = "phrygian";
    app.populateScaleSelect();
    expect(app.chosenMode).toBe("phrygian");

    // Classical has no phrygian progressions, so staying there would leave
    // the game generating chords the genre never asked for.
    app.chosenGenre = "classical";
    app.populateScaleSelect();
    expect(app.getScalesForGenre("classical")).toContain(app.chosenMode);
  });
});

describe("populateKeySelect", () => {
  it("offers the keys that spell the chosen scale", () => {
    const { app, key } = loadApp();
    app.chosenMode = "major";
    app.populateKeySelect();
    expect(key.values.slice(0, 3)).toEqual(["C", "G", "D"]);
  });

  it("keeps the key you were in by pitch, across a change of scale", () => {
    const { app } = loadApp();
    app.chosenMode = "major";
    app.chosenKey = "Bb";
    app.populateKeySelect();
    expect(app.chosenKey).toBe("Bb");

    // Modes spell their tonics differently, so this has to match on pitch:
    // Bb dorian exists, but only as the 2nd degree of Ab major.
    app.chosenMode = "dorian";
    app.populateKeySelect();
    expect(app.chosenKey).toBe("Bb");
  });

  it("falls back to the first key when the old pitch has no spelling", () => {
    const { app, key } = loadApp();
    app.chosenMode = "major";
    app.chosenKey = "nonsense";
    app.populateKeySelect();
    expect(app.chosenKey).toBe(key.values[0]);
  });
});

describe("refreshSetupSelects", () => {
  it("leaves genre, scale and key on a combination that has progressions", () => {
    const { app, scale, key } = loadApp();
    for (const genreId of ["pop", "rock", "jazz", "blues", "classical", "folk", "funk", "edm"]) {
      app.chosenGenre = genreId;
      app.refreshSetupSelects();
      expect(app.getScalesForGenre(genreId)).toContain(app.chosenMode);
      expect(scale.values).toContain(app.chosenMode);
      expect(key.values).toContain(app.chosenKey);
    }
  });
});

describe("renderContactEmail", () => {
  it("assembles the address at runtime into a mailto link", () => {
    const { app, contact } = loadApp();
    contact.dataset = { user: "someone", domain: "example.com" };

    app.renderContactEmail();

    expect(contact.children).toHaveLength(1);
    expect(contact.children[0].textContent).toBe("someone@example.com");
    expect(contact.children[0].href).toBe("mailto:someone@example.com");
  });

  it("writes nothing when the parts are missing", () => {
    const { app, contact } = loadApp();
    contact.dataset = {};

    app.renderContactEmail();

    expect(contact.children).toHaveLength(0);
  });
});

describe("showSetupError", () => {
  it("puts the reason on the setup screen and takes it back down", () => {
    const { app, setupError } = loadApp();

    app.showSetupError("pick a keyboard");
    expect(setupError.innerText).toBe("pick a keyboard");
    expect(setupError.style.display).toBe("");

    app.clearSetupError();
    expect(setupError.innerText).toBe("");
    expect(setupError.style.display).toBe("none");
  });
});

describe("startGame without a keyboard", () => {
  it("explains itself on the page instead of starting", async () => {
    const { app, setupError } = loadApp();
    app.localStorage = { getItem: () => null, setItem: () => {} };

    await app.startGame();

    expect(app.gameRunning).toBe(false);
    expect(setupError.innerText).toContain("Select a MIDI keyboard");
  });
});

describe("showMidiNotice", () => {
  it("shows the reason and takes Start away", () => {
    const { app, notice, start } = loadApp();

    app.showMidiNotice("no Web MIDI here");

    expect(notice.innerText).toBe("no Web MIDI here");
    expect(notice.style.display).toBe("");
    expect(start.disabled).toBe(true);
  });
});
