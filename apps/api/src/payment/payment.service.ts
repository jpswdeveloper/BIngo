import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { APP_TIMEZONE_OFFSET, DateService } from "@app/common";
import {
  PaymentIntent,
  PaymentIntentDocument,
  PaymentStatus,
  PaymentType,
} from "./schema/payment.schema";
import {
  TransactionHistory,
  TransactionHistoryDocument,
  TransactionType,
} from "./schema/transaction.schema";
import { UsersService } from "../users/users.service";
import { CreateDepositIntentDto } from "./dto/payment-history.dto";
import { TelebirrScraperService } from "./telebirr.service";

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  // Define target merchant/agent phone number (or get from process.env.TELEBIRR_RECEIVER_NUMBER)
  private readonly TARGET_RECEIVER_NUMBER =
    process.env.TELEBIRR_RECEIVER_NUMBER!;

  private readonly TARGET_RECEIVER_NAME = process.env.TELEBIRR_RECEIVER_NAME!;

  constructor(
    @InjectModel(PaymentIntent.name)
    private readonly paymentIntentModel: Model<PaymentIntentDocument>,
    @InjectModel(TransactionHistory.name)
    private readonly txHistoryModel: Model<TransactionHistoryDocument>,
    private readonly usersService: UsersService,
    private readonly telebirrScraperService: TelebirrScraperService,
    private readonly dateService: DateService,
  ) {}

  /**
   * Helper to normalize Ethiopian phone numbers to last 9 digits for accurate matching
   * e.g., "+251911223344", "0911223344", "251911223344" -> "911223344"
   */
  private normalizePhoneNumber(phone: string): string {
    return phone.replace(/\D/g, "").slice(-9);
  }

  private isMaskedPhoneNumber(phone: string): boolean {
    return phone.includes("*");
  }

  private normalizeMaskedPhoneNumber(phone: string): string {
    return phone.replace(/\D/g, "");
  }

  private doesPhoneNumberMatch(
    receiptNumber: string,
    targetNumber: string,
  ): boolean {
    if (!receiptNumber) return false;

    const rawReceipt = receiptNumber.trim();
    const targetNormalized = this.normalizePhoneNumber(targetNumber);

    if (this.isMaskedPhoneNumber(rawReceipt)) {
      const receiptDigits = this.normalizeMaskedPhoneNumber(rawReceipt);
      if (!receiptDigits) return false;
      return targetNormalized.endsWith(receiptDigits);
    }

    const receiptNormalized = this.normalizePhoneNumber(rawReceipt);
    return receiptNormalized === targetNormalized;
  }

  private doesReceiverNameMatch(receiptName?: string): boolean {
    if (!receiptName) return false;
    const normalizedReceipt = receiptName.trim().toLowerCase();
    const normalizedTarget = this.TARGET_RECEIVER_NAME.trim().toLowerCase();
    return normalizedReceipt === normalizedTarget;
  }

  private parseReceiptDate(receiptDate?: string): Date | null {
    if (!receiptDate) return null;

    const trimmed = receiptDate.trim().replace(/\s+/g, " ");
    const fullMatch = trimmed.match(
      /(\d{2})[\/\-](\d{2})[\/\-](\d{4})\s+(\d{2}):(\d{2}):(\d{2})/,
    );
    if (fullMatch) {
      const [, day, month, year, hour, minute, second] = fullMatch;
      return new Date(
        `${year}-${month}-${day}T${hour}:${minute}:${second}${APP_TIMEZONE_OFFSET}`,
      );
    }

    const dateMatch = trimmed.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      return new Date(`${year}-${month}-${day}T00:00:00${APP_TIMEZONE_OFFSET}`);
    }

    return null;
  }

  private isReceiptWithinApprovalWindow(
    intentCreatedAt: Date,
    receiptDate?: string | null,
    windowMinutes = 5,
  ): boolean {
    const receiptDateObj = this.parseReceiptDate(receiptDate ?? undefined);
    if (!receiptDateObj) return false;

    const intervalMs = windowMinutes * 60 * 1000;
    const diff = Math.abs(receiptDateObj.getTime() - intentCreatedAt.getTime());
    return diff <= intervalMs;
  }

  /**
   * Step 1: User specifies deposit amount (e.g. 50 ETB).
   */
  async createDepositIntent(
    dto: CreateDepositIntentDto,
  ): Promise<PaymentIntentDocument> {
    if (dto.expectedAmount < 10) {
      throw new BadRequestException("Minimum deposit amount is 10 ETB.");
    }
    const user = await this.usersService.findByTelegramId(dto.telegramId);
    if (!user) {
      throw new NotFoundException(
        `User with Telegram ID ${dto.telegramId} not found`,
      );
    }

    await this.paymentIntentModel.updateMany(
      {
        telegramId: dto.telegramId,
        status: PaymentStatus.AWAITING_RECEIPT,
      },
      { status: PaymentStatus.EXPIRED },
    );

    const intent = new this.paymentIntentModel({
      userId: user._id.toString(),
      telegramId: dto.telegramId,
      type: PaymentType.DEPOSIT,
      expectedAmount: dto.expectedAmount,
      paymentMethod: dto.paymentMethod || "Telebirr",
      status: PaymentStatus.AWAITING_RECEIPT,
    });

    return await intent.save();
  }

  /**
   * Step 2: Retrieve user's latest pending deposit intent
   */
  async getLatestPendingIntent(
    telegramId: string,
  ): Promise<PaymentIntentDocument | null> {
    return await this.paymentIntentModel
      .findOne({
        telegramId,
        status: PaymentStatus.AWAITING_RECEIPT,
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Step 3: Process Telebirr SMS receipt string sent by user
   */
  async processReceipt(
    telegramId: string,
    rawText: string,
  ): Promise<{ success: boolean; message: string; paidAmount?: number }> {
    // 1. Fetch pending intent
    const intent = await this.getLatestPendingIntent(telegramId);
    if (!intent) {
      return {
        success: false,
        message: "⚠️ አልተገኘም። እባክዎ አስቀድመው /deposit ብለው የገንዘብ መጠን ያስገቡ።",
      };
    }

    // 2. Scrape receipt details directly from Ethio Telecom URL
    const scrapeResult =
      await this.telebirrScraperService.scrapeReceiptPage(rawText);

    if (!scrapeResult.success || !scrapeResult.data) {
      intent.status = PaymentStatus.PENDING;
      intent.rawReceipt = rawText;
      await intent.save();

      const errorMessage =
        scrapeResult.error === "invalid_sms_format"
          ? "⚠️ ደረሰኙ የማረጋገጫ ሊንክ (https://transactioninfo...) አልያዘም። ደረሰኙ ለአስተዳዳሪው (Admin) ተልኳል::"
          : "⚠️ የቴሌብር ማረጋገጫ ገጹን መክፈት አልተቻለም። ደረሰኙ ለአስተዳዳሪው (Admin) ተልኳል::";

      return {
        success: false,
        message: errorMessage,
      };
    }

    const receipt = scrapeResult.data;
    const {
      transactionId,
      amount: paidAmount,
      creditedPartyNumber,
      creditedPartyName,
      paymentDate,
    } = receipt;

    if (!transactionId || !paidAmount) {
      intent.status = PaymentStatus.PENDING;
      intent.rawReceipt = rawText;
      await intent.save();

      return {
        success: false,
        message:
          "⚠️ የክፍያ መረጃ ማግኘት አልተቻለም። አስተዳዳሪው (Admin) እስኪያረጋግጥልዎ ድረስ እባክዎ ትንሽ ይጠብቁ::",
      };
    }

    const intentCreatedAt =
      (intent as any).createdAt instanceof Date
        ? (intent as any).createdAt
        : this.dateService.now();
    const receiptDateObj = this.parseReceiptDate(paymentDate ?? undefined);

    const isTimeWithinWindow = this.isReceiptWithinApprovalWindow(
      intentCreatedAt,
      paymentDate,
    );

    if (!isTimeWithinWindow) {
      intent.status = PaymentStatus.PENDING;
      intent.rawReceipt = rawText;
      await intent.save();

      return {
        success: false,
        message:
          "⚠️ የክፍያ የማረጋገጫ ጊዜ ከየገንዘብ መጠን ግዜ 5 ደቂቃዎች ውስጥ አይደለም። እባክዎ ወደ ደጋፊ ቡድን ይደውሉ።",
      };
    }

    // 3. Verify that transfer was sent to OUR number and receiver name matches
    const isPhoneMatch = creditedPartyNumber
      ? this.doesPhoneNumberMatch(
          creditedPartyNumber,
          this.TARGET_RECEIVER_NUMBER,
        )
      : false;
    const isNameMatch = this.doesReceiverNameMatch(creditedPartyName || "");

    if (!isPhoneMatch || !isNameMatch) {
      return {
        success: false,
        message: `⚠️ ይህ ክፍያ ወደ ትክክለኛው ቁጥር ወይም ስም አልተላከም (${creditedPartyName || "unknown"} | ${creditedPartyNumber || "unknown"}). እባክዎ ወደ **${this.TARGET_RECEIVER_NAME}** / **${this.TARGET_RECEIVER_NUMBER}** መላክዎን ያረጋግጡ::`,
      };
    }

    // 4. Prevent duplicate usage of the same Telebirr transaction ID
    const existingTxn = await this.paymentIntentModel.findOne({
      transactionId,
      status: PaymentStatus.APPROVED,
    });

    if (existingTxn) {
      throw new ConflictException(
        "❌ ይህ የትራንዛክሽን ቁጥር (Transaction ID) ቀደም ብሎ ስራ ላይ ውሏል!",
      );
    }

    // 5. Validate paid amount meets requested deposit amount
    if (paidAmount < intent.expectedAmount) {
      return {
        success: false,
        message: `⚠️ የተላከው መጠን (${paidAmount} ብር) ከጠየቁት መጠን (${intent.expectedAmount} ብር) ያነሰ ነው።`,
      };
    }

    // 6. Update Intent and Credit Wallet Balance atomically
    intent.transactionId = transactionId;
    intent.paidAmount = paidAmount;
    intent.rawReceipt = rawText;
    intent.status = PaymentStatus.APPROVED;
    await intent.save();

    await this.creditUserWallet(
      intent.userId,
      telegramId,
      paidAmount,
      TransactionType.DEPOSIT,
      `Telebirr Deposit - Txn: ${transactionId}`,
      intent._id.toString(),
    );

    return {
      success: true,
      message: `✅ **${paidAmount} ብር** በስኬት ወደ ሂሳብዎ ተጨምሯል። መልካም እድል!`,
      paidAmount,
    };
  }

  /**
   * Helper: Credit User Wallet + Add Immutable Audit Record
   */
  private async creditUserWallet(
    userId: Types.ObjectId | string | { _id?: any; id?: any },
    telegramId: string,
    amount: number,
    type: TransactionType,
    description: string,
    referenceId?: string,
  ) {
    const resolvedUserId = this.resolveUserId(userId);

    const user = await this.usersService.findById(resolvedUserId);
    if (!user) throw new NotFoundException("User not found");

    const balanceBefore = user.walletBalance || 0;
    const balanceAfter = balanceBefore + amount;

    await this.usersService.updateWalletBalance(
      resolvedUserId instanceof Types.ObjectId
        ? resolvedUserId.toString()
        : resolvedUserId,
      balanceAfter,
    );

    await this.txHistoryModel.create({
      userId: resolvedUserId as Types.ObjectId,
      telegramId,
      type,
      amount,
      balanceBefore,
      balanceAfter,
      referenceId,
      description,
    });
  }

  private resolveUserId(
    id: Types.ObjectId | string | { _id?: any; id?: any },
  ): Types.ObjectId | string {
    if (id instanceof Types.ObjectId) {
      return id;
    }

    if (typeof id === "string") {
      return id;
    }

    if (id && typeof id === "object") {
      if (id._id && Types.ObjectId.isValid(id._id)) {
        return id._id;
      }
      if (id.id && Types.ObjectId.isValid(id.id)) {
        return id.id;
      }
    }

    throw new BadRequestException(
      `Invalid user id provided to creditUserWallet: ${JSON.stringify(id)}`,
    );
  }
}
