import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

export function loadTypeScript(file, imports = {}) {
  const path = resolve(file);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText;
  const exports = {};
  new Function('require', 'exports', 'process', code)(id => {
    if (id === "@/lib/product-edition") return loadTypeScript("src/lib/product-edition.ts", imports);
    if (id in imports) return imports[id];
    if (id.startsWith('.')) {
      const target = resolve(dirname(path), id);
      return id.endsWith('.json') ? JSON.parse(readFileSync(target, 'utf8')) : loadTypeScript(`${target}.ts`, imports);
    }
    throw new Error(`Unexpected test import ${id}`);
  }, exports, { env: new Proxy(process.env, { get: (target, key) => key === "KARIMOFF_EDITION" ? (target[key] ?? "full") : target[key] }) });
  return exports;
}
