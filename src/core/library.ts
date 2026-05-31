// Built-in tile library — the curated biome/structure sheets that ship with
// the app (served from public/library). No import needed; pick one and it loads
// + slices ready to use.

export interface LibraryEntry {
  name: string;
  file: string;
  category: "biome" | "structure";
  note?: string;
}

export const LIBRARY: LibraryEntry[] = [
  // Biomes (the complete "BIOME TILESET" series — ground, water+shore, paths,
  // cliffs, props). Best for painting world terrain.
  { name: "Highland", file: "biomes/highland.png", category: "biome", note: "temperate, most complete" },
  { name: "Beach", file: "biomes/beach.png", category: "biome", note: "best shorelines" },
  { name: "Swamp", file: "biomes/swamp.png", category: "biome", note: "bog + pond edges" },
  { name: "Snow", file: "biomes/snow.png", category: "biome", note: "tundra, ice water" },
  { name: "Rocky Mountain", file: "biomes/rocky-mountain.png", category: "biome", note: "cliffs/slopes" },
  { name: "Mystic Rainforest", file: "biomes/mystic-rainforest.png", category: "biome", note: "lush, waterfalls" },
  { name: "Desert", file: "biomes/desert.png", category: "biome", note: "sand, dunes, oasis" },
  { name: "Jungle", file: "biomes/jungle.png", category: "biome", note: "dense foliage" },
  { name: "Badlands", file: "biomes/badlands.png", category: "biome", note: "cracked earth, pits" },
  { name: "Dark Forest", file: "biomes/dark-forest.png", category: "biome", note: "dark grass, swamp" },
  { name: "Forest (legacy)", file: "biomes/forest.png", category: "biome", note: "props-rich; partial transitions" },
  // Structures & settlements (mostly objects + floor/wall tiles).
  { name: "Town", file: "structures/town.png", category: "structure", note: "houses, walls, cobble" },
  { name: "Graveyard", file: "structures/graveyard.png", category: "structure", note: "crypts, gravestones" },
  { name: "City Exterior 1", file: "structures/city-exterior-01.png", category: "structure" },
  { name: "City Exterior 2", file: "structures/city-exterior-02.png", category: "structure" },
  { name: "City Interiors", file: "structures/city-interiors.png", category: "structure" },
  { name: "Rural Village", file: "structures/rural-village.png", category: "structure" },
  { name: "Village Interiors", file: "structures/village-house-interiors.png", category: "structure" },
  { name: "Crypt / Dungeon", file: "structures/crypt-dungeon.png", category: "structure" }
];

/** URL the app can fetch. Relative so it works under the app's base path
 * (vite base is "./") in dev and in a built/static bundle. */
export function libraryUrl(file: string): string {
  return `library/${file}`;
}
