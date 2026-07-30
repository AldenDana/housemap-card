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
  climateEntities?: string[];
  // Forward-compat hooks: unset for every room today (this HA instance has zero
  // climate.*/cover.* entities), filled in once real thermostats/blinds exist.
  climateEntity?: string;
  coverEntity?: string;
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
export interface HouseConfig {
  viewBox: { width: number; height: number };
  drawOrder: RoomKey[];
  roomOrder: RoomKey[];
  rooms: RoomConfig[];
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
