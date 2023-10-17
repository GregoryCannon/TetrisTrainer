import { Direction, GameState } from "./constants.js";
import {
  GetIsPaused,
  G_FastForward,
  G_Quit,
  G_Restart,
  G_Rewind,
  G_StartPause,
  G_GetGameState,
  G_MoveCurrentPieceDown,
  G_MovePieceRight,
  G_MovePieceLeft,
  G_RotatePieceLeft,
  G_RotatePieceRight,
} from "./index.js";
const GameSettings = require("./game_settings_manager");
const keyEditPopup = document.getElementById("edit-key");

const DEFAULT_KEY_MAP = {
  RESTART: "r",
  REWIND: "v",
  FAST_FORWARD: "b",
  START_PAUSE: "Enter",
  QUIT: "q",
  ROTATE_LEFT: "z",
  ROTATE_RIGHT: "x",
  LEFT: "ArrowLeft",
  DOWN: "ArrowDown",
  RIGHT: "ArrowRight",
};

let KEY_MAP = DEFAULT_KEY_MAP;

const idToKeyMap = [
  ["key-rot-left", "ROTATE_LEFT"],
  ["key-rot-right", "ROTATE_RIGHT"],
  ["key-left", "LEFT"],
  ["key-right", "RIGHT"],
  ["key-down", "DOWN"],
  ["key-start-pause", "START_PAUSE"],
  ["key-restart", "RESTART"],
  ["key-undo", "REWIND"],
  ["key-redo", "FAST_FORWARD"],
  ["key-quit", "QUIT"],
];

export function InputManager() {
  this.getKeyMapFromCookie();
  this.resetLocalVariables();
  this.addKeyClickListeners();
}

/* ---------------------
    Key Editing UI
---------------------- */

InputManager.prototype.saveKeyMapToCookie = function () {
  document.cookie =
    "keymap=" +
    escape(JSON.stringify(KEY_MAP)) +
    "; expires=Thu, 18 Dec 2030 12:00:00 UTC";
  console.log("saved new cookie:", document.cookie);
};

InputManager.prototype.getKeyMapFromCookie = function () {
  if (document.cookie) {
    const keyMapCookie = document.cookie
      .split("; ")
      .find((row) => row.startsWith("keymap="));
    if (keyMapCookie) {
      const keyMapCookieVal = keyMapCookie.split("=")[1];
      KEY_MAP = JSON.parse(unescape(keyMapCookieVal));
      this.refreshKeyVisuals();
    }
  }
};

InputManager.prototype.addKeyClickListeners = function () {
  for (const [id, key] of idToKeyMap) {
    document.getElementById(id).addEventListener("click", () => {
      this.keyBeingEdited = key;
      keyEditPopup.style.visibility = "visible";
    });
  }
};

// Nice lookig
const CUSTOM_KEY_DISPLAYS = {
  ArrowLeft: "←",
  ArrowDown: "↓",
  ArrowRight: "→",
};

InputManager.prototype.refreshKeyVisuals = function () {
  for (const [id, key] of idToKeyMap) {
    const rawKey = KEY_MAP[key];
    document.getElementById(id).innerHTML =
      CUSTOM_KEY_DISPLAYS[rawKey] || rawKey.toUpperCase();
  }
};

/* ---------------------
    Called by parent
---------------------- */

InputManager.prototype.getIsSoftDropping = function () {
  return this.isSoftDropping;
};

InputManager.prototype.getCellsSoftDropped = function () {
  return this.cellSoftDropped;
};

InputManager.prototype.onPieceLock = function () {
  if (GameSettings.shouldSetDASChargeOnPieceStart()) {
    this.setDASCharge(GameSettings.getDASWallChargeAmount());
  } else {
    // Don't allow DAS charges higher than the wall charge amount.
    // This is used on DAS speeds with higher ARR but intentionally handicapped starting charges
    this.setDASCharge(
      Math.min(GameSettings.getDASWallChargeAmount(), this.dasCharge),
    );
  }
};

InputManager.prototype.resetLocalVariables = function () {
  this.leftHeld = false;
  this.rightHeld = false;
  this.downHeld = false;
  this.isSoftDropping = false;
  this.cellSoftDropped = 0;
  this.dasCharge = GameSettings.getDASTriggerThreshold(); // Starts charged on the first piece
  this.softDroppedLastFrame = false;
  this.keyBeingEdited = null;
};

InputManager.prototype.handleInputsThisFrame = function () {
  // If holding multiple keys, do nothing
  const dpadDirectionsHeld = this.downHeld + this.leftHeld + this.rightHeld;
  if (dpadDirectionsHeld > 1) {
    this.isSoftDropping = false;
    this.cellSoftDropped = 0;
    return;
  }

  // Move piece down
  if (this.isSoftDropping && !this.softDroppedLastFrame) {
    const didMove = G_MoveCurrentPieceDown();
    if (didMove) {
      this.cellSoftDropped += 1;
    } else {
      // If it didn't move, then it locked in. Reset soft drop between pieces.
      this.isSoftDropping = false;
      this.cellSoftDropped = 0;
    }
    this.softDroppedLastFrame = true;
    return;
  } else {
    this.softDroppedLastFrame = false;
  }

  // DAS left
  if (this.leftHeld) {
    this.handleHeldDirection(Direction.LEFT);
    return;
  }

  // DAS right
  if (this.rightHeld) {
    this.handleHeldDirection(Direction.RIGHT);
  }
};

