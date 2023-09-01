import { PieceSelector } from "./piece_selector.js";
import { BoardLoader } from "./board_loader.js";
import { Canvas } from "./canvas.js";
import {
  NUM_ROW,
  NUM_COLUMN,
  REWARDS,
  LINE_CLEAR_DELAY,
  GameState,
  SquareState,
  GetGravity,
  CalculatePushdownPoints,
  StartingBoardType,
} from "./constants.js";
import { Piece } from "./piece.js";
import { InputManager } from "./input_manager.js";
import { BoardEditManager } from "./board_edit_manager.js";
import { BoardGenerator } from "./board_generator.js";
import { HistoryManager } from "./history_manager.js";
import { EngineAnalysisManager } from "./engine_analysis_manager.js";
import "./ui_manager";
import {
  AI_PLAYER_PRESET,
  CUSTOM_SEQUENCE_PRESET,
  DIG_PRACTICE_PRESET,
  DROUGHT_PRESET,
  EDIT_BOARD_PRESET,
  KILLSCREEN_PRESET,
  SLOW_19_PRESET,
  SLOW_KILLSCREEN_PRESET,
  STANDARD_PRESET,
  STANDARD_TAPPER_PRESET,
} from "./game_settings_presets.js";
import { PIECE_LOOKUP } from "./tetrominoes.js";
import { AIPlayer } from "./ai_player.js";
const GameSettings = require("./game_settings_manager");
const GameSettingsUi = require("./game_settings_ui_manager");

const headerTextElement = document.getElementById("header-text");
const preGameConfigDiv = document.getElementById("pre-game-config");
const randomBoardResetButton = document.getElementById(
  "random-board-reset-button"
);
const mainCanvas = document.getElementById("main-canvas");
const centerPanel = document.getElementById("center-panel");

// Create the initial empty board
const m_board = []; // All board changes are in-place, so it is a const
for (let r = 0; r < NUM_ROW; r++) {
  m_board[r] = [];
  for (let c = 0; c < NUM_COLUMN; c++) {
    m_board[r][c] = SquareState.EMPTY;
  }
}

// Manager objects
let m_inputManager;
let m_canvas = new Canvas(m_board);
let m_boardEditManager = new BoardEditManager(m_board, m_canvas);
let m_boardGenerator = new BoardGenerator(m_board);
let m_pieceSelector = new PieceSelector();
let m_boardLoader = new BoardLoader(m_board, m_canvas);
let m_historyManager = new HistoryManager();
let m_aiPlayer = null; // Instantiated if/when the setting is enabled
let m_engineAnalysisManager = new EngineAnalysisManager(m_board);

// State relevant to game itself
let m_currentPiece;
let m_nextPiece;
let m_level;
let m_lines;
let m_nextTransitionLineCount;
let m_gameState;
let m_score;
let m_tetrisCount;
let m_isPaused = false;

// State relevant to game **implementation**
let m_gravityFrameCount;
let m_ARE;
let m_lineClearFrames;
let m_firstPieceDelay;
let m_linesPendingClear;
let m_pendingPoints;
let m_gameLoopFrameCount;

// Monitor speed sampling
let m_monitorSampleStartTime = null;
let m_sampleFramesLeft = 100;
let m_monitorStatus = null;

// State relevant to debugging
let m_totalMsElapsed;
let m_numFrames;
let m_maxMsElapsed;

// Exported methods that allow other classes to access the variables in this file

export const GetCurrentPiece = () => {
  return m_currentPiece;
};

export const GetLevel = () => {
  return m_level || GameSettings.getStartingLevel();
};

export const GetLines = () => {
  return m_lines;
};

export const GetIsPaused = () => {
  return m_isPaused;
};

export const G_Restart = function () {
  if (gameStateIsInGame() || m_gameState == GameState.GAME_OVER) {
    startGame();
  }
};

export const G_Rewind = function () {
  m_historyManager.rewindOnePiece();
  loadSnapshotFromHistory();
};

export const G_FastForward = function () {
  m_historyManager.fastForwardOnePiece();
  loadSnapshotFromHistory();
};

