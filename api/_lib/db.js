// Connects to MongoDB Atlas and gives other API files the `users` collection.
// The folder name starts with "_", so Vercel does not turn this file into a route.

import { MongoClient, MongoError } from 'mongodb';

// The database name is always set here, in code. We never use the name inside
// MONGODB_URI: if the URI has no name, the driver quietly falls back to "test",
// and users end up in the wrong database. MONGODB_DB lets you pick another
// database (for example for testing), but it is optional.
const DEFAULT_DB_NAME = 'pixelworld';
const USERS_COLLECTION = 'users';

// The key we use to remember that the indexes were created on this instance.
const INDEX_CACHE_KEY = '_pixelworldIndexPromise';

// Give up after about 5 seconds if the database cannot be found.
// The default is 30 seconds, which would make the player wait far too long.
const SERVER_SELECTION_TIMEOUT_MS = 5000;

// The key we use to keep the connection on globalThis.
const CACHE_KEY = '_pixelworldMongoClientPromise';

// Thrown when MONGODB_URI is not set. We treat it like "database not reachable".
export class MissingDatabaseUrlError extends Error {
  constructor() {
    super('MONGODB_URI is not set. Add it to your environment variables.');
    this.name = 'MissingDatabaseUrlError';
  }
}

// Returns a connected MongoClient.
// On serverless, the same running instance often handles many requests in a row.
// We keep the connection on globalThis so each request reuses it instead of
// opening a new one. Without this, Atlas would soon hit its connection limit.
function getClient() {
  if (!globalThis[CACHE_KEY]) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new MissingDatabaseUrlError();
    }

    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    });

    // We cache the promise (not the client), so two requests that arrive at
    // the same time share one connection attempt.
    globalThis[CACHE_KEY] = client.connect().catch((err) => {
      // Connecting failed. Clear the cache so the next request tries again,
      // instead of getting the same failed promise forever.
      globalThis[CACHE_KEY] = null;
      throw err;
    });
  }
  return globalThis[CACHE_KEY];
}

// Returns the name of the database to use.
function getDbName() {
  return process.env.MONGODB_DB || DEFAULT_DB_NAME;
}

// Makes sure the unique index on usernameLower exists.
// This index is what stops two people from registering "Tom" and "tom".
// createIndex does nothing if the index is already there, so it is safe to run
// many times. Still, we only run it once per server instance (we cache the
// promise), so normal requests do not pay for an extra database call.
// This function never throws: if it fails, we log it and carry on, so a
// problem with the index does not break login.
function ensureIndexes(users) {
  if (!globalThis[INDEX_CACHE_KEY]) {
    globalThis[INDEX_CACHE_KEY] = users
      .createIndex({ usernameLower: 1 }, { unique: true })
      .catch((err) => {
        // Only the error type and message. No connection string.
        console.error(`[db] Could not create the usernameLower index. ${err?.name}: ${err?.message}`);
      });
  }
  return globalThis[INDEX_CACHE_KEY];
}

// Returns the `users` collection, ready to use.
export async function getUsersCollection() {
  const client = await getClient();
  const users = client.db(getDbName()).collection(USERS_COLLECTION);
  // Wait for the index, so even the very first sign-up is protected.
  // After the first time, this is an already-finished promise and costs nothing.
  await ensureIndexes(users);
  return users;
}

// True if the error means "we could not talk to the database".
// All MongoDB driver errors extend MongoError.
export function isDatabaseError(err) {
  return err instanceof MongoError || err instanceof MissingDatabaseUrlError;
}

// Turns a user document into the safe shape we send to the browser.
// It picks fields one by one, so passwordHash can never slip out by mistake.
export function toPublicUser(userDoc) {
  return {
    id: String(userDoc._id),
    username: userDoc.username,
  };
}
