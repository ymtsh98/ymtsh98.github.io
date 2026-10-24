const form = document.querySelector("#solverForm");
const plot = document.querySelector("#plot");
const message = document.querySelector("#message");
const results = document.querySelector("#results");
const names = ["a", "b", "c", "d"];
let wasm;
let referenceExample;
let view;
let handles;
let drag;
let fixedView = false;

function evaluate(coefficients, x) {
  const [a, b, c, d] = coefficients;
  return ((a * x + b) * x + c) * x + d;
}

function criticalPoints([a, b, c]) {
  if (a === 0) return b === 0 ? [] : [-c / (2 * b)];
  const discriminant = 4 * b * b - 12 * a * c;
  if (discriminant < 0) return [];
  if (discriminant === 0) return [-b / (3 * a)];
  const q = -0.5 * (2 * b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant));
  return [q / (3 * a), c / q].sort((x, y) => x - y);
}

function draw(coefficients, xMin, xMax, roots) {
  if (fixedView && view) ({ xMin, xMax } = view);
  const samples = Array.from({ length: 801 }, (_, i) => {
    const x = xMin + (xMax - xMin) * i / 800;
    return [x, evaluate(coefficients, x)];
  });
  const critical = criticalPoints(coefficients).filter(x => x > xMin && x < xMax);
  const values = [...samples.map(point => point[1]), ...critical.map(x => evaluate(coefficients, x)), 0];
  const yRadius = Math.max(...values.map(Math.abs), 1e-12) * 1.1;
  let yMin = -yRadius;
  let yMax = yRadius;
  if (fixedView && view) ({ yMin, yMax } = view);
  view = { xMin, xMax, yMin, yMax };
  if (!handles) handles = [0.12, 0.37, 0.63, 0.88].map(t => {
    const x = xMin + (xMax - xMin) * t;
    return { x, y: evaluate(coefficients, x) };
  });
  const px = x => 78 + (x - xMin) / (xMax - xMin) * 796;
  const py = y => 368 - (y - yMin) / (yMax - yMin) * 340;
  let content = '<title id="plotTitle">Polynomial and roots</title><desc id="plotDescription">Curve: polynomial. Orange points: computed roots.</desc>';
  for (let i = 0; i <= 6; ++i) {
    const offset = (i - 3) / 3;
    const x = offset * xMax;
    const y = offset * yMax;
    content += `<text x="${px(x)}" y="393" text-anchor="middle" font-size="13" fill="#344137">${Number(x.toPrecision(3))}</text>`;
    content += `<text x="68" y="${py(y) + 4}" text-anchor="end" font-size="12" fill="#344137">${Number(y.toPrecision(3))}</text>`;
  }
  content += '<path id="xAxis" d="M78 198H874" stroke="#8a9a9d"/><path id="yAxis" d="M476 28V368" stroke="#8a9a9d"/>';
  content += `<path d="${samples.map(([x, y], i) => `${i ? "L" : "M"}${px(x).toFixed(3)} ${py(y).toFixed(3)}`).join(" ")}" fill="none" stroke="#276b7a" stroke-width="2.5"/>`;
  roots.forEach((x, i) => {
    content += `<circle cx="${px(x)}" cy="${py(0)}" r="6" fill="#bf633e" stroke="#fffefa" stroke-width="2"><title>x${i + 1} = ${x}</title></circle>`;
  });
  content += '<text x="882" y="409" font-size="14" fill="#344137">x</text><text x="16" y="18" font-size="14" fill="#344137">f(x)</text>';
  handles.forEach((point, i) => {
    content += `<circle class="handle" data-handle="${i}" cx="${px(point.x)}" cy="${py(point.y)}" r="10" fill="none" pointer-events="all" stroke="#276b7a" stroke-width="3"><title>Drag</title></circle>`;
  });
  plot.innerHTML = content;
}

