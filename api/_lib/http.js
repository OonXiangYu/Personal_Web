// Small helpers that every API endpoint uses:
// method checks, reading the body, and sending JSON or errors.

import { isDatabaseError } from './db.js';
import { ConfigError } from './auth.js';

const MAINTENANCE_MESSAGE = 'Server is under maintenance, please try again later';

// Sends a JSON response.
export function sendJson(res, status, data) {
  // Login answers are personal. Tell browsers and CDNs never to cache them.
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(data);
}

// Sends an error in the shape the frontend expects: { error: "message" }.
export function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

// Returns true if the request uses the allowed HTTP method.
// If not, it sends a 405 response and returns false,
// so the caller can simply do: if (!allowMethod(...)) return;
export function allowMethod(req, res, method) {
  if (req.method === method) {
    return true;
  }
  res.setHeader('Allow', method);
  sendError(res, 405, 'Method not allowed');
  return false;
}

// Returns the JSON body as an object.
// Vercel usually parses JSON for us, but if the client forgot the
// Content-Type header the body can still be a plain string.
export function readBody(req) {
  const body = req.body;
  if (body && typeof body === 'object') {
    return body;
  }
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) || {};
    } catch {
      return {};
    }
  }
  return {};
}

// Sends the right response for an unexpected error, and logs it safely.
export function handleServerError(res, err, where) {
  // Only log the error type and message. Never log the request body,
  // because it can hold a password, and never log the connection string.
  console.error(`[${where}] ${err?.name}: ${err?.message}`);

  if (isDatabaseError(err)) {
    sendError(res, 503, MAINTENANCE_MESSAGE);
    return;
  }
  if (err instanceof ConfigError) {
    // A setup mistake on our side (for example JWT_SECRET is missing).
    // The message says what to fix and contains no secret.
    sendError(res, 500, err.message);
    return;
  }
  sendError(res, 500, 'Something went wrong, please try again');
}
