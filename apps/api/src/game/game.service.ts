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
      countdownSeconds: dto.countdownSeconds ?? 30,
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
      drawIntervalSeconds: game.drawIntervalSeconds,
      soldCardNumbers: [],
    };

    await this.setCachedState(state);

    this.logger.log(`Game ${gameCode} created in CARD_SELECTION phase.`);
    this.gateway.broadcastGameState(state);

    return game;
  }

  /**
   * CARD_SELECTION → COUNTDOWN
   * Stops card sales and starts the countdown timer.
   */
  async startCountdown(gameId: string): Promise<GameStateCache> {
    const game = await this.requireGame(gameId, GamePhase.CARD_SELECTION);

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
      await this.startDrawing(gameId);
    }, game.countdownSeconds * 1000);

    this.countdownTimers.set(gameId, timer);

    return state;
  }

  /**
   * COUNTDOWN → DRAWING
   * Kicks off the automatic draw loop.
   */
  async startDrawing(gameId: string): Promise<GameStateCache> {
    // Clear countdown timer in case this was called manually
    this.clearTimer(this.countdownTimers, gameId);

    const game = await this.requireGame(gameId, GamePhase.COUNTDOWN);

    game.phase = GamePhase.DRAWING;
    game.drawingStartedAt = new Date();
    await game.save();

    const state = await this.buildAndCacheState(game);

    this.logger.log(`Game ${game.gameCode} → DRAWING`);
    this.gateway.broadcastPhaseChange(state);

    // Kick off the first draw immediately
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
      return this.endGame(gameId, null, null);
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

    // Confirm this user actually owns this card in this game
    const ticket = await this.ticketModel
      .findOne({
        gameId: new Types.ObjectId(gameId),
        userId: new Types.ObjectId(userId),
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
    await this.endGame(gameId, userId, cardNumber);

    return { valid: true, message: 'BINGO confirmed!' };
  }

  /**
   * Transition to GAME_OVER, mark winner (if any), broadcast final state.
   */
  async endGame(
    gameId: string,
    winnerId: string | null,
    winningCardNumber: number | null,
  ): Promise<GameStateCache> {
    this.clearTimer(this.drawTimers, gameId);
    this.clearTimer(this.countdownTimers, gameId);

    const game = await this.gameModel.findById(gameId).exec();
    if (!game) throw new NotFoundException(`Game ${gameId} not found`);

    game.phase = GamePhase.GAME_OVER;
    game.endedAt = new Date();
    game.winnerId = winnerId ? new Types.ObjectId(winnerId) : null;
    game.winningCardNumber = winningCardNumber;
    await game.save();

    if (winnerId && winningCardNumber) {
      await this.ticketModel
        .findOneAndUpdate(
          {
            gameId: new Types.ObjectId(gameId),
            userId: new Types.ObjectId(winnerId),
            cardNumber: winningCardNumber,
          },
          { $set: { isWinner: true } },
        )
        .exec();
    }

    const state = await this.buildAndCacheState(game);

    this.logger.log(
      `Game ${game.gameCode} → GAME_OVER. Winner: card #${winningCardNumber ?? 'none'}`,
    );
    this.gateway.broadcastGameOver(state, winnerId, winningCardNumber);

    // Keep state in Redis for 10 minutes so late clients can still read it
    await this.redisService
      .getClient()
      .expire(this.redisKey(gameId), 60 * 10);

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

  async getActiveGame(): Promise<GameStateCache | null> {
    const game = await this.gameModel
      .findOne({ phase: { $ne: GamePhase.GAME_OVER } })
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

    const state: GameStateCache = {
      gameId: game._id.toString(),
      gameCode: game.gameCode,
      phase: game.phase,
      ticketPrice: game.ticketPrice,
      winPattern: game.winPattern,
      drawnNumbers: game.drawnNumbers,
      currentDraw: game.currentDraw,
      countdownSeconds: game.countdownSeconds,
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
   * After each draw, scan all sold cards for a winner.
   * If found, stop the loop and end the game.
   */
  private async checkAllCardsForWin(
    game: GameDocument,
    state: GameStateCache,
  ): Promise<void> {
    if (state.soldCardNumbers.length === 0) {
      // No players — keep drawing
      await this.scheduleNextDraw(game._id.toString(), game.drawIntervalSeconds);
      return;
    }

    // Load card matrices for all sold cards
    const cardDocs = await Promise.all(
      state.soldCardNumbers.map((cn) => this.cardsService.findCardByNumber(cn)),
    );

    const winner = findWinnerAmongCards(
      cardDocs.map((c) => ({ cardNumber: c.cardNumber, matrix: c.matrix })),
      game.drawnNumbers,
      game.winPattern,
    );

    if (winner) {
      this.clearTimer(this.drawTimers, game._id.toString());

      // Find which user owns the winning card
      const ticket = await this.ticketModel
        .findOne({
          gameId: game._id,
          cardNumber: winner.cardNumber,
        })
        .exec();

      await this.endGame(
        game._id.toString(),
        ticket?.userId?.toString() ?? null,
        winner.cardNumber,
      );
    } else {
      // No winner yet — schedule the next draw
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
