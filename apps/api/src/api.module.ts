import { Module } from '@nestjs/common';
import { CommonModule } from '@app/common';
import { DatabaseModule } from '@app/database';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { HealthController } from './health.controller';
import { UsersModule } from './users/users.module';
import { PaymentsModule } from './payment/payment.module';
import { WalletModule } from './wallet/wallet.module';
import { RoleModule } from './role/role.module';
import { CardsModule } from './cards/cards.module';
import { TicketsModule } from './tickets/tickets.module';
import { TelegramModule } from './telegram/telegram.module';
import { AdminsModule } from './admins/admins.module';
import { SettingsModule } from './settings/settings.module';
import { AuditModule } from './audit/audit.module';
import { RedisModule } from './redis/redis.module';
import { SocketModule } from './socket/socket.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    CommonModule,
    DatabaseModule,
    UsersModule,
    PaymentsModule,
    WalletModule,
    RoleModule,
    CardsModule,
    TicketsModule,
    TelegramModule,
    AdminsModule,
    SettingsModule,
    AuditModule,
    RedisModule,
    SocketModule,
    AuthModule,
  ],
  controllers: [ApiController, HealthController],
  providers: [ApiService],
})
export class ApiModule {}
