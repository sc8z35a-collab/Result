import {Mesh, scale, add, sub, unit, cross, dot, clamp, color, layers, sphereInFrustum} from './geometry.js';
import {obstruction} from './yard.js';
import {machConeHalfAngle} from './magnus.js';
const rubber = '#485050', cloth = '#64716b', metal = '#9babad', ink = '#536067', ivory = '#c8c7ad';

// Helper: build an orthonormal basis (u, v, n) around an arbitrary axis.
function basisOf(axis) {
  const n = unit(axis);
  const u = unit(cross(n, Math.abs(n[1]) > .92 ? [1, 0, 0] : [0, 1, 0]));
  const v = cross(n, u);
  return [u, v, n];
}

// Helper: draw a crisp polygonal glowing shockwave / energy ring around center oriented along axis (zero-GC scalar fast path).
function ring(m, center, axis, radius, thick, segs, tint, kind = 3) {
  const co = color(tint);
  m.ringS(center[0], center[1], center[2], axis[0], axis[1], axis[2], radius, thick, segs, 0, co[0], co[1], co[2], kind);
}

// Helper: crisp HDR radial lens-flare / impact glare star oriented around axis.
function starFlare(m, center, axis, radius, thick, rays, tint, rot = 0, kind = 3) {
  const [u, v, n] = basisOf(axis);
  const co = color(tint);
  for (let i = 0; i < rays; i++) {
    const a = rot + i / rays * Math.PI;
    const ca = Math.cos(a) * radius, sa = Math.sin(a) * radius;
    const dx = u[0] * ca + v[0] * sa, dy = u[1] * ca + v[1] * sa, dz = u[2] * ca + v[2] * sa;
    m.beamS(center[0] - dx, center[1] - dy, center[2] - dz, center[0] + dx, center[1] + dy, center[2] + dz, thick, thick, 0, co[0], co[1], co[2], kind);
  }
  m.beamS(
    center[0] - n[0] * radius * .45, center[1] - n[1] * radius * .45, center[2] - n[2] * radius * .45,
    center[0] + n[0] * radius * .65, center[1] + n[1] * radius * .65, center[2] + n[2] * radius * .65,
    thick * .9, thick * .9, 0, co[0], co[1], co[2], kind
  );
}

// Helper: curved 7-cell geodesic hexagonal energy shield lattice centered on impact normal.
function hexPatch(m, center, normal, cellR, thick, tint, outerTint, kind = 3) {
  const [u, v, n] = basisOf(normal);
  ring(m, center, n, cellR, thick, 6, tint, kind);
  const step = cellR * 1.72;
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2 + Math.PI / 6;
    const dir = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
    const c = add(add(center, scale(dir, step)), scale(n, -cellR * .42));
    const cellN = unit(add(n, scale(dir, .36)));
    ring(m, c, cellN, cellR * .86, thick * .78, 6, outerTint || tint, kind);
  }
}

// Helper: flat normal-aligned crater / molten scorch disc (zero-GC scalar fast path).
function scorchDisc(m, center, normal, radius, tint, segs = 8, kind = 3) {
  const co = color(tint);
  m.discS(center[0], center[1], center[2], normal[0], normal[1], normal[2], radius, segs, 0, co[0], co[1], co[2], kind);
}

// MS10: Hyper-velocity electromagnetic rail carbine (fastest projectile velocity: 180, auto fire rate: 130).
function ms10Device(m) {
  const frame = '#39464d', alloy = '#b5c4c8', accent = '#58c9e8', gold = '#edc060', dark = '#242f34';
  // Angular main receiver & upper rail spine
  m.box(0, .016, -.085, .092, .112, .38, 'blackMetal', frame, .34, 1);
  m.box(0, .082, -.115, .104, .038, .44, 'steel', alloy, .25, 1);
  // Twin upper & lower magnetic accelerator rails extending forward
  m.box(0, .054, -.50, .052, .026, .46, 'steel', alloy, .22, 1);
  m.box(0, -.008, -.48, .056, .028, .42, 'blackMetal', frame, .24, 1);
  // Central recessed precision rail barrel & glowing accelerator channel
  m.tube([0, .023, -.26], [0, .023, -.79], .024, .021, 'blackMetal', dark, 10, 1);
  m.box(0, .023, -.49, .018, .022, .42, 'white', '#7deaff', 0, 3);
  // Finned hyper-velocity muzzle brake
  m.box(0, .023, -.76, .068, .056, .11, 'steel', '#96a8ad', .2, 1);
  m.tube([0, .023, -.815], [0, .023, -.845], .028, .024, 'blackMetal', dark, 10, 1);
  // Glowing capacitor coils & gold voltage accents along both flanks
  for (const sx of [-1, 1]) {
    m.box(sx * .050, .024, -.46, .012, .058, .36, 'steel', '#697c84', 0, 1);
    for (let i = 0; i < 6; i++) {
      m.box(sx * .058, .024, -.31 - i * .062, .009, .020, .028, 'white', i % 2 ? accent : '#a8f6ff', 0, 3);
    }
    m.box(sx * .052, .064, -.10, .009, .014, .22, 'white', gold, 0, 3);
  }
  // Angled 24-round high-pressure magazine & ergonomic grip
  m.beam([0, -.035, -.14], [0, -.155, -.20], .064, .088, 'blackMetal', '#3a464a', 1);
  m.box(0, -.115, -.18, .068, .022, .092, 'white', gold, 0, 1);
  m.beam([0, -.038, .022], [0, -.152, .072], .062, .082, 'rubber', rubber, 0);
  // Lightweight skeleton stock
  m.beam([0, .048, .095], [0, .022, .255], .038, .028, 'steel', alloy, 1);
  m.beam([0, -.016, .095], [0, -.072, .245], .032, .026, 'blackMetal', frame, 1);
  m.box(0, -.026, .258, .064, .135, .046, 'rubber', dark, 0, 0);
  // Open-frame reflex holo-sight with glowing cyan aiming reticle pip
  m.box(0, .112, -.09, .066, .024, .115, 'blackMetal', dark, 0, 1);
  for (const sx of [-1, 1]) m.box(sx * .030, .148, -.09, .010, .054, .072, 'steel', alloy, 0, 1);
  m.box(0, .174, -.09, .068, .010, .072, 'steel', alloy, 0, 1);
  m.box(0, .146, -.09, .008, .008, .008, 'white', '#9cfaff', 0, 3);
  m.box(0, .118, -.68, .016, .034, .032, 'white', gold, 0, 3);
}

// RD40: Player-only twin-linked supersonic carbine with 130-round quad-drum mag & D01 SENSOR array pod.
function rd40Device(m) {
  const obsidian = '#242c30', titanium = '#6c7c82', crimson = '#ff5464', ember = '#ffb85c', sensorGlow = '#4fffe0';
  // Broad sculpted twin-linked receiver chassis
  m.box(0, .020, -.12, .128, .102, .42, 'blackMetal', obsidian, .28, 1);
  m.box(0, .076, -.10, .114, .036, .38, 'steel', titanium, .20, 1);
  // Twin parallel long supersonic barrels + crimson acceleration rails + twin compensators
  for (const sx of [-1, 1]) {
    const bx = sx * .036;
    m.box(bx, .026, -.48, .038, .062, .38, 'blackMetal', '#333e44', .18, 1);
    m.tube([bx, .026, -.28], [bx, .026, -.80], .020, .018, 'steel', '#4e5c62', 10, 1);
    m.box(bx, .026, -.78, .034, .036, .095, 'steel', '#96a6ac', .16, 1);
    m.tube([bx, .026, -.828], [bx, .026, -.848], .022, .020, 'blackMetal', obsidian, 8, 1);
    // Glowing crimson/amber twin acceleration side strips
    for (let i = 0; i < 5; i++) {
      m.box(sx * .060, .026, -.33 - i * .072, .009, .018, .034, 'white', i % 2 ? ember : crimson, 0, 3);
    }
    m.box(sx * .066, .054, -.12, .008, .014, .24, 'white', crimson, 0, 3);
  }
  // Center thermal bridge between twin barrels
  m.box(0, .026, -.50, .026, .032, .40, 'steel', '#526066', 0, 1);
  m.box(0, .048, -.52, .014, .012, .34, 'white', ember, 0, 3);
  // 130-round twin-drum high-capacity magazine + ergonomic angled grip
  for (const sx of [-1, 1]) {
    m.tube([sx * .058, -.105, -.13], [sx * .058, -.105, -.25], .052, .052, 'blackMetal', '#303a3f', 10, 1);
    m.box(sx * .096, -.105, -.19, .012, .028, .072, 'white', ember, 0, 3);
  }
  m.box(0, -.072, -.19, .084, .082, .112, 'blackMetal', obsidian, 0, 1);
  m.beam([0, -.038, .022], [0, -.152, .076], .064, .084, 'rubber', rubber, 0);
  // Reinforced dual-strut skeleton stock
  m.beam([0, .046, .095], [0, .020, .255], .040, .028, 'steel', titanium, 1);
  m.beam([0, -.018, .095], [0, -.072, .245], .034, .026, 'blackMetal', obsidian, 1);
  m.box(0, -.026, .258, .068, .135, .046, 'rubber', '#222a2d', 0, 0);
  // Top D01 SENSOR through-wall optical-radar array pod (glowing emerald-cyan scanner + crimson targeting frame)
  m.box(0, .114, -.10, .094, .036, .165, 'blackMetal', obsidian, 0, 1);
  m.box(0, .148, -.10, .078, .036, .125, 'steel', '#46545a', .15, 1);
  m.tube([0, .148, -.148], [0, .148, -.175], .024, .020, 'white', sensorGlow, 10, 3);
  for (const sx of [-1, 1]) {
    m.box(sx * .044, .148, -.095, .010, .024, .085, 'white', crimson, 0, 3);
  }
  m.box(0, .120, -.68, .022, .030, .036, 'white', sensorGlow, 0, 3);
}

// RD30: Open-access twin-linked 80-round squad carbine with ARV1.1 mini rail module.
function rd30Device(m) {
  const slate = '#2d373d', alloy = '#78888d', amber = '#ffaa4a', teal = '#5ee8d4';
  m.box(0, .020, -.10, .118, .096, .39, 'blackMetal', slate, .24, 1);
  m.box(0, .072, -.09, .104, .032, .35, 'steel', alloy, .18, 1);
  // Twin parallel medium barrels + compact twin brakes
  for (const sx of [-1, 1]) {
    const bx = sx * .032;
    m.box(bx, .025, -.43, .034, .054, .32, 'blackMetal', '#3a464c', .16, 1);
    m.tube([bx, .025, -.26], [bx, .025, -.72], .019, .017, 'steel', '#59686e', 9, 1);
    m.box(bx, .025, -.70, .030, .032, .080, 'steel', '#99a8ad', .14, 1);
    for (let i = 0; i < 4; i++) {
      m.box(sx * .054, .025, -.31 - i * .070, .008, .016, .030, 'white', i % 2 ? teal : amber, 0, 3);
    }
  }
  m.box(0, .025, -.44, .022, .028, .34, 'steel', '#56646a', 0, 1);
  // 80-round compact twin drum mag + grip + stock
  for (const sx of [-1, 1]) {
    m.tube([sx * .048, -.098, -.13], [sx * .048, -.098, -.23], .042, .042, 'blackMetal', '#354046', 9, 1);
  }
  m.box(0, -.068, -.18, .074, .072, .096, 'blackMetal', slate, 0, 1);
  m.beam([0, -.036, .022], [0, -.148, .072], .060, .078, 'rubber', rubber, 0);
  m.beam([0, .040, .090], [0, .014, .235], .036, .026, 'steel', alloy, 1);
  m.box(0, -.024, .238, .062, .125, .042, 'rubber', '#242c30', 0, 0);
  // Compact ARV1.1 mini micro-optic rail
  m.box(0, .106, -.09, .072, .028, .125, 'blackMetal', slate, 0, 1);
  m.box(0, .126, -.09, .048, .024, .085, 'steel', '#4e5d63', 0, 1);
  m.box(0, .126, -.135, .026, .014, .014, 'white', amber, 0, 3);
}

// RD20: Agile 20-round full-auto tactical carbine with ARV1.1 precision guidance module.
function rd20Device(m) {
  const dark = '#263036', steel = '#7d8e92', cyan = '#54f0d8', gold = '#f5ca64';
  m.box(0, .020, -.09, .092, .092, .35, 'blackMetal', dark, .22, 1);
  m.box(0, .068, -.09, .082, .030, .33, 'steel', steel, .18, 1);
  m.box(0, .024, -.37, .066, .058, .28, 'steel', '#4a5a60', .16, 1);
  m.tube([0, .024, -.26], [0, .024, -.64], .024, .021, 'blackMetal', '#333f45', 10, 1);
  m.box(0, .024, -.62, .044, .040, .082, 'steel', '#96a8ad', .14, 1);
  for (const sx of [-1, 1]) {
    m.box(sx * .038, .028, -.35, .008, .016, .22, 'white', cyan, 0, 3);
    m.box(sx * .048, .052, -.10, .008, .012, .18, 'white', gold, 0, 3);
  }
  // Angled 20-round stick mag + grip + compact stock
  m.beam([0, -.034, -.14], [0, -.145, -.19], .052, .072, 'blackMetal', '#344046', 1);
  m.box(0, -.108, -.175, .056, .018, .076, 'white', gold, 0, 1);
  m.beam([0, -.036, .022], [0, -.146, .070], .056, .074, 'rubber', rubber, 0);
  m.beam([0, .036, .086], [0, .008, .220], .034, .024, 'steel', steel, 1);
  m.box(0, -.022, .224, .056, .118, .040, 'rubber', '#222b2f', 0, 0);
  // ARV1.1 sleek top holo sight
  m.box(0, .102, -.08, .060, .022, .110, 'blackMetal', dark, 0, 1);
  for (const sx of [-1, 1]) m.box(sx * .026, .134, -.08, .009, .046, .066, 'steel', steel, 0, 1);
  m.box(0, .156, -.08, .060, .009, .066, 'steel', steel, 0, 1);
  m.box(0, .132, -.08, .008, .008, .008, 'white', cyan, 0, 3);
}

