import { Body, Controller, Get, Put } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { RakeTier } from './schemas/settings.schema';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('rake-tiers')
  async getRakeTiers() {
    const settings = await this.settingsService.getSettings();
    return { rakeTiers: settings.rakeTiers };
  }

  @Put('rake-tiers')
  async updateRakeTiers(@Body() body: { rakeTiers: RakeTier[] }) {
    const updated = await this.settingsService.updateRakeTiers(body.rakeTiers);
    return { rakeTiers: updated.rakeTiers };
  }
}
