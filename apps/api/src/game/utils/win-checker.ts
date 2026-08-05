import { WinPattern } from '../enums/win-pattern.enum';

/**
 * All winning logic is pure — no DB or service dependencies.
 *
 * The card matrix is a flat 25-element array (row-major):
 *   index = row * 5 + col
 *   Center cell index 12 (row 2, col 2) is FREE (stored as 0).
 *
 * A cell is "marked" if:
 *   - it is the FREE cell (value === 0), OR
 *   - its value is in the drawnNumbers set
 */

/** Returns true if a given flat index is marked */
function isMarked(matrix: number[], index: number, drawn: Set<number>): boolean {
  return matrix[index] === 0 || drawn.has(matrix[index]);
}

/** Check every cell in a row */
function checkRow(matrix: number[], row: number, drawn: Set<number>): boolean {
  for (let col = 0; col < 5; col++) {
    if (!isMarked(matrix, row * 5 + col, drawn)) return false;
  }
  return true;
}

/** Check every cell in a column */
function checkCol(matrix: number[], col: number, drawn: Set<number>): boolean {
  for (let row = 0; row < 5; row++) {
    if (!isMarked(matrix, row * 5 + col, drawn)) return false;
  }
  return true;
}

/** Check top-left → bottom-right diagonal */
function checkMainDiagonal(matrix: number[], drawn: Set<number>): boolean {
  for (let i = 0; i < 5; i++) {
    if (!isMarked(matrix, i * 5 + i, drawn)) return false;
  }
  return true;
}

/** Check top-right → bottom-left diagonal */
function checkAntiDiagonal(matrix: number[], drawn: Set<number>): boolean {
  for (let i = 0; i < 5; i++) {
    if (!isMarked(matrix, i * 5 + (4 - i), drawn)) return false;
  }
  return true;
}

/** Check all 25 cells */
function checkFullHouse(matrix: number[], drawn: Set<number>): boolean {
  for (let i = 0; i < 25; i++) {
    if (!isMarked(matrix, i, drawn)) return false;
  }
  return true;
}

export interface WinCheckResult {
  isWinner: boolean;
  /** Which specific line was completed (e.g. "ROW_2", "COL_0", "DIAG_MAIN") */
  matchedLine?: string;
}

/**
 * Check whether a card's matrix satisfies the required win pattern
 * given the set of drawn numbers.
 */
export function checkWin(
  matrix: number[],
  drawnNumbers: number[],
  pattern: WinPattern,
): WinCheckResult {
  const drawn = new Set(drawnNumbers);

  switch (pattern) {
    case WinPattern.ROW: {
      for (let row = 0; row < 5; row++) {
        if (checkRow(matrix, row, drawn)) {
          return { isWinner: true, matchedLine: `ROW_${row}` };
        }
      }
      return { isWinner: false };
    }

    case WinPattern.COLUMN: {
      for (let col = 0; col < 5; col++) {
        if (checkCol(matrix, col, drawn)) {
          return { isWinner: true, matchedLine: `COL_${col}` };
        }
      }
      return { isWinner: false };
    }

    case WinPattern.DIAGONAL: {
      if (checkMainDiagonal(matrix, drawn)) {
        return { isWinner: true, matchedLine: 'DIAG_MAIN' };
      }
      if (checkAntiDiagonal(matrix, drawn)) {
        return { isWinner: true, matchedLine: 'DIAG_ANTI' };
      }
      return { isWinner: false };
    }

    case WinPattern.FULL_HOUSE: {
      if (checkFullHouse(matrix, drawn)) {
        return { isWinner: true, matchedLine: 'FULL_HOUSE' };
      }
      return { isWinner: false };
    }
  }
}

/**
 * Scan all tickets in a game and return ALL winning card numbers
 * (multiple winners can occur simultaneously on the same draw).
 */
export function findWinnerAmongCards(
  cards: { cardNumber: number; matrix: number[] }[],
  drawnNumbers: number[],
  pattern: WinPattern,
): { cardNumber: number; matchedLine: string }[] {
  const winners: { cardNumber: number; matchedLine: string }[] = [];
  for (const card of cards) {
    const result = checkWin(card.matrix, drawnNumbers, pattern);
    if (result.isWinner) {
      winners.push({ cardNumber: card.cardNumber, matchedLine: result.matchedLine! });
    }
  }
  return winners;
}