// DF40 II: Player-only flagship quad-barrel smart carbine with 350-round quad-helix drum,
// ARV1.3 convergent 4-barrel accelerator array & Auto-Aim 1.4 overdrive thermal radiator pod.
function df40iiDevice(m) {
  const obsidian = '#1f2830', ceramic = '#c8d0cc', titanium = '#768894', violet = '#8672ff', cyan = '#52f6ff', gold = '#ffd066';
  // Sculpted carbon-ceramic hybrid flagship receiver chassis
  m.box(0, .022, -.11, .142, .112, .44, 'blackMetal', obsidian, .28, 1);
  m.box(0, .082, -.10, .126, .036, .40, 'steel', ceramic, .22, 1);
  // Quad-barrel 2x2 accelerator cluster (upper-L, upper-R, lower-L, lower-R)
  const quadBarrels = [
    [-.036, .044, -.85, -.82],
    [.036, .044, -.85, -.82],
    [-.032, .004, -.82, -.79],
    [.032, .004, -.82, -.79]
  ];
  for (let b = 0; b < quadBarrels.length; b++) {
    const [bx, by, len, comp] = quadBarrels[b];
    const isTop = b < 2;
    m.box(bx, by, -.48, .034, .034, .40, 'blackMetal', '#2e3a44', .18, 1);
    m.tube([bx, by, -.28], [bx, by, len], .017, .015, 'steel', '#5b6c76', 9, 1);
    m.box(bx, by, comp, .030, .030, .092, 'steel', '#a2b4bc', .16, 1);
    m.tube([bx, by, len - .022], [bx, by, len - .038], .019, .017, 'blackMetal', obsidian, 8, 1);
    // Glowing ARV1.3 plasma conduits running along each of the 4 barrels
    for (let i = 0; i < 4; i++) {
      const stripCol = isTop ? (i % 2 ? gold : cyan) : (i % 2 ? cyan : violet);
      m.box(bx + Math.sign(bx) * .019, by + (isTop ? .012 : -.010), -.33 - i * .092, .008, .012, .034, 'white', stripCol, 0, 3);
    }
  }
  // Central quad-convergence magnetic yoke & dorsal thermal cooling fins (expand on lock/AA1.4!)
  m.box(0, .024, -.52, .054, .044, .42, 'steel', titanium, .16, 1);
  m.box(0, .024, -.54, .020, .016, .36, 'white', cyan, 0, 3);
  for (const sx of [-1, 1]) {
    // Flank overdrive thermal radiator fins (x > 0.05 -> animated by shaders.js uAnim rail pulse!)
    m.box(sx * .072, .048, -.16, .014, .034, .28, 'steel', '#485862', .15, 1);
    m.box(sx * .078, .054, -.16, .009, .014, .24, 'white', violet, 0, 3);
    m.box(sx * .076, .028, -.16, .008, .010, .20, 'white', gold, 0, 3);
  }
  // 350-round quad-helix high-capacity drum magazine + ergonomic grip
  for (const sx of [-1, 1]) {
    m.tube([sx * .066, -.106, -.11], [sx * .066, -.106, -.28], .058, .058, 'blackMetal', '#2a353d', 10, 1);
    m.box(sx * .108, -.106, -.195, .012, .032, .096, 'white', cyan, 0, 3);
  }
  // Central twin under-slung helical drum cores
  m.tube([0, -.126, -.12], [0, -.126, -.29], .050, .050, 'steel', '#3d4c55', 10, 1);
  m.box(0, -.164, -.205, .036, .012, .100, 'white', gold, 0, 3);
  m.box(0, -.070, -.195, .096, .084, .128, 'blackMetal', obsidian, 0, 1);
  m.beam([0, -.038, .024], [0, -.154, .078], .064, .086, 'rubber', rubber, 0);
  // Dual-strut ceramic-titanium counterbalance stock
  m.beam([0, .048, .098], [0, .022, .265], .042, .030, 'steel', ceramic, 1);
  m.beam([0, -.018, .098], [0, -.074, .252], .034, .026, 'blackMetal', obsidian, 1);
  m.box(0, -.026, .268, .070, .138, .048, 'rubber', '#1e262b', 0, 0);
  // Top ARV1.3 Optical Prism + Auto-Aim 1.4 Overdrive Core Pod (y > 0.095 -> animated by shader pod deploy!)
  m.box(0, .118, -.10, .106, .038, .178, 'blackMetal', obsidian, 0, 1);
  m.box(0, .154, -.10, .088, .038, .136, 'steel', '#465864', .16, 1);
  m.tube([0, .156, -.152], [0, .156, -.186], .026, .022, 'white', cyan, 12, 3);
  for (const sx of [-1, 1]) {
    m.box(sx * .050, .154, -.095, .011, .026, .096, 'white', violet, 0, 3);
    m.box(sx * .034, .176, -.10, .010, .010, .082, 'white', gold, 0, 3);
  }
  m.box(0, .124, -.72, .024, .032, .038, 'white', cyan, 0, 3);
}

// RD 50: Heavy-duty 50-round full-auto carbine with rapid-regen drum cell & cooling-fin heavy barrel (NO auto-aim module).
function rd50Device(m) {
  const gunmetal = '#2b3235', olive = '#525d52', brass = '#d9b252', steel = '#8c999c';
  // Heavy milled upper/lower receiver
  m.box(0, .022, -.10, .110, .102, .40, 'blackMetal', gunmetal, .22, 1);
  m.box(0, .076, -.09, .096, .032, .36, 'steel', olive, .18, 1);
  // Ribbed heat-dissipating heavy barrel shroud + single heavy barrel + muzzle brake
  m.box(0, .025, -.42, .078, .068, .32, 'blackMetal', '#384144', .16, 1);
  for (let i = 0; i < 4; i++) {
    m.box(0, .025, -.31 - i * .068, .086, .074, .016, 'steel', steel, .12, 1);
  }
  m.tube([0, .025, -.28], [0, .025, -.74], .026, .023, 'steel', '#5e6b70', 10, 1);
  m.box(0, .025, -.72, .048, .044, .088, 'steel', '#a2afb3', .14, 1);
  // Rapid-regen brass-amber charge strips along flank (signals 3.2/s rapid ammo regeneration)
  for (const sx of [-1, 1]) {
    m.box(sx * .058, .046, -.10, .009, .014, .22, 'white', brass, 0, 3);
    m.box(sx * .044, .025, -.42, .008, .012, .20, 'white', '#f2cf72', 0, 3);
  }
  // Oversized 50-round staggered extended box-drum magazine
  m.box(0, -.094, -.165, .076, .155, .112, 'blackMetal', '#333b3e', .16, 1);
  m.box(0, -.142, -.165, .082, .026, .118, 'steel', brass, .12, 1);
  for (const sx of [-1, 1]) {
    m.box(sx * .041, -.092, -.165, .008, .078, .018, 'white', brass, 0, 3);
  }
  // Ergonomic grip + solid recoil-dampening stock
  m.beam([0, -.036, .024], [0, -.150, .074], .060, .078, 'rubber', rubber, 0);
  m.beam([0, .042, .092], [0, .014, .248], .040, .028, 'steel', olive, 1);
  m.beam([0, -.016, .092], [0, -.068, .238], .030, .024, 'blackMetal', gunmetal, 1);
  m.box(0, -.026, .252, .064, .130, .044, 'rubber', '#22292c', 0, 0);
  // Clean mechanical open iron/reflex bridge (no auto-aim sensor pod)
  m.box(0, .106, -.08, .060, .020, .115, 'blackMetal', gunmetal, 0, 1);
  for (const sx of [-1, 1]) m.box(sx * .026, .134, -.08, .008, .040, .052, 'steel', steel, 0, 1);
  m.box(0, .122, -.66, .016, .034, .024, 'steel', brass, 0, 1);
}

function device(m, gun) {
  if (gun === 'DF1 OUT') {
    dfDevice(m);
    return;
  }
  if (gun === 'DF40 II') {
    df40iiDevice(m);
    return;
  }
  if (gun === 'MS10') {
    ms10Device(m);
    return;
  }
  if (gun === 'RD40') {
    rd40Device(m);
    return;
  }
  if (gun === 'RD 50') {
    rd50Device(m);
    return;
  }
  if (gun === 'RD30') {
    rd30Device(m);
    return;
  }
  if (gun === 'RD20') {
    rd20Device(m);
    return;
  }
  const long = gun === 'SW T' ? .52 : gun === 'SRA' ? .69 : .72;
  const w = gun === 'D1' ? .123 : .096, tag = gun === 'SW T' ? '#deaa58' : gun === 'SRA' ? '#67a69e' : '#c87b60';
  m.box(0, .015, -.075, w, .123, .35, 'blackMetal', '#a5aeb0', .36, 1);
  m.box(0, .084, -.076, w + .012, .048, .35, 'steel', metal, .28, 1);
  m.box(0, .015, -long * .59, w * .86, .092, long * .48, 'steel', '#8b9895', .25, 1);
  m.tube([0, .024, -long + .07], [0, .024, -long - .035], .042, .039, 'blackMetal', ink, 10);
  m.tube([0, .024, -long - .036], [0, .024, -long - .045], .026, .026, 'white', '#2d383c', 10);
  m.box(0, .027, -.222, w + .016, .064, .122, 'white', tag, 0, 1);
  m.box(0, -.089, .022, w * .76, .146, .088, 'rubber', rubber);
  m.box(0, -.075, -.14, w * .82, .118, gun === 'D1' ? .143 : .092, 'blackMetal', '#a5a89c');
  m.box(0, .127, -.05, w * .61, .055, .065, 'blackMetal', ink);
  m.box(0, .127, -long + .14, .023, .055, .036, 'white', tag);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) m.box(s * (w / 2 + .005), .034, -.28 - i * .038, .009, .024, .017, 'blackMetal', ink);
    m.box(s * (w / 2 + .009), .047, -.073, .008, .018, .062, 'white', '#74c8b2', 0, 3);
  }
  if (gun !== 'SW T') {
    m.beam([0, .012, .082], [0, -.035, .225], w * .65, .066, 'white', ink);
    m.box(0, -.033, .2, w * .84, .145, .065, 'rubber', rubber);
  }
  if (gun === 'D1') m.tube([.040, .02, -long + .18], [.040, .02, -long - .003], .025, .025, 'steel', metal, 8);
}

// A fictional ceramic-bodied launcher. Its two illuminated channels distinguish
// the standard magazine and the independently replenished P1 cell.
function dfDevice(m) {
  const ceramic = '#bebda6', trim = '#5f7776', dark = '#454f52', copper = '#c49169';
  m.tube([0, .028, .09], [0, .03, -.46], .083, .065, 'steel', ceramic, 8);
  for (const sx of [-1, 1]) {
    m.beam([sx * .06, .01, .14], [sx * .054, .046, -.32], .039, .058, 'greenHull', trim);
    m.box(sx * .069, -.036, -.118, .031, .060, .30, 'blackMetal', '#9da79c');
    m.tube([sx * .052, -.026, -.31], [sx * .048, -.018, -.62], .033, .030, 'steel', trim, 10);
    for (let i = 0; i < 5; i++) m.box(sx * .087, -.021, -.025 - i * .036, .012, .014, .020, 'white', '#89d9ca', 0, 3);
  }
  m.tube([0, .022, -.42], [0, .032, -.66], .057, .042, 'blackMetal', '#9aa6a0', 10);
  m.tube([0, .032, -.615], [0, .032, -.674], .056, .047, 'steel', copper, 10);
  m.tube([0, .032, -.675], [0, .032, -.681], .028, .028, 'white', dark, 10);
  m.beam([0, -.038, .023], [0, -.154, .084], .073, .089, 'rubber', dark);
  m.tube([0, -.034, -.15], [0, -.13, -.17], .063, .069, 'greenHull', trim, 8);
  m.tube([.087, -.04, -.04], [.087, -.04, -.263], .028, .028, 'white', '#d79560', 8);
  m.beam([0, .032, .097], [0, -.045, .22], .045, .07, 'steel', trim);
  m.ellipsoid(0, -.044, .205, .048, .09, .045, 'rubber', dark, 0, 8, 4);
  m.box(0, .093, -.12, .056, .052, .11, 'blackMetal', dark);
  m.tube([0, .142, -.045], [0, .142, -.20], .053, .047, 'blackMetal', '#9aa8a2', 12);
  m.tube([0, .142, -.037], [0, .142, -.044], .044, .044, 'white', '#4a8180', 12);
  m.box(-.046, .14, -.116, .034, .041, .055, 'white', copper);
}

export function muzzleOffset(gun) {
  if (gun === 'MS10') return [0, .024, -.86];
  if (gun === 'DF40 II') return [0, .024, -.88];
  if (gun === 'RD40') return [0, .026, -.85];
  if (gun === 'RD 50') return [0, .025, -.76];
  if (gun === 'RD30') return [0, .025, -.75];
  if (gun === 'RD20') return [0, .024, -.67];
  if (gun === 'DF1 OUT') return [0, .032, -.70];
  if (gun === 'SW T') return [0, .024, -.58];
  if (gun === 'SRA') return [0, .024, -.75];
  return [0, .024, -.78];
}

// Local-space crisp, non-obstructive 3D muzzle flash attached to first-person weapon barrel tip(s).
export function muzzleFlashMesh(gun, intensity, seed, extra = false, lite = false, streamMesh = null) {
  const m = streamMesh || new Mesh(128);
  if (streamMesh) m.reset();
  if (intensity <= .01) return m;
  const [mx0, my0, mz0] = muzzleOffset(gun);
  const tips = gun === 'DF40 II'
    ? [[mx0 - .036, .044, -.87], [mx0 + .036, .044, -.87], [mx0 - .032, .004, -.84], [mx0 + .032, .004, -.84]]
    : gun === 'RD40' ? [[mx0 - .036, my0, mz0], [mx0 + .036, my0, mz0]]
    : gun === 'RD30' ? [[mx0 - .032, my0, mz0], [mx0 + .032, my0, mz0]]
    : [[mx0, my0, mz0]];
  const s = intensity * (gun === 'MS10' ? .92 : gun === 'DF40 II' ? .56 : gun === 'RD40' ? .66 : gun === 'RD 50' ? .72 : gun === 'RD30' ? .60 : gun === 'D1' ? .78 : .70);
  const coreCol = color(gun === 'MS10' ? '#e8ffff' : gun === 'DF40 II' ? '#f4f0ff' : gun === 'RD40' ? '#fff4ea' : gun === 'RD 50' ? '#fff8df' : gun === 'RD30' ? '#fff6e4' : (gun === 'DF1 OUT' || gun === 'RD20') ? '#dcfff7' : '#fff8dc');
  const outerCol = color(gun === 'MS10' ? '#4de2ff' : gun === 'DF40 II' ? '#8c74ff' : gun === 'RD40' ? '#ff5c5c' : gun === 'RD 50' ? '#f0c454' : gun === 'RD30' ? '#ffad4e' : gun === 'RD20' ? '#58f0d8' : gun === 'DF1 OUT' ? '#6de8d5' : gun === 'SRA' ? '#ffcf76' : '#ffaa4e');
  const cr = coreCol[0], cg = coreCol[1], cb = coreCol[2];
  const or = outerCol[0], og = outerCol[1], ob = outerCol[2];
  const rot = (seed * 1.618) % 6.28;
  for (let b = 0; b < tips.length; b++) {
    const t = tips[b];
    const mx = t[0], my = t[1], mz = t[2];
    const bRot = rot + b * .75;
    if (lite) {
      m.beamS(mx, my, mz, mx, my, mz - .20 * s, .028 * s, .028 * s, 0, cr, cg, cb, 3);
      for (let i = 0; i < 2; i++) {
        const a = bRot + i * Math.PI * .5;
        const cx = Math.cos(a) * .095 * s, cy = Math.sin(a) * .095 * s;
        m.beamS(mx - cx, my - cy, mz - .02 * s, mx + cx, my + cy, mz - .02 * s, .015 * s, .012 * s, 0, or, og, ob, 3);
      }
      continue;
    }
    const blades = 3;
    m.ellipsoidS(mx, my, mz - .04 * s, .036 * s, .036 * s, .068 * s, 0, cr, cg, cb, 3, 6, 3);
    m.tubeS(mx, my, mz, mx, my, mz - .24 * s, .032 * s, .005, 0, or, og, ob, 6, 3);
    for (let i = 0; i < blades; i++) {
      const a = bRot + i * Math.PI / blades;
      const len = (.10 + ((i * 37 + seed + b * 5) % 5) * .014) * s;
      const cx = Math.cos(a) * len, cy = Math.sin(a) * len;
      m.beamS(mx - cx, my - cy, mz - .02 * s, mx + cx, my + cy, mz - .02 * s, .015 * s, .011 * s, 0, or, og, ob, 3);
    }
  }
  return m;
}

