// ELD tokenlarini bazada AES-256-GCM bilan shifrlash.
// Kalit SECRET_KEY dan olinadi (istalgan uzunlikdagi satr — sha256 orqali
// 32 baytga keltiriladi). Kalit bo'lmasa (faqat lokal) token "plain:" bilan
// saqlanadi; production'da kalitsiz ishga tushish server.js da to'xtatiladi.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

function key() {
  return createHash('sha256').update(config.secretKey).digest();
}

export function seal(plain) {
  if (!config.secretKey) return `plain:${plain}`;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

// Ochib bo'lmasa null qaytaradi (masalan SECRET_KEY almashtirilgan bo'lsa) —
// bu holda ulanish "qayta ulash kerak" deb ko'rsatiladi, server yiqilmaydi.
export function open(sealed) {
  if (typeof sealed !== 'string') return null;
  if (sealed.startsWith('plain:')) return sealed.slice(6);
  const [v, iv, tag, data] = sealed.split(':');
  if (v !== 'v1' || !config.secretKey) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
