// The browser's connection to the real-time game server.
// It connects with the login token, turns messages into objects, reconnects
// when the network drops, and works out WHY when it cannot connect.
// It does not know about Phaser. The scene decides what to draw.

import PartySocket from 'partysocket';
import { MSG, PARTY_NAME, DEFAULT_ROOM, CLOSE_REPLACED } from '../../shared/protocol.js';
import { loadToken } from '../ui/storage.js';
import { getMe } from '../ui/api.js';

// The game server address, for example "localhost:8787" or
// "pixelworld-realtime.yourname.workers.dev". Set in .env.local / Vercel.
const REALTIME_HOST = cleanHost(import.meta.env.VITE_REALTIME_HOST);

// Forgives small mistakes in VITE_REALTIME_HOST: spaces, a pasted
// "https://" or "wss://" at the start, or a "/" at the end.
// partysocket wants only "host" or "host:port".
function cleanHost(raw) {
  return (raw || '')
    .trim()
    .replace(/^(https?|wss?):\/\//i, '')
    .replace(/\/+$/, '');
}

// After this many failed connection attempts in a row, we check why.
const FAILURES_BEFORE_CHECK = 2;

// If we still cannot connect after this long, show a "Retry" button.
const RETRY_BUTTON_AFTER_MS = 30_000;

// The possible connection states. The scene turns these into text.
export const STATUS = {
  CONNECTING: 'connecting',
  ONLINE: 'online',
  RECONNECTING: 'reconnecting',
  // Still trying in the background, but it has been a while. Show "Retry".
  OFFLINE: 'offline',
  // Closed because the same account connected from another tab or device.
  REPLACED: 'replaced',
  // The game server does not accept our (otherwise good) login.
  GAME_REJECTED: 'game-rejected',
  // VITE_REALTIME_HOST is not set. Single player only.
  NOT_CONFIGURED: 'not-configured',
};

export class WorldConnection {
  // handlers:
  //   onMessage(data)    a message from the server (already parsed JSON)
  //   onStatus(status)   the connection state changed (one of STATUS)
  //   onLoginRejected()  our login is no longer valid, go back to the login form
  constructor({ room = DEFAULT_ROOM, onMessage, onStatus, onLoginRejected }) {
    this.room = room;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.onLoginRejected = onLoginRejected;

    this.socket = null;
    this.status = null;
    // True while the socket is open.
    this.isOpen = false;
    // Failed attempts in a row that never opened.
    this.failures = 0;
    // So we only run the "why is it failing?" check once per problem.
    this.checkStarted = false;
    this.retryTimer = null;
    // True after close(). Stops all late callbacks.
    this.stopped = false;
  }

  // Opens the connection.
  connect() {
    if (!REALTIME_HOST) {
      console.warn('VITE_REALTIME_HOST is not set, so multiplayer is off. See README.md.');
      this.setStatus(STATUS.NOT_CONFIGURED);
      return;
    }

    this.socket = new PartySocket({
      host: REALTIME_HOST,
      party: PARTY_NAME,
      room: this.room,
      // A function, so a fresh token is read on EVERY reconnect
      // (for example after the player logged in again).
      // Browsers cannot set headers on WebSockets, so it goes in the URL.
      query: () => ({ token: loadToken() }),
      // Do not keep messages while offline. Old positions are useless later.
      maxEnqueuedMessages: 0,
      // After CLOSE_REPLACED (this account opened the game somewhere else),
      // do not reconnect. Otherwise the two tabs would kick each other forever.
      shouldReconnectOnClose: (event) => event.code !== CLOSE_REPLACED,
    });

    this.socket.addEventListener('open', () => this.handleOpen());
    this.socket.addEventListener('close', (event) => this.handleClose(event));
    this.socket.addEventListener('message', (event) => this.handleMessage(event));

    this.setStatus(STATUS.CONNECTING);
  }

  // Sends our position. Does nothing if we are not connected right now.
  sendMove({ x, y, facing, moving }) {
    if (!this.isOpen) return;
    this.socket.send(JSON.stringify({ type: MSG.MOVE, x, y, facing, moving }));
  }

  // Sends a chat message. Returns false if we are not connected right now
  // (the message is not kept for later: an old message would be confusing).
  sendChat(text) {
    if (!this.isOpen) return false;
    this.socket.send(JSON.stringify({ type: MSG.CHAT, text }));
    return true;
  }

  // Tries to connect again now (used by the "Retry" / "Play here" button).
  retry() {
    if (this.stopped || !this.socket) return;
    this.resetProblem();
    this.setStatus(STATUS.CONNECTING);
    this.socket.reconnect();
  }

  // Closes the connection for good (logout, or the game is closing).
  close() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.socket?.close();
  }

  // ---------- Socket events ----------

  handleOpen() {
    if (this.stopped) return;
    this.isOpen = true;
    this.resetProblem();
    this.setStatus(STATUS.ONLINE);
  }

  handleMessage(event) {
    if (this.stopped) return;
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return; // Not JSON. Ignore it.
    }
    if (data && typeof data.type === 'string') {
      this.onMessage(data);
    }
  }

  handleClose(event) {
    if (this.stopped) return;
    const wasOpen = this.isOpen;
    this.isOpen = false;

    if (event.code === CLOSE_REPLACED) {
      this.setStatus(STATUS.REPLACED);
      return;
    }
    // Once we know the server rejects us, stay on that message.
    if (this.status === STATUS.GAME_REJECTED) return;

    if (wasOpen) {
      // We were online and lost the connection. partysocket reconnects
      // by itself, waiting a bit longer after each failure (backoff).
      this.startProblemTimer();
      this.setStatus(STATUS.RECONNECTING);
      return;
    }

    // An attempt that never opened. If the server refused us before
    // connecting, the browser does not tell us why, so we count failures
    // and then ask the servers directly.
    this.failures += 1;
    this.startProblemTimer();
    if (this.failures >= FAILURES_BEFORE_CHECK && !this.checkStarted) {
      this.checkStarted = true;
      this.findOutWhyFailing();
    }
    if (this.status !== STATUS.OFFLINE) {
      this.setStatus(STATUS.RECONNECTING);
    }
  }

  // ---------- Working out why we cannot connect ----------

  async findOutWhyFailing() {
    const token = loadToken();

    // 1. Ask our login API (Vercel): is the login itself still good?
    try {
      await getMe(token);
    } catch (err) {
      if (this.stopped || this.isOpen) return;
      if (err.status === 401) {
        // Expired or invalid. The player must log in again.
        this.close();
        this.onLoginRejected();
        return;
      }
      // Any other error (no internet, server down) tells us nothing about
      // the token. Go on to the next check.
    }

    // 2. Ask the game server: do YOU accept this login?
    const result = await checkTokenWithGameServer(token);
    if (this.stopped || this.isOpen) return;

    if (result === 'rejected') {
      // Vercel says the login is fine, but the game server says no.
      // The usual reason is a different JWT_SECRET on the two servers.
      console.warn(
        'The game server rejected a login that the login API accepts. ' +
          'JWT_SECRET may not match between Vercel and the Worker ' +
          '(check .env.local and realtime/.dev.vars, or the Vercel and Cloudflare secrets).',
      );
      this.socket.close(); // stop retrying, it would fail every time
      this.setStatus(STATUS.GAME_REJECTED);
    }
    // 'ok' or 'unreachable': probably a network problem. partysocket keeps
    // retrying with backoff, and the problem timer shows "Retry" later.
  }

  // ---------- Small helpers ----------

  // After RETRY_BUTTON_AFTER_MS without success, switch to OFFLINE ("Retry" button).
  startProblemTimer() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      if (!this.stopped && !this.isOpen && this.status === STATUS.RECONNECTING) {
        this.setStatus(STATUS.OFFLINE);
      }
    }, RETRY_BUTTON_AFTER_MS);
  }

  resetProblem() {
    this.failures = 0;
    this.checkStarted = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  setStatus(status) {
    this.status = status;
    this.onStatus(status);
  }
}

// Asks the game server's /auth-check if it accepts our token.
// Returns 'ok', 'rejected', or 'unreachable'.
async function checkTokenWithGameServer(token) {
  // Same rule partysocket uses: plain http only for local development.
  const isLocal = REALTIME_HOST.startsWith('localhost:') || REALTIME_HOST.startsWith('127.0.0.1:');
  const url = `${isLocal ? 'http' : 'https'}://${REALTIME_HOST}/auth-check`;
  try {
    const response = await fetch(url, {
      // A header, not the URL, so the token does not end up in server logs.
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 200) return 'ok';
    if (response.status === 401) return 'rejected';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}