export function viewModel(gun) {
  const m = new Mesh();
  device(m, gun);
  m.ellipsoid(.012, -.104, .045, .060, .066, .097, 'rubber', '#727c73', 0, 10, 5);
  m.tube([.018, -.133, .077], [.085, -.237, .299], .065, .088, 'canvas', '#7c8273', 9);
  m.tube([.020, -.138, .093], [.026, -.156, .126], .072, .072, 'blackMetal', rubber, 9);
  m.ellipsoid(-.04, -.089, -.205, .066, .048, .088, 'rubber', '#727d76', 0, 10, 5);
  m.tube([-.055, -.11, -.189], [-.166, -.249, .008], .056, .072, 'canvas', '#899585', 8);
  return m;
}

export function character(team, gun, variant = 'standard', detail = 'high') {
  const m = new Mesh();
  const isSpy = variant === 'spy';
  const hi = detail === 'high';
  const mid = detail === 'mid';
  const seg = hi ? 12 : mid ? 6 : 7;
  const eSeg = hi ? 14 : mid ? 7 : 8;
  const eBand = hi ? 7 : mid ? 3 : 4;
  const cSeg = hi ? 8 : mid ? 4 : 5;
  const ribs = hi ? 4 : mid ? 1 : 2;

  // Color palette: Standard Team (Cyan / Orange) vs Elite NV2.1 Spy (Midnight Stealth Carbon + Emerald-Cyan Tri-Optic)
  const accent = isSpy ? '#28e6c6' : (team ? '#df8054' : '#55b9b4');
  const light = isSpy ? '#72fff0' : (team ? '#f2a16e' : '#88ded2');
  const darkArmor = isSpy ? '#222d33' : '#384347';
  const midArmor = isSpy ? '#324148' : '#526065';
  const plate = isSpy ? '#495a61' : '#8c9b95';
  const vest = isSpy ? '#364449' : '#96a395';
  const suitDark = isSpy ? '#2a353a' : '#5b6863';
  const suitMid = isSpy ? '#39474d' : '#7b877e';
  const suitLight = isSpy ? '#445359' : '#8f9b8d';
  const gasketCol = '#272f32';
  const jointMetal = isSpy ? '#5e7077' : '#657379';
  const steelPin = '#c2d1d5';
  const strapCol = '#2d3638';
  const pouchCol = isSpy ? '#2d3b40' : '#52605b';
  const helmetShell = isSpy ? '#2d3b42' : '#aeb6a8';
  const visorTint = isSpy ? '#1a383c' : '#4a5c60';

  if (detail === 'lite') {
    // Ultra-low-poly 16-bone silhouette LOD for Lightweight Mode (>95% vertex reduction, full 16-bone rig preserved)
    for (const side of [-1, 1]) {
      const legX = side * .130;
      const baseBone = side < 0 ? 9 : 12;
      m.boneOffset = baseBone * 10;
      m.box(legX, .710, .008, .165, .380, .170, 'canvas', suitMid, 0, 0);
      m.boneOffset = (baseBone + 1) * 10;
      m.box(legX, .315, .006, .135, .410, .145, 'canvas', suitDark, 0, 0);
      m.box(legX, .500, -.072, .090, .105, .040, 'blackMetal', darkArmor, 0, 1);
      m.boneOffset = (baseBone + 2) * 10;
      m.box(legX, .055, -.036, .125, .110, .255, 'rubber', darkArmor, 0, 0);
    }
    // Pelvis (0), Abdomen (1), Chest (2), Neck (3), Head/Helmet (4)
    m.boneOffset = 0;
    m.box(0, .925, .008, .340, .175, .210, 'canvas', suitDark, 0, 0);
    m.boneOffset = 10;
    m.box(0, 1.080, .008, .300, .170, .195, 'canvas', suitMid, 0, 0);
    m.boneOffset = 20;
    m.box(0, 1.300, .006, .390, .290, .240, 'steel', vest, 0, 1);
    m.box(0, 1.330, -.124, .210, .140, .030, 'steel', isSpy ? darkArmor : plate, 0, 1);
    m.box(0, 1.385, -.140, isSpy ? .150 : .110, .024, .016, 'white', accent, 0, 3);
    m.box(0, 1.310, .148, .220, .230, .095, 'canvas', isSpy ? darkArmor : pouchCol, 0, 0);
    m.boneOffset = 30;
    m.box(0, 1.495, .002, .125, .115, .125, 'rubber', gasketCol, 0, 0);
    m.boneOffset = 40;
    m.box(0, 1.665, .000, .245, .255, .265, 'steel', helmetShell, 0, 1);
    m.box(0, 1.655, -.136, .190, .078, .032, 'blackMetal', visorTint, 0, 1);
    m.box(0, 1.662, -.154, isSpy ? .150 : .130, .024, .014, 'white', isSpy ? light : accent, 0, 3);
    if (isSpy) {
      // Distinctive stealth NVG brow silhouette even in Lightweight Mode
      m.box(0, 1.780, -.130, .140, .052, .075, 'blackMetal', darkArmor, 0, 1);
    }
    // Arms: Left Upper (5) / Forearm (6), Right Upper (7) / Forearm (8)
    const liteArms = [
      {s: -1, bUp: 5, bLo: 6, sh: [-.225, 1.400, .000], el: [-.210, 1.160, -.165], hn: [.035, 1.205, -.395]},
      {s: 1, bUp: 7, bLo: 8, sh: [.225, 1.400, .000], el: [.265, 1.145, -.065], hn: [.072, 1.170, -.240]}
    ];
    for (const arm of liteArms) {
      m.boneOffset = arm.bUp * 10;
      m.box(arm.sh[0] + arm.s * .02, arm.sh[1] + .01, arm.sh[2], .130, .120, .145, 'steel', isSpy ? darkArmor : accent, 0, 1);
      m.beam(arm.sh, arm.el, .062, .062, 'canvas', suitDark, 0);
      m.boneOffset = arm.bLo * 10;
      m.beam(arm.el, arm.hn, .052, .052, 'canvas', suitLight, 0);
      m.box(arm.hn[0], arm.hn[1], arm.hn[2], .068, .060, .078, 'rubber', '#323a3d', 0, 0);
    }
    // Simplified Weapon Silhouette (Bone 15)
    m.boneOffset = 150;
    const wLen = gun === 'MS10' ? .82 : gun === 'DF40 II' ? .76 : gun === 'RD40' ? .74 : gun === 'RD 50' ? .70 : gun === 'D1' ? .64 : gun === 'SRA' ? .68 : gun === 'RD30' ? .62 : gun === 'RD20' ? .52 : .58;
    const wCol = gun === 'MS10' ? '#465861' : gun === 'DF40 II' ? '#2c3644' : gun === 'RD40' ? '#523c42' : gun === 'RD 50' ? '#475046' : gun === 'DF1 OUT' ? '#3d5452' : gun === 'RD30' ? '#4b4846' : gun === 'RD20' ? '#384e54' : '#404a4d';
    const wGlow = gun === 'MS10' ? '#58e8ff' : gun === 'DF40 II' ? '#7c82ff' : gun === 'RD40' ? '#ff6478' : gun === 'RD 50' ? '#e8c25c' : gun === 'DF1 OUT' ? '#5ae8d0' : gun === 'RD30' ? '#ffbe62' : gun === 'RD20' ? '#64f0ff' : accent;
    m.box(.072, 1.270, -.360, gun === 'DF40 II' ? .096 : (gun === 'RD30' || gun === 'RD40') ? .086 : .068, .110, wLen * .62, 'blackMetal', wCol, 0, 1);
    if (gun === 'DF40 II') {
      m.box(.040, 1.280, -.360 - wLen * .44, .024, .026, wLen * .48, 'steel', '#2c3437', 0, 1);
      m.box(.072, 1.312, -.360 - wLen * .46, .026, .026, wLen * .50, 'steel', '#2c3437', 0, 1);
      m.box(.104, 1.280, -.360 - wLen * .44, .024, .026, wLen * .48, 'steel', '#2c3437', 0, 1);
    } else if (gun === 'RD30' || gun === 'RD40') {
      m.box(.044, 1.292, -.360 - wLen * .44, .026, .030, wLen * .48, 'steel', '#2c3437', 0, 1);
      m.box(.100, 1.292, -.360 - wLen * .44, .026, .030, wLen * .48, 'steel', '#2c3437', 0, 1);
    } else {
      m.box(.072, 1.292, -.360 - wLen * .44, .036, .038, wLen * .48, 'steel', '#2c3437', 0, 1);
    }
    m.box(.072, 1.170, -.340, .042, .145, .075, 'blackMetal', darkArmor, 0, 1);
    m.box(.072, 1.320, -.420, .024, .016, .180, 'white', wGlow, 0, 3);
    m.boneOffset = 0;
    return m;
  }

  const plateBox = (x, y, z, w, h, d, bv, mat, tint, kind = 1) => {
    if (hi) m.bevelBox(x, y, z, w, h, d, bv, mat, tint, kind);
    else m.box(x, y, z, w, h, d, mat, tint, 0, kind);
  };

  // ---- Bones 9..14: Articulated Left & Right Legs (Hip -> Thigh -> Hinged Knee -> Sculpted Shin/Calf -> Ankle -> Lugged Boot) ----
  for (const side of [-1, 1]) {
    const hipX = side * .122, legX = side * .130;
    const baseBone = side < 0 ? 9 : 12;

    // 1. Thigh (Bone 9 / 12): hip ball-and-ring socket + ribbed groin flex-gasket + anatomically lofted quad/hamstring + beveled thigh armor + drop-leg rig
    m.boneOffset = baseBone * 10;
    if (!mid) {
      m.ellipsoid(hipX, .895, .012, .092, .088, .092, 'rubber', gasketCol, 0, seg, hi ? 6 : 4);
      m.hingeRotor([hipX + side * .068, .895, .012], [1, 0, 0], .042, .036, 'blackMetal', jointMetal, steelPin, seg, 1);
      m.ribbedJoint([hipX, .875, .012], [legX, .815, .010], .084, .098, ribs - 1, 'rubber', gasketCol, seg, 0);
    }
    // Anatomically sculpted thigh (broad quad/hamstring taper down toward suprapatellar knee)
    m.sculptLimb([legX, .530, .006], [hipX, .855, .012], [
      [0.00, .076, .076, 0, 0],
      [0.18, .088, .094, 0, -.004],
      [0.48, .102, .112, 0, -.008],
      [0.78, .108, .116, 0, -.004],
      [1.00, .098, .102, 0, 0]
    ], 'canvas', suitMid, seg, 0);
    // Curved front femoral armor plate + beveled crest + twin retention straps
    m.curvedPlate([legX, .705, .004], [0, 1, 0], [0, 0, -1], .106, .165, 1.35, .016, 'steel', plate, cSeg, 1);
    plateBox(legX, .705, -.108, .074, .112, .022, .008, 'blackMetal', darkArmor, 1);
    if (!mid) {
      for (const sy of [.645, .755]) {
        m.tube([legX, sy, .006], [legX, sy + .018, .006], .106, .106, 'rubber', strapCol, seg, 0);
      }
    }
    // Outer drop-leg tactical holster (right) / modular spy utility rig (left) with steel buckle clasps
    plateBox(legX + side * .095, .705, .008, .048, .155, .118, .010, 'blackMetal', darkArmor, 1);
    if (!mid) plateBox(legX + side * .118, .735, -.016, .018, .032, .032, .005, 'steel', steelPin, 1);
    if (isSpy) plateBox(legX + side * .116, .668, -.010, .014, .062, .016, .004, 'white', accent, 3);
    // Distal suprapatellar ribbed cuff right above knee hinge
    if (!mid) m.ribbedJoint([legX, .555, .006], [legX, .505, .006], .068, .080, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);

    // 2. Knee + Shin (Bone 10 / 13): dual-axis mechanical knee rotor + inner ribbed bellows + floating beveled patella cap + lofted calf + armored shin greave
    m.boneOffset = (baseBone + 1) * 10;
    if (!mid) {
      m.ellipsoid(legX, .500, .008, .074, .072, .076, 'rubber', gasketCol, 0, seg, hi ? 6 : 4);
      m.ribbedJoint([legX, .455, .012], [legX, .540, .010], .064, .076, ribs, 'rubber', gasketCol, seg, 0);
      m.hingeRotor([legX, .500, .006], [1, 0, 0], .046, .162, 'blackMetal', jointMetal, steelPin, seg, 1);
    }
    // Multi-piece floating patella knee-pad (tracks bisector half-angle in rig.js!)
    m.curvedPlate([legX, .500, -.018], [0, 1, 0], [0, 0, -1], .084, .112, 1.55, .018, 'steel', midArmor, cSeg, 1);
    plateBox(legX, .500, -.104, .078, .086, .032, .011, 'blackMetal', darkArmor, 1);
    plateBox(legX, .500, -.120, .054, .042, .014, .005, 'white', accent, isSpy ? 3 : 1);
    if (!mid) {
      for (const sx of [-1, 1]) {
        m.beam([legX + sx * .076, .500, .002], [legX + sx * .048, .500, -.092], .018, .024, 'steel', jointMetal, 1);
      }
    }
    // Anatomically lofted shin & sculpted gastrocnemius calf muscle tapering to Achilles tendon
    m.sculptLimb([legX, .135, .014], [legX, .465, .006], [
      [0.00, .054, .056, 0, 0],
      [0.20, .060, .064, 0, .004],
      [0.52, .078, .090, 0, .020],
      [0.78, .082, .092, 0, .016],
      [1.00, .074, .078, 0, .002]
    ], 'canvas', suitDark, seg, 0);
    // Curved wrap-around front shin greave + beveled ridge + lateral exo-brace struts
    m.curvedPlate([legX, .305, .002], [0, 1, 0], [0, 0, -1], .078, .225, 1.48, .016, 'blackMetal', darkArmor, cSeg, 1);
    plateBox(legX, .312, -.084, .056, .185, .022, .007, 'steel', plate, 1);
    plateBox(legX, .380, -.096, .062, .028, .014, .004, 'white', accent, 0);
    if (hi) {
      for (const sx of [-1, 1]) {
        m.beam([legX + sx * .074, .475, .006], [legX + sx * .066, .140, .014], .015, .020, 'steel', jointMetal, 1);
      }
      // Calf strap
      m.tube([legX, .240, .012], [legX, .260, .012], .076, .078, 'rubber', strapCol, seg, 0);
    }

    // 3. Ankle + Multi-Part Articulated Combat Boot (Bone 11 / 14)
    m.boneOffset = (baseBone + 2) * 10;
    if (!mid) {
      m.ribbedJoint([legX, .085, .014], [legX, .155, .014], .052, .064, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);
      m.hingeRotor([legX, .115, .014], [1, 0, 0], .038, .128, 'blackMetal', jointMetal, steelPin, seg, 1);
    }
    plateBox(legX, .062, .034, .112, .096, .098, .012, 'blackMetal', darkArmor, 1);
    if (!mid) plateBox(legX, .072, .080, .068, .064, .020, .007, 'steel', midArmor, 1);
    plateBox(legX, .056, -.026, .114, .078, .076, .012, 'rubber', rubber, 0);
    if (!mid) plateBox(legX, .082, -.028, .118, .022, .036, .006, 'steel', midArmor, 1);
    if (!mid) m.ellipsoid(legX, .044, -.092, .058, .038, .064, 'rubber', '#394143', 0, seg, hi ? 5 : 4);
    plateBox(legX, .042, -.112, .106, .052, .082, .012, 'blackMetal', darkArmor, 1);
    m.box(legX, .014, .036, .118, .028, .096, 'rubber', '#22282a', 0, 0);
    m.box(legX, .016, -.024, .106, .024, .046, 'rubber', '#1d2224', 0, 0);
    m.box(legX, .014, -.092, .122, .028, .108, 'rubber', '#22282a', 0, 0);
    if (hi) {
      for (const lz of [-.060, -.095, -.128]) {
        m.box(legX, .012, lz, .126, .018, .018, 'rubber', '#171c1e', 0, 0);
      }
    }
  }

  // ---- Bone 0: Pelvis, Hip Joint Sockets & Tactical Battle Belt ----
  m.boneOffset = 0;
  m.ellipsoid(0, .900, .012, .212, .108, .144, 'blackMetal', suitDark, 0, eSeg, eBand);
  plateBox(0, .865, -.116, .155, .122, .062, .014, 'blackMetal', darkArmor, 1);
  plateBox(0, .890, .124, .215, .108, .052, .012, 'blackMetal', darkArmor, 1);
  plateBox(0, .948, .010, .426, .072, .296, .010, 'blackMetal', darkArmor, 1);
  plateBox(0, .948, -.152, .102, .058, .030, .008, 'steel', steelPin, 1);
  if (!mid) plateBox(0, .948, -.164, .056, .026, .014, .004, 'blackMetal', darkArmor, 1);
  for (const sx of [-1, 1]) {
    if (!mid) m.curvedPlate([sx * .182, .895, .010], [0, 1, 0], [sx, 0, 0], .042, .088, 2.2, .014, 'steel', midArmor, cSeg, 1);
    plateBox(sx * .222, .932, -.026, .056, .096, .118, .009, 'canvas', pouchCol, 0);
    if (!mid) plateBox(sx * .224, .962, -.026, .060, .022, .120, .005, 'blackMetal', strapCol, 1);
  }
  plateBox(0, .922, .162, .178, .095, .062, .009, 'canvas', pouchCol, 0);

  // ---- Bone 1: Articulated Lumbar Spine, Ribbed Waist Flex-Gasket & Exo-Braces ----
  m.boneOffset = 10;
  if (!mid) m.ribbedJoint([0, .965, .010], [0, 1.140, .010], .165, .184, ribs, 'rubber', gasketCol, eSeg, 0);
  m.ellipsoid(0, 1.055, .010, .196, .135, .138, 'canvas', suitLight, 0, seg, hi ? 5 : 3);
  for (let i = 0; i < (mid ? 2 : 3); i++) {
    const ay = 1.000 + i * (mid ? .080 : .054), aw = .245 + i * .018, az = -.122 - i * .005;
    plateBox(0, ay, az, aw, mid ? .058 : .042, .048, .008, 'blackMetal', midArmor, 1);
  }
  if (!mid) {
    for (let i = 0; i < 3; i++) {
      plateBox(0, .995 + i * .056, .132, .138 - i * .008, .044, .046, .008, 'steel', jointMetal, 1);
    }
  }
  if (hi) {
    for (const sx of [-1, 1]) {
      m.tube([sx * .142, .972, .082], [sx * .158, 1.148, .086], .016, .014, 'steel', steelPin, 8, 1);
      m.tube([sx * .146, 1.010, .083], [sx * .152, 1.095, .084], .022, .022, 'blackMetal', darkArmor, 8, 1);
    }
  }

  // ---- Bone 2: Thoracic Chest Armor, Collarbone Yoke, Shoulder Sockets & Tactical Backpack ----
  m.boneOffset = 20;
  m.sculptLimb([0, 1.135, .008], [0, 1.430, .004], [
    [0.00, .195, .138, 0, 0],
    [0.25, .232, .156, 0, -.005],
    [0.62, .258, .168, 0, -.006],
    [0.88, .240, .152, 0, -.002],
    [1.00, .165, .128, 0, 0]
  ], 'canvas', vest, eSeg, 0);
  plateBox(0, 1.255, -.138, .356, .244, .086, .016, 'blackMetal', plate, 1);
  plateBox(0, 1.335, -.162, .312, .082, .052, .012, 'steel', midArmor, 1);
  plateBox(0, 1.356, -.190, .318, .034, .020, .005, 'white', accent, isSpy ? 3 : 0);
  plateBox(.098, 1.258, -.190, .084, .042, .022, .005, 'white', light, 3);
  for (let p = 0; p < 3; p++) {
    const px = -.118 + p * .058;
    plateBox(px, 1.202, -.192, .048, .096, .042, .006, 'canvas', pouchCol, 0);
    if (!mid) m.box(px, 1.256, -.190, .034, .018, .028, 'blackMetal', darkArmor, 0, 1);
  }
  for (const sx of [-1, 1]) {
    m.beam([sx * .132, 1.355, -.135], [sx * .142, 1.425, .020], .062, .026, 'blackMetal', darkArmor, 1);
    m.beam([sx * .142, 1.425, .020], [sx * .135, 1.360, .152], .062, .026, 'blackMetal', darkArmor, 1);
    if (!mid) {
      plateBox(sx * .132, 1.372, -.142, .042, .026, .022, .005, 'steel', steelPin, 1);
      m.hingeRotor([sx * .218, 1.398, .000], [1, 0, 0], .068, .032, 'blackMetal', darkArmor, jointMetal, seg, 1);
    }
  }
  m.curvedPlate([0, 1.418, .002], [0, 1, 0], [0, 0, -1], .136, .064, 3.6, .022, 'blackMetal', darkArmor, cSeg + (mid ? 0 : 2), 1);

  // Tactical backpack
  plateBox(0, 1.248, .182, .378, .362, .084, .014, 'blackMetal', darkArmor, 1);
  m.tube([-.098, 1.07, .240], [-.098, 1.425, .240], .076, .076, 'steel', metal, seg, 1);
  for (const y of (mid ? [1.155, 1.315] : [1.115, 1.225, 1.335])) {
    m.tube([-.098, y, .240], [-.098, y + .034, .240], .082, .082, 'white', isSpy ? '#58ffe8' : '#77d4c6', seg, 3);
  }
  plateBox(.096, 1.242, .242, .152, .358, .128, .012, 'blackMetal', isSpy ? '#36464d' : '#969d8d', 1);
  for (let j = 0; j < (mid ? 2 : 4); j++) {
    plateBox(.096, 1.132 + j * (mid ? .124 : .062), .310, .118, .018, .014, .003, 'white', isSpy ? accent : '#e1b163', isSpy ? 3 : 1);
  }
  m.tube([-.152, 1.415, .195], [-.178, 1.725, .215], .010, .004, 'blackMetal', darkArmor, 5, 1);
  if (!mid) m.ellipsoid(-.178, 1.732, .216, .010, .010, .010, 'white', light, 3, 6, 4);
  if (isSpy) {
    for (const sx of [-1, 1]) {
      m.beam([sx * .165, 1.36, .205], [sx * .205, 1.50, .285], .020, .062, 'steel', darkArmor, 1);
      m.beam([sx * .185, 1.42, .245], [sx * .208, 1.495, .290], .008, .022, 'white', light, 3);
    }
  }

  // ---- Bone 3: Cervical Neck ----
  m.boneOffset = 30;
  if (!mid) m.ribbedJoint([0, 1.425, .002], [0, 1.545, -.006], .068, .082, ribs, 'rubber', gasketCol, seg, 0);
  else m.tube([0, 1.425, .002], [0, 1.545, -.006], .074, .072, 'rubber', gasketCol, seg, 0);
  m.curvedPlate([0, 1.472, -.004], [0, 1, 0], [0, 0, -1], .088, .064, 2.2, .016, 'blackMetal', darkArmor, cSeg, 1);
  if (hi) {
    for (const sx of [-1, 1]) {
      m.tube([sx * .058, 1.430, .048], [sx * .048, 1.535, .042], .012, .010, 'steel', jointMetal, 6, 1);
    }
  }

  // ---- Bone 4: Sculpted Multi-Plane Tactical Helmet, Visor, Mandible Respirator & Comms Headset ----
  m.boneOffset = 40;
  m.ellipsoid(0, 1.648, -.006, .148, .174, .154, 'steel', helmetShell, 1, eSeg, eBand);
  m.ellipsoid(0, 1.748, .004, .158, .074, .156, 'steel', isSpy ? darkArmor : accent, 1, eSeg, hi ? 5 : 3);
  plateBox(0, 1.716, -.136, .185, .036, .062, .009, 'blackMetal', darkArmor, 1);
  plateBox(0, 1.738, -.156, .062, .054, .036, .007, 'steel', jointMetal, 1);
  plateBox(0, 1.640, .148, .106, .074, .042, .009, 'blackMetal', darkArmor, 1);
  m.ellipsoid(0, 1.655, -.076, .148, .092, .108, 'blackMetal', visorTint, 1, eSeg, hi ? 6 : 3);
  if (isSpy) {
    const gSeg = mid ? 6 : 10;
    for (const [gx, gy, gz, gr] of [[-.062, 1.666, -.174, .026], [0, 1.682, -.180, .028], [.062, 1.666, -.174, .026]]) {
      m.tube([gx, gy, gz + .032], [gx, gy, gz - .014], gr * 1.18, gr * 1.05, 'blackMetal', darkArmor, gSeg, 1);
      m.tube([gx, gy, gz - .014], [gx, gy, gz - .022], gr * .82, gr * .82, 'white', light, gSeg, 3);
    }
    plateBox(0, 1.676, -.152, .155, .022, .032, .005, 'steel', jointMetal, 1);
  } else {
    plateBox(0, 1.668, -.178, .198, .026, .020, .005, 'white', light, 3);
  }
  plateBox(0, 1.568, -.116, .148, .078, .092, .014, 'blackMetal', darkArmor, 1);
  if (!mid) plateBox(0, 1.558, -.162, .068, .042, .018, .005, 'steel', jointMetal, 1);
  for (const sx of [-1, 1]) {
    if (!mid) {
      m.tube([sx * .068, 1.568, -.122], [sx * .096, 1.562, -.148], .024, .022, 'steel', midArmor, 8, 1);
      plateBox(sx * .148, 1.678, -.018, .022, .032, .148, .005, 'blackMetal', darkArmor, 1);
      m.hingeRotor([sx * .156, 1.635, .004], [1, 0, 0], .048, .034, 'blackMetal', darkArmor, accent, seg, 1);
    } else {
      m.box(sx * .154, 1.635, .004, .036, .086, .086, 'blackMetal', darkArmor, 0, 1);
    }
  }
  if (hi) m.beam([-.156, 1.615, -.010], [-.068, 1.565, -.150], .012, .012, 'blackMetal', strapCol, 1);

  // ---- Bones 5..8: 2-Bone Analytical IK Sculpted Arms ----
  const arms = [
    {s: -1, bUp: 5, bLo: 6, sh: [-.225, 1.400, .000], el: [-.210, 1.160, -.165], hn: [.035, 1.205, -.395]},
    {s: 1, bUp: 7, bLo: 8, sh: [.225, 1.400, .000], el: [.265, 1.145, -.065], hn: [.072, 1.170, -.240]}
  ];
  for (const arm of arms) {
    const uDir = unit(sub(arm.el, arm.sh));
    const fDir = unit(sub(arm.hn, arm.el));
    const shOut = [arm.s, .28, 0];
    const elMid = add(arm.sh, scale(sub(arm.el, arm.sh), .52));
    const elHint = unit(cross(uDir, fDir));

    // Upper Arm (Bone 5 / 7)
    m.boneOffset = arm.bUp * 10;
    if (!mid) {
      m.ellipsoid(...arm.sh, .084, .082, .084, 'rubber', gasketCol, 0, seg, hi ? 6 : 4);
      m.ribbedJoint(arm.sh, add(arm.sh, scale(uDir, .078)), .064, .078, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);
    }
    m.curvedPlate(add(arm.sh, [arm.s * .018, .018, 0]), uDir, shOut, .086, .118, 2.15, .018, 'steel', isSpy ? darkArmor : accent, cSeg, 1);
    m.curvedPlate(add(arm.sh, add(scale(uDir, .088), [arm.s * .014, 0, 0])), uDir, [arm.s, 0, -.15], .078, .086, 1.85, .015, 'blackMetal', darkArmor, cSeg, 1);
    if (isSpy) {
      m.curvedPlate(add(arm.sh, [arm.s * .022, .020, 0]), uDir, shOut, .096, .024, 1.65, .008, 'white', accent, cSeg, 3);
    }
    m.sculptLimb(arm.sh, arm.el, [
      [0.05, .072, .074, 0, 0],
      [0.32, .076, .080, 0, -.004],
      [0.62, .074, .078, 0, -.004],
      [0.88, .064, .066, 0, 0],
      [1.00, .058, .060, 0, 0]
    ], 'canvas', suitDark, seg, 0);
    if (!mid) {
      m.tube(add(elMid, scale(uDir, -.016)), add(elMid, scale(uDir, .018)), .077, .077, 'rubber', strapCol, seg, 0);
      m.ribbedJoint(add(arm.el, scale(uDir, -.055)), arm.el, .054, .065, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);
    }

    // Forearm + Hinged Elbow + Wrist + Articulated Glove (Bone 6 / 8)
    m.boneOffset = arm.bLo * 10;
    if (!mid) {
      m.ellipsoid(...arm.el, .062, .062, .062, 'rubber', gasketCol, 0, seg, hi ? 5 : 4);
      m.ribbedJoint(arm.el, add(arm.el, scale(fDir, .058)), .052, .062, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);
      m.hingeRotor(arm.el, elHint, .036, .118, 'blackMetal', jointMetal, steelPin, seg, 1);
    }
    const elOut = unit(add(scale(uDir, .55), scale(fDir, -.55)));
    const padC = add(arm.el, scale(elOut, .056));
    m.curvedPlate(arm.el, elHint, elOut, .066, .082, 1.75, .016, 'blackMetal', darkArmor, cSeg, 1);
    plateBox(padC[0], padC[1], padC[2], .054, .056, .048, .009, 'steel', midArmor, 1);

    m.sculptLimb(arm.el, arm.hn, [
      [0.02, .060, .060, 0, 0],
      [0.26, .068, .066, 0, 0],
      [0.58, .058, .056, 0, 0],
      [0.82, .048, .046, 0, 0],
      [0.95, .046, .044, 0, 0]
    ], 'canvas', suitLight, seg, 0);

    const bracerC = add(arm.el, scale(sub(arm.hn, arm.el), .54));
    const bracerOut = unit([arm.s * .7, .4, .2]);
    m.curvedPlate(bracerC, fDir, bracerOut, .058, .125, 2.2, .014, 'blackMetal', darkArmor, cSeg, 1);
    if (arm.s < 0) {
      const tacC = add(bracerC, scale(bracerOut, .062));
      plateBox(tacC[0], tacC[1], tacC[2], .032, .022, .056, .004, 'blackMetal', darkArmor, 1);
      m.box(tacC[0] + bracerOut[0] * .011, tacC[1] + bracerOut[1] * .011, tacC[2] + bracerOut[2] * .011, .020, .010, .040, 'white', light, 0, 3);
    }

    if (!mid) {
      const wrStart = add(arm.el, scale(sub(arm.hn, arm.el), .76));
      const wrEnd = add(arm.el, scale(sub(arm.hn, arm.el), .90));
      m.ribbedJoint(wrStart, wrEnd, .044, .052, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);
      m.hingeRotor(wrEnd, elHint, .024, .092, 'steel', jointMetal, steelPin, 8, 1);
    }

    // Sculpted Articulated Tactical Glove: palm + armored knuckle guard + opposing thumb + curled finger grip
    const palm = arm.hn;
    const fRight = unit(cross(fDir, [0, 1, 0]));
    const fUp = unit(cross(fRight, fDir));
    plateBox(palm[0], palm[1], palm[2], .064, .056, .078, .012, 'rubber', '#323a3d', 0);
    // Carbon armored knuckle guard on back of hand
    const knuck = add(palm, add(scale(fDir, .022), scale(fRight, arm.s * .026)));
    plateBox(knuck[0], knuck[1], knuck[2], .038, .044, .044, .007, 'blackMetal', darkArmor, 1);
    // Opposing thumb wrapping upper grip
    const thBase = add(palm, add(scale(fUp, .022), scale(fRight, -arm.s * .016)));
    const thTip = add(thBase, add(scale(fDir, .046), scale(fUp, .014)));
    m.tube(thBase, thTip, .016, .013, 'rubber', '#3a4346', 7, 0);
    // Curled tactical grip fingers wrapping rifle forend / trigger guard
    if (hi) {
      for (let fi = 0; fi < 3; fi++) {
        const fOff = -.016 + fi * .016;
        const fBase = add(palm, add(scale(fDir, .036), scale(fUp, fOff)));
        const fMid = add(fBase, add(scale(fDir, .024), scale(fRight, -arm.s * .018)));
        const fTip = add(fMid, scale(fRight, -arm.s * .026));
        m.tube(fBase, fMid, .013, .011, 'rubber', '#2f373a', 6, 0);
        m.tube(fMid, fTip, .011, .009, 'rubber', '#272f32', 6, 0);
      }
    }
  }

  // ---- Bone 15: Weapon Assembly (tracks AimPitch, ADS, Sprint Low-Ready, Recoil & Reload Tilt) ----
  m.boneOffset = 150;
  m.transform = {origin: [.072, 1.245, -.255], right: [.85, 0, 0], up: [0, .85, 0], back: [0, 0, .85]};
  device(m, gun);
  m.transform = null;
  m.tube([.070, 1.398, -.280], [.070, 1.398, -.332], .028, .026, 'blackMetal', metal, 8, 1);
  m.boneOffset = 0;
  return m;
}

