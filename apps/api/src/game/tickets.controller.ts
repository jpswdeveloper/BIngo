import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { TicketsService } from './tickets.service';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  /**
   * POST /tickets/buy
   * Purchase a card in the active game.
   * Body: { telegramId: string; cardNumber: number }
   */
  @Post('buy')
  async buyTicket(
    @Body() body: { telegramId: string; cardNumber: number },
  ) {
    return this.ticketsService.buyTicket(body.telegramId, body.cardNumber);
  }

  /**
   * GET /tickets/available
   * Returns which card numbers are still on sale in the active game.
   */
  @Get('available')
  async getAvailableCards() {
    return this.ticketsService.getAvailableCards();
  }

  /**
   * GET /tickets/available/:cardNumber
   * Check if a specific card is still available.
   */
  @Get('available/:cardNumber')
  async isCardAvailable(@Param('cardNumber', ParseIntPipe) cardNumber: number) {
    const available = await this.ticketsService.isCardAvailable(cardNumber);
    return { cardNumber, available };
  }

  /**
   * GET /tickets/me?telegramId=xxx
   * The ticket (if any) the user holds in the current active game.
   */
  @Get('me')
  async getMyTicket(@Query('telegramId') telegramId: string) {
    return this.ticketsService.getMyTicketInActiveGame(telegramId);
  }

  /**
   * GET /tickets/game/:gameId
   * All tickets for a specific game.
   */
  @Get('game/:gameId')
  async getTicketsForGame(
    @Param('gameId') gameId: string,
    @Query('userId') userId?: string,
  ) {
    return this.ticketsService.getTicketsForGame(gameId, userId);
  }

  /**
   * GET /tickets/user/:userId/history?limit=20&skip=0
   * Full ticket history for a user across all games.
   */
  @Get('user/:userId/history')
  async getUserHistory(
    @Param('userId') userId: string,
    @Query('limit') limit = '20',
    @Query('skip') skip = '0',
  ) {
    return this.ticketsService.getUserTicketHistory(
      userId,
      parseInt(limit, 10) || 20,
      parseInt(skip, 10) || 0,
    );
  }
}
