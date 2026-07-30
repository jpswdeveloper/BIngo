import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { DateService } from './date.service';

@Injectable()
export class DateInterceptor implements NestInterceptor {
  constructor(private readonly dateService: DateService) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        if (data === undefined) {
          return data;
        }

        return this.dateService.transform(data);
      }),
    );
  }
}
