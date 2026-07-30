import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Card, CardDocument } from './schemas/card.schema';
import { CardLookup, CardLookupDocument } from './schemas/card-lookup.schema';

@Injectable()
export class CardsService {
  private readonly logger = new Logger(CardsService.name);

  constructor(
    @InjectModel(Card.name) private readonly cardModel: Model<CardDocument>,
    @InjectModel(CardLookup.name)
    private readonly cardLookupModel: Model<CardLookupDocument>,
  ) {}

  /**
   * Standard Bingo column ranges:
   *  B (col 0): 1  – 15
   *  I (col 1): 16 – 30
   *  N (col 2): 31 – 45
   *  G (col 3): 46 – 60
   *  O (col 4): 61 – 75
   */
  private readonly COLUMN_RANGES = [
    [1, 15], // B
    [16, 30], // I
    [31, 45], // N
    [46, 60], // G
    [61, 75], // O
  ];

  /**
   * Generate a single 5x5 Bingo card following standard rules.
   * Returns a flat 25-element array (row-major order).
   * Center cell (index 12) is always 0 (FREE).
   */
  private generateSingleCard(): number[] {
    const matrix: number[] = new Array(25);

    for (let col = 0; col < 5; col++) {
      const [min, max] = this.COLUMN_RANGES[col];
      const pool = this.shuffleArray(
        Array.from({ length: max - min + 1 }, (_, i) => min + i),
      );

      for (let row = 0; row < 5; row++) {
        const index = row * 5 + col;

        // Center cell (row 2, col 2) is FREE
        if (row === 2 && col === 2) {
          matrix[index] = 0;
        } else {
          matrix[index] = pool.pop()!;
        }
      }
    }

    return matrix;
  }

  /**
   * Fisher-Yates shuffle
   */
  private shuffleArray<T>(array: T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /**
   * Generate all 600 cards and build the lookup table.
   * WARNING: This will DELETE existing cards and lookups before regenerating.
   */
  async generateAllCards(): Promise<{
    cardsCreated: number;
    lookupsCreated: number;
  }> {
    this.logger.log('Starting card generation (600 cards)...');

    // Clear existing data
    await this.cardModel.deleteMany({});
    await this.cardLookupModel.deleteMany({});

    // Generate 600 unique cards
    const cards: Card[] = [];
    for (let i = 1; i <= 600; i++) {
      const matrix = this.generateSingleCard();
      cards.push({
        cardNumber: i,
        matrix,
      } as Card);
    }

    // Bulk insert cards
    await this.cardModel.insertMany(cards);
    this.logger.log('Inserted 600 cards into database.');

    // Build lookup table: value -> [{cardNumber, position}, ...]
    const lookupMap = new Map<number, { cardNumber: number; position: number }[]>();

    for (const card of cards) {
      for (let position = 0; position < 25; position++) {
        const value = card.matrix[position];

        // Skip FREE cell (value = 0)
        if (value === 0) continue;

        if (!lookupMap.has(value)) {
          lookupMap.set(value, []);
        }

        lookupMap.get(value)!.push({
          cardNumber: card.cardNumber,
          position,
        });
      }
    }

    // Convert map to CardLookup documents
    const lookups: CardLookup[] = [];
    for (const [value, locations] of lookupMap.entries()) {
      lookups.push({
        value,
        locations,
      } as CardLookup);
    }

    await this.cardLookupModel.insertMany(lookups);
    this.logger.log(`Inserted ${lookups.length} lookup entries.`);

    return {
      cardsCreated: cards.length,
      lookupsCreated: lookups.length,
    };
  }

  /**
   * Get a specific card by its card number (1-600)
   */
  async findCardByNumber(cardNumber: number): Promise<CardDocument> {
    const card = await this.cardModel.findOne({ cardNumber }).exec();
    if (!card) {
      throw new NotFoundException(`Card #${cardNumber} not found`);
    }
    return card;
  }

  /**
   * Get all cards (paginated)
   */
  async findAllCards(
    limit = 100,
    skip = 0,
  ): Promise<{ cards: CardDocument[]; total: number }> {
    const [cards, total] = await Promise.all([
      this.cardModel.find().skip(skip).limit(limit).exec(),
      this.cardModel.countDocuments().exec(),
    ]);

    return { cards, total };
  }

  /**
   * Find all cards that contain a specific value
   */
  async findCardsByValue(value: number): Promise<CardDocument[]> {
    if (value < 1 || value > 75) {
      throw new NotFoundException(`Invalid Bingo value: ${value}`);
    }

    return this.cardModel.find({ matrix: value }).exec();
  }

  /**
   * Lookup: which cards contain this value and at what positions?
   * Returns: { value, locations: [{cardNumber, position, row, col}, ...] }
   */
  async lookupValue(value: number): Promise<{
    value: number;
    locations: {
      cardNumber: number;
      position: number;
      row: number;
      col: number;
    }[];
  }> {
    if (value < 1 || value > 75) {
      throw new NotFoundException(`Invalid Bingo value: ${value}`);
    }

    const lookup = await this.cardLookupModel.findOne({ value }).exec();

    if (!lookup || lookup.locations.length === 0) {
      return {
        value,
        locations: [],
      };
    }

    // Convert flat position to (row, col) for each location
    const locationsWithCoords = lookup.locations.map((loc) => ({
      cardNumber: loc.cardNumber,
      position: loc.position,
      row: Math.floor(loc.position / 5),
      col: loc.position % 5,
    }));

    return {
      value,
      locations: locationsWithCoords,
    };
  }

  /**
   * Get position of a specific value on a specific card
   * Returns: { cardNumber, value, position, row, col } or null if not found
   */
  async getValuePositionOnCard(
    cardNumber: number,
    value: number,
  ): Promise<{
    cardNumber: number;
    value: number;
    position: number;
    row: number;
    col: number;
  } | null> {
    const card = await this.findCardByNumber(cardNumber);

    const position = card.matrix.indexOf(value);

    if (position === -1) {
      return null;
    }

    return {
      cardNumber: card.cardNumber,
      value,
      position,
      row: Math.floor(position / 5),
      col: position % 5,
    };
  }

  /**
   * Check if cards have been generated
   */
  async hasCardsGenerated(): Promise<boolean> {
    const count = await this.cardModel.countDocuments().exec();
    return count === 600;
  }

  /**
   * Get card statistics
   */
  async getCardStats(): Promise<{
    totalCards: number;
    totalLookupEntries: number;
    isComplete: boolean;
  }> {
    const [totalCards, totalLookupEntries] = await Promise.all([
      this.cardModel.countDocuments().exec(),
      this.cardLookupModel.countDocuments().exec(),
    ]);

    return {
      totalCards,
      totalLookupEntries,
      isComplete: totalCards === 600 && totalLookupEntries === 75,
    };
  }
}
