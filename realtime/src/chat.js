// Chat helpers for the server: cleaning text and limiting how fast a player can chat.

// Characters we remove from chat text, because they cannot be seen but can
// cause trouble:
//   \u0000-\u001F, \u007F-\u009F  control characters (includes line breaks and tabs)
//   \u2028, \u2029                 line and paragraph separators
//   \u200B, \u2060, \uFEFF         zero-width spaces (hide words from filters)
//   \u200E, \u200F                 invisible left-to-right / right-to-left marks
//   \u202A-\u202E, \u2066-\u2069   direction overrides (can make text look reversed)
// Each one becomes a space, then repeated spaces are joined into one.
const INVISIBLE_CHARACTERS =
  /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B\u2060\uFEFF\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

// Rate limit: a "bucket" of BURST messages that refills at REFILL_PER_SECOND.
// So a player can send 3 quick messages, then about 1 per second.
const BURST = 3;
const REFILL_PER_SECOND = 1;

// Second rule, for longer spam: at most this many messages in WINDOW_MS.
const MAX_IN_WINDOW = 10;
const WINDOW_MS = 30_000;

// The same text again within this time is ignored.
const DUPLICATE_MS = 5_000;

// Do not send the same player a notice more often than this,
// so a flood of messages does not become a flood of notices.
const NOTICE_COOLDOWN_MS = 2_000;

// Cleans chat text from a client.
// Returns the clean text, or an empty string if nothing is left.
// We do NOT cut long text here. Cutting could change the meaning of a message,
// which matters for moderation. The caller rejects long messages instead.
export function cleanChatText(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(INVISIBLE_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
}

// Counts characters the way a person would ("你好" is 2), not UTF-16 units.
export function countCharacters(text) {
  return Array.from(text).length;
}

// Keeps track of one player's chat, for the limits above.
// Each player gets their own ChatLimiter.
export class ChatLimiter {
  constructor() {
    // Start full. lastRefillAt = 0 means "long ago", so the bucket is full at
    // the first message no matter what clock the caller uses.
    this.tokens = BURST;
    this.lastRefillAt = 0;
    // Times of recent accepted messages, for the 30-second rule.
    this.recentTimes = [];
    this.lastText = null;
    this.lastTextAt = 0;
    this.lastNoticeAt = 0;
  }

  // True if this is the same text as the last message, sent less than 5 s ago.
  isDuplicate(text, now) {
    return text === this.lastText && now - this.lastTextAt < DUPLICATE_MS;
  }

  // Tries to use one message from the allowance.
  // Returns true if the message may be sent, false if it is too fast.
  tryUse(now) {
    // Refill the bucket for the time that passed.
    // Math.max: if the clock ever goes backwards, never take tokens away.
    const seconds = Math.max(0, (now - this.lastRefillAt) / 1000);
    this.tokens = Math.min(BURST, this.tokens + seconds * REFILL_PER_SECOND);
    this.lastRefillAt = now;

    // Forget messages older than the window.
    this.recentTimes = this.recentTimes.filter((time) => now - time < WINDOW_MS);

    if (this.tokens < 1 || this.recentTimes.length >= MAX_IN_WINDOW) {
      return false;
    }
    this.tokens -= 1;
    this.recentTimes.push(now);
    return true;
  }

  // Remembers the text, for the duplicate check.
  remember(text, now) {
    this.lastText = text;
    this.lastTextAt = now;
  }

  // True if we may send this player a notice now (and records that we did).
  canSendNotice(now) {
    if (now - this.lastNoticeAt < NOTICE_COOLDOWN_MS) return false;
    this.lastNoticeAt = now;
    return true;
  }
}