function solve() {
  if (!wasm || !form.reportValidity()) return;
  const inputs = names.map(name => Number(form.elements[name].value));
  const [a, b, c, d] = inputs;
  results.replaceChildren();
  plot.innerHTML = '<title id="plotTitle">Polynomial and roots</title><desc id="plotDescription">Enter valid coefficients.</desc>';
  if (!inputs.every(Number.isFinite)) {
    message.textContent = "Enter finite values.";
    return;
  }
  const coefficients = [a, b, c, d];
  const leadingIndex = coefficients.findIndex(value => value !== 0);
  const radius = leadingIndex < 0 ? 1 : 1 + Math.max(0, ...coefficients.slice(leadingIndex + 1).map(value => Math.abs(value / coefficients[leadingIndex])));
  if (!Number.isFinite(radius)) {
    message.textContent = "Coefficient range exceeded.";
    return;
  }
  const xMin = -radius;
  const xMax = radius;
  const pointer = wasm.getRoots();
  const count = wasm.solveCubicYuksel(a, b, c, d, xMin, xMax, pointer);
  const roots = count < 0 ? [] : Array.from(new Float64Array(wasm.memory.buffer, pointer, count));
  showResults(coefficients, count, roots);
  if (count < 0) {
    message.textContent = count === -2 ? "All real numbers are roots." : "Solver failed.";
    return;
  }
  draw([a, b, c, d], xMin, xMax, roots);
  message.textContent = "";
}

function setExample(coefficients, reference) {
  referenceExample = reference;
  handles = undefined;
  fixedView = false;
  coefficients.forEach((value, i) => { form.elements[names[i]].value = value; });
  solve();
}

plot.addEventListener("pointerdown", event => {
  const target = event.target.closest("[data-handle]");
  if (!target || drag) return;
  event.preventDefault();
  drag = { index: Number(target.dataset.handle), pointerId: event.pointerId };
  fixedView = true;
  plot.setPointerCapture(event.pointerId);
});

plot.addEventListener("pointermove", event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const matrix = plot.getScreenCTM();
  if (!matrix) return;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  const span = view.xMax - view.xMin;
  const gap = span * 0.015;
  const index = drag.index;
  const left = index ? handles[index - 1].x + gap : view.xMin;
  const right = index < 3 ? handles[index + 1].x - gap : view.xMax;
  handles[index] = {
    x: Math.max(left, Math.min(right, view.xMin + (point.x - 78) / 796 * span)),
    y: view.yMin + (368 - Math.max(28, Math.min(368, point.y))) / 340 * (view.yMax - view.yMin)
  };
  const scale = Math.max(Math.abs(view.xMin), Math.abs(view.xMax));
  const coefficients = [0, 0, 0, 0];
  for (let i = 0; i < 4; ++i) {
    let basis = [1];
    let denominator = 1;
    const xi = handles[i].x / scale;
    for (let j = 0; j < 4; ++j) {
      if (i === j) continue;
      const xj = handles[j].x / scale;
      const next = Array(basis.length + 1).fill(0);
      basis.forEach((value, k) => { next[k] -= xj * value; next[k + 1] += value; });
      basis = next;
      denominator *= xi - xj;
    }
    basis.forEach((value, k) => { coefficients[k] += value * handles[i].y / denominator; });
  }
  const result = [coefficients[3] / scale / scale / scale, coefficients[2] / scale / scale, coefficients[1] / scale, coefficients[0]];
  if (!result.every(Number.isFinite)) return;
  referenceExample = undefined;
  result.forEach((value, i) => { form.elements[names[i]].value = value; });
  solve();
});

function endDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag = undefined;
  if (plot.hasPointerCapture(event.pointerId)) plot.releasePointerCapture(event.pointerId);
}

plot.addEventListener("pointerup", endDrag);
plot.addEventListener("pointercancel", endDrag);
plot.addEventListener("lostpointercapture", endDrag);

