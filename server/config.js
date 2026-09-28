import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function iceServers() {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL.split(',').map((s) => s.trim()),
      username: process.env.TURN_USER || '',
      credential: process.env.TURN_PASS || '',
    });
  }
  return servers;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  // Shared code friends need to create an account. Change it.
  inviteCode: process.env.SESH_CODE || 'puffpuffpass',
  dataDir: path.resolve(process.env.DATA_DIR || path.join(root, 'data')),
  publicDir: path.join(root, 'public'),
  maxUploadBytes: (Number(process.env.MAX_UPLOAD_MB) || 200) * 1024 * 1024,
  secureCookies: process.env.SECURE_COOKIES === '1',
  iceServers: iceServers(),
};

export const uploadsDir = () => path.join(config.dataDir, 'uploads');
