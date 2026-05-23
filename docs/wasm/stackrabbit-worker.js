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

function getStackRabbitArgString(args) {
  const {
    level,
    lines,
    inputFrameTimeline,
    currentPiece,
    nextPiece,
    board,
    playoutLength,
  } = args;

  const fields = [
    board,
    level,
    lines,
    SR_PIECES_INDEXES[currentPiece],
    SR_PIECES_INDEXES[nextPiece],
    inputFrameTimeline,
    "",
  ];

  if (playoutLength) {
    // always do exhaustive search for a given playout length
    fields.splice(-1, 0, Math.pow(7, playoutLength), playoutLength);
  }
  console.log("ARG STRING", fields.join(DELIM));
  return fields.join(DELIM);
}

// supported methods
const API = {
  getLockValueLookup: (args) => {
    const rawRes = Module.getLockValueLookup(getStackRabbitArgString(args));
    return JSON.parse(rawRes);
  },
  getMove: (args) => {
    const rawRes = Module.getMove(getStackRabbitArgString(args));
    return JSON.parse(rawRes);
  },
  getTopMoves: (args) => {
    const rawRes = Module.getTopMoves(getStackRabbitArgString(args));
    return JSON.parse(rawRes);
  },
  getTopMovesHybrid: (args) => {
    const rawRes = Module.getTopMovesHybrid(getStackRabbitArgString(args));
    return JSON.parse(rawRes);
  },
  rateMove: (args) => {
    // dirty trick to account for second board
    args.board += DELIM + args.secondBoard;

    const rawRes = Module.rateMove(getStackRabbitArgString(args));
    return JSON.parse(rawRes);
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

importScripts("./wasmRabbit.js");
