import {
  G_PauseForMistake,
  GetHistoryReadIndex,
  GetIsMistakePauseActive,
  GetLevel,
  GetLines,
  GetMistakeGhostBoard,
  G_SetPreviewBoard,
  G_ClearPreviewBoard,
} from ".";
import { NUM_COLUMN, NUM_ROW, SquareState } from "./constants";
import { DecompressBoard, getUiPrefs, saveUiPrefs } from "./utils";

const engineTable = document.getElementById("engine-grid");
const inexhaustiveWarningContainer = document.getElementById(
  "inexhaustive-warning"
);
const inexhaustiveWarningText = document.getElementById(
  "inexhaustive-warning-text"
);
const inexhaustiveWarningIcon = document.getElementById(
  "inexhaustive-warning-icon"
);
const curPieceSelect = document.getElementById("engine-cur-piece");
const nextPieceSelect = document.getElementById("engine-next-piece");
const useNextCheckbox = document.getElementById("engine-use-next-checkbox");
const tapSpeedSelect = document.getElementById("engine-tap-speed");
const depthSelect = document.getElementById("engine-depth-select");
const backendErrorText = document.getElementById("engine-backend-error");
const requestButton = document.getElementById("engine-calculate-button");
const engineAutopauseCheckbox = document.getElementById(
  "engine-autopause-checkbox"
);
const engineAutopauseLevelSelect = document.getElementById(
  "engine-autopause-level"
);
const engineAutoAnalyzeCheckbox = document.getElementById(
  "engine-auto-analyze-checkbox"
);
const moveRatingContainer = document.getElementById("move-rating");
const moveRatingIcon = document.getElementById("move-rating-icon");
const moveRatingLabel = document.getElementById("move-rating-label");
const moveRatingValidating = document.getElementById("move-rating-validating");
const moveRatingDescription = document.getElementById(
  "move-rating-description"
);
const ignoreMistakeButton = document.getElementById("ignore-mistake-button");
const retryMistakeButton = document.getElementById("retry-mistake-button");
const continueMistakeButton = document.getElementById(
  "continue-mistake-button"
);

// Base eval-difference thresholds for each mistake severity, measured on a
// good board (bestScore > 0). Worse boards get a multiplicative scale factor
// applied to all three (see getAutopauseScaleFactor below).
const AUTOPAUSE_BASE_THRESHOLDS = {
  blunder: 15,
  mistake: 10,
  inaccuracy: 5,
};

const AUTOPAUSE_SEVERITY_RANK = {
  inaccuracy: 1,
  mistake: 2,
  blunder: 3,
};

// Eval differences are more extreme on worse boards, so scale all thresholds
// up linearly as the best available eval gets worse:
// - starts at 1.0x on good boards
// - caps out at 3.0x at bestScore=-200.
function getAutopauseScaleFactor(bestScore) {
  if (bestScore >= 0) {
    return 1.0;
  }
  const factor = 1 - bestScore / 100; // (NB: bestscore is negative here)
  return Math.min(4.0, Math.max(1.0, factor));
}

/**
 * Classifies an eval-difference (points lost vs. the best available move)
 * into a mistake severity: "blunder", "mistake" or "inaccuracy", or null
 * when the move is within the inaccuracy threshold. Thresholds scale with
 * board quality — see getAutopauseScaleFactor.
 */
function getMistakeSeverity(scoreDelta, bestScore) {
  const scaleFactor = Number.isFinite(bestScore)
    ? getAutopauseScaleFactor(bestScore)
    : 1.0;
  if (scoreDelta > AUTOPAUSE_BASE_THRESHOLDS.blunder * scaleFactor) {
    return "blunder";
  }
  if (scoreDelta > AUTOPAUSE_BASE_THRESHOLDS.mistake * scaleFactor) {
    return "mistake";
  }
  if (scoreDelta > AUTOPAUSE_BASE_THRESHOLDS.inaccuracy * scaleFactor) {
    return "inaccuracy";
  }
  return null;
}

// Eval points lost relative to the top move that maps to the "super
// blunder" end of the score color scale (very dark grey/black).
const SUPER_BLUNDER_DELTA = 150;

