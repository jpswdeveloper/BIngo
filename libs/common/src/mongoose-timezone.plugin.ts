/**
 * Mongoose timezone plugin — Africa/Nairobi (UTC+3, no DST)
 *
 * Transforms Date fields to GMT+3 ISO strings ONLY on output (toJSON / toObject).
 * Dates are stored in MongoDB as native BSON Date (UTC) — do NOT mutate them
 * before save, or sort/range queries will break.
 */
import { Schema } from 'mongoose';
import { toAppTimezoneISO } from './date.utils';

function transformDocument(_doc: unknown, ret: Record<string, unknown>) {
  for (const [key, value] of Object.entries(ret)) {
    if (value instanceof Date) {
      ret[key] = toAppTimezoneISO(value);
    }
  }
  return ret;
}

export function mongooseTimezonePlugin(schema: Schema): void {
  schema.set('toJSON', {
    transform: transformDocument,
    virtuals: true,
  });

  schema.set('toObject', {
    transform: transformDocument,
    virtuals: true,
  });
  // No pre-save hook — dates must stay as BSON Date in MongoDB.
}
