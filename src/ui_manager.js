/**
 * Handle UI animations that are indepedent of the main tetris game
 */
import { BOARD_HEIGHT, DISPLAY_FULL_WIDTH } from "./constants.js";
import { getUiPrefs, saveUiPrefs } from "./utils.js";

// Get elements
const mainCanvas = document.getElementById("main-canvas");
const leftTab = document.getElementById("left-drawer-tab");
const rightTab = document.getElementById("right-drawer-tab");

// Resize the canvas based on the square size
mainCanvas.setAttribute("height", BOARD_HEIGHT);
mainCanvas.setAttribute("width", DISPLAY_FULL_WIDTH);

function applyDrawer(side, open) {
  const className = side === "left" ? "left-open" : "right-open";
  document.body.classList.toggle(className, open);
  const tab = side === "left" ? leftTab : rightTab;
  if (tab) {
    tab.setAttribute("aria-expanded", open ? "true" : "false");
  }
}

function setDrawer(side, open) {
  applyDrawer(side, open);
  // The analysis drawer's last state doubles as its "open on load" preference.
  if (side === "right") {
    const prefs = getUiPrefs();
    prefs.rightPanelOpen = open;
    saveUiPrefs(prefs);
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

// Restore the analysis drawer's saved open/closed state. It defaults to open
// on wide screens (where it docks beside the board) and closed on narrow
// ones, where it would cover the board. Applied without persisting, so the
// default itself never gets written into the cookie.
const savedRightPanelOpen = getUiPrefs().rightPanelOpen;
const defaultRightPanelOpen = window.matchMedia("(min-width: 701px)").matches;
applyDrawer(
  "right",
  savedRightPanelOpen != null ? savedRightPanelOpen : defaultRightPanelOpen
);
