import type { ClimateKind, ClimatePoint, RoomClimate, RoomConfig, RoomKey } from './types';
import { drawOrder, roomOrder, rooms, VIEWBOX_HEIGHT, VIEWBOX_WIDTH } from './rooms';

const VB_W = VIEWBOX_WIDTH, VB_H = VIEWBOX_HEIGHT;
const ZOOM_PAD = 1.5;
const ZOOM_MAX = 2.6;
const BADGE_W = 190, BADGE_MARGIN = 24, BADGE_ROW_H = 30, BADGE_PAD = 10;

const climateOrder: ClimateKind[] = ['temperature', 'humidity', 'lux', 'co2'];
const climateMeta: Record<ClimateKind, { icon: string; label: string }> = {
  temperature: { icon: '🌡', label: 'Temperature' },
  humidity: { icon: '💧', label: 'Humidity' },
  lux: { icon: '☀️', label: 'Light level' },
  co2: { icon: '🫧', label: 'CO₂' },
};

function zoomFor(room: RoomConfig | null): { tx: number; ty: number; scale: number } {
  if (!room) return { tx: 0, ty: 0, scale: 1 };
  const cx = room.bx + room.bw / 2, cy = room.by + room.bh / 2;
  let scale = Math.min(VB_W / (room.bw * ZOOM_PAD), VB_H / (room.bh * ZOOM_PAD));
  scale = Math.max(1, Math.min(scale, ZOOM_MAX));
  return { tx: VB_W / 2 - cx * scale, ty: VB_H / 2 - cy * scale, scale };
}

function RoomLabel({ room, opacity }: { room: RoomConfig; opacity: number }) {
  const small = room.key === 'corridor';
  return <text x={room.lx} y={room.ly} fontSize={small ? 14 : 20} letterSpacing={small ? 0.5 : 0.2} style={{ opacity, transition: 'opacity 0.4s ease' }}>{room.name}</text>;
}

function SensorBadge({ room, climate, zoom }: { room: RoomConfig; climate?: RoomClimate; zoom: { tx: number; ty: number; scale: number } }) {
  const points = climateOrder.map(kind => climate?.[kind]).filter(Boolean) as (ClimatePoint & { kind: ClimateKind })[];
  if (!points.length) return null;
  const rows = Math.ceil(points.length / 2);
  const h = rows * BADGE_ROW_H + BADGE_PAD * 2;
  const cornerX = zoom.tx + (room.bx + room.bw) * zoom.scale;
  const cornerY = zoom.ty + room.by * zoom.scale;
  const x = cornerX - BADGE_W - BADGE_MARGIN;
  const y = cornerY + BADGE_MARGIN;
  return <foreignObject x={x} y={y} width={BADGE_W} height={h} style={{ pointerEvents: 'none', overflow: 'visible' }}>
    <div className="sensorBadge">
      {points.map(p => <div className="sensorStat" key={p.kind} title={climateMeta[p.kind].label}>
        <span className="sensorIcon">{climateMeta[p.kind].icon}</span>
        <span className="sensorValue">{p.value}</span>
      </div>)}
    </div>
  </foreignObject>;
}

export function Floorplan({ selected, onSelect, climate, lightsOn, lightColor, topAlign }: {
  selected: RoomKey | null;
  onSelect: (key: RoomKey | null) => void;
  climate: Record<RoomKey, RoomClimate>;
  lightsOn: Record<RoomKey, boolean>;
  lightColor: Record<RoomKey, string | null>;
  topAlign?: boolean;
}) {
  const selectedRoom = selected ? rooms[selected] : null;
  const zoom = zoomFor(selectedRoom);
  const transform = `translate(${zoom.tx}px,${zoom.ty}px) scale(${zoom.scale})`;

  return <div className="floorplanStage">
    <svg
      className="floorSvg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio={topAlign ? 'xMidYMin meet' : 'xMidYMid meet'}
      aria-label="House map"
      onClick={() => onSelect(null)}
    >
      <Defs />
      <g style={{ transform, transformOrigin: '0px 0px', transition: 'transform 0.55s cubic-bezier(.4,0,.2,1)' }}>
        {drawOrder.map(key => {
          const room = rooms[key];
          const isSelected = key === selected;
          const opacity = selected ? (isSelected ? 1 : 0.15) : 1;
          return <g key={key} style={{ opacity, transition: 'opacity 0.4s ease' }}>
            <path
              d={room.d}
              className="room"
              fill={lightColor[key] || room.fill}
              onClick={e => { e.stopPropagation(); onSelect(room.key); }}
            />
            {lightsOn[key] && <circle cx={room.dx} cy={room.dy} r={6} className="statusDot" style={{ pointerEvents: 'none' }} />}
          </g>;
        })}
        <g className="roomLabels">
          {roomOrder.map(key => <RoomLabel key={key} room={rooms[key]} opacity={selected ? (key === selected ? 1 : 0.15) : 1} />)}
        </g>
      </g>
      {selectedRoom && <SensorBadge room={selectedRoom} climate={climate[selectedRoom.key]} zoom={zoom} />}
    </svg>
  </div>;
}

function Defs() {
  return <defs>
    <pattern id="tiles" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#d7dcea" /><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#c6ccdf" strokeWidth="1.5" /></pattern>
  </defs>;
}
