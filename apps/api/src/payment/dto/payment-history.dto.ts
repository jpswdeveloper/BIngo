export class CreateDepositIntentDto {
  telegramId!: string;
  expectedAmount!: number;
  paymentMethod?: string;
  userId?: string;
}

export class SubmitReceiptDto {
  telegramId!: string;
  rawReceiptText!: string;
}
