/**
 * Tier name pools — the source of truth for worktree auto-naming.
 *
 * Each tier corresponds to a theme. As a user progresses, they unlock the next
 * tier's pool. Pools are intentionally curated rather than exhaustive — every
 * name should be recognizable and pronounceable across cultures.
 *
 * Adding names: append to the end of the pool. Removing names is a breaking
 * change (existing worktrees may reference them). Don't reorder unless backing
 * out a typo.
 */

export type TierIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface TierMeta {
  readonly index: TierIndex;
  readonly key: string;
  readonly name: string;
  readonly emoji: string;
  readonly tagline: string;
}

export const TIER_META: Record<TierIndex, TierMeta> = {
  1: { index: 1, key: "trees", name: "Trees", emoji: "🌳", tagline: "Roots first." },
  2: { index: 2, key: "islands", name: "Islands", emoji: "🏝️", tagline: "Find your shore." },
  3: { index: 3, key: "rivers", name: "Rivers", emoji: "🌊", tagline: "Always moving." },
  4: { index: 4, key: "winds", name: "Winds", emoji: "💨", tagline: "Lift off." },
  5: { index: 5, key: "mountains", name: "Mountains", emoji: "⛰️", tagline: "Built to last." },
  6: { index: 6, key: "minerals", name: "Minerals", emoji: "💎", tagline: "Pressure makes form." },
  7: { index: 7, key: "constellations", name: "Constellations", emoji: "✨", tagline: "Map the sky." },
};

const TREES = [
  "Sequoia", "Cypress", "Maple", "Cedar", "Birch", "Willow", "Oak", "Pine",
  "Aspen", "Hemlock", "Spruce", "Fir", "Elm", "Beech", "Ash", "Poplar",
  "Sycamore", "Walnut", "Hickory", "Magnolia", "Dogwood", "Redwood", "Juniper",
  "Cottonwood", "Mahogany", "Teak", "Rowan", "Hazel", "Linden", "Tamarack",
  "Larch", "Acacia", "Banyan", "Baobab", "Olive", "Cherry", "Almond", "Yew",
  "Holly", "Ginkgo",
] as const;

const ISLANDS = [
  "Bali", "Corsica", "Malta", "Crete", "Zanzibar", "Madeira", "Capri", "Ibiza",
  "Mykonos", "Santorini", "Rhodes", "Sicily", "Sardinia", "Cyprus", "Tahiti",
  "Bora", "Maui", "Kauai", "Oahu", "Aruba", "Curacao", "Jamaica", "Bermuda",
  "Antigua", "Grenada", "Barbados", "Tobago", "Andros", "Naxos", "Patmos",
  "Lesbos", "Skiathos", "Hvar", "Brac", "Korcula", "Vis", "Mallorca", "Menorca",
  "Formentera", "Lanzarote", "Tenerife", "Madeira", "Azores", "Faroe", "Skye",
  "Lewis", "Iona", "Fiji", "Vanuatu", "Palawan",
] as const;

const RIVERS = [
  "Nile", "Danube", "Thames", "Rhine", "Amazon", "Ganges", "Yangtze", "Volga",
  "Mekong", "Tigris", "Euphrates", "Indus", "Hudson", "Colorado", "Snake",
  "Columbia", "Yukon", "Yenisei", "Lena", "Ob", "Loire", "Seine", "Rhone",
  "Po", "Tagus", "Ebro", "Elbe", "Oder", "Vistula", "Don", "Dnieper", "Sava",
  "Drava", "Tiber", "Arno", "Garonne", "Shannon", "Liffey", "Severn", "Trent",
  "Mersey", "Clyde", "Tay", "Spey", "Tweed", "Forth", "Avon", "Wye", "Ouse",
  "Tana",
] as const;

const WINDS = [
  "Mistral", "Zephyr", "Chinook", "Sirocco", "Monsoon", "Tramontane", "Bora",
  "Foehn", "Khamsin", "Harmattan", "Levanter", "Pampero", "Williwaw", "Etesian",
  "Squall", "Gale", "Tempest", "Breeze", "Gust", "Updraft", "Downdraft",
  "Tradewind", "Westerly", "Easterly", "Northern", "Southerly", "Cyclone",
  "Typhoon", "Vortex", "Squamish",
] as const;

