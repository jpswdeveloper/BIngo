import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { UsersModule } from '../users/users.module';
import { PaymentsModule } from '../payment/payment.module';

@Module({
  imports: [UsersModule, PaymentsModule],
  providers: [TelegramService],
  controllers: [TelegramController],
})
export class TelegramModule {}
