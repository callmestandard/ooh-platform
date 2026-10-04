import type { BoardFormat } from './board-formats';

/**
 * Content for the public media formats guide (/formats). Plain-language
 * descriptions only — no prices, reach figures or dimensions, because none
 * of those can be sourced from real platform data yet.
 *
 * `formats` ties an entry to the values stored in `boards.format`
 * (src/lib/board-formats.ts); the page derives its label and its link into
 * the (login-gated) marketplace filter from that. Entries without `formats`
 * are common in the market but are not a separate board type on the
 * platform, so they get a name of their own and no listing link.
 */
export type FormatGuideEntry = {
  slug: string;
  /** Board-type values this entry covers; the first one is the marketplace filter it links to. */
  formats?: BoardFormat[];
  /** Only for entries that have no board-type value to take a label from. */
  name?: string;
  description: string;
  useCases: string[];
  locations: string;
};

export const FORMAT_GUIDE: FormatGuideEntry[] = [
  {
    slug: 'billboard',
    formats: ['billboard'],
    description:
      'The classic static board: a printed flex or vinyl face mounted on a steel or wooden frame, usually standing on two or more legs at the roadside. One advertiser holds the face for the whole booking period, so the message is visible around the clock.',
    useCases: [
      'Sustained brand awareness over several months',
      'Product launches that need broad, repeated visibility',
      'Directional messages pointing to a nearby outlet or branch',
    ],
    locations:
      'Major roads, junctions and roundabouts, market approaches and other places where vehicles and pedestrians pass steadily.',
  },
  {
    slug: 'unipole',
    formats: ['unipole'],
    description:
      'A large advertising face raised on a single tall column. The height lifts the board above traffic, buildings and other signage, so it can be read from far away. Many unipoles carry two faces, one for each direction of travel.',
    useCases: [
      'High-impact brand campaigns on busy corridors',
      'Long-distance visibility on fast roads',
      'Landmark sites a brand wants to be associated with for a long tenancy',
    ],
    locations:
      'Expressways, major arterial roads and interchanges, where drivers approach from a distance and need time to read the board.',
  },
  {
    slug: 'gantry',
    formats: ['gantry'],
    description:
      'A structure that spans across the road, carrying an advertising face directly above the lanes. Because it sits head-on in the driver’s line of sight, it is difficult to miss.',
    useCases: [
      'Dominating a single important route',
      'Messages aimed squarely at motorists',
      'Campaigns where one or two premium sites matter more than wide coverage',
    ],
    locations:
      'Wide, high-traffic roads and entry points into commercial districts, where the structure can cross the carriageway.',
  },
  {
    slug: 'bridge-panel',
    formats: ['bridge_panel'],
    description:
      'An advertising panel fixed along the side of a flyover or pedestrian bridge, facing the traffic that passes underneath. The panel is typically long and narrow, following the line of the bridge.',
    useCases: [
      'Reaching commuters on a fixed daily route',
      'Short, simple messages and strong brand marks',
      'Adding frequency along a corridor already covered by larger boards',
    ],
    locations:
      'Flyovers and pedestrian bridges over busy urban roads, particularly where traffic slows.',
  },
  {
    slug: 'wall-drape',
    formats: ['wall_drape'],
    description:
      'A large printed banner hung on the side of a building. It uses the wall as the structure, which allows very large faces in dense areas where there is no room for a free-standing board.',
    useCases: [
      'Big, attention-grabbing creative in city centres',
      'Launches and seasonal campaigns',
      'Reaching pedestrians as well as traffic in commercial areas',
    ],
    locations:
      'Tall or prominent buildings facing a busy road, junction or commercial street with a clear line of sight.',
  },
  {
    slug: 'led-digital',
    formats: ['digital', 'led'],
    description:
      'An electronic display that shows adverts as images or video. Several advertisers usually share one screen, each buying slots in a repeating loop, and the creative can be changed without printing or installation.',
    useCases: [
      'Campaigns that need to change message quickly or run several creatives',
      'Short, time-bound promotions',
      'Night-time visibility, since the screen is its own light source',
    ],
    locations:
      'High-traffic junctions, commercial districts, malls and transport hubs — places where audiences wait or move slowly enough to watch the loop.',
  },
  {
    slug: 'mega-board',
    name: 'Mega board / spectacular',
    description:
      'An extra-large static board — or a custom-built structure with special shapes, extensions or lighting — designed to be a landmark in its own right. It is the same idea as a billboard or unipole, scaled up.',
    useCases: [
      'Flagship brand statements',
      'Long-term presence at a signature location',
      'Creative that depends on scale to work',
    ],
    locations:
      'Gateway locations: major interchanges, bridge approaches and the main routes into a city.',
  },
  {
    slug: '3d-led',
    name: '3D LED',
    description:
      'A digital screen — often wrapped around the corner of a building — showing specially produced content that creates the illusion of depth from a particular viewing angle. The effect comes from the creative, so it needs content made for that specific screen.',
    useCases: [
      'Launches designed to be talked about and shared',
      'Brands that want a showpiece rather than wide coverage',
      'Campaigns with the budget and lead time for custom content',
    ],
    locations:
      'Prominent corner sites and plazas where people can see the screen from the angle the illusion is designed for.',
  },
];
