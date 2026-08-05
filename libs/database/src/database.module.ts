import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import * as path from 'path';
import { mongooseTimezonePlugin } from '@app/common';
import { RedisModule } from './redis.module';

mongoose.plugin(mongooseTimezonePlugin);

// process.cwd() is always the directory where `node` was launched (project root)
// __dirname is unreliable in webpack bundles (set to '/' by default)
const projectRoot = process.cwd();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.join(projectRoot, '.env.local'),
        path.join(projectRoot, '.env'),
      ],
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    RedisModule.forRootAsync(),
  ],
  exports: [MongooseModule, RedisModule],
})
export class DatabaseModule {}
