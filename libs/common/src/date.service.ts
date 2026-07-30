import { Injectable } from '@nestjs/common';
import {
  getAppTimezone,
  getTimezoneMeta,
  nowInAppTimezoneISO,
  toAppTimezoneISO,
  transformDates,
} from './date.utils';

@Injectable()
export class DateService {
  getTimezone(): string {
    return getAppTimezone();
  }

  getMeta() {
    return getTimezoneMeta();
  }

  now(): Date {
    const now = new Date();
    now.setHours(now.getHours() + 3);
    return now;
  }

  nowISO(): string {
    return nowInAppTimezoneISO();
  }

  toISO(date: Date): string {
    return toAppTimezoneISO(date);
  }

  transform<T>(value: T): T {
    return transformDates(value) as T;
  }
}
