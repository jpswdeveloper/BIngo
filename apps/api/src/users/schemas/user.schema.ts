import { RoleT } from '@app/common/role/role.enum';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({
  timestamps: {
    currentTime: () => Date.now() + 3 * 60 * 60 * 1000,
  },
  collection: 'users',
})
export class User {
  @Prop({
    required: true,
    trim: true,
  })
  firstName!: string;

  @Prop({
    trim: true,
  })
  lastName?: string;

  @Prop({
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true,
  })
  username?: string;

  @Prop({
    unique: true,
    sparse: true,
  })
  phoneNumber?: string;

  @Prop({
    required: true,
    unique: true,
    index: true,
  })
  telegramId!: string;

  @Prop()
  profilePhoto?: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'Role',
    required: true,
  })
  @Prop({
    required: true,
    default: RoleT.USER,
  })
  role!: string;

  @Prop({
    default: 0,
    min: 0,
  })
  walletBalance!: number;

  @Prop({
    unique: true,
    index: true,
  })
  referralCode!: string;

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    default: null,
  })
  referredBy?: Types.ObjectId;

  @Prop({
    default: false,
  })
  isVerified!: boolean;

  @Prop({
    default: false,
  })
  isBlocked!: boolean;

  @Prop()
  lastLoginAt?: Date;

  @Prop()
  lastSeenAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
