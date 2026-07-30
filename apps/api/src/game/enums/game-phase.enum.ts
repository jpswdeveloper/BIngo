export enum GamePhase {
  /** Cards are on sale — players can buy tickets */
  CARD_SELECTION = 'CARD_SELECTION',

  /** No more card sales — countdown to first draw */
  COUNTDOWN = 'COUNTDOWN',

  /** Numbers are being drawn one by one */
  DRAWING = 'DRAWING',

  /** A winner has been found or the game was ended manually */
  GAME_OVER = 'GAME_OVER',
}
