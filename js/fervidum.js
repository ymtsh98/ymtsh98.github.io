const fervidumTiles = document.querySelectorAll(".fervidumTile");
const canUseHoverEffects = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
// Diagnostic switches: draw the desktop canvas without advancing its heat-haze
// shader, so its surface can be inspected separately from the distortion.
const hoverCanvasEnabled = true;
const hoverWaveEnabled = true;
// Treat every non-hover layout as touch, including browsers that omit pointer capability details.
const canUseTouchEffects = !canUseHoverEffects;
const duration = 5000;
const sweepDuration = 4000;
const restoreFadeDuration = 460;
const warpDelay = 0;
const waveFrameInterval = 1000 / 30;
const waveRampDuration = 360;
const waveFadeDuration = 260;
const maxWavePixels = 1200000;
const simulationCellSize = 8;
const maxSimulationSide = 176;

let sweepCanvas;
let sweepContext;
let inkCanvas;
let inkContext;
let inkImageData;
let inkArrival;
let inkGrain;
let inkWidth;
let inkHeight;
let inkMaxArrival;
let sweepFrame;
let sweepStartTime = 0;
let lastSweepRender = 0;
let restoreFadeTimer;
let cancelGridRewrite;
let connectionLayer;
let connectionFrame;
let waveFrame;
let waveStartTime = 0;
let waveLastRender = 0;
let waveResizeFrame;
let waveClearTimer;
let waveFadeStart;
const waveLayers = [];
const svgNamespace = "http://www.w3.org/2000/svg";

const createSweep = () => {
  sweepCanvas = document.createElement("canvas");
  sweepCanvas.className = "fervidumSweep";
  sweepCanvas.setAttribute("aria-hidden", "true");
  sweepContext = sweepCanvas.getContext("2d", { alpha: true });
  inkCanvas = document.createElement("canvas");
  inkContext = inkCanvas.getContext("2d", { alpha: true });

  document.body.insertAdjacentElement("afterbegin", sweepCanvas);
};

const easeInOut = (value) => value * value * (3 - 2 * value);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getConnectionHosts = () => {
  const pageX = window.scrollX;
  const pageY = window.scrollY;

  return Array.from(
    document.querySelectorAll(".profileLinks a, .blogLinks, .tile")
  ).map((element) => {
    const rect = element.getBoundingClientRect();
    const connectionRect = {
      left: rect.left + pageX,
      top: rect.top + pageY,
      right: rect.right + pageX,
      bottom: rect.bottom + pageY,
      width: rect.width,
      height: rect.height
    };

    return {
      rect: connectionRect,
      center: {
        x: connectionRect.left + connectionRect.width / 2,
        y: connectionRect.top + connectionRect.height / 2
      }
    };
  }).filter(({ rect }) => rect.width > 0 && rect.height > 0);
};

const getConnectionLayerSize = () => {
  const root = document.documentElement;
  const body = document.body;

  return {
    width: Math.max(root.clientWidth, root.scrollWidth, body.clientWidth, body.scrollWidth),
    height: Math.max(root.clientHeight, root.scrollHeight, body.clientHeight, body.scrollHeight)
  };
};

const boxDistance = (first, second) => {
  const horizontalGap = Math.max(
    0,
    first.rect.left - second.rect.right,
    second.rect.left - first.rect.right
  );
  const verticalGap = Math.max(
    0,
    first.rect.top - second.rect.bottom,
    second.rect.top - first.rect.bottom
  );

  return Math.hypot(horizontalGap, verticalGap);
};

const getBorderPoint = ({ rect, center }, target) => {
  const deltaX = target.x - center.x;
  const deltaY = target.y - center.y;
  const scale = 1 / Math.max(
    Math.abs(deltaX) / (rect.width / 2),
    Math.abs(deltaY) / (rect.height / 2)
  );

  return {
    x: center.x + deltaX * scale,
    y: center.y + deltaY * scale
  };
};

