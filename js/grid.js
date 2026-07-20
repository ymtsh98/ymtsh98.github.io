const gridPaper = (() => {
  const defaultDuration = 600;
  const defaultGridSize = 24;
  const defaultLineColor = "rgba(78, 111, 149, 0.5)";

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const easeInOut = (value) => value * value * (3 - 2 * value);

  const getCssVariable = (name, fallback) => (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  );

  const createStrokes = (canvas, gridSize, duration) => {
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

    for (let x = 0; x <= canvas.width; x += gridSize) {
      createStroke("vertical", x + 0.5, canvas.height);
    }

    for (let y = 0; y <= canvas.height; y += gridSize) {
      createStroke("horizontal", y + 0.5, canvas.width);
    }

    return strokes;
  };

  const writeOnCanvas = (canvas, context, options = {}) => {
    const duration = options.duration || defaultDuration;
    const gridSize = Number.parseFloat(getCssVariable("--grid-size", `${defaultGridSize}`))
      || defaultGridSize;
    const lineColor = getCssVariable("--grid-line-restore", defaultLineColor);
    const strokes = createStrokes(canvas, gridSize, duration);
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
