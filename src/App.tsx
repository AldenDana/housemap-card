import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, type PanInfo } from 'framer-motion';
import {
  mdiArrowLeft, mdiRobotVacuum, mdiBabyCarriage,
  mdiLightbulb, mdiLightbulbOutline, mdiToggleSwitch, mdiToggleSwitchOffOutline,
  mdiFan, mdiFanOff, mdiAirHumidifier, mdiAirHumidifierOff,
  mdiWindowShutter, mdiWindowShutterOpen, mdiLock, mdiLockOpenVariant,
  mdiGestureTapButton, mdiPalette, mdiScriptText,
  mdiShield, mdiShieldOff, mdiShieldHome, mdiShieldLock, mdiShieldMoon, mdiShieldAirplane, mdiShieldOutline, mdiBellRing,
  mdiEye, mdiEyeOff, mdiCheck, mdiClose,
  mdiHome, mdiBriefcase, mdiHomeExportOutline, mdiHelp, mdiThermometer, mdiWaterPercent,
} from '@mdi/js';
import { Floorplan } from './Floorplan';
import { roomOrder, rooms } from './rooms';
import type { ClimateKind, ClimatePoint, HaState, RoomClimate, RoomKey } from './types';
import { authHeader, callService, fetchStates, haBase, loadRoomEntityMappings, mergedEntities, type HassLike } from './ha';
// Deliberately NOT imported here - each entry point pulls styles.css itself,
// in whatever form that mode needs (main.tsx: a plain side-effect import,
// same as always; housemap-card.tsx: `?inline` as a raw string, injected
// into its own shadow root). Importing it here too would pull BOTH forms
// into the card bundle's module graph and Vite would extract a second,
// separate CSS asset file even with cssCodeSplit:false - defeating the
// point of a single self-contained file HACS can serve.

const WEATHER_ENTITY = 'weather.forecast_home';
const ALARM_ENTITY = 'alarm_control_panel.alarmo';
const PEOPLE_ENTITIES = ['person.alden', 'person.ana'];

// Fire 7 landscape (1024x600) is the primary target; the panel stays a static
// always-visible side card there. Below a narrow phone-portrait breakpoint the
// floorplan goes fullscreen by default and the panel becomes a drag-out drawer
// from the right edge instead (see DRAWER_HANDLE_PX / .panel phone-drawer CSS).
const PHONE_DRAWER_MAX_WIDTH = 560;
const DRAWER_HANDLE_PX = 30;
const PANEL_RIGHT_INSET = 14; // matches .panel's CSS `right:14px`
function useIsPhoneDrawer(): boolean {
  const query = () => window.innerWidth <= PHONE_DRAWER_MAX_WIDTH && window.innerHeight > window.innerWidth;
  const [isPhoneDrawer, setIsPhoneDrawer] = useState(query);
  useEffect(() => {
    const handler = () => setIsPhoneDrawer(query());
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', handler);
    return () => { window.removeEventListener('resize', handler); window.removeEventListener('orientationchange', handler); };
  }, []);
  return isPhoneDrawer;
}

