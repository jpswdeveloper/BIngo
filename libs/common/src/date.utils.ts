import {
  APP_TIMEZONE_OFFSET,
  DEFAULT_APP_TIMEZONE,
} from './timezone.constants';

export function getAppTimezone(): string {
  return process.env.APP_TIMEZONE ?? DEFAULT_APP_TIMEZONE;
}

export function applyProcessTimezone(): string {
  const timezone = getAppTimezone();
  process.env.TZ = timezone;
  return timezone;
}

const pad = (value: number): string => String(value).padStart(2, '0');

function getTimezoneOffset(date: Date, timeZone: string): string {
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const local = new Date(date.toLocaleString('en-US', { timeZone }));
  const offsetMinutes = (local.getTime() - utc.getTime()) / 60_000;
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;

  return `${sign}${pad(hours)}:${pad(minutes)}`;
}

function getDateParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00';

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

export function toAppTimezoneISO(date: Date, timeZone = getAppTimezone()): string {
  const { year, month, day, hour, minute, second } = getDateParts(date, timeZone);
  const offset = getTimezoneOffset(date, timeZone);

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
}

export function nowInAppTimezoneISO(timeZone = getAppTimezone()): string {
  return toAppTimezoneISO(new Date(), timeZone);
}

export function transformDates(value: unknown, timeZone = getAppTimezone()): unknown {
  if (value instanceof Date) {
    return toAppTimezoneISO(value, timeZone);
  }

  if (Array.isArray(value)) {
    return value.map((item) => transformDates(item, timeZone));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        transformDates(nested, timeZone),
      ]),
    );
  }

  return value;
}

export function getTimezoneMeta(timeZone = getAppTimezone()) {
  return {
    timezone: timeZone,
    offset: APP_TIMEZONE_OFFSET,
  };
}
