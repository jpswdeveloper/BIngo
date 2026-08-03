import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { GameService } from './game.service';
import { CreateGameDto } from './dto/create-game.dto';

@Controller('games')
export class GameController {
  constructor(private readonly gameService: GameService) {}

  /**
   * POST /games/join
   * Called by the frontend when a user clicks a stake.
   * - If no active game exists for that ticketPrice, creates one
   * - If a game already exists (any phase), returns it
   * Returns: { gameId, gameCode, phase, ticketPrice }
   */
  @Post('join')
  @HttpCode(HttpStatus.OK)
  async joinOrCreate(
    @Body() body: { ticketPrice: number; adminId?: string },
  ) {
    const adminId = body.adminId ?? 'system';
    return this.gameService.joinOrCreateGame(body.ticketPrice, adminId);
  }

  /**
   * POST /games
   * Create a new game in CARD_SELECTION phase.
   */
  @Post()
  async createGame(
    @Body() dto: CreateGameDto,
    @Query('adminId') adminId: string,
  ) {
    return this.gameService.createGame(dto, adminId);
  }

  /**
   * GET /games/active
   * Returns the current game state from Redis (or DB fallback).
   */
  @Get('active')
  async getActiveGame() {
    const state = await this.gameService.getActiveGame();
    if (!state) return { message: 'No active game.' };
    return state;
  }

  /**
   * GET /games/history?limit=20&skip=0
   * Paginated list of completed games.
   */
  @Get('history')
  async getHistory(
    @Query('limit') limit = '20',
    @Query('skip') skip = '0',
  ) {
    return this.gameService.getGameHistory(
      parseInt(limit, 10) || 20,
      parseInt(skip, 10) || 0,
    );
  }

  /**
   * GET /games/:id
   * Full game document from DB.
   */
  @Get(':id')
  async getGame(@Param('id') id: string) {
    return this.gameService.getGameById(id);
  }

  /**
   * POST /games/:id/countdown
   * Transition CARD_SELECTION → COUNTDOWN.
   */
  @Post(':id/countdown')
  @HttpCode(HttpStatus.OK)
  async startCountdown(@Param('id') id: string) {
    return this.gameService.startCountdown(id);
  }

  /**
   * POST /games/:id/draw
   * Manually advance COUNTDOWN → DRAWING (skips remaining countdown).
   */
  @Post(':id/draw')
  @HttpCode(HttpStatus.OK)
  async startDrawing(@Param('id') id: string) {
    return this.gameService.startDrawing(id);
  }

  /**
   * POST /games/:id/end
   * Force-end a game without a winner (admin use).
   */
  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  async endGame(@Param('id') id: string) {
    return this.gameService.endGame(id, null, null);
  }
}
