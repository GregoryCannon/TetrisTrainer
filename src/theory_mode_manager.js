import { NUM_ROW, NUM_COLUMN, SQUARE_SIZE, SquareState } from "./constants.js";

/**
 * Manages mouse-driven piece positioning, rotation, collision resolution,
 * and landing-spot projection for Theory Mode.
 */
export function TheoryModeManager(board, canvasElement) {
  this.board = board;
  this.canvasElement = canvasElement;
  this.lastClientX = null;
  this.lastClientY = null;
  this.placement = null;
}

function getTetrominoBounds(tetromino) {
  let minR = Infinity;
  let maxR = -Infinity;
  let minC = Infinity;
  let maxC = -Infinity;
  for (let r = 0; r < tetromino.length; r++) {
    for (let c = 0; c < tetromino[r].length; c++) {
      if (tetromino[r][c]) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  return { minR, maxR, minC, maxC };
}

function collides(board, tetromino, px, py) {
  for (let r = 0; r < tetromino.length; r++) {
    for (let c = 0; c < tetromino[r].length; c++) {
      if (!tetromino[r][c]) {
        continue;
      }
      const boardX = px + c;
      const boardY = py + r;
      if (boardX < 0 || boardX >= NUM_COLUMN || boardY >= NUM_ROW) {
        return true;
      }
      if (boardY >= 0 && board[boardY][boardX] !== SquareState.EMPTY) {
        return true;
      }
    }
  }
  return false;
}

TheoryModeManager.prototype.clientToBoardFloatCoords = function (
  clientX,
  clientY
) {
  const rect = this.canvasElement.getBoundingClientRect();
  const scaleX = rect.width / this.canvasElement.width;
  const scaleY = rect.height / this.canvasElement.height;
  const canvasX = (clientX - rect.left) / scaleX;
  const canvasY = (clientY - rect.top) / scaleY;
  return [canvasX / SQUARE_SIZE, canvasY / SQUARE_SIZE];
};

TheoryModeManager.prototype.getBoardFloatCoords = function () {
  if (this.lastClientX == null || this.lastClientY == null) {
    // Default to top-center of the playfield before the mouse enters
    return [NUM_COLUMN / 2, 1.5];
  }
  return this.clientToBoardFloatCoords(this.lastClientX, this.lastClientY);
};

TheoryModeManager.prototype.isEventInPlacementArea = function (event) {
  const [fx, fy] = this.clientToBoardFloatCoords(event.clientX, event.clientY);
  // Allow a ~1-cell forgiveness margin around the 10x20 playfield for fast edge
  // flicks, while ignoring clicks over the right-side Next box / HUD area.
  return (
    fx >= -1.25 &&
    fx <= NUM_COLUMN + 0.75 &&
    fy >= -1.25 &&
    fy <= NUM_ROW + 1.25
  );
};

TheoryModeManager.prototype.computePlacementForRotation = function (
  piece,
  rotationIndex
) {
  const [fx, fy] = this.getBoardFloatCoords();
  const tetromino = piece.rotationList[rotationIndex];
  const { minR, maxR, minC, maxC } = getTetrominoBounds(tetromino);

  // Anchor the cursor to each piece's NES rotation pivot / visual center so
  // rotating with Z/X spins the piece in place under the cursor without jitter.
  let desiredX;
  let desiredY;
  if (piece.id === "O") {
    desiredX = Math.round(fx - 2.0);
    desiredY = Math.round(fy - 2.0);
  } else if (piece.id === "I") {
    if (rotationIndex === 0) {
      desiredX = Math.round(fx - 2.0);
      desiredY = Math.floor(fy) - 2;
    } else {
      desiredX = Math.floor(fx) - 2;
      desiredY = Math.round(fy - 2.0);
    }
  } else {
    // J, L, S, T, Z all share NES rotation pivot (r = 1, c = 2)
    desiredX = Math.floor(fx) - 2;
    desiredY = Math.floor(fy) - 1;
  }

  // Clamp horizontally to the playfield walls [0, NUM_COLUMN - 1]
  const minX = -minC;
  const maxX = NUM_COLUMN - 1 - maxC;
  const hoverX = Math.max(minX, Math.min(maxX, desiredX));

  // Clamp vertically to the visible playfield rows [0, NUM_ROW - 1]
  const minY = -minR;
  const maxY = NUM_ROW - 1 - maxR;
  const initialHoverY = Math.max(minY, Math.min(maxY, desiredY));
  let hoverY = initialHoverY;

  if (collides(this.board, tetromino, hoverX, hoverY)) {
    // 1. Bubble down first (within piece height) to catch tucks under overhangs
    //    where the cursor is in/near the cavity and the top of the piece clips
    //    the overhang above it.
    const maxTuckBubbleDown = Math.min(maxY, initialHoverY + 3);
    let foundTuckBelow = false;
    for (let y = initialHoverY + 1; y <= maxTuckBubbleDown; y++) {
      if (!collides(this.board, tetromino, hoverX, y)) {
        hoverY = y;
        foundTuckBelow = true;
        break;
      }
    }

    // 2. If no open tuck cavity directly below, bubble upward onto the stack surface.
    if (!foundTuckBelow) {
      hoverY = initialHoverY - 1;
      while (
        hoverY >= minY &&
        collides(this.board, tetromino, hoverX, hoverY)
      ) {
        hoverY -= 1;
      }
    }
  }

  if (hoverY < minY) {
    // Column is completely blocked up to row 0 for this piece/orientation
    return {
      isValid: false,
      x: hoverX,
      hoverY: minY,
      dropY: minY,
      rotationIndex,
      tetromino,
    };
  }

  // Project straight down from (hoverX, hoverY) to find the lock location
  let dropY = hoverY;
  while (!collides(this.board, tetromino, hoverX, dropY + 1)) {
    dropY += 1;
  }

  return {
    isValid: true,
    x: hoverX,
    hoverY,
    dropY,
    rotationIndex,
    tetromino,
  };
};

TheoryModeManager.prototype.updateMouseCoordsFromEvent = function (event) {
  this.lastClientX = event.clientX;
  this.lastClientY = event.clientY;
};

TheoryModeManager.prototype.onMouseMove = function (event, currentPiece) {
  this.updateMouseCoordsFromEvent(event);
  this.recomputePlacement(currentPiece);
};

TheoryModeManager.prototype.onNewPiece = function (currentPiece) {
  this.recomputePlacement(currentPiece);
};

TheoryModeManager.prototype.recomputePlacement = function (currentPiece) {
  if (!currentPiece) {
    this.placement = null;
    return;
  }
  this.placement = this.computePlacementForRotation(
    currentPiece,
    currentPiece.rotationIndex
  );
};

TheoryModeManager.prototype.rotate = function (currentPiece, isClockwise) {
  if (!currentPiece) {
    return;
  }
  const offset = isClockwise ? 1 : -1;
  const numRotations = currentPiece.rotationList.length;
  const nextIndex =
    (currentPiece.rotationIndex + offset + numRotations) % numRotations;

  currentPiece.rotationIndex = nextIndex;
  currentPiece.activeTetromino = currentPiece.rotationList[nextIndex];
  this.placement = this.computePlacementForRotation(currentPiece, nextIndex);
};

TheoryModeManager.prototype.getPlacement = function () {
  return this.placement;
};

TheoryModeManager.prototype.hasValidPlacement = function () {
  return this.placement != null && this.placement.isValid;
};

TheoryModeManager.prototype.reset = function () {
  this.placement = null;
};