export const G_StartPause = function () {
  // Either starts, pauses, or continues after game over
  if (m_gameState == GameState.GAME_OVER) {
    m_gameState = GameState.START_SCREEN;
    refreshHeaderText();
    refreshPreGame();
  } else if (
    m_gameState == GameState.START_SCREEN ||
    m_gameState == GameState.EDIT_STARTING_BOARD ||
    m_gameState == GameState.RANDOM_BOARD
  ) {
    startGame();
  } else if (gameStateIsInGame()) {
    togglePause();
  }
};

export const G_Quit = function () {
  console.log("QUIT");
  // Quits to menu
  m_gameState = GameState.START_SCREEN;
  refreshHeaderText();
  refreshPreGame();
};

// Line clear stuff

function getFullRows() {
  let fullLines = [];
  for (let r = 0; r < NUM_ROW; r++) {
    let isRowFull = true;
    for (let c = 0; c < NUM_COLUMN; c++) {
      if (m_board[r][c] == SquareState.EMPTY) {
        isRowFull = false;
        break;
      }
    }
    if (isRowFull) {
      fullLines.push(r);
    }
  }
  return fullLines;
}

function getLinesToTransition(levelNum) {
  if (levelNum < 10) {
    // 10 lines per level
    return (levelNum + 1) * 10;
  } else if (levelNum <= 15) {
    // 10 - 15 is all 100 lines
    return 100;
  } else if (levelNum >= 29) {
    // 29 start is 200 lines
    return 200;
  }
  // General case
  return (levelNum - 5) * 10;
}

function removeFullRows() {
  const numLinesCleared = m_linesPendingClear.length;
  for (const r of m_linesPendingClear) {
    m_board.splice(r, 1);
    m_board.splice(0, 0, []);

    // Clear out the very top row (newly shifted into the screen)
    for (let c = 0; c < NUM_COLUMN; c++) {
      m_board[0].push(SquareState.EMPTY);
    }
  }
  m_linesPendingClear = [];

  // Post-line clear processing
  if (numLinesCleared > 0) {
    // Update the lines
    m_lines += numLinesCleared;

    // Update the tetris rate
    if (numLinesCleared == 4) {
      m_tetrisCount += 1;
    }

    // Maybe level transition
    if (
      GameSettings.shouldTransitionEveryLine() ||
      m_lines >= m_nextTransitionLineCount
    ) {
      m_level += 1;

      m_nextTransitionLineCount += 10;
    }

    // Update the score (must be after lines + transition)
    m_pendingPoints += REWARDS[numLinesCleared] * (m_level + 1);

    // Update the board
    m_canvas.drawBoard();
  }
}

function filledIfExists(row, col, board) {
  if (col < 0 || col >= NUM_COLUMN || row < 0 || row >= NUM_ROW) {
    return true;
  }
  return board[row][col] != SquareState.EMPTY;
}

function isGameOver() {
  // If the current piece collides with the existing board as it spawns in, you die
  const currentTetromino = m_currentPiece.activeTetromino;
  for (let r = 0; r < currentTetromino.length; r++) {
    for (let c = 0; c < currentTetromino[r].length; c++) {
      if (
        currentTetromino[r][c] &&
        filledIfExists(m_currentPiece.y + r, m_currentPiece.x + c, m_board)
      ) {
        return true;
      }
    }
  }
  return false;
}

function getNewPiece() {
  m_currentPiece = m_nextPiece;

  // Piece status is drawn first, since the read index increments when the next
  // piece is selected
  m_nextPiece = new Piece(m_pieceSelector.getNextPiece(), m_board);
}

function resetGameVariables() {
  // Parse the level
  m_level = GameSettings.getStartingLevel();

  // Determine the number of lines till transition
  m_nextTransitionLineCount = GameSettings.shouldTransitionEvery10Lines()
    ? 10
    : getLinesToTransition(m_level);

  // Get the first piece and put it in the next piece slot. Will be bumped to current in getNewPiece()
  m_pieceSelector.generatePieceSequence();

  if (
    (m_gameState != GameState.EDIT_STARTING_BOARD &&
      m_gameState != GameState.RANDOM_BOARD) ||
    m_currentPiece == null ||
    m_nextPiece == null
  ) {
    m_nextPiece = new Piece(m_pieceSelector.getNextPiece(), m_board);
    getNewPiece();
    drawNextBox(m_nextPiece);
  }
  m_canvas.drawPieceStatusDisplay(m_pieceSelector.getStatusDisplay());

  m_score = 0;
  m_tetrisCount = 0;
  m_lines = 0;

  m_isPaused = false;
}

