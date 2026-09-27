import { h, replace, toast } from '../h.js';
import * as ws from '../ws.js';
import { session } from '../session.js';
import { createPeer } from '../rtc.js';
import { RENDERERS } from '../games/index.js';

const STATUS = { idle: 'around', waiting: 'looking', live: 'in a call' };

export function LiveView() {
  const el = h('div.view-live', { style: 'height:100%' });
  const offs = [];
  let phase = 'lobby'; // lobby | searching | matched
  let stream = null;
  let peer = null;
  let match = null;
  let game = null; // { id, name, by, mount }
  let tab = 'games';
  let unread = 0;
  let mic = true;
  let cam = true;
  let starting = false;
  let destroyed = false;
  let note = null; // shown over the stage while searching

  // ------------------------------------------------------------------ lobby

  const peopleList = h('div.people');
  const drawPeople = () => {
    const others = ws.state.people.filter((p) => p.handle !== ws.state.you);
    replace(peopleList, others.length
      ? others.map((p) => h('div.person', h(`span.status-dot.s-${p.status}`), h('span', p.handle), h('div.spacer'), h('span.label', STATUS[p.status])))
      : h('div.empty', { style: 'text-align:left;padding:16px 0' }, 'Nobody else is on. Start anyway and you will be matched when someone shows up.'));
  };

  const gameInfo = h('div.info-list');
  const drawGameInfo = () =>
    replace(gameInfo, ws.state.games.map((g, i) =>
      h('div', h('span.num', String(i + 1).padStart(2, '0')), h('div', h('b', g.name), h('span.dim', g.blurb))),
    ));

  function lobby() {
    phase = 'lobby';
    replace(el, h('div.lobby', h('div.page-inner',
      h('h1.page-title', 'Live'),
      h('p.dim', { style: 'margin:0 0 28px' }, 'Random one-on-one video with whoever from the crew is on. Skip whenever. Games built in.'),
      h('div.lobby-grid',
        h('button.btn.primary.block', { onClick: start }, 'Start'),
        h('div', h('div.label', { style: 'margin-bottom:12px' }, 'On now'), peopleList),
        h('div', h('div.label', { style: 'margin-bottom:12px' }, 'Games in here'), gameInfo),
      ),
    )));
    drawPeople();
    drawGameInfo();
  }

  async function start() {
    if (starting) return;
    starting = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      starting = false;
      const msg = !window.isSecureContext
        ? 'Camera needs https. Open sesh over an https link.'
        : err.name === 'NotAllowedError'
          ? 'Camera blocked. Allow camera + mic for this site.'
          : 'No camera or mic found.';
      return toast(msg, 4000);
    }
    starting = false;
    if (destroyed) return stream.getTracks().forEach((t) => t.stop());
    mic = true;
    cam = true;
    buildStage();
    search();
  }

  // ------------------------------------------------------------------ stage

  const remote = h('video.remote', { autoplay: true, playsinline: true });
  const local = h('video.local.solo', { autoplay: true, playsinline: true, muted: true });
  const topBar = h('div.stage-top');
  const center = h('div.stage-center');
  const panelBody = h('div.panel-body');
  const tabBtns = {
    games: h('button', { onClick: () => setTab('games') }, 'Games'),
    chat: h('button', { onClick: () => setTab('chat') }, 'Chat'),
  };
  const nextBtn = h('button.btn.primary', { onClick: next }, 'Next');
  const micBtn = h('button.btn', { onClick: toggleMic }, 'Mute');
  const camBtn = h('button.btn', { onClick: toggleCam }, 'Cam off');
  const endBtn = h('button.btn.danger', { onClick: stop }, 'End');
  let root = null;

  // chat
  const chatLog = h('div.chat-log');
  const chatInput = h('input.input', { placeholder: 'Message', maxlength: 500, autocomplete: 'off', enterkeyhint: 'send' });
  const chatForm = h('form.chat-form', {
    onSubmit(e) {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text || phase !== 'matched') return;
      ws.send({ t: 'chat', text });
      addMsg('me', text);
      chatInput.value = '';
    },
  }, chatInput, h('button.btn', { type: 'submit' }, 'Send'));
  const chatPane = h('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' }, chatLog, chatForm);

  function addMsg(kind, text) {
    const who = kind === 'me' ? 'you' : kind === 'them' ? match?.partner.handle : null;
    chatLog.append(h(`div.msg.${kind}`, who && h('span.who', who), text));
    chatLog.scrollTop = chatLog.scrollHeight;
    if (kind === 'them' && tab !== 'chat') {
      unread++;
      drawTabs();
    }
  }

  function buildStage() {
    root = h('div.room',
      h('div.stage', remote, local, topBar, center),
      h('div.controls', nextBtn, micBtn, camBtn, endBtn),
      h('div.panel', h('div.panel-tabs', tabBtns.games, tabBtns.chat), panelBody),
    );
    local.srcObject = stream;
    replace(el, root);
    drawControls();
  }

  function drawControls() {
    micBtn.textContent = mic ? 'Mute' : 'Unmute';
    micBtn.classList.toggle('off', !mic);
    camBtn.textContent = cam ? 'Cam off' : 'Cam on';
    camBtn.classList.toggle('off', !cam);
    nextBtn.disabled = phase !== 'matched';
  }

  function drawTabs() {
    tabBtns.games.classList.toggle('on', tab === 'games');
    tabBtns.chat.classList.toggle('on', tab === 'chat');
    replace(tabBtns.chat, 'Chat', unread ? h('span.count', unread) : null);
  }

  function setTab(t) {
    tab = t;
    if (t === 'chat') unread = 0;
    drawTabs();
    drawPanel();
    if (t === 'chat' && matchMedia('(pointer: fine)').matches) chatInput.focus();
  }

  function drawStage() {
    const matched = phase === 'matched';
    local.classList.toggle('solo', !matched);
    remote.classList.toggle('hidden', !matched);
    replace(topBar,
      matched ? h('span.tag', h('span.status-dot.s-live'), match.partner.handle) : h('span.tag', h('span.live-dot'), 'Live'),
      h('div.spacer'),
      matched && match.conn && match.conn !== 'connected' ? h('span.tag', match.conn === 'failed' ? 'No connection. Hit next.' : 'Connecting') : null,
    );
    if (phase === 'searching') {
      const waiting = ws.state.people.filter((p) => p.handle !== ws.state.you && p.status === 'waiting').length;
      replace(center, h('div',
        note ? h('div.label', { style: 'margin-bottom:14px;color:var(--fg)' }, note) : null,
        h('div.searching', 'Looking', h('i')),
        h('div.label', { style: 'margin-top:14px' }, waiting ? `${waiting} other${waiting > 1 ? 's' : ''} looking` : 'Waiting for someone to show up'),
      ));
    } else replace(center);
  }

  function drawPanel() {
    root?.classList.toggle('has-game', !!game);
    if (tab === 'chat') {
      replace(panelBody, chatPane);
      chatLog.scrollTop = chatLog.scrollHeight;
      return;
    }
    if (game) {
      replace(panelBody,
        h('div.game-head',
          h('b', game.name),
          h('span.label', game.by === ws.state.you ? 'you started' : `${game.by} started`),
          h('div.spacer'),
          h('button.btn.small', { onClick: () => ws.send({ t: 'game:quit' }) }, 'Quit'),
        ),
        game.root,
      );
      return;
    }
    const canPlay = phase === 'matched';
    replace(panelBody,
      h('div.label', { style: 'padding:16px 16px 12px' }, canPlay ? 'Pick one. It starts for both of you.' : 'Games unlock when you are matched'),
      h('div.game-list', { style: 'border-top:1px solid var(--line)' },
        ws.state.games.map((g, i) =>
          h('button', { disabled: !canPlay, onClick: () => ws.send({ t: 'game:start', game: g.id }) },
            h('span.num', String(i + 1).padStart(2, '0')),
            h('div', h('b', g.name), h('span.dim', g.blurb)),
          ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------ flow

  function search() {
    teardownMatch();
    phase = 'searching';
    ws.send({ t: 'queue' });
    drawStage();
    drawControls();
    drawPanel();
    drawTabs();
  }

  function next() {
    if (phase !== 'matched') return;
    note = null;
    teardownMatch();
    phase = 'searching';
    ws.send({ t: 'next' });
    drawStage();
    drawControls();
    drawPanel();
  }

  function stop() {
    ws.send({ t: 'leave' });
    teardownMatch();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    root = null;
    lobby();
  }

  function toggleMic() {
    mic = !mic;
    stream?.getAudioTracks().forEach((t) => (t.enabled = mic));
    drawControls();
  }

  function toggleCam() {
    cam = !cam;
    stream?.getVideoTracks().forEach((t) => (t.enabled = cam));
    drawControls();
  }

  function teardownMatch() {
    peer?.close();
    peer = null;
    match = null;
    endGame();
    remote.srcObject = null;
    chatLog.replaceChildren();
    unread = 0;
    tab = 'games';
  }

  function endGame() {
    game?.mount.destroy?.();
    game = null;
  }

  function onMatched(msg) {
    if (!stream) return;
    teardownMatch();
    phase = 'matched';
    note = null;
    match = { id: msg.matchId, partner: msg.partner, conn: 'connecting' };
    peer = createPeer({
      matchId: msg.matchId,
      initiator: msg.initiator,
      stream,
      iceServers: session.iceServers,
      onRemote(s) {
        remote.srcObject = s;
        remote.play().catch(() => {});
      },
      onState(state) {
        if (!match) return;
        match.conn = state;
        drawStage();
      },
    });
    addMsg('sys', `You're with ${msg.partner.handle}. Say hi.`);
    drawStage();
    drawControls();
    drawPanel();
    drawTabs();
  }

  function onGame(msg) {
    if (phase !== 'matched') return;
    const who = msg.by === ws.state.you ? 'You' : msg.by;
    if (!msg.game) {
      if (game) addMsg('sys', `${who} ended ${game.name}`);
      endGame();
      return drawPanel();
    }
    if (!game || game.id !== msg.game.id) {
      if (!RENDERERS[msg.game.id]) return;
      endGame();
      const gameRoot = h('div.game');
      const mount = RENDERERS[msg.game.id].mount(gameRoot, {
        move: (m) => ws.send({ t: 'game:move', move: m }),
      });
      game = { id: msg.game.id, name: msg.game.name, by: msg.by, root: gameRoot, mount };
      addMsg('sys', `${who} started ${msg.game.name}`);
      tab = 'games';
      drawTabs();
      drawPanel();
    }
    game.mount.update(msg.state);
  }

  offs.push(
    ws.on('presence', () => {
      if (phase === 'lobby') {
        drawPeople();
        drawGameInfo();
      } else if (phase === 'searching') drawStage();
    }),
    ws.on('matched', onMatched),
    ws.on('signal', (msg) => match && msg.matchId === match.id && peer?.signal(msg.data)),
    ws.on('partner-left', () => {
      if (phase !== 'matched') return;
      // The server has already put us back in the queue.
      const who = match?.partner.handle;
      teardownMatch();
      phase = 'searching';
      note = who ? `${who} left` : null;
      drawStage();
      drawControls();
      drawPanel();
      drawTabs();
    }),
    ws.on('chat', (msg) => phase === 'matched' && addMsg('them', msg.text)),
    ws.on('game', onGame),
    ws.on('game:event', (msg) => game?.mount.event?.(msg.data)),
    ws.on('close', () => {
      if (phase === 'lobby') return;
      teardownMatch();
      phase = 'searching';
      note = 'Connection dropped. Reconnecting';
      drawStage();
      drawControls();
      drawPanel();
    }),
    ws.on('open', () => {
      if (phase === 'lobby') return;
      note = null;
      search();
    }),
  );

  lobby();

  return {
    el,
    destroy() {
      destroyed = true;
      offs.forEach((off) => off());
      if (phase !== 'lobby') ws.send({ t: 'leave' });
      teardownMatch();
      stream?.getTracks().forEach((t) => t.stop());
    },
  };
}
