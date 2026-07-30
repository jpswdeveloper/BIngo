import { forwardRef, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { UsersModule } from '../users/users.module';
import { PaymentsModule } from '../payment/payment.module';
import { GameModule } from '../game/game.module';

@Module({
  imports: [
    UsersModule,
    PaymentsModule,
    forwardRef(() => GameModule),
  ],
  providers: [TelegramService],
  controllers: [TelegramController],
})
export class TelegramModule {}
