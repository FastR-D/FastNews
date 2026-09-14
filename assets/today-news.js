(() => {
  const card = document.getElementById("todayNewsCard");
  if (!card || card.tagName !== "DETAILS" || card.classList.contains("is-empty")) return;
  const panel = document.getElementById("todayNewsPanel");
  if (!panel) return;

  const home = card;
  let ported = false;

  function placePanel() {
    const face = card.querySelector(".today-news-face") || card;
    const rect = face.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 32);
    panel.style.width = `${width}px`;
    let left = window.innerWidth > 920 ? rect.left - 10 : rect.left + (rect.width / 2) - (width / 2);
    left = Math.max(16, Math.min(left, window.innerWidth - width - 16));
    panel.style.left = `${left}px`;
    let top = rect.bottom - 4;
    panel.style.top = `${top}px`;
    const height = panel.getBoundingClientRect().height;
    if (top + height > window.innerHeight - 12 && rect.top - height > 12) {
      top = rect.top - height + 8;
    }
    panel.style.top = `${Math.max(12, top)}px`;
  }

  function portalOpen() {
    if (!ported) {
      document.body.appendChild(panel);
      panel.classList.add("is-ported");
      ported = true;
    }
    placePanel();
  }

  function portalClose() {
    if (!ported) return;
    home.appendChild(panel);
    panel.classList.remove("is-ported");
    panel.style.left = "";
    panel.style.top = "";
    panel.style.width = "";
    ported = false;
  }

  function sync() {
    if (card.open) portalOpen();
    else portalClose();
  }

  card.addEventListener("toggle", sync);
  window.addEventListener("resize", () => { if (card.open) placePanel(); });
  window.addEventListener("scroll", () => { if (card.open) placePanel(); }, true);

  document.addEventListener("click", (event) => {
    if (!card.open) return;
    const target = event.target;
    if (!card.contains(target) && !panel.contains(target)) card.open = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") card.open = false;
  });
  if (card.open) sync();
})();
