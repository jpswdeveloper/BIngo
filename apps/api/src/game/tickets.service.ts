import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ticket, TicketDocument } from './schemas/ticket.schema';
import { GamePhase } from './enums/game-phase.enum';
import { GameService } from './game.service';
import { UsersService } from '../users/users.service';
import { CardsService } from '../cards/cards.service';

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    @Inject(forwardRef(() => GameService))
    private readonly gameService: GameService,
    private readonly usersService: UsersService,
    private readonly cardsService: CardsService,
  ) {}

  // ─────────────────────────────────────────────────────────────
  //  Purchase
  // ─────────────────────────────────────────────────────────────

  /**
   * Buy a ticket for the currently active game.
   *
   * Rules enforced:
   *  1. Game must be in CARD_SELECTION phase
   *  2. User must exist and not be blocked
   *  3. Card number must be valid (1-600)
   *  4. Card must not already be sold in this game
   *  5. User must not already hold a ticket in this game
   *  6. User must have sufficient wallet balance
   */
  async buyTicket(
    telegramId: string,
    cardNumber: number,
  ): Promise<TicketDocument> {
    // 1. Get active game from Redis/DB
    const state = await this.gameService.getActiveGame();
    if (!state) {
      throw new NotFoundException('No active game found.');
    }
    if (state.phase !== GamePhase.CARD_SELECTION && state.phase !== GamePhase.COUNTDOWN) {
      throw new BadRequestException(
        `Card purchases are closed. Game is in ${state.phase} phase.`,
      );
    }

    // 2. Resolve user
    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) {
      throw new NotFoundException(`User with Telegram ID ${telegramId} not found.`);
    }
    if (user.isBlocked) {
      throw new BadRequestException('Your account is blocked.');
    }

    // 3. Validate card
    if (cardNumber < 1 || cardNumber > 600) {
      throw new BadRequestException('Card number must be between 1 and 600.');
    }
    await this.cardsService.findCardByNumber(cardNumber); // throws 404 if missing

    const gameObjectId = new Types.ObjectId(state.gameId);
    const userObjectId = user._id as Types.ObjectId;

    // 4. Check card availability
    const cardTaken = await this.ticketModel
      .findOne({ gameId: gameObjectId, cardNumber })
      .exec();
    if (cardTaken) {
      throw new ConflictException(
        `Card #${cardNumber} is already taken in this game.`,
      );
    }

    // 5. Allow multiple cards per user — just check this specific card isn't already taken
    const cardTakenByThisUser = await this.ticketModel
      .findOne({ gameId: gameObjectId, userId: userObjectId, cardNumber })
      .exec();
    if (cardTakenByThisUser) {
      throw new ConflictException(
        `You already own card #${cardNumber} in this game.`,
      );
    }

    // 6. Wallet balance check
    const price = state.ticketPrice;
    if (user.walletBalance < price) {
      throw new BadRequestException(
        `Insufficient balance. Need ${price} ETB, have ${user.walletBalance} ETB.`,
      );
    }

    // Deduct wallet
    await this.usersService.updateWalletBalance(
      user._id.toString(),
      user.walletBalance - price,
    );

    // Create ticket
    const ticket = new this.ticketModel({
      gameId: gameObjectId,
      userId: userObjectId,
      telegramId,
      cardNumber,
      pricePaid: price,
      isWinner: false,
    });
    await ticket.save();

    // Update Redis sold list FIRST
    await this.gameService.markCardSold(state.gameId, cardNumber);

    // The countdown is now started automatically when the game lobby is created,
    // so we don't need to trigger it here on the first ticket sold.

    this.logger.log(
      `User ${telegramId} purchased card #${cardNumber} in game ${state.gameCode}`,
    );

    return ticket;
  }

  async buyTicketBatch(
    telegramId: string,
    cardNumbers: number[],
  ): Promise<TicketDocument[]> {
    if (!cardNumbers.length) return [];

    const state = await this.gameService.getActiveGame();
    if (!state) throw new NotFoundException('No active game found.');
    if (state.phase !== GamePhase.CARD_SELECTION && state.phase !== GamePhase.COUNTDOWN) {
      throw new BadRequestException(`Card purchases are closed.`);
    }

    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) throw new NotFoundException('User not found.');
    if (user.isBlocked) throw new BadRequestException('Your account is blocked.');

    const price = state.ticketPrice;
    const totalCost = price * cardNumbers.length;
    if (user.walletBalance < totalCost) {
      throw new BadRequestException(`Insufficient balance for ${cardNumbers.length} cards.`);
    }

    const gameObjectId = new Types.ObjectId(state.gameId);
    const userObjectId = user._id as Types.ObjectId;

    // Validate availability
    for (const cardNumber of cardNumbers) {
      if (cardNumber < 1 || cardNumber > 600) {
        throw new BadRequestException('Invalid card number.');
      }
      const taken = await this.ticketModel.findOne({ gameId: gameObjectId, cardNumber }).exec();
      if (taken) throw new ConflictException(`Card #${cardNumber} is already taken.`);
    }

    // Deduct wallet (atomically increment by negative value if possible, or just set)
    await this.usersService.updateWalletBalance(user._id.toString(), user.walletBalance - totalCost);

    const tickets: TicketDocument[] = [];
    for (const cardNumber of cardNumbers) {
      const ticket = new this.ticketModel({
        gameId: gameObjectId,
        userId: userObjectId,
        telegramId,
        cardNumber,
        pricePaid: price,
        isWinner: false,
      });
      await ticket.save();
      tickets.push(ticket);
      await this.gameService.markCardSold(state.gameId, cardNumber);
    }

    // The countdown is now started automatically when the game lobby is created.

    return tickets;
  }

  // ─────────────────────────────────────────────────────────────
  //  Queries
  // ─────────────────────────────────────────────────────────────

  /**
   * All tickets for a given game, optionally filtered to a specific user.
   */
  async getTicketsForGame(
    gameId: string,
    userId?: string,
  ): Promise<TicketDocument[]> {
    const filter: Record<string, unknown> = {
      gameId: new Types.ObjectId(gameId),
    };
    if (userId) {
      filter.userId = new Types.ObjectId(userId);
    }
    return this.ticketModel.find(filter).exec();
  }

  /**
   * All tickets a user has ever purchased, across all games.
   */
  async getUserTicketHistory(
    userId: string,
    limit = 20,
    skip = 0,
  ): Promise<{ tickets: TicketDocument[]; total: number }> {
    const filter = { userId: new Types.ObjectId(userId) };
    const [tickets, total] = await Promise.all([
      this.ticketModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('gameId', 'gameCode phase endedAt')
        .exec(),
      this.ticketModel.countDocuments(filter).exec(),
    ]);
    return { tickets, total };
  }

  /**
   * All tickets a specific user holds in the current active game.
   */
  async getMyTicketsInActiveGame(
    telegramId: string,
  ): Promise<TicketDocument[]> {
    const state = await this.gameService.getActiveGame();
    if (!state) {
      this.logger.warn(`getMyTicketsInActiveGame: no active game for telegramId=${telegramId}`);
      return [];
    }

    // Query by telegramId (plain string) + gameId rather than userId (ObjectId).
    // This avoids a bson version mismatch where stored userId ObjectIds don't
    // compare equal to freshly constructed Types.ObjectId instances.
    const tickets = await this.ticketModel
      .find({
        gameId: new Types.ObjectId(state.gameId),
        telegramId,
      })
      .exec();

    this.logger.log(
      `getMyTicketsInActiveGame: telegramId=${telegramId}, gameId=${state.gameId}, phase=${state.phase}, found=${tickets.length} tickets`,
    );

    return tickets;
  }

  /**
   * The ticket a specific user holds in the current active game, if any.
   * Returns the FIRST ticket (for backward compat).
   */
  async getMyTicketInActiveGame(
    telegramId: string,
  ): Promise<TicketDocument | null> {
    const state = await this.gameService.getActiveGame();
    if (!state) return null;

    return this.ticketModel
      .findOne({
        gameId: new Types.ObjectId(state.gameId),
        telegramId,
      })
      .exec();
  }

  /**
   * Which card numbers are still available (not sold) in the active game.
   */
  async getAvailableCards(): Promise<{
    available: number[];
    sold: number[];
    total: number;
  }> {
    const state = await this.gameService.getActiveGame();
    if (!state) {
      return { available: [], sold: [], total: 0 };
    }

    const soldSet = new Set(state.soldCardNumbers);
    const available: number[] = [];

    for (let i = 1; i <= 600; i++) {
      if (!soldSet.has(i)) available.push(i);
    }

    return {
      available,
      sold: state.soldCardNumbers,
      total: 600,
    };
  }

  /**
   * Check if a specific card is still available.
   */
  async isCardAvailable(cardNumber: number): Promise<boolean> {
    const state = await this.gameService.getActiveGame();
    if (!state || (state.phase !== GamePhase.CARD_SELECTION && state.phase !== GamePhase.COUNTDOWN)) return false;
    return !state.soldCardNumbers.includes(cardNumber);
  }
}
