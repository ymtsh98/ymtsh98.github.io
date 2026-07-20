let galleryColorFadeEffect;

const createGalleryColorFadeEffect = () => {
  galleryColorFadeEffect = document.createElement("div");

  galleryColorFadeEffect.className = "galleryColorFade";
  galleryColorFadeEffect.setAttribute("aria-hidden", "true");

  galleryColorFadeEffect.addEventListener("animationend", (event) => {
    if (event.target === galleryColorFadeEffect) {
      galleryColorFadeEffect.classList.remove("is-active");
    }
  });

  document.body.insertAdjacentElement("afterbegin", galleryColorFadeEffect);
};

const playGalleryColorFadeEffect = () => {
  galleryColorFadeEffect.classList.remove("is-active");
  void galleryColorFadeEffect.offsetWidth;
  galleryColorFadeEffect.classList.add("is-active");
};

createGalleryColorFadeEffect();

document.addEventListener("gallery:imageleave", () => {
  playGalleryColorFadeEffect();
});
