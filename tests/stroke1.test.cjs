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
  preloadComplete = true,
  readyState = "complete",
  useIdleCallback = true,
  computedStyles = {
    after: { opacity: "0", transform: "matrix(1, 0, 0, 0, 0, 0)" },
    before: { opacity: "1", transform: "matrix(1, 0, 0, 1, 0, 0)" }
  }
} = {}) => {
  const backgroundCalls = [];
  const listeners = new Map();
  const bodyClasses = new Set();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const timers = [];
  const idleCallbacks = [];
  const preloadImages = [];
  const preloadRequests = [];
  const imageListeners = new Map();
  const cssVariables = new Map();
  const image = {
    dataset: { strokeHoverSrc: "images/2026/stroke1.apng" },
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
    readyState,
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
        add(...names) {
          names.forEach((name) => bodyClasses.add(name));
        },
        remove(...names) {
          names.forEach((name) => bodyClasses.delete(name));
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
      constructor() {
        this.listeners = new Map();
        preloadImages.push(this);
      }

      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      }

      emit(type) {
        this.listeners.get(type)?.();
      }

      set src(value) {
        this.currentSrc = value;
        preloadRequests.push({ src: value, priority: this.fetchPriority });
      }
    },
    performance: { now: () => 0 },
    getComputedStyle: (_, pseudo) => computedStyles[pseudo === "::after" ? "after" : "before"],
    window: {
      addEventListener(type, listener) {
        windowListeners.set(type, listener);
      },
      matchMedia: () => ({ matches: hover }),
      requestIdleCallback: useIdleCallback ? (callback) => idleCallbacks.push(callback) : undefined,
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

  const harness = {
    backgroundCalls,
    bodyClasses,
    cssVariables,
    documentListeners,
    image,
    listeners,
    preloadImage: preloadImages[0],
    preloadRequests,
    emitDocument(type, event) {
      documentListeners.get(type)?.forEach((listener) => listener(event));
    },
    finishPageLoad() {
      document.readyState = "complete";
      windowListeners.get("load")?.();
    },
    runIdleCallbacks() {
      idleCallbacks.splice(0).forEach((callback) => callback());
    },
    runTimers() {
      timers.splice(0).forEach((callback) => callback());
    }
  };

  if (preloadComplete) {
    if (document.readyState !== "complete") {
      harness.finishPageLoad();
    }

    harness.runIdleCallbacks();
    harness.runTimers();
    harness.preloadImage.emit("load");
  }

  return harness;
};

test("APNG preloading waits for the page load and an idle callback", () => {
  const harness = createHarness({ preloadComplete: false, readyState: "interactive" });

  harness.runIdleCallbacks();
  assert.equal(harness.preloadRequests.length, 0);

  harness.finishPageLoad();
  assert.equal(harness.preloadRequests.length, 0);

  harness.runIdleCallbacks();
  assert.deepEqual(harness.preloadRequests, [{
    src: "images/2026/stroke1.apng",
    priority: "low"
  }]);

  harness.preloadImage.emit("load");
  assert.equal(harness.image.src, "images/2026/stroke1.png");
  assert.equal(harness.bodyClasses.has("stroke1Active"), false);
  assert.deepEqual(harness.backgroundCalls, []);
});

test("an already loaded page still defers APNG preloading until idle", () => {
  const harness = createHarness({ preloadComplete: false });

  assert.equal(harness.preloadRequests.length, 0);
  harness.runIdleCallbacks();
  assert.equal(harness.preloadRequests.length, 1);
});

test("APNG preloading falls back to a task after page load without idle callbacks", () => {
  const harness = createHarness({
    preloadComplete: false,
    readyState: "interactive",
    useIdleCallback: false
  });

  harness.runTimers();
  assert.equal(harness.preloadRequests.length, 0);

  harness.finishPageLoad();
  assert.equal(harness.preloadRequests.length, 0);

  harness.runTimers();
  assert.equal(harness.preloadRequests.length, 1);
  assert.equal(harness.preloadRequests[0].priority, "low");
});

test("early hover loads the APNG on demand and waits before starting effects", () => {
  const harness = createHarness({ preloadComplete: false, readyState: "interactive" });

  harness.listeners.get("mouseenter")();
  harness.listeners.get("mouseenter")();
  assert.deepEqual(harness.preloadRequests, [{
    src: "images/2026/stroke1.apng",
    priority: "high"
  }]);
  assert.equal(harness.image.src, "images/2026/stroke1.png");
  assert.equal(harness.bodyClasses.has("stroke1Active"), false);
  assert.deepEqual(harness.backgroundCalls, []);

  harness.preloadImage.emit("load");
  assert.equal(harness.image.src, "images/2026/stroke1.apng");
  assert.equal(harness.bodyClasses.has("stroke1Active"), true);
  assert.deepEqual(harness.backgroundCalls, [["fade"]]);

  harness.finishPageLoad();
  harness.runIdleCallbacks();
  assert.equal(harness.preloadRequests.length, 1);
});

test("hover during background preloading reuses the request and waits for the APNG", () => {
  const harness = createHarness({ preloadComplete: false });

  harness.runIdleCallbacks();
  harness.listeners.get("mouseenter")();
  assert.equal(harness.preloadRequests.length, 1);
  assert.equal(harness.image.src, "images/2026/stroke1.png");
  assert.deepEqual(harness.backgroundCalls, []);

  harness.preloadImage.emit("load");
  assert.equal(harness.image.src, "images/2026/stroke1.apng");
  assert.deepEqual(harness.backgroundCalls, [["fade"]]);
});

test("leaving while loading cancels playback without discarding the preload", () => {
  const harness = createHarness({ preloadComplete: false });

  harness.listeners.get("mouseenter")();
  harness.listeners.get("mouseleave")({ relatedTarget: { closest: () => ({}) } });
  harness.preloadImage.emit("load");
  assert.equal(harness.image.src, "images/2026/stroke1.png");
  assert.equal(harness.bodyClasses.has("stroke1Active"), false);
  assert.deepEqual(harness.backgroundCalls, []);

  harness.listeners.get("mouseenter")();
  assert.equal(harness.image.src, "images/2026/stroke1.apng");
  assert.equal(harness.preloadRequests.length, 1);
  assert.deepEqual(harness.backgroundCalls, [["fade"]]);
});

test("touch waits for the APNG and ignores the following synthetic click", () => {
  const harness = createHarness({ hover: false, preloadComplete: false });

  harness.image.emit("pointerup", { pointerType: "touch" });
  harness.image.emit("click");
  assert.equal(harness.image.src, "images/2026/stroke1.png");
  assert.deepEqual(harness.backgroundCalls, []);

  harness.preloadImage.emit("load");
  assert.equal(harness.image.src, "images/2026/stroke1.apng");
  assert.equal(harness.preloadRequests.length, 1);
  assert.deepEqual(harness.backgroundCalls, [["fade"]]);
});

test("another gallery effect cancels pending touch playback", () => {
  const harness = createHarness({ hover: false, preloadComplete: false });

  harness.image.emit("pointerup", { pointerType: "touch" });
  harness.emitDocument("gallery:effectactivate", { detail: { effect: "fervidum" } });
  harness.preloadImage.emit("load");

  assert.equal(harness.image.src, "images/2026/stroke1.png");
  assert.equal(harness.bodyClasses.has("stroke1Active"), false);
  assert.deepEqual(harness.backgroundCalls, []);
});

test("an outside click cancels pending touch playback", () => {
  const harness = createHarness({ hover: false, preloadComplete: false });

  harness.image.emit("click");
  harness.emitDocument("click", { target: { closest: () => null } });
  harness.preloadImage.emit("load");

  assert.equal(harness.image.src, "images/2026/stroke1.png");
  assert.equal(harness.bodyClasses.has("stroke1Active"), false);
  assert.deepEqual(harness.backgroundCalls, [["restore-transparent"]]);
});

test("a failed APNG load keeps the thumbnail and can retry on the next interaction", () => {
  const harness = createHarness({ hover: false, preloadComplete: false });

  harness.image.emit("click");
  harness.preloadImage.emit("error");
  assert.equal(harness.image.src, "images/2026/stroke1.png");
  assert.equal(harness.bodyClasses.has("stroke1Active"), false);
  assert.deepEqual(harness.backgroundCalls, []);

  harness.image.emit("click");
  assert.equal(harness.preloadRequests.length, 2);

  harness.preloadImage.emit("load");
  assert.equal(harness.image.src, "images/2026/stroke1.apng");
  assert.deepEqual(harness.backgroundCalls, [["fade"]]);
});

test("hover switches the stroke image and fades the outgoing background", () => {
  const harness = createHarness();

  harness.listeners.get("mouseenter")();
  assert.ok(harness.bodyClasses.has("stroke1Active"));
  assert.equal(harness.image.src, "images/2026/stroke1.apng");
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
  assert.equal(harness.image.src, "images/2026/stroke1.apng");
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
