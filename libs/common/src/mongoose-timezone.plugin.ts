import { Schema } from 'mongoose';
import { toAppTimezoneISO, transformDates } from './date.utils';

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

  // Before saving a document, convert any Date instances to timezone-aware ISO strings
  schema.pre('save', async function () {
    try {
      const doc: Record<string, unknown> = this.toObject({ depopulate: true });
      const transformed = transformDates(doc) as Record<string, unknown>;

      for (const [key, value] of Object.entries(transformed)) {
        // only set if value differs to avoid extra changes
        if ((this as any)[key] !== value) {
          (this as any)[key] = value;
        }
      }
    } catch (err) {
      // ignore transformation errors and proceed with save
    }
  });

  // Before findOneAndUpdate, transform any Date values in the update payload
  schema.pre('findOneAndUpdate', async function () {
    try {
      const update = this.getUpdate();
      if (update) {
        const transformed = transformDates(update) as typeof update;
        this.setUpdate(transformed);
      }
    } catch (err) {
      // ignore
    }
  });
}
