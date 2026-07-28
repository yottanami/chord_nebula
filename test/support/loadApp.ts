// src/app.ts is a single, un-bundled classic script (no import/export —
// it's loaded via a plain <script> tag, not type="module") with hundreds
// of lines of top-level game/chord logic followed by DOM/MIDI wiring that
// runs immediately on load. There's nothing to `import` from it directly.
//
// Rather than restructure the app (out of scope for just adding test
// tooling) or duplicate its logic into a second file that could drift out
// of sync, this loads the *real* src/app.ts, cuts it at the sentinel
// comment app.ts itself defines ("Pure logic ends here..."), transpiles
// that slice with the TypeScript compiler API, and runs it in a fresh
// Node `vm` context. Every top-level `function`/`let`/`const` declared
// above the marker becomes a property on the returned sandbox object, so
// tests can call e.g. `loadAppPureLogic().matchesLevel4(...)` and read/
// write shared state like `sandbox.noteOnStack` directly, the same way
// the real functions read/write it as module-scope variables.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_SOURCE_PATH = resolve(__dirname, "../../src/app.ts");
const PURE_LOGIC_END_MARKER = "// --- Pure logic ends here";

let cachedTranspiledSource: string | null = null;

function getTranspiledPureLogic(): string {
  if (cachedTranspiledSource) return cachedTranspiledSource;

  const source = readFileSync(APP_SOURCE_PATH, "utf-8");
  const markerIndex = source.indexOf(PURE_LOGIC_END_MARKER);
  if (markerIndex === -1) {
    throw new Error(
      `test/support/loadApp.ts: could not find the pure-logic boundary marker ` +
        `(${JSON.stringify(PURE_LOGIC_END_MARKER)}) in src/app.ts. If that comment ` +
        `was moved or reworded, update PURE_LOGIC_END_MARKER here to match.`,
    );
  }

  // Target ES5, not ES2015: Node's `vm` context object only exposes
  // top-level `var`/function declarations as properties (a well-known vm
  // quirk -- `let`/`const` bindings live in a separate lexical
  // environment invisible to the context object). ES5 downlevels the
  // app's top-level `let`s to `var`, which is what makes assigning
  // `sandbox.noteOnStack = [...]` etc. actually reach the functions that
  // read them below.
  const { outputText, diagnostics } = ts.transpileModule(source.slice(0, markerIndex), {
    compilerOptions: {
      target: ts.ScriptTarget.ES5,
      // Without this, ES5's `for...of` downlevel assumes its target is
      // array-like (uses `.length` + index access) instead of going
      // through a real iterator -- silently wrong (loop body never runs)
      // for `for (const x of someSet)`, which this file uses.
      downlevelIteration: true,
    },
    reportDiagnostics: true,
  });
  const fatal = (diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (fatal.length > 0) {
    const messages = fatal.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    throw new Error(`test/support/loadApp.ts: failed to transpile src/app.ts:\n${messages.join("\n")}`);
  }

  cachedTranspiledSource = outputText;
  return outputText;
}

export type AppSandbox = Record<string, unknown>;

/**
 * Runs the pure-logic slice of src/app.ts in a fresh vm context and
 * returns the resulting global object. Fresh per call — the app's chord/
 * game logic relies on shared mutable module state (`noteOnStack`,
 * `chosenKey`, `selectedLevel`, ...), so tests get an isolated sandbox
 * each time rather than leaking state between them.
 */
export function loadAppPureLogic(): AppSandbox {
  const sandbox: AppSandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(getTranspiledPureLogic(), sandbox);
  return sandbox;
}
