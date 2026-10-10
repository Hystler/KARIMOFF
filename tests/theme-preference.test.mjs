import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function mountTheme({ saved = null, systemDark = false, storageBlocked = false } = {}) {
  const effects = [];
  const attributes = {};
  const listeners = new Map();
  const writes = [];
  const react = {
    createContext: () => ({ Provider: "provider" }),
    useCallback: (callback) => callback,
    useContext: () => null,
    useEffect: (effect) => effects.push(effect),
    useMemo: (factory) => factory(),
    useState: (initial) => [initial, () => {}]
  };
  const window = {
    localStorage: {
      getItem: () => { if (storageBlocked) throw new Error("Storage denied"); return saved; },
      setItem: (key, value) => { if (storageBlocked) throw new Error("Storage denied"); writes.push([key, value]); }
    },
    matchMedia: () => ({ matches: systemDark, addEventListener: () => {}, removeEventListener: () => {} }),
    setTimeout: (callback) => { callback(); return 1; }, clearTimeout: () => {},
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name)
  };
  const document = { documentElement: { setAttribute: (name, value) => { attributes[name] = value; } } };
  const compiled = ts.transpileModule(readFileSync("src/components/theme/ThemeProvider.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const exports = {};
  new Function("require", "exports", "window", "document", compiled)((id) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }) };
    throw new Error(`Unexpected import ${id}`);
  }, exports, window, document);
  const result = exports.ThemeProvider({ defaultTheme: "light", children: "content" });
  const cleanup = effects.map((effect) => effect());
  return { attributes, listeners, writes, toggle: result.props.value.toggleTheme, cleanup };
}

test("saved preference wins over device theme and follows other tabs", () => {
  const theme = mountTheme({ saved: "dark" });
  assert.equal(theme.attributes["data-theme"], "dark");
  theme.listeners.get("storage")({ key: "karimoff_theme_preference_v2", newValue: "light" });
  assert.equal(theme.attributes["data-theme"], "light");
  theme.listeners.get("storage")({ key: "unrelated", newValue: "dark" });
  assert.equal(theme.attributes["data-theme"], "light");
  theme.cleanup.forEach((cleanup) => cleanup?.());
  assert.ok(!theme.listeners.has("storage"));
});

test("invalid or removed preferences resume device theme", () => {
  const theme = mountTheme({ saved: "invalid", systemDark: true });
  assert.equal(theme.attributes["data-theme"], "dark");
  theme.listeners.get("storage")({ key: "karimoff_theme_preference_v2", newValue: null });
  assert.equal(theme.attributes["data-theme"], "dark");
});

test("storage denial cannot crash hydration or prevent a theme change", () => {
  const theme = mountTheme({ storageBlocked: true });
  assert.equal(theme.attributes["data-theme"], "light");
  assert.doesNotThrow(theme.toggle);
  assert.equal(theme.attributes["data-theme"], "dark");
});

test("manual theme writes the existing preference key", () => {
  const theme = mountTheme();
  theme.toggle();
  assert.deepEqual(theme.writes, [["karimoff_theme_preference_v2", "dark"]]);
});
