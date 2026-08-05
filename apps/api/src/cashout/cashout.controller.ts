import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CashoutService } from './cashout.service';
import { CashoutStatus } from './schemas/cashout.schema';

@Controller('cashout')
export class CashoutController {
  constructor(private readonly cashoutService: CashoutService) {}

  /** POST /cashout/request — user requests a cashout */
  @Post('request')
  async requestCashout(
    @Body() body: { telegramId: string; amount: number; phoneNumber: string },
  ) {
    return this.cashoutService.requestCashout(
      body.telegramId,
      body.amount,
      body.phoneNumber,
    );
  }

  /** GET /cashout/mine?telegramId=xxx — user's own history */
  @Get('mine')
  async getMyCashouts(@Query('telegramId') telegramId: string) {
    return this.cashoutService.getMyCashouts(telegramId);
  }

  /** GET /cashout?status=PENDING — admin list (all or filtered) */
  @Get()
  async getAllCashouts(@Query('status') status?: CashoutStatus) {
    return this.cashoutService.getAllCashouts(status);
  }

  /** PATCH /cashout/:id/approve — admin approves */
  @Patch(':id/approve')
  async approve(
    @Param('id') id: string,
    @Body() body: { adminNote?: string; reviewedBy?: string },
  ) {
    return this.cashoutService.approveCashout(id, body.adminNote, body.reviewedBy);
  }

  /** PATCH /cashout/:id/reject — admin rejects + refunds */
  @Patch(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() body: { adminNote?: string; reviewedBy?: string },
  ) {
    return this.cashoutService.rejectCashout(id, body.adminNote, body.reviewedBy);
  }
}
