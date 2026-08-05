import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CashoutRequest, CashoutSchema } from './schemas/cashout.schema';
import { CashoutService } from './cashout.service';
import { CashoutController } from './cashout.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CashoutRequest.name, schema: CashoutSchema },
    ]),
    UsersModule,
  ],
  controllers: [CashoutController],
  providers: [CashoutService],
  exports: [CashoutService],
})
export class CashoutModule {}
