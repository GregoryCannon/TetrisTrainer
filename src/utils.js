import { ROW, COLUMN, VACANT } from "./constants.js";

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

/* ------------ UI preference cookie ------------ */

// Small persisted UI state (drawer open state, engine toggles). Kept in its
// own cookie, separate from the game-settings "userPrefs" cookie, so the two
// evolve independently.
const UI_PREFS_COOKIE_NAME = "uiPrefs";

export function getUiPrefs() {
  if (document.cookie) {
    const prefCookie = document.cookie
      .split("; ")
      .find((row) => row.startsWith(UI_PREFS_COOKIE_NAME + "="));
    if (prefCookie) {
      try {
        return JSON.parse(unescape(prefCookie.split("=")[1]));
      } catch (err) {
        // Corrupt cookie value: fall through and use defaults.
      }
    }
  }
  return {};
}

export function saveUiPrefs(prefs) {
  document.cookie =
    UI_PREFS_COOKIE_NAME +
    "=" +
    escape(JSON.stringify(prefs)) +
    "; expires=Thu, 18 Dec 2030 12:00:00 UTC";
}

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
          newBoard.length
      );
    }
  }
}
