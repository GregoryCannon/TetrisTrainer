import { GetLevel, GetLines } from ".";
import { NUM_COLUMN, NUM_ROW } from "./constants";
import { DecompressBoard } from "./utils";

const engineTable = document.getElementById("engine-grid");
const inexhaustiveWarningContainer = document.getElementById(
  "inexhaustive-warning",
);
const inexhaustiveWarningText = document.getElementById(
  "inexhaustive-warning-text",
);
const inexhaustiveWarningIcon = document.getElementById(
  "inexhaustive-warning-icon",
);
const curPieceSelect = document.getElementById("engine-cur-piece");
const nextPieceSelect = document.getElementById("engine-next-piece");
const tapSpeedSelect = document.getElementById("engine-tap-speed");
const depthSelect = document.getElementById("engine-depth-select");
const backendErrorText = document.getElementById("engine-backend-error");
const requestButton = document.getElementById("engine-calculate-button");

const IS_DEPLOY = false;

export function EngineAnalysisManager(board) {
  this.board = board;
  this.curPiece = "O";
  this.nextPiece = "";
  this.requestInfo = {};
  // Send a ping to the server so heroku knows to wake it up
  this.pingServer();
  requestButton.addEventListener("click", (e) => this.makeRequest());
}

EngineAnalysisManager.prototype.updatePieces = function (
  curPieceId,
  nextPieceId,
) {
  this.curPiece = curPieceId || "";
  this.nextPiece = nextPieceId || "";
  curPieceSelect.value = this.curPiece;
  nextPieceSelect.value = this.nextPiece;
};

EngineAnalysisManager.prototype.pingServer = function () {
  const url = `${
    IS_DEPLOY ? "https://stackrabbit.herokuapp.com" : "http://localhost:3000"
  }/ping`;

  // Make request
  fetch(url, { mode: "cors" })
    .then(function (response) {
      console.log("Received ack from server");
      return response.json();
    })
    .catch(function (error) {
      console.log("Ping to server failed. Reason:", error);
    });
};

EngineAnalysisManager.prototype.makeRequest = function () {
  // Compile arguments
  const encodedBoard = this.board
    .map((row) => row.slice(0, 10).join(""))
    .join("")
    .replace(/2|3/g, "1");
  const curPiece = curPieceSelect.value;
  const nextPiece = nextPieceSelect.value;
  const tapSpeed = tapSpeedSelect.value;
  const depthChoice = depthSelect.value.split("x");
  const playoutCount = parseInt(depthChoice[0]);
  const playoutLength = parseInt(depthChoice[1]);
  const requestType = nextPiece
    ? "engine-movelist-cpp-hybrid"
    : "engine-movelist-cpp";
  const url = `${
    IS_DEPLOY ? "https://stackrabbit.net" : "http://localhost:3000"
  }/${requestType}?board=${encodedBoard}&currentPiece=${curPiece}${
    nextPiece ? "&nextPiece=" + nextPiece : ""
  }&level=${Math.max(GetLevel() || 0, 18)}&lines=${
    GetLines() || 0
  }&inputFrameTimeline=${tapSpeed}&playoutCount=${playoutCount}&playoutLength=${playoutLength}`;
  this.requestInfo = {
    firstPiece: curPiece,
    secondPiece: nextPiece,
    playoutCount: playoutCount,
    playoutLength: playoutLength,
    isHybrid: nextPiece ? true : false,
  };

  // Make request
  fetch(url, { mode: "cors" })
    .then(function (response) {
      return response.text();
    })
    .then(
      function (responseRaw) {
        if (tryParseJSONObject(responseRaw) === false) {
          // Reached an error.
          console.log("Request failed", error);
          backendErrorText.style.visibility = "visible";
          backendErrorText.innerHTML =
            "Error loading analysis.<br/>" + responseRaw;
          engineTable.style.visibility = "hidden";
          return null;
        }
        let parsedResult;
        if (this.requestInfo.isHybrid) {
          // The two lists are originally distinct properties in a JSON object. Instead concatenate them into one array.
          const parsed = JSON.parse(responseRaw);
          parsedResult = parsed.noNextBox.concat(parsed.nextBox);
        } else {
          parsedResult = JSON.parse(responseRaw);
        }

        this.loadResponseCpp(this.requestInfo, parsedResult);
      }.bind(this),
    )
    .catch(function (error) {
      console.log("Request failed", error);
      backendErrorText.style.visibility = "visible";
      backendErrorText.innerHTML = "Error loading analysis.<br/>" + error;
      engineTable.style.visibility = "hidden";
    });

  // Temporarily disable the button to prevent spamming
  requestButton.disabled = true;
  setTimeout(() => {
    requestButton.disabled = false;
  }, 2000);

  // Reset focus (so pressing 'enter' doesn't make subsequent requests)
  document.activeElement.blur();
};

/**
 * Helper function from https://stackoverflow.com/questions/3710204/how-to-check-if-a-string-is-a-valid-json-string
 */
function tryParseJSONObject(jsonString) {
  try {
    var o = JSON.parse(jsonString);

    // Handle non-exception-throwing cases:
    // Neither JSON.parse(false) or JSON.parse(1234) throw errors, hence the type-checking,
    // but... JSON.parse(null) returns null, and typeof null === "object",
    // so we must check for that, too. Thankfully, null is falsey, so this suffices:
    if (o && typeof o === "object") {
      return o;
    }
  } catch (e) {}
  return false;
}

