const stroke1Tiles = document.querySelectorAll(".stroke1Tile");
const canUseStroke1HoverEffects = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? true;
const stroke1FadeDuration = 460;

window.galleryEffects ??= {
  activate(effect) {
    document.dispatchEvent?.(new CustomEvent("gallery:effectactivate", {
      detail: { effect }
    }));
  }
};

const isMovingToGalleryTile = (target) => Boolean(target?.closest?.(".gallery > .tile"));

stroke1Tiles.forEach((tile) => {
  const image = tile.querySelector(".stroke1");

  if (!image) {
    return;
  }

  const thumbnailSrc = image.getAttribute("src");
  const hoverSrc = image.dataset.strokeHoverSrc;
  let fadeTimer;
  let lastTouchActivation = Number.NEGATIVE_INFINITY;
  let isHoverImageLoading = false;
  let isHoverImageLoaded = false;
  let isActivationRequested = false;

  if (!thumbnailSrc || !hoverSrc) {
    return;
  }

  const hoverImage = new Image();

  const preloadHoverImage = (priority = "low") => {
    if (isHoverImageLoading || isHoverImageLoaded) {
      return;
    }

    isHoverImageLoading = true;
    hoverImage.fetchPriority = priority;
    hoverImage.src = hoverSrc;
  };

  const scheduleHoverPreload = () => {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(() => preloadHoverImage());
    } else {
      window.setTimeout(() => preloadHoverImage(), 0);
    }
  };

  if (document.readyState === "complete") {
    scheduleHoverPreload();
  } else {
    window.addEventListener("load", scheduleHoverPreload, { once: true });
  }

  const finishFade = () => {
    fadeTimer = undefined;
    document.body.classList.remove("stroke1Active", "stroke1Fading");
    document.body.style.removeProperty?.("--stroke1-fade-opacity");
    document.body.style.removeProperty?.("--stroke1-fade-transform");
    document.body.style.removeProperty?.("--stroke1-flash-fade-opacity");
    document.body.style.removeProperty?.("--stroke1-flash-fade-transform");
  };

  const captureStroke1FadeState = () => {
    if (typeof getComputedStyle !== "function") {
      return;
    }

    const before = getComputedStyle(document.body, "::before");
    const after = getComputedStyle(document.body, "::after");

    document.body.style.setProperty("--stroke1-fade-opacity", before.opacity);
    document.body.style.setProperty("--stroke1-fade-transform", before.transform);
    document.body.style.setProperty("--stroke1-flash-fade-opacity", after.opacity);
    document.body.style.setProperty("--stroke1-flash-fade-transform", after.transform);
  };

  const deactivateStroke1 = ({ fade = false, restoreGrid = false } = {}) => {
    isActivationRequested = false;
    window.clearTimeout?.(fadeTimer);
    image.src = thumbnailSrc;

    if (fade && document.body.classList.contains("stroke1Active")) {
      captureStroke1FadeState();
      document.body.classList.add("stroke1Fading");
      fadeTimer = window.setTimeout(finishFade, stroke1FadeDuration);
    } else {
      finishFade();
    }

    if (restoreGrid) {
      window.siteBackgroundEffects?.restoreGridFromTransparent?.();
    }
  };

  const startStroke1 = () => {
    window.galleryEffects.activate("stroke1");
    window.clearTimeout?.(fadeTimer);
    document.body.classList.remove("stroke1Active", "stroke1Fading");
    document.body.style.removeProperty?.("--stroke1-fade-opacity");
    document.body.style.removeProperty?.("--stroke1-fade-transform");
    document.body.style.removeProperty?.("--stroke1-flash-fade-opacity");
    document.body.style.removeProperty?.("--stroke1-flash-fade-transform");

    const rect = image.getBoundingClientRect();
    const originX = rect.left + rect.width * 0.5;
    const originY = rect.top + rect.height * 0.5;

    document.body.style.setProperty("--stroke1-origin-x", `${originX}px`);
    document.body.style.setProperty("--stroke1-origin-y", `${originY}px`);

    window.siteBackgroundEffects?.fadeOutEffect?.();
    document.body.offsetWidth;
    document.body.classList.add("stroke1Active");
    image.src = hoverSrc;
  };

  const activateStroke1 = () => {
    isActivationRequested = true;

    if (isHoverImageLoaded) {
      startStroke1();
    } else {
      preloadHoverImage("high");
    }
  };

  hoverImage.addEventListener("load", () => {
    isHoverImageLoading = false;
    isHoverImageLoaded = true;

    if (isActivationRequested) {
      startStroke1();
    }
  });

  hoverImage.addEventListener("error", () => {
    isHoverImageLoading = false;
    isActivationRequested = false;
  });

  document.addEventListener("gallery:effectactivate", (event) => {
    if (event.detail?.effect !== "stroke1") {
      deactivateStroke1({ fade: true });
    }
  });

  if (canUseStroke1HoverEffects) {
    tile.addEventListener("mouseenter", activateStroke1);
    tile.addEventListener("mouseleave", (event) => {
      deactivateStroke1({
        fade: true,
        restoreGrid: !isMovingToGalleryTile(event.relatedTarget)
      });
    });
    return;
  }

  image.addEventListener("pointerup", (event) => {
    if (event.pointerType !== "touch") {
      return;
    }

    lastTouchActivation = performance.now();
    activateStroke1();
  });

  image.addEventListener("click", () => {
    if (performance.now() - lastTouchActivation < 700) {
      return;
    }

    activateStroke1();
  });

  document.addEventListener("click", (event) => {
    if (
      (!isActivationRequested && !document.body.classList.contains("stroke1Active")) ||
      event.target?.closest?.(".image, a")
    ) {
      return;
    }

    deactivateStroke1({ fade: true, restoreGrid: true });
  });
});
