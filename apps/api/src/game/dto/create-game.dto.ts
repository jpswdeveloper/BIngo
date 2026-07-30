import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { WinPattern } from '../enums/win-pattern.enum';

export class CreateGameDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  ticketPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(300)
  countdownSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(30)
  drawIntervalSeconds?: number;

  @IsOptional()
  @IsEnum(WinPattern)
  winPattern?: WinPattern;
}