// Pre-baked zero-allocation projectile palettes (cached RGB tuples)
function _mkPal(core, outer, ringHex) {
  return {core: color(core), outer: color(outer), ring: color(ringHex)};
}
const _PAL_SCHERP = _mkPal('#f4fffc', '#28f5b8', '#9effe8');
const _PAL_SCHERP_RIC = _mkPal('#f4fffc', '#86ffd0', '#9effe8');
const _PAL_RIC = _mkPal('#ffffff', '#ff9634', '#ffe98a');
const _PAL_MS10_0 = _mkPal('#f7ffff', '#3ee4ff', '#8ef7ff');
const _PAL_MS10_1 = _mkPal('#f7ffff', '#ff8b4f', '#ffd57a');
const _PAL_DF40_14G = _mkPal('#fffdf2', '#ff68d6', '#ffe478');
const _PAL_DF40_14 = _mkPal('#fffdf2', '#ffaa48', '#ffe478');
const _PAL_DF40_G = _mkPal('#f6f8ff', '#7c6eff', '#64f8ff');
const _PAL_DF40 = _mkPal('#f6f8ff', '#58d8ff', '#a8a2ff');
const _PAL_RD40_G = _mkPal('#fff7f0', '#ff4a62', '#ffcf76');
const _PAL_RD40 = _mkPal('#fff7f0', '#ff7b4e', '#ff9c6e');
const _PAL_RD50_0 = _mkPal('#fffdf0', '#f2c858', '#ffe48a');
const _PAL_RD50_1 = _mkPal('#fffdf0', '#ff9a46', '#ffe48a');
const _PAL_RD30_G = _mkPal('#fffcf2', '#ffae48', '#ffe282');
const _PAL_RD30_0 = _mkPal('#fffcf2', '#f4a250', '#ffcf76');
const _PAL_RD30_1 = _mkPal('#fffcf2', '#ff7d44', '#ffcf76');
const _PAL_RD20_G = _mkPal('#f4ffff', '#4ce4ff', '#a8f8ff');
const _PAL_RD20_0 = _mkPal('#f4ffff', '#58c8e8', '#ffe088');
const _PAL_RD20_1 = _mkPal('#f4ffff', '#ff8c52', '#ffe088');
const _PAL_P1 = _mkPal('#fdf4ff', '#cc7dff', '#76f8ff');
const _PAL_DF1_G = _mkPal('#f2fffd', '#3bf2d6', '#8effef');
const _PAL_DF1 = _mkPal('#f2fffd', '#58e2cc', '#f2bd74');
const _PAL_D1_0 = _mkPal('#fff8ea', '#ffa952', '#ffe27e');
const _PAL_D1_1 = _mkPal('#fff8ea', '#ff7644', '#ffe27e');
const _PAL_SRA_0 = _mkPal('#f4fffa', '#4be5bd', '#a8ffea');
const _PAL_SRA_1 = _mkPal('#f4fffa', '#ff9459', '#a8ffea');
const _PAL_DEF_0 = _mkPal('#fffef2', '#ffdf6e', '#fff3ad');
const _PAL_DEF_1 = _mkPal('#fffef2', '#ff9d52', '#fff3ad');

