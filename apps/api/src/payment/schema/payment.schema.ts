import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PaymentIntentDocument = HydratedDocument<PaymentIntent>;

export enum PaymentType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
}

export enum PaymentStatus {
  AWAITING_RECEIPT = 'AWAITING_RECEIPT', // Amount entered, waiting for Telebirr SMS
  PENDING = 'PENDING', // Receipt submitted, awaiting auto/manual verification
  APPROVED = 'APPROVED', // Wallet credited successfully
  REJECTED = 'REJECTED', // Fake SMS or invalid transaction ID
  EXPIRED = 'EXPIRED', // User abandoned deposit request
}

@Schema({ timestamps: {
  currentTime: () => Date.now() + 3 * 60 * 60 * 1000, // Adjusting for timezone offset (e.g., UTC+3)  
}, collection: 'payment_intents' })
export class PaymentIntent {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  telegramId!: string;

  @Prop({ required: true, enum: PaymentType })
  type!: PaymentType;

  @Prop({ required: true, min: 10 })
  expectedAmount!: number;

  @Prop({ default: 0 })
  paidAmount?: number;

  @Prop({ default: 'Telebirr' })
  paymentMethod!: string;

  @Prop({ unique: true, sparse: true, index: true })
  transactionId?: string;

  @Prop({
    required: true,
    enum: PaymentStatus,
    default: PaymentStatus.AWAITING_RECEIPT,
  })
  status!: PaymentStatus;

  @Prop()
  rawReceipt?: string;

  @Prop()
  rejectionReason?: string;
}

export const PaymentIntentSchema = SchemaFactory.createForClass(PaymentIntent);
