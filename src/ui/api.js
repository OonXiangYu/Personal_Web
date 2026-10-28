// Functions that call our /api endpoints from the browser.
// They all return the JSON reply, or throw an ApiError with a friendly message.

// An error from the API. `status` is the HTTP status (0 = no connection).
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Sends a request and turns every kind of failure into an ApiError.
async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    // fetch only throws when the request could not be sent at all.
    throw new ApiError(0, 'Cannot reach the server. Check your internet connection.');
  }

  // The reply may not be JSON (for example an HTML error page), so be careful.
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error || `Something went wrong (error ${response.status}).`;
    throw new ApiError(response.status, message);
  }
  return data;
}

// Sends a JSON POST request.
function postJson(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Logs in. Returns { token, user }.
export function login(username, password) {
  return postJson('/api/login', { username, password });
}

// Creates an account. Returns { token, user }.
export function register(username, password) {
  return postJson('/api/register', { username, password });
}

// Checks a saved token. Returns { user }.
export function getMe(token) {
  return request('/api/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
}
