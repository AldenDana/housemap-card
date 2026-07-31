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
  // The real HA frontend's own per-user preference (Settings > General >
  // Time format), stored server-side and independent of anything the
  // browser/device's own locale resolves - live-confirmed on this instance:
  // {"time_format":"24",...} even though the browser's own locale (en-US)
  // would otherwise default to 12h. This is why HA's own UI reliably shows
  // the format a user actually chose while a plain toLocaleTimeString([])
  // call can't - it has no visibility into this HA-side setting at all.
  locale?: { time_format?: string; language?: string };
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

// Scripts labeled this way in HA (Settings > Areas & Labels) render as a
// dedicated "zone clean" button in their assigned room's Cleaning section
// instead of the generic entity list - e.g. script.vacuum_clean_baby_zone /
// vacuum_clean_lunch_table, both labeled + area-assigned to Living Room live
// in HA. Adding a new per-zone vacuum preset in the future is then just
// "create the script, give it this label and an Area" - no app code change,
// no new hardcoded per-room flag here.
const ZONE_ACTION_LABEL = 'vacuum_zone';

export interface RoomData {
  entities: Record<RoomKey, string[]>;
  zoneActions: Record<RoomKey, string[]>;
}

export async function loadRoomEntityMappings(hass?: HassLike): Promise<RoomData> {
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

  // Some integrations (Tuya/local_tuya in particular) expose BOTH a raw
  // switch.* entity and an abstracted light.* entity for the SAME relay on
  // the same physical device (e.g. switch.lampara_cine + light.lampara_cine_2
  // - confirmed live, identical device_id, genuinely the one relay exported
  // twice). But sharing a device_id is NOT enough on its own to call it a
  // duplicate: HA groups entities by physical HARDWARE unit, and a real
  // multi-gang device (a 2-socket nightstand plug, a switch+fan combo) can
  // have several genuinely different, independently-controllable entities
  // under that same device_id - e.g. switch.ventilador_switch_1 (a fan) and
  // switch.lights_living_room_socket_1 (a second, distinct socket) both
  // share a device_id with a Master Bedroom light but control something
  // completely different, and were wrongly disappearing under a same-device
  // rule alone (caught by Javier: "why don't I see all the devices there").
  // Distinguish the two cases by comparing entity_id text, not just
  // device_id - the true duplicates share their meaningful name tokens with
  // the light ("lampara_cine" / "lampara_cine_2"), the false positives don't
  // ("ventilador" shares nothing with "luz_habitacion").
  const GENERIC_ENTITY_TOKENS = new Set(['switch', 'socket', 'plug', 'outlet']);
  function nameTokens(entityId: string): Set<string> {
    const slug = entityId.replace(/^[^.]+\./, '');
    return new Set(slug.split('_').filter(t => t && !/^\d+$/.test(t) && !GENERIC_ENTITY_TOKENS.has(t)));
  }
  function sharesIdentity(a: Set<string>, b: Set<string>): boolean {
    if (!a.size || !b.size) return false;
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    for (const t of small) if (!big.has(t)) return false;
    return true;
  }
  const lightTokensByDevice = new Map<string, Set<string>[]>();
  for (const ent of entities || []) {
    if (ent.entity_id.startsWith('light.') && ent.device_id) {
      const list = lightTokensByDevice.get(ent.device_id) || [];
      list.push(nameTokens(ent.entity_id));
      lightTokensByDevice.set(ent.device_id, list);
    }
  }
  function isDuplicateOfALight(ent: HaEntity): boolean {
    if (!ent.entity_id.startsWith('switch.') || !ent.device_id) return false;
    const lightTokenSets = lightTokensByDevice.get(ent.device_id);
    if (!lightTokenSets) return false;
    const switchTokens = nameTokens(ent.entity_id);
    return lightTokenSets.some(lt => sharesIdentity(switchTokens, lt));
  }

  // HA's own live area/device registry is the authoritative source for which
  // physical room an entity is in - it's what Javier actually edits (Settings >
  // Areas) when a device is mis-placed, so it must always win. Track it per
  // entity so the fallback pass below can tell "HA has no opinion, use my
  // manual guess" apart from "HA disagrees with my manual guess, HA wins."
  const dynamicRoomOf: Record<string, RoomKey> = {};
  const mapped = Object.fromEntries(Object.keys(rooms).map(k => [k, []])) as unknown as Record<RoomKey, string[]>;
  const zoneActions = Object.fromEntries(Object.keys(rooms).map(k => [k, []])) as unknown as Record<RoomKey, string[]>;
  for (const ent of entities || []) {
    if (!shouldShowEntity(ent)) continue;
    if (isDuplicateOfALight(ent)) continue;
    const key = (ent.area_id ? areaToRoom[ent.area_id] : undefined) || (ent.device_id ? deviceToRoom[ent.device_id] : undefined);
    if (!key || !shouldKeepForRoom(key, ent)) continue;
    dynamicRoomOf[ent.entity_id] = key;
    if (ent.entity_id.startsWith('script.') && (ent.labels || []).includes(ZONE_ACTION_LABEL)) {
      zoneActions[key].push(ent.entity_id);
      continue; // rendered as its own Cleaning-section button, not in the generic entity list
    }
    mapped[key].push(ent.entity_id);
  }

  // fallbackEntities is a genuine fallback, not an override: it only fills in
  // entities HA itself has no area/device placement for at all (or that got
  // filtered out above, e.g. entity_category-hidden helpers). If HA's live
  // data already placed an entity in a different room than a fallback list
  // claims, HA wins silently - the fix belongs in HA's own Area assignment,
  // not in a second hardcoded list here.
  for (const key of Object.keys(rooms) as RoomKey[]) {
    for (const eid of rooms[key].fallbackEntities) {
      const liveKey = dynamicRoomOf[eid];
      if (liveKey && liveKey !== key) continue;
      mapped[key].push(eid);
    }
  }

  for (const key of Object.keys(mapped) as RoomKey[]) mapped[key] = [...new Set(mapped[key])].sort(entitySort);
  for (const key of Object.keys(zoneActions) as RoomKey[]) zoneActions[key] = [...new Set(zoneActions[key])].sort();
  return { entities: mapped, zoneActions };
}

// mappings passed in here already have fallbackEntities folded in (see
// loadRoomEntityMappings above) - this just dedupes, kept as a named function
// since every call site reads more clearly as "the entities for this room"
// than reaching into the mappings record directly.
export function mergedEntities(key: RoomKey, mappings: Record<RoomKey, string[]>): string[] {
  return [...new Set(mappings[key] || [])];
}