const getConnectionEdges = (hosts) => {
  if (hosts.length < 2) {
    return [];
  }

  const connected = new Set([0]);
  const edges = [];

  while (connected.size < hosts.length) {
    let closestEdge;

    connected.forEach((from) => {
      hosts.forEach((host, to) => {
        if (connected.has(to)) {
          return;
        }

        const distance = boxDistance(hosts[from], host);

        if (!closestEdge || distance < closestEdge.distance) {
          closestEdge = { from, to, distance };
        }
      });
    });

    edges.push(closestEdge);
    connected.add(closestEdge.to);
  }

  return edges;
};

const drawConnections = () => {
  connectionFrame = undefined;

  const { width, height } = getConnectionLayerSize();
  const hosts = getConnectionHosts();
  const ink = getComputedStyle(document.documentElement)
    .getPropertyValue("--connector")
    .trim() || "#4e5f72";
  const paths = document.createDocumentFragment();

  connectionLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
  connectionLayer.setAttribute("width", width);
  connectionLayer.setAttribute("height", height);
  connectionLayer.style.width = `${width}px`;
  connectionLayer.style.height = `${height}px`;

  getConnectionEdges(hosts).forEach(({ from, to }) => {
    const start = getBorderPoint(hosts[from], hosts[to].center);
    const end = getBorderPoint(hosts[to], hosts[from].center);
    const path = document.createElementNS(svgNamespace, "path");

    path.setAttribute("d", `M ${start.x} ${start.y} L ${end.x} ${end.y}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", ink);
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("opacity", "0.84");
    paths.appendChild(path);
  });

  connectionLayer.replaceChildren(paths);
};

const scheduleConnections = () => {
  if (!connectionFrame) {
    connectionFrame = requestAnimationFrame(drawConnections);
  }
};

const createConnections = () => {
  connectionLayer = document.createElementNS(svgNamespace, "svg");
  connectionLayer.classList.add("boxConnections");
  connectionLayer.setAttribute("aria-hidden", "true");
  document.body.insertAdjacentElement("afterbegin", connectionLayer);

  if (canUseTouchEffects) {
    // SVG shares document coordinates with the boxes, so pinch-zoom needs no redraw.
    window.addEventListener("load", scheduleConnections, { once: true });
    window.addEventListener("orientationchange", scheduleConnections, { passive: true });
    scheduleConnections();
    return;
  }

  const resizeObserver = new ResizeObserver(scheduleConnections);
  const observeConnectionHosts = () => {
    document.querySelectorAll(".page, .profileLinks, .gallery, .profileLinks a, .blogLinks, .tile")
      .forEach((element) => resizeObserver.observe(element));
  };

  observeConnectionHosts();

  new MutationObserver(() => {
    observeConnectionHosts();
    scheduleConnections();
  }).observe(document.querySelector(".page"), {
    childList: true,
    subtree: true
  });

  window.addEventListener("resize", scheduleConnections, { passive: true });
  document.addEventListener("load", scheduleConnections, true);
  scheduleConnections();
};

const pushHeap = (heap, entry) => {
  heap.push(entry);
  let index = heap.length - 1;

  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);

    if (heap[parent].cost <= entry.cost) {
      break;
    }

    heap[index] = heap[parent];
    index = parent;
  }

  heap[index] = entry;
};

const popHeap = (heap) => {
  const first = heap[0];
  const last = heap.pop();

  if (heap.length === 0) {
    return first;
  }

  let index = 0;

  while (index * 2 + 1 < heap.length) {
    const left = index * 2 + 1;
    const right = left + 1;
    const child = right < heap.length && heap[right].cost < heap[left].cost ? right : left;

    if (heap[child].cost >= last.cost) {
      break;
    }

    heap[index] = heap[child];
    index = child;
  }

  heap[index] = last;

  return first;
};

const createArrivalMap = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  inkWidth = clamp(Math.round(width / simulationCellSize), 80, maxSimulationSide);
  inkHeight = clamp(Math.round(height / simulationCellSize), 72, maxSimulationSide);
  inkCanvas.width = inkWidth;
  inkCanvas.height = inkHeight;
  inkImageData = inkContext.createImageData(inkWidth, inkHeight);
  inkArrival = new Float64Array(inkWidth * inkHeight).fill(Infinity);
  inkGrain = new Float32Array(inkWidth * inkHeight);
  const fiberAngle = Math.random() * Math.PI;
  const fiberDirection = {
    x: Math.cos(fiberAngle),
    y: Math.sin(fiberAngle)
  };
  const flowAngle = Math.random() * 0.3 + Math.PI * 0.18;
  const flowDirection = {
    x: Math.cos(flowAngle),
    y: Math.sin(flowAngle)
  };
  const sourceWidth = Math.floor(Math.random() * 5) + 4;
  const sourceHeight = Math.floor(Math.random() * 4) + 3;
  const sourceOffsetX = Math.floor(Math.random() * 3);
  const sourceOffsetY = Math.floor(Math.random() * 3);

  for (let y = 0; y < inkHeight; y += 1) {
    for (let x = 0; x < inkWidth; x += 1) {
      const index = y * inkWidth + x;
      const fiberPosition = x * fiberDirection.x + y * fiberDirection.y;
      const softGrain =
        Math.sin(fiberPosition * 0.17) * 0.16 +
        Math.sin(x * 0.043 - y * 0.071) * 0.13;

      inkGrain[index] = 0.78 + softGrain + Math.random() * 0.3;
    }
  }

  const heap = [];

  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      const sourceX = x + sourceOffsetX;
      const sourceY = y + sourceOffsetY;
      const index = sourceY * inkWidth + sourceX;
      const cost = (x + y) * 0.35 + Math.random() * 0.45;

      inkArrival[index] = cost;
      pushHeap(heap, { index, cost });
    }
  }

  const neighbors = [
    [-1, 0, 1],
    [1, 0, 1],
    [0, -1, 1],
    [0, 1, 1],
    [-1, -1, 1.42],
    [1, -1, 1.42],
    [-1, 1, 1.42],
    [1, 1, 1.42]
  ];

  while (heap.length > 0) {
    const current = popHeap(heap);

    if (current.cost > inkArrival[current.index]) {
      continue;
    }

    const x = current.index % inkWidth;
    const y = Math.floor(current.index / inkWidth);

    neighbors.forEach(([offsetX, offsetY, distance]) => {
      const nextX = x + offsetX;
      const nextY = y + offsetY;

      if (nextX < 0 || nextX >= inkWidth || nextY < 0 || nextY >= inkHeight) {
        return;
      }

      const nextIndex = nextY * inkWidth + nextX;
      const alignment = (offsetX * flowDirection.x + offsetY * flowDirection.y) / distance;
      const directionalBias = 1.18 - alignment * 0.34;
      const nextCost = current.cost + distance * inkGrain[nextIndex] * directionalBias;

      if (nextCost < inkArrival[nextIndex]) {
        inkArrival[nextIndex] = nextCost;
        pushHeap(heap, { index: nextIndex, cost: nextCost });
      }
    });
  }

  inkMaxArrival = 0;

  inkArrival.forEach((arrival) => {
    inkMaxArrival = Math.max(inkMaxArrival, arrival);
  });
};

const resizeSweep = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const pixelRatio = window.devicePixelRatio || 1;

  sweepCanvas.width = Math.round(width * pixelRatio);
  sweepCanvas.height = Math.round(height * pixelRatio);
  sweepCanvas.style.width = `${width}px`;
  sweepCanvas.style.height = `${height}px`;
  sweepContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  sweepContext.imageSmoothingEnabled = true;
  sweepContext.imageSmoothingQuality = "high";
};

const renderSweep = (progress) => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const phase = progress * inkMaxArrival * 1.05;
  const edgeSoftness = Math.max(1.2, inkMaxArrival * 0.028);
  const data = inkImageData.data;

  for (let index = 0; index < inkArrival.length; index += 1) {
    const edgeDistance = phase - inkArrival[index];
    const coverage = easeInOut(clamp((edgeDistance + edgeSoftness) / (edgeSoftness * 1.8), 0, 1));
    const pooling = Math.exp(-Math.abs(edgeDistance) / (edgeSoftness * 0.7));
    const settle = easeInOut(
      clamp((edgeDistance - edgeSoftness) / (inkMaxArrival * 0.22), 0, 1)
    );
    const watercolorOpacity = coverage * (0.48 + inkGrain[index] * 0.22 + pooling * 0.22);
    const pigment = watercolorOpacity + (1 - watercolorOpacity) * settle;
    const dataIndex = index * 4;

    data[dataIndex] = 253;
    data[dataIndex + 1] = Math.round(158 + pooling * 18 * (1 - settle));
    data[dataIndex + 2] = Math.round(68 + pooling * 20 * (1 - settle));
    data[dataIndex + 3] = Math.round(clamp(pigment, 0, 1) * 255);
  }

  inkContext.putImageData(inkImageData, 0, 0);
  sweepContext.clearRect(0, 0, width, height);
  sweepContext.globalAlpha = 0.38;
  sweepContext.filter = "blur(10px)";
  sweepContext.drawImage(inkCanvas, 0, 0, width, height);
  sweepContext.globalAlpha = 1;
  sweepContext.filter = "none";
  sweepContext.drawImage(inkCanvas, 0, 0, width, height);

  const settleProgress = Math.max(0, (progress - 0.82) / 0.18);

  sweepContext.globalAlpha = easeInOut(settleProgress);
  sweepContext.fillStyle = "#fd9e44";
  sweepContext.fillRect(0, 0, width, height);
  sweepContext.globalAlpha = 1;
};

const startSweep = () => {
  cancelAnimationFrame(sweepFrame);
  cancelGridRewrite?.();
  clearTimeout(restoreFadeTimer);
  sweepCanvas.classList.remove("is-restoring", "is-fading");

  sweepStartTime = performance.now();
  resizeSweep();
  createArrivalMap();
  lastSweepRender = 0;
  sweepCanvas.classList.add("is-active");

  const draw = (now) => {
    const progress = Math.min((now - sweepStartTime) / sweepDuration, 1);

    if (now - lastSweepRender >= 33 || progress === 1) {
      renderSweep(progress);
      lastSweepRender = now;
    }

    if (progress < 1) {
      sweepFrame = requestAnimationFrame(draw);
    }
  };

  renderSweep(0);
  sweepFrame = requestAnimationFrame(draw);
};

const stopSweep = () => {
  cancelAnimationFrame(sweepFrame);
  sweepCanvas.classList.remove("is-active");
  sweepContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
};

const finishFervidumExit = () => {
  cancelAnimationFrame(sweepFrame);
  stopWave();
  cancelGridRewrite?.();
  cancelGridRewrite = undefined;
  clearTimeout(restoreFadeTimer);
  sweepCanvas.classList.remove("is-active", "is-restoring", "is-fading");
  sweepContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
  document.body.classList.remove(
    "fervidumActive",
    "fervidumComplete",
    "fervidumWarpActive",
    "fervidumExit",
    "fervidumReset"
  );
};

const startGridRestore = () => {
  cancelAnimationFrame(sweepFrame);
  cancelGridRewrite?.();
  clearTimeout(restoreFadeTimer);
  sweepCanvas.classList.remove("is-fading");
  sweepCanvas.classList.add("is-restoring");
  cancelGridRewrite = window.gridPaper.writeOnCanvas(sweepCanvas, sweepContext, {
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    onComplete: () => {
      sweepCanvas.classList.add("is-fading");
      restoreFadeTimer = window.setTimeout(finishFervidumExit, restoreFadeDuration);
    }
  });
};

const waveVertexShader = `
  attribute vec2 a_position;
  varying vec2 v_uv;

  void main() {
    v_uv = (a_position + 1.0) * 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const waveFragmentShader = `
  precision mediump float;

  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_strength;

  float heatNoise(float position) {
    return 0.5
      + sin(position * 17.0) * 0.27
      + sin(position * 31.0 + 3.0) * 0.14
      + sin(position * 7.0 + 1.0) * 0.09;
  }

  void main() {
    // A time-scrolled distortion field gives the image a continuous heat-haze flow.
    float time = u_time * 0.18;
    float column = sin(v_uv.x * 11.0 + time * 2.0) * 0.38;
    float horizontal = heatNoise(v_uv.y * 16.0 - time + column) - 0.5;
    float vertical = heatNoise(v_uv.y * 16.0 - time + column * 0.6) - 0.5;
    float lowerFalloff = 0.2 + 0.8 * smoothstep(0.0, 1.0, v_uv.y);
    vec2 offset = vec2(
      horizontal * u_strength * lowerFalloff * 0.6 / u_resolution.x,
      vertical * u_strength * lowerFalloff * 0.22 / u_resolution.y
    );
    vec2 distortedUv = v_uv + offset;

    // Keep the WebGL surface opaque all the way to its physical edge.
    // A translucent edge composites with the orange page sweep as a dark frame.
    gl_FragColor = vec4(texture2D(u_image, distortedUv).rgb, 1.0);
  }
`;

const compileWaveShader = (gl, type, source) => {
  const shader = gl.createShader(type);

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }

  gl.deleteShader(shader);
  return undefined;
};

const createWaveProgram = (gl) => {
  const vertexShader = compileWaveShader(gl, gl.VERTEX_SHADER, waveVertexShader);
  const fragmentShader = compileWaveShader(gl, gl.FRAGMENT_SHADER, waveFragmentShader);

  if (!vertexShader || !fragmentShader) {
    return undefined;
  }

  const program = gl.createProgram();

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return program;
  }

  gl.deleteProgram(program);
  return undefined;
};

const createWaveRenderer = (canvas) => {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    // Keep the last complete frame visible between 30fps renders on mobile Safari.
    preserveDrawingBuffer: true,
    powerPreference: "low-power"
  });
  const program = gl && createWaveProgram(gl);

  if (!gl || !program) {
    return undefined;
  }

  const positionBuffer = gl.createBuffer();
  const texture = gl.createTexture();

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
    1, -1,
    -1, 1,
    -1, 1,
    1, -1,
    1, 1
  ]), gl.STATIC_DRAW);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return {
    gl,
    program,
    positionBuffer,
    texture,
    positionLocation: gl.getAttribLocation(program, "a_position"),
    imageLocation: gl.getUniformLocation(program, "u_image"),
    resolutionLocation: gl.getUniformLocation(program, "u_resolution"),
    timeLocation: gl.getUniformLocation(program, "u_time"),
    strengthLocation: gl.getUniformLocation(program, "u_strength")
  };
};