function Icon({ path, size = 20 }: { path: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block', flex: '0 0 auto' }}><path fill="currentColor" d={path} /></svg>;
}

const ROOM_CLEAN_DEFAULTS = { mode: 3, sweep_mop_type: 3, water_level: 2, clean_times: 1 };
const blankMappings = Object.fromEntries(Object.keys(rooms).map(k => [k, []])) as unknown as Record<RoomKey, string[]>;
const LIGHT_PRESETS = [
  { name: 'Light Blue', hex: '#bfe3ff' },
  { name: 'White', hex: '#ffffff' },
  { name: 'Orange', hex: '#ffb15e' },
  { name: 'Yellow', hex: '#ffe28a' },
];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Neutral pale base every lit room blends toward, rather than each room's own
// fill (some rooms use an SVG tile pattern, not a plain color, which can't be
// blended directly) - close to the corridor's own fill so the tint reads as a
// natural extension of the existing palette, not an unrelated color swatch.
const ROOM_TINT_BASE: [number, number, number] = [227, 231, 241];
const ROOM_TINT_RATIO = 0.55;
function blendWithBase(rgb: [number, number, number], base: [number, number, number], ratio: number): string {
  const r = Math.round(rgb[0] * ratio + base[0] * (1 - ratio));
  const g = Math.round(rgb[1] * ratio + base[1] * (1 - ratio));
  const b = Math.round(rgb[2] * ratio + base[2] * (1 - ratio));
  return `rgb(${r},${g},${b})`;
}

function friendly(states: Record<string, HaState>, eid: string): string {
  return String(states[eid]?.attributes?.friendly_name || eid.replace(/^[^.]+\./, '').replaceAll('_', ' '));
}
function entityValue(states: Record<string, HaState>, eid: string): string {
  const state = states[eid];
  if (!state) return 'not found';
  const unit = state.attributes?.unit_of_measurement ? ` ${state.attributes.unit_of_measurement}` : '';
  return `${state.state}${unit}`;
}
function isLiveEntity(states: Record<string, HaState>, eid: string): boolean {
  const st = states[eid]?.state;
  return Boolean(st && st !== 'unavailable' && st !== 'unknown');
}
function actionFor(eid: string, state?: HaState): { label: string; domain: string; service: string } | null {
  const domain = eid.split('.')[0];
  const st = state?.state;
  if (['light', 'switch', 'fan', 'input_boolean'].includes(domain)) return { label: st === 'on' ? 'Off' : 'On', domain, service: 'toggle' };
  if (domain === 'humidifier') return { label: st === 'on' ? 'Off' : 'On', domain, service: 'toggle' };
  if (domain === 'cover') return { label: st === 'open' ? 'Close' : 'Open', domain, service: st === 'open' ? 'close_cover' : 'open_cover' };
  if (domain === 'lock') return { label: st === 'locked' ? 'Unlock' : 'Lock', domain, service: st === 'locked' ? 'unlock' : 'lock' };
  if (domain === 'button' || domain === 'input_button') return { label: 'Press', domain, service: 'press' };
  if (domain === 'scene') return { label: 'Run', domain, service: 'turn_on' };
  if (domain === 'script') return { label: 'Run', domain, service: 'turn_on' };
  return null;
}
// Icon (and whether it should render "active"/lit-up) per entity, same domain
// vocabulary as HA's own default entity icons — mirrors actionFor's domain
// switch so the badge always matches the action a tap would actually take.
function actionIcon(eid: string, state?: HaState): string {
  const domain = eid.split('.')[0];
  const st = state?.state;
  switch (domain) {
    case 'light': return st === 'on' ? mdiLightbulb : mdiLightbulbOutline;
    case 'switch':
    case 'input_boolean': return st === 'on' ? mdiToggleSwitch : mdiToggleSwitchOffOutline;
    case 'fan': return st === 'on' ? mdiFan : mdiFanOff;
    case 'humidifier': return st === 'on' ? mdiAirHumidifier : mdiAirHumidifierOff;
    case 'cover': return st === 'open' ? mdiWindowShutterOpen : mdiWindowShutter;
    case 'lock': return st === 'locked' ? mdiLock : mdiLockOpenVariant;
    case 'button':
    case 'input_button': return mdiGestureTapButton;
    case 'scene': return mdiPalette;
    case 'script': return mdiScriptText;
    default: return mdiToggleSwitchOffOutline;
  }
}
function actionIsActive(eid: string, state?: HaState): boolean {
  const domain = eid.split('.')[0];
  const st = state?.state;
  if (domain === 'cover') return st === 'open';
  if (domain === 'lock') return st !== 'locked';
  if (domain === 'button' || domain === 'input_button' || domain === 'scene' || domain === 'script') return false;
  return st === 'on';
}
function isVacuumDockControl(eid: string, states: Record<string, HaState>): boolean {
  const domain = eid.split('.')[0];
  if (domain !== 'button' && domain !== 'input_button') return false;
  const state = states[eid];
  const haystack = [
    eid,
    state?.attributes?.friendly_name,
    state?.attributes?.device_class,
  ].filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return (
    (haystack.includes('dock') || haystack.includes('base') || haystack.includes('return')) &&
    (haystack.includes('vacuum') || haystack.includes('robot') || haystack.includes('cleaner') || haystack.includes('xiaomi'))
  );
}
function shouldShowInRoomPanel(eid: string, states: Record<string, HaState>): boolean {
  if (!isLiveEntity(states, eid)) return false;
  if (isVacuumDockControl(eid, states)) return false;
  return Boolean(actionFor(eid, states[eid]));
}
function uniqueVisibleControls(eids: string[], states: Record<string, HaState>): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const eid of eids) {
    if (!shouldShowInRoomPanel(eid, states)) continue;
    const key = friendly(states, eid).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(eid);
  }
  return kept;
}
function climateKind(eid: string, state?: HaState): ClimateKind | null {
  if (!state) return null;
  const deviceClass = String(state.attributes?.device_class || '').toLowerCase();
  const unit = String(state.attributes?.unit_of_measurement || '').toLowerCase();
  const haystack = `${eid} ${friendly({ [eid]: state }, eid)} ${deviceClass} ${unit}`.toLowerCase();
  if (deviceClass === 'temperature' || haystack.includes('temperature') || haystack.includes('temperatura')) return 'temperature';
  if (deviceClass === 'humidity' || haystack.includes('humidity') || haystack.includes('humedad')) return 'humidity';
  if (deviceClass === 'illuminance' || unit === 'lx' || unit === 'lux' || haystack.includes('illuminance') || haystack.includes('lux')) return 'lux';
  if (deviceClass === 'carbon_dioxide' || haystack.includes('carbon_dioxide') || haystack.includes('co2') || haystack.includes('co₂')) return 'co2';
  return null;
}
function formatClimate(kind: ClimateKind, state: HaState): string {
  const num = Number(state.state);
  if (Number.isFinite(num)) {
    if (kind === 'temperature') return `${num.toFixed(1)}°`;
    if (kind === 'humidity') return `${Math.round(num)}%`;
    return `${Math.round(num)}`;
  }
  const unit = state.attributes?.unit_of_measurement ? String(state.attributes.unit_of_measurement) : '';
  return `${state.state}${unit}`;
}
function buildRoomClimate(states: Record<string, HaState>, mappings: Record<RoomKey, string[]>): Record<RoomKey, RoomClimate> {
  const out = Object.fromEntries(roomOrder.map(k => [k, {}])) as Record<RoomKey, RoomClimate>;
  for (const key of roomOrder) {
    // Keep climate badges deliberately curated. The room control panel can use broad
    // HA area-derived mappings, but badges should only appear where we have a real
    // live room sensor for that room. Otherwise broad/global weather or device
    // telemetry can make every room look like it has climate data.
    const candidates = [...new Set(rooms[key].climateEntities || [])];
    for (const eid of candidates) {
      if (!isLiveEntity(states, eid)) continue;
      const state = states[eid];
      const kind = climateKind(eid, state);
      if (!kind || out[key][kind]) continue;
      out[key][kind] = { kind, label: friendly(states, eid), value: formatClimate(kind, state) } as ClimatePoint;
    }
  }
  return out;
}

