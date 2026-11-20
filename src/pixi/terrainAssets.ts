// Every processed terrain image (splats and prop stamps), found automatically by Vite, so a
// new variant needs no import line here: only its manifest entry in terrainVariants.ts.
// Keys are file names such as "props-forest-2.png"; values are the bundled URLs.

const found = import.meta.glob('../assets/terrain/{splat,props}-*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export const TERRAIN_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(found).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]),
);
