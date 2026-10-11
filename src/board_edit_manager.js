const mainCanvas = document.getElementById("main-canvas");

import { SQUARE_SIZE, SquareState } from "./constants.js";

export function BoardEditManager(board, canvas) {
  this.board = board;
  this.canvas = canvas;
  this.mouseIsDown = false;
  this.squaresToggled = new Set();
  this.dragMode = DragMode.NONE;
}

// We want the drag action to either only add squares or only remove squares, not mix the two
const DragMode = Object.freeze({
  ADDING: "adding",
  REMOVING: "removing",
  NONE: "none",
});

function getRowAndColOfMouseCoords(event) {
  const rect = mainCanvas.getBoundingClientRect();
  // The canvas may be CSS-scaled larger than its backing store (which stays
  // crisp via image-rendering: pixelated), so map through the scale factor
  // instead of assuming 1:1 pixels.
  const scaleX = rect.width / mainCanvas.width;
  const scaleY = rect.height / mainCanvas.height;
  const x = (event.clientX - rect.left) / scaleX;
  const y = (event.clientY - rect.top) / scaleY;
  const r = Math.floor(y / SQUARE_SIZE);
  const c = Math.floor(x / SQUARE_SIZE);
  return [r, c];
}

// A predictable way to get a string key from a pair of integers
function getStringKey(numA, numB) {
  return numA + "," + numB;
}

BoardEditManager.prototype.toggleCell = function (r, c) {
  // Add this to the toggled set so it doesn't flicker on and off during drag
  this.squaresToggled.add(getStringKey(r, c));

  this.board[r][c] =
    this.board[r][c] == SquareState.EMPTY
      ? SquareState.COLOR1
      : SquareState.EMPTY;
  this.canvas.drawBoard();
  this.canvas.drawCurrentPiece();
};

BoardEditManager.prototype.onMouseDown = function (event) {
  let r, c;
  [r, c] = getRowAndColOfMouseCoords(event);
  this.mouseIsDown = true;
  this.dragMode =
    this.board[r][c] == SquareState.EMPTY ? DragMode.ADDING : DragMode.REMOVING;
  this.toggleCell(r, c);
};

BoardEditManager.prototype.onMouseDrag = function (event) {
  if (!this.mouseIsDown) {
    return;
  }
  let r, c;
  [r, c] = getRowAndColOfMouseCoords(event);
  const cellShouldBeFlipped =
    this.dragMode == DragMode.ADDING
      ? this.board[r][c] == SquareState.EMPTY
      : this.board[r][c] != SquareState.EMPTY;
  if (cellShouldBeFlipped && !this.squaresToggled.has(getStringKey(r, c))) {
    this.toggleCell(r, c);
  }
};

BoardEditManager.prototype.onMouseUp = function (event) {
  this.mouseIsDown = false;
  this.squaresToggled = new Set();
};
