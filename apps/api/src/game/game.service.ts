import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RedisService } from '@app/database';
import { Game, GameDocument } from './schemas/game.schema';
import { Ticket, TicketDocument } from './schemas/ticket.schema';
import { GamePhase } from './enums/game-phase.enum';
import { WinPattern } from './enums/win-pattern.enum';
import { checkWin, findWinnerAmongCards } from './utils/win-checker';
import { CardsService } from '../cards/cards.service';
import { BingoGateway } from '../socket/bingo.gateway';
import { CreateGameDto } from './dto/create-game.dto';
import { UsersService } from '../users/users.service';
import { SettingsService } from '../settings/settings.service';

/** Shape of the hot game state cached in Redis */
export interface GameStateCache {
  gameId: string;
  gameCode: string;
  phase: GamePhase;
  ticketPrice: number;
  winPattern: WinPattern;
  drawnNumbers: number[];
  currentDraw: number | null;
  countdownSeconds: number;
  countdownStartedAt: number | null;
  drawIntervalSeconds: number;
  /** Card numbers that have been sold */
  soldCardNumbers: number[];
}

@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);

  /** NodeJS timer handles keyed by gameId */
  private drawTimers = new Map<string, NodeJS.Timeout>();
  private countdownTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectModel(Game.name) private readonly gameModel: Model<GameDocument>,
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    private readonly redisService: RedisService,
    private readonly cardsService: CardsService,
    private readonly usersService: UsersService,
    private readonly settingsService: SettingsService,
    @Inject(forwardRef(() => BingoGateway))
    private readonly gateway: BingoGateway,
  ) {}

  // ─────────────────────────────────────────────────────────────
  //  Redis helpers
  // ─────────────────────────────────────────────────────────────

  private redisKey(gameId: string): string {
    return `game:state:${gameId}`;
  }

  async getCachedState(gameId: string): Promise<GameStateCache | null> {
    const raw = await this.redisService.getClient().get(this.redisKey(gameId));
    return raw ? (JSON.parse(raw) as GameStateCache) : null;
  }

  private async setCachedState(state: GameStateCache): Promise<void> {
    await this.redisService
      .getClient()
      .set(this.redisKey(state.gameId), JSON.stringify(state));
  }

  private async deleteCachedState(gameId: string): Promise<void> {
    await this.redisService.getClient().del(this.redisKey(gameId));
  }

  // ─────────────────────────────────────────────────────────────
  //  Game lifecycle — phase transitions
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a new game in CARD_SELECTION phase.
   * Only one game can be active (not GAME_OVER) at a time.
   */
  async createGame(
    dto: CreateGameDto,
    adminUserId: string,
  ): Promise<GameDocument> {
    const existing = await this.gameModel
      .findOne({ phase: { $ne: GamePhase.GAME_OVER } })
      .sort({ createdAt: -1 })
      .exec();

    if (existing) {
      throw new BadRequestException(
        `Game ${existing.gameCode} is already active (phase: ${existing.phase}). End it before starting a new one.`,
      );
    }

    const cardsReady = await this.cardsService.hasCardsGenerated();
    if (!cardsReady) {
      throw new BadRequestException(
        'Cards have not been generated yet. Call POST /cards/generate first.',
      );
    }

    const gameCode = await this.generateGameCode();

    const game = new this.gameModel({
      gameCode,
      phase: GamePhase.CARD_SELECTION,
      ticketPrice: dto.ticketPrice ?? 50,
      purchasingSeconds: dto.purchasingSeconds ?? 30,
      countdownSeconds: dto.countdownSeconds ?? 10,
      drawIntervalSeconds: dto.drawIntervalSeconds ?? 5,
      winPattern: dto.winPattern ?? WinPattern.FULL_HOUSE,
      drawnNumbers: [],
      currentDraw: null,
      winnerId: null,
      winningCardNumber: null,
      createdBy: new Types.ObjectId(adminUserId),
    });

    await game.save();

    const state: GameStateCache = {
      gameId: game._id.toString(),
      gameCode: game.gameCode,
      phase: GamePhase.CARD_SELECTION,
      ticketPrice: game.ticketPrice,
      winPattern: game.winPattern,
      drawnNumbers: [],
      currentDraw: null,
      countdownSeconds: game.countdownSeconds,
      countdownStartedAt: game.countdownStartedAt ? game.countdownStartedAt.getTime() : null,
      drawIntervalSeconds: game.drawIntervalSeconds,
      soldCardNumbers: [],
    };

    await this.setCachedState(state);

    this.logger.log(`Game ${gameCode} created in CARD_SELECTION phase.`);
    this.gateway.broadcastGameState(state);

    return game;
  }

  /**
   * Start CARD_SELECTION phase timer (purchasing phase).
   */
  async startPurchasingPhase(gameId: string): Promise<GameStateCache> {
    const game = await this.requireGame(gameId, GamePhase.CARD_SELECTION);
    
    game.countdownStartedAt = new Date();
    await game.save();

    const state = await this.buildAndCacheState(game);

    this.logger.log(`Game ${game.gameCode} started CARD_SELECTION (${game.purchasingSeconds}s)`);
    this.gateway.broadcastPhaseChange(state);

    const timer = setTimeout(async () => {
      try {
        await this.startCountdown(gameId);
      } catch (err) {
        this.logger.error(`startCountdown timer error for game ${gameId}:`, err);
      }
    }, game.purchasingSeconds * 1000);

    this.countdownTimers.set(gameId, timer);

    return state;
  }

  /**
   * CARD_SELECTION → COUNTDOWN
   * Stops card sales and starts the countdown timer.
   */
  async startCountdown(gameId: string): Promise<GameStateCache> {
    this.clearTimer(this.countdownTimers, gameId);

    const game = await this.requireGame(gameId, GamePhase.CARD_SELECTION);

    // Guard: count sold tickets. Use the same query as buildAndCacheState
    // (distinct cardNumber) to avoid ObjectId type mismatch with countDocuments.
    const soldFromDb = await this.ticketModel
      .distinct('cardNumber', { gameId: game._id })
      .exec();
    const soldCountDb = soldFromDb.length;

    // Also check Redis in case DB query has a timing quirk
    const cachedState = await this.getCachedState(gameId);
    const soldCountRedis = cachedState?.soldCardNumbers?.length ?? 0;

    const soldCount = Math.max(soldCountDb, soldCountRedis);

    this.logger.log(
      `Game ${game.gameCode}: startCountdown — soldCountDb=${soldCountDb}, soldCountRedis=${soldCountRedis}, using=${soldCount}`,
    );

    if (soldCount === 0) {
      this.logger.warn(
        `Game ${game.gameCode}: purchasing phase ended with 0 sold cards — cancelling game.`,
      );
      return this.endGame(gameId, []);
    }

    game.phase = GamePhase.COUNTDOWN;
    game.countdownStartedAt = new Date();
    await game.save();

    const state = await this.buildAndCacheState(game);

    this.logger.log(
      `Game ${game.gameCode} → COUNTDOWN (${game.countdownSeconds}s)`,
    );
    this.gateway.broadcastPhaseChange(state);

    // Automatically transition to DRAWING after countdown expires
    const timer = setTimeout(async () => {
      try {
        await this.startDrawing(gameId);
      } catch (err) {
        this.logger.error(`startDrawing timer error for game ${gameId}:`, err);
      }
    }, game.countdownSeconds * 1000);

    this.countdownTimers.set(gameId, timer);

    return state;
  }

  /**
   * COUNTDOWN → DRAWING
   * Kicks off the automatic draw loop.
   * Guards: requires at least 1 sold card before drawing starts.
   */
  async startDrawing(gameId: string): Promise<GameStateCache> {
    this.clearTimer(this.countdownTimers, gameId);

    const game = await this.requireGame(gameId, GamePhase.COUNTDOWN);

    // ── Guard: no sold cards → cancel game instead of drawing ──
    const soldFromDb2 = await this.ticketModel
      .distinct('cardNumber', { gameId: game._id })
      .exec();
    const soldCountDb = soldFromDb2.length;
    const cachedState2 = await this.getCachedState(gameId);
    const soldCountRedis2 = cachedState2?.soldCardNumbers?.length ?? 0;
    const soldCount = Math.max(soldCountDb, soldCountRedis2);

    this.logger.log(
      `Game ${game.gameCode}: startDrawing — soldCountDb=${soldCountDb}, soldCountRedis=${soldCountRedis2}, using=${soldCount}`,
    );

    if (soldCount === 0) {
      this.logger.warn(
        `Game ${game.gameCode}: countdown ended with 0 sold cards — cancelling game.`,
      );
      return this.endGame(gameId, []);
    }

    game.phase = GamePhase.DRAWING;
    game.drawingStartedAt = new Date();
    await game.save();

    const state = await this.buildAndCacheState(game);

    this.logger.log(`Game ${game.gameCode} → DRAWING (${soldCount} cards sold)`);
    this.gateway.broadcastPhaseChange(state);

    await this.scheduleNextDraw(gameId, game.drawIntervalSeconds);

    return state;
  }

  /**
   * Draw the next number. Called by the draw loop timer.
   * Checks for a winner after each draw.
   */
  async drawNextNumber(gameId: string): Promise<GameStateCache> {
    const game = await this.requireGame(gameId, GamePhase.DRAWING);

    const remaining = this.getRemainingNumbers(game.drawnNumbers);

    if (remaining.length === 0) {
      this.logger.warn(
        `Game ${game.gameCode}: all 75 numbers drawn with no winner — ending game.`,
      );
      return this.endGame(gameId, []);
    }

    // Pick a random number from the remaining pool
    const pick = remaining[Math.floor(Math.random() * remaining.length)];

    game.drawnNumbers.push(pick);
    game.currentDraw = pick;
    await game.save();

    const state = await this.buildAndCacheState(game);

    this.logger.log(
      `Game ${game.gameCode}: drew ${pick} (${game.drawnNumbers.length}/75)`,
    );
    this.gateway.broadcastNumberDrawn(state, pick);

    // After broadcasting the draw, check every active card for a win
    await this.checkAllCardsForWin(game, state);

    return state;
  }

  /**
   * Validate a win claim from a player and, if valid, end the game.
   * Called when a player sends a "BINGO!" event from the frontend.
   */
  async claimWin(
    gameId: string,
    userId: string,
    cardNumber: number,
  ): Promise<{ valid: boolean; message: string }> {
    const game = await this.gameModel.findById(gameId).exec();
    if (!game || game.phase !== GamePhase.DRAWING) {
      return { valid: false, message: 'Game is not in DRAWING phase.' };
    }

    // Use telegramId-based lookup to avoid ObjectId type mismatch.
    // userId passed from FE is the internal user _id string.
    // Find the user's telegramId first, then look up the ticket by telegramId.
    const user = await this.usersService.findById(userId);
    if (!user) {
      return { valid: false, message: 'User not found.' };
    }

    const ticket = await this.ticketModel
      .findOne({
        gameId: new Types.ObjectId(gameId),
        telegramId: user.telegramId,
        cardNumber,
      })
      .exec();

    if (!ticket) {
      return {
        valid: false,
        message: 'You do not own this card in this game.',
      };
    }

    const card = await this.cardsService.findCardByNumber(cardNumber);
    const result = checkWin(card.matrix, game.drawnNumbers, game.winPattern);

    if (!result.isWinner) {
      this.logger.warn(
        `Invalid BINGO claim from user ${userId} on card ${cardNumber} in game ${game.gameCode}`,
      );
      this.gateway.broadcastInvalidClaim(gameId, userId, cardNumber);
      return { valid: false, message: 'Not a valid win with current draws.' };
    }

    // Valid win — stop the draw loop and end the game
    this.clearTimer(this.drawTimers, gameId);
    await this.endGame(gameId, [{ userId, cardNumber }]);

    return { valid: true, message: 'BINGO confirmed!' };
  }

  /**
   * Transition to GAME_OVER.
   * - Computes rake from dynamic tiers (SettingsService)
   * - Splits remaining prize equally among all winners
   * - Credits each winner's mainWallet (not gameBalance)
   * - Supports multiple simultaneous winners
   *
   * winnerCards: array of { userId, cardNumber } — pass empty array for no winners.
   */
  async endGame(
    gameId: string,
    winnerCards: { userId: string | null; cardNumber: number }[],
  ): Promise<GameStateCache> {
    this.clearTimer(this.drawTimers, gameId);
    this.clearTimer(this.countdownTimers, gameId);

    const game = await this.gameModel.findById(gameId).exec();
    if (!game) throw new NotFoundException(`Game ${gameId} not found`);

    // ── Compute prize pool ─────────────────────────────────────
    const soldCount = await this.ticketModel
      .distinct('cardNumber', { gameId: game._id })
      .exec()
      .then((r) => r.length);

    const totalPot = soldCount * game.ticketPrice;
    const rakePct  = await this.settingsService.getRakePct(soldCount);
    const adminCut = Math.floor(totalPot * rakePct) / 100;
    const prizePool = totalPot - adminCut;

    this.logger.log(
      `Game ${game.gameCode}: pot=${totalPot} ETB, rake=${rakePct}% (${adminCut} ETB), prizePool=${prizePool} ETB`,
    );

    // ── Resolve winners (filter out null userIds) ──────────────
    const validWinners = winnerCards.filter((w) => !!w.userId);
    const perWinnerPrize = validWinners.length > 0
      ? Math.floor((prizePool / validWinners.length) * 100) / 100
      : 0;

    // ── Update game document ───────────────────────────────────
    game.phase = GamePhase.GAME_OVER;
    game.endedAt = new Date();
    // Store first winner for backward compat on existing fields
    game.winnerId = validWinners[0]?.userId
      ? new Types.ObjectId(validWinners[0].userId)
      : null;
    game.winningCardNumber = validWinners[0]?.cardNumber ?? null;
    await game.save();

    // ── Mark winning tickets + credit mainWallet ───────────────
    for (const winner of validWinners) {
      // Mark ticket
      await this.ticketModel.findOneAndUpdate(
        { gameId: game._id, telegramId: { $exists: true }, cardNumber: winner.cardNumber },
        { $set: { isWinner: true } },
      ).exec();

      // Credit mainWallet
      await this.usersService.creditMainWallet(winner.userId!, perWinnerPrize);

      this.logger.log(
        `Paid ${perWinnerPrize} ETB to winner userId=${winner.userId} (card #${winner.cardNumber})`,
      );
    }

    if (validWinners.length === 0) {
      this.logger.log(`Game ${game.gameCode}: no winners — prize pool forfeited`);
    }

    const state = await this.buildAndCacheState(game);

    this.logger.log(
      `Game ${game.gameCode} → GAME_OVER. Winners: ${validWinners.length}, each receives ${perWinnerPrize} ETB`,
    );

    // Broadcast with first winner info for FE overlay
    this.gateway.broadcastGameOver(
      state,
      validWinners[0]?.userId ?? null,
      validWinners[0]?.cardNumber ?? null,
    );

    // Keep state in Redis for 10 minutes
    await this.redisService.getClient().expire(this.redisKey(gameId), 60 * 10);

    return state;
  }

  // ─────────────────────────────────────────────────────────────
  //  Ticket helpers (called from TicketsService)
  // ─────────────────────────────────────────────────────────────

  /** Add a sold card number to the Redis cache */
  async markCardSold(gameId: string, cardNumber: number): Promise<void> {
    const state = await this.getCachedState(gameId);
    if (!state) return;
    if (!state.soldCardNumbers.includes(cardNumber)) {
      state.soldCardNumbers.push(cardNumber);
      await this.setCachedState(state);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  Read
  // ─────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────
  //  joinOrCreateGame — called by frontend stake click
  // ─────────────────────────────────────────────────────────────

  /**
   * If a non-finished game already exists, return it.
   * If not, create a new one with the requested ticketPrice
   * and sensible defaults (30s countdown, 5s draw interval, FULL_HOUSE).
   */
  async joinOrCreateGame(
    ticketPrice: number,
    adminId: string,
  ): Promise<{ gameId: string; gameCode: string; phase: GamePhase; ticketPrice: number }> {
    // Check for any active game first (regardless of stake)
    const existing = await this.gameModel
      .findOne({ phase: { $ne: GamePhase.GAME_OVER } })
      .sort({ createdAt: -1 })
      .exec();

    if (existing) {
      // Ensure Redis state is warm
      let state = await this.getCachedState(existing._id.toString());
      if (!state) state = await this.buildAndCacheState(existing);
      return {
        gameId: existing._id.toString(),
        gameCode: existing.gameCode,
        phase: existing.phase,
        ticketPrice: existing.ticketPrice,
      };
    }

    // No active game — create one
    const cardsReady = await this.cardsService.hasCardsGenerated();
    if (!cardsReady) {
      throw new BadRequestException(
        'Cards have not been generated yet. Run POST /cards/generate first.',
      );
    }

    const gameCode = await this.generateGameCode();
    const game = new this.gameModel({
      gameCode,
      phase: GamePhase.CARD_SELECTION,
      ticketPrice: ticketPrice ?? 10,
      purchasingSeconds: 30, // 30s for purchasing
      countdownSeconds: 10, // 10s buffer before drawing starts
      drawIntervalSeconds: 5,
      winPattern: WinPattern.FULL_HOUSE,
      drawnNumbers: [],
      currentDraw: null,
      winnerId: null,
      winningCardNumber: null,
      createdBy: new Types.ObjectId('6a69e830f52b7714849bad3d'), // Yo (admin)
    });

    await game.save();

    // Automatically start purchasing timer
    const state = await this.startPurchasingPhase(game._id.toString());

    this.logger.log(`Auto-created game ${gameCode} with ticketPrice=${ticketPrice} ETB and started purchasing phase.`);

    return {
      gameId: game._id.toString(),
      gameCode: game.gameCode,
      phase: state.phase,
      ticketPrice: state.ticketPrice,
    };
  }

  async getActiveGame(): Promise<GameStateCache | null> {
    // Sort by newest first — ensures we always get the most recent active game,
    // not a stale one from a previous session that wasn't properly ended.
    const game = await this.gameModel
      .findOne({ phase: { $ne: GamePhase.GAME_OVER } })
      .sort({ createdAt: -1 })
      .exec();

    if (!game) return null;

    // Try Redis first, fall back to DB rebuild
    const cached = await this.getCachedState(game._id.toString());
    if (cached) return cached;

    return this.buildAndCacheState(game);
  }

  async getGameById(gameId: string): Promise<GameDocument> {
    const game = await this.gameModel.findById(gameId).exec();
    if (!game) throw new NotFoundException(`Game ${gameId} not found`);
    return game;
  }

  async getGameHistory(limit = 20, skip = 0) {
    return this.gameModel
      .find({ phase: GamePhase.GAME_OVER })
      .sort({ endedAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
  }

  // ─────────────────────────────────────────────────────────────
  //  Internal helpers
  // ─────────────────────────────────────────────────────────────

  private async requireGame(
    gameId: string,
    expectedPhase: GamePhase,
  ): Promise<GameDocument> {
    const game = await this.gameModel.findById(gameId).exec();
    if (!game) throw new NotFoundException(`Game ${gameId} not found`);

    if (game.phase !== expectedPhase) {
      throw new BadRequestException(
        `Expected game phase ${expectedPhase}, but current phase is ${game.phase}`,
      );
    }
    return game;
  }

  private async buildAndCacheState(game: GameDocument): Promise<GameStateCache> {
    const soldCardNumbers = await this.ticketModel
      .find({ gameId: game._id })
      .distinct('cardNumber')
      .exec();

    const currentCountdownSeconds = game.phase === GamePhase.CARD_SELECTION 
      ? game.purchasingSeconds 
      : game.countdownSeconds;

    const state: GameStateCache = {
      gameId: game._id.toString(),
      gameCode: game.gameCode,
      phase: game.phase,
      ticketPrice: game.ticketPrice,
      winPattern: game.winPattern,
      drawnNumbers: game.drawnNumbers,
      currentDraw: game.currentDraw,
      countdownSeconds: currentCountdownSeconds,
      countdownStartedAt: game.countdownStartedAt ? game.countdownStartedAt.getTime() : null,
      drawIntervalSeconds: game.drawIntervalSeconds,
      soldCardNumbers,
    };

    await this.setCachedState(state);
    return state;
  }

  private getRemainingNumbers(drawn: number[]): number[] {
    const drawnSet = new Set(drawn);
    const remaining: number[] = [];
    for (let n = 1; n <= 75; n++) {
      if (!drawnSet.has(n)) remaining.push(n);
    }
    return remaining;
  }

  private async scheduleNextDraw(
    gameId: string,
    intervalSeconds: number,
  ): Promise<void> {
    const timer = setTimeout(async () => {
      try {
        await this.drawNextNumber(gameId);
      } catch (err) {
        this.logger.error(`Draw loop error for game ${gameId}:`, err);
      }
    }, intervalSeconds * 1000);

    this.drawTimers.set(gameId, timer);
  }

  /**
   * After each draw, scan all sold cards for winners.
   * All cards that match simultaneously share the prize.
   */
  private async checkAllCardsForWin(
    game: GameDocument,
    state: GameStateCache,
  ): Promise<void> {
    if (state.soldCardNumbers.length === 0) {
      this.logger.warn(`Game ${game.gameCode}: drawing with 0 sold cards — ending game.`);
      await this.endGame(game._id.toString(), []);
      return;
    }

    const cardDocs = await Promise.all(
      state.soldCardNumbers.map((cn) => this.cardsService.findCardByNumber(cn)),
    );

    const winners = findWinnerAmongCards(
      cardDocs.map((c) => ({ cardNumber: c.cardNumber, matrix: c.matrix })),
      game.drawnNumbers,
      game.winPattern,
    );

    if (winners.length > 0) {
      this.clearTimer(this.drawTimers, game._id.toString());

      // Resolve the userId for each winning card via telegramId-based query
      const winnerCards: { userId: string | null; cardNumber: number }[] = [];
      for (const w of winners) {
        const ticket = await this.ticketModel
          .findOne({ gameId: game._id, cardNumber: w.cardNumber })
          .exec();
        winnerCards.push({
          userId: ticket?.userId?.toString() ?? null,
          cardNumber: w.cardNumber,
        });
      }

      this.logger.log(
        `Game ${game.gameCode}: ${winners.length} winner(s) found on draw ${game.drawnNumbers.length}`,
      );

      await this.endGame(game._id.toString(), winnerCards);
    } else {
      await this.scheduleNextDraw(game._id.toString(), game.drawIntervalSeconds);
    }
  }

  private clearTimer(
    map: Map<string, NodeJS.Timeout>,
    gameId: string,
  ): void {
    const timer = map.get(gameId);
    if (timer) {
      clearTimeout(timer);
      map.delete(gameId);
    }
  }

  private async generateGameCode(): Promise<string> {
    const count = await this.gameModel.countDocuments().exec();
    return `GAME-${String(count + 1).padStart(4, '0')}`;
  }
}
