import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { memo, useEffect, useRef } from 'react';
import { positionAt } from '../lib/descent';
import { fmtAltShort, pathKind, type PathKind } from '../lib/format';
import type { DescentResult, FlightPlan, Settings } from '../lib/types';

interface Props {
  plan: FlightPlan;
  settings: Settings;
  result: DescentResult;
  theme: 'light' | 'dark';
  hoverD: number | null;
  ownship: { d: number; alt: number } | null;
}

const TILES = {
  light: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  dark: 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
};

/** Leaflet strokes are set from script, so read the theme colours off the page. */
function themeColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { accent: v('--accent'), warn: v('--warn'), bad: v('--bad'), ink: v('--ink'), muted: v('--ink-3'), surface: v('--surface') };
}

const dot = (cls: string) => L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7], html: `<div class="${cls}"></div>` });

function RouteMapImpl({ plan, settings, result, theme, hoverD, ownship }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const hoverMarker = useRef<L.Marker | null>(null);
  const ownMarker = useRef<L.Marker | null>(null);
  const fitted = useRef('');

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, zoomSnap: 1, scrollWheelZoom: false });
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
      tiles.current = null;
      fitted.current = '';
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tiles.current?.remove();
    tiles.current = L.tileLayer(TILES[theme], { maxZoom: 13, attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors' }).addTo(m);
    tiles.current.bringToBack();
  }, [theme]);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const c = themeColors();
    const color: Record<PathKind, string> = { normal: c.accent, brake: c.warn, steep: c.bad };
    const { nodes, samples, fixes, tod } = result;
    const tl = settings.transLevel;
    const start = tod ? tod.d : result.totalDist;

    // route flown before the descent
    L.polyline(
      nodes.filter((n) => n.kind !== 'custom' && n.distToGo >= start - 0.01).map((n) => [n.lat, n.lon] as [number, number]).concat(tod ? [[tod.lat, tod.lon]] : []),
      { color: c.muted, weight: 2, opacity: 0.7, dashArray: '3 6', interactive: false },
    ).addTo(g);

    // the descent, following the route through every fix
    const pts = samples.filter((s) => s.d <= start + 0.01);
    const dists = [...new Set([...pts.filter((_, i) => i % 4 === 0).map((s) => s.d), ...nodes.filter((n) => n.distToGo <= start).map((n) => n.distToGo), 0])].sort((a, b) => b - a);
    let run: { kind: PathKind; ll: [number, number][] } | null = null;
    let prev: [number, number] | null = null;
    let si = 0;
    const flush = () => {
      if (run && run.ll.length > 1) L.polyline(run.ll, { color: color[run.kind], weight: 4, lineCap: 'round', interactive: false }).addTo(g);
    };
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
      if (n.distToGo > start + 40) continue;
      const f = fixes[n.id];
      const inDescent = n.distToGo <= start;
      if (n.kind === 'airport') {
        L.marker([n.lat, n.lon], { interactive: false, icon: dot('map-apt') }).addTo(g);
      } else {
        L.circleMarker([n.lat, n.lon], { radius: 4, color: inDescent ? c.accent : c.muted, weight: 2, fillColor: c.surface, fillOpacity: 1, interactive: false }).addTo(g);
      }
      const name = n.kind === 'airport' ? `${n.ident} ${plan.dest.runway}` : n.ident;
      const alt = inDescent && n.kind !== 'airport' ? `<span>${fmtAltShort(f.alt, tl)}</span>` : '';
      L.marker([n.lat, n.lon], {
        interactive: false,
        icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="map-label">${name}${alt}</div>` }),
      }).addTo(g);
    }
    if (tod) {
      L.marker([tod.lat, tod.lon], { interactive: false, icon: dot('map-tod') }).addTo(g);
      L.marker([tod.lat, tod.lon], {
        interactive: false,
        icon: L.divIcon({ className: '', iconSize: [0, 0], html: '<div class="map-label map-label-tod">Top of descent</div>' }),
      }).addTo(g);
    }

    const key = `${plan.id}|${Math.round(start / 5)}`;
    if (fitted.current !== key) {
      fitted.current = key;
      const forFit = nodes.filter((n) => n.distToGo <= start + 6).map((n) => [n.lat, n.lon] as [number, number]);
      if (tod) forFit.push([tod.lat, tod.lon]);
      if (forFit.length > 1) m.fitBounds(L.latLngBounds(forFit), { padding: [28, 28] });
    }
  }, [result, plan, settings.transLevel, theme]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (hoverD == null) {
      hoverMarker.current?.remove();
      hoverMarker.current = null;
      return;
    }
    const p = positionAt(result.nodes, hoverD);
    if (!hoverMarker.current) hoverMarker.current = L.marker([p.lat, p.lon], { interactive: false, icon: dot('map-hover'), zIndexOffset: 900 }).addTo(m);
    else hoverMarker.current.setLatLng([p.lat, p.lon]);
  }, [hoverD, result.nodes]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    ownMarker.current?.remove();
    ownMarker.current = null;
    if (!ownship) return;
    const p = positionAt(result.nodes, ownship.d);
    ownMarker.current = L.marker([p.lat, p.lon], { interactive: false, icon: dot('map-own'), zIndexOffset: 800 }).addTo(m);
  }, [ownship, result.nodes]);

  return <div className="map" ref={el} role="img" aria-label={`Map of the arrival into ${plan.dest.icao}`} />;
}

export const RouteMap = memo(RouteMapImpl);
