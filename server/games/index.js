import ttt from './ttt.js';
import wyr from './wyr.js';
import qd from './quickdraw.js';
import sketch from './sketch.js';
import deep from './deep.js';

export const GAMES = Object.fromEntries([deep, wyr, ttt, qd, sketch].map((g) => [g.id, g]));

export const catalog = () =>
  Object.values(GAMES).map(({ id, name, blurb }) => ({ id, name, blurb }));
