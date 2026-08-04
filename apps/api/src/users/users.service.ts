import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { Model, Types } from 'mongoose';
import { TelegramAuthDTO } from '../telegram/DTO/telegram.dto';
import { DateService } from '@app/common';
import { CounterDocument } from 'libs/common/schema/counter.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel('Counter')
    private readonly counterModel: Model<CounterDocument>,
    private readonly dateService: DateService,
  ) {}

  /**
   * Find existing user or register a new one from Telegram context
   */
  async findOrCreateFromTelegram(
    telegramUser: TelegramAuthDTO,
    referrerUserId?: string,
  ): Promise<UserDocument> {
    const now = this.dateService.now();

    let user = await this.userModel.findOne({ telegramId: telegramUser.id });

    if (user) {
      user.firstName = telegramUser.firstName;
      user.lastName = telegramUser.lastName;
      user.username = telegramUser.username;
      user.lastLoginAt = now;
      user.lastSeenAt = now;

      await user.save();
      return user;
    }

    const referralCode = await this.getNextReferralCode();

    user = new this.userModel({
      telegramId: telegramUser.id,
      firstName: telegramUser.firstName,
      lastName: telegramUser.lastName,
      username: telegramUser.username,
      role: 'USER',
      referralCode,
      referredBy: referrerUserId ? new Types.ObjectId(referrerUserId) : null,
      walletBalance: 0,
      isVerified: false,
      isBlocked: false,
      lastLoginAt: now,
      lastSeenAt: now,
    });

    await user.save();
    return user;
  }

  // ==========================================
  //  READ / QUERY METHODS
  // ==========================================

  async findById(
    id: string | Types.ObjectId | { _id?: any; id?: any },
  ): Promise<UserDocument> {
    const resolvedId = this.resolveUserId(id);

    const user = await this.userModel.findById(resolvedId).exec();
    if (!user) {
      throw new NotFoundException(`User with ID "${resolvedId}" not found`);
    }
    return user;
  }

  private resolveUserId(
    id: string | Types.ObjectId | { _id?: any; id?: any },
  ): string | Types.ObjectId {
    if (id instanceof Types.ObjectId) {
      return id;
    }

    if (typeof id === 'string') {
      return id;
    }

    if (id && typeof id === 'object') {
      if (id._id && Types.ObjectId.isValid(id._id)) {
        return id._id;
      }
      if (id.id && Types.ObjectId.isValid(id.id)) {
        return id.id;
      }
    }

    throw new BadRequestException(
      `Invalid user id provided: ${JSON.stringify(id)}`,
    );
  }

  async findByTelegramId(telegramId: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ telegramId }).exec();
  }

  async findByReferralCode(referralCode: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ referralCode }).exec();
  }

  async findByUsername(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ username: username.toLowerCase() }).exec();
  }

  // ==========================================
  // ACCOUNT STATUS & PROFILE MANAGEMENT
  // ==========================================

  async updatePhoneNumber(
    userId: string,
    phoneNumber: string,
  ): Promise<UserDocument> {
    const existing = await this.userModel.findOne({ phoneNumber }).exec();
    if (existing && existing._id.toString() !== userId) {
      throw new ConflictException(
        'Phone number is already registered to another user',
      );
    }

    const user = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: { phoneNumber, isVerified: true } },
        { returnDocument: 'after' },
      )
      .exec();

    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }

    return user;
  }

  async setBlockStatus(
    userId: string,
    isBlocked: boolean,
  ): Promise<UserDocument> {
    const user = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: { isBlocked } },
        { returnDocument: 'after' },
      )
      .exec();

    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }

    return user;
  }

  async updateLastSeen(userId: string): Promise<void> {
    await this.userModel
      .findByIdAndUpdate(userId, {
        $set: { lastSeenAt: this.dateService.now() },
      })
      .exec();
  }

  private async getNextReferralCode(): Promise<string> {
    const counter = await this.counterModel
      .findOneAndUpdate(
        { name: 'referral_code_seq' },
        { $inc: { seq: 1 } },
        {
          returnDocument: 'after',
          upsert: true,
          setDefaultsOnInsert: true,
        },
      )
      .exec();

    // Ensures at least 4 digits (e.g., 1000, 1001)
    const paddedSeq = counter.seq.toString().padStart(4, '0');

    return `REF${paddedSeq}`;
  }

  async updateWalletBalance(
    userId: string,
    newBalance: number,
  ): Promise<UserDocument> {
    const user = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: { walletBalance: newBalance } },
        { returnDocument: 'after' },
      )
      .exec();

    if (!user) {
      throw new NotFoundException(`User with ID "${userId}" not found`);
    }

    return user;
  }

  /** Add amount to mainWallet (winnings). Uses $inc for atomicity. */
  async creditMainWallet(userId: string, amount: number): Promise<UserDocument> {
    const user = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $inc: { mainWallet: amount } },
        { returnDocument: 'after' },
      )
      .exec();

    if (!user) throw new NotFoundException(`User ${userId} not found`);
    return user;
  }

  /** Deduct amount from mainWallet (cashout deduction). Fails if insufficient. */
  async debitMainWallet(userId: string, amount: number): Promise<UserDocument> {
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    if (user.mainWallet < amount) {
      throw new BadRequestException(
        `Insufficient main wallet balance. Have ${user.mainWallet} ETB, need ${amount} ETB.`,
      );
    }
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { $inc: { mainWallet: -amount } },
        { returnDocument: 'after' },
      )
      .exec() as Promise<UserDocument>;
  }
}
