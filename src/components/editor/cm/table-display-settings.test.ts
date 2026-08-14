import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTableWidthMode,
  createTableDisplaySettings,
  mapTableDisplaySettings,
  tableWidthModeFor,
} from "./table-display-settings.ts";

test("global table width mode is the default for tables without overrides", () => {
  const settings = applyTableWidthMode(createTableDisplaySettings(), { scope: "global", mode: "window" });

  assert.equal(tableWidthModeFor(settings, 10), "window");
});

test("a table width override does not change the global default", () => {
  const settings = applyTableWidthMode(createTableDisplaySettings("content"), {
    scope: "table",
    tableFrom: 42,
    mode: "window",
  });

  assert.equal(tableWidthModeFor(settings, 42), "window");
  assert.equal(tableWidthModeFor(settings, 99), "content");
});

test("a global width change updates every table by clearing table overrides", () => {
  let settings = applyTableWidthMode(createTableDisplaySettings("content"), {
    scope: "table",
    tableFrom: 42,
    mode: "window",
  });
  settings = applyTableWidthMode(settings, {
    scope: "table",
    tableFrom: 99,
    mode: "window",
  });
  settings = applyTableWidthMode(settings, { scope: "global", mode: "content" });

  assert.equal(settings.widthModeOverrides.size, 0);
  assert.equal(tableWidthModeFor(settings, 42), "content");
  assert.equal(tableWidthModeFor(settings, 99), "content");
});

test("table width overrides follow their table when document positions move", () => {
  const settings = applyTableWidthMode(createTableDisplaySettings(), {
    scope: "table",
    tableFrom: 42,
    mode: "window",
  });
  const mapped = mapTableDisplaySettings(settings, (position) => position + 8);

  assert.equal(tableWidthModeFor(mapped, 50), "window");
  assert.equal(tableWidthModeFor(mapped, 42), "content");
});
