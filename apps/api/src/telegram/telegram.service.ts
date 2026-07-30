import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { ConfigService } from '@nestjs/config';
import { DateService } from '@app/common';
import TelegramBot, { Message } from 'node-telegram-bot-api';
import { TelegramAuthDTO } from './DTO/telegram.dto';
import { PaymentsService } from '../payment/payment.service';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot!: TelegramBot;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly dateService: DateService,
    private readonly paymentsService: PaymentsService,
  ) {}

  onModuleInit() {
    const telegramBotToken =
      this.configService.get<string>('TELEGRAM_BOT_TOKEN') || '';

    this.bot = new TelegramBot(telegramBotToken, { polling: true });

    this.telegramBotHandler();
    // Register commands with Telegram so users see them in the [/] menu
    this.registerBotMenuCommands();
    this.logger.log('Telegram Bot initialized with polling.');
  }

  onModuleDestroy() {
    if (this.bot) {
      this.bot.stopPolling();
    }
  }

  /**
   * Sets up the Telegram native [/] command menu
   */
  private async registerBotMenuCommands() {
    try {
      await this.bot.setMyCommands([
        { command: 'start', description: 'Start the bot / Open main menu 🚀' },
        { command: 'register', description: 'Register phone number 📝' },
        { command: 'deposit', description: 'Deposit funds to wallet 💵' },
        { command: 'balance', description: 'Check wallet balance 💰' },
        { command: 'play', description: 'Play games 🎮' },
        { command: 'transfer', description: 'Transfer funds 🎁' },
        { command: 'help', description: 'How to use the bot 📖' },
      ]);
      this.logger.log('Telegram bot menu commands registered successfully.');
    } catch (error) {
      this.logger.error('Failed to set bot menu commands:', error);
    }
  }
  private telegramBotHandler() {
    // Listen for /start command
    this.bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
      const referralCode = match?.[1]?.trim();
      await this.handleStart(msg, referralCode);
    });

    // Event listener for /register command or button press
    this.bot.onText(/\/register|Register 📝/, async (msg) => {
      await this.promptContactSharing(msg);
    });

    this.bot.onText(/\/deposit|Deposit 💵/, async (msg) => {
      await this.promptDepositAmount(msg);
    });

    this.bot.onText(/\/balance|Check Balance 💵/, async (msg) => {
      await this.bot.sendMessage(
        msg.chat.id,
        '💵 Balance check feature is under development. Stay tuned!',
      );
    });

    this.bot.onText(/\/play|Play 🎮/, async (msg) => {
      await this.bot.sendMessage(
        msg.chat.id,
        '🎮 Game feature is under development. Stay tuned!',
      );
    });

    this.bot.onText(/\/transfer|Transfer 🎁/, async (msg) => {
      await this.bot.sendMessage(
        msg.chat.id,
        '🎁 Transfer feature is under development. Stay tuned!',
      );
    });

    this.bot.onText(/\/help/, async (msg) => {
      await this.sendMainMenu(msg.chat.id, '📖 Here are the available commands and menu options:');
    });

    // Listen for shared contact payload
    this.bot.on('contact', async (msg) => {
      await this.registerTelegramUser(msg);
    });

    // Main message handler
    this.bot.on('message', async (msg) => {
      if (!msg.text) return;

      const text = msg.text.trim();
      const chatId = msg.chat.id;

      this.logger.log(
        `Received message from ${msg.from?.username || msg.from?.id}: ${text}`,
      );

      // Handle Keyboard Buttons only. Slash commands are handled by onText() above.
      if (text === 'Play 🎮') {
        await this.bot.sendMessage(
          chatId,
          '🎮 Game feature is under development. Stay tuned!',
        );
        return;
      }

      if (text === 'Check Balance 💵') {
        await this.bot.sendMessage(
          chatId,
          '💵 Balance check feature is under development. Stay tuned!',
        );
        return;
      }

      if (text === 'Deposit 💵') {
        await this.bot.sendMessage(
          chatId,
          '💰 ማስገባት የሚፈልጉትን መጠን ከ10 ብር ጀምሮ ያስገቡ።',
          { reply_markup: { force_reply: true } },
        );
        return;
      }

      if (text === 'Contact Support ☎️') {
        await this.bot.sendMessage(
          chatId,
          '☎️ Contact support feature is under development. Stay tuned!',
        );
        return;
      }

      if (text === 'Instruction 📖') {
        await this.bot.sendMessage(
          chatId,
          '📖 Instruction feature is under development. Stay tuned!',
        );
        return;
      }

      if (text === 'Transfer 🎁') {
        await this.bot.sendMessage(
          chatId,
          '🎁 Transfer feature is under development. Stay tuned!',
        );
        return;
      }

      if (text.startsWith('/')) return;

      // Check if user entered deposit amount
      const isNumericAmount = /^\d+(?:\.\d{1,2})?$/.test(text);

      if (isNumericAmount) {
        const amount = parseFloat(text);

        if (amount < 10) {
          await this.bot.sendMessage(
            chatId,
            '⚠️ አነስተኛው የማስገቢያ መጠን 10 ብር ነው። እባክዎ ከ10 ብር በላይ ያስገቡ።',
          );
        } else {
          await this.paymentsService.createDepositIntent({
            telegramId: msg.from!.id.toString(),
            expectedAmount: amount,
            paymentMethod: 'Telebirr',
          });

          await this.bot.sendMessage(
            chatId,
            `💵 እባክዎን **${amount} ብር** ወደዚህ ቁጥር በ Telebirr ያስገቡ:\n\n` +
              `📱 **+251911111111**\n\n` +
              `ክፍያውን እንደጨረሱ የተላከዎትን **SMS ደረሰኝ** ኮፒ አድርገው እዚህ ይላኩ::`,
            { parse_mode: 'Markdown' },
          );
        }
      } else if (
        text.includes('transferred') ||
        text.includes('Transaction ID') ||
        text.includes('transactioninfo.ethiotelecom.et') ||
        text.includes('DGN') ||
        text.includes('Telebirr') ||
        text.includes('ብር')
      ) {
        await this.processDepositReceipt(msg);
      }
    });
  }

  private async promptDepositAmount(msg: Message) {
    await this.bot.sendMessage(
      msg.chat.id,
      '💰 ማስገባት የሚፈልጉትን መጠን ከ10 ብር ጀምሮ ያስገቡ።',
      { reply_markup: { force_reply: true } },
    );
  }
  private async handleStart(msg: Message, referralCode?: string) {
    if (!msg.from) return;

    const telUser = this.buildAuthDto(msg);
    const user = await this.usersService.findOrCreateFromTelegram(telUser);

    await this.sendMainMenu(
      msg.chat.id,
      `👋 Welcome ${user.firstName}! Choose an Option below.`,
    );
  }

  async registerTelegramUser(msg: Message) {
    const contact = msg.contact;
    if (!contact || !msg.from) return;

    if (contact.user_id !== msg.from.id) {
      await this.bot.sendMessage(
        msg.chat.id,
        '⚠️ እባክዎ የእርስዎን የራሶት ስልክ ቁጥር ብቻ ያጋሩ::',
      );
      return;
    }

    const telUser: TelegramAuthDTO = this.buildAuthDto(msg);
    const user = await this.usersService.findOrCreateFromTelegram(telUser);

    const updatedUser = await this.usersService.updatePhoneNumber(
      user._id.toString(),
      contact.phone_number,
    );

    await this.sendMainMenu(
      msg.chat.id,
      `ምዝገባዎ ተጠናቋል። መልካም እድል ${updatedUser.firstName}!`,
    );
  }

  async promptContactSharing(msg: Message) {
    await this.bot.sendMessage(
      msg.chat.id,
      '📱 ምዝገባውን ለመጨረስ ፡ "📞 Share contact" የሚለውን ይጫኑ::',
      {
        reply_markup: {
          keyboard: [
            [
              {
                text: '📞 Share contact',
                request_contact: true,
              },
            ],
          ],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      },
    );
  }

  private async sendMainMenu(chatId: number, text: string) {
    await this.bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          [{ text: 'Play 🎮' }, { text: 'Register 📝' }],
          [{ text: 'Check Balance 💵' }, { text: 'Deposit 💵' }],
          [{ text: 'Contact Support ☎️' }, { text: 'Instruction 📖' }],
          [{ text: 'Transfer 🎁' }, { text: 'Withdraw 🤑' }],
          [{ text: 'Invite 🔗' }, { text: 'Convert Bonus 🔀' }],
        ],
        resize_keyboard: true,
      },
    });
  }

  private buildAuthDto(msg: Message): TelegramAuthDTO {
    const msgFrom = msg.from;
    return {
      id: msgFrom?.id.toString() || '',
      firstName: msgFrom?.first_name || '',
      lastName: msgFrom?.last_name,
      username: msgFrom?.username,
      authDate: Math.floor(Date.now() / 1000).toString(),
      hash: '',
    };
  }

  private async processDepositReceipt(msg: Message) {
    const text = msg.text || '';
    const telegramId = msg.from?.id.toString();

    if (!telegramId || !text) return;

    try {
      const result = await this.paymentsService.processReceipt(
        telegramId,
        text,
      );

      await this.bot.sendMessage(msg.chat.id, result.message, {
        parse_mode: 'Markdown',
      });
    } catch (error) {
      this.logger.error(
        `Error processing deposit for Telegram user ${telegramId}:`,
        error,
      );

      const errorMessage =
        error instanceof ConflictException
          ? error.message
          : '⚠️ ክፍያውን በማስኬድ ላይ ስህተት ተፈጥሯል። እባክዎ ትንሽ ቆይተው እንደገና ይሞክሩ።';

      await this.bot.sendMessage(msg.chat.id, errorMessage);
    }
  }
}
