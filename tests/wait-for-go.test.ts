import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isGoCommand, DEFAULT_GO_COMMANDS } from "../scripts/lib/wait-for-go.js";

describe("waitForGo", () => {
  it("accepts go, start, and capture (case insensitive)", () => {
    for (const cmd of DEFAULT_GO_COMMANDS) {
      assert.equal(isGoCommand(cmd), true);
      assert.equal(isGoCommand(cmd.toUpperCase()), true);
    }
  });

  it("rejects other input", () => {
    assert.equal(isGoCommand("wait"), false);
    assert.equal(isGoCommand(""), false);
  });
});
