// One RTCPeerConnection per match. The server picks who offers, so there's
// no glare to resolve; signals are applied strictly in order.

import * as ws from './ws.js';

export function createPeer({ matchId, initiator, stream, iceServers, onRemote, onState }) {
  const pc = new RTCPeerConnection({ iceServers });
  let pending = [];
  let chain = Promise.resolve();
  let closed = false;

  const signal = (data) => ws.send({ t: 'signal', matchId, data });

  for (const track of stream.getTracks()) pc.addTrack(track, stream);

  pc.ontrack = (e) => onRemote(e.streams[0] || new MediaStream([e.track]));
  pc.onicecandidate = (e) => e.candidate && signal({ candidate: e.candidate.toJSON() });
  pc.onconnectionstatechange = () => onState(pc.connectionState);

  async function apply(data) {
    if (closed) return;
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      for (const c of pending) await pc.addIceCandidate(c).catch(() => {});
      pending = [];
      if (data.sdp.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        signal({ sdp: pc.localDescription.toJSON() });
      }
    } else if (data.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
      else pending.push(data.candidate);
    }
  }

  if (initiator) {
    chain = chain.then(async () => {
      await pc.setLocalDescription(await pc.createOffer());
      signal({ sdp: pc.localDescription.toJSON() });
    });
  }

  return {
    signal(data) {
      chain = chain.then(() => apply(data)).catch((err) => console.warn('rtc', err));
    },
    close() {
      closed = true;
      pc.ontrack = pc.onicecandidate = pc.onconnectionstatechange = null;
      pc.close();
    },
  };
}
