import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { GamePhase } from '../enums/game-phase.enum';
import { WinPattern } from '../enums/win-pattern.enum';

export type GameDocument = HydratedDocument<Game>;

@Schema({
  timestamps: {
    currentTime: () => Date.now() + 3 * 60 * 60 * 1000,
  },
  collection: 'games',
})
export class Game {
  /** Human-readable game identifier, e.g. "GAME-0042" */
  @Prop({ type: String, required: true, unique: true, index: true })
  gameCode!: string;

  /**
   * Current phase — single source of truth the frontend reads.
   * Must declare type: String explicitly; Mongoose can't infer enums.
   */
  @Prop({
    type: String,
    required: true,
    enum: Object.values(GamePhase),
    default: GamePhase.CARD_SELECTION,
  })
  phase!: GamePhase;

  /** Cost per ticket in ETB */
  @Prop({ type: Number, required: true, min: 1, default: 50 })
  ticketPrice!: number;

  /** Seconds to wait in COUNTDOWN before first draw */
  @Prop({ type: Number, required: true, default: 30 })
  countdownSeconds!: number;

  /** Seconds between each drawn number */
  @Prop({ type: Number, required: true, default: 5 })
  drawIntervalSeconds!: number;

  /** Ordered list of numbers drawn so far (1–75) */
  @Prop({ type: [Number], default: [] })
  drawnNumbers!: number[];

  /** The number drawn in the most recent draw (nullable) */
  @Prop({ type: Number, default: null })
  currentDraw!: number | null;

  /**
   * Win condition for this game.
   * Must declare type: String explicitly.
   */
  @Prop({
    type: String,
    required: true,
    enum: Object.values(WinPattern),
    default: WinPattern.FULL_HOUSE,
  })
  winPattern!: WinPattern;

  /** Set when a winner is confirmed (nullable ObjectId) */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  winnerId!: Types.ObjectId | null;

  /** The winning card number (nullable) */
  @Prop({ type: Number, default: null })
  winningCardNumber!: number | null;

  /** When COUNTDOWN phase began (nullable) */
  @Prop({ type: Date, default: null })
  countdownStartedAt!: Date | null;

  /** When DRAWING phase began (nullable) */
  @Prop({ type: Date, default: null })
  drawingStartedAt!: Date | null;

  /** When GAME_OVER phase was reached (nullable) */
  @Prop({ type: Date, default: null })
  endedAt!: Date | null;

  /** Admin who created the game */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;
}

export const GameSchema = SchemaFactory.createForClass(Game);
