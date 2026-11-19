/**
 * Traffic / road provider — NOT CONNECTED.
 *
 * No free or licensed traffic source is connected. Until one is, every board
 * gets road_class = NULL and traffic_level = NULL, which the UI shows as
 * "Traffic data: not available". A provider plugged in here must return
 * { road_class, traffic_level: 'low'|'medium'|'high'|'very_high', dataset_id }
 * from a source with a recorded licence — never an estimate made up here.
 */
export const CONNECTED = false;

export async function trafficFor(/* lat, lng */) {
  return null;
}