function averageHouseClimate(states: Record<string, HaState>, kind: ClimateKind): number | null {
  const vals: number[] = [];
  for (const key of roomOrder) {
    for (const eid of rooms[key].climateEntities || []) {
      if (!isLiveEntity(states, eid) || climateKind(eid, states[eid]) !== kind) continue;
      const num = Number(states[eid].state);
      if (Number.isFinite(num)) { vals.push(num); break; }
    }
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

const WEATHER_EMOJI: Record<string, string> = {
  'clear-night': '🌙', sunny: '☀️', partlycloudy: '⛅', cloudy: '☁️', fog: '🌫️',
  rainy: '🌧️', pouring: '🌧️', snowy: '❄️', 'snowy-rainy': '🌨️',
  lightning: '⛈️', 'lightning-rainy': '⛈️', hail: '🌨️', windy: '🌬️', 'windy-variant': '🌬️', exceptional: '⚠️',
};
function weatherEmoji(condition: string): string { return WEATHER_EMOJI[condition] || '🌡️'; }
function weatherLabel(condition: string): string {
  if (condition === 'partlycloudy') return 'Partly cloudy';
  return condition.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// This app is iframed into the outer HA dashboard, so navigating window.location
// would just replace what's shown inside the iframe slot, leaving no way back
// to the floorplan without re-navigating. window.top swaps the whole browser
// view instead, exactly like clicking the sidebar entry directly.
function openWeatherDashboard() {
  try { window.top!.location.href = '/dashboard-weather/weather'; }
  catch { window.location.href = '/dashboard-weather/weather'; }
}

// Modes are visually distinct at rest (not just a generic "armed" green) so which
// mode is active reads at a glance — matches the real Alarmo config: away/vacation
// both carry real exit+entry delays, night arms instantly (see useAlarmCountdown).
// Icons match Home Assistant's own alarm_control_panel domain icon set (the same
// one Mushroom's alarm-control-panel-card falls back to) rather than emoji, so
// they read as real shield iconography instead of a random assortment of symbols.
const ALARM_MODES = [
  { mode: 'away', service: 'alarm_arm_away', label: 'Away', icon: mdiShieldLock, className: 'away' },
  { mode: 'night', service: 'alarm_arm_night', label: 'Night', icon: mdiShieldMoon, className: 'night' },
  { mode: 'vacation', service: 'alarm_arm_vacation', label: 'Vacation', icon: mdiShieldAirplane, className: 'vacation' },
] as const;
const ALARM_META: Record<string, { label: string; icon: string; className: string }> = {
  disarmed: { label: 'Disarmed', icon: mdiShieldOff, className: 'disarmed' },
  armed_home: { label: 'Armed home', icon: mdiShieldHome, className: 'armed away' },
  armed_away: { label: 'Armed away', icon: mdiShieldLock, className: 'armed away' },
  armed_night: { label: 'Armed night', icon: mdiShieldMoon, className: 'armed night' },
  armed_vacation: { label: 'Armed vacation', icon: mdiShieldAirplane, className: 'armed vacation' },
  pending: { label: 'Pending…', icon: mdiShieldOutline, className: 'pending' },
  arming: { label: 'Arming…', icon: mdiShieldOutline, className: 'arming' },
  disarming: { label: 'Disarming…', icon: mdiShieldOutline, className: 'pending' },
  triggered: { label: 'ALARM TRIGGERED', icon: mdiBellRing, className: 'triggered' },
};
function alarmMeta(state?: string) { return ALARM_META[state || ''] || { label: state || 'Unknown', icon: mdiShield, className: '' }; }

// Real Alarmo exposes the current phase's total delay (seconds) as a `delay` attribute
// and the phase-entry time as the entity's own last_changed — ticks a live countdown
// during arming (exit delay) / pending (post-trip entry delay) instead of static text.
function useAlarmCountdown(alarmState?: HaState): number | null {
  const [now, setNow] = useState(() => Date.now());
  const active = alarmState?.state === 'arming' || alarmState?.state === 'pending';
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!active || !alarmState) return null;
  const delay = Number(alarmState.attributes?.delay);
  if (!Number.isFinite(delay)) return null;
  const changedAt = new Date(alarmState.last_changed || Date.now()).getTime();
  return Math.max(0, Math.ceil(delay - (now - changedAt) / 1000));
}

function PanelClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="overviewClock">
    <div className="overviewTime">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
    <div className="overviewDate">{now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</div>
  </div>;
}

// Real HA person states: 'home' (in zone.home), a named zone's own id when inside it
// (this house only has zone.work configured, so 'work' is the only other real zone
// value), 'not_home' (outside every zone = away), or 'unknown'/'unavailable' (no
// location data at all, e.g. a tracker that's offline) - four real states, not binary.
type Presence = 'home' | 'work' | 'away' | 'unknown';
// Icons match the real mushroom-person-card's badge exactly (its own
// getStateIcon, not HA core's generic account-arrow default) - confirmed live
// via its shadow DOM, not guessed: home uses the zone's own icon (mdi:home),
// away is specifically "left home" (mdi:home-export-outline) not a bare arrow,
// and "work" uses zone.work's own configured icon (mdi:briefcase) rather than
// a generic fallback.
const PRESENCE_META: Record<Presence, { label: string; className: string; icon: string }> = {
  home: { label: 'Home', className: 'home', icon: mdiHome },
  work: { label: 'Work', className: 'work', icon: mdiBriefcase },
  away: { label: 'Away', className: 'away', icon: mdiHomeExportOutline },
  unknown: { label: 'Unknown', className: 'unknown', icon: mdiHelp },
};
function presenceOf(state?: HaState): Presence {
  const st = state?.state;
  if (!st || st === 'unknown' || st === 'unavailable') return 'unknown';
  if (st === 'home') return 'home';
  if (st === 'not_home') return 'away';
  if (st === 'work') return 'work';
  return 'away'; // any other configured zone name: still meaningfully "not home"
}

function PersonBadge({ eid, states, hass }: { eid: string; states: Record<string, HaState>; hass?: HassLike }) {
  const state = states[eid];
  const presence = presenceOf(state);
  const meta = PRESENCE_META[presence];
  const picPath = state?.attributes?.entity_picture as string | undefined;
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!picPath) { setPhotoUrl(null); return; }
    let objectUrl = '';
    let cancelled = false;
    fetch(`${haBase()}${picPath}`, { headers: authHeader(hass) })
      .then(res => res.ok ? res.blob() : Promise.reject(new Error('photo fetch failed')))
      .then(blob => { if (!cancelled) { objectUrl = URL.createObjectURL(blob); setPhotoUrl(objectUrl); } })
      .catch(() => { if (!cancelled) setPhotoUrl(null); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [picPath, hass]);

  if (!state) return null;
  const name = friendly(states, eid);
  return <div className={`personBadge ${meta.className}`}>
    <div className="personAvatar">
      {photoUrl ? <img src={photoUrl} alt={name} onError={() => setPhotoUrl(null)} /> : <span>{name.charAt(0).toUpperCase()}</span>}
      <span className="personStatusDot"><Icon path={meta.icon} size={10} /></span>
    </div>
    <span className="personName">{name}</span>
    <span className="personStatus">{meta.label}</span>
  </div>;
}

function lightModes(states: Record<string, HaState>, eid: string): string[] {
  return (states[eid]?.attributes?.supported_color_modes as string[] | undefined) || [];
}
function supportsBrightness(states: Record<string, HaState>, eid: string): boolean {
  return lightModes(states, eid).some(m => m !== 'onoff');
}
function supportsColor(states: Record<string, HaState>, eid: string): boolean {
  return lightModes(states, eid).some(m => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(m));
}
function roomBrightnessPct(states: Record<string, HaState>, eids: string[]): number {
  const vals = eids.map(eid => {
    const b = states[eid]?.attributes?.brightness;
    return typeof b === 'number' ? Math.round(b / 255 * 100) : null;
  }).filter((v): v is number => v !== null);
  if (!vals.length) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export default function App({ hass, portalRoot = document.body }: { hass?: HassLike; portalRoot?: Element | DocumentFragment } = {}) {
  const [selected, setSelected] = useState<RoomKey | null>(null);
  // Standalone (iframed) mode polls its own REST snapshot into this. Card
  // mode ignores it entirely - `states` below reads live off `hass.states`
  // instead, which HA keeps updated via its own websocket, no polling needed.
  const [standaloneStates, setStandaloneStates] = useState<Record<string, HaState>>({});
  const states = hass ? hass.states : standaloneStates;
  const [mappings, setMappings] = useState<Record<RoomKey, string[]>>(blankMappings);
  const [log, setLog] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [alarmKeypadOpen, setAlarmKeypadOpen] = useState(false);
  const [armModalOpen, setArmModalOpen] = useState(false);
  const [alarmCode, setAlarmCode] = useState('');
  const [alarmError, setAlarmError] = useState(false);
  const [alarmCodeVisible, setAlarmCodeVisible] = useState(false);
  const [localClimate, setLocalClimate] = useState<Record<RoomKey, { temp: number; blinds: number }>>(
    () => Object.fromEntries(roomOrder.map(k => [k, { temp: 21, blinds: 0 }])) as Record<RoomKey, { temp: number; blinds: number }>
  );

  const isPhoneDrawer = useIsPhoneDrawer();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelWidth, setPanelWidth] = useState(300);
  useEffect(() => {
    if (!isPhoneDrawer) return;
    const measure = () => { if (panelRef.current) setPanelWidth(panelRef.current.getBoundingClientRect().width); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isPhoneDrawer]);
  // Panel rests via CSS `right:14px` (PANEL_RIGHT_INSET), so its natural left edge
  // already sits 14px in from the true screen edge - the shift needed to push the
  // panel itself fully off-screen (leaving ONLY .drawerHandle, which pokes out from
  // the panel's own left edge, visible) is the panel's full width plus that inset,
  // not width-minus-handle (that undercounted the inset and left panel content
  // bleeding into what should have been just the handle).
  const closedX = panelWidth + PANEL_RIGHT_INSET;

  const room = selected ? rooms[selected] : null;
  const entities = useMemo(() => selected ? mergedEntities(selected, mappings) : [], [selected, mappings]);
  const lightEntities = useMemo(() => entities.filter(eid => eid.startsWith('light.')), [entities]);
  const otherEntities = useMemo(() => entities.filter(eid => !eid.startsWith('light.')), [entities]);
  const visibleControls = useMemo(() => uniqueVisibleControls(otherEntities, states), [otherEntities, states]);
  const climate = useMemo(() => buildRoomClimate(states, mappings), [states, mappings]);
  const avgHouseTemp = useMemo(() => averageHouseClimate(states, 'temperature'), [states]);
  const avgHouseHumidity = useMemo(() => averageHouseClimate(states, 'humidity'), [states]);
  const weatherState = states[WEATHER_ENTITY];
  const alarmState = states[ALARM_ENTITY];

  const lightsOnByRoom = useMemo(() => {
    const out = Object.fromEntries(roomOrder.map(k => [k, false])) as Record<RoomKey, boolean>;
    for (const key of roomOrder) {
      const eids = mergedEntities(key, mappings).filter(eid => eid.startsWith('light.'));
      out[key] = eids.some(eid => states[eid]?.state === 'on');
    }
    return out;
  }, [states, mappings]);

  // Tints the room shape toward whatever color its lights are actually showing,
  // so illuminated rooms read at a glance on the whole-house view. Blended
  // against a neutral pale base (not the raw saturated light color) so room
  // labels stay legible and it still fits this app's soft palette - a plain
  // on/off or brightness-only light (no rgb_color reported) still tints, just
  // with a fixed warm-amber "lit" color since it has no real color to sample.
  const roomLightColorByRoom = useMemo(() => {
    const out = Object.fromEntries(roomOrder.map(k => [k, null])) as Record<RoomKey, string | null>;
    for (const key of roomOrder) {
      const eids = mergedEntities(key, mappings).filter(eid => eid.startsWith('light.'));
      const onEids = eids.filter(eid => states[eid]?.state === 'on');
      if (!onEids.length) continue;
      const colored = onEids
        .map(eid => states[eid]?.attributes?.rgb_color as number[] | undefined)
        .filter((c): c is number[] => Array.isArray(c) && c.length === 3);
      const rgb: [number, number, number] = colored.length
        ? [
          colored.reduce((sum, c) => sum + c[0], 0) / colored.length,
          colored.reduce((sum, c) => sum + c[1], 0) / colored.length,
          colored.reduce((sum, c) => sum + c[2], 0) / colored.length,
        ]
        : [255, 214, 130];
      out[key] = blendWithBase(rgb, ROOM_TINT_BASE, ROOM_TINT_RATIO);
    }
    return out;
  }, [states, mappings]);

  const lightsOn = selected ? lightsOnByRoom[selected] : false;
  const brightnessCapable = lightEntities.filter(eid => supportsBrightness(states, eid));
  const colorCapable = lightEntities.filter(eid => supportsColor(states, eid));
  const brightness = roomBrightnessPct(states, brightnessCapable);

  const climateEid = room?.climateEntity;
  const coverEid = room?.coverEntity;
  const liveTemp = climateEid ? (states[climateEid]?.attributes?.temperature as number | undefined) : undefined;
  const liveBlinds = coverEid ? (states[coverEid]?.attributes?.current_position as number | undefined) : undefined;
  const temp = typeof liveTemp === 'number' ? liveTemp : (selected ? localClimate[selected].temp : 21);
  const blinds = typeof liveBlinds === 'number' ? liveBlinds : (selected ? localClimate[selected].blinds : 0);

  const callSvc = (domain: string, service: string, data?: Record<string, unknown>) =>
    callService(domain, service, data, hass);

  async function refreshState() {
    try { setStandaloneStates(await fetchStates()); }
    catch { setLog('HA unavailable'); }
  }

  // Room<->entity mapping comes from HA's area/device/entity registries, which
  // change rarely - fetched once on mount either way. Standalone mode also
  // polls raw state every 30s here; card mode skips that entirely since
  // `states` above already reads live off the `hass` prop HA keeps current.
  // Deliberately `[]` deps: `hass` is read once at mount (already the real
  // object by then - the card wrapper never renders <App> before its first
  // `hass` is set), not on every subsequent state-driven re-render.
  useEffect(() => {
    if (hass) {
      loadRoomEntityMappings(hass)
        .then(mapped => { setMappings(mapped); setLog(''); })
        .catch(e => setLog(`HA areas unavailable: ${e.message}`));
      return;
    }
    refreshState();
    loadRoomEntityMappings()
      .then(mapped => { setMappings(mapped); setLog(''); })
      .catch(e => setLog(`HA areas unavailable: ${e.message}`))
      .finally(refreshState);
    const timer = window.setInterval(refreshState, 30_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alarmCountdown = useAlarmCountdown(alarmState);

  useEffect(() => { setPaletteOpen(false); setAlarmKeypadOpen(false); setArmModalOpen(false); setAlarmCode(''); setAlarmError(false); setAlarmCodeVisible(false); }, [selected]);

  // Phone-portrait drawer: tapping a room auto-opens the drawer so its controls are
  // immediately reachable; tapping the floorplan background closes an open drawer
  // first (so the map becomes tappable again) rather than deselecting immediately -
  // deselect only happens on a second background tap once the drawer is closed.
  function selectRoom(key: RoomKey | null) {
    if (key === null) {
      if (isPhoneDrawer && drawerOpen) { setDrawerOpen(false); return; }
      setSelected(null);
      setLog('');
      return;
    }
    const next = selected === key ? null : key;
    setSelected(next);
    if (isPhoneDrawer) setDrawerOpen(next !== null);
    setLog('');
  }

  async function cleanRoom() {
    if (!room) return;
    const payload: Record<string, unknown> = { room_id: room.roomId, ...ROOM_CLEAN_DEFAULTS };
    setLog(`Cleaning ${room.name}…`);
    await callSvc('script', 'vacuum_clean_rooms', payload);
    setLog(`Cleaning ${room.name}`);
  }
  async function babyZone() { setLog('Cleaning baby zone…'); await callSvc('script', 'vacuum_clean_baby_zone', {}); setLog('Cleaning baby zone'); }
  async function armMode(mode: typeof ALARM_MODES[number]) {
    setArmModalOpen(false);
    setLog(`Arming ${mode.label}…`);
    try {
      await callSvc('alarm_control_panel', mode.service, { entity_id: ALARM_ENTITY });
      window.setTimeout(refreshState, 600);
    } catch (e) {
      setLog(`Error: ${(e as Error).message}`);
    }
  }
  function openDisarmKeypad() {
    setAlarmCode('');
    setAlarmError(false);
    setAlarmKeypadOpen(true);
  }
  async function submitDisarm() {
    setLog('Disarming…');
    try {
      // Alarmo/HA don't surface a wrong code as an HTTP error - the service call
      // returns 200 either way and silently no-ops on a bad code (confirmed live:
      // a deliberately wrong code still returns 200 with the alarm left armed).
      // The only reliable way to know if it actually worked is to re-check the
      // entity's real state afterward, not trust the call not having thrown.
      await callSvc('alarm_control_panel', 'alarm_disarm', { entity_id: ALARM_ENTITY, code: alarmCode });
      await new Promise(r => window.setTimeout(r, 500));
      const fresh = await fetchStates(hass);
      if (!hass) setStandaloneStates(fresh);
      if (fresh[ALARM_ENTITY]?.state === 'disarmed') {
        setAlarmKeypadOpen(false);
        setAlarmCode('');
        setAlarmError(false);
        setLog('');
      } else {
        setAlarmError(true);
        setAlarmCode('');
        setLog('Wrong code');
      }
    } catch (e) {
      setAlarmError(true);
      setAlarmCode('');
      setLog(`Error: ${(e as Error).message}`);
    }
  }
  async function triggerEntity(eid: string) {
    const action = actionFor(eid, states[eid]);
    if (!action) return;
    setLog(`${action.label}: ${friendly(states, eid)}`);
    await callSvc(action.domain, action.service, { entity_id: eid });
    window.setTimeout(refreshState, 600);
  }

  async function toggleLights() {
    if (!lightEntities.length) return;
    setLog(lightsOn ? 'Lights off' : 'Lights on');
    await callSvc('light', lightsOn ? 'turn_off' : 'turn_on', { entity_id: lightEntities });
    window.setTimeout(refreshState, 600);
  }
  async function setBrightness(val: number) {
    if (!brightnessCapable.length) return;
    await callSvc('light', 'turn_on', { entity_id: brightnessCapable, brightness_pct: val });
    window.setTimeout(refreshState, 600);
  }
  async function pickColor(hex: string) {
    setPaletteOpen(false);
    if (!colorCapable.length) return;
    await callSvc('light', 'turn_on', { entity_id: colorCapable, rgb_color: hexToRgb(hex) });
    window.setTimeout(refreshState, 600);
  }
  async function bumpTemp(delta: number) {
    if (!selected) return;
    if (climateEid) {
      await callSvc('climate', 'set_temperature', { entity_id: climateEid, temperature: clamp(temp + delta, 16, 28) });
      window.setTimeout(refreshState, 600);
    } else {
      setLocalClimate(s => ({ ...s, [selected]: { ...s[selected], temp: clamp(s[selected].temp + delta, 16, 28) } }));
    }
  }
  async function setBlinds(val: number) {
    if (!selected) return;
    if (coverEid) {
      await callSvc('cover', 'set_cover_position', { entity_id: coverEid, position: val });
      window.setTimeout(refreshState, 600);
    } else {
      setLocalClimate(s => ({ ...s, [selected]: { ...s[selected], blinds: val } }));
    }
  }

  const brightnessTrack = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${brightness}%, var(--track) ${brightness}%, var(--track) 100%)`;
  const blindsTrack = `linear-gradient(to right, var(--accent) 0%, var(--accent) ${blinds}%, var(--track) ${blinds}%, var(--track) 100%)`;


  // Below the phone-portrait breakpoint the panel is a drag-out drawer: one
  // persistent element (so drag position survives content swaps) anchored to the
  // right edge, closed by default (floorplan fullscreen), with a visible grip
  // handle. On tablet/desktop it's the existing always-visible static side card.
  const drawerMotionProps = isPhoneDrawer
    ? {
      drag: 'x' as const,
      dragConstraints: { left: 0, right: closedX },
      dragElastic: 0.06,
      dragMomentum: false,
      animate: { x: drawerOpen ? 0 : closedX },
      transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] as const },
      onDragEnd: (_e: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => {
        // A fast flick snaps in its direction even without crossing the position
        // threshold below - matches how real drawer/carousel gestures feel; a slow
        // drag still falls back to "did it cross 35% of the way toward open".
        if (info.velocity.x < -500) { setDrawerOpen(true); return; }
        if (info.velocity.x > 500) { setDrawerOpen(false); return; }
        const startX = drawerOpen ? 0 : closedX;
        const finalX = clamp(startX + info.offset.x, 0, closedX);
        setDrawerOpen(finalX < closedX * 0.65);
      },
    }
    : {};
  const contentSlideProps = { initial: { opacity: 0.6 }, animate: { opacity: 1 }, exit: { opacity: 0.6 }, transition: { duration: 0.2 } };

  const alarmMetaNow = alarmState ? alarmMeta(alarmState.state) : null;
  const alarmSt = alarmState?.state;
  const showCountdown = (alarmSt === 'arming' || alarmSt === 'pending') && alarmCountdown !== null;

  // Phone-portrait Overview (no room selected) is a one-shot view: status info
  // stacked above the fullscreen floorplan, no drawer needed. The drag-drawer
  // stays reserved for the room-focused panel, once a room is actually tapped.
  const mobileOverview = isPhoneDrawer && !selected;

  return <div className="appShell">
    <header className="topbar compactTopbar">
      {log && <div className="statusPill logPill">{log}</div>}
    </header>

    <main className={`layout${mobileOverview ? ' mobileOverviewLayout' : ''}`}>
      {mobileOverview && <div className="mobileHeader">
        <div className="mobileHeaderTop">
          <span className="mobileClock">{new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          <div className="mobileHeaderPills">
            {weatherState && <div className="mobileWeatherPill" onClick={openWeatherDashboard}>
              <span>{weatherEmoji(weatherState.state)}</span>
              <span className="mobileWeatherTemp">{Math.round(Number(weatherState.attributes?.temperature))}°</span>
              <span className="mobileWeatherCond">{weatherLabel(weatherState.state)}</span>
            </div>}
            {(avgHouseTemp !== null || avgHouseHumidity !== null) && <div className="mobileWeatherPill mobileHousePill">
              {avgHouseTemp !== null && <><Icon path={mdiThermometer} size={14} /><span className="mobileWeatherTemp">{avgHouseTemp.toFixed(1)}°</span></>}
              {avgHouseHumidity !== null && <><Icon path={mdiWaterPercent} size={14} /><span className="mobileWeatherTemp">{avgHouseHumidity.toFixed(0)}%</span></>}
            </div>}
          </div>
        </div>
        <div className="peopleRow mobilePeopleRow">
          {PEOPLE_ENTITIES.map(eid => <PersonBadge key={eid} eid={eid} states={states} hass={hass} />)}
        </div>
        {alarmState && alarmMetaNow && <div className={`alarmStatus mobileAlarmCard ${alarmMetaNow.className}`}>
          <span className={`alarmIconChip ${alarmMetaNow.className}`}><Icon path={alarmMetaNow.icon} size={18} /></span>
          <div className="alarmStatusText">
            <span className="alarmStatusLabel">{alarmMetaNow.label}</span>
            {showCountdown && <span className="alarmCountdown">{alarmCountdown}s to {alarmSt === 'arming' ? 'exit' : 'disarm'}</span>}
          </div>
          {alarmSt === 'disarmed'
            ? <button className="alarmActionBtn mobileAlarmActionBtn alarmIconOnlyBtn" onClick={() => setArmModalOpen(true)}><Icon path={mdiShield} size={18} /></button>
            : <button className="alarmActionBtn mobileAlarmActionBtn alarmIconOnlyBtn" onClick={openDisarmKeypad}><Icon path={mdiShieldOff} size={18} /></button>}
        </div>}
      </div>}

      <section className="card mapCard">
        <div className="mapStage">
          <Floorplan selected={selected} onSelect={selectRoom} climate={climate} lightsOn={lightsOnByRoom} lightColor={roomLightColorByRoom} topAlign={mobileOverview} />
        </div>
      </section>

      {!mobileOverview && <motion.aside className="card panel" ref={panelRef} {...drawerMotionProps}>
        {isPhoneDrawer && <div className="drawerHandle" onClick={() => setDrawerOpen(o => !o)}><span /></div>}
        <AnimatePresence mode="wait">
          {room ? <motion.div className="panelInner" key="roomPanel" {...contentSlideProps}>
            <div className="panelHeader">
              <button className="btn back" onClick={() => selectRoom(null)}><Icon path={mdiArrowLeft} size={16} /></button>
              <h2>{room.name}</h2>
            </div>
            <div className="panelDivider" />

            {lightEntities.length > 0 && <div className="panelSection">
              <div className="sectionRow">
                <span className="sectionLabel">Lights</span>
                <div className={`toggleSwitch${lightsOn ? ' on' : ''}`} onClick={() => toggleLights().catch(e => setLog(`Error: ${e.message}`))}>
                  <div className="toggleKnob" />
                </div>
              </div>
              {brightnessCapable.length > 0 && <>
                <div className="brightnessRow" style={{ opacity: lightsOn ? 1 : 0.35 }}>
                  {colorCapable.length > 0 && <div className={`colorDot${paletteOpen ? ' open' : ''}`} onClick={() => setPaletteOpen(o => !o)} />}
                  <input type="range" min={0} max={100} step={5} value={brightness}
                    onChange={e => setBrightness(Number(e.target.value)).catch(err => setLog(`Error: ${err.message}`))}
                    style={{ background: brightnessTrack }} />
                </div>
                <div className="sectionHint">{brightness}%{colorCapable.length > 0 ? ' · tap dot for color' : ''}</div>
              </>}
              {colorCapable.length > 0 && paletteOpen && <div className="colorPresetRow">
                {LIGHT_PRESETS.map(p => <div key={p.hex} className="colorPreset" style={{ background: p.hex }} onClick={() => pickColor(p.hex).catch(e => setLog(`Error: ${e.message}`))} />)}
              </div>}
            </div>}

            {climateEid && <div className="panelSection">
              <span className="sectionLabel">Temperature</span>
              <div className="tempStepper">
                <div className="stepBtn" onClick={() => bumpTemp(-1).catch(e => setLog(`Error: ${e.message}`))}>−</div>
                <div className="tempValue">{Math.round(temp)}°</div>
                <div className="stepBtn" onClick={() => bumpTemp(1).catch(e => setLog(`Error: ${e.message}`))}>+</div>
              </div>
            </div>}

            {coverEid && <div className="panelSection">
              <div className="sectionRow">
                <span className="sectionLabel">Blinds</span>
                <span className="sectionValue">{blinds}%</span>
              </div>
              <input type="range" min={0} max={100} step={5} value={blinds}
                onChange={e => setBlinds(Number(e.target.value)).catch(err => setLog(`Error: ${err.message}`))}
                style={{ background: blindsTrack }} />
            </div>}

            <div className="panelSection">
              <span className="sectionLabel">Cleaning</span>
              <div className="actions">
                <button className="actionBadge primary" onClick={() => cleanRoom().catch(e => setLog(`Error: ${e.message}`))}>
                  <span className="badgeIcon"><Icon path={mdiRobotVacuum} /></span>
                  <span>Clean room</span>
                </button>
                {room.baby && <button className="actionBadge warnBtn" onClick={() => babyZone().catch(e => setLog(`Error: ${e.message}`))}>
                  <span className="badgeIcon"><Icon path={mdiBabyCarriage} /></span>
                  <span>Baby zone</span>
                </button>}
              </div>
            </div>

            {visibleControls.length > 0 && <div className="panelSection panelSectionGrow">
              <span className="sectionLabel">More</span>
              <div className="entityList">
                {visibleControls.map(eid => {
                  const active = actionIsActive(eid, states[eid]);
                  return (
                    <button className={`entity entityAction${active ? ' active' : ''}`} key={eid} title={entityValue(states, eid)} onClick={() => triggerEntity(eid).catch(e => setLog(`Error: ${e.message}`))}>
                      <span className="entityIcon"><Icon path={actionIcon(eid, states[eid])} size={18} /></span>
                      <b>{friendly(states, eid)}</b>
                    </button>
                  );
                })}
              </div>
            </div>}
          </motion.div> : <motion.div className="panelInner" key="overviewPanel" {...contentSlideProps}>
            <div className="panelSection">
              <PanelClock />
            </div>

            {weatherState && <div className="panelSection weatherSection" onClick={openWeatherDashboard}>
              <span className="sectionLabel">Weather</span>
              <div className="weatherRow">
                <span className="weatherEmoji">{weatherEmoji(weatherState.state)}</span>
                <span className="weatherTemp">{Math.round(Number(weatherState.attributes?.temperature))}°</span>
                <span className="weatherCond">{weatherLabel(weatherState.state)}</span>
              </div>
            </div>}

            {(avgHouseTemp !== null || avgHouseHumidity !== null) && <div className="panelSection">
              <span className="sectionLabel">House Climate</span>
              <div className="houseClimateRow">
                {avgHouseTemp !== null && <div className="houseClimateStat">
                  <Icon path={mdiThermometer} size={16} />
                  <span className="houseClimateValue">{avgHouseTemp.toFixed(1)}°</span>
                </div>}
                {avgHouseHumidity !== null && <div className="houseClimateStat">
                  <Icon path={mdiWaterPercent} size={16} />
                  <span className="houseClimateValue">{avgHouseHumidity.toFixed(0)}%</span>
                </div>}
              </div>
            </div>}

            {alarmState && alarmMetaNow && <div className="panelSection">
              <span className="sectionLabel">Alarm</span>
              <div className={`alarmStatus ${alarmMetaNow.className}`}>
                <span className={`alarmIconChip ${alarmMetaNow.className}`}><Icon path={alarmMetaNow.icon} size={18} /></span>
                <div className="alarmStatusText">
                  <span className="alarmStatusLabel">{alarmMetaNow.label}</span>
                  {showCountdown && <span className="alarmCountdown">{alarmCountdown}s to {alarmSt === 'arming' ? 'exit' : 'disarm'}</span>}
                </div>
              </div>

              {alarmSt === 'disarmed'
                ? <button className="alarmActionBtn alarmIconOnlyBtn" onClick={() => setArmModalOpen(true)}><Icon path={mdiShield} size={20} /></button>
                : <button className="alarmActionBtn alarmIconOnlyBtn" onClick={openDisarmKeypad}><Icon path={mdiShieldOff} size={20} /></button>}
            </div>}

            <div className="panelSection panelSectionGrow">
              <span className="sectionLabel">People</span>
              <div className="peopleRow">
                {PEOPLE_ENTITIES.map(eid => <PersonBadge key={eid} eid={eid} states={states} hass={hass} />)}
              </div>
            </div>
          </motion.div>}
        </AnimatePresence>
      </motion.aside>}
    </main>

    {/* Rendered via portal to portalRoot (document.body when standalone, the
        card's own shadow root when embedded as a Lovelace card - see
        housemap-card.tsx), not inside .panel - that element is animated/dragged
        (framer-motion applies a transform to it for the phone drawer), and a
        transformed ancestor becomes the containing block for any position:fixed
        descendant, which would break true viewport-centering here. Portaling
        into the shadow root specifically (not document.body) in card mode
        keeps these modals inside the shadow tree's own style scope - anything
        portaled straight to document.body from inside a shadow tree would
        render with zero CSS applied, since Shadow DOM style encapsulation
        cuts both ways. */}
    {armModalOpen && createPortal(
      <div className="modalBackdrop" onClick={() => setArmModalOpen(false)}>
        <div className="modalCard" onClick={e => e.stopPropagation()}>
          <div className="modalHeader">
            <span className="modalTitle">Arm Alarm</span>
            <div className="modalClose" onClick={() => setArmModalOpen(false)}>✕</div>
          </div>
          <div className="alarmModeColumn">
            {ALARM_MODES.map(m => (
              <button key={m.mode} className={`alarmModeBtnFull ${m.className}`} onClick={() => armMode(m).catch(e => setLog(`Error: ${e.message}`))}>
                <span className={`alarmIconChip ${m.className}`}><Icon path={m.icon} size={18} /></span>{m.label}
              </button>
            ))}
          </div>
        </div>
      </div>,
      portalRoot
    )}

    {alarmKeypadOpen && createPortal(
      <div className="modalBackdrop" onClick={() => { setAlarmKeypadOpen(false); setAlarmCode(''); setAlarmCodeVisible(false); }}>
        <div className="modalCard" onClick={e => e.stopPropagation()}>
          <div className="modalHeader">
            <span className="modalTitle">Disarm</span>
            <div className="modalClose" onClick={() => { setAlarmKeypadOpen(false); setAlarmCode(''); setAlarmCodeVisible(false); }}>✕</div>
          </div>
          <div className={`alarmKeypad${alarmError ? ' shake' : ''}`}>
            <div className="alarmCodeField">
              <input readOnly type={alarmCodeVisible ? 'text' : 'password'} value={alarmCode} placeholder="Code" />
              <span className="alarmCodeEye" onClick={() => setAlarmCodeVisible(v => !v)}>
                <Icon path={alarmCodeVisible ? mdiEyeOff : mdiEye} size={18} />
              </span>
            </div>
            <div className="alarmKeypadGrid">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d =>
                <button key={d} onClick={() => setAlarmCode(c => c + d)}>{d}</button>
              )}
              <button onClick={() => setAlarmCode('')}><Icon path={mdiClose} size={18} /></button>
              <button onClick={() => setAlarmCode(c => c + '0')}>0</button>
              <button className="alarmKeypadSubmit" disabled={!alarmCode} onClick={() => submitDisarm().catch(e => setLog(`Error: ${e.message}`))}>
                <Icon path={mdiCheck} size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>,
      portalRoot
    )}
  </div>;
}
