import {
  NUM_ROW,
  NUM_COLUMN,
  SQUARE_SIZE,
  BOARD_HEIGHT,
  DISPLAY_FULL_WIDTH,
} from "./constants.js";

import { PIECE_LOOKUP } from "./tetrominoes.js";

const canvas = document.getElementById("live-hint-canvas");
const ctx = canvas.getContext("2d");

canvas.width = DISPLAY_FULL_WIDTH;
canvas.height = BOARD_HEIGHT;

export function clearLiveHint() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function showLiveHint(move, pieceId, boardStr) {
  clearLiveHint();

  const placement = move?.firstPlacement;
  const rotations = PIECE_LOOKUP[pieceId]?.[0];

  if (
    !Array.isArray(placement) ||
    placement.length !== 3 ||
    !placement.every(Number.isInteger) ||
    !rotations
  ) {
    console.warn("[LiveHint] Invalid placement:", move);
    return;
  }

  const [rotation, shift, yFromSpawn] = placement;

  const rotationIndex =
    ((rotation % rotations.length) + rotations.length) % rotations.length;

  const shape = rotations[rotationIndex];

  // StackRabbit's shift is relative to spawn X = 3.
  const pieceX = 3 + shift;

  // StackRabbit's Y is relative to initial spawn Y.
  const initialY = pieceId === "I" ? -2 : -1;
  const pieceY = initialY + yFromSpawn;

  const cells = [];

  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c]) {
        cells.push({
          row: pieceY + r,
          col: pieceX + c,
        });
      }
    }
  }

  if (
    cells.length !== 4 ||
    cells.some(
      ({ row, col }) =>
        row < 0 || row >= NUM_ROW || col < 0 || col >= NUM_COLUMN
    )
  ) {
    console.warn("[LiveHint] Invalid cells:", cells);
    return;
  }

  // Verify the suggested piece does not overlap the
  // original locked board.
  if (
    boardStr?.length === NUM_ROW * NUM_COLUMN &&
    cells.some(({ row, col }) => boardStr[row * NUM_COLUMN + col] === "1")
  ) {
    console.warn("[LiveHint] Placement overlaps board:", cells);
    return;
  }

  ctx.fillStyle = "rgba(255, 213, 74, 0.20)";
  ctx.strokeStyle = "#FFD54A";
  ctx.lineWidth = 2;

  for (const { row, col } of cells) {
    const x = col * SQUARE_SIZE;
    const y = row * SQUARE_SIZE;

    ctx.fillRect(x + 2, y + 2, SQUARE_SIZE - 4, SQUARE_SIZE - 4);

    ctx.strokeRect(x + 2, y + 2, SQUARE_SIZE - 4, SQUARE_SIZE - 4);
  }

  console.log("[LiveHint] Highlighted cells:", cells);
}
