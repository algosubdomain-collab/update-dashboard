// Fleet keshining server nusxasi va fon yangilanishi.

import { config } from '../config.js';
import { dotService } from '../dot/index.js';
import { getProvider } from '../providers/index.js';
import { mapLimit } from '../providers/pool.js';
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
let running = false;

async function tick() {
  // Oldingi aylanish hali tugamagan bo'lsa (sekin API) — ustma-ust
  // boshlamaymiz, aks holda so'rovlar to'planib qoladi.
  if (running) return;
  running = true;
  try {
    const conns = await listAllConnections();
    await mapLimit(conns, 2, (c) => fleet.refresh(c.login, c.provider));
  } catch (err) {
    console.error('[fleet] fon yangilanishi xatosi:', err.message);
  } finally {
    running = false;
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
