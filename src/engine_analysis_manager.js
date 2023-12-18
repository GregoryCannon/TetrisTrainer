import { GetLevel, GetLines } from ".";

const engineTable = document.getElementById("engine-grid");
const curPieceSelect = document.getElementById("engine-cur-piece");
const nextPieceSelect = document.getElementById("engine-next-piece");
const tapSpeedSelect = document.getElementById("engine-tap-speed");
const reactionTimeSelect = document.getElementById("engine-reaction-time");
const backendErrorText = document.getElementById("engine-backend-error");
const requestButton = document.getElementById("engine-calculate-button");

const IS_DEPLOY = true;

export function EngineAnalysisManager(board) {
  this.board = board;
  this.curPiece = "O";
  this.nextPiece = "";
  // Send a ping to the server so heroku knows to wake it up
  this.pingServer();
  requestButton.addEventListener("click", (e) => this.makeRequest());
}

EngineAnalysisManager.prototype.updatePieces = function (
  curPieceId,
  nextPieceId
) {
  // console.log(curPieceId, nextPieceId);
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
  this.reactionTime = reactionTimeSelect.value;
  const tapSpeed = tapSpeedSelect.value;
  const url = `${
    IS_DEPLOY ? "https://stackrabbit.herokuapp.com" : "http://localhost:3000"
  }/engine?board=${encodedBoard}&currentPiece=${curPiece}${
    nextPiece ? "&nextPiece=" + nextPiece : ""
  }&level=${Math.max(GetLevel() || 0, 18)}&lines=${
    GetLines() || 0
  }&reactionTime=${this.reactionTime}&inputFrameTimeline=${tapSpeed}`;

  // Make request
  fetch(url, { mode: "cors" })
    .then(function (response) {
      return response.text();
    })
    .then(
      function (responseRaw) {
        // console.log(response);
        if (tryParseJSONObject(responseRaw) === false) {
          // Reached an error.
          console.log("Request failed", error);
          backendErrorText.style.visibility = "visible";
          backendErrorText.innerHTML =
            "Error loading analysis.<br/>" + responseRaw;
          engineTable.style.visibility = "hidden";
          return null;
        }
        this.loadResponse(JSON.parse(responseRaw));
      }.bind(this)
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

/** Runs an animation to clear the lines passed in in an array.
 * Doesn't affect the actual board, those updates come at the end of the animation. */
EngineAnalysisManager.prototype.loadResponse = function (moveList) {
  engineTable.innerHTML = "";
  backendErrorText.style.visibility = "hidden";
  engineTable.style.visibility = "visible";
  for (let i = 0; i < moveList.length; i++) {
    const mainMove = moveList[i];

    // Create a row for the default move
    let row = document.createElement("div");
    engineTable.appendChild(row);
    row.classList.add("grid-row", "main-move");

    // Fill the default placement row
    let ranking = document.createElement("div");
    row.appendChild(ranking);
    ranking.classList.add("ranking");
    ranking.innerHTML = i + 1 + ")";

    let evalScore = document.createElement("div");
    row.appendChild(evalScore);
    evalScore.classList.add("eval-score");
    evalScore.innerHTML = mainMove.totalValue.toFixed(1);

    let move = document.createElement("div");
    row.appendChild(move);
    move.colSpan = 2;
    move.classList.add("notated-move");
    move.innerHTML = getNotatedMove(
      mainMove.piece,
      mainMove.inputSequence,
      mainMove.isSpecialMove
    );
    let detailRow = document.createElement("div");
    engineTable.appendChild(detailRow);
    detailRow.style.visibility = "hidden";
    detailRow.style.maxHeight = "0px";
    detailRow.classList.add("detail-view");
    detailRow.innerHTML = formatDetailView(mainMove);

    // Add a click listener to toggle visibility of the detail row
    row.addEventListener("click", (e) => {
      toggleDetailsVisibility(detailRow);
    });

    // Fill in the adjustment rows
    for (const adjustment of mainMove.adjustments) {
      let adjRow = document.createElement("div");
      engineTable.appendChild(adjRow);
      adjRow.classList.add("grid-row", "adjustment");

      // Fill the default placement row
      adjRow.appendChild(document.createElement("div")); // spacer

      let adjScore = document.createElement("div");
      adjRow.appendChild(adjScore);
      adjScore.classList.add("eval-score-adj");
      adjScore.innerHTML = adjustment.totalValue.toFixed(1);

      let adjMove = document.createElement("div");
      adjRow.appendChild(adjMove);
      adjMove.classList.add("notated-adj");
      if (
        mainMove.inputSequence.slice(this.reactionTime) ===
        adjustment.inputSequence
      ) {
        adjMove.innerHTML = "(no adj.)";
      } else {
        adjMove.innerHTML = getNotatedMove(
          adjustment.piece,
          mainMove.inputSequence.slice(0, this.reactionTime) +
            adjustment.inputSequence,
          adjustment.isSpecialMove
        );
      }

      let nextMove = document.createElement("div");
      adjRow.appendChild(nextMove);
      nextMove.classList.add("notated-next");
      nextMove.innerHTML = getNotatedMove(
        adjustment.followUp.piece,
        adjustment.followUp.inputSequence,
        adjustment.followUp.isSpecialMove
      );

      let detailRow = document.createElement("div");
      detailRow.classList.add("adjustment-detail-view");
      engineTable.appendChild(detailRow);
      detailRow.style.visibility = "hidden";
      detailRow.style.maxHeight = "0px";
      detailRow.classList.add("detail-view");
      detailRow.innerHTML = formatDetailView(adjustment);

      // Add a click listener to toggle visibility of the detail row
      adjRow.addEventListener("click", (e) => {
        toggleDetailsVisibility(detailRow);
      });
    }
  }
};

function toggleDetailsVisibility(detailsView) {
  if (detailsView.style.visibility === "visible") {
    detailsView.style.maxHeight = "0px";
    detailsView.style.visibility = "hidden";
    detailsView.style.padding = "0";
  } else {
    detailsView.style.visibility = "visible";
    detailsView.style.maxHeight = "500px";
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
