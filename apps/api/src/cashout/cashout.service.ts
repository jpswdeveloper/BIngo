import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CashoutRequest, CashoutDocument, CashoutStatus } from './schemas/cashout.schema';
import { UsersService } from '../users/users.service';

@Injectable()
export class CashoutService {
  private readonly logger = new Logger(CashoutService.name);

  constructor(
    @InjectModel(CashoutRequest.name)
    private readonly cashoutModel: Model<CashoutDocument>,
    private readonly usersService: UsersService,
  ) {}

  /**
   * User requests a cashout.
   * Deducts amount from mainWallet immediately (holds it while pending).
   */
  async requestCashout(
    telegramId: string,
    amount: number,
    phoneNumber: string,
  ): Promise<CashoutDocument> {
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) throw new NotFoundException('User not found.');
    if (user.isBlocked) throw new BadRequestException('Your account is blocked.');
    if (amount < 10) throw new BadRequestException('Minimum cashout amount is 10 ETB.');

    // Deduct from mainWallet now — refunded if rejected
    await this.usersService.debitMainWallet(user._id.toString(), amount);

    const request = await this.cashoutModel.create({
      userId: user._id,
      telegramId,
      amount,
      phoneNumber,
      status: CashoutStatus.PENDING,
    });

    this.logger.log(`Cashout request created: ${telegramId} → ${amount} ETB to ${phoneNumber}`);
    return request;
  }

  /** User's own cashout history */
  async getMyCashouts(telegramId: string): Promise<CashoutDocument[]> {
    return this.cashoutModel
      .find({ telegramId })
      .sort({ createdAt: -1 })
      .exec();
  }

  /** Admin: all cashout requests, optionally filtered by status */
  async getAllCashouts(status?: CashoutStatus): Promise<CashoutDocument[]> {
    const filter = status ? { status } : {};
    return this.cashoutModel
      .find(filter)
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Admin approves — admin has already sent Telebirr manually.
   * Just marks the request as APPROVED.
   */
  async approveCashout(
    id: string,
    adminNote?: string,
    reviewedBy?: string,
  ): Promise<CashoutDocument> {
    const request = await this.cashoutModel.findById(id).exec();
    if (!request) throw new NotFoundException('Cashout request not found.');
    if (request.status !== CashoutStatus.PENDING) {
      throw new BadRequestException(`Request is already ${request.status}.`);
    }

    request.status    = CashoutStatus.APPROVED;
    request.adminNote = adminNote ?? null;
    request.reviewedAt = new Date();
    request.reviewedBy = reviewedBy ?? null;
    await request.save();

    this.logger.log(`Cashout ${id} APPROVED — ${request.amount} ETB to ${request.phoneNumber}`);
    return request;
  }

  /**
   * Admin rejects — refunds amount back to user's mainWallet.
   */
  async rejectCashout(
    id: string,
    adminNote?: string,
    reviewedBy?: string,
  ): Promise<CashoutDocument> {
    const request = await this.cashoutModel.findById(id).exec();
    if (!request) throw new NotFoundException('Cashout request not found.');
    if (request.status !== CashoutStatus.PENDING) {
      throw new BadRequestException(`Request is already ${request.status}.`);
    }

    // Refund back to mainWallet
    await this.usersService.creditMainWallet(
      request.userId.toString(),
      request.amount,
    );

    request.status    = CashoutStatus.REJECTED;
    request.adminNote = adminNote ?? null;
    request.reviewedAt = new Date();
    request.reviewedBy = reviewedBy ?? null;
    await request.save();

    this.logger.log(`Cashout ${id} REJECTED — ${request.amount} ETB refunded to user`);
    return request;
  }
}
