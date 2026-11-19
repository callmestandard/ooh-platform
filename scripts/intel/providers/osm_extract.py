"""
OpenStreetMap places from a local Geofabrik extract (no public API calls).

Usage (from the repo root):
  python -I scripts/intel/providers/osm_extract.py scripts/geo/data/osm-pbf/nigeria-latest.osm.pbf scripts/intel/out/osm_places_national.json

Download the extract first (free, updated daily, ODbL):
  https://download.geofabrik.de/africa/nigeria-latest.osm.pbf

Reads points, outlines (ways) and multipolygons in the categories below and
reduces each to one point (the mean of its outline's nodes). Output:
  {"osm_timestamp": "...", "places": [{"id","category","name","lat","lng"}]}
Credit: (c) OpenStreetMap contributors, ODbL.
"""
import json
import sys

import osmium

FOOD = {'restaurant', 'fast_food', 'cafe'}
ENTERTAINMENT = {'cinema', 'theatre', 'nightclub'}


def category_of(t):
    """Same definitions as scripts/intel/providers/osm.mjs (CATEGORIES)."""
    a = t.get('amenity')
    if a == 'bank': return 'bank'
    if t.get('shop') == 'mall': return 'mall'
    if a == 'marketplace': return 'market'
    if t.get('shop') == 'supermarket': return 'supermarket'
    if a in FOOD: return 'restaurant'
    if t.get('tourism') == 'hotel': return 'hotel'
    if a == 'fuel': return 'fuel'
    if a == 'school': return 'school'
    if a in ('university', 'college'): return 'university'
    if a in ('hospital', 'clinic'): return 'health'
    if a == 'bus_station' or t.get('railway') == 'station' or t.get('aeroway') == 'aerodrome': return 'transport'
    if a in ENTERTAINMENT or t.get('leisure') == 'stadium': return 'entertainment'
    if 'office' in t: return 'office'
    return None


def name_of(t):
    n = t.get('name')
    return n[:120] if n else None


class Relations(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.rel = {}           # relation id -> (category, name, [outer way ids])
        self.member_ways = set()

    def relation(self, r):
        if r.tags.get('type') != 'multipolygon':
            return
        t = dict(r.tags)
        c = category_of(t)
        if not c:
            return
        ways = [m.ref for m in r.members if m.type == 'w' and m.role in ('outer', '')]
        if ways:
            self.rel[r.id] = (c, name_of(t), ways)
            self.member_ways.update(ways)


class Ways(osmium.SimpleHandler):
    def __init__(self, member_ways):
        super().__init__()
        self.member_ways = member_ways
        self.ways = {}          # way id -> (category, name, refs)
        self.member_refs = {}   # way id -> refs (for relations)
        self.need = set()

    def way(self, w):
        t = dict(w.tags) if len(w.tags) else {}
        c = category_of(t) if t else None
        if c is None and w.id not in self.member_ways:
            return
        refs = [n.ref for n in w.nodes]
        self.need.update(refs)
        if c:
            self.ways[w.id] = (c, name_of(t), refs)
        if w.id in self.member_ways:
            self.member_refs[w.id] = refs


class Nodes(osmium.SimpleHandler):
    def __init__(self, need, points=True):
        super().__init__()
        self.need = need
        self.want_points = points
        self.loc = {}
        self.points = []

    def node(self, n):
        if n.id in self.need:
            self.loc[n.id] = (n.location.lat, n.location.lon)
        if self.want_points and len(n.tags):
            t = dict(n.tags)
            c = category_of(t)
            if c and n.location.valid():
                self.points.append({'id': f'n{n.id}', 'category': c, 'name': name_of(t),
                                    'lat': round(n.location.lat, 7), 'lng': round(n.location.lon, 7)})


def centre(refs, loc):
    pts = [loc[r] for r in refs if r in loc]
    if not pts:
        return None
    return (round(sum(p[0] for p in pts) / len(pts), 7), round(sum(p[1] for p in pts) / len(pts), 7))


KEYS = ('amenity', 'shop', 'tourism', 'office', 'railway', 'aeroway', 'leisure')


def main(src, out):
    header = osmium.io.Reader(src, osmium.osm.osm_entity_bits.NOTHING).header()
    stamp = header.get('osmosis_replication_timestamp') or ''

    # Pass 1: tagged multipolygons. Filters run in C++, so the tens of
    # millions of untagged building outlines are skipped quickly.
    rh = Relations()
    rh.apply_file(src, filters=[osmium.filter.EntityFilter(osmium.osm.RELATION), osmium.filter.KeyFilter(*KEYS)])
    print(f'multipolygons: {len(rh.rel)}', flush=True)

    # Pass 2a: tagged outlines.
    wh = Ways(set())
    wh.apply_file(src, filters=[osmium.filter.EntityFilter(osmium.osm.WAY), osmium.filter.KeyFilter(*KEYS)])
    # Pass 2b: the outer outlines of those multipolygons (often untagged).
    if rh.member_ways:
        mw = Ways(rh.member_ways)
        mw.apply_file(src, filters=[osmium.filter.EntityFilter(osmium.osm.WAY), osmium.filter.IdFilter(rh.member_ways)])
        wh.member_refs = mw.member_refs
        wh.need |= mw.need
    print(f'outlines: {len(wh.ways)}', flush=True)

    # Pass 3: tagged points, plus the nodes the outlines need.
    nh = Nodes(set())
    nh.apply_file(src, filters=[osmium.filter.EntityFilter(osmium.osm.NODE), osmium.filter.KeyFilter(*KEYS)])
    lh = Nodes(wh.need, points=False)
    lh.apply_file(src, filters=[osmium.filter.EntityFilter(osmium.osm.NODE), osmium.filter.IdFilter(wh.need)])
    nh.loc = lh.loc
    print(f'points: {len(nh.points)}', flush=True)

    places = list(nh.points)
    for wid, (c, name, refs) in wh.ways.items():
        p = centre(refs, nh.loc)
        if p:
            places.append({'id': f'w{wid}', 'category': c, 'name': name, 'lat': p[0], 'lng': p[1]})
    for rid, (c, name, ways) in rh.rel.items():
        refs = [r for w in ways for r in wh.member_refs.get(w, [])]
        p = centre(refs, nh.loc)
        if p:
            places.append({'id': f'r{rid}', 'category': c, 'name': name, 'lat': p[0], 'lng': p[1]})

    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'osm_timestamp': stamp, 'source': 'Geofabrik nigeria-latest.osm.pbf', 'places': places}, f)
    print(f'wrote {len(places)} places (OSM data as of {stamp})', flush=True)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