const uploadWaveTexture = (layer) => {
  const { gl, texture } = layer.renderer;

  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // Upload the decoded image directly.  Routing it through a scaled 2D
    // canvas introduces a second resampling and alpha-conversion boundary.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.textureImage);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    return gl.getError() === gl.NO_ERROR;
  } catch {
    // file:// pages can reject a local image as a WebGL texture; keep the rest of the page running.
    return false;
  }
};

const resizeWaveLayer = (layer) => {
  const rect = layer.image.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);

  if (width < 1 || height < 1) {
    return;
  }

  const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
  const pixelScale = Math.min(deviceScale, Math.sqrt(maxWavePixels / (width * height)));
  const canvasWidth = Math.max(1, Math.round(width * pixelScale));
  const canvasHeight = Math.max(1, Math.round(height * pixelScale));

  const resized = layer.canvas.width !== canvasWidth || layer.canvas.height !== canvasHeight;

  if (resized) {
    layer.canvas.width = canvasWidth;
    layer.canvas.height = canvasHeight;
  }

  layer.width = width;
  layer.pixelScale = canvasWidth / width;

  if (layer.renderer) {
    layer.renderer.gl.viewport(0, 0, canvasWidth, canvasHeight);

    if (resized) {
      uploadWaveTexture(layer);
    }
  }
};

