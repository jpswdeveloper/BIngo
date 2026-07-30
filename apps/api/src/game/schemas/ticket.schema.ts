import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TicketDocument = HydratedDocument<Ticket>;

@Schema({
  timestamps: {
    currentTime: () => Date.now() + 3 * 60 * 60 * 1000,
  },
  collection: 'tickets',
})
export class Ticket {
  /** The game this ticket belongs to */
  @Prop({ type: Types.ObjectId, ref: 'Game', required: true, index: true })
  gameId!: Types.ObjectId;

  /** The player who purchased this ticket */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  /** Telegram ID — denormalised for fast lookups without a join */
  @Prop({ required: true, index: true })
  telegramId!: string;

  /** Which card (1–600) this ticket is for */
  @Prop({ required: true, min: 1, max: 600 })
  cardNumber!: number;

  /** Amount paid in ETB */
  @Prop({ required: true, min: 1 })
  pricePaid!: number;

  /** Marked true when this ticket's card was the winning card */
  @Prop({ default: false })
  isWinner!: boolean;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);

// One player can hold at most one card per game
TicketSchema.index({ gameId: 1, userId: 1 }, { unique: true });

// One card can be owned by at most one player per game
TicketSchema.index({ gameId: 1, cardNumber: 1 }, { unique: true });
