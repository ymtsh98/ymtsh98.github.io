const handDrawnFrames = (() => {
  const canvas = document.querySelector(".handDrawnFrames");
  const context = canvas?.getContext("2d");
  const targetSelector = ".profileLinks a, .profileLinks button, .blogLinks, .tile, .siteFooter, .contentFrame";

  if (!canvas || !context) {
    return undefined;
  }

  const getCssValue = (name, fallback) => (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  );

  // A repeatable combination of small waves makes the line feel drawn once, rather than animated.
  const wobble = (frame, edge, position) => (
    Math.sin(position * 0.035 + frame * 1.43 + edge) * 0.38
    + Math.sin(position * 0.083 - frame * 0.61 + edge * 0.7) * 0.13
    + Math.sin(position * 0.017 + frame * 2.11) * 0.08
  );

  const pressure = (frame, edge, position) => (
    0.66
    + Math.sin(position * 0.052 + frame * 0.87 + edge) * 0.08
    + Math.sin(position * 0.014 - frame * 1.27) * 0.05
  );

  const drawEdge = ({ from, to, frame, edge, color, weight = 1, startTrim = 0, endTrim = 0 }) => {
    const horizontal = Math.abs(to.y - from.y) < 0.01;
    const length = horizontal ? Math.abs(to.x - from.x) : Math.abs(to.y - from.y);
    const direction = horizontal ? Math.sign(to.x - from.x) : Math.sign(to.y - from.y);
    const drawingEnd = Math.max(startTrim, length - endTrim);
    let start = startTrim;
    let segment = 0;

    while (start < drawingEnd) {
      const segmentLength = 180
        + Math.sin(frame * 1.19 + edge * 2.37 + segment * 1.41) * 20
        + Math.sin(frame * 0.63 - edge * 1.17 + segment * 2.09) * 8;
      const overlap = 1 + Math.sin(frame * 0.91 + edge * 1.53 + segment * 1.77) * 0.45;
      const end = Math.min(start + segmentLength + overlap, drawingEnd);
      const midpoint = (start + end) / 2;
      const pointAt = (distance) => {
        const offset = wobble(frame, edge, distance);

        return horizontal
          ? { x: from.x + direction * distance, y: from.y + offset }
          : { x: from.x + offset, y: from.y + direction * distance };
      };

      context.beginPath();
      const firstPoint = pointAt(start);
      context.moveTo(firstPoint.x, firstPoint.y);

      for (let distance = start + 4; distance < end; distance += 4) {
        const point = pointAt(distance);
        context.lineTo(point.x, point.y);
      }

      const lastPoint = pointAt(end);
      context.lineTo(lastPoint.x, lastPoint.y);

      context.globalAlpha = pressure(frame, edge, midpoint);
      context.lineWidth = (1.0 + pressure(frame + 5, edge, midpoint) * 0.5) * weight;
      context.strokeStyle = color;
      context.stroke();

      start += segmentLength;
      segment += 1;
    }
  };

  const getEmphasizedEdge = (element) => {
    const matches = element.matches?.bind(element);

    if (matches?.(".profileLinks a, .profileLinks button")) {
      return 3;
    }

    if (matches?.(".blogLinks")) {
      return 1;
    }

    if (matches?.(".tile, .contentFrame")) {
      return 0;
    }

    if (matches?.(".siteFooter")) {
      return 2;
    }

    return undefined;
  };

  const drawFrame = (element, frame, color) => {
    const rect = element.getBoundingClientRect();
    const inset = 2;
    const left = rect.left + inset;
    const top = rect.top + inset;
    const right = rect.right - inset;
    const bottom = rect.bottom - inset;

    if (right - left < 8 || bottom - top < 8) {
      return;
    }

    const cornerGap = (corner) => (
      (frame * 5 + corner * 3) % 6 === 0
        ? 2.5 + (frame + corner) % 3
        : 0
    );
    const topLeftGap = cornerGap(0);
    const topRightGap = cornerGap(1);
    const bottomRightGap = cornerGap(2);
    const bottomLeftGap = cornerGap(3);
    const emphasizedEdge = getEmphasizedEdge(element);
    const getWeight = (edge) => edge === emphasizedEdge ? 3.0 : 1;

    drawEdge({ from: { x: left, y: top }, to: { x: right, y: top }, frame, edge: 0, color, weight: getWeight(0), startTrim: topLeftGap, endTrim: topRightGap });
    drawEdge({ from: { x: right, y: top }, to: { x: right, y: bottom }, frame, edge: 1, color, weight: getWeight(1), startTrim: topRightGap, endTrim: bottomRightGap });
    drawEdge({ from: { x: right, y: bottom }, to: { x: left, y: bottom }, frame, edge: 2, color, weight: getWeight(2), startTrim: bottomRightGap, endTrim: bottomLeftGap });
    drawEdge({ from: { x: left, y: bottom }, to: { x: left, y: top }, frame, edge: 3, color, weight: getWeight(3), startTrim: bottomLeftGap, endTrim: topLeftGap });
  };

  const render = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const color = getCssValue("--link-ink", "#263f56");

    canvas.width = Math.ceil(width * pixelRatio);
    canvas.height = Math.ceil(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.lineCap = "butt";
    context.lineJoin = "miter";

    Array.from(document.querySelectorAll(targetSelector)).forEach((element, frame) => {
      drawFrame(element, frame, color);
    });

    context.globalAlpha = 1;
  };

  let renderFrame;
  const scheduleRender = () => {
    cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(render);
  };

  const targets = Array.from(document.querySelectorAll(targetSelector));
  const resizeObserver = window.ResizeObserver && new ResizeObserver(scheduleRender);

  targets.forEach((target) => resizeObserver?.observe(target));
  render();
  document.body.classList.add("handDrawnFramesReady");
  window.addEventListener("resize", scheduleRender, { passive: true });
  window.addEventListener("scroll", scheduleRender, { passive: true });
  window.addEventListener("load", scheduleRender, { once: true });
  window.visualViewport?.addEventListener("resize", scheduleRender, { passive: true });
  document.fonts?.ready?.then(scheduleRender);

  new MutationObserver(scheduleRender).observe(document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ["class", "hidden", "style"]
  });

  return { render: scheduleRender };
})();

window.handDrawnFrames = handDrawnFrames;
