import {
  G_MovePieceLeft,
  G_MovePieceRight,
  G_RotatePieceLeft,
  G_RotatePieceRight,
  GetCurrentPiece,
  GetLevel,
  GetLines,
  G_GetGameState,
  GetIsPaused,
} from "./index.js";
import { GameState } from "./constants.js";
const GameSettings = require("./game_settings_manager");

const aiPlayerCheckbox = document.getElementById("ai-player-checkbox");

const INPUT_ACTIONS = {
  ".": null, // No input
  L: () => G_MovePieceLeft(),
  R: () => G_MovePieceRight(),
  A: () => G_RotatePieceRight(),
  B: () => G_RotatePieceLeft(),
  E: () => {
    G_RotatePieceRight();
    G_MovePieceLeft();
  },
  F: () => {
    G_RotatePieceLeft();
    G_MovePieceLeft();
  },
  I: () => {
    G_RotatePieceRight();
    G_MovePieceRight();
  },
  G: () => {
    G_RotatePieceLeft();
    G_MovePieceRight();
  },
  "*": null, // Entry delay frames, ignored
};

/**
 * Calculates the board string after full rows are cleared,
 * matching the encoding format in engine_analysis_manager.js
 */
export function getBoardAfterLineClears(board) {
  let fullRows = 0;
  let boardAfterStr = "";
  for (const row of board) {
    const joinedRow = row.slice(0, 10).join("").replace(/2|3/g, "1");
    if (joinedRow === "1111111111") {
      fullRows++;
    } else {
      boardAfterStr += joinedRow;
    }
  }

  // Prepend empty rows that shift onto the top of the screen
  for (let i = 0; i < fullRows; i++) {
    boardAfterStr = "0000000000" + boardAfterStr;
  }

  return {
    boardStr: boardAfterStr,
    linesCleared: fullRows,
  };
}

export function AiPlayer(board) {
  this.board = board;
  this.inputQueue = [];
  this.abortController = null;
  this.requestId = 0;

  if (aiPlayerCheckbox) {
    aiPlayerCheckbox.addEventListener("change", () => {
      if (this.isEnabled()) {
        const gameState = G_GetGameState();
        if (
          gameState === GameState.RUNNING ||
          gameState === GameState.FIRST_PIECE
        ) {
          const currentPiece = GetCurrentPiece();
          if (currentPiece) {
            const { boardStr } = getBoardAfterLineClears(this.board);
            this.queryMove(
              currentPiece.id,
              boardStr,
              GetLevel() || 0,
              GetLines() || 0
            );
          }
        }
      } else {
        this.reset();
      }
    });
  }
}

AiPlayer.prototype.isEnabled = function () {
  return aiPlayerCheckbox ? aiPlayerCheckbox.checked : false;
};

AiPlayer.prototype.reset = function () {
  if (this.abortController) {
    this.abortController.abort();
    this.abortController = null;
  }
  this.inputQueue = [];
  this.requestId++;
};

AiPlayer.prototype.queryMove = async function (
  pieceId,
  boardStr,
  level,
  lines
) {
  if (!this.isEnabled()) {
    return;
  }

  // Cancel any existing in-flight request
  if (this.abortController) {
    this.abortController.abort();
    this.abortController = null;
  }

  this.abortController = new AbortController();
  const currentRequestId = ++this.requestId;
  this.inputQueue = [];

  const url = new URL("http://localhost:3000/get-move-cpp");
  url.searchParams.set("board", boardStr);
  url.searchParams.set("currentPiece", pieceId);
  url.searchParams.set("level", level);
  url.searchParams.set("lines", lines);
  url.searchParams.set("reactionTime", "0");
  url.searchParams.set("inputFrameTimeline", "X.....");
  url.searchParams.set("dasCharge", "-1");
  url.searchParams.set("playoutCount", "0");
  url.searchParams.set("playoutLength", "0");

  try {
    const response = await fetch(url.toString(), {
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      console.warn(`AI backend error: HTTP status ${response.status}`);
      return;
    }

    const text = await response.text();
    if (currentRequestId !== this.requestId) {
      // Outdated response, discard
      return;
    }

    const parts = text.split("|");
    const inputSequence = parts[1];
    if (inputSequence) {
      this.inputQueue = inputSequence.split("");
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      console.warn("AI backend request failed:", err);
    }
  }
};

AiPlayer.prototype.onGameStart = function (currentPieceId, level, lines) {
  if (!this.isEnabled()) {
    return;
  }
  this.reset();
  const { boardStr } = getBoardAfterLineClears(this.board);
  this.queryMove(currentPieceId, boardStr, level, lines);
};

AiPlayer.prototype.onPieceLock = function (
  upcomingPieceId,
  currentLevel,
  currentLines,
  nextTransitionLineCount
) {
  if (!this.isEnabled()) {
    return;
  }

  const { boardStr, linesCleared } = getBoardAfterLineClears(this.board);
  const nextLines = currentLines + linesCleared;
  let nextLevel = currentLevel;
  if (
    (GameSettings.shouldTransitionEveryLine() && linesCleared > 0) ||
    nextLines >= nextTransitionLineCount
  ) {
    nextLevel += 1;
  }

  this.queryMove(upcomingPieceId, boardStr, nextLevel, nextLines);
};

AiPlayer.prototype.handleFrame = function () {
  if (!this.isEnabled() || GetIsPaused()) {
    return;
  }

  if (this.inputQueue.length > 0) {
    const nextInput = this.inputQueue.shift();
    const action = INPUT_ACTIONS[nextInput];
    if (action) {
      action();
    }
  }
};
