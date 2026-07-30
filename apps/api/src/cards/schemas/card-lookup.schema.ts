import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CardLookupDocument = HydratedDocument<CardLookup>;

/**
 * Efficiently store which cards contain each value (1–75) and at what positions.
 * 
 * Example: If value 42 appears in:
 *   - card 5 at position 11 (row 2, col 1)
 *   - card 89 at position 12 (row 2, col 2)
 *
 * Then we store:
 *   {
 *     value: 42,
 *     locations: [
 *       { cardNumber: 5, position: 11 },
 *       { cardNumber: 89, position: 12 }
 *     ]
 *   }
 */
@Schema({ collection: 'card_lookups' })
export class CardLookup {
  /** Bingo value 1-75 (0 is reserved for FREE cell) */
  @Prop({ required: true, unique: true, index: true, min: 1, max: 75 })
  value!: number;

  /**
   * Array of {cardNumber, position} where this value appears.
   * position is the flat array index (0–24, where 12 = center FREE cell)
   */
  @Prop({
    type: [
      {
        cardNumber: { type: Number, required: true },
        position: { type: Number, required: true, min: 0, max: 24 },
      },
    ],
    default: [],
  })
  locations!: { cardNumber: number; position: number }[];
}

export const CardLookupSchema = SchemaFactory.createForClass(CardLookup);
