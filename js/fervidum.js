const fervidumTiles = document.querySelectorAll(".fervidumTile");
const duration = 5000;
const sweepDuration = 4000;
const restoreFadeDuration = 460;
const warpDelay = 0;
const hazeSliceWidth = 12;
const minHazeSliceCount = 24;
const maxHazeSliceCount = 52;
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
let connectionCanvas;
let connectionContext;
let connectionFrame;

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

const getConnectionHosts = () => Array.from(
  document.querySelectorAll(".profileLinks a, .blogLinks, .tile")
).map((element) => {
  const rect = element.getBoundingClientRect();

  return {
    rect,
    center: {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    }
  };
}).filter(({ rect }) => rect.width > 0 && rect.height > 0);

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

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;

  connectionCanvas.width = Math.round(width * pixelRatio);
  connectionCanvas.height = Math.round(height * pixelRatio);
  connectionContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  connectionContext.clearRect(0, 0, width, height);

  const hosts = getConnectionHosts();
  const ink = getComputedStyle(document.documentElement)
    .getPropertyValue("--connector")
    .trim() || "#4e5f72";

  connectionContext.globalAlpha = 0.84;
  connectionContext.strokeStyle = ink;
  connectionContext.lineCap = "round";
  connectionContext.lineWidth = 2;

  getConnectionEdges(hosts).forEach(({ from, to }) => {
    const start = getBorderPoint(hosts[from], hosts[to].center);
    const end = getBorderPoint(hosts[to], hosts[from].center);

    connectionContext.beginPath();
    connectionContext.moveTo(start.x, start.y);
    connectionContext.lineTo(end.x, end.y);
    connectionContext.stroke();
  });

  connectionContext.globalAlpha = 1;
};

const scheduleConnections = () => {
  if (!connectionFrame) {
    connectionFrame = requestAnimationFrame(drawConnections);
  }
};

const createConnections = () => {
  connectionCanvas = document.createElement("canvas");
  connectionCanvas.className = "boxConnections";
  connectionCanvas.setAttribute("aria-hidden", "true");
  connectionContext = connectionCanvas.getContext("2d");
  document.body.insertAdjacentElement("afterbegin", connectionCanvas);

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
  window.addEventListener("scroll", scheduleConnections, { passive: true });
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
  sweepCanvas.width = window.innerWidth;
  sweepCanvas.height = window.innerHeight;
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
  cancelGridRewrite?.();
  cancelGridRewrite = undefined;
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
    onComplete: () => {
      sweepCanvas.classList.add("is-fading");
      restoreFadeTimer = window.setTimeout(finishFervidumExit, restoreFadeDuration);
    }
  });
};

const createWaveLayers = () => {
  const images = document.querySelectorAll(".gallery img");

  const createWaveLayer = (image, imageIndex) => {
    if (!image.complete || image.naturalWidth === 0) {
      image.addEventListener("load", () => {
        createWaveLayer(image, imageIndex);
      }, { once: true });

      return;
    }

    const tile = image.parentElement;
    const host = document.createElement("div");
    const wave = document.createElement("div");
    const duration = 6200 + (imageIndex % 4) * 700;
    const sliceCount = clamp(
      Math.round(image.getBoundingClientRect().width / hazeSliceWidth),
      minHazeSliceCount,
      maxHazeSliceCount
    );
    const waveIntensity = image.naturalWidth > image.naturalHeight
      ? Math.max(0.45, image.naturalHeight / image.naturalWidth)
      : 1;

    host.className = "fervidumWarpHost";
    tile.insertBefore(host, image);
    host.appendChild(image);
    image.classList.add("fervidumSource");

    wave.className = "fervidumWave";
    wave.setAttribute("aria-hidden", "true");
    wave.style.setProperty("--fervidumHazeDuration", `${duration}ms`);
    wave.style.setProperty("--fervidumWaveStartDelay", `${imageIndex * 220}ms`);

    for (let index = 0; index < sliceCount; index += 1) {
      const slice = document.createElement("span");
      const sliceImage = image.cloneNode(false);
      const left = (index / sliceCount) * 100;
      const right = 100 - ((index + 1) / sliceCount) * 100;
      const direction = (index + imageIndex) % 2 === 0 ? 1 : -1;
      const baseAmplitude = 1 + ((index * 3 + imageIndex) % 3);
      const amplitude = baseAmplitude * waveIntensity;
      const settleAmplitude = Math.max(1, baseAmplitude - 1) * waveIntensity;

      slice.className = "fervidumWaveSlice";
      slice.setAttribute("aria-hidden", "true");
      slice.style.setProperty("--fervidumSliceLeft", `${left}%`);
      slice.style.setProperty("--fervidumSliceRight", `${right}%`);
      slice.style.setProperty("--fervidumSliceDelay", `${80 + ((index * 83 + imageIndex * 137) % 480)}ms`);
      slice.style.setProperty("--fervidumHazeDriftA", `${direction * amplitude}px`);
      slice.style.setProperty("--fervidumHazeDriftB", `${direction * -amplitude}px`);
      slice.style.setProperty("--fervidumHazeDriftC", `${direction * settleAmplitude}px`);

      sliceImage.className = "fervidumHazeImage";
      sliceImage.alt = "";
      sliceImage.loading = "eager";
      sliceImage.removeAttribute("id");
      sliceImage.setAttribute("aria-hidden", "true");

      slice.appendChild(sliceImage);
      wave.appendChild(slice);
    }

    host.appendChild(wave);
  };

  images.forEach(createWaveLayer);
};

const startFervidum = () => {
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
  startSweep();
};

const resetFervidum = () => {
  document.body.classList.remove("fervidumActive", "fervidumComplete", "fervidumReset");
  document.body.classList.add("fervidumExit");
  startGridRestore();
};

createSweep();
createWaveLayers();
createConnections();

fervidumTiles.forEach((tile) => {
  let completeTimer;
  let warpTimer;

  tile.addEventListener("mouseenter", () => {
    clearTimeout(completeTimer);
    clearTimeout(warpTimer);

    startFervidum();

    warpTimer = setTimeout(() => {
      document.body.classList.add("fervidumWarpActive");
    }, warpDelay);

    completeTimer = setTimeout(() => {
      document.body.classList.add("fervidumComplete");
    }, duration);
  });

  tile.addEventListener("mouseleave", () => {
    clearTimeout(completeTimer);
    clearTimeout(warpTimer);

    resetFervidum();
  });
});
