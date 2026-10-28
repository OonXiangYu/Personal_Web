// The ONE place where every chat message is checked before others see it.
//
// Right now it allows everything. In Step 4 we will add our own ML model here.
// The plan: this function will look at the text and decide one of three things:
//   1. allow it as it is      → return { allowed: true, text }
//   2. allow a masked version → return { allowed: true, text: 'you are a ****' }
//   3. block it               → return { allowed: false, reason: 'toxic' }
// WorldRoom.js already handles all three answers (a blocked message is not
// sent, and the sender gets a notice), so Step 4 only needs to change this file.
//
// It is `async` because a model may take some time to answer
// (for example when it runs on Workers AI or another server).
//
// `player` is { id, name }, from the verified login token. A future model could
// use it, for example to be stricter with players who were blocked before.
//
// Never log `text` here: chat messages are private to the players in the room.

export async function moderateMessage(text, player) {
  // TODO (Step 4): call the moderation model here.
  return { allowed: true, text };
}