function resetImplementationVariables() {
  // Implementation variables
  m_ARE = 0;
  m_pendingPoints = 0;
  m_lineClearFrames = 0;
  m_linesPendingClear = [];
  m_gravityFrameCount = 0;
  m_gameLoopFrameCount = GameSettings.getFrameSkipCount();
  m_firstPieceDelay = 0;
  m_inputManager.resetLocalVariables();

  // Debug variables
  m_totalMsElapsed = 0;
  m_numFrames = 0;
  m_maxMsElapsed = 0;
}

function startGame() {
  // Generate the starting board based on the desired starting board type
  switch (GameSettings.getStartingBoardType()) {
    case StartingBoardType.EMPTY:
      m_boardGenerator.loadEmptyBoard();
      break;

    case StartingBoardType.DIG_PRACTICE:
      m_boardGenerator.loadDigBoard();
      break;

    case StartingBoardType.CUSTOM:
      if (
        m_gameState == GameState.EDIT_STARTING_BOARD ||
        m_gameState == GameState.RANDOM_BOARD
      ) {
        // do nothing, since there's already a board there
      } else {
        m_boardGenerator.loadEmptyBoard();
      }
      break;
  }

  // Reset game values
  resetGameVariables();
  resetImplementationVariables();
  saveSnapshotToHistory();

  // Start the game in the first piece state
  m_firstPieceDelay = 90; // Extra delay for first piece
  m_gameState = GameState.FIRST_PIECE;

  // Refresh UI
  document.activeElement.blur();
  m_canvas.drawBoard();
  m_canvas.drawCurrentPiece();
  m_canvas.drawNextBox(GameSettings.isNoAdjustmentMode() ? null : m_nextPiece);
  refreshHeaderText();
  refreshScoreHUD();
  refreshStats();
  refreshPreGame();
}

/** Progress the game state, and perform any other updates that occur on
 * particular game state transitions
 * */
function updateGameState() {
  // FIRST PIECE -> RUNNING
  if (m_gameState == GameState.FIRST_PIECE && m_firstPieceDelay == 0) {
    m_gameState = GameState.RUNNING;
    if (GameSettings.isAIPlaying()) {
      m_aiPlayer.placeCurrentPiece(
        m_currentPiece,
        m_nextPiece,
        m_board,
        m_level,
        m_lines,
      );
    }
  }
  // LINE CLEAR -> ARE
  else if (m_gameState == GameState.LINE_CLEAR && m_lineClearFrames == 0) {
    m_gameState = GameState.ARE;
  }
  // ARE -> RUNNING
  else if (m_gameState == GameState.ARE && m_ARE == 0) {
    // Add pending score to score total and refresh score UI
    m_score += m_pendingPoints;
    m_pendingPoints = 0;
    refreshScoreHUD();

    saveSnapshotToHistory();

    // Draw the new pieces
    m_canvas.drawCurrentPiece();
    m_canvas.drawNextBox(
      GameSettings.isNoAdjustmentMode() ? null : m_nextPiece,
    );
    m_canvas.drawPieceStatusDisplay(m_pieceSelector.getStatusDisplay());

    // Checked here because the game over condition depends on the newly spawned piece
    if (isGameOver()) {
      m_gameState = GameState.GAME_OVER;
      refreshPreGame();
      refreshHeaderText();

      // debugging
      console.log(
        "Average frame calculation time:",
        (m_totalMsElapsed / m_numFrames).toFixed(3),
        "Max:",
        m_maxMsElapsed.toFixed(3),
      );
    } else {
      m_gameState = GameState.RUNNING;
      if (GameSettings.isAIPlaying()) {
        m_aiPlayer.placeCurrentPiece(
          m_currentPiece,
          m_nextPiece,
          m_board,
          m_level,
          m_lines,
        );
      }
    }
  } else if (m_gameState == GameState.RUNNING) {
    // RUNNING -> LINE CLEAR
    if (m_lineClearFrames > 0) {
      m_gameState = GameState.LINE_CLEAR;
    }
    // RUNNING -> ARE
    else if (m_ARE > 0) {
      m_gameState = GameState.ARE;
    }
  }
  // Otherwise, unchanged.
}

