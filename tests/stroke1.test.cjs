const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "js", "stroke1.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "css", "stroke1.css"), "utf8");

const createHarness = () => {
  const backgroundCalls = [];
  const listeners = new Map();
  const bodyClasses = new Set();
  const image = {
    dataset: { strokeHoverSrc: "images/2026/stroke1.webp" },
    src: "images/2026/stroke1.png",
    getAttribute(name) {
      return name === "src" ? this.src : undefined;
    }
  };
  const tile = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    querySelector(selector) {
      return selector === ".stroke1" ? image : undefined;
    }
  };
  const document = {
    body: {
      classList: {
        add(name) {
          bodyClasses.add(name);
        },
        remove(name) {
          bodyClasses.delete(name);
        }
      }
    },
    querySelectorAll(selector) {
      return selector === ".stroke1Tile" ? [tile] : [];
    }
  };

  vm.runInNewContext(script, {
    document,
    Image: class {
      set src(value) {
        this.currentSrc = value;
      }
    },
    window: {
      siteBackgroundEffects: {
        cancelGridRestore() {
          backgroundCalls.push(["cancel"]);
        },
        restoreGridFromColor(color) {
          backgroundCalls.push(["restore", color]);
        }
      }
    }
  }, { filename: "stroke1.js" });

  return { backgroundCalls, bodyClasses, image, listeners };
};

test("hover switches both the site background and the stroke image", () => {
  const harness = createHarness();

  harness.listeners.get("mouseenter")();
  assert.ok(harness.bodyClasses.has("stroke1Active"));
  assert.equal(harness.image.src, "images/2026/stroke1.webp");
  assert.deepEqual(harness.backgroundCalls, [["cancel"]]);

  harness.listeners.get("mouseleave")();
  assert.ok(!harness.bodyClasses.has("stroke1Active"));
  assert.equal(harness.image.src, "images/2026/stroke1.png");
  assert.deepEqual(harness.backgroundCalls, [
    ["cancel"],
    ["restore", "#ffffff"]
  ]);
});

test("only the hovered page state receives the white background", () => {
  assert.match(
    styles,
    /body\.stroke1Active\s*\{[^}]*background-color\s*:\s*#ffffff;[^}]*background-image\s*:\s*none;/s
  );
  assert.doesNotMatch(styles, /\.stroke1(?:Tile)?\s*\{[^}]*background-color/s);
});
