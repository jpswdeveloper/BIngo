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

  /** Returns the current UTC Date. Store dates as UTC; display via toISO() which renders GMT+3. */
  now(): Date {
    return new Date();
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
