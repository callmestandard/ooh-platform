/**
 * The ONE place the map engine is named. Everything else in the app imports
 * map primitives from here (or from OOHMap, which re-exports them), so the
 * renderer is Mapbox GL JS everywhere and swapping it is a one-file change.
 * The engine's stylesheet is imported once in src/app/globals.css.
 */
export { default as MapGL, Marker, Popup, NavigationControl, Source, Layer, useMap } from 'react-map-gl/mapbox';
export type { MapRef, MapMouseEvent, MarkerDragEvent } from 'react-map-gl/mapbox';
export type { GeoJSONSource } from 'mapbox-gl';
