import './timezone.bootstrap';

// Fix node-telegram-bot-api deprecation warning
process.env.NTBA_FIX_319 = '1';

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ApiModule } from './api.module';

async function bootstrap() {
  const app = await NestFactory.create(ApiModule);
  const config = app.get(ConfigService);

  // Enable shutdown hooks so OnModuleDestroy is called
  app.enableShutdownHooks();

  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'bypass-tunnel-reminder',
      'ngrok-skip-browser-warning',
    ],
  });
  const port = config.get<number>('PORT', 3000);

  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);
}

bootstrap();
