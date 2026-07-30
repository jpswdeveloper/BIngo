import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CardsService } from './cards.service';

@Controller('cards')
export class CardsController {
  constructor(private readonly cardsService: CardsService) {}

  /**
   * POST /cards/generate
   * Generate (or regenerate) all 600 cards and rebuild the lookup table.
   * Only runs if cards haven't been generated yet, unless ?force=true is passed.
   *
   * Example: POST /cards/generate?force=true
   */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generateCards(@Query('force') force?: string) {
    const alreadyGenerated = await this.cardsService.hasCardsGenerated();

    if (alreadyGenerated && force !== 'true') {
      throw new ConflictException(
        '600 cards already exist. Pass ?force=true to regenerate.',
      );
    }

    const result = await this.cardsService.generateAllCards();

    return {
      message: '600 Bingo cards generated successfully.',
      cardsCreated: result.cardsCreated,
      lookupsCreated: result.lookupsCreated,
    };
  }

  /**
   * GET /cards/stats
   * Returns counts of cards and lookup entries.
   *
   * Example response:
   * { totalCards: 600, totalLookupEntries: 75, isComplete: true }
   */
  @Get('stats')
  async getStats() {
    return this.cardsService.getCardStats();
  }

  /**
   * GET /cards
   * List all cards with pagination.
   *
   * Query params:
   *   limit  (default 100, max 600)
   *   skip   (default 0)
   *
   * Example: GET /cards?limit=50&skip=100
   */
  @Get()
  async findAll(
    @Query('limit') limit = '100',
    @Query('skip') skip = '0',
  ) {
    const parsedLimit = Math.min(parseInt(limit, 10) || 100, 600);
    const parsedSkip = Math.max(parseInt(skip, 10) || 0, 0);

    return this.cardsService.findAllCards(parsedLimit, parsedSkip);
  }

  /**
   * GET /cards/lookup/:value
   * Find all cards that contain a value and return each card's (row, col) position for it.
   *
   * Example: GET /cards/lookup/42
   * Response:
   * {
   *   value: 42,
   *   column: "N",
   *   locations: [
   *     { cardNumber: 5,  position: 11, row: 2, col: 1 },
   *     { cardNumber: 12, position: 6,  row: 1, col: 1 },
   *     ...
   *   ]
   * }
   */
  @Get('lookup/:value')
  async lookupValue(@Param('value', ParseIntPipe) value: number) {
    if (value < 1 || value > 75) {
      throw new BadRequestException('Value must be between 1 and 75.');
    }

    const result = await this.cardsService.lookupValue(value);

    return {
      ...result,
      column: this.getColumnLabel(value),
    };
  }

  /**
   * GET /cards/:cardNumber
   * Get a single card by its card number (1-600).
   * Returns the 5x5 matrix as both a flat array and a 2D grid for readability.
   *
   * Example: GET /cards/42
   */
  @Get(':cardNumber')
  async findOne(@Param('cardNumber', ParseIntPipe) cardNumber: number) {
    if (cardNumber < 1 || cardNumber > 600) {
      throw new BadRequestException('Card number must be between 1 and 600.');
    }

    const card = await this.cardsService.findCardByNumber(cardNumber);

    return {
      cardNumber: card.cardNumber,
      matrix: card.matrix,
      grid: this.flatToGrid(card.matrix),
    };
  }

  /**
   * GET /cards/:cardNumber/lookup/:value
   * Find where a specific value sits on a specific card.
   *
   * Example: GET /cards/42/lookup/31
   * Response:
   * { cardNumber: 42, value: 31, position: 10, row: 2, col: 0 }
   *
   * Returns 404 if the value is not on that card.
   */
  @Get(':cardNumber/lookup/:value')
  async getValueOnCard(
    @Param('cardNumber', ParseIntPipe) cardNumber: number,
    @Param('value', ParseIntPipe) value: number,
  ) {
    if (cardNumber < 1 || cardNumber > 600) {
      throw new BadRequestException('Card number must be between 1 and 600.');
    }
    if (value < 1 || value > 75) {
      throw new BadRequestException('Value must be between 1 and 75.');
    }

    const result = await this.cardsService.getValuePositionOnCard(
      cardNumber,
      value,
    );

    if (!result) {
      return {
        cardNumber,
        value,
        found: false,
        message: `Value ${value} is not on card #${cardNumber}.`,
      };
    }

    return {
      ...result,
      found: true,
      column: this.getColumnLabel(value),
    };
  }

  // ─────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────

  /**
   * Convert a flat 25-element array to a 5x5 grid (array of 5 rows).
   * FREE cell (index 12) is shown as "FREE" instead of 0.
   */
  private flatToGrid(matrix: number[]): (number | 'FREE')[][] {
    const grid: (number | 'FREE')[][] = [];
    for (let row = 0; row < 5; row++) {
      const rowArr: (number | 'FREE')[] = [];
      for (let col = 0; col < 5; col++) {
        const val = matrix[row * 5 + col];
        rowArr.push(val === 0 ? 'FREE' : val);
      }
      grid.push(rowArr);
    }
    return grid;
  }

  /**
   * Returns the BINGO column label for a given value.
   * B: 1–15, I: 16–30, N: 31–45, G: 46–60, O: 61–75
   */
  private getColumnLabel(value: number): string {
    if (value <= 15) return 'B';
    if (value <= 30) return 'I';
    if (value <= 45) return 'N';
    if (value <= 60) return 'G';
    return 'O';
  }
}
