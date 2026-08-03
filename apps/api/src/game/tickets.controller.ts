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
    const ticket = await this.ticketsService.buyTicket(body.telegramId, body.cardNumber);
    return {
      success: true,
      ticket: {
        id: ticket._id.toString(),
        gameId: ticket.gameId.toString(),
        cardNumber: ticket.cardNumber,
        pricePaid: ticket.pricePaid,
        telegramId: ticket.telegramId,
      },
    };
  }

  /**
   * POST /tickets/buy-batch
   * Purchase multiple cards at once in the active game.
   * Body: { telegramId: string; cardNumbers: number[] }
   */
  @Post('buy-batch')
  async buyTicketBatch(
    @Body() body: { telegramId: string; cardNumbers: number[] },
  ) {
    const tickets = await this.ticketsService.buyTicketBatch(body.telegramId, body.cardNumbers);
    return {
      success: true,
      tickets: tickets.map((ticket) => ({
        id: ticket._id.toString(),
        gameId: ticket.gameId.toString(),
        cardNumber: ticket.cardNumber,
        pricePaid: ticket.pricePaid,
        telegramId: ticket.telegramId,
      })),
    };
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
   * GET /tickets/mine?telegramId=xxx
   * ALL tickets the user holds in the current active game (array).
   */
  @Get('mine')
  async getMyTickets(@Query('telegramId') telegramId: string) {
    const tickets = await this.ticketsService.getMyTicketsInActiveGame(telegramId);
    return tickets.map((t) => ({
      id: t._id.toString(),
      gameId: t.gameId.toString(),
      cardNumber: t.cardNumber,
      pricePaid: t.pricePaid,
      telegramId: t.telegramId,
      isWinner: t.isWinner,
    }));
  }

  /**
   * GET /tickets/me?telegramId=xxx
   * First ticket the user holds (backward compat).
   */
  @Get('me')
  async getMyTicket(@Query('telegramId') telegramId: string) {
    const ticket = await this.ticketsService.getMyTicketInActiveGame(telegramId);
    if (!ticket) return null;
    return {
      id: ticket._id.toString(),
      gameId: ticket.gameId.toString(),
      cardNumber: ticket.cardNumber,
      pricePaid: ticket.pricePaid,
      telegramId: ticket.telegramId,
      isWinner: ticket.isWinner,
    };
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
