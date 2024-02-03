import { ROW, COLUMN, VACANT } from "./constants.js";

export function debugPrintBoard(board) {
  let boardStr = "";
  for (let r = 0; r < ROW; r++) {
    for (let c = 0; c < COLUMN; c++) {
      boardStr += board[r][c] == VACANT ? "_" : "0";
    }
    boardStr += "\n";
  }
  console.log(boardStr);
}

const BOARD_COMPRESSION_SCHEME = {
  a: "00000",
  b: "00001",
  c: "00010",
  d: "00011",
  e: "00100",
  f: "00101",
  g: "00110",
  h: "00111",
  i: "01000",
  j: "01001",
  k: "01010",
  l: "01011",
  m: "01100",
  n: "01101",
  o: "01110",
  p: "01111",
  q: "10000",
  r: "10001",
  s: "10010",
  t: "10011",
  u: "10100",
  v: "10101",
  w: "10110",
  x: "10111",
  y: "11000",
  z: "11001",
  A: "11010",
  B: "11011",
  C: "11100",
  D: "11101",
  E: "11110",
  F: "11111",
};

export function DecompressBoard(boardStr) {
  // Handle encoded boards
  if (boardStr.includes(",")) {
    const split = boardStr.split(",");
    const numEmptyRows = parseInt(split[0]);
    const encodedRows = split[1];
    const numFullRightWellRows = parseInt(split[2]);
    const newBoard = [];
    for (let i = 0; i < numEmptyRows; i++) {
      newBoard.push([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    }
    for (let i = 0; i < encodedRows.length; i += 2) {
      const chunk1 = BOARD_COMPRESSION_SCHEME[encodedRows.charAt(i)];
      const chunk2 = BOARD_COMPRESSION_SCHEME[encodedRows.charAt(i + 1)];
      const newRow = (chunk1 + chunk2).split("");
      newBoard.push(newRow.map((x) => parseInt(x)));
    }
    for (let i = 0; i < numFullRightWellRows; i++) {
      newBoard.push([1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
    }
    if (newBoard.length == 20) {
      return newBoard;
    } else {
      throw new Error(
        "Invalid compressed board. Must contain 20 rows, but found: " +
          newBoard.length,
      );
    }
  }
}