form.addEventListener("submit", event => { event.preventDefault(); solve(); });
form.addEventListener("input", event => {
  if (["a", "b", "c", "d"].includes(event.target.name)) {
    referenceExample = undefined;
    handles = undefined;
    fixedView = false;
  }
});
form.addEventListener("change", solve);
document.querySelector("#random").addEventListener("click", () => {
  const a = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 3));
  const randomRoot = () => (Math.floor(Math.random() * 49) - 24) / 8;
  const r = randomRoot();
  if (Math.random() < 0.5) {
    const s = randomRoot();
    const t = randomRoot();
    setExample([a, -a * (r + s + t), a * (r * s + r * t + s * t), -a * r * s * t], {
      roots: [...new Set([r, s, t])].sort((x, y) => x - y)
    });
  } else {
    const u = randomRoot();
    const v = (1 + Math.floor(Math.random() * 24)) / 8;
    setExample([a, -a * (r + 2 * u), a * (u * u + v * v + 2 * r * u), -a * r * (u * u + v * v)], { roots: [r] });
  }
});
function showResults(coefficients, count, roots) {
  const pointer = wasm.getRoots();
  const analyticalCount = wasm.solveCubicAnalytical(...coefficients, pointer);
  const analyticalRoots = analyticalCount < 0 ? [] : Array.from(new Float64Array(wasm.memory.buffer, pointer, analyticalCount));
  const expected = referenceExample?.roots;
  const format = value => {
    if (value === undefined) return "—";
    const rounded = Number(value.toPrecision(8));
    const magnitude = Math.abs(rounded);
    const text = magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e6)
      ? rounded.toExponential() : String(rounded);
    return `<span title="${value.toPrecision(17)}">${text}</span>`;
  };
  let rows = "";
  for (let i = 0; i < 3; ++i) {
    rows += `<tr><th>x${i + 1}</th><td>${format(roots[i])}</td><td>${format(analyticalRoots[i])}</td><td>${format(expected?.[i])}</td></tr>`;
  }
  results.innerHTML = `<table><thead><tr><th></th><th>Numerical</th><th>Analytical</th><th>Reference</th></tr></thead><tbody>${rows}</tbody></table>`;
}

document.querySelector("#randomPrecision").addEventListener("click", () => {
  const kind = Math.floor(Math.random() * 3);
  const a = Math.random() < 0.5 ? -1 : 1;
  let r, t;
  if (kind === 0) {
    r = 2 ** (Math.floor(Math.random() * 17) - 8);
    const k = 20 + Math.floor(Math.random() * 29);
    t = r * (1 + 2 ** -k);
  } else if (kind === 1) {
    r = 2 ** (Math.floor(Math.random() * 17) - 8);
    t = r;
  } else {
    const k = 12 + Math.floor(Math.random() * 13);
    r = 2 ** -k;
    t = 2 ** k;
  }
  setExample([a, -a * (r + t), a * r * t, 0], { roots: r === t ? [0, r] : [0, r, t] });
});
async function initialize() {
  try {
    let bytes;
    if (window.location.protocol === "file:") {
      if (!window.fastPolyRootsWasm) throw new Error("fast_poly_roots_wasm.js not found.");
      bytes = Uint8Array.from(atob(window.fastPolyRootsWasm), character => character.charCodeAt(0));
    } else {
      const response = await fetch(new URL("fast_poly_roots.wasm", document.baseURI));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = await response.arrayBuffer();
    }
    const { instance } = await WebAssembly.instantiate(bytes, {});
    wasm = instance.exports;
    wasm._initialize?.();
    document.querySelector("#controls").disabled = false;
    solve();
  } catch (error) {
    message.textContent = `Check the Wasm files. ${error.message}`;
  }
}

const wasmReady = initialize();

