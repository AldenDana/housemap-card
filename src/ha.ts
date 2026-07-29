import type { HaArea, HaDevice, HaEntity, HaState, RoomKey } from './types';
import { rooms } from './rooms';

const ENTITY_DOMAIN_PRIORITY = ['light','switch','fan','climate','cover','media_player','vacuum','lock','binary_sensor','sensor','button','camera','select','number','todo'];

// Shape of the real Home Assistant frontend `hass` object, as handed to any
// Lovelace custom card via its `hass` setter. When this app runs as a
// standalone build (iframed, with its own long-lived token - see token()
// below), there is no such object and every function below falls back to the
// REST/raw-WebSocket path instead. When it runs as the `housemap-card`
// custom element (see housemap-card.tsx), the real one is passed through, so
// there's no separate auth/token/polling loop at all - HA pushes live state.
export interface HassLike {
  states: Record<string, HaState>;
  callService: (domain: string, service: string, data?: Record<string, unknown>) => Promise<unknown>;
  callWS: <T>(msg: Record<string, unknown>) => Promise<T>;
  auth: { data: { access_token: string } };
  hassUrl: (path?: string) => string;
}

export function token(): string {
  return window.HOUSEMAP_HA_TOKEN || localStorage.getItem('housemap_ha_token') || '';
}

export function haBase(): string {
  return window.location.origin;
}

