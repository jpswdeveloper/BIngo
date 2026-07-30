import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CardDocument = HydratedDocument<Card>;

/**
 * Standard Bingo column ranges:
 *  B: 1  – 15  (col 0)
 *  I: 16 – 30  (col 1)
 *  N: 31 – 45  (col 2)  — center cell [2][2] is FREE (0)
 *  G: 46 – 60  (col 3)
 *  O: 61 – 75  (col 4)
 *
 * matrix is stored as a flat 25-element array, row-major order:
 *   index = row * 5 + col   (row 0..4, col 0..4)
 *
 * The FREE cell at [2][2] (index 12) is stored as 0.
 */
@Schema({
  timestamps: {
    currentTime: () => Date.now() + 3 * 60 * 60 * 1000,
  },
  collection: 'cards',
})
export class Card {
  /** Sequential card number 1 – 600 */
  @Prop({ required: true, unique: true, index: true, min: 1, max: 600 })
  cardNumber!: number;

  /**
   * 5x5 board stored as a flat 25-element array (row-major).
   * Index 12 (row 2, col 2) is always 0 (FREE).
   */
  @Prop({ type: [Number], required: true, validate: (v: number[]) => v.length === 25 })
  matrix!: number[];
}

export const CardSchema = SchemaFactory.createForClass(Card);

// Compound index: quickly find all cards that contain a specific value
CardSchema.index({ matrix: 1 });
