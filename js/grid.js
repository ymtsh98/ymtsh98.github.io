const gridPaper = (() => {
  const defaultDuration = 600;
  const defaultGridSize = 32;
  const defaultLineColor = "rgba(78, 111, 149, 0.5)";

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const easeInOut = (value) => value * value * (3 - 2 * value);

  const getCssVariable = (name, fallback) => (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  );

  const getCssNumber = (name, fallback) => {
    const value = Number.parseFloat(getCssVariable(name, `${fallback}`));

    return Number.isFinite(value) ? value : fallback;
  };

  const getFirstGridLine = (scrollOffset, gridOffset, gridSize) => (
    gridOffset + Math.floor((scrollOffset - gridOffset) / gridSize) * gridSize - scrollOffset
  );

  const createStrokes = ({ width, height, gridSize, offsetX, offsetY, scrollX, scrollY, duration }) => {
    const strokes = [];
    const createStroke = (axis, position, length) => {
      const strokeDuration = 220 + Math.random() * 400;
      const direction = Math.random() < 0.5 ? 1 : -1;

      strokes.push({
        axis,
        position,
        length,
        direction,
        start: direction > 0 ? 0 : length,
        delay: Math.random() * (duration - strokeDuration),
        duration: strokeDuration,
        lastProgress: 0
      });
    };

    for (let x = getFirstGridLine(scrollX, offsetX, gridSize); x <= width; x += gridSize) {
      createStroke("vertical", x + 0.5, height);
    }

    for (let y = getFirstGridLine(scrollY, offsetY, gridSize); y <= height; y += gridSize) {
      createStroke("horizontal", y + 0.5, width);
    }

    return strokes;
  };

  const writeOnCanvas = (canvas, context, options = {}) => {
    const duration = options.duration || defaultDuration;
    const gridSize = Math.max(getCssNumber("--grid-size", defaultGridSize), 1);
    const lineColor = getCssVariable("--grid-line-restore", defaultLineColor);
    const width = options.width || canvas.clientWidth || canvas.width;
    const height = options.height || canvas.clientHeight || canvas.height;
    const offsetX = getCssNumber("--grid-offset-x", 0);
    const offsetY = getCssNumber("--grid-offset-y", 0);
    const scrollX = options.scrollX ?? window.scrollX ?? 0;
    const scrollY = options.scrollY ?? window.scrollY ?? 0;
    const strokes = createStrokes({
      width,
      height,
      gridSize,
      offsetX,
      offsetY,
      scrollX,
      scrollY,
      duration
    });
    const complete = options.onComplete || (() => {});
    const startTime = performance.now();
    let frame;
    let cancelled = false;

    const draw = (now) => {
      if (cancelled) {
        return;
      }

      const progress = Math.min((now - startTime) / duration, 1);
      const elapsed = easeInOut(progress) * duration;

      context.globalAlpha = 1;
      context.filter = "none";
      context.strokeStyle = lineColor;
      context.lineWidth = 1;
      context.lineCap = "round";
      context.beginPath();

      strokes.forEach((stroke) => {
        const strokeProgress = clamp((elapsed - stroke.delay) / stroke.duration, 0, 1);

        if (strokeProgress <= stroke.lastProgress) {
          return;
        }

        const from = stroke.start + stroke.direction * stroke.length * stroke.lastProgress;
        const to = stroke.start + stroke.direction * stroke.length * strokeProgress;

        if (stroke.axis === "vertical") {
          context.moveTo(stroke.position, from);
          context.lineTo(stroke.position, to);
        } else {
          context.moveTo(from, stroke.position);
          context.lineTo(to, stroke.position);
        }

        stroke.lastProgress = strokeProgress;
      });

      context.stroke();

      if (progress < 1) {
        frame = requestAnimationFrame(draw);
        return;
      }

      complete();
    };

    frame = requestAnimationFrame(draw);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  };

  return { writeOnCanvas };
})();

window.gridPaper = gridPaper;