// Color stops for the score block background, in eval points lost relative
// to the section's top move. The threshold stops reuse the existing tier
// colors so severity still reads the same at the boundaries; between stops
// the color is interpolated linearly, so a borderline blunder and a huge
// one no longer get the exact same shade. All stops scale with board
// quality like the thresholds themselves.
function getScoreColor(scoreDelta, bestScore) {
  const scaleFactor = Number.isFinite(bestScore)
    ? getAutopauseScaleFactor(bestScore)
    : 1.0;
  const stops = [
    [0, [61, 148, 100]], // clean move: #3d9464
    [
      AUTOPAUSE_BASE_THRESHOLDS.inaccuracy * scaleFactor,
      [95, 125, 108], // inaccuracy: #5f7d6c
    ],
    [
      AUTOPAUSE_BASE_THRESHOLDS.mistake * scaleFactor,
      [107, 111, 117], // mistake: #6b6f75
    ],
    [
      AUTOPAUSE_BASE_THRESHOLDS.blunder * scaleFactor,
      [194, 84, 80], // blunder: #c25450
    ],
    [
      SUPER_BLUNDER_DELTA * scaleFactor,
      [12, 12, 12], // super blunder: near-black
    ],
  ];

  let color = stops[stops.length - 1][1]; // clamp above the last stop
  for (let i = 1; i < stops.length; i++) {
    if (scoreDelta <= stops[i][0]) {
      const [delta0, color0] = stops[i - 1];
      const [delta1, color1] = stops[i];
      const frac =
        delta1 === delta0 ? 0 : (scoreDelta - delta0) / (delta1 - delta0);
      color = color0.map((channel, j) =>
        Math.round(channel + frac * (color1[j] - channel))
      );
      break;
    }
  }
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function getSelectedAutopauseLevel() {
  const rawValue =
    engineAutopauseLevelSelect != null
      ? engineAutopauseLevelSelect.value
      : null;
  if (rawValue === "mistake" || rawValue === "inaccuracy") {
    return rawValue;
  }
  return "blunder";
}

// While a fresh analysis is computing, grey out the previous results and
// overlay a spinner so it's clear the panel is about to update.
function setEngineLoading(isLoading) {
  const resultsWrap = document.getElementById("engine-results-wrap");
  if (resultsWrap != null) {
    resultsWrap.classList.toggle("loading", isLoading);
  }
}

// Move-rating banner (above the board): a chess-notation-style icon + label
// for the move that triggered an auto-pause. Icons are minimalist inline
// SVGs following notation conventions — ?? blunder, X mistake, ? inaccuracy,
// green check good, !! brilliant — with a shared stroke weight so the set
// reads as one family, tinted per severity via currentColor.
const MOVE_RATING_ICON_STROKE =
  'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';

const MOVE_RATING_QUESTION_MARK_GLYPH =
  '<path d="M4.6 5.6C4.6 1.3 11.4 1.3 11.4 5.6C11.4 8 8 7.8 8 9.6" ' +
  MOVE_RATING_ICON_STROKE +
  '/><circle cx="8" cy="13.4" r="1.4" fill="currentColor"/>';

const MOVE_RATING_EXCLAMATION_MARK_GLYPH =
  '<path d="M8 2.6L8 9.4" ' +
  MOVE_RATING_ICON_STROKE +
  '/><circle cx="8" cy="13.4" r="1.4" fill="currentColor"/>';

const MOVE_RATING_STYLES = {
  brilliant: {
    icon:
      '<svg viewBox="0 0 24 16" aria-hidden="true">' +
      '<g transform="translate(-1.8 0)">' +
      MOVE_RATING_EXCLAMATION_MARK_GLYPH +
      '</g><g transform="translate(9.8 0)">' +
      MOVE_RATING_EXCLAMATION_MARK_GLYPH +
      "</g></svg>",
    label: "Brilliant",
    describe: true,
  },
  good: {
    icon:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 8.5L6.5 12.5L13.5 3.5" ' +
      MOVE_RATING_ICON_STROKE +
      "/></svg>",
    label: "Good",
    describe: true,
  },
  inaccuracy: {
    icon:
      '<svg viewBox="0 0 16 16" aria-hidden="true">' +
      MOVE_RATING_QUESTION_MARK_GLYPH +
      "</svg>",
    label: "Inaccuracy",
    describe: false,
  },
  mistake: {
    icon:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5" ' +
      MOVE_RATING_ICON_STROKE +
      "/></svg>",
    label: "Mistake",
    describe: false,
  },
  blunder: {
    icon:
      '<svg viewBox="0 0 24 16" aria-hidden="true">' +
      '<g transform="translate(-1.8 0)">' +
      MOVE_RATING_QUESTION_MARK_GLYPH +
      '</g><g transform="translate(9.8 0)">' +
      MOVE_RATING_QUESTION_MARK_GLYPH +
      "</g></svg>",
    label: "Blunder",
    describe: false,
  },
};

// Description lines for the Good/Brilliant verdicts, naming the severity
// that the initial low-depth search flagged so the reversal reads clearly
// ("an" for the vowel-initial severities).
function getMoveRatingDescription(ratingKey, flaggedSeverity) {
  const flagged =
    flaggedSeverity === "blunder" ||
    flaggedSeverity === "mistake" ||
    flaggedSeverity === "inaccuracy"
      ? flaggedSeverity
      : "mistake";
  const article = flagged === "inaccuracy" ? "an" : "a";
  // The trailing comma doubles as the line break between the flag and the
  // deeper-search resolution (rendered via white-space: pre-line). The
  // flagged severity is underlined for emphasis; the template only ever
  // embeds the fixed severity words, so the HTML is safe.
  const flaggedLine = `The initial low-depth search flagged this as ${article} <u>${flagged}</u>,`;
  if (ratingKey === "brilliant") {
    return `${flaggedLine}\nbut after a deeper search, it's actually the best move!`;
  }
  return `${flaggedLine}\nbut after a deeper search, it's a decent move.`;
}

// Pause-dismissal buttons: Ignore (accept the flagged placement) + Retry
// (unpause and re-place the piece) while the verdict is — or may still turn
// out to be — a mistake; a single Continue (same accept-and-resume behavior)
// once the analysis has cleared the move as Good/Brilliant.
function setMistakeActionButtons(showContinueOnly) {
  if (ignoreMistakeButton != null) {
    ignoreMistakeButton.style.display = showContinueOnly
      ? "none"
      : "inline-block";
  }
  if (retryMistakeButton != null) {
    retryMistakeButton.style.display = showContinueOnly
      ? "none"
      : "inline-block";
  }
  if (continueMistakeButton != null) {
    continueMistakeButton.style.display = showContinueOnly
      ? "inline-block"
      : "none";
  }
}

function hideMistakeActionButtons() {
  setMistakeActionButtons(false);
  if (continueMistakeButton != null) {
    continueMistakeButton.style.display = "none";
  }
}

function hideMoveRating() {
  if (moveRatingContainer != null) {
    moveRatingContainer.style.display = "none";
  }
  hideMistakeActionButtons();
}

// Show the banner for a rating key ("blunder" ... "brilliant"). While
// isValidating is true the verdict renders greyed-out next to a spinner; the
// deeper analysis will replace it with a confident verdict later.
// flaggedSeverity is the severity the initial low-depth check flagged, used
// in the Good/Brilliant descriptions.
function showMoveRating(ratingKey, isValidating, flaggedSeverity) {
  const style = MOVE_RATING_STYLES[ratingKey];
  if (moveRatingContainer == null || style == null) {
    return;
  }
  moveRatingIcon.innerHTML = style.icon;
  moveRatingLabel.textContent = style.label;
  moveRatingContainer.setAttribute("data-rating", ratingKey);
  moveRatingContainer.classList.toggle("validating", isValidating);
  // The "validated fine" verdicts (Good/Brilliant) get the explanatory
  // subline, since a flagged-then-cleared move is confusing without context.
  const isClearedVerdict = !isValidating && style.describe === true;
  moveRatingContainer.classList.toggle("has-description", isClearedVerdict);
  if (isClearedVerdict && moveRatingDescription != null) {
    moveRatingDescription.innerHTML = getMoveRatingDescription(
      ratingKey,
      flaggedSeverity
    );
  }
  setMistakeActionButtons(isClearedVerdict);
  moveRatingValidating.style.display = isValidating ? "inline-flex" : "none";
  moveRatingContainer.style.display = "flex";
}

// The eval points lost vs. the top move below which the player's move counts
// as tied for best (and thus Brilliant) — within a point, the gap is within
// search noise. An identical placement to the top move also counts as best,
// guarding against noise between duplicate list entries.
const BEST_MOVE_SCORE_EPSILON = 1.0;

/**
 * Resolves the banner once the deeper post-pause analysis lands. The
 * force-included player move is compared against the analysis' top move:
 * matching it is "brilliant", landing at/above the opted-in severity keeps
 * that mistake label, and anything gentler shows as "good".
 */
EngineAnalysisManager.prototype.finalizeMoveRating = function (moveList) {
  if (this.requestInfo.validationEpoch !== this.rateMoveRequestEpoch) {
    // Superseded by cancelInFlightRateMoveRequest (undo/redo, restart, quit)
    // while validating — the banner was already hidden by the cancellation.
    return;
  }
  if (
    typeof GetIsMistakePauseActive === "function" &&
    !GetIsMistakePauseActive()
  ) {
    // The mistake pause ended before validation completed (Ignore / Retry /
    // manual unpause), so the banner is gone; don't resurrect it — and its
    // dismissal buttons — over live gameplay or a later manual pause.
    return;
  }
  let playerEntry = null;
  for (const move of moveList) {
    if (move.isPlayerMove) {
      playerEntry = move;
      break;
    }
  }
  const topMove = moveList.length > 0 ? moveList[0] : null;
  if (playerEntry == null || topMove == null) {
    hideMoveRating();
    return;
  }
  const bestScore = topMove.playoutScore;
  const playerDelta = bestScore - playerEntry.playoutScore;
  const samePlacementAsTop =
    playerEntry.firstPlacement[0] === topMove.firstPlacement[0] &&
    playerEntry.firstPlacement[1] === topMove.firstPlacement[1];
  if (playerDelta <= BEST_MOVE_SCORE_EPSILON || samePlacementAsTop) {
    // The depth-3 flag was wrong: further inspection crowns the player's
    // move as the best available.
    showMoveRating("brilliant", false, this.moveRatingInitialSeverity);
    return;
  }
  const severity = getMistakeSeverity(playerDelta, bestScore);
  const optedIn =
    severity != null &&
    AUTOPAUSE_SEVERITY_RANK[severity] >=
      AUTOPAUSE_SEVERITY_RANK[getSelectedAutopauseLevel()];
  showMoveRating(
    optedIn ? severity : "good",
    false,
    this.moveRatingInitialSeverity
  );
};

// The usual number of entries the engine returns per section. When the
// player's move is force-included but ranks outside the usual list, the
// backend appends it as an extra entry (e.g. a 9th default move) and the
// UI shows "..." instead of its rank number.
const DEFAULT_MOVES_LIST_SIZE = 8;
const ADJUSTMENTS_LIST_SIZE = 3;

// Whether the next piece should be included in calculations. Defaults to true
// if the toggle doesn't exist (e.g. stale HTML cached against a new bundle).
function isNextPieceEnabled() {
  return useNextCheckbox == null || useNextCheckbox.checked;
}

// Whether a mistake pause should automatically fetch the top moves for the
// rewind position. Defaults to true if the toggle doesn't exist (e.g.
// stale HTML cached against a new bundle).
function isAutoAnalyzeAfterPauseEnabled() {
  return engineAutoAnalyzeCheckbox == null || engineAutoAnalyzeCheckbox.checked;
}

// Auto-analysis is meaningless without auto-pause (nothing pauses to analyze
// after), so grey the toggle out while auto-pause is off. No-op when the
//autopause checkbox is missing (stale HTML), leaving the toggle as-is.
function syncAutoAnalyzeDisabledState() {
  if (engineAutoAnalyzeCheckbox != null && engineAutopauseCheckbox != null) {
    engineAutoAnalyzeCheckbox.disabled = !engineAutopauseCheckbox.checked;
  }
}

EngineAnalysisManager.prototype.cancelInFlightRateMoveRequest = function () {
  // NB: bumps the same counter that rate responses are stamped with, so a
  // response that lands after this call is recognized as stale and dropped.
  this.rateMoveRequestEpoch += 1;
  // Navigation/restart also invalidates the move-rating banner's context.
  hideMoveRating();
};

// Hide the move-rating banner without canceling any in-flight analysis
// (used when a mistake pause ends and the banner's context is over).
EngineAnalysisManager.prototype.clearMoveRating = function () {
  hideMoveRating();
};

function syncNextPieceDisabledState() {
  if (nextPieceSelect != null && useNextCheckbox != null) {
    nextPieceSelect.disabled = !useNextCheckbox.checked;
  }
}

// During a mistake pause the overlay shows a translucent ghost of the
// player's misplaced piece. Engine responses and hover exits must restore
// that ghost instead of clearing the overlay, otherwise the auto-fetched
// top-moves comparison wipes it. Outside a mistake pause this just clears.
function restoreMistakeGhostOrClear() {
  const ghostBoard =
    typeof GetMistakeGhostBoard === "function" ? GetMistakeGhostBoard() : null;
  if (ghostBoard != null) {
    G_SetPreviewBoard(ghostBoard, 0.5, /* greyscale */ true);
  } else {
    G_ClearPreviewBoard();
  }
}

const stackRabbitWorker = new Worker("./wasm/stackrabbit-worker.js");

export function EngineAnalysisManager(board) {
  this.board = board; // Pass by reference, thus is kept in sync automatically
  this.boardSnapshot = null;
  this.curPiece = "O";
  this.nextPiece = "";
  this.requestInfo = {};
  this.requestStartTime = null;
  // Increment-only epoch counter that's incremented every time a cancellation
  // request is sent. The initial value can be stored when a request is sent,
  // and then when the request finishes we can compare the current value to
  // check for cancellations during the request.
  this.rateMoveRequestEpoch = 0;
  // Severity the current rating banner's low-depth check flagged (null when
  // no rating is active); names the mistake in Good/Brilliant descriptions.
  this.moveRatingInitialSeverity = null;

  stackRabbitWorker.onmessage = this.onMessage.bind(this);

  requestButton.addEventListener("click", (e) => this.makeRequest());

  // Toggle for including the next piece in calculations. When re-enabled,
  // resync the dropdown with the latest known game piece.
  if (useNextCheckbox != null) {
    syncNextPieceDisabledState();
    useNextCheckbox.addEventListener("change", (e) => {
      syncNextPieceDisabledState();
      if (e.target.checked && nextPieceSelect != null) {
        nextPieceSelect.value = this.nextPiece || "";
      }
    });
  }

  // Grey out auto-analysis while auto-pause is off (and track toggles).
  syncAutoAnalyzeDisabledState();
  if (engineAutopauseCheckbox != null) {
    engineAutopauseCheckbox.addEventListener("change", () => {
      syncAutoAnalyzeDisabledState();
    });
  }

  // Restore the saved toggle states (absent keys leave the HTML defaults:
  // auto-pause off, auto-analyze on, pause level blunders), then keep them
  // persisted on change.
  const enginePrefs = getUiPrefs();
  if (engineAutopauseCheckbox != null && enginePrefs.engineAutopause != null) {
    engineAutopauseCheckbox.checked = enginePrefs.engineAutopause;
  }
  if (
    engineAutoAnalyzeCheckbox != null &&
    enginePrefs.engineAutoAnalyze != null
  ) {
    engineAutoAnalyzeCheckbox.checked = enginePrefs.engineAutoAnalyze;
  }
  if (
    engineAutopauseLevelSelect != null &&
    enginePrefs.engineAutopauseLevel != null &&
    Object.prototype.hasOwnProperty.call(
      AUTOPAUSE_SEVERITY_RANK,
      enginePrefs.engineAutopauseLevel
    )
  ) {
    // Only restore recognized levels; anything else (stale or corrupt pref)
    // leaves the HTML default (blunders).
    engineAutopauseLevelSelect.value = enginePrefs.engineAutopauseLevel;
  }
  syncAutoAnalyzeDisabledState();

  const saveEngineTogglePrefs = function () {
    const prefs = getUiPrefs();
    if (engineAutopauseCheckbox != null) {
      prefs.engineAutopause = engineAutopauseCheckbox.checked;
    }
    if (engineAutoAnalyzeCheckbox != null) {
      prefs.engineAutoAnalyze = engineAutoAnalyzeCheckbox.checked;
    }
    if (engineAutopauseLevelSelect != null) {
      prefs.engineAutopauseLevel = engineAutopauseLevelSelect.value;
    }
    saveUiPrefs(prefs);
  };
  if (engineAutopauseCheckbox != null) {
    engineAutopauseCheckbox.addEventListener("change", saveEngineTogglePrefs);
  }
  if (engineAutoAnalyzeCheckbox != null) {
    engineAutoAnalyzeCheckbox.addEventListener("change", saveEngineTogglePrefs);
  }
  if (engineAutopauseLevelSelect != null) {
    engineAutopauseLevelSelect.addEventListener(
      "change",
      saveEngineTogglePrefs
    );
  }
}

EngineAnalysisManager.prototype.isAutoAnalyzeAfterPauseEnabled = function () {
  return isAutoAnalyzeAfterPauseEnabled();
};

EngineAnalysisManager.prototype.snapshotBoard = function () {
  this.boardSnapshotStr = this.board
    .map((row) => row.slice(0, 10).join(""))
    .join("")
    .replace(/2|3/g, "1");
};

// Handle receiving a message from the WASM worker
EngineAnalysisManager.prototype.onMessage = function (event) {
  setEngineLoading(false);
  const data = event.data;
  const elapsedMs = Date.now() - this.requestStartTime;
  this.requestStartTime = null;
  console.log(`Finished request in ${elapsedMs} ms`);

  if (data.error) {
    console.log("Received error from WASM worker.");
    console.error(data.error);
    backendErrorText.style.visibility = "visible";
    // Strip the backend's own "Error: " prefix; the header already says
    // "Error loading analysis."
    const backendMessage = data.error.replace(/^Error:\s*/, "");
    backendErrorText.innerHTML =
      "Error loading analysis:<br/>" + backendMessage;
    engineTable.style.display = "none";
    if (this.requestInfo.isMistakeValidation) {
      // Validation failed (e.g. "player move not found"); drop the banner
      // rather than leave it spinning with no verdict coming.
      hideMoveRating();
    }
  } else if (this.requestInfo.isRateRequest) {
    if (this.requestInfo.rateMoveRequestEpoch !== this.rateMoveRequestEpoch) {
      // Superseded by cancelInFlightRateMoveRequest (undo/redo, restart, quit)
      // while this response was in flight — drop it harmlessly.
      console.log("Dropping stale rate response after cancellation.");
      return;
    }
    console.log("Rating reponse", data.result);
    const scoreDeltaNoAdj =
      data.result.bestMoveNoAdjustment - data.result.playerMoveNoAdjustment;
    const scoreDeltaWithAdj =
      data.result.bestMoveAfterAdjustment -
      data.result.playerMoveAfterAdjustment;
    const bestScore = data.result.bestMoveNoAdjustment;
    console.log(
      "Score difference:",
      scoreDeltaNoAdj,
      "(with adjustment: " + scoreDeltaWithAdj + ")",
      `(thresholds x${
        Number.isFinite(bestScore) ? getAutopauseScaleFactor(bestScore) : 1.0
      })`
    );
    // If we have the post-adjustment rating, use the min of that and the pre-adjustment rating.
    // (i.e. giving the player the benefit of the doubt——they could've been making a good default move or a good adjustment.)
    const effectiveDelta = Number.isFinite(scoreDeltaWithAdj)
      ? Math.min(scoreDeltaNoAdj, scoreDeltaWithAdj)
      : scoreDeltaNoAdj;
    const detectedSeverity = getMistakeSeverity(effectiveDelta, bestScore);
    if (detectedSeverity != null) {
      const selectedLevel = getSelectedAutopauseLevel();
      const shouldPause =
        AUTOPAUSE_SEVERITY_RANK[detectedSeverity] >=
        AUTOPAUSE_SEVERITY_RANK[selectedLevel];
      console.log(
        `Detected ${detectedSeverity} (delta=${effectiveDelta}), selected level=${selectedLevel}, pausing=${shouldPause}`
      );
      if (shouldPause) {
        // NB: compute the validation flag BEFORE calling G_PauseForMistake.
        // When the pause lands immediately, that call also fires the deeper
        // auto-analysis, which replaces this.requestInfo (dropping
        // rateResultBoard) before the flag would be read below — so every
        // severity would show up confident with no "Validating..." phase.
        const willValidate =
          this.requestInfo.rateResultBoard != null &&
          isAutoAnalyzeAfterPauseEnabled();
        // Remember what the low-depth check flagged, for the Good/Brilliant
        // descriptions once the deeper analysis resolves the verdict.
        this.moveRatingInitialSeverity = detectedSeverity;
        G_PauseForMistake(
          this.requestInfo.rateHistoryIndex,
          this.requestInfo.rateResultBoard
        );
        // Surface the depth-3 verdict above the board. When the deeper
        // auto-analysis will run, show it greyed-out with a "Validating..."
        // spinner until that verdict comes back; otherwise (auto-analyze
        // disabled) the depth-3 verdict stands as-is.
        showMoveRating(detectedSeverity, willValidate, detectedSeverity);
      }
    }
  } else {
    const response = data.result;
    let parsedResult = this.requestInfo.isHybrid
      ? // The two lists are originally distinct properties in a JSON object. Instead concatenate them into one array.
        response.noNextBox.concat(response.nextBox)
      : // Just one list, no formatting needed
        response;

    if (this.requestInfo.isMistakeValidation) {
      this.finalizeMoveRating(parsedResult);
    }
    this.loadResponseCpp(this.requestInfo, parsedResult);
  }
};

EngineAnalysisManager.prototype.updatePieces = function (
  curPieceId,
  nextPieceId
) {
  this.curPiece = curPieceId || "";
  this.nextPiece = nextPieceId || "";
  curPieceSelect.value = this.curPiece;
  // Don't clobber the user's manual selection while the next piece is
  // toggled off (the game pushes updates here on every piece lock).
  if (isNextPieceEnabled()) {
    nextPieceSelect.value = this.nextPiece;
  }
};

EngineAnalysisManager.prototype.makeRequest = async function (
  isRateRequest,
  secondBoardOverride,
  isMistakeValidation
) {
  if (isRateRequest && !engineAutopauseCheckbox.checked) {
    // Skip this request due to the settingn being disabled.
    return;
  }

  // If a request is already in flight, drop this one without touching
  // requestInfo. requestInfo must always describe the in-flight request,
  // otherwise a late response gets attributed to the wrong piece
  // (e.g. "Blunder detected! For piece: <wrong piece>").
  if (this.requestStartTime != null) {
    console.log("BACKEND BUSY!");
    return;
  }

  const isHybridRequest =
    isNextPieceEnabled() &&
    nextPieceSelect.value != null &&
    nextPieceSelect.value != "";

  // Calculate the board after all pending line clears for rate move requests
  let boardAfterStr = "";
  if (isRateRequest) {
    let fullRows = 0;
    for (const row of this.board) {
      const joinedRow = row.slice(0, 10).join("").replace(/2|3/g, "1");
      if (joinedRow == "1111111111") {
        fullRows++;
      } else {
        boardAfterStr += joinedRow;
      }
    }

    // Prepend empty rows that shift onto the top of the screen
    for (let i = 0; i < fullRows; i++) {
      boardAfterStr = "0000000000" + boardAfterStr;
    }
  } else if (secondBoardOverride) {
    // Player's resulting board for a mistake-pause follow-up GET_TOP_MOVES,
    // so the engine force-includes the player's move in the returned list.
    boardAfterStr = secondBoardOverride;
  }

  // Compile arguments
  const encodedBoard = this.board
    .map((row) => row.slice(0, 10).join(""))
    .join("")
    .replace(/2|3/g, "1");
  let boardStr = isRateRequest ? this.boardSnapshotStr : encodedBoard;

  const curPiece = curPieceSelect.value;
  const nextPiece = isHybridRequest ? nextPieceSelect.value : "-1";
  const tapSpeed = tapSpeedSelect.value;
  let depthChoice = depthSelect.value.split("x");
  const requestType = isRateRequest
    ? "rateMove"
    : isHybridRequest
    ? "getTopMovesHybrid"
    : "getTopMoves";

  // Hardcode to disable depth >3 on automatic requests
  if (isRateRequest && depthChoice[1] > 3) {
    depthChoice = [343, 3]; // Exhaustive at depth 3
  }
  const playoutCount = parseInt(depthChoice[0]);
  const playoutLength = parseInt(depthChoice[1]);

  console.log("depth choice", depthChoice);

  // Save info about the request to refer to later
  this.requestInfo = {
    firstPiece: curPiece,
    secondPiece: nextPiece,
    playoutCount: playoutCount,
    playoutLength: playoutLength,
    isExhaustive: playoutCount == Math.pow(7, playoutLength),
    isHybrid: !isRateRequest && isHybridRequest,
    isRateRequest: isRateRequest,
    // History position captured when the rate request is sent. This is the
    // start-of-piece snapshot of the piece being rated, used to rewind to it
    // if the rating comes back as a mistake.
    rateHistoryIndex: isRateRequest ? GetHistoryReadIndex() : null,
    // Board right after the piece locked, captured when the rate request is
    // sent (lines not yet cleared). Already in the exact 2D-array format
    // G_SetPreviewBoard renders, so a blunder can be shown as a ghost
    // overlay after rewinding.
    rateResultBoard:
      isRateRequest && this.board != null
        ? this.board.map((row) => row.slice(0, 10))
        : null,
    // Pre-request board encoding for manual (non-rate) requests, used to
    // highlight the just-placed piece in hover previews via diffing.
    boardBeforeStr: isRateRequest ? null : encodedBoard,
    // Generation stamp for mistake checks; a late response whose stamp no
    // longer matches was superseded by cancelInFlightRateMoveRequest and is
    // dropped.
    rateMoveRequestEpoch: isRateRequest ? this.rateMoveRequestEpoch : null,
    // Marks the auto-fetched post-pause GET_TOP_MOVES that validates the
    // flagged mistake at full depth; its response finalizes the move-rating
    // banner.
    isMistakeValidation: !isRateRequest && isMistakeValidation === true,
    // Cancellation stamp for the validation request, checked the same way as
    // rateMoveRequestEpoch above.
    validationEpoch:
      !isRateRequest && isMistakeValidation === true
        ? this.rateMoveRequestEpoch
        : null,
  };
  const params = {
    level: Math.max(GetLevel() || 0, 18),
    lines: GetLines() || 0,
    inputFrameTimeline: tapSpeed,
    currentPiece: curPiece,
    nextPiece: nextPiece,
    board: boardStr,
    secondBoard: boardAfterStr,
    playoutLength: playoutLength,
    playoutCount: playoutCount,
  };

  // HOTFIX FOR LEVEL 28
  if (params.level == 28) {
    params.lines -= 10; // Pretend we're on 27 instead since SR gets so confused on 28
    params.level -= 1;
  }

  if (!isRateRequest) {
    // Temporarily disable the button to prevent spamming
    requestButton.disabled = true;
    setTimeout(() => {
      requestButton.disabled = false;
    }, 2000);

    // Grey out the old results and show the spinner while this computes
    setEngineLoading(true);

    // Reset focus (so pressing 'enter' doesn't make subsequent requests)
    document.activeElement.blur();
  }

  // Actually make the call to the WASM worker
  this.requestStartTime = Date.now();
  const command = [requestType, params];
  stackRabbitWorker.postMessage(command);
};

/** Loads the SR2.0 engine response into the UI */
EngineAnalysisManager.prototype.loadResponseCpp = function (reqInfo, moveList) {
  engineTable.innerHTML = "";
  restoreMistakeGhostOrClear();
  // Safety net: if the mouse leaves the list entirely (e.g. fast movement
  // that skips per-row mouseleave), restore the mistake ghost if one is
  // active, otherwise remove the preview.
  engineTable.onmouseleave = () => restoreMistakeGhostOrClear();
  backendErrorText.style.visibility = "hidden";
  engineTable.style.display = "block";

  let numNnb = 0;
  for (let i = 0; i < moveList.length; i++) {
    if (moveList[i].secondPlacement) {
      break;
    }
    numNnb += 1;
  }

  // Potentially show warning for inexhaustive playouts
  inexhaustiveWarningContainer.style.display = "flex";
  if (this.requestInfo.isExhaustive) {
    // inexhaustiveWarningContainer.style.display = "none";
    inexhaustiveWarningIcon.src = "static/checkmark_transparent.webp";
    inexhaustiveWarningText.innerHTML = `All possible piece sequences were tested. </br><em>Variance: none</em>`;
  } else {
    // Do some math to find the variance
    const n = this.requestInfo.playoutCount;
    const stdev = this.requestInfo.playoutLength * 11.25; // Rough estimate based on some data points I tested
    const plusOrMinus90PercentCI =
      Math.round(((1.6449 * stdev) / Math.sqrt(n)) * 20) / 20;

    // inexhaustiveWarningContainer.style.display = "flex";
    inexhaustiveWarningIcon.src = "static/warning_icon_transparent.webp";
    inexhaustiveWarningText.innerHTML = `High-depth search gives long-term insight, but there's some variance since we can't calculate all possible sequences.<br/><em>Variance: +/- ${plusOrMinus90PercentCI}, n=${this.requestInfo.playoutCount}</em>`;
  }

  if (numNnb > 0) {
    // Add a header for the default move section
    const defaultMovesHeader = document.createElement("h4");
    defaultMovesHeader.innerHTML = "Default Moves";
    defaultMovesHeader.classList.add("engine-section-title");
    engineTable.appendChild(defaultMovesHeader);
  }

  let rankIndex = 1;
  let sectionTopScore = null;
  for (let i = 0; i < moveList.length; i++) {
    const mainMove = moveList[i];

    if (i === numNnb) {
      // If we hit the cutoff between NNB and NB entries, reset the rankings
      rankIndex = 1;

      // Add a header for the adjustment section
      const adjustmentHeader = document.createElement("h4");
      adjustmentHeader.innerHTML = "Adjustments";
      adjustmentHeader.classList.add("engine-section-title");
      engineTable.appendChild(adjustmentHeader);
    }

    if (rankIndex === 1) {
      sectionTopScore = mainMove.playoutScore;
    }

    const row = document.createElement("div");
    engineTable.appendChild(row);
    row.classList.add("move-row");

    const rank = document.createElement("div");
    rank.classList.add("move-rank");
    // When the player's move is force-included but doesn't make the usual
    // top-N list, the engine appends it as an extra entry (e.g. a 9th
    // default move). Show "..." instead of the rank number to signal that
    // it sits outside the normal list.
    const expectedListSize =
      i < numNnb ? DEFAULT_MOVES_LIST_SIZE : ADJUSTMENTS_LIST_SIZE;
    rank.innerHTML =
      mainMove.isPlayerMove && rankIndex > expectedListSize ? "..." : rankIndex;
    row.appendChild(rank);

    if (mainMove.isPlayerMove) {
      const playerBand = document.createElement("div");
      playerBand.classList.add("player-move-band");
      playerBand.innerHTML = "<span>Your</span><span>Move</span>";
      row.appendChild(playerBand);
    }

    // Placement chips: piece/rotation badge + column digits
    const chips = document.createElement("div");
    chips.classList.add("move-chips");
    const [firstRot, firstX] = mainMove.firstPlacement;
    chips.appendChild(
      getMoveChipElement(
        getNotatedMoveCpp(reqInfo.firstPiece, firstRot, firstX)
      )
    );
    if (mainMove.secondPlacement) {
      const arrow = document.createElement("span");
      arrow.classList.add("chip-arrow");
      arrow.innerHTML = "&rarr;";
      chips.appendChild(arrow);
      const [secondRot, secondX] = mainMove.secondPlacement;
      chips.appendChild(
        getMoveChipElement(
          getNotatedMoveCpp(reqInfo.secondPiece, secondRot, secondX)
        )
      );
    }
    row.appendChild(chips);

    // Score block, tinted continuously by the move's eval loss relative to the
    // section's top move, using the same thresholds as auto-pause detection.
    const score = document.createElement("div");
    const scoreDelta = sectionTopScore - mainMove.playoutScore;
    score.style.background = getScoreColor(scoreDelta, sectionTopScore);
    score.classList.add("move-score");
    const numDecimalPlaces = this.requestInfo.isExhaustive ? 1 : 0;
    score.innerHTML =
      // (this.requestInfo.isExhaustive
      //   ? ""
      //   : '<span class="score-tilde">~</span>') +
      mainMove.playoutScore.toFixed(numDecimalPlaces);
    row.appendChild(score);

    let detailRow = document.createElement("div");
    engineTable.appendChild(detailRow);
    detailRow.style.visibility = "hidden";
    detailRow.style.maxHeight = "0px";
    detailRow.classList.add("detail-view-cpp");
    createDetailViewCpp(detailRow, mainMove, reqInfo, detailRow);

    // Add a click listener to toggle visibility of the detail row
    row.addEventListener("click", (e) => {
      toggleDetailsVisibility(detailRow);
    });

    // On hover, temporarily show this move's resulting board on the overlay canvas.
    row.addEventListener("mouseenter", (e) => {
      try {
        const resultBoard = DecompressBoard(mainMove.resultingBoard);
        G_SetPreviewBoard(
          applyPlacementHighlight(resultBoard, reqInfo.boardBeforeStr)
        );
      } catch (err) {
        console.error("Failed to preview board:", err);
      }
    });
    row.addEventListener("mouseleave", (e) => {
      restoreMistakeGhostOrClear();
    });

    rankIndex += 1;
  }
};

/**
 * Builds the chip UI for one placement notation
 * ("{piece}{rotation}-{columns}", e.g. "T2-456"): a badge holding the piece
 * and rotation letters, followed by the column digits.
 */
function getMoveChipElement(notation) {
  const chip = document.createElement("div");
  chip.classList.add("move-chip");
  const dashIndex = notation.indexOf("-");
  const piece = document.createElement("span");
  piece.classList.add("piece-badge");
  piece.innerHTML = notation.slice(0, dashIndex);
  const cols = document.createElement("span");
  cols.classList.add("chip-cols");
  cols.innerHTML = notation.slice(dashIndex + 1);
  chip.appendChild(piece);
  chip.appendChild(cols);
  return chip;
}

// Recolor the just-placed piece cells in a hover-preview board so they stand
// out from the rest of the stack. The diff is only exact when the move
// cleared no lines: a placement adds exactly 4 fills and each cleared line
// removes 10 (rows above shifting down would otherwise be misattributed to
// the piece). When the fill delta isn't exactly 4, the board is returned
// unchanged and renders in the single legacy color.
function applyPlacementHighlight(resultBoardAry, beforeBoardStr) {
  if (beforeBoardStr == null) {
    return resultBoardAry;
  }
  let beforeFills = 0;
  for (const ch of beforeBoardStr) {
    if (ch === "1") {
      beforeFills += 1;
    }
  }
  let resultFills = 0;
  for (let r = 0; r < NUM_ROW; r++) {
    for (let c = 0; c < NUM_COLUMN; c++) {
      if (resultBoardAry[r][c] !== 0) {
        resultFills += 1;
      }
    }
  }
  if (resultFills - beforeFills !== 4) {
    return resultBoardAry;
  }
  for (let r = 0; r < NUM_ROW; r++) {
    for (let c = 0; c < NUM_COLUMN; c++) {
      if (
        resultBoardAry[r][c] !== 0 &&
        beforeBoardStr[r * NUM_COLUMN + c] !== "1"
      ) {
        resultBoardAry[r][c] = SquareState.COLOR3;
      }
    }
  }
  return resultBoardAry;
}

function getRenderedMiniBoard(compressedBoard) {
  const boardAry = DecompressBoard(compressedBoard);
  const squareSize = 5;
  // Create drawing canvas
  const canvas = document.createElement("canvas");
  canvas.width = 10 * squareSize;
  canvas.height = 20 * squareSize;
  canvas.style.background = "#bbb";
  const drawContext = canvas.getContext("2d");
  drawContext.fillStyle = "#444";

  for (let r = 0; r < NUM_ROW; r++) {
    for (let c = 0; c < NUM_COLUMN; c++) {
      if (boardAry[r][c] === 1) {
        drawContext.fillRect(
          c * squareSize + 0.5,
          r * squareSize + 0.5,
          squareSize - 0.5,
          squareSize - 0.5
        );
      }
    }
  }

  return canvas;
}

function addPlayoutView(parent, playoutObj, title, bgColorStr) {
  const container = document.createElement("tr");
  container.style.backgroundColor = bgColorStr;

  const leftPanel = document.createElement("td");
  leftPanel.classList.add("playout-table-left");
  const rightPanel = document.createElement("td");
  rightPanel.classList.add("playout-table-right");
  container.appendChild(leftPanel);
  container.appendChild(rightPanel);

  const pieces = playoutObj.pieceSequence.split("");
  let movesFormatted = [];
  for (let i = 0; i < playoutObj.placements.length; i++) {
    const placement = playoutObj.placements[i];
    movesFormatted.push(
      getNotatedMoveCpp(pieces[i], placement[0], placement[1])
    );
  }

  const label = document.createElement("span");
  label.innerHTML = `<strong>${title}:</strong> ${
    playoutObj.score
  }<br/>&nbsp;&nbsp;${movesFormatted.join("<br/>&nbsp;&nbsp;")}`;

  leftPanel.appendChild(label);

  rightPanel.appendChild(getRenderedMiniBoard(playoutObj.resultingBoard));
  parent.appendChild(container);
}

function humanizeFactorName(name) {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function createDetailViewCpp(parent, move, requestInfo, detailRow) {
  // Add info for the immediate result
  const immediateInfoContainer = document.createElement("div");
  immediateInfoContainer.classList.add("immediate-info-panel");

  // Add rendered board to the left
  const boardWrap = document.createElement("div");
  boardWrap.classList.add("eval-board-wrap");
  boardWrap.appendChild(getRenderedMiniBoard(move.resultingBoard));
  immediateInfoContainer.appendChild(boardWrap);

  // Add eval info to the right
  const rightPanel = document.createElement("div");
  rightPanel.classList.add("immediate-info-right-panel");
  immediateInfoContainer.appendChild(rightPanel);

  const scoreValue = Number(move.shallowEvalScore);
  const scoreHeader = document.createElement("div");
  const scoreLabelRow = document.createElement("div");
  scoreLabelRow.classList.add("eval-score-label-row");
  const scoreLabel = document.createElement("div");
  scoreLabel.classList.add("eval-score-label");
  scoreLabel.textContent = "Shallow Eval:";
  scoreLabelRow.appendChild(scoreLabel);
  const infoWrap = document.createElement("span");
  infoWrap.classList.add("eval-info");
  const infoButton = document.createElement("button");
  infoButton.classList.add("eval-info-button");
  infoButton.textContent = "i";
  infoButton.setAttribute("aria-label", "About shallow eval score");
  infoButton.setAttribute("type", "button");
  infoWrap.appendChild(infoButton);
  const infoPopup = document.createElement("div");
  infoPopup.classList.add("eval-info-popup");
  infoPopup.textContent =
    "This shallow eval score is the result of running the eval function on the immediately resulting position. By contrast, the main score calculates all the possible future outcomes, and averages out the final eval across all the timelines. This means the main score number is more accurate, but the shallow eval factors are easier to understand and still give a general idea of what's contributing to the score. To see the derivation of the main score, click 'Show Playout Details'.";
  infoWrap.appendChild(infoPopup);
  scoreLabelRow.appendChild(infoWrap);
  const scoreEl = document.createElement("div");
  scoreEl.classList.add(
    "eval-score-value",
    scoreValue >= 0 ? "positive" : "negative"
  );
  scoreEl.textContent = Number.isFinite(scoreValue)
    ? scoreValue.toFixed(2)
    : String(move.shallowEvalScore);
  scoreHeader.appendChild(scoreLabelRow);
  scoreHeader.appendChild(scoreEl);
  rightPanel.appendChild(scoreHeader);

  const factorsWrap = document.createElement("div");
  factorsWrap.classList.add("eval-factors");
  let evalExplStr = move.evalExplanation || "";
  if (evalExplStr.includes("SUBTOTAL")) {
    evalExplStr = evalExplStr.split("SUBTOTAL")[0];
  }
  const factors = evalExplStr
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const factor of factors) {
    const eqIndex = factor.indexOf("=");
    const row = document.createElement("div");
    row.classList.add("factor-row");
    const nameEl = document.createElement("span");
    nameEl.classList.add("factor-name");
    const valueEl = document.createElement("span");
    valueEl.classList.add("factor-value");
    if (eqIndex !== -1) {
      const name = humanizeFactorName(factor.slice(0, eqIndex).trim());
      const rawValue = factor.slice(eqIndex + 1).trim();
      const num = parseFloat(rawValue);
      nameEl.textContent = name;
      if (Number.isFinite(num)) {
        valueEl.textContent = (num >= 0 ? "+" : "") + num.toFixed(2);
        valueEl.classList.add(num >= 0 ? "positive" : "negative");
      } else {
        valueEl.textContent = rawValue;
      }
    } else {
      nameEl.textContent = factor;
      valueEl.textContent = "";
    }
    row.appendChild(nameEl);
    row.appendChild(valueEl);
    factorsWrap.appendChild(row);
  }
  rightPanel.appendChild(factorsWrap);

  parent.appendChild(immediateInfoContainer);

  // Add a button to expand/collapse playout details
  const toggleButton = document.createElement("button");
  toggleButton.textContent = "Show Playout Details";
  toggleButton.classList.add("playout-toggle");
  parent.appendChild(toggleButton);

  // Add boards for each of the playouts
  const table = document.createElement("table");
  table.classList.add("playout-table");
  table.style.display = "none"; // Hide by default
  addPlayoutView(table, move.playout1, "Best Seen Playout", "#328532");
  addPlayoutView(table, move.playout2, "Good Case", "#4c864c");
  addPlayoutView(table, move.playout3, "Above Avg Case", "#6c8e6c");
  addPlayoutView(table, move.playout4, "Median Case", "#767676");
  addPlayoutView(table, move.playout5, "Below Avg Case", "#4e4e4e");
  addPlayoutView(table, move.playout6, "Bad Case", "#373737");
  addPlayoutView(table, move.playout7, "Worst Seen Playout", "#262626");
  parent.appendChild(table);

  toggleButton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (table.style.display === "none") {
      table.style.display = "table";
      toggleButton.textContent = "Hide Playout Details";
      // Update max-height of parent container dynamically if needed
      detailRow.style.maxHeight = "1500px";
    } else {
      table.style.display = "none";
      toggleButton.textContent = "Show Playout Details";
      detailRow.style.maxHeight = "300px";
    }
  });
}

