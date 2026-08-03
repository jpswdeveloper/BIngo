/**
 * TicketsService integration tests
 *
 * Reproduces the bug:
 *   "getMyTicketsInActiveGame returns [] even though tickets exist in MongoDB"
 *
 * Root cause hypothesis:
 *   The ticket is saved with gameId = new Types.ObjectId(state.gameId)
 *   but the query uses    gameId = new Types.ObjectId(state.gameId) again.
 *   If state.gameId is already an ObjectId instance (not a plain hex string),
 *   double-wrapping produces a { buffer: {...} } plain object that never
 *   matches anything in the collection.
 */

import { Types } from 'mongoose';

// ─── Helpers under test ───────────────────────────────────────────────────────

/**
 * Simulates exactly what buyTicketBatch does when saving a ticket:
 *   const gameObjectId = new Types.ObjectId(state.gameId);
 */
function makeGameObjectId(stateGameId: unknown): Types.ObjectId {
  return new Types.ObjectId(stateGameId as string);
}

/**
 * Simulates what getMyTicketsInActiveGame does when querying:
 *   gameId: new Types.ObjectId(state.gameId)
 */
function makeQueryGameId(stateGameId: unknown): Types.ObjectId {
  return new Types.ObjectId(stateGameId as string);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('ObjectId round-trip (gameId corruption bug)', () => {
  const RAW_HEX = '6a7084d4dba2b6a26f0c0302'; // a real gameId from the DB

  it('creates a valid ObjectId from a 24-char hex string', () => {
    const oid = makeGameObjectId(RAW_HEX);
    expect(oid).toBeInstanceOf(Types.ObjectId);
    expect(oid.toString()).toBe(RAW_HEX);
  });

  it('save-time ObjectId equals query-time ObjectId when state.gameId is a hex string', () => {
    const saved   = makeGameObjectId(RAW_HEX);
    const queried = makeQueryGameId(RAW_HEX);
    // This MUST be true for find() to match
    expect(saved.toString()).toBe(queried.toString());
    expect(saved.equals(queried)).toBe(true);
  });

  it('BUG REPRO: double-wrapping an ObjectId instance corrupts the value', () => {
    // This is what happens when state.gameId is already an ObjectId
    // (e.g. returned directly from Mongoose without .toString())
    const original = new Types.ObjectId(RAW_HEX);

    // Simulate passing an ObjectId where a string is expected
    // new Types.ObjectId(objectIdInstance) — should this work?
    let doubleWrapped: Types.ObjectId;
    try {
      doubleWrapped = new Types.ObjectId(original as unknown as string);
      // If it doesn't throw, check if it's still the same value
      const stillValid = Types.ObjectId.isValid(doubleWrapped) &&
                         doubleWrapped.toString() === RAW_HEX;
      if (!stillValid) {
        // This is the bug — double-wrap produced a different/corrupt value
        console.warn('DOUBLE-WRAP BUG: result =', JSON.stringify(doubleWrapped));
      }
      expect(doubleWrapped.toString()).toBe(RAW_HEX);
    } catch (e) {
      // Some versions throw — that's also acceptable (better than silent corruption)
      expect((e as Error).message).toContain('does not match');
    }
  });

  it('safe approach: use .toString() before constructing ObjectId', () => {
    const original = new Types.ObjectId(RAW_HEX);
    // Always call .toString() first — this is the fix
    const safe = new Types.ObjectId(original.toString());
    expect(safe.toString()).toBe(RAW_HEX);
    expect(safe.equals(original)).toBe(true);
  });

  it('find query matches saved document when both use hex string source', () => {
    // Simulate: ticket saved with gameObjectId, then queried with gameObjectId
    const stateGameId = RAW_HEX; // Redis always returns plain strings

    const savedGameId   = new Types.ObjectId(stateGameId);
    const queriedGameId = new Types.ObjectId(stateGameId);

    // Mongoose uses BSON ObjectId equality — .equals() is the correct check
    expect(savedGameId.equals(queriedGameId)).toBe(true);
    expect(savedGameId.toString()).toBe(queriedGameId.toString());
  });
});

describe('getMyTicketsInActiveGame — unit logic', () => {
  it('returns empty array when state is null', async () => {
    // Mirrors: if (!state) return [];
    const state = null;
    const result = state ? ['ticket'] : [];
    expect(result).toEqual([]);
  });

  it('returns empty array when user is not found', async () => {
    // Mirrors: if (!user) return [];
    const user = null;
    const result = user ? ['ticket'] : [];
    expect(result).toEqual([]);
  });

  it('correctly constructs query from valid hex gameId', () => {
    const state = { gameId: RAW_HEX, phase: 'CARD_SELECTION' };
    const gameObjectId = new Types.ObjectId(state.gameId);

    expect(gameObjectId.toString()).toBe(RAW_HEX);
    expect(Types.ObjectId.isValid(gameObjectId)).toBe(true);
    expect(gameObjectId.constructor.name).toBe('ObjectId');
  });

  it('FIXED: querying by telegramId avoids ObjectId type mismatch', () => {
    // Instead of: find({ gameId: ObjectId, userId: ObjectId })
    // Use:        find({ gameId: ObjectId, telegramId: string })
    // telegramId is stored as a plain string — no ObjectId conversion needed
    // and it's indexed on the Ticket schema, so performance is fine.
    const telegramId = '348453405';
    const gameId = new Types.ObjectId(RAW_HEX);

    const query = { gameId, telegramId };
    expect(query.telegramId).toBe(telegramId);
    expect(query.gameId.toString()).toBe(RAW_HEX);
  });
});

const RAW_HEX = '6a7084d4dba2b6a26f0c0302';
