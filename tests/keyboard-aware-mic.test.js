import { test } from "node:test";
import assert from "node:assert/strict";
import { keyboardMicTop } from "../src/keyboard-aware-mic.js";

test("microphone stays in its default fixed-bottom position without a software keyboard", () => {
  assert.equal(keyboardMicTop({ baselineHeight: 844, visibleHeight: 844 }), null);
  assert.equal(keyboardMicTop({ baselineHeight: 844, visibleHeight: 785 }), null);
  assert.equal(keyboardMicTop({ baselineHeight: 844, visibleHeight: 844, offsetTop: 24 }), null);
});

test("microphone rises just above iPhone keyboard without obscuring caret area", () => {
  assert.equal(keyboardMicTop({
    baselineHeight: 844, visibleHeight: 435, offsetTop: 0,
    buttonHeight: 55, margin: 14,
  }), 366);
  assert.equal(keyboardMicTop({
    baselineHeight: 844, visibleHeight: 400, offsetTop: 92,
    buttonHeight: 55, margin: 14,
  }), 423);
  assert.equal(keyboardMicTop({
    baselineHeight: 430, visibleHeight: 205, offsetTop: 18,
    buttonHeight: 55, margin: 14,
  }), 154);
});

test("invalid viewport measurements never move the microphone off-screen", () => {
  assert.equal(keyboardMicTop({ baselineHeight: 0, visibleHeight: 0 }), null);
  assert.equal(keyboardMicTop({ baselineHeight: NaN, visibleHeight: 400 }), null);
  assert.equal(keyboardMicTop({ baselineHeight: 844, visibleHeight: 0 }), null);
  assert.equal(keyboardMicTop({
    baselineHeight: 844, visibleHeight: 45, offsetTop: 300,
    buttonHeight: 55, margin: 14,
  }), 308);
});
