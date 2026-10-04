/**
 * Content for the public glossary (/glossary). Plain-language, generic
 * definitions of terms used in Nigerian out-of-home advertising. Static on
 * purpose — no database table.
 */
export type GlossaryTerm = { term: string; aka?: string; definition: string };

export const GLOSSARY: GlossaryTerm[] = [
  { term: 'APCON', aka: 'Advertising Practitioners Council of Nigeria', definition: 'The former federal regulator of advertising in Nigeria. It was replaced by ARCON in 2022, though the old name is still widely used in conversation.' },
  { term: 'ARCON', aka: 'Advertising Regulatory Council of Nigeria', definition: 'The federal body that regulates advertising in Nigeria, succeeding APCON. Advertisements are expected to be vetted and approved by ARCON before they are exposed to the public.' },
  { term: 'Artwork', aka: 'Creative', definition: 'The design that will appear on the board. For static boards it is printed; for digital screens it is supplied as an image or video file to the screen’s specification.' },
  { term: 'Bridge panel', definition: 'An advertising panel fixed along the side of a flyover or pedestrian bridge, facing the traffic passing underneath.' },
  { term: 'Brief', definition: 'The advertiser’s statement of what a campaign should achieve — objective, audience, locations, timing and budget — which the agency turns into a media plan.' },
  { term: 'CPM', aka: 'Cost per mille', definition: 'The cost of a thousand impressions: campaign cost divided by impressions, multiplied by 1,000. Used to compare the cost-efficiency of different sites or media.' },
  { term: 'DOOH', aka: 'Digital out-of-home', definition: 'Out-of-home advertising shown on electronic screens rather than printed faces.' },
  { term: 'Face', definition: 'One advertising surface of a structure. A board with a face on each side, one for each direction of traffic, is double-faced.' },
  { term: 'Flex', definition: 'The printed PVC material most static boards carry. "Printing the flex" means producing the physical advert.' },
  { term: 'Frequency', definition: 'The average number of times a person in the audience is exposed to the advert during the campaign.' },
  { term: 'Gantry', definition: 'A structure spanning the road with an advertising face above the lanes, directly in drivers’ line of sight.' },
  { term: 'Gross rate', definition: 'The price of a site before agency commission and any negotiated discount are taken off. See also Net rate.' },
  { term: 'GRP', aka: 'Gross rating point', definition: 'A measure of the total weight of a campaign: reach (as a percentage of the target audience) multiplied by average frequency. It needs audience measurement data to calculate.' },
  { term: 'Illuminated', aka: 'Lit', definition: 'A board with lighting — front-lit by lamps or back-lit from inside — so it remains visible after dark.' },
  { term: 'Impressions', definition: 'The estimated number of times an advert is seen. One person passing a board five times counts as five impressions.' },
  { term: 'LASAA', aka: 'Lagos State Signage and Advertisement Agency', definition: 'The Lagos State agency that regulates outdoor signage and advertising structures in the state, including permits for sites. Other states have their own signage agencies.' },
  { term: 'LED screen', definition: 'An electronic advertising display built from light-emitting diodes, showing images or video. See also DOOH.' },
  { term: 'Loop', definition: 'On a digital screen, the repeating sequence of adverts from different advertisers. An advertiser buys one or more slots in the loop.' },
  { term: 'Media plan', definition: 'The agency’s proposed selection of sites, formats, dates and costs for a campaign, prepared in response to a brief.' },
  { term: 'Monitoring', definition: 'Checking during a campaign that the advert is still up, undamaged and, if applicable, lit — usually evidenced with dated photographs.' },
  { term: 'Mounting', aka: 'Installation', definition: 'Physically putting the printed advert onto the board. Often charged separately from the media cost.' },
  { term: 'MPO', aka: 'Media purchase order', definition: 'The formal order an agency issues to a media owner to book a site, stating the board, dates and agreed rate. It is the document the booking and later the invoice are tied to.' },
  { term: 'Net rate', definition: 'What is actually payable for a site after agency commission and negotiated discounts are deducted from the gross rate.' },
  { term: 'OAAN', aka: 'Outdoor Advertising Association of Nigeria', definition: 'The trade association of outdoor advertising companies in Nigeria.' },
  { term: 'OOH', aka: 'Out-of-home', definition: 'Advertising that reaches people while they are outside their homes — billboards, bridge panels, digital screens, transit and similar.' },
  { term: 'OTS', aka: 'Opportunity to see', definition: 'One chance for a person to be exposed to an advert. It counts the opportunity, not whether the person actually noticed it.' },
  { term: 'POE', aka: 'Proof of execution', definition: 'Evidence that the campaign ran as booked — typically dated, located photographs of the advert on the board, supplied to the advertiser.' },
  { term: 'POP', aka: 'Proof of posting / proof of performance', definition: 'Used interchangeably with POE: photographic evidence that the advert was posted on the agreed site.' },
  { term: 'Rate card', definition: 'A media owner’s published list price for its sites, before negotiation. The agreed rate on an MPO is often lower.' },
  { term: 'Reach', definition: 'The number, or percentage, of different people in the target audience exposed to the advert at least once during the campaign.' },
  { term: 'Site', definition: 'A specific location where an advertising structure stands. "Site" and "board" are often used to mean the same thing.' },
  { term: 'Site inspection', aka: 'Recce', definition: 'A visit to see a board in person before booking — checking visibility, obstructions, condition and surroundings.' },
  { term: 'Site list', definition: 'A list of the boards proposed or booked for a campaign, with their locations, formats and sizes.' },
  { term: 'Static', definition: 'A board carrying a single printed advert for the whole booking, as opposed to a digital screen that rotates several.' },
  { term: 'Tenancy', definition: 'The period for which an advertiser holds a site. Static boards are commonly booked by the month.' },
  { term: 'Unipole', definition: 'A large advertising face raised on a single tall column, built to be seen from a distance.' },
  { term: 'Wall drape', definition: 'A large printed banner hung on the side of a building.' },
];
