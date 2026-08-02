(() => {
  const toggle = document.querySelector("[data-tools-toggle]");
  const menu = document.getElementById("toolsMenu");

  if (!toggle || !menu) {
    return;
  }

  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", `${open}`);
    menu.hidden = !open;
  };

  toggle.addEventListener("click", () => {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || menu.hidden) {
      return;
    }

    setOpen(false);
    toggle.focus();
  });
})();
