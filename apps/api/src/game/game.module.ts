import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Game, GameSchema } from './schemas/game.schema';
import { Ticket, TicketSchema } from './schemas/ticket.schema';
import { GameService } from './game.service';
import { TicketsService } from './tickets.service';
import { GameController } from './game.controller';
import { TicketsController } from './tickets.controller';
import { CardsModule } from '../cards/cards.module';
import { UsersModule } from '../users/users.module';
import { SocketModule } from '../socket/socket.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Game.name, schema: GameSchema },
      { name: Ticket.name, schema: TicketSchema },
    ]),
    CardsModule,
    UsersModule,
    forwardRef(() => SocketModule),
  ],
  controllers: [GameController, TicketsController],
  providers: [GameService, TicketsService],
  exports: [GameService, TicketsService],
})
export class GameModule {}
