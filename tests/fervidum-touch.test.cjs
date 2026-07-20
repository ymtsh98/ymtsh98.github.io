const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const script = fs.readFileSync(path.join(__dirname, "..", "js", "fervidum.js"), "utf8");

class FakeClassList {
  #values = new Set();

  add(...values) {
    values.forEach((value) => this.#values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.#values.delete(value));
  }

  contains(value) {
    return this.#values.has(value);
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.classList = new FakeClassList();
    this.children = [];
    this.eventListeners = new Map();
    this.parentElement = undefined;
    this.style = {};
  }

  addEventListener(type, listener) {
    const listeners = this.eventListeners.get(type) || [];
    listeners.push(listener);
    this.eventListeners.set(type, listeners);
  }

  emit(type, event = {}) {
    (this.eventListeners.get(type) || []).forEach((listener) => listener({
      target: this,
      ...event
    }));
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child) {
    child.parentElement = this;
    this.children.unshift(child);
    return child;
  }

  insertAdjacentElement(_, child) {
    return this.insertBefore(child);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  querySelector(selector) {
    if (selector === ".image") {
      return this.children.find((child) => child.classList.contains("image"));
    }

    return undefined;
  }

  setAttribute() {}

  closest(selector) {
    if (selector.includes(".image") && this.classList.contains("image")) {
      return this;
    }

    if (selector.includes(".fervidumWarpHost") && this.classList.contains("fervidumWarpHost")) {
      return this;
    }

    if (selector.includes("a") && this.tagName === "A") {
      return this;
    }

    return this.parentElement?.closest(selector);
  }
}

const createContext2d = () => {
  const fills = [];

  return {
    fills,
    globalAlpha: 1,
    filter: "none",
    clearRect() {},
    createImageData(width, height) {
      return { data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData() {},
    drawImage() {},
    fillRect() {
      fills.push(this.globalAlpha);
    }
  };
};

const createWebGlContext = () => ({
  ARRAY_BUFFER: 0,
  STATIC_DRAW: 0,
  TEXTURE_2D: 0,
  TEXTURE_MIN_FILTER: 0,
  TEXTURE_MAG_FILTER: 0,
  TEXTURE_WRAP_S: 0,
  TEXTURE_WRAP_T: 0,
  LINEAR: 0,
  CLAMP_TO_EDGE: 0,
  VERTEX_SHADER: 0,
  FRAGMENT_SHADER: 0,
  COMPILE_STATUS: 0,
  LINK_STATUS: 0,
  TEXTURE0: 0,
  FLOAT: 0,
  TRIANGLES: 0,
  COLOR_BUFFER_BIT: 0,
  RGBA: 0,
  UNSIGNED_BYTE: 0,
  UNPACK_FLIP_Y_WEBGL: 0,
  NO_ERROR: 0,
  createShader: () => ({}),
  shaderSource() {},
  compileShader() {},
  getShaderParameter: () => true,
  deleteShader() {},
  createProgram: () => ({}),
  attachShader() {},
  linkProgram() {},
  getProgramParameter: () => true,
  deleteProgram() {},
  createBuffer: () => ({}),
  createTexture: () => ({}),
  bindBuffer() {},
  bufferData() {},
  bindTexture() {},
  texParameteri() {},
  getAttribLocation: () => 0,
  getUniformLocation: () => ({}),
  pixelStorei() {},
  texImage2D() {},
  getError: () => 0,
  viewport() {},
  isContextLost: () => false,
  useProgram() {},
  enableVertexAttribArray() {},
  vertexAttribPointer() {},
  activeTexture() {},
  uniform1i() {},
  uniform2f() {},
  uniform1f() {},
  drawArrays() {},
  clearColor() {},
  clear() {}
});

const createHarness = ({ webgl }) => {
  let now = 0;
  let nextFrame = 1;
  const frames = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const body = new FakeElement("body");
  body.clientWidth = 390;
  body.clientHeight = 844;
  body.scrollWidth = 390;
  body.scrollHeight = 1200;
  Object.defineProperty(body, "offsetWidth", { get: () => 390 });
  const page = new FakeElement();
  const tile = new FakeElement("article");
  tile.classList.add("tile", "fervidumTile");
  const image = new FakeElement("img");
  image.classList.add("image", "fervidum");
  image.complete = true;
  image.naturalWidth = 675;
  image.getBoundingClientRect = () => ({
    left: 24,
    top: 120,
    right: 366,
    bottom: 728,
    width: 342,
    height: 608
  });
  tile.appendChild(image);
  const blank = new FakeElement();
  const canvases = [];

  const document = {
    body,
    documentElement: {
      clientWidth: 390,
      clientHeight: 844,
      scrollWidth: 390,
      scrollHeight: 1200
    },
    querySelectorAll(selector) {
      if (selector === ".fervidumTile" || selector === ".gallery img") {
        return [selector === ".fervidumTile" ? tile : image];
      }

      return [];
    },
    querySelector(selector) {
      return selector === ".page" ? page : undefined;
    },
    createElement(tagName) {
      if (tagName !== "canvas") {
        return new FakeElement(tagName);
      }

      const canvas = new FakeElement("canvas");
      const context2d = createContext2d();
      canvas.width = 0;
      canvas.height = 0;
      canvas.getContext = (kind) => {
        if (kind === "2d") {
          return context2d;
        }

        return webgl ? createWebGlContext() : undefined;
      };
      canvas.context2d = context2d;
      canvases.push(canvas);
      return canvas;
    },
    createElementNS() {
      return new FakeElement("svg");
    },
    createDocumentFragment() {
      return new FakeElement();
    },
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    }
  };
  const window = {
    document,
    innerWidth: 390,
    innerHeight: 844,
    scrollX: 0,
    scrollY: 0,
    matchMedia: () => ({ matches: false }),
    addEventListener(type, listener) {
      const listeners = windowListeners.get(type) || [];
      listeners.push(listener);
      windowListeners.set(type, listeners);
    },
    setTimeout: () => 1,
    clearTimeout() {},
    gridPaper: {
      writeOnCanvas: () => () => {}
    }
  };
  const sandbox = {
    Element: FakeElement,
    Float32Array,
    Float64Array,
    Math,
    MutationObserver: class {},
    ResizeObserver: class {},
    Set,
    Uint8ClampedArray,
    cancelAnimationFrame: (frame) => frames.delete(frame),
    clearTimeout() {},
    document,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    performance: { now: () => now },
    requestAnimationFrame: (callback) => {
      const frame = nextFrame;
      nextFrame += 1;
      frames.set(frame, callback);
      return frame;
    },
    window
  };

  vm.runInNewContext(script, sandbox, { filename: "fervidum.js" });

  const runLoad = () => (windowListeners.get("load") || []).forEach((listener) => listener());
  const runFrames = (time) => {
    now = time;
    const callbacks = Array.from(frames.values());
    frames.clear();
    callbacks.forEach((callback) => callback(now));
  };

  return { blank, body, canvases, documentListeners, image, runFrames, runLoad, window };
};

test("touch keeps the background transition running when WebGL is unavailable", () => {
  const harness = createHarness({ webgl: false });
  harness.runLoad();
  harness.image.emit("click");
  harness.runFrames(3500);

  const sweep = harness.canvases.find((canvas) => canvas.className === "fervidumSweep");

  assert.ok(sweep.classList.contains("is-active"));
  assert.ok(harness.body.classList.contains("fervidumActive"));
  assert.ok(!harness.body.classList.contains("fervidumWarpActive"));
  assert.ok(sweep.context2d.fills.some((alpha) => alpha > 0));
});

test("touch starts both the background transition and a rendered WebGL haze", () => {
  const harness = createHarness({ webgl: true });
  harness.runLoad();
  harness.image.emit("click");
  harness.runFrames(3500);

  const sweep = harness.canvases.find((canvas) => canvas.className === "fervidumSweep");
  const wave = harness.canvases.find((canvas) => canvas.className === "fervidumWave");

  assert.ok(sweep.classList.contains("is-active"));
  assert.ok(harness.body.classList.contains("fervidumWarpActive"));
  assert.ok(wave);
  assert.ok(sweep.context2d.fills.some((alpha) => alpha > 0));

  (harness.documentListeners.get("click") || []).forEach((listener) => listener({ target: harness.blank }));
  assert.ok(harness.body.classList.contains("fervidumExit"));
});

test("a touch pointer event is not restarted by its follow-up click and survives scrolling", () => {
  const harness = createHarness({ webgl: true });
  harness.runLoad();
  harness.image.emit("pointerup", { pointerType: "touch" });

  const sweep = harness.canvases.find((canvas) => canvas.className === "fervidumSweep");
  const startsAfterPointerUp = sweep.context2d.fills.length;
  harness.image.emit("click");
  harness.window.scrollY = 420;
  harness.runFrames(3500);

  assert.equal(sweep.context2d.fills.length, startsAfterPointerUp + 1);
  assert.ok(sweep.classList.contains("is-active"));
  assert.ok(harness.body.classList.contains("fervidumWarpActive"));
});