export function wsUrl(): string {
  return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/websocket`;
}

// Auth header for one-off fetches this app still makes itself even in card
// mode (currently just the person entity_picture fetch) - uses the real
// session's access token when embedded, the standalone long-lived token
// otherwise.
export function authHeader(hass?: HassLike): Record<string, string> {
  const accessToken = hass ? hass.auth.data.access_token : token();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

// Standalone mode uses this for both its initial load AND its 30s poll loop.
// Card mode never polls (states are already live via the `hass` prop) but
// still needs a one-off fresh snapshot right after a service call whose
// success can only be confirmed by re-reading state (see the alarm disarm
// handler in App.tsx) - `hass.callWS({type:'get_states'})` is the same
// full-snapshot request the REST endpoint makes internally, just over the
// existing authenticated connection instead of a second token'd fetch.
export async function fetchStates(hass?: HassLike): Promise<Record<string, HaState>> {
  if (hass) {
    const list = await hass.callWS<HaState[]>({ type: 'get_states' });
    return Object.fromEntries(list.map(s => [s.entity_id, s]));
  }
  if (!token()) throw new Error('HA token missing');
  const res = await fetch(`${haBase()}/api/states`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error(`HA states failed: ${res.status}`);
  const list = await res.json() as HaState[];
  return Object.fromEntries(list.map(s => [s.entity_id, s]));
}

export async function callService(domain: string, service: string, data: Record<string, unknown> = {}, hass?: HassLike): Promise<void> {
  if (hass) { await hass.callService(domain, service, data); return; }
  if (!token()) throw new Error('HA token missing');
  const res = await fetch(`${haBase()}/api/services/${domain}/${service}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${txt}`);
}

async function haWsRequest<T>(type: string): Promise<T> {
  if (!token()) throw new Error('HA token missing');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl());
    const id = 1;
    const timer = window.setTimeout(() => { try { ws.close(); } catch {}; reject(new Error(`timeout: ${type}`)); }, 8000);
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token() }));
      else if (msg.type === 'auth_ok') ws.send(JSON.stringify({ id, type }));
      else if (msg.type === 'auth_invalid') { window.clearTimeout(timer); reject(new Error('auth invalid')); }
      else if (msg.id === id) {
        window.clearTimeout(timer);
        msg.success ? resolve(msg.result) : reject(new Error(msg.error?.message || type));
        ws.close();
      }
    };
    ws.onerror = () => { window.clearTimeout(timer); reject(new Error(`websocket failed: ${type}`)); };
  });
}

function normName(value: string): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function aliasesFor(key: RoomKey): Set<string> {
  const room = rooms[key];
  return new Set([room.name, ...room.areaNames].map(normName));
}

function entitySort(a: string, b: string): number {
  const da = a.split('.')[0], db = b.split('.')[0];
  const pa = ENTITY_DOMAIN_PRIORITY.indexOf(da), pb = ENTITY_DOMAIN_PRIORITY.indexOf(db);
  const ia = pa < 0 ? 999 : pa, ib = pb < 0 ? 999 : pb;
  if (ia !== ib) return ia - ib;
  return a.localeCompare(b);
}

function shouldShowEntity(ent: HaEntity): boolean {
  return Boolean(ent?.entity_id && !ent.disabled_by && !ent.hidden_by && !ent.entity_category);
}

function shouldKeepForRoom(key: RoomKey, ent: HaEntity): boolean {
  const patterns = rooms[key].excludeEntityPatterns || [];
  if (!patterns.length) return true;
  const haystack = [ent.entity_id, ent.name, ent.original_name, ent.translation_key].filter(Boolean).join(' ').toLowerCase();
  return !patterns.some(pattern => haystack.includes(pattern.toLowerCase()));
}

export async function loadRoomEntityMappings(hass?: HassLike): Promise<Record<RoomKey, string[]>> {
  const request = hass
    ? <T,>(type: string) => hass.callWS<T>({ type })
    : haWsRequest;
  const [areas, devices, entities] = await Promise.all([
    request<HaArea[]>('config/area_registry/list'),
    request<HaDevice[]>('config/device_registry/list'),
    request<HaEntity[]>('config/entity_registry/list')
  ]);

  const areaToRoom: Record<string, RoomKey> = {};
  for (const area of areas || []) {
    const normalized = normName(area.name);
    for (const key of Object.keys(rooms) as RoomKey[]) {
      if (aliasesFor(key).has(normalized)) areaToRoom[area.area_id] = key;
    }
  }

  const deviceToRoom: Record<string, RoomKey> = {};
  for (const device of devices || []) {
    const key = device.area_id ? areaToRoom[device.area_id] : undefined;
    if (key) deviceToRoom[device.id] = key;
  }

  // An entity manually curated into one room's fallbackEntities (a deliberate,
  // human-reviewed override, e.g. after auditing which device is really in which
  // physical room) should never ALSO leak into a different room via HA's own
  // live area/device registry - that registry can drift independently (a Tuya
  // device's area_id got silently reset to "master_bedroom" outside this app,
  // hours before this comment was written, even though the light itself is
  // manually assigned to Diego's room below) and would otherwise double-count
  // the same physical light in two rooms at once (lights toggle, room-tint, etc.
  // all firing for both).
  const fallbackClaimedBy: Record<string, RoomKey> = {};
  for (const key of Object.keys(rooms) as RoomKey[]) {
    for (const eid of rooms[key].fallbackEntities) fallbackClaimedBy[eid] = key;
  }

  const mapped = Object.fromEntries(Object.keys(rooms).map(k => [k, []])) as unknown as Record<RoomKey, string[]>;
  for (const ent of entities || []) {
    if (!shouldShowEntity(ent)) continue;
    const key = (ent.area_id ? areaToRoom[ent.area_id] : undefined) || (ent.device_id ? deviceToRoom[ent.device_id] : undefined);
    if (!key || !shouldKeepForRoom(key, ent)) continue;
    const claimedBy = fallbackClaimedBy[ent.entity_id];
    if (claimedBy && claimedBy !== key) continue;
    mapped[key].push(ent.entity_id);
  }
  for (const key of Object.keys(mapped) as RoomKey[]) mapped[key] = [...new Set(mapped[key])].sort(entitySort);
  return mapped;
}

export function mergedEntities(key: RoomKey, dynamic: Record<RoomKey, string[]>): string[] {
  if (rooms[key].fallbackOnly) return [...new Set(rooms[key].fallbackEntities)];
  return [...new Set([...(dynamic[key] || []), ...rooms[key].fallbackEntities])];
}
