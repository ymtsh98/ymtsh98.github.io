const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "js", "grid.js"), "utf8");
const deterministicMath = Object.create(Math);

deterministicMath.random = () => 0;

test("restore grid uses CSS viewport coordinates instead of canvas backing pixels", () => {
  const lines = [];
  let queuedFrame;
  const canvas = { width: 192, height: 128 };
  const context = {
    beginPath() {},
    lineTo() {},
    moveTo(x, y) {
      lines.push([x, y]);
    },
    stroke() {}
  };
  const sandbox = {
    Math: deterministicMath,
    document: { documentElement: {} },
    getComputedStyle: () => ({
      getPropertyValue(name) {
        return {
          "--grid-size": "32px",
          "--grid-offset-x": "0px",
          "--grid-offset-y": "0px",
          "--grid-line-restore": "rgba(78, 111, 149, 0.5)"
        }[name] || "";
      }
    }),
    performance: { now: () => 0 },
    requestAnimationFrame(callback) {
      queuedFrame = callback;
      return 1;
    },
    cancelAnimationFrame() {},
    window: { scrollX: 0, scrollY: 0 }
  };

  vm.runInNewContext(script, sandbox, { filename: "grid.js" });
  sandbox.window.gridPaper.writeOnCanvas(canvas, context, {
    duration: 600,
    width: 96,
    height: 64,
    scrollX: 10,
    scrollY: 18
  });
  queuedFrame(600);

  assert.deepEqual(
    lines.filter(([, y]) => y === 0).map(([x]) => x),
    [-9.5, 22.5, 54.5, 86.5]
  );
  assert.deepEqual(
    lines.filter(([x]) => x === 0).map(([, y]) => y),
    [-17.5, 14.5, 46.5]
  );
});
