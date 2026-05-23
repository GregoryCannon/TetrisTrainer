/**
 * Handle UI animations that are indepedent of the main tetris game
 */
import { BOARD_HEIGHT, DISPLAY_FULL_WIDTH } from "./constants.js";

// Get elements
const mainCanvas = document.getElementById("main-canvas");
const leftPanelOpenToggle = document.getElementById("left-panel-toggle-button");
const rightPanelOpenToggle = document.getElementById(
  "right-panel-toggle-button"
);

const leftPanel = document.getElementById("left-panel");
const leftPanelInner = document.getElementById("left-panel-inner");
const rightPanelInner = document.getElementById("engine-analysis");

leftPanel.style.minHeight = BOARD_HEIGHT + 60;

// Resize the canvas based on the square size
mainCanvas.setAttribute("height", BOARD_HEIGHT);
mainCanvas.setAttribute("width", DISPLAY_FULL_WIDTH);

leftPanelOpenToggle.innerText = "Show";
leftPanelInner.style.visibility = "hidden";
rightPanelOpenToggle.innerText = "Show";
rightPanelInner.style.visibility = "hidden";

leftPanelOpenToggle.addEventListener("click", function (e) {
  if (leftPanelInner.style.visibility != "visible") {
    leftPanelInner.style.visibility = "visible";
    leftPanelOpenToggle.innerText = "Hide";
  } else {
    leftPanelInner.style.visibility = "hidden";
    leftPanelOpenToggle.innerText = "Show";
  }
});

rightPanelOpenToggle.addEventListener("click", function (e) {
  if (rightPanelInner.style.visibility != "visible") {
    rightPanelInner.style.visibility = "visible";
    rightPanelOpenToggle.innerText = "Hide";
  } else {
    rightPanelInner.style.visibility = "hidden";
    rightPanelOpenToggle.innerText = "Show";
  }
});
