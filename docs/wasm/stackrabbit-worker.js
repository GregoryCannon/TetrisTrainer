var Module = {
  initialized: false,
  onRuntimeInitialized: () => {
    console.log("onRuntimeInitialized 3");
    Module.initialized = true;
    self.onmessage = handle_message;
  },
};

const SR_PIECES_INDEXES = {
  I: 0,
  O: 1,
  L: 2,
  J: 3,
  T: 4,
  S: 5,
  Z: 6,
};

const DELIM = "|";

// The WASM backend returns JSON on success but sometimes a plaintext string
// instead (e.g. "Error: player move not found"). Letting JSON.parse throw on
// those surfaces a cryptic SyntaxError ("Unexpected token 'E'..."), so detect
// non-JSON output and surface the backend's message directly.
function parseBackendJson(rawRes, methodName) {
  if (typeof rawRes !== "string") {
    return rawRes;
  }
  const trimmed = rawRes.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  throw new Error(
    trimmed.startsWith("Error:")
      ? trimmed
      : `Backend method ${methodName} returned non-JSON output: ${trimmed}`
  );
}

function getStackRabbitArgString(args) {
  // Make playouts exhaustive for small lengths
  const playoutCount =
    args.playoutLength <= 3
      ? Math.pow(7, args.playoutLength)
      : args.playoutCount;
  const currentPieceIndex = SR_PIECES_INDEXES[args.currentPiece];
  const nextPieceIndex = SR_PIECES_INDEXES.hasOwnProperty(args.nextPiece)
    ? SR_PIECES_INDEXES[args.nextPiece]
    : -1;

  const fieldsToJoin = [
    args.board,
    args.level,
    args.lines,
    currentPieceIndex,
    nextPieceIndex,
    args.inputFrameTimeline,
    playoutCount,
    args.playoutLength,
  ];

  return fieldsToJoin.join(DELIM) + DELIM; // The C++ parsing requires an extra delimiter at the end.
}

// Append the player's resulting board when present, so the engine
// force-includes the player's move in the returned move list. Applies to
// both RATE_MOVE and GET_TOP_MOVES requests in the latest WASM bundle.
function maybeAppendSecondBoard(args) {
  if (args.secondBoard) {
    args.board += DELIM + args.secondBoard;
  }
}

// supported methods
const API = {
  getLockValueLookup: (args) => {
    const rawRes = Module.getLockValueLookup(getStackRabbitArgString(args));
    return parseBackendJson(rawRes, "getLockValueLookup");
  },
  getMove: (args) => {
    const rawRes = Module.getMove(getStackRabbitArgString(args));
    return parseBackendJson(rawRes, "getMove");
  },
  getTopMoves: (args) => {
    maybeAppendSecondBoard(args);
    const rawRes = Module.getTopMoves(getStackRabbitArgString(args));
    return parseBackendJson(rawRes, "getTopMoves");
  },
  getTopMovesHybrid: (args) => {
    maybeAppendSecondBoard(args);
    const rawRes = Module.getTopMovesHybrid(getStackRabbitArgString(args));
    return parseBackendJson(rawRes, "getTopMovesHybrid");
  },
  rateMove: (args) => {
    maybeAppendSecondBoard(args);

    console.log("Request string:", getStackRabbitArgString(args));
    const rawRes = Module.rateMove(getStackRabbitArgString(args));
    return parseBackendJson(rawRes, "rateMove");
  },
};

function handle_message(e) {
  try {
    const [method, ...args] = e.data;
    const result = API[method].apply(API, args);
    self.postMessage({ result });
  } catch (err) {
    console.error(err);
    self.postMessage({ error: err.message });
  }
}

self.onmessage = () => {
  console.log("Worker not initialized");
};

importScripts("./compiledWasmRabbit.js");
