import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DateInterceptor } from './date.interceptor';
import { DateService } from './date.service';

@Global()
@Module({
  providers: [
    DateService,
    {
      provide: APP_INTERCEPTOR,
      useClass: DateInterceptor,
    },
  ],
  exports: [DateService],
})
export class CommonModule {}