function toggleDetailsVisibility(detailsView) {
  if (detailsView.style.visibility === "visible") {
    detailsView.style.maxHeight = "0px";
    detailsView.style.visibility = "hidden";
    detailsView.style.padding = "0";
  } else {
    detailsView.style.visibility = "visible";
    detailsView.style.maxHeight = "1500px";
    detailsView.style.padding = "10px 0";
  }
}

function isAnyOf(testChar, candidates) {
  for (const loopChar of candidates) {
    if (testChar === loopChar) {
      return true;
    }
  }
  return false;
}

const ROTATION_LETTER_LOOKUP = {
  I: ["", ""],
  O: [""],
  L: ["d", "l", "u", "r"],
  J: ["d", "l", "u", "r"],
  T: ["d", "l", "u", "r"],
  S: ["", ""],
  Z: ["", ""],
};

const PIECE_WIDTH_LOOKUP = {
  I: [4, 1],
  O: [2],
  L: [3, 2, 3, 2],
  J: [3, 2, 3, 2],
  T: [3, 2, 3, 2],
  S: [3, 2],
  Z: [3, 2],
};

const LEFTMOST_COL_LOOKUP = {
  I: [4, 6],
  O: [5],
  L: [5, 5, 5, 6],
  J: [5, 5, 5, 6],
  T: [5, 5, 5, 6],
  S: [5, 6],
  Z: [5, 6],
};

