import test from "node:test";
import assert from "node:assert/strict";
import { compareSemver } from "./updater-store.ts";

test("compareSemver 正确对比主次补丁版本", () => {
  assert.equal(compareSemver("1.1.9", "1.1.8"), 1);
  assert.equal(compareSemver("1.1.8", "1.1.9"), -1);
  assert.equal(compareSemver("1.1.8", "1.1.8"), 0);

  // 带 'v' 前缀
  assert.equal(compareSemver("v1.2.0", "1.1.8"), 1);
  assert.equal(compareSemver("1.1.8", "v1.2.0"), -1);
  assert.equal(compareSemver("v2.0.0", "v1.9.9"), 1);

  // 位数不足补零
  assert.equal(compareSemver("1.2", "1.1.9"), 1);
  assert.equal(compareSemver("1.1", "1.1.0"), 0);
});
