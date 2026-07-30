import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsService } from './payment.service';
import { PaymentIntent, PaymentIntentSchema } from './schema/payment.schema';
import {
  TransactionHistory,
  TransactionHistorySchema,
} from './schema/transaction.schema';
import { UsersModule } from '../users/users.module';
import { TelebirrScraperService } from './telebirr.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PaymentIntent.name, schema: PaymentIntentSchema },
      { name: TransactionHistory.name, schema: TransactionHistorySchema },
    ]),
    UsersModule,
  ],
  providers: [PaymentsService, TelebirrScraperService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
