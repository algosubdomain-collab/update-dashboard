// Fleet keshining server nusxasi va fon yangilanishi.

import { config } from '../config.js';
import { dotService } from '../dot/index.js';
import { getProvider } from '../providers/index.js';
import { getConnection, listAllConnections, updateConnectionTokens } from '../store/index.js';
import { createFleetCache } from './cache.js';

export const fleet = createFleetCache({
  getConnection,
  getProvider,
  saveTokens: updateConnectionTokens,
  annotate: (login, provider, drivers) => dotService().annotate(login, provider, drivers),
  activeWindowMs: config.activeWindowHours * 3600_000,
  log: (m) => console.log(m),
});

let timer = null;
let lastTickAt = null;
// Bir vaqtda nechta ulanish yig'ilishi mumkin (umumiy). Har ulanish mustaqil:
// sekin platforma (masalan 100 s davom etgan Leader yig'ishi) faqat o'zini
// kutadi — boshqa foydalanuvchilarning yangilanishi o'tkazib yuborilmaydi.
const MAX_PARALLEL = 3;
let active = 0;
const waiting = [];

// Fon yangilanishi jadvali — interfeysda "har 60 s · keyingisi 35 s dan keyin".
export function schedule() {
  const intervalSec = config.refreshIntervalSec;
  return { intervalSec, nextAt: lastTickAt ? new Date(lastTickAt + intervalSec * 1000).toISOString() : null };
}

function pump() {
  while (active < MAX_PARALLEL && waiting.length) {
    const { login, provider } = waiting.shift();
    active++;
    fleet
      .refresh(login, provider)
      .catch((err) => console.error(`[fleet] ${login}:${provider}:`, err.message))
      .finally(() => {
        active--;
        pump();
      });
  }
}

async function tick() {
  lastTickAt = Date.now();
  try {
    const conns = await listAllConnections();
    for (const c of conns) {
      // Shu ulanish hali yig'ilayotgan yoki navbatda bo'lsa — ustma-ust
      // qo'shmaymiz, aks holda sekin platformaga so'rovlar to'planib qoladi.
      if (fleet.isRefreshing(c.login, c.provider)) continue;
      if (waiting.some((w) => w.login === c.login && w.provider === c.provider)) continue;
      waiting.push({ login: c.login, provider: c.provider });
    }
    pump();
  } catch (err) {
    console.error('[fleet] fon yangilanishi xatosi:', err.message);
  }
}

export function startBackgroundRefresh() {
  if (timer) return;
  tick();
  timer = setInterval(tick, config.refreshIntervalSec * 1000);
  // Jarayon faqat shu taymer uchun tirik qolmasin (testlar, to'xtatish).
  timer.unref?.();
}

export function stopBackgroundRefresh() {
  clearInterval(timer);
  timer = null;
}
