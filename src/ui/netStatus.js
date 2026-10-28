// The small connection status box in the top-left corner,
// for example "Connecting…" or "Online (3 players)".
// It can also show one button (for example "Retry").

const box = document.getElementById('net-status');
const text = document.getElementById('net-status-text');
const button = document.getElementById('net-status-button');

// The function the button runs right now (or null).
let buttonAction = null;

button.addEventListener('click', () => {
  if (buttonAction) buttonAction();
});

// Shows the status box with a text.
// Pass `buttonLabel` and `onButton` to also show a button.
export function showNetStatus(message, buttonLabel = null, onButton = null) {
  box.hidden = false;
  text.textContent = message;
  buttonAction = onButton;
  button.hidden = !onButton;
  button.textContent = buttonLabel || '';
}

// Hides the status box (for example on logout).
export function hideNetStatus() {
  box.hidden = true;
  buttonAction = null;
}
