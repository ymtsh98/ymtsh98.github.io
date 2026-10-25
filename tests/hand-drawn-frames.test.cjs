const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "js", "hand-drawn-frames.js"), "utf8");

const createHarness = (canvasRect) => {
  const points = [];
  const viewportListeners = new Map();
  const frames = new Map();
  let frameId = 0;
  let transform = [1, 0, 0, 1, 0, 0];
  const recordPoint = (x, y) => {
    const [a, b, c, d, e, f] = transform;
    points.push([a * x + c * y + e, b * x + d * y + f]);
  };
  const context = {
    beginPath() {},
    clearRect() {},
    lineTo: recordPoint,
    moveTo: recordPoint,
    restore() {},
    save() {},
    setTransform(...values) {
      transform = values;
    },
    stroke() {}
  };
  const canvas = {
    getBoundingClientRect: () => canvasRect,
    getContext: () => context
  };
  const button = {
    closest: () => null,
    getBoundingClientRect: () => ({ left: 40, top: 120, right: 200, bottom: 152 }),
    matches: () => true
  };
  const styles = {
    visibility: "visible",
    zIndex: "3",
    getPropertyValue: () => "#263f56"
  };
  const sandbox = {
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    document: {
      body: { classList: { add() {} } },
      documentElement: {},
      querySelector: () => canvas,
      querySelectorAll: selector => selector === "[data-frame-surface]" ? [] : [button]
    },
    getComputedStyle: () => styles,
    MutationObserver: class {
      observe() {}
    },
    performance: { now: () => 0 },
    requestAnimationFrame(callback) {
      frames.set(++frameId, callback);
      return frameId;
    },
    window: {
      innerWidth: 390,
      innerHeight: 844,
      devicePixelRatio: 2,
      addEventListener() {},
      visualViewport: {
        addEventListener(type, listener) {
          viewportListeners.set(type, listener);
        }
      }
    }
  };
  vm.runInNewContext(script, sandbox, { filename: "hand-drawn-frames.js" });
  return { canvas, frames, points, viewportListeners };
};

for (const [name, canvasRect] of [
  ["normal viewport", { left: 0, top: 0, width: 390, height: 844 }],
  ["canvas size differs from window size", { left: 0, top: 0, width: 195, height: 422 }],
  ["zoomed viewport has an offset", { left: -35, top: -90, width: 390, height: 844 }]
]) {
  test(`button frame aligns with the button when ${name}`, () => {
    const { canvas, points } = createHarness(canvasRect);
    const [[x, y]] = points;
    const screenX = canvasRect.left + x * canvasRect.width / canvas.width;
    const screenY = canvasRect.top + y * canvasRect.height / canvas.height;
    assert.ok(screenX >= 40 && screenX <= 48);
    assert.ok(Math.abs(screenY - 122) < 1);
  });
}

test("panning the zoomed visual viewport redraws the button frame", () => {
  const harness = createHarness({ left: 0, top: 0, width: 390, height: 844 });
  const previousPointCount = harness.points.length;
  harness.viewportListeners.get("scroll")?.();
  assert.equal(harness.frames.size, 1);
  [...harness.frames.values()][0]();
  assert.ok(harness.points.length > previousPointCount);
});