/* ---------------------
    Key listeners 
---------------------- */

InputManager.prototype.keyDownListener = function (event) {
  // Override the browser's built-in key repeating
  if (event.repeat) {
    return;
  }

  if (this.keyBeingEdited) {
    KEY_MAP[this.keyBeingEdited] = event.key;
    this.keyBeingEdited = null;
    keyEditPopup.style.visibility = "hidden";
    this.refreshKeyVisuals();
    this.saveKeyMapToCookie();
  }

  // Handle global shortcuts
  switch (event.key) {
    case KEY_MAP.RESTART:
      G_Restart();
      break;

    case KEY_MAP.REWIND:
      G_Rewind();
      break;

    case KEY_MAP.FAST_FORWARD:
      G_FastForward();
      break;

    case KEY_MAP.START_PAUSE:
      G_StartPause();
      break;

    case KEY_MAP.QUIT:
      G_Quit();
      break;
  }

  // Track whether keys are held regardless of state
  switch (event.key) {
    case KEY_MAP.LEFT:
      this.leftHeld = true;
      event.preventDefault();
      break;
    case KEY_MAP.RIGHT:
      this.rightHeld = true;
      event.preventDefault();
      break;
    case KEY_MAP.DOWN:
      this.downHeld = true;
      break;
  }

  // Only actually move the pieces if in the proper game state
  const gameState = G_GetGameState();
  if (canMovePiecesSidewaysOrRotate(gameState)) {
    switch (event.key) {
      case KEY_MAP.LEFT:
        this.handleTappedDirection(Direction.LEFT);
        break;
      case KEY_MAP.RIGHT:
        this.handleTappedDirection(Direction.RIGHT);
        break;
      case KEY_MAP.ROTATE_LEFT:
        G_RotatePieceLeft();
        break;
      case KEY_MAP.ROTATE_RIGHT:
        G_RotatePieceRight();
        break;
    }
  } else {
    switch (event.key) {
      case KEY_MAP.ROTATE_LEFT:
        console.log("rotate rejected, state: ", G_GetGameState());
        break;
      case KEY_MAP.ROTATE_RIGHT:
        console.log("rotate rejected, state: ", G_GetGameState());
        break;
    }
  }

  if (canDoAllPieceMovements(gameState)) {
    switch (event.key) {
      case KEY_MAP.DOWN:
        this.isSoftDropping = true;
        break;
    }
  }
};

InputManager.prototype.keyUpListener = function (event) {
  // Track whether keys are held regardless of state
  if (event.key == KEY_MAP.LEFT) {
    this.leftHeld = false;
  } else if (event.key == KEY_MAP.RIGHT) {
    this.rightHeld = false;
  } else if (event.key == KEY_MAP.DOWN) {
    this.downHeld = false;
    this.isSoftDropping = false; // Can stop soft dropping in any state
    this.cellSoftDropped = 0;
  }
};

/* ---------------------
    Private helpers
---------------------- */

InputManager.prototype.tryShiftPiece = function (direction) {
  // Try to move the piece and store whether it actually did or not
  const didMove =
    direction == Direction.LEFT ? G_MovePieceLeft() : G_MovePieceRight();
  // Wall charge if it didn't move
  if (!didMove) {
    this.setDASCharge(GameSettings.getDASTriggerThreshold());
  }
  return didMove;
};

InputManager.prototype.handleHeldDirection = function (direction) {
  const DASTriggerThreshold = GameSettings.getDASTriggerThreshold();
  // Increment DAS
  this.setDASCharge(Math.min(DASTriggerThreshold, this.dasCharge + 1));

  // Attempt to shift the piece once it hits the trigger
  if (this.dasCharge == DASTriggerThreshold) {
    const didMove = this.tryShiftPiece(direction);
    if (didMove) {
      // Move DAS to charged floor for another cycle of ARR
      this.setDASCharge(GameSettings.getDASChargedFloor());
    }
  }
};

// Handle single taps of the dpad, if in the proper state
InputManager.prototype.handleTappedDirection = function (direction) {
  if (canMovePiecesSidewaysOrRotate(G_GetGameState())) {
    // Update the DAS charge
    this.setDASCharge(GameSettings.getDASChargeAfterTap());

    this.tryShiftPiece(direction);
  }
};

// Updates the DAS charge and refreshes the debug text
InputManager.prototype.setDASCharge = function (value) {
  this.dasCharge = value;
  // this.refreshDebugText();
};

InputManager.prototype.refreshDebugText = function () {
  let debugStr = "";
  let dasVisualized = "";
  for (let i = 0; i < this.dasCharge; i++) {
    dasVisualized += "|";
  }
  // Have something on the second line so it's always the same height
  if (this.dasCharge == 0) {
    dasVisualized = ".";
  }
  debugStr +=
    this.dasCharge +
    "/" +
    GameSettings.getDASTriggerThreshold() +
    "\n" +
    dasVisualized;
};

// Checks if the game state allows for piece movements horizontally
function canMovePiecesSidewaysOrRotate(gameState) {
  return (
    !GetIsPaused() &&
    (gameState == GameState.RUNNING || gameState == GameState.FIRST_PIECE)
  );
}

// Checks if the game state allows for downward piece movement
function canDoAllPieceMovements(gameState) {
  return !GetIsPaused() && gameState == GameState.RUNNING;
}
