(() => {
  const edgeOffsetMax = 0.38;
  const hostSelector = ".profileLinks a, .profileLinks button, .blogLinks, .tile, .contentFrame, .siteFooter";
  const observerSelector = `.page, .profileLinks, .gallery, ${hostSelector}`;
  const svgNamespace = "http://www.w3.org/2000/svg";
  const defaultMinimumEndpointOffset = 12;
  let connectionFrame;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const getMinimumEndpointOffset = () => {
    const value = Number.parseFloat(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--connection-min-endpoint-offset")
    );

    return Number.isFinite(value)
      ? Math.max(value, 0)
      : defaultMinimumEndpointOffset;
  };

  const getHosts = () => {
    const pageX = window.scrollX;
    const pageY = window.scrollY;

    return Array.from(document.querySelectorAll(hostSelector)).map((element) => {
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

  const getLayerSize = () => {
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

  const stableRandom = (seed) => {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  };

  const getEdgeOffset = (from, to) => {
    const seed = (from + 1) * 31 + (to + 1) * 17;

    return (stableRandom(seed) * 2 - 1) * edgeOffsetMax;
  };

  const getAxis = (first, second) => {
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

    if (horizontalGap === verticalGap) {
      return Math.abs(first.center.x - second.center.x) >= Math.abs(first.center.y - second.center.y)
        ? "horizontal"
        : "vertical";
    }

    return horizontalGap > verticalGap ? "horizontal" : "vertical";
  };

  const getBorderPoint = ({ rect, center }, target, axis, edgeOffset = 0) => {
    const inset = Math.min(10, Math.min(rect.width, rect.height) / 4);
    const direction = Math.sign(
      axis === "horizontal" ? target.x - center.x : target.y - center.y
    ) || 1;

    if (axis === "horizontal") {
      return {
        x: center.x + direction * rect.width / 2,
        y: clamp(center.y + edgeOffset * rect.height, rect.top + inset, rect.bottom - inset)
      };
    }

    return {
      x: clamp(center.x + edgeOffset * rect.width, rect.left + inset, rect.right - inset),
      y: center.y + direction * rect.height / 2
    };
  };

  const getCrossAxisBounds = ({ rect }, axis) => {
    const inset = Math.min(10, Math.min(rect.width, rect.height) / 4);

    return axis === "horizontal"
      ? { min: rect.top + inset, max: rect.bottom - inset }
      : { min: rect.left + inset, max: rect.right - inset };
  };

  const getConnectionPoints = (first, second, axis, from, to, minimumOffset) => {
    const crossAxis = axis === "horizontal" ? "y" : "x";
    const start = getBorderPoint(
      first,
      second.center,
      axis,
      getEdgeOffset(from, to)
    );
    const end = getBorderPoint(
      second,
      first.center,
      axis,
      getEdgeOffset(to, from)
    );

    if (Math.abs(end[crossAxis] - start[crossAxis]) >= minimumOffset) {
      return { start, end };
    }

    const startBounds = getCrossAxisBounds(first, axis);
    const endBounds = getCrossAxisBounds(second, axis);
    const candidates = [
      { start, end },
      {
        start,
        end: {
          ...end,
          [crossAxis]: clamp(
            start[crossAxis] + minimumOffset,
            endBounds.min,
            endBounds.max
          )
        }
      },
      {
        start,
        end: {
          ...end,
          [crossAxis]: clamp(
            start[crossAxis] - minimumOffset,
            endBounds.min,
            endBounds.max
          )
        }
      },
      {
        start: {
          ...start,
          [crossAxis]: clamp(
            end[crossAxis] - minimumOffset,
            startBounds.min,
            startBounds.max
          )
        },
        end
      },
      {
        start: {
          ...start,
          [crossAxis]: clamp(
            end[crossAxis] + minimumOffset,
            startBounds.min,
            startBounds.max
          )
        },
        end
      },
      {
        start: { ...start, [crossAxis]: startBounds.min },
        end: { ...end, [crossAxis]: endBounds.max }
      },
      {
        start: { ...start, [crossAxis]: startBounds.max },
        end: { ...end, [crossAxis]: endBounds.min }
      }
    ];
    const difference = ({ start: candidateStart, end: candidateEnd }) => (
      Math.abs(candidateEnd[crossAxis] - candidateStart[crossAxis])
    );
    const adjustment = ({ start: candidateStart, end: candidateEnd }) => (
      Math.abs(candidateStart[crossAxis] - start[crossAxis])
      + Math.abs(candidateEnd[crossAxis] - end[crossAxis])
    );
    const matchingCandidate = candidates
      .filter((candidate) => difference(candidate) >= minimumOffset)
      .sort((firstCandidate, secondCandidate) => (
        adjustment(firstCandidate) - adjustment(secondCandidate)
      ))[0];

    if (matchingCandidate) {
      return matchingCandidate;
    }

    const furthestCandidate = candidates.sort((firstCandidate, secondCandidate) => (
      difference(secondCandidate) - difference(firstCandidate)
    ))[0];

    return furthestCandidate;
  };

  const getTwoBendPoints = (start, end, axis) => {
    if (axis === "horizontal") {
      const bendX = (start.x + end.x) / 2;
      return [
        start,
        { x: bendX, y: start.y },
        { x: bendX, y: end.y },
        end
      ];
    }

    const bendY = (start.y + end.y) / 2;
    return [
      start,
      { x: start.x, y: bendY },
      { x: end.x, y: bendY },
      end
    ];
  };

  // Each connection is a single path: no overpainted segments means no ink pools along the route.
  const getHandDrawnPath = (points, seed) => {
    const commands = [`M ${points[0].x} ${points[0].y}`];

    points.slice(1).forEach((to, edge) => {
      const from = points[edge];
      const horizontal = Math.abs(to.y - from.y) < 0.01;
      const length = horizontal ? Math.abs(to.x - from.x) : Math.abs(to.y - from.y);
      const direction = horizontal ? Math.sign(to.x - from.x) : Math.sign(to.y - from.y);

      for (let distance = 12; distance < length; distance += 12) {
        const taper = Math.sin(Math.PI * distance / length);
        const wobble = taper * (
          Math.sin(distance * 0.052 + seed * 0.91 + edge * 2.13) * 0.42
          + Math.sin(distance * 0.119 - seed * 0.47 + edge * 0.71) * 0.12
        );
        const point = horizontal
          ? { x: from.x + direction * distance, y: from.y + wobble }
          : { x: from.x + wobble, y: from.y + direction * distance };

        commands.push(`L ${point.x} ${point.y}`);
      }

      commands.push(`L ${to.x} ${to.y}`);
    });

    return commands.join(" ");
  };

  const getEdges = (hosts) => {
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

  const connectionLayer = document.createElementNS(svgNamespace, "svg");

  const draw = () => {
    connectionFrame = undefined;

    const { width, height } = getLayerSize();
    const hosts = getHosts();
    const minimumEndpointOffset = getMinimumEndpointOffset();
    const styles = getComputedStyle(document.documentElement);
    const ink = styles.getPropertyValue("--link-ink").trim()
      || styles.getPropertyValue("--connector").trim()
      || "#263f56";
    const paths = document.createDocumentFragment();

    connectionLayer.setAttribute("viewBox", `0 0 ${width} ${height}`);
    connectionLayer.setAttribute("width", width);
    connectionLayer.setAttribute("height", height);
    connectionLayer.style.width = `${width}px`;
    connectionLayer.style.height = `${height}px`;

    getEdges(hosts).forEach(({ from, to }) => {
      const axis = getAxis(hosts[from], hosts[to]);
      const { start, end } = getConnectionPoints(
        hosts[from],
        hosts[to],
        axis,
        from,
        to,
        minimumEndpointOffset
      );
      const path = document.createElementNS(svgNamespace, "path");

      path.setAttribute("d", getHandDrawnPath(
        getTwoBendPoints(start, end, axis),
        (from + 1) * 37 + (to + 1) * 19
      ));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", ink);
      path.setAttribute("stroke-linecap", "square");
      path.setAttribute("stroke-linejoin", "miter");
      path.setAttribute("stroke-width", "1.7");
      path.setAttribute("opacity", "0.82");
      paths.appendChild(path);
    });

    connectionLayer.replaceChildren(paths);
  };

  const schedule = () => {
    if (!connectionFrame) {
      connectionFrame = requestAnimationFrame(draw);
    }
  };

  connectionLayer.classList.add("boxConnections");
  connectionLayer.setAttribute("aria-hidden", "true");
  document.body.insertAdjacentElement("afterbegin", connectionLayer);

  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(schedule);
    const observeHosts = () => {
      document.querySelectorAll(observerSelector)
        .forEach((element) => resizeObserver.observe(element));
    };

    observeHosts();

    if ("MutationObserver" in window) {
      const page = document.querySelector(".page");

      if (page) {
        new MutationObserver(() => {
          observeHosts();
          schedule();
        }).observe(page, {
          attributes: true,
          attributeFilter: ["hidden"],
          childList: true,
          subtree: true
        });
      }
    }
  }

  window.addEventListener("load", schedule, { once: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", schedule, { passive: true });
  document.addEventListener("load", schedule, true);
  schedule();
})();