function getNotatedMove(pieceStr, inputSequence, isSpecialMove) {
  let rotationIndex = 0;
  let shiftIndex = 0;
  for (const inputChar of inputSequence) {
    if (isAnyOf(inputChar, "AEI")) {
      rotationIndex++;
    }
    if (isAnyOf(inputChar, "BFG")) {
      rotationIndex--;
    }
    if (isAnyOf(inputChar, "LEF")) {
      shiftIndex--;
    }
    if (isAnyOf(inputChar, "RIG")) {
      shiftIndex++;
    }
  }

  const finalRotation =
    (rotationIndex + 4) % PIECE_WIDTH_LOOKUP[pieceStr].length;
  const rotationLetter = ROTATION_LETTER_LOOKUP[pieceStr][finalRotation];
  const leftMostCol = LEFTMOST_COL_LOOKUP[pieceStr][finalRotation] + shiftIndex;
  let colsStr = "";
  for (let i = 0; i < PIECE_WIDTH_LOOKUP[pieceStr][finalRotation]; i++) {
    colsStr += (leftMostCol + i).toString().slice(-1);
  }
  return `${pieceStr}${rotationLetter}-${colsStr}${isSpecialMove ? "*" : ""}`;
}

function getNotatedMoveCpp(pieceStr, rotationIndex, shiftIndex) {
  const finalRotation =
    (rotationIndex + 4) % PIECE_WIDTH_LOOKUP[pieceStr].length;
  const rotationLetter = ROTATION_LETTER_LOOKUP[pieceStr][finalRotation];
  const leftMostCol = LEFTMOST_COL_LOOKUP[pieceStr][finalRotation] + shiftIndex;
  let colsStr = "";
  for (let i = 0; i < PIECE_WIDTH_LOOKUP[pieceStr][finalRotation]; i++) {
    colsStr += (leftMostCol + i).toString().slice(-1);
  }
  return `${pieceStr}${rotationLetter}-${colsStr}`;
}