// Main implementation game logic, triggered by gameLoop()
function runOneFrame() {
  // If paused, just do nothing.
  if (!m_isPaused) {
    switch (m_gameState) {
      case GameState.FIRST_PIECE:
        // Waiting for first piece
        m_firstPieceDelay -= 1;

        // Allow piece movement during first piece
        m_inputManager.handleInputsThisFrame();
        break;

      case GameState.LINE_CLEAR:
        // Still animating line clear
        m_lineClearFrames -= 1;
        // Do subtraction so animation frames count up
        m_canvas.drawLineClears(
          m_linesPendingClear,
          LINE_CLEAR_DELAY - m_lineClearFrames,
        );
        if (m_lineClearFrames == 0) {
          // Clear the lines for real and shift stuff down
          removeFullRows();
        }
        // If we're in no-adjustment mode (has extra long entry delay), animate a waiting bar
        if (GameSettings.isNoAdjustmentMode()) {
          m_canvas.drawNextBoxWaitingLine(m_ARE + m_lineClearFrames);
        }
        break;

      case GameState.ARE:
        // Waiting for next piece
        m_ARE -= 1;

        // If we're in no-adjustment mode (has extra long entry delay), animate a waiting bar
        if (GameSettings.isNoAdjustmentMode()) {
          m_canvas.drawNextBoxWaitingLine(m_ARE);
        }
        break;

      case GameState.RUNNING:
        // Handle inputs
        m_inputManager.handleInputsThisFrame();

        // Handle gravity
        if (m_inputManager.getIsSoftDropping()) {
          // Reset gravity for if they stop soft dropping
          m_gravityFrameCount = 0;
        } else {
          // Increment gravity and shift down if appropriate
          m_gravityFrameCount += 1;

          // Move the piece down when appropriate
          if (m_gravityFrameCount >= GetGravity(m_level)) {
            G_MoveCurrentPieceDown();
            m_gravityFrameCount = 0;
          }
        }

        break;
    }

    updateGameState();
  }

  // Legacy code from using window timeout instead of animation frame
  // const desiredFPS = 60 * GameSettings.getGameSpeedMultiplier();
  // window.setTimeout(gameLoop, 1000 / desiredFPS - msElapsed);
}

// 60 FPS game loop
function gameLoop() {
  // Check for weird refresh rates
  if (m_sampleFramesLeft === 10) {
    m_monitorSampleStartTime = window.performance.now();
  } else if (m_sampleFramesLeft === 0) {
    const timeDiffMs = window.performance.now() - m_monitorSampleStartTime;
    console.log(`Average frame length ${timeDiffMs / 10} ms`);
    if (timeDiffMs / 10 > 25 && m_monitorStatus !== "slow") {
      alert(
        "Your monitor refreshes slower than 60 Hz. The game will run much slower than usual."
      );
      m_monitorStatus = "slow";
    }
    if (timeDiffMs / 10 < 12) {
      m_monitorStatus = "fast";
    }
  } else if (m_sampleFramesLeft < -6000) {
    m_sampleFramesLeft += 6000;
  }
  m_sampleFramesLeft--;

  m_gameLoopFrameCount -= m_monitorStatus === "fast" ? 0.5 : 1;
  if (m_gameLoopFrameCount == 0) {
    m_gameLoopFrameCount = GameSettings.getFrameSkipCount();

    // Run a frame
    const start = window.performance.now();
    runOneFrame();
    const msElapsed = window.performance.now() - start;

    // Update debug statistics
    m_numFrames += 1;
    m_totalMsElapsed += msElapsed;
    m_maxMsElapsed = Math.max(m_maxMsElapsed, msElapsed);
  }
  requestAnimationFrame(gameLoop);
}

