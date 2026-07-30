import './timezone.bootstrap';

import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ApiModule } from './api.module';

async function bootstrap() {
  const app = await NestFactory.create(ApiModule);
  const config = app.get(ConfigService);

  app.enableCors()
  const port = config.get<number>('PORT', 3000);

  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);
}

bootstrap();
