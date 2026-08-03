import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService, GameStateCache } from '../game/game.service';

// ─────────────────────────────────────────────────────────────
//  Event name constants
//  Server → Client (emit)
// ─────────────────────────────────────────────────────────────
export const WS_EVENTS = {
  // Server → Client
  GAME_STATE:       'game:state',       // Full state snapshot on connect / phase change
  PHASE_CHANGE:     'game:phase',       // Phase transition payload
  NUMBER_DRAWN:     'game:draw',        // A new number was drawn
  GAME_OVER:        'game:over',        // Game ended — includes winner info
  INVALID_CLAIM:    'game:invalid_claim', // A bingo claim was rejected
  TICKET_SOLD:      'game:ticket_sold', // Someone bought a card (card number + remaining count)
  ERROR:            'error',

  // Client → Server
  JOIN_GAME:        'join:game',        // Client joins a game room
  LEAVE_GAME:       'leave:game',
  CLAIM_BINGO:      'claim:bingo',      // Player claims a win
  REQUEST_STATE:    'request:state',    // Client asks for the current snapshot
} as const;

// ─────────────────────────────────────────────────────────────
//  Gateway
// ─────────────────────────────────────────────────────────────

@WebSocketGateway({
  cors: {
    origin: '*', // Tighten this per environment
    credentials: false,
  },
  namespace: '/bingo',
})
@Injectable()
export class BingoGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(BingoGateway.name);

  constructor(
    @Inject(forwardRef(() => GameService))
    private readonly gameService: GameService,
  ) {}

  onModuleInit() {
    this.logger.log('BingoGateway initialised on namespace /bingo');
  }

  afterInit(server: Server) {
    this.server = server;
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // ─────────────────────────────────────────────────────────────
  //  Client → Server handlers
  // ─────────────────────────────────────────────────────────────

  /**
   * Client joins the Socket.IO room for a specific game.
   * Immediately receives the current game state snapshot.
   *
   * Payload: { gameId: string }
   */
  @SubscribeMessage(WS_EVENTS.JOIN_GAME)
  async handleJoinGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { gameId: string },
  ) {
    const { gameId } = payload;

    if (!gameId) {
      client.emit(WS_EVENTS.ERROR, { message: 'gameId is required' });
      return;
    }

    const room = this.gameRoom(gameId);
    await client.join(room);
    this.logger.log(`Client ${client.id} joined room ${room}`);

    // Send current state snapshot to the joining client
    const state = await this.gameService.getCachedState(gameId);
    if (state) {
      client.emit(WS_EVENTS.GAME_STATE, this.buildStatePayload(state));
    } else {
      client.emit(WS_EVENTS.ERROR, { message: `No game found for id ${gameId}` });
    }
  }

  /**
   * Client leaves a game room.
   * Payload: { gameId: string }
   */
  @SubscribeMessage(WS_EVENTS.LEAVE_GAME)
  async handleLeaveGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { gameId: string },
  ) {
    await client.leave(this.gameRoom(payload.gameId));
    this.logger.log(`Client ${client.id} left room ${this.gameRoom(payload.gameId)}`);
  }

  /**
   * Player claims BINGO.
   * Payload: { gameId: string; userId: string; cardNumber: number }
   */
  @SubscribeMessage(WS_EVENTS.CLAIM_BINGO)
  async handleClaimBingo(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: { gameId: string; userId: string; cardNumber: number },
  ) {
    const { gameId, userId, cardNumber } = payload;

    if (!gameId || !userId || !cardNumber) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'gameId, userId and cardNumber are required',
      });
      return;
    }

    const result = await this.gameService.claimWin(gameId, userId, cardNumber);

    if (!result.valid) {
      // Emit rejection only to the claiming client
      client.emit(WS_EVENTS.INVALID_CLAIM, {
        userId,
        cardNumber,
        message: result.message,
      });
    }
    // If valid, endGame() inside claimWin() already broadcasts GAME_OVER to the room
  }

  /**
   * Client requests a fresh state snapshot without re-joining.
   * Payload: { gameId: string }
   */
  @SubscribeMessage(WS_EVENTS.REQUEST_STATE)
  async handleRequestState(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { gameId: string },
  ) {
    const state = await this.gameService.getCachedState(payload.gameId);
    if (state) {
      client.emit(WS_EVENTS.GAME_STATE, this.buildStatePayload(state));
    } else {
      client.emit(WS_EVENTS.ERROR, { message: 'Game state not found' });
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  Server → Room broadcasts  (called by GameService)
  // ─────────────────────────────────────────────────────────────

  /** Broadcast full state snapshot to everyone in the room */
  broadcastGameState(state: GameStateCache) {
    this.toRoom(state.gameId).emit(
      WS_EVENTS.GAME_STATE,
      this.buildStatePayload(state),
    );
  }

  /** Broadcast a phase change (CARD_SELECTION → COUNTDOWN → DRAWING → GAME_OVER) */
  broadcastPhaseChange(state: GameStateCache) {
    this.toRoom(state.gameId).emit(WS_EVENTS.PHASE_CHANGE, {
      gameId:             state.gameId,
      gameCode:           state.gameCode,
      phase:              state.phase,
      countdownSeconds:   state.countdownSeconds,
      countdownStartedAt: state.countdownStartedAt, // ← FE needs this to compute time remaining
      timestamp:          Date.now(),
    });
  }

  /** Broadcast a freshly drawn number */
  broadcastNumberDrawn(state: GameStateCache, drawnNumber: number) {
    this.toRoom(state.gameId).emit(WS_EVENTS.NUMBER_DRAWN, {
      gameId:        state.gameId,
      gameCode:      state.gameCode,
      phase:         state.phase,
      drawnNumber,
      allDrawn:      state.drawnNumbers,
      drawCount:     state.drawnNumbers.length,
      remaining:     75 - state.drawnNumbers.length,
      timestamp:     Date.now(),
    });
  }

  /** Broadcast game-over with winner info */
  broadcastGameOver(
    state: GameStateCache,
    winnerId: string | null,
    winningCardNumber: number | null,
  ) {
    this.toRoom(state.gameId).emit(WS_EVENTS.GAME_OVER, {
      gameId:            state.gameId,
      gameCode:          state.gameCode,
      phase:             state.phase,
      winnerId,
      winningCardNumber,
      totalDrawn:        state.drawnNumbers.length,
      drawnNumbers:      state.drawnNumbers,
      timestamp:         Date.now(),
    });
  }

  /** Broadcast that a card was just sold (so other clients grey it out) */
  broadcastTicketSold(
    gameId: string,
    gameCode: string,
    cardNumber: number,
    remainingCount: number,
  ) {
    this.toRoom(gameId).emit(WS_EVENTS.TICKET_SOLD, {
      gameId,
      gameCode,
      cardNumber,
      remainingCount,
      timestamp: Date.now(),
    });
  }

  /** Notify only the claiming client that their BINGO was invalid */
  broadcastInvalidClaim(gameId: string, userId: string, cardNumber: number) {
    // We emit to the whole room so admins can also see the failed claim
    this.toRoom(gameId).emit(WS_EVENTS.INVALID_CLAIM, {
      gameId,
      userId,
      cardNumber,
      timestamp: Date.now(),
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────────────────────

  private gameRoom(gameId: string): string {
    return `game:${gameId}`;
  }

  private toRoom(gameId: string) {
    return this.server.to(this.gameRoom(gameId));
  }

  /** Canonical state payload shape sent to clients */
  private buildStatePayload(state: GameStateCache) {
    return {
      gameId:              state.gameId,
      gameCode:            state.gameCode,
      phase:               state.phase,
      ticketPrice:         state.ticketPrice,
      winPattern:          state.winPattern,
      drawnNumbers:        state.drawnNumbers,
      currentDraw:         state.currentDraw,
      drawCount:           state.drawnNumbers.length,
      remaining:           75 - state.drawnNumbers.length,
      countdownSeconds:    state.countdownSeconds,
      drawIntervalSeconds: state.drawIntervalSeconds,
      soldCardNumbers:     state.soldCardNumbers,
      soldCount:           state.soldCardNumbers.length,
      availableCount:      600 - state.soldCardNumbers.length,
      timestamp:           Date.now(),
    };
  }
}
