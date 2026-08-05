import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CashoutDocument = HydratedDocument<CashoutRequest>;

export enum CashoutStatus {
  PENDING  = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Schema({ timestamps: true, collection: 'cashout_requests' })
export class CashoutRequest {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  telegramId!: string;

  @Prop({ required: true, min: 10 })
  amount!: number;

  /** Phone number the admin should send Telebirr to */
  @Prop({ required: true })
  phoneNumber!: string;

  @Prop({
    type: String,
    enum: Object.values(CashoutStatus),
    default: CashoutStatus.PENDING,
    index: true,
  })
  status!: CashoutStatus;

  /** Admin note on approval/rejection */
  @Prop({ type: String, default: null })
  adminNote!: string | null;

  @Prop({ type: Date, default: null })
  reviewedAt!: Date | null;

  @Prop({ type: String, default: null })
  reviewedBy!: string | null;
}

export const CashoutSchema = SchemaFactory.createForClass(CashoutRequest);