const MOUNTAINS = [
  "Denali", "Fuji", "Olympus", "Rainier", "Kilimanjaro", "Everest", "Annapurna",
  "Matterhorn", "Eiger", "Jungfrau", "Aconcagua", "Elbrus", "Vinson", "Kosciuszko",
  "Etna", "Vesuvius", "Stromboli", "Cotopaxi", "Chimborazo", "Erebus", "Logan",
  "Robson", "Hood", "Shasta", "Whitney", "Half", "Cascade", "Adams", "Baker",
  "Glacier", "Lassen", "Mauna", "Haleakala", "Tahoma", "Kilauea", "Pikes",
  "Bond", "Garfield", "Lafayette", "Washington", "Katahdin", "Marcy", "Mansfield",
  "Greylock", "Whiteface", "Tongariro", "Cook", "Aspiring", "Tasman", "Sefton",
] as const;

const MINERALS = [
  "Obsidian", "Topaz", "Jasper", "Opal", "Agate", "Onyx", "Amber", "Quartz",
  "Amethyst", "Citrine", "Garnet", "Peridot", "Aquamarine", "Turquoise", "Lapis",
  "Malachite", "Azurite", "Pyrite", "Hematite", "Galena", "Sphalerite", "Cinnabar",
  "Calcite", "Fluorite", "Barite", "Gypsum", "Halite", "Talc", "Mica", "Feldspar",
  "Olivine", "Tourmaline", "Spinel", "Beryl", "Zircon", "Andalusite", "Kyanite",
  "Sillimanite", "Staurolite", "Wollastonite", "Rhodonite", "Sodalite", "Lazulite",
  "Sugilite", "Charoite", "Variscite", "Dioptase", "Heliodor", "Morganite", "Goshenite",
  "Iolite", "Tanzanite", "Sunstone", "Moonstone", "Labradorite", "Bloodstone",
  "Carnelian", "Sardonyx", "Chrysoprase", "Aventurine", "Tigereye", "Hawkeye",
  "Howlite", "Larimar", "Prehnite", "Apophyllite", "Fuchsite", "Serpentine",
  "Jadeite", "Nephrite", "Chalcedony", "Chrysocolla", "Smithsonite", "Hemimorphite",
  "Aragonite", "Vanadinite", "Wulfenite", "Mimetite", "Adamite", "Erythrite",
  "Crocoite",
] as const;

const CONSTELLATIONS = [
  "Andromeda", "Antlia", "Apus", "Aquarius", "Aquila", "Ara", "Aries", "Auriga",
  "Bootes", "Caelum", "Camelopardalis", "Cancer", "Canes", "Carina", "Cassiopeia",
  "Centaurus", "Cepheus", "Cetus", "Chamaeleon", "Circinus", "Columba", "Coma",
  "Corona", "Corvus", "Crater", "Crux", "Cygnus", "Delphinus", "Dorado", "Draco",
  "Equuleus", "Eridanus", "Fornax", "Gemini", "Grus", "Hercules", "Horologium",
  "Hydra", "Hydrus", "Indus", "Lacerta", "Leo", "Lepus", "Libra", "Lupus",
  "Lynx", "Lyra", "Mensa", "Microscopium", "Monoceros", "Musca", "Norma",
  "Octans", "Ophiuchus", "Orion", "Pavo", "Pegasus", "Perseus", "Phoenix",
  "Pictor", "Pisces", "Puppis", "Pyxis", "Reticulum", "Sagitta", "Sagittarius",
  "Scorpius", "Sculptor", "Scutum", "Serpens", "Sextans", "Taurus", "Telescopium",
  "Triangulum", "Tucana", "Ursa", "Vela", "Virgo", "Volans", "Vulpecula",
  "Sirius", "Vega", "Altair", "Rigel", "Betelgeuse", "Polaris", "Arcturus",
  "Capella", "Procyon",
] as const;

export const TIER_POOLS: Record<TierIndex, readonly string[]> = {
  1: TREES,
  2: ISLANDS,
  3: RIVERS,
  4: WINDS,
  5: MOUNTAINS,
  6: MINERALS,
  7: CONSTELLATIONS,
};

export function poolFor(tier: TierIndex): readonly string[] {
  return TIER_POOLS[tier];
}

export function isValidName(tier: TierIndex, name: string): boolean {
  const base = name.split("-")[0];
  return TIER_POOLS[tier].includes(base);
}
