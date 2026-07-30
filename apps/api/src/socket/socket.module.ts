import { forwardRef, Module } from '@nestjs/common';
import { BingoGateway } from './bingo.gateway';
import { GameModule } from '../game/game.module';

@Module({
  imports: [forwardRef(() => GameModule)],
  providers: [BingoGateway],
  exports: [BingoGateway],
})
export class SocketModule {}
