import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SettingsDocument = HydratedDocument<Settings>;

/** One tier in the dynamic rake table */
export class RakeTier {
  /** Minimum cards sold (inclusive) */
  minCards!: number;
  /** Maximum cards sold (inclusive). Use 9999 for "unlimited". */
  maxCards!: number;
  /** Percentage kept by admin e.g. 15 means 15% */
  rakePct!: number;
}

/**
 * Singleton document — only one Settings record ever exists.
 * Create with upsert, update with findOneAndUpdate.
 */
@Schema({ timestamps: true, collection: 'settings' })
export class Settings {
  /**
   * Rake tiers define what percentage of the prize pool goes to admin,
   * based on how many cards were sold in the game.
   *
   * Default tiers:
   *   1–50   cards → 10%
   *   51–100 cards → 15%
   *   101–300 cards → 20%
   *   301–600 cards → 25%
   */
  @Prop({
    type: [{ minCards: Number, maxCards: Number, rakePct: Number }],
    default: [
      { minCards: 1,   maxCards: 50,  rakePct: 10 },
      { minCards: 51,  maxCards: 100, rakePct: 15 },
      { minCards: 101, maxCards: 300, rakePct: 20 },
      { minCards: 301, maxCards: 600, rakePct: 25 },
    ],
  })
  rakeTiers!: RakeTier[];
}

export const SettingsSchema = SchemaFactory.createForClass(Settings);
