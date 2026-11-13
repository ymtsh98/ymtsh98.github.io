const desktopGalleryQuery = window.matchMedia("(min-width: 761px)");
const imageGalleries = Array.from(document.querySelectorAll(".gallery:not(.blogGallery)"));

const getHorizontalPadding = (element) => {
  const style = getComputedStyle(element);
  return (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
};

const getMediaAspectRatio = (media) => {
  const width = media?.naturalWidth || media?.videoWidth;
  const height = media?.naturalHeight || media?.videoHeight;
  return width && height ? width / height : 0;
};

const balanceImageGallery = (gallery) => {
  const tiles = Array.from(gallery.querySelectorAll(":scope > .tile"));

  if (!desktopGalleryQuery.matches || tiles.length !== 2) {
    gallery.style.removeProperty("--image-gallery-columns");
    return;
  }

  const [firstAspectRatio, secondAspectRatio] = tiles.map((tile) => (
    Array.from(tile.querySelectorAll(".image"), getMediaAspectRatio).find(Boolean)
  ));
  if (!firstAspectRatio || !secondAspectRatio) {
    return;
  }

  const imageWidthRatio = Math.sqrt(firstAspectRatio / secondAspectRatio);
  const gap = parseFloat(getComputedStyle(gallery).columnGap) || 0;
  const firstPadding = getHorizontalPadding(tiles[0]);
  const secondPadding = getHorizontalPadding(tiles[1]);
  const availableImageWidth = gallery.clientWidth - gap - firstPadding - secondPadding;

  if (availableImageWidth <= 0) {
    return;
  }

  const secondImageWidth = availableImageWidth / (imageWidthRatio + 1);
  const firstImageWidth = imageWidthRatio * secondImageWidth;

  gallery.style.setProperty(
    "--image-gallery-columns",
    `${(firstImageWidth + firstPadding).toFixed(3)}px ${(secondImageWidth + secondPadding).toFixed(3)}px`
  );
};

let galleryLayoutFrame;

const scheduleImageGalleryBalance = () => {
  if (!galleryLayoutFrame) {
    galleryLayoutFrame = requestAnimationFrame(() => {
      galleryLayoutFrame = undefined;
      imageGalleries.forEach(balanceImageGallery);
    });
  }
};

imageGalleries.forEach((gallery) => {
  const images = gallery.querySelectorAll(".image");

  images.forEach((image) => {
    image.addEventListener(image.tagName === "VIDEO" ? "loadedmetadata" : "load", scheduleImageGalleryBalance, { once: true });
  });
});

if ("ResizeObserver" in window) {
  const galleryResizeObserver = new ResizeObserver(scheduleImageGalleryBalance);
  imageGalleries.forEach((gallery) => galleryResizeObserver.observe(gallery));
} else {
  window.addEventListener("resize", scheduleImageGalleryBalance, { passive: true });
}

desktopGalleryQuery.addEventListener("change", scheduleImageGalleryBalance);
scheduleImageGalleryBalance();
