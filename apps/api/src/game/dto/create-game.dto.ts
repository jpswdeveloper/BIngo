import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { WinPattern } from '../enums/win-pattern.enum';

export class CreateGameDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  ticketPrice?: number;

  /** Seconds players have to purchase cards (CARD_SELECTION phase) */
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(300)
  purchasingSeconds?: number;

  /** Seconds between purchasing ending and first draw (COUNTDOWN phase) */
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  countdownSeconds?: number;

  /** Seconds between each number draw (DRAWING phase) */
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(30)
  drawIntervalSeconds?: number;

  @IsOptional()
  @IsEnum(WinPattern)
  winPattern?: WinPattern;
}