const resizeWaveLayers = () => {
  waveResizeFrame = undefined;
  waveLayers.forEach(resizeWaveLayer);
};

const scheduleWaveResize = () => {
  if (!waveResizeFrame) {
    waveResizeFrame = requestAnimationFrame(resizeWaveLayers);
  }
};

const renderWaveLayer = (layer, now) => {
  if (!layer.available || layer.canvas.width === 0 || layer.canvas.height === 0) {
    return;
  }

  const {
    gl,
    program,
    positionBuffer,
    texture,
    positionLocation,
    imageLocation,
    resolutionLocation,
    timeLocation,
    strengthLocation
  } = layer.renderer;

  if (gl.isContextLost()) {
    layer.available = false;
    return;
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(imageLocation, 0);
  gl.uniform2f(resolutionLocation, layer.canvas.width, layer.canvas.height);
  gl.uniform1f(timeLocation, (now - waveStartTime) / 1000);
  const ramp = easeInOut(clamp((now - waveStartTime) / waveRampDuration, 0, 1));
  const fade = waveFadeStart === undefined
    ? 1
    : 1 - easeInOut(clamp((now - waveFadeStart) / waveFadeDuration, 0, 1));

  gl.uniform1f(strengthLocation, 3.4 * layer.pixelScale * ramp * fade);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
};

const finishWaveFade = () => {
  waveFrame = undefined;
  waveFadeStart = undefined;
  document.body.classList.remove("fervidumWarpActive");
  clearWaveCanvases();
};

const renderWaves = (now) => {
  if (!document.body.classList.contains("fervidumWarpActive")) {
    waveFrame = undefined;
    return;
  }

  const fadeComplete = waveFadeStart !== undefined && now - waveFadeStart >= waveFadeDuration;

  if (now - waveLastRender >= waveFrameInterval || fadeComplete) {
    waveLayers.forEach((layer) => renderWaveLayer(layer, now));
    waveLastRender = now;
  }

  if (fadeComplete) {
    finishWaveFade();
    return;
  }

  waveFrame = requestAnimationFrame(renderWaves);
};

const startWave = (animate = true) => {
  const availableLayers = waveLayers.filter((layer) => (
    layer.available && layer.canvas.width > 0 && layer.canvas.height > 0
  ));

  if (availableLayers.length === 0) {
    return false;
  }

  cancelAnimationFrame(waveFrame);
  clearTimeout(waveClearTimer);
  waveFadeStart = undefined;
  waveStartTime = performance.now();
  waveLastRender = 0;
  // Draw before making the canvas visible so activation cannot flash a blank frame.
  availableLayers.forEach((layer) => renderWaveLayer(layer, waveStartTime));

  if (!availableLayers.some((layer) => layer.available)) {
    return false;
  }

  waveLastRender = waveStartTime;

  if (!animate) {
    return true;
  }

  waveFrame = requestAnimationFrame(renderWaves);

  return true;
};

const clearWaveCanvases = () => {
  waveLayers.forEach(({ canvas, renderer }) => {
    renderer.gl.clearColor(0, 0, 0, 0);
    renderer.gl.clear(renderer.gl.COLOR_BUFFER_BIT);
    renderer.gl.viewport(0, 0, canvas.width, canvas.height);
  });
};

const stopWave = () => {
  cancelAnimationFrame(waveFrame);
  waveFrame = undefined;
  clearTimeout(waveClearTimer);
  waveFadeStart = undefined;
  clearWaveCanvases();
};

const fadeOutWave = () => {
  clearTimeout(waveClearTimer);

  if (!document.body.classList.contains("fervidumWarpActive")) {
    stopWave();
    return;
  }

  waveFadeStart = performance.now();

  if (!waveFrame) {
    waveFrame = requestAnimationFrame(renderWaves);
  }
};

const createWaveLayers = () => {
  const images = document.querySelectorAll(".gallery img");

  const createWaveLayer = (image, imageIndex) => {
    const textureImage = window.fervidumLocalTexture || image;

    if (!textureImage.complete || textureImage.naturalWidth === 0) {
      textureImage.addEventListener("load", () => {
        createWaveLayer(image, imageIndex);
      }, { once: true });

      return;
    }

    if (image.closest(".fervidumWarpHost")) {
      return;
    }

    const canvas = document.createElement("canvas");
    const layer = {
      available: true,
      canvas,
      image,
      imageIndex,
      pixelScale: 1,
      renderer: undefined,
      textureImage,
      width: 0
    };

    resizeWaveLayer(layer);
    layer.renderer = createWaveRenderer(canvas);

    if (!layer.renderer) {
      return;
    }

    if (!uploadWaveTexture(layer)) {
      return;
    }

    const tile = image.parentElement;
    const host = document.createElement("div");

    host.className = "fervidumWarpHost";
    tile.insertBefore(host, image);
    host.appendChild(image);
    image.classList.add("fervidumSource");

    canvas.className = "fervidumWave";
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(canvas);

    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      layer.available = false;
      document.body.classList.remove("fervidumWarpActive");
      stopWave();
    });

    waveLayers.push(layer);

    if (document.body.classList.contains("fervidumWarpActive")) {
      startWave();
    }
  };

  images.forEach(createWaveLayer);

  window.addEventListener("orientationchange", scheduleWaveResize, { passive: true });

  if (canUseHoverEffects) {
    window.addEventListener("resize", scheduleWaveResize, { passive: true });
  }
};

