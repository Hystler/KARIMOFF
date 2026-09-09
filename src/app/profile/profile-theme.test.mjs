import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const stylesheet = postcss.parse(readFileSync(new URL("./profile-theme.css", import.meta.url), "utf8"));

function declarations(selector) {
  const values = {};
  stylesheet.walkRules(selector, (rule) => {
    rule.walkDecls((declaration) => { values[declaration.prop] = declaration.value; });
  });
  return values;
}

function contrast(first, second) {
  const luminance = (hex) => {
    assert.match(hex, /^#[\da-f]{6}$/i);
    const channels = hex.slice(1).match(/../g).map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const theme of ["light", "dark"]) {
  const tokens = {
    ...declarations(".profile-theme"),
    ...(theme === "dark" ? declarations('html[data-theme="dark"] .profile-theme') : {})
  };
  const color = (name) => tokens[`--profile-${name}`];

  test(`${theme}: profile text and editor states meet normal-text contrast`, () => {
    const pairs = [
      ...["background", "surface", "panel", "hover", "accent-soft"].flatMap((surface) =>
        ["text", "muted", "accent"].map((foreground) => [foreground, surface])),
      ["on-action", "action"], ["on-action", "action-hover"],
      ["on-selected", "selected"],
      ["success", "surface"], ["success", "success-soft"],
      ["danger", "surface"], ["danger", "danger-soft"],
      ["warning", "surface"]
    ];
    for (const [foreground, background] of pairs) {
      assert.ok(contrast(color(foreground), color(background)) >= 4.5,
        `${theme}: ${foreground} on ${background} must reach 4.5:1`);
    }
  });

  test(`${theme}: swatch boundaries and focus accents remain distinguishable`, () => {
    for (const background of ["surface", "panel", "hover", "accent-soft"]) {
      for (const foreground of ["control-border", "accent"]) {
        assert.ok(contrast(color(foreground), color(background)) >= 3,
          `${theme}: ${foreground} on ${background} must reach 3:1`);
      }
    }
  });

  test(`${theme}: compact provider controls preserve readable branded colors`, () => {
    for (const provider of ["telegram", "max"]) {
      const selector = `.profile-theme [data-profile-provider="${provider}"]`;
      const values = {
        ...declarations(selector),
        ...(theme === "dark" ? declarations(`html[data-theme="dark"] ${selector}`) : {})
      };
      assert.ok(contrast(values["--profile-provider-text"], color("surface")) >= 4.5);
      assert.ok(contrast("#ffffff", values["--profile-provider-hover"]) >= 4.5);
    }
  });
}

test("profile styles stay scoped without overriding palette fills or using important", () => {
  stylesheet.walkRules((rule) => {
    for (const selector of rule.selectors) assert.ok(selector.includes(".profile-theme"));
    rule.walkDecls((declaration) => {
      assert.equal(Boolean(declaration.important), false);
      if (rule.selector.includes(".avatar-swatch")) {
        assert.ok(!["background", "background-color", "filter", "opacity"].includes(declaration.prop));
      }
    });
  });
});