/** Loads the SR2.0 engine response into the UI */
EngineAnalysisManager.prototype.loadResponseCpp = function (reqInfo, moveList) {
  engineTable.innerHTML = "";
  backendErrorText.style.visibility = "hidden";
  engineTable.style.visibility = "visible";

  let numNnb = 0;
  for (let i = 0; i < moveList.length; i++) {
    if (moveList[i].secondPlacement) {
      break;
    }
    numNnb += 1;
  }

  // Potentially show warning for inexhaustive playouts
  const isExhaustive =
    this.requestInfo.playoutCount ==
    Math.pow(7, this.requestInfo.playoutLength);
  inexhaustiveWarningContainer.style.display = "flex";
  if (isExhaustive) {
    // inexhaustiveWarningContainer.style.display = "none";
    inexhaustiveWarningIcon.src = "static/checkmark_transparent.webp";
    inexhaustiveWarningText.innerHTML = `All possible piece sequences were tested.`;
  } else {
    // inexhaustiveWarningContainer.style.display = "flex";
    inexhaustiveWarningIcon.src = "static/warning_icon_transparent.webp";
    inexhaustiveWarningText.innerHTML = `At high depth, it's infeasible to test every possible piece sequence. Therefore there may be some variance in the evaluation.<br/><em>Playouts Performed: ${this.requestInfo.playoutCount}</em>`;
  }

  let rankIndex = 1;
  for (let i = 0; i < moveList.length; i++) {
    const mainMove = moveList[i];

    if (i === numNnb) {
      // If we hit the cutoff between NNB and NB entries, reset the rankings
      rankIndex = 1;

      // Add a header for the adjustment section
      const adjustmentHeader = document.createElement("h4");
      adjustmentHeader.innerHTML = "Adjustments";
      adjustmentHeader.classList.add("adjustments-header");
      engineTable.appendChild(adjustmentHeader);
    }

    // Create a row for the default move
    let row = document.createElement("div");
    engineTable.appendChild(row);
    row.classList.add("grid-row", "main-move");

    // Fill the default placement row
    let ranking = document.createElement("div");
    row.appendChild(ranking);
    ranking.classList.add("ranking");
    ranking.innerHTML = rankIndex + ")";
    ranking += 1;

    let evalScore = document.createElement("div");
    row.appendChild(evalScore);
    evalScore.classList.add("eval-score");
    evalScore.innerHTML = mainMove.playoutScore.toFixed(1);

    let move = document.createElement("div");
    const [rot, x, y] = mainMove.firstPlacement;
    move.innerHTML = getNotatedMoveCpp(reqInfo.firstPiece, rot, x); // -3 for coordinate conversion
    row.appendChild(move);
    if (mainMove.secondPlacement) {
      // Render for NB
      move.classList.add("notated-adj");
      const secondMove = document.createElement("div");
      secondMove.classList.add("notated-next");
      const [rot, x, y] = mainMove.secondPlacement;
      secondMove.innerHTML = getNotatedMoveCpp(reqInfo.secondPiece, rot, x);
      row.appendChild(secondMove);
    } else {
      // Render for NNB
      move.classList.add("notated-move");
    }

    let detailRow = document.createElement("div");
    engineTable.appendChild(detailRow);
    detailRow.style.visibility = "hidden";
    detailRow.style.maxHeight = "0px";
    detailRow.classList.add("detail-view-cpp");
    createDetailViewCpp(detailRow, mainMove, reqInfo);

    // Add a click listener to toggle visibility of the detail row
    row.addEventListener("click", (e) => {
      toggleDetailsVisibility(detailRow);
    });

    rankIndex += 1;
  }
};

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
          squareSize - 0.5,
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
      getNotatedMoveCpp(pieces[i], placement[0], placement[1]),
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

function createDetailViewCpp(parent, move, requestInfo) {
  // Add info for the immediate result
  const immediateInfoContainer = document.createElement("div");
  immediateInfoContainer.style.display = "flex";
  immediateInfoContainer.classList.add("immediate-info-panel");

  // Add rendered board to the left
  immediateInfoContainer.appendChild(getRenderedMiniBoard(move.resultingBoard));

  // Add eval info to the right
  const rightPanel = document.createElement("div");
  rightPanel.classList.add("immediate-info-right-panel");
  immediateInfoContainer.appendChild(rightPanel);
  const evalLabel = document.createElement("div");
  evalLabel.innerHTML = `Shallow Eval Score: ${move.shallowEvalScore}`;
  rightPanel.appendChild(evalLabel);
  const evalExplLabel = document.createElement("div");
  evalExplLabel.innerHTML = `Eval Explanation: (not yet supported)`;
  rightPanel.appendChild(evalExplLabel);

  parent.appendChild(immediateInfoContainer);

  // Add boards for each of the playouts
  const table = document.createElement("table");
  table.classList.add("playout-table");
  addPlayoutView(table, move.playout1, "Best Seen Playout", "#328532");
  addPlayoutView(table, move.playout2, "Good Case", "#4c864c");
  addPlayoutView(table, move.playout3, "Above Avg Case", "#6c8e6c");
  addPlayoutView(table, move.playout4, "Median Case", "#767676");
  addPlayoutView(table, move.playout5, "Below Avg Case", "#4e4e4e");
  addPlayoutView(table, move.playout6, "Bad Case", "#373737");
  addPlayoutView(table, move.playout7, "Worst Seen Playout", "#262626");
  parent.appendChild(table);
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
