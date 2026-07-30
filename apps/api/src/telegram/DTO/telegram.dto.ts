import { IsNotEmpty, IsString } from 'class-validator';

export class TelegramAuthDTO {
  @IsString()
  @IsNotEmpty()
  readonly id!: string;

  @IsString()
  firstName!: string;

  username?: string;

  lastName?: string;

  @IsString()
  authDate!: string;
  @IsString()
  hash!: string;
}
