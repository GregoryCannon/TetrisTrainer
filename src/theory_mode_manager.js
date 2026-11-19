import { NUM_ROW, NUM_COLUMN, SQUARE_SIZE, SquareState } from "./constants.js";

/**
 * Manages mouse-driven piece positioning, rotation, collision resolution,
 * landing-spot projection, and WASM reachability checks for Theory Mode.
 */
export function TheoryModeManager(board, canvasElement) {
  this.board = board;
  this.canvasElement = canvasElement;
  this.lastClientX = null;
  this.lastClientY = null;
  this.placement = null;

  this.inputFrameTimeline = "X.....";
  this.reachableSet = null;
  this.lookupEpoch = 0;
  this.pendingEpoch = null;
  this.workerInitialized = false;
  this.lastLookupContext = null;
  this.activePieceForLookup = null;
  this.onNoMovesCallback = null;

  this.reachabilityWorker = null;
  if (typeof Worker !== "undefined") {
    this.reachabilityWorker = new Worker("./wasm/stackrabbit-worker.js");
    this.reachabilityWorker.onmessage = this.onReachabilityMessage.bind(this);
  }
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
      isReachable: false,
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

  const placement = {
    isValid: true,
    isReachable: true,
    x: hoverX,
    hoverY,
    dropY,
    rotationIndex,
    tetromino,
  };
  placement.isReachable = this.isPlacementReachable(placement);
  return placement;
};

TheoryModeManager.prototype.setOnNoMovesCallback = function (callback) {
  this.onNoMovesCallback = callback;
};

TheoryModeManager.prototype.hasAnyOnBoardPlacement = function (piece) {
  if (!piece) {
    return false;
  }
  for (let rot = 0; rot < piece.rotationList.length; rot++) {
    const tetromino = piece.rotationList[rot];
    const { minR, maxR, minC, maxC } = getTetrominoBounds(tetromino);
    const minX = -minC;
    const maxX = NUM_COLUMN - 1 - maxC;
    const minY = -minR;
    const maxY = NUM_ROW - 1 - maxR;
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        if (!collides(this.board, tetromino, x, y)) {
          return true;
        }
      }
    }
  }
  return false;
};

TheoryModeManager.prototype.hasAnyClickableMove = function (piece) {
  if (!piece) {
    return false;
  }
  if (!this.inputFrameTimeline) {
    return this.hasAnyOnBoardPlacement(piece);
  }
  if (this.reachableSet === null) {
    return true;
  }
  for (const key of this.reachableSet) {
    const [rotStr, xStr, yStr] = key.split("|");
    const rot = Number(rotStr);
    const x = Number(xStr);
    const y = Number(yStr);
    const tetromino = piece.rotationList[rot];
    if (!tetromino) {
      continue;
    }
    const { minR, maxR, minC, maxC } = getTetrominoBounds(tetromino);
    if (
      x >= -minC &&
      x <= NUM_COLUMN - 1 - maxC &&
      y >= -minR &&
      y <= NUM_ROW - 1 - maxR &&
      !collides(this.board, tetromino, x, y)
    ) {
      return true;
    }
  }
  return false;
};

TheoryModeManager.prototype.checkAvailableMoves = function () {
  if (
    this.activePieceForLookup &&
    !this.hasAnyClickableMove(this.activePieceForLookup) &&
    this.onNoMovesCallback
  ) {
    this.onNoMovesCallback();
  }
};

TheoryModeManager.prototype.setInputFrameTimeline = function (timeline) {
  this.inputFrameTimeline = timeline || "";
  if (!this.inputFrameTimeline) {
    this.lookupEpoch += 1;
    this.pendingEpoch = null;
    this.reachableSet = null;
    if (this.placement) {
      this.placement.isReachable = this.placement.isValid;
    }
    this.checkAvailableMoves();
    return;
  }
  if (this.lastLookupContext) {
    this.refreshReachability(this.lastLookupContext);
  }
};

TheoryModeManager.prototype.getSpawnDropPlacement = function (piece) {
  if (!piece || !piece.rotationList || !piece.rotationList[0]) {
    return null;
  }
  const tetromino = piece.rotationList[0];
  const spawnX = 3;
  const spawnY = piece.id === "I" ? -2 : -1;
  if (collides(this.board, tetromino, spawnX, spawnY)) {
    return null;
  }
  let dropY = spawnY;
  while (!collides(this.board, tetromino, spawnX, dropY + 1)) {
    dropY += 1;
  }
  return {
    isValid: true,
    isReachable: true,
    x: spawnX,
    hoverY: dropY,
    dropY,
    rotationIndex: 0,
    tetromino,
  };
};

