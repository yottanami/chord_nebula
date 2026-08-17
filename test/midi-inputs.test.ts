import { describe, expect, it } from "vitest";
import { loadAppPureLogic } from "./support/loadApp";

// ALSA on Linux always publishes a "Midi Through Port-0" loopback. It sat in
// the device dropdown next to real keyboards, carried no input, and picking
// it produced a game that never responded to anything.

interface FakeOption {
  value: string;
  innerText: string;
}

class FakeSelect {
  options: FakeOption[] = [];
  set innerHTML(value: string) {
    if (value === "") this.options = [];
  }
  appendChild(option: FakeOption) {
    this.options.push(option);
  }
}

interface App {
  isUsableMidiInputName(name: string): boolean;
  isValidMidiInput(options: FakeOption[] | undefined): boolean;
  populateMIDIInputs(): void;
  midiAccess: { inputs: Map<string, { id: string; name: string }> };
  document: {
    getElementById: (id: string) => FakeSelect | null;
    createElement: (tag: string) => FakeOption;
  };
}

function loadApp(devices: Array<{ id: string; name: string }> = []) {
  const app = loadAppPureLogic() as unknown as App;
  const select = new FakeSelect();
  app.document = {
    getElementById: (id: string) => (id === "midiSelect" ? select : null),
    createElement: () => ({ value: "", innerText: "" }),
  };
  app.midiAccess = { inputs: new Map(devices.map((d) => [d.id, d])) };
  return { app, select };
}

describe("isUsableMidiInputName", () => {
  it("rejects the ALSA loopback port under the spellings drivers use", () => {
    const { app } = loadApp();
    expect(app.isUsableMidiInputName("Midi Through Port-0")).toBe(false);
    expect(app.isUsableMidiInputName("Midi Through:0")).toBe(false);
    expect(app.isUsableMidiInputName("MIDI THROUGH")).toBe(false);
    expect(app.isUsableMidiInputName("MidiThrough Port-1")).toBe(false);
  });

  it("keeps real devices, including ones that merely contain 'through'", () => {
    const { app } = loadApp();
    expect(app.isUsableMidiInputName("Yamaha P-45")).toBe(true);
    expect(app.isUsableMidiInputName("MPK Mini mk3")).toBe(true);
    expect(app.isUsableMidiInputName("Through The Fire Keys")).toBe(true);
  });
});

describe("populateMIDIInputs", () => {
  it("lists real keyboards and drops the loopback port", () => {
    const { app, select } = loadApp([
      { id: "through", name: "Midi Through Port-0" },
      { id: "yamaha", name: "Yamaha P-45" },
    ]);

    app.populateMIDIInputs();

    expect(select.options).toHaveLength(1);
    expect(select.options[0].innerText).toBe("Yamaha P-45");
    expect(select.options[0].value).toBe("yamaha");
    expect(app.isValidMidiInput(select.options)).toBe(true);
  });

  it("shows an unselectable placeholder when the loopback is all there is", () => {
    const { app, select } = loadApp([{ id: "through", name: "Midi Through Port-0" }]);

    app.populateMIDIInputs();

    expect(select.options).toHaveLength(1);
    expect(select.options[0].innerText).toBe("No MIDI keyboard found");
    // The whole point of the empty value: without it the placeholder would
    // read as a valid device and the game would start with no input.
    expect(select.options[0].value).toBe("");
    expect(app.isValidMidiInput(select.options)).toBe(false);
  });

  it("shows the same placeholder when there are no devices at all", () => {
    const { app, select } = loadApp([]);

    app.populateMIDIInputs();

    expect(select.options).toHaveLength(1);
    expect(app.isValidMidiInput(select.options)).toBe(false);
  });

  it("says something before MIDI access has been granted", () => {
    const { app, select } = loadApp([]);
    // Access can sit pending on a permission prompt for as long as the
    // player takes to answer it; an empty box explains nothing.
    (app as unknown as { midiAccess: null }).midiAccess = null;

    app.populateMIDIInputs();

    expect(select.options).toHaveLength(1);
    expect(select.options[0].innerText).toBe("No MIDI keyboard found");
    expect(app.isValidMidiInput(select.options)).toBe(false);
  });

  it("replaces the previous list rather than appending to it", () => {
    const { app, select } = loadApp([{ id: "yamaha", name: "Yamaha P-45" }]);

    app.populateMIDIInputs();
    app.populateMIDIInputs();

    expect(select.options).toHaveLength(1);
  });
});

describe("isValidMidiInput", () => {
  it("is false for an empty or missing list", () => {
    const { app } = loadApp();
    expect(app.isValidMidiInput(undefined)).toBe(false);
    expect(app.isValidMidiInput([])).toBe(false);
  });

  it("is true as soon as one option carries a device id", () => {
    const { app } = loadApp();
    expect(
      app.isValidMidiInput([
        { value: "", innerText: "No MIDI keyboard found" },
        { value: "yamaha", innerText: "Yamaha P-45" },
      ]),
    ).toBe(true);
  });
});
