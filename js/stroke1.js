const stroke1Tiles = document.querySelectorAll(".stroke1Tile");

stroke1Tiles.forEach((tile) => {
  const image = tile.querySelector(".stroke1");

  if (!image) {
    return;
  }

  const thumbnailSrc = image.getAttribute("src");
  const hoverSrc = image.dataset.strokeHoverSrc;

  if (!thumbnailSrc || !hoverSrc) {
    return;
  }

  const hoverImage = new Image();
  hoverImage.src = hoverSrc;

  tile.addEventListener("mouseenter", () => {
    const rect = image.getBoundingClientRect();
    const originX = rect.left + rect.width * 0.5;
    const originY = rect.top + rect.height * 0.5;

    document.body.style.setProperty("--stroke1-origin-x", `${originX}px`);
    document.body.style.setProperty("--stroke1-origin-y", `${originY}px`);

    window.siteBackgroundEffects?.cancelGridRestore();
    document.body.classList.add("stroke1Active");
    image.src = hoverSrc;
  });

  tile.addEventListener("mouseleave", () => {
    image.src = thumbnailSrc;
    window.siteBackgroundEffects?.restoreGridFromColor("#ffffff");
    document.body.classList.remove("stroke1Active");
  });
});
