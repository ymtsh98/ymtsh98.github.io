const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "js", "stroke1.js"), "utf8");
const fervidumScript = fs.readFileSync(path.join(__dirname, "..", "js", "fervidum.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "css", "stroke1.css"), "utf8");

const createHarness = ({
  hover = true,
  computedStyles = {
    after: { opacity: "0", transform: "matrix(1, 0, 0, 0, 0, 0)" },
    before: { opacity: "1", transform: "matrix(1, 0, 0, 1, 0, 0)" }
  }
} = {}) => {
  const backgroundCalls = [];
  const listeners = new Map();
  const bodyClasses = new Set();
  const documentListeners = new Map();
  const timers = [];
  const imageListeners = new Map();
  const cssVariables = new Map();
  const image = {
    dataset: { strokeHoverSrc: "images/2026/stroke1.webp" },
    src: "images/2026/stroke1.png",
    addEventListener(type, listener) {
      imageListeners.set(type, listener);
    },
    emit(type, event = {}) {
      imageListeners.get(type)?.({ target: this, ...event });
    },
    getAttribute(name) {
      return name === "src" ? this.src : undefined;
    },
    getBoundingClientRect() {
      return { left: 20, top: 40, width: 100, height: 160 };
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
      offsetWidth: 320,
      style: {
        removeProperty(name) {
          cssVariables.delete(name);
        },
        setProperty(name, value) {
          cssVariables.set(name, value);
        }
      },
      classList: {
        add(name) {
          bodyClasses.add(name);
        },
        remove(name) {
          bodyClasses.delete(name);
        },
        contains(name) {
          return bodyClasses.has(name);
        }
      }
    },
    querySelectorAll(selector) {
      return selector === ".stroke1Tile" ? [tile] : [];
    },
    addEventListener(type, listener) {
      const registered = documentListeners.get(type) || [];
      registered.push(listener);
      documentListeners.set(type, registered);
    }
  };

  vm.runInNewContext(script, {
    document,
    Image: class {
      set src(value) {
        this.currentSrc = value;
      }
    },
    performance: { now: () => 0 },
    getComputedStyle: (_, pseudo) => computedStyles[pseudo === "::after" ? "after" : "before"],
    window: {
      matchMedia: () => ({ matches: hover }),
      setTimeout(callback) {
        timers.push(callback);
        return timers.length;
      },
      clearTimeout() {},
      siteBackgroundEffects: {
        fadeOutEffect() {
          backgroundCalls.push(["fade"]);
        },
        restoreGridFromTransparent() {
          backgroundCalls.push(["restore-transparent"]);
        }
      }
    }
  }, { filename: "stroke1.js" });

  return {
    backgroundCalls,
    bodyClasses,
    cssVariables,
    documentListeners,
    image,
    listeners,
    runTimers() {
      timers.splice(0).forEach((callback) => callback());
    }
  };
};

test("hover switches the stroke image and fades the outgoing background", () => {
  const harness = createHarness();

  harness.listeners.get("mouseenter")();
  assert.ok(harness.bodyClasses.has("stroke1Active"));
  assert.equal(harness.image.src, "images/2026/stroke1.webp");
  assert.deepEqual(harness.backgroundCalls, [["fade"]]);

  harness.listeners.get("mouseleave")({});
  assert.ok(harness.bodyClasses.has("stroke1Active"));
  assert.ok(harness.bodyClasses.has("stroke1Fading"));
  assert.equal(harness.image.src, "images/2026/stroke1.png");
  assert.deepEqual(harness.backgroundCalls, [
    ["fade"],
    ["restore-transparent"]
  ]);

  harness.runTimers();
  assert.ok(!harness.bodyClasses.has("stroke1Active"));
});

test("moving from stroke1 to another gallery tile does not restore the grid", () => {
  const harness = createHarness();
  const nextTile = { closest: () => ({}) };

  harness.listeners.get("mouseenter")();
  harness.listeners.get("mouseleave")({ relatedTarget: nextTile });

  assert.deepEqual(harness.backgroundCalls, [["fade"]]);
  assert.ok(harness.bodyClasses.has("stroke1Fading"));
});

test("moving from stroke1 to empty space restores the grid", () => {
  const harness = createHarness();
  const emptySpace = { closest: () => null };

  harness.listeners.get("mouseenter")();
  harness.listeners.get("mouseleave")({ relatedTarget: emptySpace });

  assert.deepEqual(harness.backgroundCalls, [
    ["fade"],
    ["restore-transparent"]
  ]);
});

test("leaving stroke1 mid-animation fades from its current visual state", () => {
  const harness = createHarness({
    computedStyles: {
      after: { opacity: "0.6", transform: "matrix(1.04, 0, 0, 0.55, 0, 0)" },
      before: { opacity: "1", transform: "matrix(1, 0, 0, 0.02, 0, 0)" }
    }
  });

  harness.listeners.get("mouseenter")();
  harness.listeners.get("mouseleave")({});

  assert.equal(harness.cssVariables.get("--stroke1-fade-opacity"), "1");
  assert.equal(harness.cssVariables.get("--stroke1-fade-transform"), "matrix(1, 0, 0, 0.02, 0, 0)");
  assert.equal(harness.cssVariables.get("--stroke1-flash-fade-opacity"), "0.6");
  assert.equal(harness.cssVariables.get("--stroke1-flash-fade-transform"), "matrix(1.04, 0, 0, 0.55, 0, 0)");
});

test("touch starts stroke1 without installing hover listeners", () => {
  const harness = createHarness({ hover: false });

  assert.equal(harness.listeners.has("mouseenter"), false);
  harness.image.emit("pointerup", { pointerType: "touch" });

  assert.ok(harness.bodyClasses.has("stroke1Active"));
  assert.equal(harness.image.src, "images/2026/stroke1.webp");
});

test("stroke1 keeps its hover capability variable separate from fervidum", () => {
  assert.doesNotMatch(script, /const canUseHoverEffects\s*=/);
  assert.match(script, /const canUseStroke1HoverEffects\s*=/);
});

test("stroke1 and fervidum load together as classic scripts", () => {
  const listeners = new Map();
  const document = {
    body: {
      classList: { add() {}, contains: () => false, remove() {} },
      insertAdjacentElement() {}
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    dispatchEvent() {},
    querySelector: () => undefined,
    querySelectorAll: () => []
  };
  const window = {
    addEventListener() {},
    matchMedia: () => ({ matches: false })
  };
  const sandbox = {
    CustomEvent: class {},
    Float32Array,
    Float64Array,
    Image: class {},
    Math,
    Uint8ClampedArray,
    document,
    window
  };

  vm.runInNewContext(script, sandbox, { filename: "stroke1.js" });
  vm.runInNewContext(fervidumScript, sandbox, { filename: "fervidum.js" });
});

test("only the hovered page state receives the white background", () => {
  assert.match(
    styles,
    /body\.stroke1Active::before\s*\{[^}]*background-color\s*:\s*#ffffff;/s
  );
  assert.match(styles, /opacity:\s*var\(--stroke1-fade-opacity, 1\);/);
  assert.match(styles, /opacity:\s*var\(--stroke1-flash-fade-opacity, 0\);/);
  assert.doesNotMatch(styles, /\.stroke1(?:Tile)?\s*\{[^}]*background-color/s);
});
