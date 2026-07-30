import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TransactionHistoryDocument = HydratedDocument<TransactionHistory>;

export enum TransactionType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  GAME_BET = 'GAME_BET',
  GAME_WIN = 'GAME_WIN',
  REFERRAL_BONUS = 'REFERRAL_BONUS',
}

@Schema({
  timestamps: {
    currentTime: () => Date.now() + 3 * 60 * 60 * 1000, // Adjusting for timezone offset (e.g., UTC+3)
  },
  collection: 'transaction_history',
})
export class TransactionHistory {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  telegramId!: string;

  @Prop({ required: true, enum: TransactionType })
  type!: TransactionType;

  @Prop({ required: true })
  amount!: number; // Positive for additions, negative for deductions

  @Prop({ required: true })
  balanceBefore!: number;

  @Prop({ required: true })
  balanceAfter!: number;

  @Prop()
  referenceId?: string; // PaymentIntent ID, Game ID, or Txn ID

  @Prop({ default: 'System' })
  description!: string;
}

export const TransactionHistorySchema =
  SchemaFactory.createForClass(TransactionHistory);
