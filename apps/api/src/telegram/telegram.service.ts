import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { UsersService } from "../users/users.service";
import { ConfigService } from "@nestjs/config";
import { DateService } from "@app/common";
import TelegramBot, { Message } from "node-telegram-bot-api";
import { TelegramAuthDTO } from "./DTO/telegram.dto";
import { PaymentsService } from "../payment/payment.service";
import { GameService } from "../game/game.service";
import { GamePhase } from "../game/enums/game-phase.enum";

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot!: TelegramBot;
  private webAppUrl!: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly dateService: DateService,
    private readonly paymentsService: PaymentsService,
    @Inject(forwardRef(() => GameService))
    private readonly gameService: GameService,
  ) {}

  onModuleInit() {
    const token = this.configService.get<string>("TELEGRAM_BOT_TOKEN") || "";
    this.webAppUrl = this.configService.get<string>("WEBAPP_URL") || "";
    this.bot = new TelegramBot(token, { polling: true });

    this.telegramBotHandler();
    this.registerBotMenuCommands();
    this.logger.log("Telegram Bot initialized with polling.");
  }

  async onModuleDestroy() {
    if (this.bot) await this.bot.stopPolling();
  }

  // ─────────────────────────────────────────────────────────────
  //  Bot menu commands
  // ─────────────────────────────────────────────────────────────

  private async registerBotMenuCommands() {
    try {
      await this.bot.setMyCommands([
        { command: "start", description: "Start the bot / Open main menu 🚀" },
        { command: "play", description: "Open the Bingo game 🎮" },
        { command: "register", description: "Register phone number 📝" },
        { command: "deposit", description: "Deposit funds to wallet 💵" },
        { command: "balance", description: "Check wallet balance 💰" },
        { command: "transfer", description: "Transfer funds 🎁" },
        { command: "help", description: "How to use the bot 📖" },
      ]);
      this.logger.log("Bot menu commands registered.");
    } catch (err) {
      this.logger.error("Failed to set bot menu commands:", err);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  All handlers
  // ─────────────────────────────────────────────────────────────

  private telegramBotHandler() {
    this.bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
      await this.handleStart(msg, match?.[1]?.trim());
    });

    this.bot.onText(/\/register|Register 📝/, async (msg) => {
      await this.promptContactSharing(msg);
    });

    this.bot.onText(/\/deposit|Deposit 💵/, async (msg) => {
      await this.promptDepositAmount(msg);
    });

    this.bot.onText(/\/balance|Check Balance 💵/, async (msg) => {
      await this.handleBalance(msg);
    });

    // ── /play and "Play 🎮" button ──────────────────────────────
    this.bot.onText(/\/play|Play 🎮/, async (msg) => {
      await this.handlePlay(msg);
    });

    this.bot.onText(/\/transfer|Transfer 🎁/, async (msg) => {
      await this.bot.sendMessage(
        msg.chat.id,
        "🎁 Transfer feature is coming soon. Stay tuned!",
      );
    });

    this.bot.onText(/\/help/, async (msg) => {
      await this.sendMainMenu(
        msg.chat.id,
        "📖 Here are the available commands:",
      );
    });

    this.bot.on("contact", async (msg) => {
      await this.registerTelegramUser(msg);
    });

    this.bot.on("message", async (msg) => {
      if (!msg.text) return;
      const text = msg.text.trim();
      const chatId = msg.chat.id;

      this.logger.log(
        `Message from ${msg.from?.username ?? msg.from?.id}: ${text}`,
      );

      if (text === "Check Balance 💵") {
        await this.handleBalance(msg);
        return;
      }
      if (text === "Deposit 💵") {
        await this.promptDepositAmount(msg);
        return;
      }
      if (text === "Contact Support ☎️") {
        await this.bot.sendMessage(
          chatId,
          "☎️ Contact support is coming soon!",
        );
        return;
      }
      if (text === "Instruction 📖") {
        await this.bot.sendMessage(
          chatId,
          "📖 Instructions feature coming soon!",
        );
        return;
      }
      if (text === "Transfer 🎁") {
        await this.bot.sendMessage(chatId, "🎁 Transfer feature coming soon!");
        return;
      }
      if (text.startsWith("/")) return;

      // Numeric → deposit flow
      const isAmount = /^\d+(?:\.\d{1,2})?$/.test(text);
      if (isAmount) {
        await this.handleDepositAmount(msg, parseFloat(text));
        return;
      }

      // Telebirr receipt
      if (
        text.includes("transferred") ||
        text.includes("Transaction ID") ||
        text.includes("transactioninfo.ethiotelecom.et") ||
        text.includes("DGN") ||
        text.includes("Telebirr") ||
        text.includes("ብር")
      ) {
        await this.processDepositReceipt(msg);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  /play handler — the key integration
  // ─────────────────────────────────────────────────────────────

  private async handlePlay(msg: Message) {
    const chatId = msg.chat.id;
    console.log("Web APP URL:", this.webAppUrl);

    if (!this.webAppUrl || !this.webAppUrl.startsWith("https://")) {
      await this.bot.sendMessage(
        chatId,
        "⚠️ Game web app is not configured yet\\. Please check back soon\\!",
        { parse_mode: "MarkdownV2" },
      );
      this.logger.warn(
        `WEBAPP_URL is not set or not HTTPS ("${this.webAppUrl}"). /play button skipped.`,
      );
      return;
    }

    // Fetch the active game state
    const gameState = await this.gameService.getActiveGame().catch(() => null);

    if (!gameState) {
      // No active game — still show the button but with a note
      await this.bot.sendMessage(
        chatId,
        [
          "🎮 *BIngo Game*",
          "",
          "No game is running right now\\.",
          "Open the app to check back soon — a new game will start shortly\\!",
        ].join("\n"),
        {
          parse_mode: "MarkdownV2",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🎮 Open BIngo",
                  // web_app: { url: this.webAppUrl },
                  web_app: { url: "https://lovely-laws-wish.loca.lt" },
                },
              ],
            ],
          },
        },
      );
      return;
    }

    // Build a status line depending on the phase
    const phaseLines: Record<GamePhase, string> = {
      [GamePhase.CARD_SELECTION]: `🟢 *Card Selection Open* — Pick your card now\\!`,
      [GamePhase.COUNTDOWN]: `⏳ *Starting Soon* — Countdown in progress\\!`,
      [GamePhase.DRAWING]: `🔴 *LIVE* — Numbers are being drawn\\!`,
      [GamePhase.GAME_OVER]: `🏁 *Game Over* — Next game coming soon\\!`,
    };

    const soldPct = Math.round((gameState.soldCardNumbers.length / 600) * 100);

    const lines = [
      `🎮 *BIngo — ${this.escapeMarkdown(gameState.gameCode)}*`,
      "",
      phaseLines[gameState.phase],
      "",
      `🎫 Ticket price: *${gameState.ticketPrice} ETB*`,
      `👥 Players: *${gameState.soldCardNumbers.length}* \\(${soldPct}% cards sold\\)`,
      `🏆 Win condition: *${this.escapeMarkdown(gameState.winPattern.replace("_", " "))}*`,
    ];

    if (gameState.phase === GamePhase.DRAWING) {
      lines.push(
        "",
        `🎱 Numbers drawn: *${gameState.drawnNumbers.length} / 75*`,
        gameState.currentDraw
          ? `🔔 Last drawn: *${gameState.currentDraw}*`
          : "",
      );
    }

    await this.bot.sendMessage(chatId, lines.filter(Boolean).join("\n"), {
      parse_mode: "MarkdownV2",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: this.getPlayButtonLabel(gameState.phase),
              web_app: { url: this.webAppUrl },
            },
          ],
        ],
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  Balance handler
  // ─────────────────────────────────────────────────────────────

  private async handleBalance(msg: Message) {
    if (!msg.from) return;
    const user = await this.usersService
      .findByTelegramId(msg.from.id.toString())
      .catch(() => null);

    if (!user) {
      await this.bot.sendMessage(
        msg.chat.id,
        "⚠️ User not found\\. Please /start first\\.",
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    await this.bot.sendMessage(
      msg.chat.id,
      `💰 Your wallet balance: *${user.walletBalance} ETB*`,
      { parse_mode: "MarkdownV2" },
    );
  }

  // ─────────────────────────────────────────────────────────────
  //  Deposit helpers
  // ─────────────────────────────────────────────────────────────

  private async promptDepositAmount(msg: Message) {
    await this.bot.sendMessage(
      msg.chat.id,
      "💰 ማስገባት የሚፈልጉትን መጠን ከ10 ብር ጀምሮ ያስገቡ።",
      { reply_markup: { force_reply: true } },
    );
  }

  private async handleDepositAmount(msg: Message, amount: number) {
    const chatId = msg.chat.id;
    if (amount < 10) {
      await this.bot.sendMessage(
        chatId,
        "⚠️ አነስተኛው የማስገቢያ መጠን 10 ብር ነው። እባክዎ ከ10 ብር በላይ ያስገቡ።",
      );
      return;
    }

    // receiver number from the env for now
    // later well fetch it from configs

    // TELEBIRR_RECEIVER_NUMBER='251972278773'
    // TELEBIRR_RECEIVER_NAME='Tedy Girma Yohanis'
    const receiverName = process.env.TELEBIRR_RECEIVER_NAME;
    const receiverPhone = process.env.TELEBIRR_RECEIVER_NUMBER;
    await this.paymentsService.createDepositIntent({
      telegramId: msg.from!.id.toString(),
      expectedAmount: amount,
      paymentMethod: "Telebirr",
    });

    await this.bot.sendMessage(
      chatId,
      `💵 እባክዎን **${amount} ብር** ወደዚህ ቁጥር በ Telebirr ያስገቡ:\n\n` +
        `📱 **${receiverPhone}**\n\n` +
        `ክፍያውን እንደጨረሱ የተላከዎትን **SMS ደረሰኝ** ኮፒ አድርገው እዚህ ይላኩ::`,
      { parse_mode: "Markdown" },
    );
  }

  // ─────────────────────────────────────────────────────────────
  //  User registration
  // ─────────────────────────────────────────────────────────────

  private async handleStart(msg: Message, referralCode?: string) {
    if (!msg.from) return;
    const telUser = this.buildAuthDto(msg);
    const user = await this.usersService.findOrCreateFromTelegram(
      telUser,
      referralCode,
    );
    await this.sendMainMenu(
      msg.chat.id,
      `👋 Welcome ${user.firstName}\\! Choose an option below\\.`,
    );
  }

  async registerTelegramUser(msg: Message) {
    const contact = msg.contact;
    if (!contact || !msg.from) return;

    if (contact.user_id !== msg.from.id) {
      await this.bot.sendMessage(
        msg.chat.id,
        "⚠️ እባክዎ የእርስዎን የራሶት ስልክ ቁጥር ብቻ ያጋሩ::",
      );
      return;
    }

    const telUser = this.buildAuthDto(msg);
    const user = await this.usersService.findOrCreateFromTelegram(telUser);
    const updated = await this.usersService.updatePhoneNumber(
      user._id.toString(),
      contact.phone_number,
    );

    await this.sendMainMenu(
      msg.chat.id,
      `✅ ምዝገባዎ ተጠናቋል\\. መልካም እድል ${this.escapeMarkdown(updated.firstName)}\\!`,
    );
  }

  async promptContactSharing(msg: Message) {
    await this.bot.sendMessage(
      msg.chat.id,
      '📱 ምዝገባውን ለመጨረስ ፡ "📞 Share contact" የሚለውን ይጫኑ::',
      {
        reply_markup: {
          keyboard: [[{ text: "📞 Share contact", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      },
    );
  }

  // ─────────────────────────────────────────────────────────────
  //  Main menu
  // ─────────────────────────────────────────────────────────────

  private async sendMainMenu(chatId: number, text: string) {
    await this.bot.sendMessage(chatId, text, {
      parse_mode: "MarkdownV2",
      reply_markup: {
        keyboard: [
          [{ text: "Play 🎮" }, { text: "Register 📝" }],
          [{ text: "Check Balance 💵" }, { text: "Deposit 💵" }],
          [{ text: "Contact Support ☎️" }, { text: "Instruction 📖" }],
          [{ text: "Transfer 🎁" }, { text: "Withdraw 🤑" }],
          [{ text: "Invite 🔗" }, { text: "Convert Bonus 🔀" }],
        ],
        resize_keyboard: true,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  Deposit receipt processing
  // ─────────────────────────────────────────────────────────────

  private async processDepositReceipt(msg: Message) {
    const text = msg.text || "";
    const telegramId = msg.from?.id.toString();
    if (!telegramId || !text) return;

    try {
      const result = await this.paymentsService.processReceipt(
        telegramId,
        text,
      );
      await this.bot.sendMessage(msg.chat.id, result.message, {
        parse_mode: "Markdown",
      });
    } catch (error) {
      this.logger.error(`Receipt error for ${telegramId}:`, error);
      const errMsg =
        error instanceof ConflictException
          ? error.message
          : "⚠️ ክፍያውን በማስኬድ ላይ ስህተት ተፈጥሯል። እባክዎ ትንሽ ቆይተው እንደገና ይሞክሩ።";
      await this.bot.sendMessage(msg.chat.id, errMsg);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────────────────────

  private getPlayButtonLabel(phase: GamePhase): string {
    const labels: Record<GamePhase, string> = {
      [GamePhase.CARD_SELECTION]: "🎫 Pick Your Card",
      [GamePhase.COUNTDOWN]: "⏳ Watch Countdown",
      [GamePhase.DRAWING]: "🎱 Watch Live Draw",
      [GamePhase.GAME_OVER]: "🏁 See Results",
    };
    return labels[phase] ?? "🎮 Open BIngo";
  }

  /** Escape special characters for MarkdownV2 */
  private escapeMarkdown(text: string): string {
    return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
  }

  private buildAuthDto(msg: Message): TelegramAuthDTO {
    const f = msg.from;
    return {
      id: f?.id.toString() || "",
      firstName: f?.first_name || "",
      lastName: f?.last_name,
      username: f?.username,
      authDate: Math.floor(Date.now() / 1000).toString(),
      hash: "",
    };
  }
}