function refreshHeaderText() {
  let newText = "";
  if (m_isPaused) {
    newText = "Paused";
  } else {
    switch (m_gameState) {
      case GameState.START_SCREEN:
        newText = "Welcome to Tetris Trainer!";
        break;
      case GameState.EDIT_STARTING_BOARD:
        newText =
          "Use your mouse to edit the board, then click enter to start!";
        break;
      case GameState.RANDOM_BOARD:
        newText =
          "Try to guess what StackRabbit would play, or click enter to start!";
        break;
      case GameState.GAME_OVER:
        newText = "Game over!";
        break;
    }
  }

  headerTextElement.innerText = newText;
}

export function calcParity(startCol, endCol) {
  // Calculate parity, where the top left square is "1" and adjacent squares are "-1"
  let parity = 0;
  for (let r = 0; r < NUM_ROW; r++) {
    for (let c = Math.max(0, startCol); c < Math.min(endCol, 10); c++) {
      if (r >= 18) {
      }
      if (m_board[r][c] != SquareState.EMPTY) {
        // Add 1 or -1 to parity total based on the square's location
        const cellConstant = (r + c) % 2 == 0 ? 1 : -1;
        parity += cellConstant;
      }
    }
  }
  return Math.abs(parity);
}

// Does nothing at the moment, I don't like how parity stats turned out
function refreshStats() {
  // const leftParity = calcParity(0, 5);
  // const middleParity = calcParity(3, 7);
  // const rightParity = calcParity(5, 10);
  // parityStatsDiv.innerText = `Left: ${leftParity} \nMiddle: ${middleParity} \nRight: ${rightParity}`;
}

function drawNextBox(nextPiece) {
  m_canvas.drawNextBox(nextPiece);
  if (nextPiece !== null) {
    m_engineAnalysisManager.updatePieces(m_currentPiece.id, m_nextPiece.id);
  }
}

function refreshScoreHUD() {
  m_canvas.drawLevelDisplay(m_level);
  m_canvas.drawScoreDisplay(m_score);
  m_canvas.drawLinesDisplay(m_lines);
  m_canvas.drawTetrisRateDisplay(m_tetrisCount, m_lines);
}

function refreshPreGame() {
  if (m_gameState == GameState.START_SCREEN) {
    preGameConfigDiv.style.visibility = "visible";
  } else {
    preGameConfigDiv.style.visibility = "hidden";
  }
  if (m_gameState == GameState.RANDOM_BOARD) {
    randomBoardResetButton.style.visibility = "visible";
  } else {
    randomBoardResetButton.style.visibility = "hidden";
  }
}

/** Delegate functions to controls code */

export function G_MovePieceLeft() {
  m_canvas.unDrawCurrentPiece();
  const didMove = m_currentPiece.moveLeft();
  m_canvas.drawCurrentPiece();
  return didMove;
}

/** @returns whether the piece moved */
export function G_MovePieceRight() {
  m_canvas.unDrawCurrentPiece();
  const didMove = m_currentPiece.moveRight();
  m_canvas.drawCurrentPiece();
  return didMove;
}

/** @returns whether the piece moved */
export function G_MoveCurrentPieceDown() {
  if (m_currentPiece.shouldLock()) {
    // Lock in piece and re-render the board
    lockPiece();
    return false; // Return false because the piece didn't shift down
  } else {
    // Move down as usual
    m_canvas.unDrawCurrentPiece();
    m_currentPiece.moveDown();
    m_canvas.drawCurrentPiece();
    return true; // Return true because the piece moved down
  }
}