function formatDetailView(move) {
  let displayString = `Expected Value: ${move.totalValue.toFixed(1)}`;

  let evExpl = "";
  for (const line of move.hypotheticalLines) {
    evExpl += `<br/>If ${line.pieceSequence} (${(
      line.probability * 100
    ).toFixed(1)}%), do ${line.moveSequenceAsInputs
      .map((x, i) => getNotatedMove(line.pieceSequence[i], x, true))
      .join(" ")} = ${line.resultingValue.toFixed(2)}`;
  }
  displayString += "<br/>" + evExpl;

  displayString += "<br/><br/>Base Eval Score: " + move.evalScore.toFixed(2);
  displayString += "<br/>Factors:<br/>";
  let evalExpl = move.evalExplanation.split("SUBTOTAL")[0];
  evalExpl = evalExpl.replaceAll(/, /g, "<br/>");
  displayString += evalExpl;
  return displayString;
}

const TEST_REQ_INFO = {
  firstPiece: "L",
  secondPiece: "O",
};
const TESTSTRING =
  '[{"firstPlacement":[3,3,11], "playoutScore":-40.40, "shallowEvalScore":-40.40, "resultingBoard":"7,dadedmdChCpEpE,6", "playout1":{ "pieceSequence":"JLI", "placements": [[3,-5,11],[2,-4,9],[1,4,16] ], "resultingBoard":"11,dadehmFCFC,4",  "score":64.94 }, "playout2":{ "pieceSequence":"TIO", "placements": [[3,0,7],[1,4,16],[0,0,8] ], "resultingBoard":"9,bqbqdqdCdCdChCpEpE,2",  "score":16.60 }, "playout3":{ "pieceSequence":"JTJ", "placements": [[3,-5,11],[3,0,7],[1,-3,8] ], "resultingBoard":"7,dqhChCpCFC,8",  "score":-1.44 }, "playout4":{ "pieceSequence":"TJS", "placements": [[3,0,7],[3,-5,11],[1,3,10] ], "resultingBoard":"9,dqdCdCdE,7",  "score":-26.43 }, "playout5":{ "pieceSequence":"TLO", "placements": [[3,0,7],[3,1,5],[0,0,4] ], "resultingBoard":"5,bybydCdCdCdChCpEpE,6",  "score":-49.00 }, "playout6":{ "pieceSequence":"OLT", "placements": [[0,-1,4],[1,4,11],[3,0,7] ], "resultingBoard":"5,dadadqdCdCdChFpFpF,6",  "score":-79.72 }, "playout7":{ "pieceSequence":"OSS", "placements": [[0,-1,4],[1,3,10],[0,-4,9] ], "resultingBoard":"6,dadadadedmpEpFpE,6",  "score":-155.96 } },{"firstPlacement":[1,4,13], "playoutScore":-57.46, "shallowEvalScore":-66.95, "resultingBoard":"9,dadedmdChCpCpC,4", "playout1":{ "pieceSequence":"JLI", "placements": [[3,-5,13],[2,-4,11],[1,4,16] ], "resultingBoard":"13,dadehmFCFCFCFC,0",  "score":51.74 }, "playout2":{ "pieceSequence":"JLZ", "placements": [[3,-5,13],[2,-4,11],[1,0,9] ], "resultingBoard":"9,didChCFCFCFCFC,4",  "score":11.93 }, "playout3":{ "pieceSequence":"IZO", "placements": [[1,4,16],[1,0,13],[0,-1,10] ], "resultingBoard":"11,dadadidCdCdChCpCpC,0",  "score":4.87 }, "playout4":{ "pieceSequence":"TJZ", "placements": [[3,0,9],[3,-5,13],[0,1,7] ], "resultingBoard":"8,aydCdCdCdCFCFCFC,4",  "score":-23.78 }, "playout5":{ "pieceSequence":"ZOZ", "placements": [[1,0,9],[0,-1,6],[1,0,7] ], "resultingBoard":"7,didydydCdCdChCpCpC,4",  "score":-41.39 }, "playout6":{ "pieceSequence":"ZOL", "placements": [[1,0,9],[0,-1,6],[3,3,13] ], "resultingBoard":"7,dadadidCdCdChEpEpF,4",  "score":-56.66 }, "playout7":{ "pieceSequence":"OSS", "placements": [[0,-1,6],[1,3,14],[1,3,13] ], "resultingBoard":"8,dadadadedmdEhFpFpF,3",  "score":-94.80 } },{"firstPlacement":[3,0,5], "playoutScore":-99.44, "shallowEvalScore":-135.25, "resultingBoard":"5,aqdqdCdmdChCpCpCFC,6", "playout1":{ "pieceSequence":"JLI", "placements": [[3,-5,10],[2,-4,8],[1,4,16] ], "resultingBoard":"9,aqdqdChmFCFCFCFCFC,2",  "score":-6.31 }, "playout2":{ "pieceSequence":"ZIT", "placements": [[1,-4,8],[1,4,16],[3,3,15] ], "resultingBoard":"9,aqdqdChmpCpCpEpF,3",  "score":-54.92 }, "playout3":{ "pieceSequence":"SJL", "placements": [[1,3,12],[3,-5,12],[2,-4,10] ], "resultingBoard":"7,aqdqdChmFCFCFC,6",  "score":-75.96 }, "playout4":{ "pieceSequence":"OIJ", "placements": [[0,4,11],[1,-5,10],[1,2,6] ], "resultingBoard":"6,aeaudCdCdmtCxCFC,6",  "score":-108.08 }, "playout5":{ "pieceSequence":"SZL", "placements": [[1,3,12],[1,-4,10],[3,1,6] ], "resultingBoard":"6,aiaydCdChmpCpCpCpE,5",  "score":-127.97 }, "playout6":{ "pieceSequence":"ZTZ", "placements": [[1,-4,8],[1,4,12],[1,3,12] ], "resultingBoard":"7,aqdqdChmpCpDpFpF,5",  "score":-136.31 }, "playout7":{ "pieceSequence":"OSS", "placements": [[0,4,11],[0,-1,4],[1,1,5] ], "resultingBoard":"5,bydCdudCdmdChCpCpF,6",  "score":-193.34 } },{"firstPlacement":[1,0,5], "playoutScore":-102.71, "shallowEvalScore":-138.62, "resultingBoard":"5,bqdqdudmdChCpCpCFC,6", "playout1":{ "pieceSequence":"JLI", "placements": [[3,-5,10],[2,-4,8],[1,4,16] ], "resultingBoard":"9,bqdqduhmFCFCFCFCFC,2",  "score":-9.67 }, "playout2":{ "pieceSequence":"JLO", "placements": [[3,-5,10],[2,-4,8],[0,4,11] ], "resultingBoard":"7,bqdqduhmFCFCFC,6",  "score":-57.33 }, "playout3":{ "pieceSequence":"SJL", "placements": [[1,3,12],[3,-5,12],[2,-4,10] ], "resultingBoard":"7,bqdqduhmFCFCFC,6",  "score":-79.33 }, "playout4":{ "pieceSequence":"ZJZ", "placements": [[1,1,5],[3,-5,10],[1,3,11] ], "resultingBoard":"6,budCdCdmdCFCFD,7",  "score":-108.58 }, "playout5":{ "pieceSequence":"ZTZ", "placements": [[1,1,5],[1,4,12],[1,1,5] ], "resultingBoard":"5,aeambCdCdCdmdChCpCpD,5",  "score":-126.17 }, "playout6":{ "pieceSequence":"OZO", "placements": [[0,4,11],[1,1,6],[0,4,10] ], "resultingBoard":"6,budCdCdmdChFpFpF,6",  "score":-135.26 }, "playout7":{ "pieceSequence":"TOS", "placements": [[1,4,12],[0,2,6],[0,1,4] ], "resultingBoard":"5,amaybCdCdudmdChCpCpD,5",  "score":-233.44 } },{"firstPlacement":[3,-5,8], "playoutScore":-133.85, "shallowEvalScore":-189.30, "resultingBoard":"6,dadetmtCFCpCpCFC,6", "playout1":{ "pieceSequence":"TIO", "placements": [[3,0,6],[1,4,16],[0,-3,11] ], "resultingBoard":"10,dqdCFCFCFCpCpCFC,2",  "score":-60.46 }, "playout2":{ "pieceSequence":"ITI", "placements": [[1,4,16],[3,0,10],[1,3,14] ], "resultingBoard":"10,dqdCtCtCFEpEpE,3",  "score":-92.26 }, "playout3":{ "pieceSequence":"ISL", "placements": [[1,4,16],[1,3,16],[3,-4,13] ], "resultingBoard":"12,daleBmFCFCpCpE,1",  "score":-121.28 }, "playout4":{ "pieceSequence":"OTL", "placements": [[0,-3,7],[1,4,12],[1,4,11] ], "resultingBoard":"9,dadeFmFDpDpD,5",  "score":-136.55 }, "playout5":{ "pieceSequence":"SLT", "placements": [[1,3,12],[3,-4,9],[3,3,11] ], "resultingBoard":"9,daleBmFEpEpE,5",  "score":-157.09 }, "playout6":{ "pieceSequence":"ZOL", "placements": [[1,0,6],[0,4,11],[3,-4,8] ], "resultingBoard":"7,dilCBCFCFCpCpF,6",  "score":-177.40 }, "playout7":{ "pieceSequence":"OJS", "placements": [[0,-3,7],[1,4,11],[0,1,6] ], "resultingBoard":"7,dmdCFmFCFCpDpD,6",  "score":-204.61 } },{"firstPlacement":[3,1,4], "playoutScore":-142.74, "shallowEvalScore":-175.63, "resultingBoard":"4,aiaidmdedmdChCpCpCFC,6", "playout1":{ "pieceSequence":"JLI", "placements": [[3,-5,10],[2,-4,8],[1,4,16] ], "resultingBoard":"8,aiaidmdehmFCFCFCFCFC,2",  "score":-46.68 }, "playout2":{ "pieceSequence":"JOL", "placements": [[3,-5,10],[0,-3,7],[1,4,13] ], "resultingBoard":"7,aiaidmdepmpCFCFCFC,4",  "score":-98.18 }, "playout3":{ "pieceSequence":"ISO", "placements": [[1,4,16],[1,3,16],[0,4,15] ], "resultingBoard":"10,aiaidmdedmdChFpFpE,1",  "score":-112.22 }, "playout4":{ "pieceSequence":"TLI", "placements": [[1,4,12],[1,2,5],[1,0,7] ], "resultingBoard":"5,amamaCdCdudCdChCpCpD,5",  "score":-135.00 }, "playout5":{ "pieceSequence":"STS", "placements": [[1,3,12],[3,3,11],[1,3,9] ], "resultingBoard":"6,aiaidmdgdpdFhFpEpE,5",  "score":-173.43 }, "playout6":{ "pieceSequence":"ZOZ", "placements": [[1,-4,8],[0,4,11],[1,3,10] ], "resultingBoard":"5,aiaidmdehmpDpFpEpF,6",  "score":-185.41 }, "playout7":{ "pieceSequence":"OSS", "placements": [[0,4,11],[1,1,3],[1,-2,4] ], "resultingBoard":"3,aicmdmbidmdedmdChCpCpF,6",  "score":-348.30 } },{"firstPlacement":[0,-2,4], "playoutScore":-146.11, "shallowEvalScore":-183.27, "resultingBoard":"5,hahadedmdChCpCpCFC,6", "playout1":{ "pieceSequence":"ZIT", "placements": [[1,-4,8],[1,4,16],[3,-4,10] ], "resultingBoard":"9,hapapepmpCpCpCpCFC,2",  "score":-27.91 }, "playout2":{ "pieceSequence":"ZLI", "placements": [[1,-4,8],[1,4,13],[1,-5,12] ], "resultingBoard":"8,hahadehmFCFCFCFC,4",  "score":-100.75 }, "playout3":{ "pieceSequence":"ZTZ", "placements": [[1,-4,8],[3,-4,6],[1,0,6] ], "resultingBoard":"5,hapipCpCpCpCpCpCFC,6",  "score":-123.17 }, "playout4":{ "pieceSequence":"ISO", "placements": [[1,4,16],[1,3,16],[0,-1,8] ], "resultingBoard":"9,dadahahadedmdChCpCpE,1",  "score":-153.48 }, "playout5":{ "pieceSequence":"SOZ", "placements": [[1,3,12],[0,-1,4],[1,-4,10] ], "resultingBoard":"5,dadahahadehmpCpCpCpE,5",  "score":-169.12 }, "playout6":{ "pieceSequence":"STS", "placements": [[1,3,12],[3,0,8],[1,0,6] ], "resultingBoard":"6,aqhyhydCdCdChCpCpE,5",  "score":-187.69 }, "playout7":{ "pieceSequence":"OSS", "placements": [[0,4,11],[0,-2,3],[0,1,6] ], "resultingBoard":"4,dagahahmdCdmdChCpCpF,6",  "score":-322.45 } },{"firstPlacement":[0,1,5], "playoutScore":-147.18, "shallowEvalScore":-169.74, "resultingBoard":"6,dCdudmdChCpCpCFC,6", "playout1":{ "pieceSequence":"JIO", "placements": [[3,-5,10],[1,4,16],[0,-3,11] ], "resultingBoard":"10,dCdupmpCFCFCFCFC,2",  "score":-48.99 }, "playout2":{ "pieceSequence":"IZL", "placements": [[1,4,16],[1,3,15],[2,1,8] ], "resultingBoard":"8,aeaCdCdudmdChCpDpF,3",  "score":-98.94 }, "playout3":{ "pieceSequence":"JTJ", "placements": [[3,-5,10],[1,4,12],[1,-3,9] ], "resultingBoard":"8,dChuhmpCFCFCFD,5",  "score":-124.55 }, "playout4":{ "pieceSequence":"OIJ", "placements": [[0,4,11],[1,-5,10],[3,3,11] ], "resultingBoard":"8,dCdudmtFxE,7",  "score":-154.61 }, "playout5":{ "pieceSequence":"STO", "placements": [[1,3,12],[3,3,11],[0,4,8] ], "resultingBoard":"8,dCdxdpdEhFpEpE,5",  "score":-172.21 }, "playout6":{ "pieceSequence":"ZOZ", "placements": [[1,-4,8],[0,4,11],[1,3,10] ], "resultingBoard":"7,dCduhmpDpFpEpF,6",  "score":-183.74 }, "playout7":{ "pieceSequence":"OSS", "placements": [[0,4,11],[1,3,10],[0,-4,9] ], "resultingBoard":"8,dCdudmpEpDpF,6",  "score":-237.36 } }]';
