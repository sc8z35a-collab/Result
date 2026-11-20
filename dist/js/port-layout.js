// Local coordinates are in metres; +Z is the front of each fixture. These same
// solid parts define the visual silhouette, movement, cover and walkable roofs.
const solid = (name, x, z, w, h, d, mat, base = 0) => ({name, x, z, w, h, d, mat, base});
const designs = {
  pumpHouse: [
    solid('pumpRoom', -1.27, 0, 3.06, 3.38, 5.72, 'concrete'),
    solid('canopy', 0, 0, 5.92, .25, 6.06, 'steel', 3.38),
    solid('pier', 2.56, 2.52, .38, 3.38, .38, 'steel'),
    solid('pier', 2.56, -2.52, .38, 3.38, .38, 'steel'),
    solid('roofVent', -1.25, -.62, 1.42, .72, 1.13, 'steel', 3.63)
  ],
  weighOffice: [
    solid('office', 0, 0, 4.92, 2.85, 3.08, 'steel'),
    solid('parapet', 0, .12, 5.18, .25, 3.60, 'steel', 2.85),
    solid('scaleReader', -3.60, 2.11, .52, 1.39, .42, 'steel')
  ],
  reefer: [solid('reefer', 0, 0, 3.06, 2.22, 1.72, 'steel')],
  generator: [
    solid('generator', 0, 0, 3.18, 1.49, 1.63, 'steel'),
    solid('silencer', -.86, 0, 1.12, .42, 1.10, 'steel', 1.49)
  ],
  ice: [solid('ice', 0, 0, 2.75, 1.12, 1.63, 'steel')],
  timber: [solid('timber', 0, 0, 4.56, .91, 1.60, 'wood')],
  sling: [solid('sling', 0, 0, 2.40, 1.74, 1.83, 'wood')],
  gabion: [solid('gabion', 0, 0, 3.34, 1.03, 1.54, 'concrete')],
  locker: [solid('locker', 0, 0, 2.08, 1.38, 1.45, 'steel')]
};
const orientations = [[1, 0], [0, 1], [-1, 0], [0, -1]];

// Walk from the south landing, past the tidal intake and through to the north scale.
const placements = [
  ['reefer', -6.3, 87.6, 1], ['ice', -18.6, 77.2, 0], ['sling', 19.9, 87.1, 3],
  ['ice', 20.5, 66.9, 3], ['timber', -6.4, 64, 0], ['generator', -18.5, 51.3, 1],
  ['sling', -2.9, 40.7, 0], ['ice', 19.6, 32.8, 3], ['timber', 10.8, 36.3, 0],
  ['locker', -21.5, 24, 1], ['pumpHouse', -18.8, 15.8, 0], ['reefer', 20.5, 13.4, 3],
  ['gabion', 4.6, 6.6, 0], ['timber', -11.1, -0.6, 1], ['locker', -20.4, -11.8, 1],
  ['generator', 19.8, -17.6, 3], ['sling', -1.8, -24.1, 0],
  ['weighOffice', 20.0, -32.6, 3], ['gabion', -16.8, -36, 1],
  ['timber', 5.8, -42.9, 1], ['locker', -19.7, -51.8, 1],
  ['ice', 20.6, -66.4, 3], ['gabion', -9.4, -70.5, 0], ['reefer', -18.4, -83.4, 1],
  ['generator', 9.0, -87.4, 2], ['sling', -4.8, -91.8, 0]
];

export const dockFixtures = placements.map(([kind, x, z, turn]) => {
  const [cos, sin] = orientations[turn];
  return {kind, x, z, cos, sin, parts: designs[kind]};
});

export function dockBounds(fixture, part) {
  const {x, z, cos, sin} = fixture;
  const cx = x + part.x * cos + part.z * sin, cz = z - part.x * sin + part.z * cos;
  const w = cos ? part.w : part.d, d = cos ? part.d : part.w;
  return {x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2,
    y0: part.base, y1: part.base + part.h, mat: part.mat};
}
