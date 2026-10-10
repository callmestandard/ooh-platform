/**
 * The dataset registry — one entry per source, loaded into `geo_datasets` by
 * step 9. Every metric row in the database points at one of these ids, and
 * the evidence drawer in the app shows these fields verbatim.
 *
 * Licences were read from the publisher's own page or metadata on the date
 * in `licence_checked_on`; how each was checked is noted beside it.
 * `retrieved_on` is filled in from scripts/geo/data/retrieved.json or from
 * the saved raw extract, i.e. from when the data was actually fetched.
 */

export const LICENCES_CHECKED_ON = '2026-10-10';

export const DATASETS = [
  {
    id: 'worldpop_agesex_2020_constrained',
    name: 'WorldPop age and sex structures, Nigeria 2020 (constrained)',
    publisher: 'WorldPop, University of Southampton',
    version: 'Global 2000-2020 Constrained, 2020 release, Maxar/Ecopia building footprints v1 (doi:10.5258/SOTON/WP00696)',
    reference_year: '2020',
    resolution: '3 arc-second grid (about 100 m); aggregated here to LGA, state and H3 cells',
    // Licence text read at https://hub.worldpop.org/data/licence.txt, linked from the dataset's API record.
    licence: 'CC BY 4.0',
    licence_url: 'https://creativecommons.org/licenses/by/4.0/',
    url: 'https://hub.worldpop.org/geodata/summary?id=50256',
    method_summary:
      'WorldPop spreads projected population totals for administrative areas across 100 m grid cells with a statistical model, placing people only in cells where buildings were mapped from satellite imagery, then splits each cell by age and sex. We sum the cells whose centre falls inside each LGA or H3 cell; nothing is smoothed or filled in.',
    known_limitations:
      'Modelled estimate, not a census count: Nigeria\'s last census was in 2006. Figures are for 2020 and are not adjusted to UN national totals. The age and sex split comes from proportions for larger areas applied to the cells inside them, so differences in youth share between neighbouring small areas are weaker evidence than differences in total population. Areas with unmapped buildings show no population.',
    attribution: 'Population: WorldPop (www.worldpop.org), University of Southampton, CC BY 4.0. doi:10.5258/SOTON/WP00696',
    data_nature: 'modelled',
    status: 'active',
  },
  {
    id: 'ocha_cod_ab_nga',
    name: 'Nigeria subnational administrative boundaries (COD-AB)',
    publisher: 'OCHA Field Information Services Section, from OSGOF, eHealth Africa and UN Cartographic Section',
    version: 'v01, boundaries valid from 2019-04-17, HDX file dated 2026-04-16',
    reference_year: '2019',
    resolution: '774 LGAs (admin 2) and 36 states plus FCT (admin 1); simplified for display',
    // Licence field of the HDX dataset record (CKAN API, package cod-ab-nga).
    licence: 'CC BY-IGO 3.0',
    licence_url: 'http://creativecommons.org/licenses/by/3.0/igo/legalcode',
    url: 'https://data.humdata.org/dataset/cod-ab-nga',
    method_summary:
      'Official boundaries from the Office of the Surveyor General of the Federation, cleaned and aligned by OCHA. Areas in km² are computed here from the full-resolution polygons; the map draws a simplified copy.',
    known_limitations:
      'Operational boundaries for planning, not a legal demarcation. Bakassi LGA is thought to be uninhabited in the source. Borders on the map are simplified and can sit tens of metres from the true line.',
    attribution: 'Boundaries: OCHA / OSGOF / eHealth Africa, CC BY-IGO 3.0',
    data_nature: 'administrative',
    status: 'active',
  },
  {
    id: 'osm_pois',
    name: 'OpenStreetMap points of interest',
    publisher: 'OpenStreetMap contributors',
    version: 'Overpass API extract; see retrieval date',
    reference_year: 'see retrieval date',
    resolution: 'Individual mapped places, counted per LGA, state and H3 cell',
    // OpenStreetMap's published licence, https://www.openstreetmap.org/copyright.
    licence: 'ODbL 1.0',
    licence_url: 'https://opendatacommons.org/licenses/odbl/1-0/',
    url: 'https://www.openstreetmap.org/copyright',
    method_summary:
      'Places tagged as universities and colleges, malls, markets, banks, hotels, airports, bus stations and hospitals are fetched for the whole country and counted in the LGA and H3 cell that contain them. The same named place mapped twice in one small cell is counted once.',
    known_limitations:
      'Counts are lower bounds. OpenStreetMap is volunteer-mapped and its completeness varies a lot between Nigerian cities and is weakest in rural areas, so a low count can mean few places or simply few mappers. A count of zero is "none mapped", not "none exist".',
    attribution: '© OpenStreetMap contributors, ODbL',
    data_nature: 'crowdsourced',
    status: 'active',
  },
  {
    id: 'dhs_ng_2023_24_wealth',
    name: 'Nigeria Demographic and Health Survey 2023-24, wealth quintiles by state',
    publisher: 'National Population Commission (Nigeria) and ICF, The DHS Program',
    version: 'Survey NG2024DHS, indicators HC_WIXQ_P_*, via The DHS Program Indicator Data API',
    reference_year: '2023-24',
    resolution: 'State (36 states plus FCT). Not available below state level',
    // The API terms page (api.dhsprogram.com, Terms & Conditions) states a citation requirement only; no licence is named.
    licence: 'No formal licence named; API terms require citation',
    licence_url: 'https://api.dhsprogram.com/#/terms.cfm',
    url: 'https://api.dhsprogram.com/rest/dhs/data?surveyIds=NG2024DHS&indicatorIds=HC_WIXQ_P_LOW,HC_WIXQ_P_2ND,HC_WIXQ_P_MID,HC_WIXQ_P_4TH,HC_WIXQ_P_HGH&breakdown=subnational',
    method_summary:
      'A household survey. Households are scored on assets and housing and split into five equal national groups; the figures are the percent of each state\'s household population that falls in each national fifth. Published aggregates are used as-is; no microdata.',
    known_limitations:
      'Survey estimates with sampling error; the source publishes sample sizes but no confidence intervals for these figures, so none are shown. The fifths are national, so they compare a state with the country, not households within the state. A wealth index of assets, not income in naira.',
    attribution: 'The DHS Program Indicator Data API, The Demographic and Health Surveys (DHS) Program. ICF. Originally funded by USAID. api.dhsprogram.com',
    data_nature: 'survey_estimate',
    status: 'active',
  },
  {
    id: 'ntl_npp_viirs_like_v2',
    name: 'Global NPP-VIIRS-like night-time light data, Version 2',
    publisher: 'Chen, Yu et al., Fuzhou University and East China Normal University (Harvard Dataverse)',
    version: 'Version 2, dataset release 10.1 (2026-07), year 2024 (doi:10.7910/DVN/YGIVCD)',
    reference_year: '2024',
    resolution: 'About 500 m grid; averaged here per LGA and state',
    // Licence field of the Harvard Dataverse dataset record (Dataverse API).
    licence: 'CC0 1.0',
    licence_url: 'http://creativecommons.org/publicdomain/zero/1.0',
    url: 'https://doi.org/10.7910/DVN/YGIVCD',
    method_summary:
      'Annual satellite measurement of light emitted at night, from the VIIRS sensor. We take the mean brightness of every grid cell in an LGA, counting dark cells as zero.',
    known_limitations:
      'A research product derived from VIIRS annual composites, used because the standard EOG VIIRS files need a login. It indicates lit economic activity, not household income. Gas flares in oil-producing areas register as light. Many rural LGAs read exactly zero and so share the lowest rank.',
    attribution: 'Night-time lights: Chen, Yu et al., NPP-VIIRS-like NTL data V2, Harvard Dataverse, CC0',
    data_nature: 'remote_sensing',
    status: 'active',
  },
  {
    id: 'meta_rwi',
    name: 'Relative Wealth Index',
    publisher: 'AI for Good at Meta and UC Berkeley (Chi, Fang, Chatterjee, Blumenstock)',
    version: 'HDX release, Nigeria file dated 2021-04-08',
    reference_year: '2021',
    resolution: '2.4 km grid',
    // license_other field of the HDX dataset record (CKAN API, package relative-wealth-index).
    licence: 'CC BY-NC 4.0 (non-commercial)',
    licence_url: 'https://creativecommons.org/licenses/by-nc/4.0/',
    url: 'https://data.humdata.org/dataset/relative-wealth-index',
    method_summary: 'Machine-learned estimate of relative household wealth from satellite and connectivity data. Not loaded.',
    known_limitations:
      'Excluded: the licence on the original HDX page forbids commercial use, so no Relative Wealth Index figure is stored or shown. The affluence index is built without it.',
    attribution: 'Not used',
    data_nature: 'modelled',
    status: 'excluded',
  },
];