function shotPalette(s) {
  if (s.aaTier === '1.5') return s.ricocheted ? _PAL_SCHERP_RIC : _PAL_SCHERP;
  if (s.ricocheted) return _PAL_RIC;
  if (s.gun === 'MS10') return s.team ? _PAL_MS10_1 : _PAL_MS10_0;
  if (s.gun === 'DF40 II') {
    if (s.aaTier === '1.4') return s.guided ? _PAL_DF40_14G : _PAL_DF40_14;
    return s.guided ? _PAL_DF40_G : _PAL_DF40;
  }
  if (s.gun === 'RD40') return s.guided ? _PAL_RD40_G : _PAL_RD40;
  if (s.gun === 'RD 50') return s.team ? _PAL_RD50_1 : _PAL_RD50_0;
  if (s.gun === 'RD30') return s.guided ? _PAL_RD30_G : (s.team ? _PAL_RD30_1 : _PAL_RD30_0);
  if (s.gun === 'RD20') return s.guided ? _PAL_RD20_G : (s.team ? _PAL_RD20_1 : _PAL_RD20_0);
  if (s.source === 'p1') return _PAL_P1;
  if (s.gun === 'DF1 OUT') return s.guided ? _PAL_DF1_G : _PAL_DF1;
  if (s.gun === 'D1') return s.team ? _PAL_D1_1 : _PAL_D1_0;
  if (s.gun === 'SRA') return s.team ? _PAL_SRA_1 : _PAL_SRA_0;
  return s.team ? _PAL_DEF_1 : _PAL_DEF_0;
}

// Reusable scratch buffers for zero-GC projectile & effect construction
const _trailBuf = new Float32Array(96);
const _visPt = new Float32Array(3);
const _L_WOOD = layers.wood ?? 0;
const _L_BMET = layers.blackMetal ?? 0;

// Pre-cached common RGB colors for movingDetails
const _C_GULL = color('#d4d4c8');
const _C_TK_R1 = color('#79f7e4'), _C_TK_R2 = color('#ffe082'), _C_TK_CD = color('#d99a56');
const _C_TK_W = color('#b5fff4'), _C_TK_T1 = color('#84ffec'), _C_TK_T2 = color('#c78a4e');
const _C_TK_B1 = color('#ffd978'), _C_TK_B2 = color('#7a593b');
const _C_TK_O1 = color('#ffe38c'), _C_TK_O2 = color('#8d6c49');
const _C_TK_BAR1 = color('#88ffee'), _C_TK_BAR2 = color('#f0b865');
const _C_BZ_H4 = color('#e37cff'), _C_BZ_H2 = color('#b25cff');
const _C_BZ_C4 = color('#f0b4ff'), _C_BZ_C2 = color('#d28aff');
const _C_BZ_D4 = color('#5c1f8c'), _C_BZ_D2 = color('#431a6b');
const _C_BZ_P4 = color('#f6c8ff'), _C_BZ_BASE = color('#2e1846'), _C_BZ_O4 = color('#ffd6ff'), _C_BZ_BM = color('#d578ff');
const _C_SC_WOOD = color('#2c1f16'), _C_SC_DEF = color('#1b2022');
const _C_SC_P1H = color('#f0d8ff'), _C_SC_P1C = color('#a864ff');
const _C_SC_M1H = color('#c4fcff'), _C_SC_M1C = color('#3ec8e8');
const _C_SC_FH = color('#fff2b0'), _C_SC_FC = color('#ff7b2e');
const _C_CS_MS10 = color('#7cefff'), _C_CS_DF40 = color('#b8a8ff'), _C_CS_DF1 = color('#b8f2e6'), _C_CS_BRASS = color('#e6c16c');
const _C_WHT_M = color('#fffef0'), _C_WHT_K = color('#fffef2'), _C_K_SPK = color('#ffe48a');
const _C_TK_FX = color('#78ffec'), _C_BZ_FX = color('#d876ff'), _C_SHF_FX = color('#90b8ff'), _C_HEAL_FX = color('#4cffb4');
const _C_SH_C = color('#e4ffff'), _C_SH_R = color('#58eeff'), _C_BZ_C = color('#f6dcff'), _C_BZ_R = color('#cf6cff');
const _C_SCHERP = color('#38ffbe'), _C_SCHERP_K = color('#42ffc4'), _C_SCHERP_H = color('#e6fff7'), _C_SCHERP_R = color('#dcfff4');
const _C_GL_14 = color('#ffe078'), _C_GL_DF40 = color('#78f6ff'), _C_GL_RD40 = color('#ff7082'), _C_GL_RD30 = color('#ffd478'), _C_GL_RD20 = color('#7cf0ff'), _C_GL_DEF = color('#92fff2');
const _C_GF_14 = color('#ff6ee0'), _C_GF_DF40 = color('#8c76ff'), _C_GF_RD40 = color('#ff5a72'), _C_GF_RD30 = color('#ffd678'), _C_GF_DEF = color('#a8fff5');
const _C_MZ_MS10 = color('#58ecff'), _C_MZ_RD50 = color('#f0c454'), _C_MZ_P1 = color('#d48eff'), _C_MZ_DEF = color('#ffc464');
const _C_K_T1 = color('#ff945c'), _C_K_T0 = color('#6cf5e6');
const _C_HP_P1 = color('#d896ff'), _C_HP_M1 = color('#68f2ff'), _C_HP_DEF = color('#ffd86b');
const _C_HH_P1 = color('#faeaff'), _C_HH_M1 = color('#e8ffff'), _C_HH_DEF = color('#fff9dc'), _C_H_PL = color('#7cf7ff');
const _C_RC_FL = color('#fff6d8'), _C_RC_GD = color('#ffd872'), _C_RC_PN = color('#d4a66a'), _C_RC_WD = color('#a87d4e');
const _C_WL_FP1 = color('#e2a8ff'), _C_WL_FM1 = color('#9ef6ff'), _C_WL_FST = color('#fff4be'), _C_WL_FDF = color('#ffdf9e');
const _C_WL_RP1 = color('#c87eff'), _C_WL_RM1 = color('#5ceeff'), _C_WL_RST = color('#ffd56e'), _C_WL_RDF = color('#d8c29e');
const _C_WL_SP1 = color('#d898ff'), _C_WL_SM1 = color('#74f4ff'), _C_WL_SST = color('#ffd562'), _C_WL_SWD = color('#b68c5a'), _C_WL_SDF = color('#d6ccb8');
const _C_AMMO_BODY = color('#4d5e3a'), _C_AMMO_LID = color('#3a482c'), _C_AMMO_BAND = color('#f2b840'), _C_AMMO_GLOW = color('#ffd966'), _C_REINF_FX = color('#5ce6ff');

