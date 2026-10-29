// The modes the world can be in (see WorldScene.js and createGame.js).
// In its own file because both of those files need it, and they would
// otherwise import each other (a loop that breaks when the page loads).

export const MODE = {
  LOADING: 'loading', // checking a saved login: map only, no connection
  GUEST: 'guest', // playing without logging in
  USER: 'user', // playing as a logged-in player
  SPECTATOR: 'spectator', // watching only, because the tank was full
};