function lockPiece() {
  const lockHeight = m_currentPiece.getHeightFromBottom();
  m_currentPiece.lock();
  m_inputManager.onPieceLock();
  m_canvas.drawBoard();
  if (GameSettings.isNoAdjustmentMode()) {
    m_canvas.drawNextBox(m_nextPiece);
  }

  // Refresh board-based stats
  refreshStats();

  // Get a new piece but --don't render it-- till after ARE
  getNewPiece();

  // Update the engine piece
  m_engineAnalysisManager.updatePieces(m_currentPiece.id, null);

  // Clear lines
  m_linesPendingClear = getFullRows();
  if (m_linesPendingClear.length > 0) {
    m_lineClearFrames = LINE_CLEAR_DELAY; // Clear delay counts down from max val
  }

  // Add pushdown points
  m_pendingPoints += CalculatePushdownPoints(
    m_inputManager.getCellsSoftDropped(),
  );

  // Get the ARE based on piece lock height
  /* ARE (frame delay before next piece) is 10 frames for 0-2 height, then an additional
      2 frames for each group of 4 above that.
        E.g. 9 high would be: 10 + 2 + 2 = 14 frames */
  m_ARE = Math.min(18, 10 + Math.floor((lockHeight + 2) / 4) * 2);

  // Add additional ARE in no-adjustment-mode
  if (GameSettings.isNoAdjustmentMode()) {
    m_ARE += m_lineClearFrames > 0 ? 0 : 18;
  }
}

function saveSnapshotToHistory() {
  m_historyManager.addSnapshotToHistory([
    m_currentPiece.id,
    m_nextPiece.id,
    m_pieceSelector.getReadIndex(),
    m_level,
    m_lines,
    m_nextTransitionLineCount,
    m_score,
    m_tetrisCount,
    JSON.parse(JSON.stringify(m_board)),
  ]);
}

function loadSnapshotFromHistory() {
  const snapshotObj = m_historyManager.loadSnapshotFromHistory();
  let tempBoard, currentPieceId, nextPieceId, pieceReadIndex;
  if (snapshotObj !== null) {
    [
      currentPieceId,
      nextPieceId,
      pieceReadIndex,
      m_level,
      m_lines,
      m_nextTransitionLineCount,
      m_score,
      m_tetrisCount,
      tempBoard,
    ] = snapshotObj;

    // Load the board from snapshot in place
    for (let r = 0; r < NUM_ROW; r++) {
      for (let c = 0; c < NUM_COLUMN; c++) {
        m_board[r][c] = tempBoard[r][c];
      }
    }
    m_currentPiece = new Piece(PIECE_LOOKUP[currentPieceId], m_board);
    m_nextPiece = new Piece(PIECE_LOOKUP[nextPieceId], m_board);
    m_pieceSelector.setReadIndex(pieceReadIndex);
    m_canvas.drawPieceStatusDisplay(m_pieceSelector.getStatusDisplay());

    /* ---------- START GAME ----------- */
    // Reset game values
    resetImplementationVariables();

    // Start the game in the first piece state
    m_firstPieceDelay = 90; // Extra delay for first piece
    m_gameState = GameState.FIRST_PIECE;

    // Refresh UI
    document.activeElement.blur();
    m_canvas.drawBoard();
    m_canvas.drawCurrentPiece();
    m_canvas.drawNextBox(
      GameSettings.isNoAdjustmentMode() ? null : m_nextPiece,
    );
    refreshHeaderText();
    refreshScoreHUD();
    refreshStats();
    refreshPreGame();
  }
}

export function G_RotatePieceLeft() {
  m_canvas.unDrawCurrentPiece();
  m_currentPiece.rotate(false);
  m_canvas.drawCurrentPiece();
}

export function G_RotatePieceRight() {
  m_canvas.unDrawCurrentPiece();
  m_currentPiece.rotate(true);
  m_canvas.drawCurrentPiece();
}

function togglePause() {
  // Pause using an independent variable so it'll finish all the
  // calculations for the current frame, then stop subsequent frames
  m_isPaused = !m_isPaused;
  refreshHeaderText();
}

function gameStateIsInGame() {
  return (
    m_gameState == GameState.FIRST_PIECE ||
    m_gameState == GameState.RUNNING ||
    m_gameState == GameState.ARE ||
    m_gameState == GameState.LINE_CLEAR
  );
}

export function G_GetGameState() {
  return m_gameState;
}

function G_GetARE() {
  return m_ARE;
}

/* --------- MOUSE & KEY INPUT ---------- */

