/**
 * Handle UI animations that are indepedent of the main tetris game
 */
import { BOARD_HEIGHT, DISPLAY_FULL_WIDTH } from "./constants.js";

// Get elements
const mainCanvas = document.getElementById("main-canvas");
const leftTab = document.getElementById("left-drawer-tab");
const rightTab = document.getElementById("right-drawer-tab");

// Resize the canvas based on the square size
mainCanvas.setAttribute("height", BOARD_HEIGHT);
mainCanvas.setAttribute("width", DISPLAY_FULL_WIDTH);

// Both drawers are closed by default (no .open class on body)
function setDrawer(side, open) {
  const className = side === "left" ? "left-open" : "right-open";
  document.body.classList.toggle(className, open);
  const tab = side === "left" ? leftTab : rightTab;
  if (tab) {
    tab.setAttribute("aria-expanded", open ? "true" : "false");
  }
}

function isDrawerOpen(side) {
  return document.body.classList.contains(
    side === "left" ? "left-open" : "right-open"
  );
}

if (leftTab) {
  leftTab.addEventListener("click", function (e) {
    e.stopPropagation();
    setDrawer("left", !isDrawerOpen("left"));
  });
}

if (rightTab) {
  rightTab.addEventListener("click", function (e) {
    e.stopPropagation();
    setDrawer("right", !isDrawerOpen("right"));
  });
}

// Esc closes any open drawer. No click-outside close and no auto-open,
// so the board keeps focus during gameplay.
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    setDrawer("left", false);
    setDrawer("right", false);
  }
});
