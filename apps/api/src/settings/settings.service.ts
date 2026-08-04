import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Settings, SettingsDocument, RakeTier } from './schemas/settings.schema';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectModel(Settings.name)
    private readonly settingsModel: Model<SettingsDocument>,
  ) {}

  /** Get the singleton settings document, creating it with defaults if missing */
  async getSettings(): Promise<SettingsDocument> {
    let settings = await this.settingsModel.findOne().exec();
    if (!settings) {
      this.logger.log('No settings document found — seeding defaults');
      settings = await this.settingsModel.create({});
    }
    return settings;
  }

  /** Replace the rake tiers array entirely */
  async updateRakeTiers(tiers: RakeTier[]): Promise<SettingsDocument> {
    // Validate: tiers should be sorted and non-overlapping
    const sorted = [...tiers].sort((a, b) => a.minCards - b.minCards);
    return this.settingsModel.findOneAndUpdate(
      {},
      { $set: { rakeTiers: sorted } },
      { new: true, upsert: true },
    ).exec() as Promise<SettingsDocument>;
  }

  /**
   * Look up the rake percentage for a given number of sold cards.
   * Falls back to 15% if no tier matches.
   */
  async getRakePct(soldCards: number): Promise<number> {
    const settings = await this.getSettings();
    const tier = settings.rakeTiers.find(
      (t) => soldCards >= t.minCards && soldCards <= t.maxCards,
    );
    if (!tier) {
      this.logger.warn(`No rake tier found for ${soldCards} sold cards — using 15% fallback`);
      return 15;
    }
    return tier.rakePct;
  }
}
