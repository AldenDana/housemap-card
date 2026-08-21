// Was a fixed literal union tied to this specific house's 7 rooms - loosened to
// a plain string so `house.config.json` can define ANY set of room keys for a
// different house without touching this file. See house.config.json + rooms.ts.
export type RoomKey = string;

export type ClimateKind = 'temperature' | 'humidity' | 'lux' | 'co2';

export interface ClimatePoint {
  label: string;
  value: string;
  kind: ClimateKind;
}

export type RoomClimate = Partial<Record<ClimateKind, ClimatePoint>>;

export interface RoomConfig {
  key: RoomKey;
  name: string;
  roomId: number;
  areaNames: string[];
  fallbackEntities: string[];
  // Forward-compat hooks: unset for every room today (this HA instance has zero
  // climate.*/cover.* entities), filled in once real thermostats/blinds exist.
  climateEntity?: string;
  coverEntity?: string;
  // SIP-HASS extension for this room's intercom endpoint (see SIP Core's own
  // integration options, `users`/`backup_user` entries). Unset for rooms with
  // no intercom device (e.g. a corridor with no tablet/speaker) - the call
  // button in the room panel only renders when this is set.
  sipExtension?: string;
  excludeEntityPatterns?: string[];
  fill: string;
  d: string; // SVG path data, 1184x1280 unit space
  bx: number; by: number; bw: number; bh: number; // bounding box, used for zoom transform + badge position
  dx: number; dy: number; // lights-on status dot position
  lx: number; ly: number; // room label position
}

// Shape of house.config.json - the ONE file a new install needs to replace to
// point this app at a different house. See house.config.json's own comments
// and the standalone room-designer tool (tools/room-designer.html) for how to
// produce one without hand-writing SVG path coordinates.
export interface PersonBadge {
  eid: string;
  // alwaysShow: true renders a badge in every state (Home/Away/Work/Unknown) - for
  // household members you always want status for. alwaysShow: false only renders the
  // badge while presenceOf() resolves to 'home' - for guests without a device_tracker
  // yet (a real person entity with no tracker just reports 'unknown' forever, which
  // presenceOf() treats as not-home) who should be invisible here until one is linked.
  alwaysShow: boolean;
}

export interface HouseConfig {
  viewBox: { width: number; height: number };
  drawOrder: RoomKey[];
  roomOrder: RoomKey[];
  rooms: RoomConfig[];
  // House-wide entities, as opposed to the per-room ones above. All optional.
  // Omitting weatherEntity or alarmEntity hides that panel section outright
  // (both are rendered behind a `state &&` guard). people defaults to an empty
  // list, so no presence badges render.
  weatherEntity?: string;
  alarmEntity?: string;
  // NOTE: unlike the two above, this does NOT gate the Cleaning buttons - those
  // call HA scripts, not the vacuum entity, so they render either way. This
  // entity is read only to highlight which clean is currently running. See the
  // Cleaning section of the README for removing the buttons themselves.
  vacuumEntity?: string;
  people?: PersonBadge[];
}

export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
}

export interface HaArea { area_id: string; name: string; }
export interface HaDevice { id: string; area_id?: string | null; }
export interface HaEntity {
  entity_id: string;
  name?: string | null;
  original_name?: string | null;
  translation_key?: string | null;
  area_id?: string | null;
  device_id?: string | null;
  disabled_by?: string | null;
  hidden_by?: string | null;
  entity_category?: string | null;
  labels?: string[] | null;
}

declare global {
  interface Window { HOUSEMAP_HA_TOKEN?: string; }
}