TheoryModeManager.prototype.getSpawnDropKey = function (piece) {
  const spawnPlacement = this.getSpawnDropPlacement(piece);
  return spawnPlacement
    ? `0|${spawnPlacement.x}|${spawnPlacement.dropY}`
    : null;
};

TheoryModeManager.prototype.hasMouseMoved = function () {
  return this.lastClientX != null && this.lastClientY != null;
};

TheoryModeManager.prototype.clearHover = function () {
  this.lastClientX = null;
  this.lastClientY = null;
};

TheoryModeManager.prototype.isPlacementReachable = function (placement) {
  if (!placement || !placement.isValid) {
    return false;
  }
  if (!this.inputFrameTimeline || this.reachableSet === null) {
    return true;
  }
  const key = `${placement.rotationIndex}|${placement.x}|${placement.dropY}`;
  return this.reachableSet.has(key);
};

TheoryModeManager.prototype.refreshReachability = function (contextInfo) {
  this.lastLookupContext = contextInfo;
  if (!this.inputFrameTimeline || !this.reachabilityWorker || !contextInfo) {
    this.lookupEpoch += 1;
    this.pendingEpoch = null;
    this.reachableSet = null;
    if (this.placement) {
      this.placement.isReachable = this.placement.isValid;
    }
    return;
  }

  const encodedBoard = this.board
    .map((row) => row.slice(0, 10).join(""))
    .join("")
    .replace(/2|3/g, "1");

  let srLevel = Math.max(contextInfo.level || 0, 18);
  let srLines = contextInfo.lines || 0;
  if (srLevel === 28) {
    srLines -= 10;
    srLevel -= 1;
  }

  const epoch = ++this.lookupEpoch;
  this.pendingEpoch = epoch;
  this.reachableSet = null;
  if (this.placement) {
    this.placement.isReachable = this.placement.isValid;
  }

  const params = {
    level: srLevel,
    lines: srLines,
    inputFrameTimeline: this.inputFrameTimeline,
    currentPiece: contextInfo.currentPieceId,
    nextPiece: contextInfo.nextPieceId || "I",
    board: encodedBoard,
    playoutLength: 0,
    playoutCount: 0,
    pruningBreadth: 12,
    aggressionLevel: "safe",
    dasCharge: -1,
    reactionTime: 0,
  };

  this.reachabilityWorker.postMessage(["getLockValueLookup", params]);
};

TheoryModeManager.prototype.onReachabilityMessage = function (event) {
  this.workerInitialized = true;
  const data = event.data;
  if (this.pendingEpoch !== this.lookupEpoch) {
    // A newer piece/board/Hz lookup was requested after this one; ignore stale
    // response until the latest epoch lands.
    return;
  }
  this.pendingEpoch = null;
  if (!data || data.error || !data.result) {
    if (data && data.error) {
      console.warn("Theory reachability lookup error:", data.error);
    }
    this.reachableSet = null;
  } else {
    this.reachableSet = new Set(Object.keys(data.result));
    const spawnDropKey = this.getSpawnDropKey(this.activePieceForLookup);
    if (spawnDropKey) {
      this.reachableSet.add(spawnDropKey);
    }
  }
  if (this.placement) {
    this.placement.isReachable = this.isPlacementReachable(this.placement);
  }
  this.checkAvailableMoves();
};

TheoryModeManager.prototype.updateMouseCoordsFromEvent = function (event) {
  this.lastClientX = event.clientX;
  this.lastClientY = event.clientY;
};

TheoryModeManager.prototype.onMouseMove = function (event, currentPiece) {
  this.updateMouseCoordsFromEvent(event);
  this.recomputePlacement(currentPiece);
};

TheoryModeManager.prototype.onNewPiece = function (
  currentPiece,
  lookupContext
) {
  this.activePieceForLookup = currentPiece || null;
  if (lookupContext) {
    this.refreshReachability(lookupContext);
  } else if (currentPiece) {
    this.refreshReachability({
      currentPieceId: currentPiece.id,
      nextPieceId: "I",
      level: 18,
      lines: 0,
    });
  }
  this.recomputePlacement(currentPiece);
  if (!this.inputFrameTimeline) {
    this.checkAvailableMoves();
  }
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
  if (!this.placement || !this.placement.isValid) {
    return false;
  }
  if (
    this.inputFrameTimeline &&
    this.workerInitialized &&
    this.pendingEpoch !== null
  ) {
    return false;
  }
  return this.isPlacementReachable(this.placement);
};

TheoryModeManager.prototype.reset = function () {
  this.lastClientX = null;
  this.lastClientY = null;
  this.placement = null;
  this.reachableSet = null;
  this.pendingEpoch = null;
  this.lastLookupContext = null;
  this.activePieceForLookup = null;
  this.lookupEpoch += 1;
};
