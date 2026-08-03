import {
  Controller,
  Get,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * GET /users/me?telegramId=123456789
   * Returns the user profile and wallet balance.
   * Called by the WebApp on every page load to hydrate the UI.
   */
  @Get('me')
  async getMe(@Query('telegramId') telegramId: string) {
    if (!telegramId) {
      throw new NotFoundException('telegramId query param is required.');
    }

    const user = await this.usersService.findByTelegramId(telegramId);
    if (!user) {
      throw new NotFoundException(
        `No user found for telegramId ${telegramId}. Please /start the bot first.`,
      );
    }

    return {
      id: user._id.toString(),
      telegramId: user.telegramId,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      phoneNumber: user.phoneNumber,
      walletBalance: user.walletBalance,
      isVerified: user.isVerified,
      isBlocked: user.isBlocked,
      referralCode: user.referralCode,
      role: user.role,
    };
  }
}
