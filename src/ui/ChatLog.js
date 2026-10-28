// The small chat history panel, so players can read messages they missed.
// Shows the last 50 lines as "name: text", plus system lines like "Oscar joined".
// It can be collapsed. On phones it starts collapsed, so it does not cover the game.
//
// Every line is added with textContent, NEVER innerHTML. Chat text comes from
// other players, and innerHTML would let someone inject HTML or scripts.

import { isTouchMode } from './touchMode.js';

const MAX_LINES = 50;

export class ChatLog {
  constructor() {
    this.panel = document.getElementById('chat-log');
    this.toggleButton = document.getElementById('chat-log-toggle');
    this.lines = document.getElementById('chat-log-lines');

    // Messages that arrived while the panel was collapsed.
    this.unread = 0;

    this.lines.replaceChildren();
    this.setCollapsed(isTouchMode());
    this.panel.hidden = false;

    this.onToggle = () => this.setCollapsed(!this.collapsed);
    this.toggleButton.addEventListener('click', this.onToggle);
  }

  // Adds a chat line: "name: text".
  addChat(name, text) {
    const line = document.createElement('div');
    line.className = 'chat-line';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'chat-line-name';
    nameSpan.textContent = `${name}: `;
    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    line.append(nameSpan, textSpan);
    this.addLine(line);
  }

  // Adds a grey system line, for example "Oscar joined".
  addSystem(text) {
    const line = document.createElement('div');
    line.className = 'chat-line is-system';
    line.textContent = text;
    this.addLine(line);
  }

  addLine(line) {
    // Only scroll down if the player was already at the bottom.
    // If they scrolled up to read old messages, do not pull them away.
    const atBottom =
      this.lines.scrollHeight - this.lines.scrollTop - this.lines.clientHeight < 8;

    this.lines.appendChild(line);
    while (this.lines.children.length > MAX_LINES) {
      this.lines.firstChild.remove();
    }

    if (atBottom) {
      this.lines.scrollTop = this.lines.scrollHeight;
    }
    if (this.collapsed) {
      this.unread += 1;
      this.updateToggleText();
    }
  }

  setCollapsed(collapsed) {
    this.collapsed = collapsed;
    this.panel.classList.toggle('is-collapsed', collapsed);
    if (!collapsed) {
      this.unread = 0;
      this.lines.scrollTop = this.lines.scrollHeight;
    }
    this.updateToggleText();
  }

  // "Chat ▾" when open, "Chat (3) ▸" when collapsed with 3 unread messages.
  updateToggleText() {
    const count = this.collapsed && this.unread > 0 ? ` (${this.unread})` : '';
    this.toggleButton.textContent = `Chat${count} ${this.collapsed ? '▸' : '▾'}`;
    this.toggleButton.setAttribute('aria-expanded', String(!this.collapsed));
  }

  // Hides the panel and forgets all lines (on logout).
  destroy() {
    this.toggleButton.removeEventListener('click', this.onToggle);
    this.lines.replaceChildren();
    this.panel.hidden = true;
  }
}
