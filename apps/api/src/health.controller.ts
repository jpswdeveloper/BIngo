import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { DateService } from '@app/common';
import { RedisService } from '@app/database';

@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    private readonly redisService: RedisService,
    private readonly dateService: DateService,
  ) {}

  @Get()
  async check() {
    const mongoState = this.mongoConnection.readyState;
    const redisPing = await this.redisService.ping();

    return {
      status: 'ok',
      timestamp: this.dateService.nowISO(),
      timezone: this.dateService.getMeta(),
      services: {
        mongodb: mongoState === 1 ? 'connected' : 'disconnected',
        redis: redisPing === 'PONG' ? 'connected' : 'disconnected',
      },
    };
  }
}
