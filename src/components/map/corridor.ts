/**
 * Corridor/radius planning tool — geometry only (no React, no map engine).
 * A user either drops a radius circle around a point, or draws a multi-point
 * route; this returns which boards fall inside it. Built on turf.js rather
 * than the Mapbox GL Draw plugin: the interaction itself (drawing) is just
 * clicks on the map handled by the consuming component (same click-to-place
 * pattern already used for the boards-map route planner), and this module
 * does the actual "which boards are inside" math.
 */

import distance from '@turf/distance';
import buffer from '@turf/buffer';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point, lineString } from '@turf/helpers';

export type GeoPoint = { lng: number; lat: number };

export type CorridorBoard = { id: string; latitude: number | null; longitude: number | null };

/** Radius mode: every board within `radiusKm` of `center` (great-circle distance, exact — no polygon approximation needed). */
export function boardsWithinRadius<T extends CorridorBoard>(boards: T[], center: GeoPoint, radiusKm: number): T[] {
  const c = point([center.lng, center.lat]);
  return boards.filter(b => {
    if (b.latitude == null || b.longitude == null) return false;
    return distance(c, point([b.longitude, b.latitude]), { units: 'kilometers' }) <= radiusKm;
  });
}

/** Corridor mode: every board within `widthKm` of the drawn route (buffers the line into a polygon, then tests containment). */
export function boardsWithinCorridor<T extends CorridorBoard>(boards: T[], routePoints: GeoPoint[], widthKm: number): T[] {
  if (routePoints.length < 2) return [];
  const line = lineString(routePoints.map(p => [p.lng, p.lat]));
  const corridor = buffer(line, widthKm, { units: 'kilometers' });
  if (!corridor) return [];
  return boards.filter(b => {
    if (b.latitude == null || b.longitude == null) return false;
    return booleanPointInPolygon(point([b.longitude, b.latitude]), corridor);
  });
}

/** Builds the corridor polygon itself, for rendering as a map overlay (Source/Layer fill). */
export function corridorPolygon(routePoints: GeoPoint[], widthKm: number): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  if (routePoints.length < 2) return null;
  const line = lineString(routePoints.map(p => [p.lng, p.lat]));
  return buffer(line, widthKm, { units: 'kilometers' }) ?? null;
}

/** Builds an accurate geodesic circle polygon, for rendering the radius overlay (turf.circle would also work; this keeps the dependency list to what's already installed). */
export function circlePolygon(center: GeoPoint, radiusKm: number, steps = 64): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const earthRadiusKm = 6371;
  const latRad = (center.lat * Math.PI) / 180;
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusKm / earthRadiusKm) * Math.cos(angle);
    const dLng = (radiusKm / (earthRadiusKm * Math.cos(latRad))) * Math.sin(angle);
    coords.push([center.lng + (dLng * 180) / Math.PI, center.lat + (dLat * 180) / Math.PI]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}