function paperShape(time, rows, height, approach) {
  const smooth = value => {
    const x = Math.max(0, Math.min(1, value));
    return x * x * (3 - 2 * x);
  };
  const adhesion = 0.38 * time + 0.62 * time ** 4;
  const free = 1 - adhesion;
  const rowHeight = height / rows;
  let y = 0;
  let z = height * 0.18 * (1 - approach);
  const points = [{ y, z }];
  const angles = [];
  for (let i = 0; i < rows; ++i) {
    const pos = i / rows;
    const angle = pos > adhesion && free > 0 ? (78 - 6 * adhesion) * smooth((pos - adhesion) / free) : 0;
    y += Math.cos(angle * Math.PI / 180) * rowHeight;
    z += Math.sin(angle * Math.PI / 180) * rowHeight;
    points.push({ y, z });
    angles.push(angle);
  }
  return { approach, adhesion, anchorY: -Math.min(56, height * 0.12) * (1 - approach), points, angles };
}

function animateStickNote(note) {
  window.handDrawnFrames?.pause(note);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    note.classList.remove("noteWaiting");
    window.handDrawnFrames?.animate(note);
    return;
  }
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const viewportWidth = innerWidth;
  const viewportHeight = innerHeight;
  const width = parseFloat(getComputedStyle(note).width);
  const height = note.getBoundingClientRect().height;
  const padding = Math.ceil(Math.max(width, height) * 0.3 + 12);
  const canvasWidth = width + padding * 2;
  const canvasHeight = height + padding * 2;
  const initialPosition = note.getBoundingClientRect();
  canvas.className = "paperMotion";
  canvas.style.left = `${initialPosition.left - padding}px`;
  canvas.style.top = `${initialPosition.top - padding}px`;
  canvas.width = Math.ceil(canvasWidth * dpr);
  canvas.height = Math.ceil(canvasHeight * dpr);
  canvas.style.width = `${canvasWidth}px`;
  canvas.style.height = `${canvasHeight}px`;
  const layer = document.createElement("div");
  layer.className = "paperMotionLayer";
  layer.appendChild(canvas);
  document.body.appendChild(layer);
  const gradient = ctx.createLinearGradient(0, 0, width * 0.17, height);
  gradient.addColorStop(0, "#fff9d9");
  gradient.addColorStop(1, "#fff2b9");
  const rows = 48;
  const cols = 24;
  const focal = Math.max(width, height) * (560 / 180);
  note.inert = true;
  let start;
  const finish = () => {
    note.classList.remove("noteWaiting", "noteRevealing");
    note.style.removeProperty("clip-path");
    note.inert = false;
    layer.remove();
    window.handDrawnFrames?.animate(note);
  };
  const frame = now => {
    start ??= now;
    const elapsed = now - start;
    const descent = Math.min(elapsed / 180, 1);
    const approach = descent * descent * (3 - 2 * descent);
    const time = Math.max(0, Math.min((elapsed - 140) / 340, 1));
    if (time >= 1 || innerWidth !== viewportWidth || innerHeight !== viewportHeight
        || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    const position = note.getBoundingClientRect();
    canvas.style.left = `${position.left - padding}px`;
    canvas.style.top = `${position.top - padding}px`;
    const base = paperShape(time, rows, height, approach);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.translate(padding + width / 2, padding + height / 2 + base.anchorY);
    ctx.rotate(-5 * (1 - base.approach) * Math.PI / 180);
    ctx.translate(-width / 2, -height / 2);
    const lift = 1 - approach;
    canvas.style.filter = lift > 0 ? `drop-shadow(${12 * lift}px ${22 * lift}px ${12 * lift}px rgba(48, 48, 32, ${0.16 * lift}))` : "none";
    const shapes = [];
    for (let col = 0; col <= cols; ++col) {
      const side = col / cols;
      const lead = 0.34 * (1 - side) * time * (1 - time) * 4;
      const shape = paperShape(Math.min(time + lead, 1), rows, height, approach);
      for (const point of shape.points) {
        point.x = width / 2 + (side * width - width / 2) * focal / (focal - point.z);
      }
      shapes.push(shape);
    }
    const traceRows = (top, bottom) => {
      ctx.beginPath();
      for (let col = 0; col <= cols; ++col) {
        const point = shapes[col].points[top];
        if (col === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }
      for (let row = top + 1; row <= bottom; ++row) {
        const point = shapes[cols].points[row];
        ctx.lineTo(point.x, point.y);
      }
      for (let col = cols - 1; col >= 0; --col) {
        const point = shapes[col].points[bottom];
        ctx.lineTo(point.x, point.y);
      }
      for (let row = bottom - 1; row > top; --row) {
        const point = shapes[0].points[row];
        ctx.lineTo(point.x, point.y);
      }
      ctx.closePath();
    };
    traceRows(0, rows);
    ctx.fillStyle = gradient;
    ctx.fill();
    for (let row = 0; row < rows; ++row) {
      const angle = shapes[Math.floor(cols / 2)].angles[row];
      const shade = angle / 78 * 0.046;
      if (shade <= 0.002) continue;
      traceRows(row, row + 1);
      ctx.fillStyle = `rgba(55,44,20,${shade})`;
      ctx.fill();
    }
    if (approach === 1) {
      const edge = shapes.map((shape, col) => [col * width / cols, shape.adhesion * height]);
      const polygon = [[0, 0], [width, 0], ...edge.slice().reverse()];
      note.style.clipPath = `polygon(${polygon.map(([x, y]) => `${x}px ${y}px`).join(",")})`;
      note.classList.add("noteRevealing");
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      polygon.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.closePath();
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

if (!matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
  const noteObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      noteObserver.unobserve(entry.target);
      Promise.all([document.fonts.ready, wasmReady]).then(() => animateStickNote(entry.target));
    }
  }, { threshold: 0.12 });
  document.querySelectorAll(".graphNote").forEach(note => {
    note.classList.add("noteWaiting");
    noteObserver.observe(note);
  });
  window.handDrawnFrames?.render();
}

let noteDrag;

for (const note of document.querySelectorAll(".graphNote")) {
  for (const edge of ["top", "right", "bottom", "left"]) {
    const grip = document.createElement("button");
    grip.type = "button";
    grip.className = "noteGrip";
    grip.dataset.edge = edge;
    grip.style[edge] = "0";
    grip.setAttribute("aria-label", `Move note (${edge})`);
    note.appendChild(grip);
  }
  note.addEventListener("pointerdown", event => {
    const grip = event.target.closest(".noteGrip");
    if (!grip || event.button !== 0 || note.inert || noteDrag) return;
    event.preventDefault();
    noteDrag = {
      note, grip, pointerId: event.pointerId,
      startX: event.pageX,
      startY: event.pageY,
      left: parseFloat(note.style.left) || 0,
      top: parseFloat(note.style.top) || 0
    };
    grip.setPointerCapture(event.pointerId);
    document.querySelectorAll(".graphNote").forEach(other => { other.style.zIndex = "1"; });
    note.style.zIndex = "2";
    window.handDrawnFrames?.pause(note);
    note.classList.add("noteDragging");
  });
}

window.addEventListener("pointermove", event => {
  if (!noteDrag || event.pointerId !== noteDrag.pointerId) return;
  event.preventDefault();
  noteDrag.note.style.left = `${noteDrag.left + event.pageX - noteDrag.startX}px`;
  noteDrag.note.style.top = `${noteDrag.top + event.pageY - noteDrag.startY}px`;
  window.handDrawnFrames?.render();
}, { passive: false });

function finishNoteDrag(event) {
  if (!noteDrag || event.pointerId !== noteDrag.pointerId) return;
  const { note, grip, pointerId } = noteDrag;
  noteDrag = undefined;
  if (grip.hasPointerCapture(pointerId)) grip.releasePointerCapture(pointerId);
  note.classList.remove("noteDragging");
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    note.classList.add("noteWaiting");
    animateStickNote(note);
  } else {
    window.handDrawnFrames?.animate(note);
  }
}

window.addEventListener("pointerup", finishNoteDrag);
window.addEventListener("pointercancel", finishNoteDrag);
window.addEventListener("lostpointercapture", finishNoteDrag);