// Smoothly maps projectile visual position from exact 1P/3P barrel muzzle onto the true ballistic ray over 13.5m.
// Writes directly into _visPt (zero allocation!).
function visualShotPointOut(s, px, py, pz, visMuzzle) {
  if (!visMuzzle || !s.origin || s.ricochets > 0 || s.penetrations > 0) {
    _visPt[0] = px; _visPt[1] = py; _visPt[2] = pz;
    return;
  }
  const ox = s.origin[0], oy = s.origin[1], oz = s.origin[2];
  const dx = px - ox, dy = py - oy, dz = pz - oz;
  const dist2 = dx * dx + dy * dy + dz * dz;
  if (dist2 >= 182.25) { // 13.5^2
    _visPt[0] = px; _visPt[1] = py; _visPt[2] = pz;
    return;
  }
  const u = Math.sqrt(dist2) * (1 / 13.5);
  const b = (1 - u) * (1 - u);
  _visPt[0] = px + (visMuzzle[0] - ox) * b;
  _visPt[1] = py + (visMuzzle[1] - oy) * b;
  _visPt[2] = pz + (visMuzzle[2] - oz) * b;
}

// PropTemplate-Stamp: lazily pre-baked static Float32Array vertex templates for Baizers & Tankers (0 trig/sqrt per frame!)
const _propTplCache = new Map();
function getBaizerStaticTpl(is400, lite) {
  const key = (is400 ? 'b4_' : 'b2_') + (lite ? 'l' : 'f') + '_' + (layers.blackMetal ?? 0);
  let tpl = _propTplCache.get(key);
  if (!tpl) {
    const tmp = new Mesh(512);
    const hc = is400 ? _C_BZ_H4 : _C_BZ_H2;
    const baseR = is400 ? 1.05 : .82;
    const bsz = is400 ? .64 : .52, tsz = is400 ? .46 : .36;
    const lBmet = layers.blackMetal ?? 0;
    tmp.ringS(0, .08, 0, 0, 1, 0, baseR, is400 ? .060 : .046, lite ? 10 : 16, 0, hc[0], hc[1], hc[2], 3, true);
    tmp.boxS(0, .10, 0, bsz, .12, bsz, lBmet, _C_BZ_BASE[0], _C_BZ_BASE[1], _C_BZ_BASE[2], 0, 1);
    tmp.boxS(0, .18, 0, tsz, .04, tsz, 0, hc[0], hc[1], hc[2], 0, 3);
    tpl = new Float32Array(tmp.data);
    _propTplCache.set(key, tpl);
  }
  return tpl;
}
function getTankerRingTpl(radius, variant, segs) {
  const key = `tk_${Math.round(radius * 100)}_${variant}_${segs}`;
  let tpl = _propTplCache.get(key);
  if (!tpl) {
    const tmp = new Mesh(segs * 18);
    const rc = variant === 0 ? _C_TK_R1 : variant === 1 ? _C_TK_R2 : _C_TK_CD;
    const thick = variant < 2 ? .065 : .035;
    tmp.ringS(0, .09, 0, 0, 1, 0, radius * .94, thick, segs, 0, rc[0], rc[1], rc[2], 3, true);
    tpl = new Float32Array(tmp.data);
    _propTplCache.set(key, tpl);
  }
  return tpl;
}

