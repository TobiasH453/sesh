// One socket for the whole app: presence everywhere, live + games on /live.

const listeners = new Map();
let socket = null;
let retry = 0;
let closedOnPurpose = false;

export const state = { people: [], games: [], you: null, connected: false };

function emit(type, msg) {
  for (const fn of listeners.get(type) || []) fn(msg);
  for (const fn of listeners.get('*') || []) fn(msg);
}

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}

export function send(msg) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

export function connect() {
  closedOnPurpose = false;
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onopen = () => {
    retry = 0;
    state.connected = true;
    emit('open', {});
  };
  socket.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.t === 'hello') {
      state.you = msg.you;
      state.games = msg.games;
      state.people = msg.people;
      emit('presence', msg);
    }
    if (msg.t === 'presence') state.people = msg.people;
    emit(msg.t, msg);
  };
  socket.onclose = () => {
    state.connected = false;
    emit('close', {});
    socket = null;
    if (closedOnPurpose) return;
    const wait = Math.min(1000 * 2 ** retry++, 15000);
    setTimeout(connect, wait);
  };
}

export function disconnect() {
  closedOnPurpose = true;
  socket?.close();
}

export const livePeople = () => state.people.filter((p) => p.status !== 'idle' && p.handle !== state.you);