mainCanvas.addEventListener("mousedown", function (e) {
  m_boardEditManager.onMouseDown(e);
});
mainCanvas.addEventListener("mousemove", function (e) {
  m_boardEditManager.onMouseDrag(e);
});
mainCanvas.addEventListener("mouseup", function (e) {
  m_boardEditManager.onMouseUp(e);
});
centerPanel.addEventListener("mouseleave", function (e) {
  m_boardEditManager.onMouseUp(e);
});

document.addEventListener("keydown", (e) => {
  m_inputManager.keyDownListener(e);
});
document.addEventListener("keyup", (e) => {
  m_inputManager.keyUpListener(e);
});

/* --------- Preset buttons --------- */

const presetsMap = {
  "preset-standard": STANDARD_PRESET,
  // "preset-standard-tap": STANDARD_TAPPER_PRESET,
  "preset-dig-practice": DIG_PRACTICE_PRESET,
  "preset-drought": DROUGHT_PRESET,
  "preset-killscreen": KILLSCREEN_PRESET,
  "preset-slow-killscreen": SLOW_KILLSCREEN_PRESET,
  "preset-slow-19": SLOW_19_PRESET,
  // "preset-custom-sequence": CUSTOM_SEQUENCE_PRESET,
  "preset-ai-player": AI_PLAYER_PRESET,
};

function deselectAllPresets() {
  for (const id in presetsMap) {
    document.getElementById(id).classList.remove("selected");
  }
}

// Add click listeners for all the standard preset buttons
for (const id in presetsMap) {
  const presetObj = presetsMap[id];

  document.getElementById(id).addEventListener("click", (e) => {
    // Load the corresponding preset
    GameSettingsUi.loadPreset(presetObj);
    // Select that preset
    deselectAllPresets();
    console.log("selecting:", id);
    document.getElementById(id).classList.add("selected");
  });
}

document.getElementById("preset-edit-board").addEventListener("click", (e) => {
  GameSettingsUi.loadPreset(EDIT_BOARD_PRESET);

  m_level = GameSettings.getStartingLevel();
  m_lines = 0;
  m_score = 0;
  m_boardGenerator.loadEmptyBoard();
  m_currentPiece = null; // Don't want a piece to be rendered at the top of the screen during editing
  m_canvas.drawBoard();
  m_gameState = GameState.EDIT_STARTING_BOARD;
  refreshPreGame();
  refreshHeaderText();
  refreshScoreHUD();
});
document
  .getElementById("preset-ai-player")
  .addEventListener("click", async (e) => {
    if (m_aiPlayer == null) {
      m_aiPlayer = new AIPlayer(
        movePieceLeft,
        movePieceRight,
        rotatePieceRight,
      );
      console.log("Loaded AI player!");
    }
  });

const loadRandomBoard = (e) => {
  GameSettingsUi.loadPreset(EDIT_BOARD_PRESET);

  m_level = GameSettings.getStartingLevel();
  m_lines = 0;
  m_score = 0;
  m_boardGenerator.loadStandardBoard();
  m_pieceSelector.generatePieceSequence();
  m_nextPiece = new Piece(m_pieceSelector.getNextPiece(), m_board);
  getNewPiece();
  m_canvas.drawBoard();
  drawNextBox(m_nextPiece);
  m_canvas.drawCurrentPiece();
  m_gameState = GameState.RANDOM_BOARD;
  refreshPreGame();
  refreshHeaderText();
  refreshScoreHUD();
};
document
  .getElementById("preset-random-board")
  .addEventListener("click", loadRandomBoard);
randomBoardResetButton.addEventListener("click", loadRandomBoard);

document
  .getElementById("start-button")
  .addEventListener("click", (e) => startGame());

/**
 * SCRIPT START
 */
m_inputManager = new InputManager();
resetImplementationVariables();
document.getElementById("preset-standard").click();

// Render after a small delay so the font loads
window.setTimeout(() => {
  m_canvas.drawBoard();
  drawNextBox(null);
  m_inputManager.refreshDebugText();
  refreshHeaderText();
  refreshStats();
  refreshScoreHUD();
  gameLoop();
}, 200);