export function movingDetails(match, time, extra = false, lite = false, opts = null) {
  const streamMesh = opts?.streamMesh || null;
  const m = streamMesh || new Mesh(1024);
  if (streamMesh) m.reset();
  const frustum = opts?.frustum || null;
  const camPos = opts?.camPos || null;
  const camX = camPos ? camPos[0] : 0, camZ = camPos ? camPos[2] : 0;

  if (!lite) {
    const gullCount = extra ? 11 : 7;
    const gr = _C_GULL[0], gg = _C_GULL[1], gb = _C_GULL[2];
    for (let i = 0; i < gullCount; i++) {
      const a = time * (.041 + i * .0007) + i * .61;
      const x = -54 + Math.sin(a) * (24 + i * 2.4);
      const z = -39 + Math.cos(a) * 62 + i * 8;
      const y = 22 + i * .67 + Math.sin(a * 3.2);
      if (frustum && !sphereInFrustum(frustum, x, y, z, 1.0)) continue;
      const b = Math.sin(time * 3 + i) * .22;
      m.triS(x - .62, y + b, z + .16, x, y, z, x - .30, y + .1, z - .07, 0, 1, 0, 0, gr, gg, gb, 5);
      m.triS(x + .62, y + b, z + .14, x + .31, y + .08, z - .08, x, y, z, 0, 1, 0, 0, gr, gg, gb, 5);
    }
  }
  if (!match) return m;

  const spectating = !!(opts?.spectating || match.spectating);
  const viewerActor = opts?.viewerActor || match.player;
  const viewerTeam = viewerActor?.team ?? 0;
  const fpActorId = opts?.fpActorId !== undefined ? opts.fpActorId : (spectating ? -1 : (match.player?.id ?? -1));

  // Supply tanker live status rings (PropTemplate-Stamp!), beacon octahedrons (octaS!), and recharge bars.
  if (match.tankers) {
    const tkBaseSegs = lite ? 12 : (extra ? 24 : 16);
    for (let ti = 0; ti < match.tankers.length; ti++) {
      const tk = match.tankers[ti];
      if (frustum && !sphereInFrustum(frustum, tk.x, 1.8, tk.z, Math.max(4.5, tk.radius + 1.0))) continue;
      const farTk = camPos && ((tk.x - camX) * (tk.x - camX) + (tk.z - camZ) * (tk.z - camZ)) > 1024;
      const tkSegs = farTk ? 12 : tkBaseSegs;
      const ready = tk.cooldown <= 0;
      const fill = ready ? 1 : clamp(1 - tk.cooldown / tk.maxCooldown, 0, 1);
      const variant = ready ? (Math.sin(time * 4 + tk.id) > 0 ? 0 : 1) : 2;
      m.appendTranslated(getTankerRingTpl(tk.radius, variant, tkSegs), tk.x, 0, tk.z);
      if (!lite) {
        const bob = Math.sin(time * 2.7 + tk.id * 2.1) * .12;
        if (ready && extra) {
          const waveR = tk.radius * (.55 + ((time * .55 + tk.id * .33) % 1) * .45);
          m.ringS(tk.x, .14, tk.z, 0, 1, 0, waveR, .032, farTk ? 12 : 20, 0, _C_TK_W[0], _C_TK_W[1], _C_TK_W[2], 3, true);
        }
        const bx = tk.x, by = 3.55 + bob, bz = tk.z;
        const rot = time * (ready ? 1.8 : .55) + tk.id;
        const tCol = ready ? _C_TK_T1 : _C_TK_T2;
        const bCol = ready ? _C_TK_B1 : _C_TK_B2;
        m.octaS(bx, by, bz, .36, .42, rot, tCol[0], tCol[1], tCol[2], bCol[0], bCol[1], bCol[2], 3);
        const oc = ready ? _C_TK_O1 : _C_TK_O2;
        m.ringS(bx, by, bz, Math.sin(rot) * .35, 1, Math.cos(rot) * .35, .56, .024, farTk ? 8 : 12, 0, oc[0], oc[1], oc[2], 3);
      }
      const barLen = 2.6 * fill;
      if (barLen > .08) {
        const bc = ready ? _C_TK_BAR1 : _C_TK_BAR2;
        m.boxS(tk.x, 2.94, tk.z - tk.facing * .68, .18, .09, barLen, 0, bc[0], bc[1], bc[2], 0, 3);
      }
    }
  }

  // Purple road pickups: BAIZER 200 & BAIZER 400 (PropTemplate-Stamp static base/ring + zero-closure octaS crystal!)
  if (match.baizers) {
    const bz2Tpl = getBaizerStaticTpl(false, lite);
    const bz4Tpl = getBaizerStaticTpl(true, lite);
    const bz2Far = camPos && !lite ? getBaizerStaticTpl(false, true) : bz2Tpl;
    const bz4Far = camPos && !lite ? getBaizerStaticTpl(true, true) : bz4Tpl;
    for (let bi = 0; bi < match.baizers.length; bi++) {
      const bz = match.baizers[bi];
      if (bz.cooldown > 0) continue;
      if (frustum && !sphereInFrustum(frustum, bz.x, .8, bz.z, 2.0)) continue;
      const farBz = camPos && ((bz.x - camX) * (bz.x - camX) + (bz.z - camZ) * (bz.z - camZ)) > 576;
      const is400 = bz.amount >= 40;
      m.appendTranslated(is400 ? (farBz ? bz4Far : bz4Tpl) : (farBz ? bz2Far : bz2Tpl), bz.x, 0, bz.z);
      const bob = Math.sin(time * 3.4 + bz.id * 1.9) * .09;
      const rot = time * (is400 ? 2.1 : 1.55) + bz.id * 1.1;
      const hc = is400 ? _C_BZ_H4 : _C_BZ_H2;
      const cc = is400 ? _C_BZ_C4 : _C_BZ_C2;
      const dc = is400 ? _C_BZ_D4 : _C_BZ_D2;
      if (is400 && !lite) {
        const pulseR = .62 + ((time * .72 + bz.id * .4) % 1) * .72;
        m.ringS(bz.x, .12, bz.z, 0, 1, 0, pulseR, .028, farBz ? 10 : 16, 0, _C_BZ_P4[0], _C_BZ_P4[1], _C_BZ_P4[2], 3, true);
      }
      const cy = (is400 ? .76 : .62) + bob;
      const rad = is400 ? .36 : .29;
      const halfH = is400 ? .44 : .34;
      m.octaS(bz.x, cy, bz.z, rad, halfH, rot, cc[0], cc[1], cc[2], dc[0], dc[1], dc[2], 3);
      if (!lite) {
        const sr = Math.sin(rot), cr = Math.cos(rot);
        const oSegs = farBz ? 8 : 12;
        m.ringS(bz.x, cy, bz.z, sr * .45, 1, cr * .45, rad * 1.48, .026, oSegs, 0, hc[0], hc[1], hc[2], 3);
        if (is400) {
          m.ringS(bz.x, cy + .06, bz.z, -cr * .55, .85, sr * .55, rad * 1.72, .022, oSegs, 0, _C_BZ_O4[0], _C_BZ_O4[1], _C_BZ_O4[2], 3);
          m.beamS(bz.x, .20, bz.z, bz.x, cy + halfH + .42, bz.z, .042, .042, 0, _C_BZ_BM[0], _C_BZ_BM[1], _C_BZ_BM[2], 3);
        }
      }
    }
  }

  // Randomly placed 50-round Ammo Crates (tactical olive crate + brass trim + floating amber beacon)
  if (match.ammoBoxes) {
    const lCrate = layers.crate ?? 0;
    const lBmet = layers.blackMetal ?? 0;
    for (let ai = 0; ai < match.ammoBoxes.length; ai++) {
      const box = match.ammoBoxes[ai];
      if (box.cooldown > 0) continue;
      if (frustum && !sphereInFrustum(frustum, box.x, .55, box.z, 1.5)) continue;
      const farBox = camPos && ((box.x - camX) * (box.x - camX) + (box.z - camZ) * (box.z - camZ)) > 576;
      const bob = Math.sin(time * 3.1 + box.id * 1.7) * .045;
      if (lite) {
        m.boxS(box.x, .24, box.z, .68, .44, .44, lCrate, _C_AMMO_BODY[0], _C_AMMO_BODY[1], _C_AMMO_BODY[2], 0, 1);
      } else {
        // Ground locator ring
        m.ringS(box.x, .06, box.z, 0, 1, 0, .68, .036, farBox ? 8 : 14, 0, _C_AMMO_BAND[0], _C_AMMO_BAND[1], _C_AMMO_BAND[2], 3, true);
        // Main ammo crate body + recessed lid + brass latch/band
        m.boxS(box.x, .24, box.z, .68, .44, .44, lCrate, _C_AMMO_BODY[0], _C_AMMO_BODY[1], _C_AMMO_BODY[2], 0, 1);
        m.boxS(box.x, .47, box.z, .72, .08, .48, lBmet, _C_AMMO_LID[0], _C_AMMO_LID[1], _C_AMMO_LID[2], 0, 1);
        m.boxS(box.x, .27, box.z, .71, .07, .46, 0, _C_AMMO_BAND[0], _C_AMMO_BAND[1], _C_AMMO_BAND[2], 0, 3);
        m.octaS(box.x, .82 + bob, box.z, .15, .18, time * 2.0 + box.id, _C_AMMO_GLOW[0], _C_AMMO_GLOW[1], _C_AMMO_GLOW[2], _C_AMMO_BAND[0], _C_AMMO_BAND[1], _C_AMMO_BAND[2], 3);
      }
    }
  }

  // Persistent cooling 3D bullet scorch craters & molten embers on struck containers/wharf.
  if (!lite && match.scorches) {
    for (let si = 0; si < match.scorches.length; si++) {
      const sc = match.scorches[si];
      const sp = sc.p;
      if (camPos && ((sp[0] - camX) * (sp[0] - camX) + (sp[2] - camZ) * (sp[2] - camZ)) > 1600) continue;
      if (frustum && !sphereInFrustum(frustum, sp[0], sp[1], sp[2], .22)) continue;
      const prog = clamp(1 - sc.life / (sc.max || 1.8), 0, 1);
      const hot = clamp(1 - prog / .42, 0, 1);
      const n = sc.normal;
      const nx = n ? n[0] : 0, ny = n ? n[1] : 1, nz = n ? n[2] : 0;
      const isPlasma = sc.gun === 'MS10' || sc.source === 'p1';
      const baseR = (isPlasma ? .135 : sc.mat === 'steel' ? .095 : .11) * (1 - prog * .28);
      if (baseR > .025) {
        const dc = sc.mat === 'wood' ? _C_SC_WOOD : _C_SC_DEF;
        m.discS(sp[0], sp[1], sp[2], nx, ny, nz, baseR, 8, 0, dc[0], dc[1], dc[2], 0);
      }
      if (hot > .05) {
        const glowR = baseR * (.42 + .34 * hot);
        const ec = sc.source === 'p1'
          ? (hot > .5 ? _C_SC_P1H : _C_SC_P1C)
          : sc.gun === 'MS10'
            ? (hot > .5 ? _C_SC_M1H : _C_SC_M1C)
            : (hot > .55 ? _C_SC_FH : _C_SC_FC);
        m.discS(sp[0] + nx * .008, sp[1] + ny * .008, sp[2] + nz * .008, nx, ny, nz, glowR, 8, 0, ec[0], ec[1], ec[2], 3);
      }
    }
  }

  // Sleek, true-muzzle-aligned 3D projectiles (zero array allocations!)
  const shots = match.shots;
  for (let si = 0; si < shots.length; si++) {
    const s = shots[si];
    if (s.materialPass) continue;
    if (!spectating && s.shafferCloaked && s.team !== viewerTeam) continue;
    const sp = s.p, sd = s.dir;
    if (frustum && !sphereInFrustum(frustum, sp[0] - sd[0] * 3.0, sp[1] - sd[1] * 3.0, sp[2] - sd[2] * 3.0, 5.5)) continue;
    const pal = shotPalette(s);
    const pCore = pal.core, pOut = pal.outer, pRng = pal.ring;
    const isMS10 = s.gun === 'MS10';
    const isGuided = !!s.guided;
    const isScherp = s.aaTier === '1.5';
    const isP1 = s.source === 'p1';
    const isFpShot = s.owner?.id === fpActorId;
    const visMuzzle = isFpShot ? (s.muzzle1p || s.muzzle || null) : (s.muzzle3p || s.muzzle || null);
    const orig = s.origin || sp;
    const dx0 = sp[0] - orig[0], dy0 = sp[1] - orig[1], dz0 = sp[2] - orig[2];
    const traveled = Math.sqrt(dx0 * dx0 + dy0 * dy0 + dz0 * dz0);

    let hx, hy, hz;
    if (visMuzzle && !s.ricochets && !s.penetrations && traveled < .55) {
      const mOff = traveled > .18 ? traveled : .18;
      hx = visMuzzle[0] + sd[0] * mOff;
      hy = visMuzzle[1] + sd[1] * mOff;
      hz = visMuzzle[2] + sd[2] * mOff;
    } else {
      visualShotPointOut(s, sp[0], sp[1], sp[2], visMuzzle);
      hx = _visPt[0]; hy = _visPt[1]; hz = _visPt[2];
    }

    const wantTail = lite
      ? (isMS10 ? 4.8 : isScherp ? 3.8 : 2.6)
      : isMS10 ? (extra ? 8.2 : 6.4) : isScherp ? (extra ? 5.8 : 4.5) : isP1 ? 4.4 : isGuided ? 3.8 : 3.0;
    const tailLen = Math.max(.24, Math.min(wantTail, Math.max(traveled, .34), s.speed * (isMS10 ? .015 : .010)));

    if (lite) {
      const tipOff = isMS10 ? .26 : .18;
      const tipX = hx + sd[0] * tipOff, tipY = hy + sd[1] * tipOff, tipZ = hz + sd[2] * tipOff;
      let tx, ty, tz;
      if (visMuzzle && !s.ricochets && !s.penetrations && traveled <= tailLen + .25) {
        tx = visMuzzle[0]; ty = visMuzzle[1]; tz = visMuzzle[2];
      } else {
        visualShotPointOut(s, sp[0] - sd[0] * tailLen, sp[1] - sd[1] * tailLen, sp[2] - sd[2] * tailLen, visMuzzle);
        tx = _visPt[0]; ty = _visPt[1]; tz = _visPt[2];
      }
      const mx = hx + (tx - hx) * .48, my = hy + (ty - hy) * .48, mz = hz + (tz - hz) * .48;
      const w = isMS10 ? .042 : isScherp ? .038 : isGuided || isP1 ? .034 : .028;
      m.beamS(tx, ty, tz, hx, hy, hz, w, w, 0, pOut[0], pOut[1], pOut[2], 3);
      m.beamS(mx, my, mz, tipX, tipY, tipZ, w * .52, w * .52, 0, pCore[0], pCore[1], pCore[2], 3);
      if (isGuided || isScherp) {
        const gc = isScherp ? _C_SCHERP : s.gun === 'DF40 II' ? (s.aaTier === '1.4' ? _C_GL_14 : _C_GL_DF40) : s.gun === 'RD40' ? _C_GL_RD40 : s.gun === 'RD30' ? _C_GL_RD30 : s.gun === 'RD20' ? _C_GL_RD20 : _C_GL_DEF;
        m.ringS(hx - sd[0] * .32, hy - sd[1] * .32, hz - sd[2] * .32, sd[0], sd[1], sd[2], .085, .010, 6, 0, gc[0], gc[1], gc[2], 3);
      }
      continue;
    }

    // Inline orthonormal basis around s.dir
    const dnx = sd[0], dny = sd[1], dnz = sd[2];
    let rx, ry, rz;
    if (Math.abs(dny) > .92) { rx = 0; ry = dnz; rz = -dny; }
    else { rx = -dnz; ry = 0; rz = dnx; }
    const rl = 1 / (Math.sqrt(rx * rx + ry * ry + rz * rz) || 1);
    rx *= rl; ry *= rl; rz *= rl;
    const ux = dny * rz - dnz * ry, uy = dnz * rx - dnx * rz, uz = dnx * ry - dny * rx;

    // 1. Compact ogive tracer warhead
    const tipOff = isMS10 ? .32 : isScherp ? .28 : .22;
    const wRad = isMS10 ? .026 : isScherp ? .024 : .020;
    m.tubeS(
      hx - dnx * .06, hy - dny * .06, hz - dnz * .06,
      hx + dnx * tipOff, hy + dny * tipOff, hz + dnz * tipOff,
      wRad, .003, 0, pCore[0], pCore[1], pCore[2], 6, 3
    );

    // 2. Sleek curved multi-segment tracer stored in flat _trailBuf (0 allocations!)
    let nPts = 0;
    if (s.trail && s.trail.length >= 2) {
      let acc = 0;
      _trailBuf[0] = hx; _trailBuf[1] = hy; _trailBuf[2] = hz;
      nPts = 1;
      for (let i = s.trail.length - 1; i >= 0 && acc < tailLen && nPts < 31; i--) {
        const curPhys = s.trail[i];
        visualShotPointOut(s, curPhys[0], curPhys[1], curPhys[2], visMuzzle);
        const cx = _visPt[0], cy = _visPt[1], cz = _visPt[2];
        const pOff = (nPts - 1) * 3;
        const px = _trailBuf[pOff], py = _trailBuf[pOff + 1], pz = _trailBuf[pOff + 2];
        const sdx = px - cx, sdy = py - cy, sdz = pz - cz;
        const segD = Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz);
        if (segD < .03) continue;
        const o = nPts * 3;
        if (acc + segD > tailLen) {
          const frac = (tailLen - acc) / segD;
          _trailBuf[o] = px + (cx - px) * frac;
          _trailBuf[o + 1] = py + (cy - py) * frac;
          _trailBuf[o + 2] = pz + (cz - pz) * frac;
          nPts++;
          acc = tailLen;
          break;
        }
        _trailBuf[o] = cx; _trailBuf[o + 1] = cy; _trailBuf[o + 2] = cz;
        nPts++;
        acc += segD;
      }
    }
    if (nPts < 2) {
      let tx, ty, tz;
      if (visMuzzle && !s.ricochets && !s.penetrations && traveled <= tailLen + .25) {
        tx = visMuzzle[0]; ty = visMuzzle[1]; tz = visMuzzle[2];
      } else {
        tx = hx - dnx * tailLen; ty = hy - dny * tailLen; tz = hz - dnz * tailLen;
      }
      _trailBuf[0] = hx; _trailBuf[1] = hy; _trailBuf[2] = hz;
      _trailBuf[3] = hx + (tx - hx) * .45; _trailBuf[4] = hy + (ty - hy) * .45; _trailBuf[5] = hz + (tz - hz) * .45;
      _trailBuf[6] = tx; _trailBuf[7] = ty; _trailBuf[8] = tz;
      nPts = 3;
    }

    const nSegs = nPts - 1;
    const invSegs = 1 / nSegs;
    const coreW = isMS10 ? .024 : isScherp ? .022 : isP1 ? .020 : .017;
    const finW = isMS10 ? .048 : isScherp ? .044 : isP1 ? .040 : isGuided ? .036 : .030;
    for (let i = 0; i < nSegs; i++) {
      const f0 = 1 - i * invSegs;
      const fMid = f0 - .5 * invSegs;
      const oA = i * 3, oB = oA + 3;
      const ax = _trailBuf[oA], ay = _trailBuf[oA + 1], az = _trailBuf[oA + 2];
      const bx = _trailBuf[oB], by = _trailBuf[oB + 1], bz = _trailBuf[oB + 2];
      if (f0 > .24) {
        const cw = coreW * fMid;
        m.beamS(bx, by, bz, ax, ay, az, cw, cw, 0, pCore[0], pCore[1], pCore[2], 3);
      }
      const outerT = finW * (.32 + .68 * fMid);
      m.beamS(bx, by, bz, ax, ay, az, outerT, coreW * .6, 0, pOut[0], pOut[1], pOut[2], 3);
    }

    // 3. Minimalist signature slipstream accents
    if (isMS10 || isScherp) {
      const hSegs = 4;
      const hLen = Math.min(tailLen * .75, isMS10 ? 4.2 : 3.2);
      const hStep = hLen / hSegs;
      let prevX = 0, prevY = 0, prevZ = 0;
      for (let k = 0; k <= hSegs; k++) {
        const back = .20 + k * hStep;
        const tFrac = k * .25;
        const ang = time * (isScherp ? 48 : 38) + s.id * 1.9 + k * 1.3;
        const rH = (isScherp ? (.032 + tFrac * .042) : (.040 + tFrac * .055)) * (1 - tFrac * .35);
        const ca = Math.cos(ang) * rH, sa = Math.sin(ang) * rH;
        const curX = hx - dnx * back + rx * ca + ux * sa;
        const curY = hy - dny * back + ry * ca + uy * sa;
        const curZ = hz - dnz * back + rz * ca + uz * sa;
        if (k > 0) {
          const hw = .010 * (1 - tFrac * .45);
          m.beamS(prevX, prevY, prevZ, curX, curY, curZ, hw, hw, 0, pRng[0], pRng[1], pRng[2], 3);
        }
        prevX = curX; prevY = curY; prevZ = curZ;
      }
    }

    if (isGuided) {
      const gRings = isScherp ? 2 : 1;
      const gc = isScherp ? _C_SCHERP : s.aaTier === '1.4' ? _C_GF_14 : s.gun === 'DF40 II' ? _C_GF_DF40 : s.gun === 'RD40' ? _C_GF_RD40 : s.gun === 'RD30' ? _C_GF_RD30 : s.gun === 'RD20' ? _C_GL_RD20 : _C_GF_DEF;
      const phase = (time * 26 + s.id * .7) % .42;
      for (let r = 0; r < gRings; r++) {
        const back = .24 + r * .72 + phase;
        if (back > tailLen) continue;
        m.ringS(hx - dnx * back, hy - dny * back, hz - dnz * back, dnx, dny, dnz, .078 + r * .026, .010, 6, 0, gc[0], gc[1], gc[2], 3);
      }
    }

    const machMu = machConeHalfAngle(s.speed);
    if (machMu !== null && (isMS10 || s.gun === 'RD40')) {
      const distBack = .42 + ((time * 26 + s.id) % .55);
      if (distBack < tailLen) {
        const coneScale = clamp(Math.tan(machMu) * 0.11, 0.035, 0.14);
        m.ringS(hx - dnx * distBack, hy - dny * distBack, hz - dnz * distBack, dnx, dny, dnz, .075 + distBack * coneScale, .009, 8, 0, pRng[0], pRng[1], pRng[2], 3);
      }
    }
  }

  // Ejected spinning shell casings (sub-pixel Nyquist cull beyond 32m where 0.06m < 1.1px!).
  if (!lite && match.casings) {
    for (let ci = 0; ci < match.casings.length; ci++) {
      const c = match.casings[ci];
      if (!spectating && c.shafferCloaked && c.team !== viewerTeam) continue;
      const cp = c.p;
      if (camPos && ((cp[0] - camX) * (cp[0] - camX) + (cp[2] - camZ) * (cp[2] - camZ)) > 1024) continue;
      if (frustum && !sphereInFrustum(frustum, cp[0], cp[1], cp[2], .12)) continue;
      const ca = Math.cos(c.rot) * .032, sa = Math.sin(c.rot) * .032;
      const cc = c.gun === 'MS10' ? _C_CS_MS10 : c.gun === 'DF40 II' ? _C_CS_DF40 : c.gun === 'DF1 OUT' ? _C_CS_DF1 : _C_CS_BRASS;
      m.beamS(
        cp[0] - ca, cp[1] - sa * .4, cp[2] - sa,
        cp[0] + ca, cp[1] + sa * .4, cp[2] + sa,
        .011, .011, 0, cc[0], cc[1], cc[2], (c.gun === 'MS10' || c.gun === 'DF40 II') ? 3 : 1
      );
    }
  }

  // Clean, sleek, high-clarity tactical impact/damage/kill/skill effects (zero allocations, zero color() lookups!)
  const effects = match.effects;
  for (let ei = 0; ei < effects.length; ei++) {
    const e = effects[ei];
    if (!spectating && e.kind === 'muzzle' && e.shafferCloaked && e.team !== viewerTeam) continue;
    if (!spectating && e.kind === 'shaffer' && e.team !== viewerTeam) continue;
    const ep = e.p;
    const ex = ep[0], ey = ep[1], ez = ep[2];
    if (frustum && !sphereInFrustum(frustum, ex, ey, ez, e.kind === 'tanker' ? 5.0 : 2.2)) continue;
    const progress = clamp(1 - e.life / (e.max || .2), 0, 1);
    const inv = 1 - progress;
    const seed = e.seed || 1;
    const axis = e.dir;
    const ax = axis ? axis[0] : 0, ay = axis ? axis[1] : 1, az = axis ? axis[2] : 0;
    const norm = e.normal;
    const nx = norm ? norm[0] : -ax, ny = norm ? norm[1] : -ay, nz = norm ? norm[2] : -az;
    const isScherpFx = e.aaTier === '1.5';

    if (e.kind === 'muzzle') {
      if (e.actor !== fpActorId && progress < .38) {
        const s = (1 - progress / .38) * (e.gun === 'MS10' ? .88 : .72);
        const fc = isScherpFx ? _C_SCHERP : e.gun === 'MS10' ? _C_MZ_MS10 : e.gun === 'RD 50' ? _C_MZ_RD50 : e.source === 'p1' ? _C_MZ_P1 : _C_MZ_DEF;
        const len = .30 * s;
        m.beamS(ex, ey, ez, ex + ax * len, ey + ay * len, ez + az * len, .034 * s, .010 * s, 0, fc[0], fc[1], fc[2], 3);
        const cr = .042 * s;
        m.ellipsoidS(ex, ey, ez, cr, cr, cr, 0, _C_WHT_M[0], _C_WHT_M[1], _C_WHT_M[2], 3, 5, 3);
      }
      continue;
    }

    if (e.kind === 'tanker') {
      m.ringS(ex, .25 + progress * 2.2, ez, 0, 1, 0, 1.2 + progress * 3.4, .048 * inv, lite ? 10 : 16, 0, _C_TK_FX[0], _C_TK_FX[1], _C_TK_FX[2], 3);
      continue;
    }

    if (e.kind === 'baizerPickup') {
      const is400 = (e.amount || 20) >= 40;
      m.ringS(ex, .20 + progress * 1.8, ez, 0, 1, 0, .65 + progress * (is400 ? 2.4 : 1.8), .044 * inv, lite ? 10 : 14, 0, _C_BZ_FX[0], _C_BZ_FX[1], _C_BZ_FX[2], 3);
      continue;
    }

    if (e.kind === 'shaffer') {
      m.ringS(ex, .25 + progress * 1.6, ez, 0, 1, 0, .55 + progress * 1.7, .038 * inv, lite ? 10 : 14, 0, _C_SHF_FX[0], _C_SHF_FX[1], _C_SHF_FX[2], 3);
      continue;
    }

    if (e.kind === 'heal') {
      m.ringS(ex, .20 + progress * 1.8, ez, 0, 1, 0, .55 + progress * 1.7, .040 * inv, lite ? 10 : 14, 0, _C_HEAL_FX[0], _C_HEAL_FX[1], _C_HEAL_FX[2], 3);
      continue;
    }

    if (e.kind === 'ammoPickup') {
      m.ringS(ex, .22 + progress * 1.5, ez, 0, 1, 0, .55 + progress * 1.6, .040 * inv, lite ? 10 : 14, 0, _C_AMMO_GLOW[0], _C_AMMO_GLOW[1], _C_AMMO_GLOW[2], 3);
      continue;
    }

    if (e.kind === 'reinforce') {
      m.ringS(ex, .20 + progress * 2.1, ez, 0, 1, 0, .65 + progress * 2.0, .044 * inv, lite ? 10 : 14, 0, _C_REINF_FX[0], _C_REINF_FX[1], _C_REINF_FX[2], 3);
      if (!lite) m.beamS(ex, .10, ez, ex, 2.8 * inv + .3, ez, .045 * inv, .045 * inv, 0, _C_REINF_FX[0], _C_REINF_FX[1], _C_REINF_FX[2], 3);
      continue;
    }

    if (e.kind === 'kill') {
      if (progress < .28) {
        const cs = .14 * (1 - progress / .28);
        m.ellipsoidS(ex, ey, ez, cs, cs, cs, 0, _C_WHT_K[0], _C_WHT_K[1], _C_WHT_K[2], 3, 6, 3);
      }
      const kc = isScherpFx ? _C_SCHERP_K : (e.team ? _C_K_T1 : _C_K_T0);
      m.ringS(ex, ey, ez, 0, 1, 0, .18 + progress * .85, .024 * inv, lite ? 10 : 14, 0, kc[0], kc[1], kc[2], 3);
      const count = lite ? 4 : 6;
      const bw = .010 * inv + .003;
      const segL = .16 * inv + .02;
      const gravY = -progress * progress * .45 + progress * .25;
      for (let k = 0; k < count; k++) {
        const a1 = (seed * .7 + k * 2.39996) % 6.28;
        const dx = Math.cos(a1), dy = .10 + ((k * 17 + seed) % 6) * .14, dz = Math.sin(a1);
        const invL = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1);
        const ux = dx * invL, uy = dy * invL, uz = dz * invL;
        const spd = .95 + ((k * 13 + seed) % 5) * .20;
        const p0x = ex + ux * progress * spd, p0y = ey + uy * progress * spd + gravY, p0z = ez + uz * progress * spd;
        const sc = (k & 1) ? _C_K_SPK : kc;
        m.beamS(p0x, p0y, p0z, p0x + ux * segL, p0y + uy * segL, p0z + uz * segL, bw, bw, 0, sc[0], sc[1], sc[2], 3);
      }
      continue;
    }

    if (e.kind === 'break' || e.kind === 'shield' || e.kind === 'baizerBreak' || e.kind === 'baizer') {
      const isBaizer = e.kind === 'baizer' || e.kind === 'baizerBreak';
      const isBreak = e.kind === 'break' || e.kind === 'baizerBreak';
      const cc = isBaizer ? _C_BZ_C : _C_SH_C;
      const rc = isBaizer ? _C_BZ_R : _C_SH_R;
      if (progress < .24) {
        const cr = (isBreak ? .10 : .065) * (1 - progress / .24);
        m.ellipsoidS(ex, ey, ez, cr, cr, cr, 0, cc[0], cc[1], cc[2], 3, 5, 3);
      }
      m.ringS(ex + nx * .03, ey + ny * .03, ez + nz * .03, nx, ny, nz, .09 + progress * (isBreak ? .62 : .32), (isBreak ? .018 : .012) * inv, lite ? 8 : 12, 0, rc[0], rc[1], rc[2], 3);
      const count = isBreak ? (lite ? 4 : 6) : (lite ? 2 : 3);
      const w1 = (isBreak ? .010 : .007) * inv + .002, w2 = .006 * inv + .002;
      const segL = (isBreak ? .16 : .10) * inv + .02;
      const gravY = -progress * progress * .28;
      for (let k = 0; k < count; k++) {
        const a1 = seed + k * 2.39996;
        const dx = nx * .75 + Math.cos(a1) * .75, dy = .05 + ((k * 7) % 6) * .12, dz = nz * .75 + Math.sin(a1) * .75;
        const invL = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1);
        const ux = dx * invL, uy = dy * invL, uz = dz * invL;
        const dist = (.08 + progress * (isBreak ? .92 : .42)) * (.80 + (k & 1) * .25);
        const p0x = ex + ux * dist, p0y = ey + uy * dist + gravY, p0z = ez + uz * dist;
        const sc = (k & 1) ? rc : cc;
        m.beamS(p0x, p0y, p0z, p0x + ux * segL, p0y + uy * segL, p0z + uz * segL, w1, w2, 0, sc[0], sc[1], sc[2], 3);
      }
      continue;
    }

    if (e.kind === 'hit') {
      const isPlasma = e.gun === 'MS10' || e.source === 'p1';
      const hp = isScherpFx ? _C_SCHERP : (e.source === 'p1' ? _C_HP_P1 : e.gun === 'MS10' ? _C_HP_M1 : _C_HP_DEF);
      const hh = isScherpFx ? _C_SCHERP_H : (e.source === 'p1' ? _C_HH_P1 : e.gun === 'MS10' ? _C_HH_M1 : _C_HH_DEF);
      if (progress < .24) {
        const cr = .065 * (1 - progress / .24);
        m.ellipsoidS(ex, ey, ez, cr, cr, cr, 0, hh[0], hh[1], hh[2], 3, 5, 3);
      }
      m.ringS(ex + nx * .03, ey + ny * .03, ez + nz * .03, nx, ny, nz, .07 + progress * .26, .011 * inv, lite ? 6 : 10, 0, hp[0], hp[1], hp[2], 3);
      const count = lite ? 2 : 3;
      const w1 = .007 * inv + .002, w2 = .005 * inv + .002, segL = .12 * inv + .02;
      const gravY = -progress * progress * .26;
      for (let k = 0; k < count; k++) {
        const a1 = seed * 1.3 + k * 2.39996;
        const dx = nx * .85 + Math.cos(a1) * .75, dy = .15 + (k % 3) * .16, dz = nz * .85 + Math.sin(a1) * .75;
        const invL = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1);
        const ux = dx * invL, uy = dy * invL, uz = dz * invL;
        const r0 = .06 + progress * (.46 + (k & 1) * .16);
        const p0x = ex + ux * r0, p0y = ey + uy * r0 + gravY, p0z = ez + uz * r0;
        const sc = k === 0 ? hh : (isPlasma ? _C_H_PL : hp);
        m.beamS(p0x, p0y, p0z, p0x + ux * segL, p0y + uy * segL, p0z + uz * segL, w1, w2, 0, sc[0], sc[1], sc[2], 3);
      }
      continue;
    }

    if (e.kind === 'ricochet' || e.kind === 'penetrate') {
      const isRic = e.kind === 'ricochet';
      const bx = isRic ? ax : nx, by = isRic ? ay : ny, bz = isRic ? az : nz;
      const bl = 1 / (Math.sqrt(bx * bx + by * by + bz * bz) || 1);
      const bnx = bx * bl, bny = by * bl, bnz = bz * bl;
      let ux, uy, uz;
      if (Math.abs(bny) > .92) { ux = 0; uy = bnz; uz = -bny; }
      else { ux = -bnz; uy = 0; uz = bnx; }
      const ul = 1 / (Math.sqrt(ux * ux + uy * uy + uz * uz) || 1);
      ux *= ul; uy *= ul; uz *= ul;
      const vx = bny * uz - bnz * uy, vy = bnz * ux - bnx * uz, vz = bnx * uy - bny * ux;

      if (progress < .24) {
        const r = (isRic ? .075 : .060) * (1 - progress / .24);
        const fc = isScherpFx ? _C_SCHERP_R : _C_RC_FL;
        m.ellipsoidS(ex, ey, ez, r, r, r, 0, fc[0], fc[1], fc[2], 3, 5, 3);
      }
      const rc = isScherpFx ? _C_SCHERP_K : (isRic ? _C_RC_GD : _C_RC_PN);
      m.ringS(ex + nx * .03, ey + ny * .03, ez + nz * .03, nx, ny, nz, .07 + progress * (isRic ? .38 : .28), .012 * inv, 8, 0, rc[0], rc[1], rc[2], 3);
      const count = lite ? 2 : 4;
      const w1 = .008 * inv + .002, w2 = .005 * inv + .002, segL = .14 * inv + .02;
      const gravY = -progress * progress * .48;
      const aScale = isRic ? 1.0 : .85;
      for (let k = 0; k < count; k++) {
        const ang = seed + k * 2.39996;
        const spread = (isRic ? .34 : .52) * (.5 + (k % 3) * .22);
        const ca = Math.cos(ang) * spread, sa = Math.sin(ang) * spread;
        const jx = ax * aScale + ux * ca + vx * sa;
        const jy = ay * aScale + uy * ca + vy * sa;
        const jz = az * aScale + uz * ca + vz * sa;
        const jl = 1 / (Math.sqrt(jx * jx + jy * jy + jz * jz) || 1);
        const jux = jx * jl, juy = jy * jl, juz = jz * jl;
        const spd = (isRic ? 1.4 : 1.0) + (k % 3) * .25;
        const p0x = ex + jux * progress * spd, p0y = ey + juy * progress * spd + gravY, p0z = ez + juz * progress * spd;
        const isWood = !isRic && e.mat === 'wood' && (k & 1) === 0;
        const sc = isWood ? _C_RC_WD : isScherpFx ? _C_SCHERP : _C_RC_GD;
        m.beamS(p0x, p0y, p0z, p0x + jux * segL, p0y + juy * segL, p0z + juz * segL, w1, w2, isWood ? _L_WOOD : 0, sc[0], sc[1], sc[2], isWood ? 0 : 3);
      }
      continue;
    }

    // Minimalist wall/container/concrete/wood impact sparks (zero opaque dust clouds!)
    const dn2 = 2 * (ax * nx + ay * ny + az * nz);
    let rfx = ax - nx * dn2, rfy = ay - ny * dn2, rfz = az - nz * dn2;
    const rfl = 1 / (Math.sqrt(rfx * rfx + rfy * rfy + rfz * rfz) || 1);
    rfx *= rfl; rfy *= rfl; rfz *= rfl;
    const mat = e.mat || (e.metal ? 'steel' : 'concrete');
    const isMS10 = e.gun === 'MS10';
    const isP1 = e.source === 'p1';
    const isPlasma = isMS10 || isP1;
    const fc = isP1 ? _C_WL_FP1 : isMS10 ? _C_WL_FM1 : mat === 'steel' ? _C_WL_FST : _C_WL_FDF;
    const rc = isP1 ? _C_WL_RP1 : isMS10 ? _C_WL_RM1 : mat === 'steel' ? _C_WL_RST : _C_WL_RDF;
    if (progress < .24) {
      const cr = (isPlasma ? .075 : .052) * (1 - progress / .24);
      m.ellipsoidS(ex, ey, ez, cr, cr, cr, 0, fc[0], fc[1], fc[2], 3, 5, 3);
    }
    if (isPlasma || mat === 'steel') {
      m.ringS(ex + nx * .03, ey + ny * .03, ez + nz * .03, nx, ny, nz, .06 + progress * (isPlasma ? .36 : .24), .010 * inv, 8, 0, rc[0], rc[1], rc[2], 3);
    }
    const count = lite ? 2 : (mat === 'steel' ? 4 : 3);
    const sx = mat === 'steel' ? (rfx * .75 + nx * .55) : (nx * 1.05 + rfx * .35);
    const sy = mat === 'steel' ? (rfy * .75 + ny * .55) : (ny * 1.05 + rfy * .35);
    const sz = mat === 'steel' ? (rfz * .75 + nz * .55) : (nz * 1.05 + rfz * .35);
    const sc = isP1 ? _C_WL_SP1 : isMS10 ? _C_WL_SM1 : mat === 'steel' ? _C_WL_SST : mat === 'wood' ? _C_WL_SWD : _C_WL_SDF;
    const sLayer = mat === 'wood' ? _L_WOOD : 0;
    const sKind = (mat === 'steel' || isPlasma) ? 3 : 0;
    const w1 = .007 * inv + .002, w2 = .005 * inv + .002, segL = .11 * inv + .02;
    const gravY = -progress * progress * .48;
    const minY = .02 - ey;
    for (let k = 0; k < count; k++) {
      const a1 = seed * 1.7 + k * 2.39996;
      const dx = sx + Math.cos(a1) * .68, dy = sy + .22 + (k % 3) * .12, dz = sz + Math.sin(a1) * .68;
      const dl = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1);
      const ux = dx * dl, uy = dy * dl, uz = dz * dl;
      const dist = .05 + progress * ((mat === 'steel' ? .68 : .48) + (k & 1) * .18);
      const offY = uy * dist + gravY;
      const p0x = ex + ux * dist, p0y = ey + (offY > minY ? offY : minY), p0z = ez + uz * dist;
      m.beamS(p0x, p0y, p0z, p0x + ux * segL, p0y + uy * segL, p0z + uz * segL, w1, w2, sLayer, sc[0], sc[1], sc[2], sKind);
    }
  }

  // ChronoTrace 1.0: 3D world-space holographic ballistic crime-scene & death reconstruction ribbons (0 extra draw calls!)
  if (opts && match.chronoTrace && (opts.showChrono || opts.deathTrace)) {
    match.chronoTrace.appendForensicGeometry(m, match.time ?? time, {
      showAll: !!opts.showChrono,
      highlightTrace: opts.deathTrace || null,
      lite
    });
  }

  return m;
}
