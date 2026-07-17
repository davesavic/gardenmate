import "../js/bridge.js";
import "../js/garden.js";
import "../js/ui.js";

// GardenMate frontend entry
document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

function initApp() {
  const canvas = document.getElementById("garden-canvas");
  let renderer = null;
  if (canvas) {
    renderer = new GardenRenderer(canvas);
    renderer.startRender();
    window.__gardenRenderer = renderer;
  }
  new UIController(renderer);
  initGardenClock();
  console.log("[gardenmate] ready");
}

function initGardenClock() {
  const el = document.getElementById("garden-clock");
  if (!el) return;
  const update = () => {
    const now = new Date();
    const hr = now.getHours() + now.getMinutes() / 60;
    let phase = "night";
    if (hr >= 5 && hr < 7.5) phase = "dawn";
    else if (hr >= 7.5 && hr < 17.5) phase = "day";
    else if (hr >= 17.5 && hr < 20.5) phase = "dusk";
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    el.textContent = `${hh}:${mm} · ${phase}`;
  };
  update();
  setInterval(update, 30000);
}
