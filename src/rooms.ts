import type { HouseConfig, PersonBadge, RoomConfig, RoomKey } from './types';
import houseConfigRaw from './house.config.json';

// This file is a thin loader, not where your house data lives - edit
// house.config.json for a different house/room layout (or generate one with
// tools/room-designer.html), not this file. See house.config.json's own
// top-of-file comment for the schema and how each field is used.
const houseConfig = houseConfigRaw as unknown as HouseConfig;

export const VIEWBOX_WIDTH = houseConfig.viewBox.width;
export const VIEWBOX_HEIGHT = houseConfig.viewBox.height;

export const rooms: Record<RoomKey, RoomConfig> = Object.fromEntries(
  houseConfig.rooms.map(r => [r.key, r])
);

// SVG draw order matters: rooms painted later sit visually on top of rooms
// painted earlier where their shapes overlap (e.g. a background hallway strip
// must draw before the rooms that visually sit inside/on top of it).
export const drawOrder = houseConfig.drawOrder;

export const roomOrder = houseConfig.roomOrder;

// House-wide entities (weather, alarm, robot vacuum, the people whose presence
// badges appear in the overview panel). These used to be hard-coded constants
// in App.tsx, which quietly made the README's "everything lives in one file"
// promise untrue - a second house had to edit source to change them.
export const weatherEntity = houseConfig.weatherEntity ?? '';
export const alarmEntity = houseConfig.alarmEntity ?? '';
export const vacuumEntity = houseConfig.vacuumEntity ?? '';
export const people: PersonBadge[] = houseConfig.people ?? [];