const startFervidum = (includeSweep = true) => {
  cancelGridRewrite?.();
  clearTimeout(restoreFadeTimer);
  sweepCanvas.classList.remove("is-active", "is-restoring", "is-fading");

  document.body.classList.remove(
    "fervidumActive",
    "fervidumComplete",
    "fervidumWarpActive",
    "fervidumExit",
    "fervidumReset"
  );

  document.body.offsetWidth;

  document.body.classList.add("fervidumActive");

  if (includeSweep) {
    startSweep();
  } else {
    cancelAnimationFrame(sweepFrame);
    sweepContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
};

const resetFervidum = () => {
  fadeOutWave();
  document.body.classList.remove(
    "fervidumActive",
    "fervidumComplete",
    "fervidumReset"
  );
  document.body.classList.add("fervidumExit");
  startGridRestore();
};

const initializeHoverEffects = () => {
  createSweep();

  if (hoverCanvasEnabled) {
    createWaveLayers();
  }

  fervidumTiles.forEach((tile) => {
    let completeTimer;
    let warpTimer;

    tile.addEventListener("mouseenter", () => {
      clearTimeout(completeTimer);
      clearTimeout(warpTimer);

      startFervidum();

      if (hoverCanvasEnabled) {
        warpTimer = setTimeout(() => {
          if (startWave(hoverWaveEnabled)) {
            document.body.classList.add("fervidumWarpActive");
          }
        }, warpDelay);
      }

      completeTimer = setTimeout(() => {
        document.body.classList.add("fervidumComplete");
      }, duration);
    });

    tile.addEventListener("mouseleave", () => {
      clearTimeout(completeTimer);
      clearTimeout(warpTimer);

      if (hoverCanvasEnabled && !hoverWaveEnabled) {
        document.body.classList.remove("fervidumWarpActive");
        stopWave();
      }

      resetFervidum();
    });
  });
};

const initializeTouchEffects = () => {
  let effectsReady = false;
  let effectActive = false;
  let lastTouchActivation = Number.NEGATIVE_INFINITY;

  const prepareEffects = () => {
    if (effectsReady) {
      return;
    }

    // One capped-resolution canvas re-renders the source image; no cloned images or extra image layers.
    createSweep();
    createWaveLayers();
    effectsReady = true;
  };

  const activateTouchEffect = () => {
    prepareEffects();
    // A tap keeps the one-shot background-color transition as well as the image-local haze.
    startFervidum();

    if (startWave()) {
      // Show the image-local haze only after its first complete frame has been rendered.
      document.body.classList.add("fervidumWarpActive");
    }

    // WebGL is optional; the requested background-color transition must always complete.
    effectActive = true;
  };

  fervidumTiles.forEach((tile) => {
    const image = tile.querySelector(".image");

    image?.addEventListener("pointerup", (event) => {
      if (event.pointerType !== "touch") {
        return;
      }

      lastTouchActivation = performance.now();
      activateTouchEffect();
    });

    image?.addEventListener("click", () => {
      // Pointer events are not available on older mobile Safari; ignore its synthetic click otherwise.
      if (performance.now() - lastTouchActivation < 700) {
        return;
      }

      activateTouchEffect();
    });
  });

  // Allocate the single renderer once the image is ready, so the first tap has an animation to show.
  window.addEventListener("load", prepareEffects, { once: true });

  document.addEventListener("click", (event) => {
    if (!effectActive || !(event.target instanceof Element)) {
      return;
    }

    if (event.target.closest(".image, .fervidumWarpHost, a")) {
      return;
    }

    resetFervidum();
    effectActive = false;
  });
};

if (canUseHoverEffects) {
  initializeHoverEffects();
} else if (canUseTouchEffects) {
  initializeTouchEffects();
}

createConnections();
