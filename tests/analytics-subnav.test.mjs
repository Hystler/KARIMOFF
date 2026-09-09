import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync("src/components/admin/analytics/AnalyticsSubnav.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
}).outputText;

function harness(query = "") {
  let params = new URLSearchParams(query);
  const loadedModule = { exports: {} };
  runInNewContext(source, {
    module: loadedModule, exports: loadedModule.exports, URLSearchParams,
    require: (name) => {
      if (name === "next/navigation") return { useSearchParams: () => params };
      if (name === "next/link") return { __esModule: true, default: (props) => createElement("a", props) };
      if (name === "react/jsx-runtime") return require(name);
      throw new Error(`Unexpected import: ${name}`);
    }
  });
  return {
    render: (active) => renderToStaticMarkup(createElement(loadedModule.exports.AnalyticsSubnav, { active })),
    contents: () => renderToStaticMarkup(createElement(loadedModule.exports.AnalyticsOverviewContents)),
    navigate: (query) => { params = new URLSearchParams(query); }
  };
}

const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
const paths = ["/admin/analytics", "/admin/analytics/sales", "/admin/analytics/audience", "/admin/analytics/planning"];

test("all four pages show only real page links and exactly one current page", () => {
  const subject = harness();
  for (const [index, active] of ["overview", "sales", "audience", "planning"].entries()) {
    const html = subject.render(active);
    assert.deepEqual(hrefs(html), paths);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    assert.ok(html.includes(`href="${paths[index]}" class="is-active" aria-current="page"`));
    assert.doesNotMatch(html, /role="tab|Содержание обзора|href="#/);
  }
});

test("report navigation retains repeated filters but drops journal and display state", () => {
  const shared = "period=custom&from=2026-08-01&to=2026-08-31&compare=previous_year&channel=pos_evotor&location=l1&terminal=t1&employee=e1&payment=cash&provider=evotor&category=Бургеры&category=Шаурма&product=p1&weekday=1&weekday=6&hourFrom=17&hourTo=21";
  const journal = "&sale=s1&page=8&pageSize=100&sort=net&direction=asc&search=заказ&metric=items&ranking=growth&days=14&history=84&buffer=3";
  const subject = harness(shared + journal);
  const links = hrefs(subject.render("sales"));
  for (const index of [0, 2]) {
    assert.deepEqual([...new URL(links[index], "https://example.test").searchParams], [...new URLSearchParams(shared)]);
  }
  assert.equal(new URL(links[1], "https://example.test").search, `?${new URLSearchParams(shared + journal)}`);
  assert.equal(links[3], paths[3]);
  subject.navigate("period=7d&location=l2&category=Десерты");
  assert.equal(new URL(hrefs(subject.render("overview"))[1], "https://example.test").searchParams.get("location"), "l2");
});

test("planning options stay on planning and do not become report filters", () => {
  const links = hrefs(harness("days=14&history=84&buffer=3").render("planning"));
  assert.deepEqual(links.slice(0, 3), paths.slice(0, 3));
  assert.equal(links[3], `${paths[3]}?days=14&history=84&buffer=3`);
});

test("overview contents use existing fragment targets without losing the current query", () => {
  const html = harness().contents();
  assert.match(html, /aria-label="Содержание обзора"/);
  assert.doesNotMatch(html, /is-active|aria-current|role="tab|analytics-subnav/);
  const overview = readFileSync("src/components/admin/analytics/AnalyticsOverview.tsx", "utf8");
  const hub = readFileSync("src/components/admin/analytics/AnalyticsIntelligenceHub.tsx", "utf8");
  assert.match(overview, /<AnalyticsOverviewContents\s*\/>/);
  const anchors = hrefs(html);
  assert.equal(anchors.length, 6);
  const current = new URL("https://example.test/admin/analytics?period=7d&category=A&category=B");
  for (const href of anchors) {
    assert.ok(href.startsWith("#"));
    assert.ok((overview + hub).includes(`id="${href.slice(1)}"`), `Missing target ${href}`);
    const destination = new URL(href, current);
    assert.equal(destination.pathname, current.pathname);
    assert.equal(destination.search, current.search);
  }
});
