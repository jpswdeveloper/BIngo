export enum WinPattern {
  /** Any complete horizontal row */
  ROW = 'ROW',

  /** Any complete vertical column */
  COLUMN = 'COLUMN',

  /** Either main diagonal (top-left→bottom-right or top-right→bottom-left) */
  DIAGONAL = 'DIAGONAL',

  /** All 25 cells covered (including FREE) */
  FULL_HOUSE = 'FULL_HOUSE',
}
