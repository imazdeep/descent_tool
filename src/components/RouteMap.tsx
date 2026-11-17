import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { memo, useEffect, useRef, useState } from 'react';
import { positionAt } from '../lib/descent';
import { fmtAltShort, pathKind, type PathKind } from '../lib/format';
import type { DescentResult, FlightPlan, Settings } from '../lib/types';
import { Segmented } from './fields';

interface Props {
  plan: FlightPlan;
  settings: Settings;
  result: DescentResult;
  hoverD: number | null;
  ownship: { d: number; alt: number } | null;
}

// Leaflet draws on canvas/SVG outside the CSS cascade for stroke colours,
// so the path colours are repeated here as literals (kept in step with styles.css).
const COLORS: Record<PathKind, string> = {
  cruise: '#8f9fc9',
  idle: '#5be7a9',
  geo: '#a9b9ff',
  decel: '#f3f6ff',
  final: '#f3f6ff',
  brake: '#ffb547',
  steep: '#ff6b5e',
};

const planeIcon = (deg: number, cls: string) =>
  L.divIcon({
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<svg class="${cls}" width="28" height="28" viewBox="-14 -14 28 28" style="transform:rotate(${deg}deg)"><path d="M0,-12 L3,-4 L11,2 L11,4.5 L3,2 L2.4,8 L5,10 L5,11.5 L0,10.4 L-5,11.5 L-5,10 L-2.4,8 L-3,2 L-11,4.5 L-11,2 L-3,-4 Z"/></svg>`,
  });

function RouteMapImpl({ plan, settings, result, hoverD, ownship }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const hoverMarker = useRef<L.Marker | null>(null);
  const ownMarker = useRef<L.Marker | null>(null);
  const [scope, setScope] = useState<'descent' | 'route'>('descent');
  const fitted = useRef('');

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, zoomSnap: 0.25, scrollWheelZoom: false });
    L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 13,
      attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
    }).addTo(m);
    m.on('click', () => m.scrollWheelZoom.enable());
    m.on('mouseout', () => m.scrollWheelZoom.disable());
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  /* route, path and fixes */
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const { nodes, samples, fixes, tod } = result;
    const tl = settings.transLevel;

    L.polyline(
      nodes.filter((n) => n.kind !== 'custom').map((n) => [n.lat, n.lon] as [number, number]),
      { color: COLORS.cruise, weight: 1.5, opacity: 0.55, dashArray: '4 5', interactive: false },
    ).addTo(g);

    // descent path, coloured like the profile
    const start = tod ? tod.d : result.totalDist;
    const pts = samples.filter((s) => s.d <= start + 0.01);
    let run: { kind: PathKind; ll: [number, number][] } | null = null;
    const flush = () => {
      if (run && run.ll.length > 1)
        L.polyline(run.ll, {
          color: COLORS[run.kind],
          weight: 4,
          opacity: 0.95,
          dashArray: run.kind === 'decel' ? '7 6' : undefined,
          lineCap: 'round',
          interactive: false,
        }).addTo(g);
    };
    let prev: [number, number] | null = null;
    // include every fix position so the line follows the route exactly
    const dists = [...new Set([...pts.filter((_, i) => i % 4 === 0).map((s) => s.d), ...nodes.filter((n) => n.distToGo <= start).map((n) => n.distToGo), 0])].sort((a, b) => b - a);
    let si = 0;
    for (const d of dists) {
      while (si < pts.length - 1 && pts[si].d > d) si++;
      const kind = pathKind(pts[Math.min(si, pts.length - 1)] ?? samples[samples.length - 1]);
      const p = positionAt(nodes, d);
      const ll: [number, number] = [p.lat, p.lon];
      if (!run || run.kind !== kind) {
        flush();
        run = { kind, ll: prev ? [prev, ll] : [ll] };
      } else run.ll.push(ll);
      prev = ll;
    }
    flush();

    for (const n of nodes) {
      const inDescent = n.distToGo <= start + 15;
      if (scope === 'descent' && n.distToGo > start + 60) continue;
      const f = fixes[n.id];
      const restricted = n.restriction.altType !== 'none' || n.restriction.speed != null;
      const color = n.kind === 'custom' ? '#62d0ff' : restricted ? (f.status === 'met' ? '#f26dd8' : '#ff6b5e') : '#eaf0ff';
      if (n.kind === 'airport') {
        L.marker([n.lat, n.lon], {
          interactive: false,
          icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div class="map-apt"></div>' }),
        }).addTo(g);
      } else {
        L.circleMarker([n.lat, n.lon], { radius: restricted ? 5 : 3.5, color, weight: 1.5, fillColor: '#0b1330', fillOpacity: 1, interactive: false }).addTo(g);
      }
      const alt = inDescent ? ` <span>${fmtAltShort(f.alt, tl)}</span>` : '';
      L.marker([n.lat, n.lon], {
        interactive: false,
        icon: L.divIcon({
          className: '',
          iconSize: [0, 0],
          html: `<div class="map-label${restricted ? ' map-label-r' : ''}${n.kind === 'custom' ? ' map-label-c' : ''}">${n.kind === 'airport' ? `${n.ident} ${plan.dest.runway}` : n.ident}${n.kind === 'airport' ? '' : alt}</div>`,
        }),
      }).addTo(g);
    }

    if (tod) {
      L.marker([tod.lat, tod.lon], {
        interactive: false,
        icon: L.divIcon({ className: '', iconSize: [0, 0], html: '<div class="map-tod"><i></i><b>T/D</b></div>' }),
      }).addTo(g);
    }
    for (const mk of result.markers) {
      if (mk.kind !== 'decel') continue;
      const p = positionAt(nodes, mk.d);
      L.marker([p.lat, p.lon], {
        interactive: false,
        icon: L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9], html: '<div class="map-d">D</div>' }),
      }).addTo(g);
    }

    const key = `${plan.id}|${scope}|${Math.round(start / 5)}`;
    if (fitted.current !== key) {
      fitted.current = key;
      const forFit = nodes.filter((n) => scope === 'route' || n.distToGo <= start + 8).map((n) => [n.lat, n.lon] as [number, number]);
      if (tod && scope === 'descent') forFit.push([tod.lat, tod.lon]);
      if (forFit.length > 1) m.fitBounds(L.latLngBounds(forFit), { padding: [34, 34] });
    }
  }, [result, scope, plan, settings.transLevel]);

  /* hover aircraft */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (hoverD == null) {
      hoverMarker.current?.remove();
      hoverMarker.current = null;
      return;
    }
    const p = positionAt(result.nodes, hoverD);
    if (!hoverMarker.current) {
      hoverMarker.current = L.marker([p.lat, p.lon], { interactive: false, icon: planeIcon(p.track, 'map-plane'), zIndexOffset: 900 }).addTo(m);
    } else {
      hoverMarker.current.setLatLng([p.lat, p.lon]);
      hoverMarker.current.setIcon(planeIcon(p.track, 'map-plane'));
    }
  }, [hoverD, result.nodes]);

  /* ownship from the position check */
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    ownMarker.current?.remove();
    ownMarker.current = null;
    if (!ownship) return;
    const p = positionAt(result.nodes, ownship.d);
    ownMarker.current = L.marker([p.lat, p.lon], { interactive: false, icon: planeIcon(p.track, 'map-plane map-plane-own'), zIndexOffset: 800 }).addTo(m);
  }, [ownship, result.nodes]);

  return (
    <section className="panel map-panel" aria-label="Route map">
      <header className="panel-head">
        <h2>Route</h2>
        <Segmented
          label="Map range"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'descent', label: 'Descent' },
            { value: 'route', label: 'Whole route' },
          ]}
        />
      </header>
      <div className="map" ref={el} />
    </section>
  );
}

export const RouteMap = memo(RouteMapImpl);
