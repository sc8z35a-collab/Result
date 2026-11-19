import {Mesh, scale, add, sub, unit, cross, clamp} from './geometry.js';
const rubber = '#485050', cloth = '#64716b', metal = '#9babad', ink = '#536067', ivory = '#c8c7ad';

// Helper: draw a crisp polygonal glowing shockwave / energy ring around center oriented along axis.
function ring(m, center, axis, radius, thick, segs, tint, kind = 3) {
  const n = unit(axis);
  const u = unit(cross(n, Math.abs(n[1]) > .9 ? [1, 0, 0] : [0, 1, 0]));
  const v = cross(n, u);
  let prev = add(center, scale(u, radius));
  for (let i = 1; i <= segs; i++) {
    const a = i / segs * Math.PI * 2;
    const cur = add(center, add(scale(u, Math.cos(a) * radius), scale(v, Math.sin(a) * radius)));
    m.beam(prev, cur, thick, thick, 'white', tint, kind);
    prev = cur;
  }
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

function device(m, gun) {
  if (gun === 'DF1 OUT') {
    dfDevice(m);
    return;
  }
  if (gun === 'MS10') {
    ms10Device(m);
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
  if (gun === 'DF1 OUT') return [0, .032, -.70];
  if (gun === 'SW T') return [0, .024, -.58];
  if (gun === 'SRA') return [0, .024, -.75];
  return [0, .024, -.78];
}

// Local-space 3D star-burst muzzle flash attached right to the first-person weapon barrel tip.
export function muzzleFlashMesh(gun, intensity, seed, extra = false) {
  const m = new Mesh();
  if (intensity <= .01) return m;
  const [mx, my, mz] = muzzleOffset(gun);
  const s = intensity * (gun === 'MS10' ? 1.25 : gun === 'D1' ? 1.05 : .95);
  const coreCol = gun === 'MS10' ? '#e8ffff' : gun === 'DF1 OUT' ? '#dcfff7' : '#fff8dc';
  const outerCol = gun === 'MS10' ? '#4de2ff' : gun === 'DF1 OUT' ? '#6de8d5' : gun === 'SRA' ? '#ffcf76' : '#ffaa4e';
  const blades = extra ? 6 : 4;
  const rot = (seed * 1.618) % 6.28;
  // Bright central flash core + forward gas spear
  m.ellipsoid(mx, my, mz - .05 * s, .052 * s, .052 * s, .095 * s, 'white', coreCol, 3, 8, 4);
  m.tube([mx, my, mz], [mx, my, mz - .34 * s], .048 * s, .006, 'white', outerCol, 8, 3);
  // Radial star-burst fins
  for (let i = 0; i < blades; i++) {
    const a = rot + i * Math.PI / blades;
    const len = (.14 + ((i * 37 + seed) % 7) * .018) * s;
    const cx = Math.cos(a) * len, cy = Math.sin(a) * len;
    m.beam([mx - cx, my - cy, mz - .03 * s], [mx + cx, my + cy, mz - .03 * s], .024 * s, .016 * s, 'white', outerCol, 3);
    m.beam([mx - cx * .55, my - cy * .55, mz - .025 * s], [mx + cx * .55, my + cy * .55, mz - .025 * s], .014 * s, .012 * s, 'white', coreCol, 3);
  }
  // Muzzle pressure shock ring (extra crisp for MS10 rail discharge)
  if (gun === 'MS10' || extra) {
    ring(m, [mx, my, mz - .12 * s], [0, 0, -1], .095 * s + (1 - intensity) * .09, .013 * s, 10, gun === 'MS10' ? '#7cf2ff' : '#ffe29c', 3);
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

export function character(team, gun) {
  const m = new Mesh(), accent = team ? '#df8054' : '#55b9b4', light = team ? '#f2a16e' : '#88ded2';
  const darkArmor = '#3d484b', jointMetal = '#59666b', plate = '#8e9c96', vest = '#9ca899';

  // ---- Bones 9..14: Articulated Left & Right Legs (Hip -> Thigh -> Knee -> Shin -> Ankle -> Boot/Toe) ----
  for (const side of [-1, 1]) {
    const hipX = side * .122, legX = side * .130;
    const baseBone = side < 0 ? 9 : 12;

    // Thigh (Bone 9 / 12): hip ball joint + sculpted quad/hamstring + tactical thigh armor & holster
    m.boneOffset = baseBone * 10;
    m.ellipsoid(hipX, .895, .012, .096, .092, .096, 'rubber', darkArmor, 0, 10, 5);
    m.tube([legX, .510, .006], [hipX, .895, .012], .088, .112, 'canvas', '#818c82', 10, 0);
    m.ellipsoid(legX, .71, -.026, .086, .145, .084, 'canvas', '#8a958b', 0, 10, 5);
    m.box(legX + side * .078, .71, .005, .042, .145, .105, 'blackMetal', side < 0 ? darkArmor : ink, 0, 1);
    m.box(legX, .68, -.088, .088, .11, .026, 'steel', plate, 0, 1);

    // Knee + Shin (Bone 10 / 13): knee joint sphere + armored kneepad + sculpted shin/calf + team stripe
    m.boneOffset = (baseBone + 1) * 10;
    m.ellipsoid(legX, .500, .006, .082, .082, .084, 'rubber', jointMetal, 0, 10, 5);
    m.ellipsoid(legX, .500, -.058, .078, .082, .054, 'steel', '#7d8a86', 1, 10, 5);
    m.box(legX, .500, -.096, .072, .058, .024, 'white', accent, 0, 1);
    m.tube([legX, .125, .014], [legX, .495, .006], .066, .084, 'canvas', cloth, 10, 0);
    m.ellipsoid(legX, .33, .036, .072, .115, .068, 'canvas', '#5a6762', 0, 9, 5); // sculpted gastrocnemius calf
    m.box(legX, .32, -.058, .084, .17, .032, 'blackMetal', darkArmor, 0, 1); // shin greave
    m.box(legX, .37, -.074, .068, .036, .016, 'white', accent, 0, 0);

    // Ankle + Multi-Part Articulated Combat Boot (Bone 11 / 14): ankle sphere, heel cup, midfoot, hinged toe box (sole at y=0)
    m.boneOffset = (baseBone + 2) * 10;
    m.ellipsoid(legX, .115, .014, .064, .064, .066, 'rubber', jointMetal, 0, 10, 5);
    m.box(legX, .058, .026, .116, .112, .110, 'rubber', rubber, 0, 0); // heel cup & ankle collar
    m.box(legX, .048, -.035, .120, .092, .085, 'blackMetal', darkArmor, 0, 0); // arch/midfoot
    m.ellipsoid(legX, .042, -.108, .064, .042, .068, 'rubber', rubber, 0, 10, 5); // articulated forefoot toe box (bends at z<-0.055!)
    m.box(legX, .014, -.042, .126, .028, .225, 'rubber', '#2d3436', 0, 0); // rugged outsole touching y=0.000
  }

  // ---- Bone 0: Pelvis / Tactical Utility Belt ----
  m.boneOffset = 0;
  m.ellipsoid(0, .900, .012, .218, .115, .148, 'blackMetal', '#79877e', 0, 12, 6);
  m.box(0, .945, .010, .410, .068, .285, 'blackMetal', darkArmor, 0, 1);
  m.box(0, .945, -.142, .095, .054, .028, 'steel', metal, 0, 1); // belt buckle
  for (const sx of [-1, 1]) m.box(sx * .205, .925, -.02, .056, .092, .115, 'canvas', '#5a6864', 0, 0); // hip mag pouches

  // ---- Bone 1: Articulated Lumbar Waist / Abdomen ----
  m.boneOffset = 10;
  m.ellipsoid(0, 1.055, .010, .205, .145, .142, 'canvas', '#8f9b8c', 0, 12, 6);
  m.box(0, 1.045, -.112, .265, .118, .064, 'blackMetal', '#6c7a76', 0, 1); // abdominal flex plates
  m.box(0, 1.055, .122, .165, .130, .052, 'steel', jointMetal, 0, 1); // lumbar spine armor

  // ---- Bone 2: Thoracic Chest Armor + Collar + Tactical Backpack ----
  m.boneOffset = 20;
  m.ellipsoid(0, 1.255, .006, .258, .215, .162, 'canvas', vest, 0, 14, 7);
  m.box(0, 1.255, -.136, .372, .248, .092, 'blackMetal', '#8d9d97', 0, 1); // front chest rig
  m.box(0, 1.350, -.186, .325, .048, .024, 'white', accent, 0, 0);
  m.box(.095, 1.245, -.190, .088, .042, .022, 'white', light, 0, 3); // glowing team IFF tag
  m.box(-.085, 1.215, -.190, .115, .085, .036, 'canvas', '#53615d', 0, 0); // chest magazine pouch (reload target!)
  m.ellipsoid(0, 1.420, .002, .155, .052, .135, 'blackMetal', darkArmor, 0, 12, 5); // collarbone armor
  // Tactical backpack: left shield charger cylinder + right vented ammo generator cassette
  m.box(0, 1.245, .178, .388, .372, .084, 'blackMetal', ink, 0, 1);
  m.tube([-.098, 1.06, .238], [-.098, 1.43, .238], .080, .080, 'steel', metal, 10, 1);
  for (const y of [1.11, 1.22, 1.34]) m.tube([-.098, y, .238], [-.098, y + .036, .238], .084, .084, 'white', '#77d4c6', 10, 3);
  m.box(.096, 1.24, .240, .156, .372, .134, 'blackMetal', '#969d8d', 0, 1);
  for (let j = 0; j < 4; j++) m.box(.096, 1.13 + j * .064, .312, .125, .020, .015, 'white', '#e1b163', 0, 1);

  // ---- Bone 3: Cervical Neck / Throat Guard ----
  m.boneOffset = 30;
  m.tube([0, 1.425, 0], [0, 1.545, -.006], .082, .078, 'rubber', rubber, 10, 0);
  m.ellipsoid(0, 1.465, -.018, .096, .044, .092, 'blackMetal', darkArmor, 0, 10, 5);

  // ---- Bone 4: Sculpted Visor Helmet & Head ----
  m.boneOffset = 40;
  m.ellipsoid(0, 1.640, -.010, .152, .182, .150, 'steel', '#b0b8aa', 0, 14, 8);
  m.ellipsoid(0, 1.655, -.074, .154, .106, .114, 'blackMetal', '#56686b', 1, 14, 6);
  m.box(0, 1.668, -.178, .204, .026, .020, 'white', light, 0, 3); // glowing optical visor strip
  m.box(0, 1.565, -.112, .150, .072, .085, 'blackMetal', darkArmor, 0, 1); // angled jaw respirator guard
  m.ellipsoid(0, 1.752, .010, .164, .076, .154, 'steel', accent, 1, 12, 5); // helmet crest shell
  for (const sx of [-1, 1]) m.ellipsoid(sx * .152, 1.645, .005, .034, .056, .052, 'blackMetal', darkArmor, 1, 8, 4); // comms ear pods

  // ---- Bones 5..8: 2-Bone IK Sculpted Arms (Shoulder Pauldron -> Upper Arm -> Elbow Pad -> Forearm -> Wrist -> Glove) ----
  const arms = [
    {s: -1, bUp: 5, bLo: 6, sh: [-.225, 1.400, .000], el: [-.210, 1.160, -.165], hn: [.035, 1.205, -.395]},
    {s: 1, bUp: 7, bLo: 8, sh: [.225, 1.400, .000], el: [.265, 1.145, -.065], hn: [.072, 1.170, -.240]}
  ];
  for (const arm of arms) {
    // Upper arm (Bone 5 / 7): shoulder ball joint + sculpted armored pauldron + deltoid/bicep
    m.boneOffset = arm.bUp * 10;
    m.ellipsoid(...arm.sh, .092, .088, .092, 'rubber', jointMetal, 0, 10, 5);
    m.ellipsoid(arm.sh[0] + arm.s * .038, arm.sh[1] + .022, arm.sh[2], .092, .078, .106, 'steel', accent, 1, 10, 5); // shoulder pauldron
    m.tube(arm.sh, arm.el, .074, .066, 'canvas', cloth, 10, 0);
    m.ellipsoid(
      (arm.sh[0] + arm.el[0]) * .5,
      (arm.sh[1] + arm.el[1]) * .5,
      (arm.sh[2] + arm.el[2]) * .5,
      .074, .078, .074, 'canvas', '#73807a', 0, 9, 5
    );

    // Forearm + Wrist + Tactical Glove (Bone 6 / 8): elbow joint + pad + bracer + wrist cuff + articulated glove
    m.boneOffset = arm.bLo * 10;
    m.ellipsoid(...arm.el, .068, .068, .068, 'rubber', jointMetal, 0, 10, 5);
    m.ellipsoid(arm.el[0] + arm.s * .026, arm.el[1] - .015, arm.el[2] + .035, .054, .062, .048, 'blackMetal', darkArmor, 1, 8, 4); // elbow guard
    m.tube(arm.el, arm.hn, .064, .052, 'canvas', '#9ca598', 9, 0);
    // Forearm armored bracer cuff near wrist
    const wr = [
      arm.el[0] * .24 + arm.hn[0] * .76,
      arm.el[1] * .24 + arm.hn[1] * .76,
      arm.el[2] * .24 + arm.hn[2] * .76
    ];
    m.ellipsoid(...wr, .058, .054, .060, 'blackMetal', darkArmor, 1, 9, 4);
    m.ellipsoid(...arm.hn, .062, .056, .072, 'rubber', '#3a4244', 0, 9, 5); // tactical glove
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

function shotPalette(s) {
  if (s.gun === 'MS10') return {core: '#f4ffff', outer: s.team ? '#ff8e5a' : '#4ce6ff', ring: s.team ? '#ffd285' : '#96f6ff', spark: '#ffe07d'};
  if (s.source === 'p1') return {core: '#f6f0ff', outer: '#c58cff', ring: '#7ff4ff', spark: '#ffd0ff'};
  if (s.gun === 'DF1 OUT') return {core: '#ecfffc', outer: '#5eead4', ring: '#f0b878', spark: '#99f6e4'};
  if (s.gun === 'D1') return {core: '#fff7e8', outer: s.team ? '#ff7c4d' : '#ffad5c', ring: '#ffe082', spark: '#ffd280'};
  if (s.gun === 'SRA') return {core: '#f4fff8', outer: s.team ? '#ff9962' : '#58e2be', ring: '#a8ffea', spark: '#d0fff0'};
  return {core: '#fffdf0', outer: s.team ? '#ffa25b' : '#ffe078', ring: '#fff2b0', spark: '#ffd36b'};
}

export function movingDetails(match, time, extra = false) {
  const m = new Mesh();
  const gullCount = extra ? 11 : 7;
  for (let i = 0; i < gullCount; i++) {
    const a = time * (.041 + i * .0007) + i * .61,
      x = -54 + Math.sin(a) * (24 + i * 2.4),
      z = -39 + Math.cos(a) * 62 + i * 8,
      y = 22 + i * .67 + Math.sin(a * 3.2),
      b = Math.sin(time * 3 + i) * .22;
    m.tri([x - .62, y + b, z + .16], [x, y, z], [x - .30, y + .1, z - .07], 'white', '#d4d4c8', 5, [0, 1, 0]);
    m.tri([x + .62, y + b, z + .14], [x + .31, y + .08, z - .08], [x, y, z], 'white', '#d4d4c8', 5, [0, 1, 0]);
  }
  if (!match) return m;

  // Supply tanker live status rings, beacon holograms, and recharge progress bars.
  if (match.tankers) {
    for (const tk of match.tankers) {
      const ready = tk.cooldown <= 0;
      const fill = ready ? 1 : clamp(1 - tk.cooldown / tk.maxCooldown, 0, 1);
      const bob = Math.sin(time * 2.7 + tk.id * 2.1) * .12;
      const ringCol = ready ? (Math.sin(time * 4 + tk.id) > 0 ? '#79f7e4' : '#ffe082') : '#d99a56';
      // Ground supply zone ring around the tanker
      ring(m, [tk.x, .09, tk.z], [0, 1, 0], tk.radius * .94, ready ? .065 : .035, extra ? 24 : 16, ringCol, 3);
      if (ready && extra) {
        const waveR = tk.radius * (.55 + ((time * .55 + tk.id * .33) % 1) * .45);
        ring(m, [tk.x, .14, tk.z], [0, 1, 0], waveR, .032, 20, '#b5fff4', 3);
      }
      // Elevated rotating holographic ammo-crystal beacon above the tanker
      const bx = tk.x, by = 3.55 + bob, bz = tk.z;
      const rot = time * (ready ? 1.8 : .55) + tk.id;
      const cr = Math.cos(rot) * .36, sr = Math.sin(rot) * .36;
      const top = [bx, by + .42, bz], bot = [bx, by - .42, bz];
      const p0 = [bx + cr, by, bz + sr], p1 = [bx - sr, by, bz + cr], p2 = [bx - cr, by, bz - sr], p3 = [bx + sr, by, bz - cr];
      const bCol = ready ? '#84ffec' : '#c78a4e';
      for (const [a, b] of [[p0, p1], [p1, p2], [p2, p3], [p3, p0]]) {
        m.tri(a, b, top, 'white', bCol, 3);
        m.tri(b, a, bot, 'white', ready ? '#ffd978' : '#7a593b', 3);
      }
      ring(m, [bx, by, bz], [Math.sin(rot) * .35, 1, Math.cos(rot) * .35], .56, .024, 12, ready ? '#ffe38c' : '#8d6c49', 3);
      // Horizontal charge bar along top of tanker
      const barLen = 2.6 * fill;
      if (barLen > .08) {
        m.box(tk.x, 2.94, tk.z - tk.facing * .68, .18, .09, barLen, 'white', ready ? '#88ffee' : '#f0b865', 0, 3);
      }
    }
  }

  // Deluxe multi-layer projectiles: spear core, glowing plasma shroud, tapered tail, Mach rings, and trailing sparks.
  for (const s of match.shots) {
    const pal = shotPalette(s);
    const isMS10 = s.gun === 'MS10';
    const maxTail = isMS10 ? (extra ? 9.8 : 7.6) : (extra ? 4.4 : 3.4);
    const tailLen = Math.min(maxTail, s.speed * (isMS10 ? .015 : .0095));
    const head = s.p;
    const tip = add(head, scale(s.dir, isMS10 ? .34 : .22));
    const mid = add(head, scale(s.dir, -tailLen * .38));
    const tail = add(head, scale(s.dir, -tailLen));
    const right = unit(cross(s.dir, Math.abs(s.dir[1]) > .92 ? [1, 0, 0] : [0, 1, 0]));
    const up = cross(right, s.dir);

    // 1. Sharp incandescent warhead spear + intense inner core
    m.tube(add(head, scale(s.dir, -.36)), tip, isMS10 ? .034 : .026, .005, 'white', pal.core, 6, 3);
    m.beam(mid, head, isMS10 ? .036 : .026, isMS10 ? .036 : .026, 'white', pal.core, 3);
    // 2. Wide outer plasma/tracer ribbon shroud + fading secondary tail
    m.beam(mid, add(head, scale(s.dir, .06)), isMS10 ? .082 : .058, isMS10 ? .022 : .018, 'white', pal.outer, 3);
    m.beam(mid, add(head, scale(s.dir, .06)), isMS10 ? .022 : .018, isMS10 ? .082 : .058, 'white', pal.outer, 3);
    m.beam(tail, mid, isMS10 ? .042 : .028, isMS10 ? .042 : .028, 'white', pal.outer, 3);

    // 3. Supersonic Mach shock rings along fast projectiles (signature visual for MS10 & SW T)
    const ringCount = isMS10 ? (extra ? 3 : 2) : (s.speed >= 320 || extra ? 1 : 0);
    for (let r = 0; r < ringCount; r++) {
      const distBack = .35 + r * (isMS10 ? 1.55 : 1.1) + ((time * 28 + s.id) % .65);
      if (distBack > tailLen) continue;
      const rad = (isMS10 ? .13 : .085) + r * .055;
      ring(m, add(head, scale(s.dir, -distBack)), s.dir, rad, isMS10 ? .015 : .011, extra ? 10 : 8, pal.ring, 3);
    }

    // 4. Trailing micro-sparks spinning off the bullet slipstream
    const spCount = isMS10 ? (extra ? 4 : 2) : (extra ? 2 : 1);
    for (let k = 0; k < spCount; k++) {
      const phase = s.id * 1.7 + k * 2.4 + time * 26;
      const back = .45 + k * (tailLen * .24);
      const off = add(scale(right, Math.cos(phase) * .11), scale(up, Math.sin(phase) * .11));
      const pA = add(add(head, scale(s.dir, -back)), off);
      const pB = add(pA, scale(s.dir, -.32));
      m.beam(pB, pA, .012, .012, 'white', pal.spark, 3);
    }
  }

  // Ejected spinning shell casings.
  if (match.casings) {
    for (const c of match.casings) {
      const ca = Math.cos(c.rot) * .038, sa = Math.sin(c.rot) * .038;
      const a = [c.p[0] - ca, c.p[1] - sa * .4, c.p[2] - sa];
      const b = [c.p[0] + ca, c.p[1] + sa * .4, c.p[2] + sa];
      const col = c.gun === 'MS10' ? '#7cefff' : c.gun === 'DF1 OUT' ? '#b8f2e6' : '#e6c16c';
      m.beam(a, b, .013, .013, 'white', col, c.gun === 'MS10' ? 3 : 1);
    }
  }

  // Multi-layered deluxe hit, shield-ripple, shield-break, kill-burst, wall-spark, muzzle-smoke & tanker effects.
  for (const e of match.effects) {
    const progress = clamp(1 - e.life / (e.max || .2), 0, 1);
    const inv = 1 - progress;
    const seed = e.seed || 1;
    const axis = e.dir || [0, 1, 0];

    if (e.kind === 'muzzle') {
      // Third-person NPC muzzle flash + lingering smoke wisp for all actors
      if (!e.human && progress < .48) {
        const s = (1 - progress / .48) * (e.gun === 'MS10' ? 1.15 : .9);
        const fCol = e.gun === 'MS10' ? '#63ecff' : '#ffc266';
        m.ellipsoid(e.p[0], e.p[1], e.p[2], .08 * s, .08 * s, .08 * s, 'white', '#fffbe6', 3, 6, 3);
        m.tube(e.p, add(e.p, scale(axis, .42 * s)), .06 * s, .01, 'white', fCol, 6, 3);
        ring(m, add(e.p, scale(axis, .14 * s)), axis, .11 * s, .014 * s, 8, fCol, 3);
      }
      // Drifting hot propellant smoke puff rising from muzzle
      const smokePos = add(e.p, add(scale(axis, .18 + progress * .48), [Math.sin(seed) * progress * .16, progress * .34, Math.cos(seed) * progress * .16]));
      const sr = (.035 + progress * .11) * inv;
      if (sr > .008) {
        m.ellipsoid(smokePos[0], smokePos[1], smokePos[2], sr, sr, sr, 'white', e.gun === 'MS10' ? '#a6d8e4' : '#c6ccc5', 5, 6, 3);
      }
      continue;
    }

    if (e.kind === 'tanker') {
      // Dramatic rising dual energy rings & ammo-refinery light pillars
      const r1 = 1.4 + progress * 4.4;
      const r2 = .9 + progress * 3.0;
      ring(m, [e.p[0], .25 + progress * 2.9, e.p[2]], [0, 1, 0], r1, .085 * inv, 20, '#78ffec', 3);
      ring(m, [e.p[0], .55 + progress * 2.1, e.p[2]], [0, 1, 0], r2, .065 * inv, 16, '#ffe07d', 3);
      const nSparks = extra ? 14 : 8;
      for (let k = 0; k < nSparks; k++) {
        const ang = k / nSparks * Math.PI * 2 + progress * 2.2;
        const rad = 1.6 + progress * 2.4;
        const px = e.p[0] + Math.cos(ang) * rad, pz = e.p[2] + Math.sin(ang) * rad;
        const py = .4 + progress * (2.6 + (k % 3) * .8);
        m.beam([px, py, pz], [px, py + .65 * inv, pz], .032 * inv, .032 * inv, 'white', k % 2 ? '#8effef' : '#ffe48f', 3);
      }
      continue;
    }

    if (e.kind === 'kill') {
      // Grand kill burst: incandescent star + dual shockwaves + rising ember shower
      if (progress < .38) {
        const cs = (.34 + progress * .75) * (1 - progress / .38);
        m.ellipsoid(e.p[0], e.p[1], e.p[2], cs, cs, cs, 'white', '#fffef0', 3, 8, 4);
      }
      ring(m, e.p, axis, .22 + progress * 1.95, .072 * inv, 16, '#ffe27a', 3);
      ring(m, e.p, [0, 1, 0], .18 + progress * 2.35, .058 * inv, 16, e.team ? '#ff9662' : '#72ffea', 3);
      if (extra) ring(m, e.p, [axis[2], .4, -axis[0]], .15 + progress * 1.5, .042 * inv, 12, '#ffffff', 3);
      const count = extra ? 22 : 14;
      for (let k = 0; k < count; k++) {
        const a1 = (seed * .7 + k * 2.39996) % 6.28;
        const elev = -.35 + ((k * 17 + seed) % 10) * .15;
        const spd = 1.6 + ((k * 13 + seed) % 9) * .28;
        const d = unit([Math.cos(a1), elev, Math.sin(a1)]);
        const start = add(e.p, [d[0] * progress * spd, d[1] * progress * spd - progress * progress * .75 + progress * .6, d[2] * progress * spd]);
        const end = add(start, scale(d, .36 * inv + .05));
        m.beam(start, end, .030 * inv + .006, .030 * inv + .006, 'white', k % 3 === 0 ? '#ffffff' : k % 2 ? '#ffd569' : '#76ffea', 3);
      }
      continue;
    }

    if (e.kind === 'break' || e.kind === 'shield') {
      // Energy shield ripple & shatter effect
      const isBreak = e.kind === 'break';
      const coreR = (isBreak ? .28 : .18) * inv;
      if (coreR > .02) m.ellipsoid(e.p[0], e.p[1], e.p[2], coreR, coreR, coreR, 'white', '#dcffff', 3, 8, 4);
      ring(m, e.p, axis, .15 + progress * (isBreak ? 1.65 : .95), (isBreak ? .062 : .042) * inv, 14, '#6cf6ff', 3);
      if (isBreak || extra) {
        ring(m, add(e.p, scale(axis, -.08)), axis, .10 + progress * (isBreak ? 1.15 : .65), .035 * inv, 10, '#ffffff', 3);
      }
      const count = isBreak ? (extra ? 18 : 12) : (extra ? 12 : 7);
      for (let k = 0; k < count; k++) {
        const a1 = seed + k * 2.39996;
        const d = unit([Math.cos(a1) * .9, -.2 + ((k * 7) % 10) * .14, Math.sin(a1) * .9]);
        const dist = (.14 + progress * (isBreak ? 1.85 : 1.05)) * (.75 + (k % 3) * .22);
        const p0 = add(e.p, scale(d, dist));
        const p1 = add(p0, scale(d, (isBreak ? .28 : .18) * inv + .04));
        m.beam(p0, p1, (isBreak ? .032 : .022) * inv + .005, .022 * inv + .005, 'white', k % 2 ? '#7cf7ff' : '#d6ffff', 3);
      }
      continue;
    }

    if (e.kind === 'hit') {
      // Deluxe body hit spark burst + shockwave ring
      if (progress < .42) {
        const cr = .19 * (1 - progress / .42);
        m.ellipsoid(e.p[0], e.p[1], e.p[2], cr, cr, cr, 'white', '#fff7d6', 3, 6, 3);
      }
      ring(m, e.p, axis, .12 + progress * .85, .042 * inv, 12, '#ffd976', 3);
      const count = extra ? 14 : 8;
      for (let k = 0; k < count; k++) {
        const a1 = seed * 1.3 + k * 2.39996;
        const d = unit([Math.cos(a1) - axis[0] * .6, .2 + ((k * 11) % 8) * .12, Math.sin(a1) - axis[2] * .6]);
        const r0 = .08 + progress * (1.1 + (k % 4) * .22);
        const p0 = add(e.p, [d[0] * r0, d[1] * r0 - progress * progress * .45, d[2] * r0]);
        const p1 = add(p0, scale(d, .22 * inv + .04));
        m.beam(p0, p1, .024 * inv + .005, .024 * inv + .005, 'white', k % 2 ? '#ffe585' : '#ff9955', 3);
      }
      continue;
    }

    // Wall / container / dock floor impact: bounce sparks, scorching glow, shock ring & dust debris
    const back = scale(axis, -1);
    if (progress < .45) {
      const cr = (e.gun === 'MS10' ? .17 : .12) * (1 - progress / .45);
      m.ellipsoid(e.p[0], e.p[1], e.p[2], cr, cr, cr, 'white', e.gun === 'MS10' ? '#bff8ff' : '#ffedb5', 3, 6, 3);
    }
    if (e.gun === 'MS10' || extra) {
      ring(m, add(e.p, scale(back, .05)), back, .09 + progress * (e.gun === 'MS10' ? .78 : .48), .028 * inv, 10, e.gun === 'MS10' ? '#70eaff' : '#ffcf7d', 3);
    }
    const count = extra ? 12 : 7;
    for (let k = 0; k < count; k++) {
      const a1 = seed * 1.7 + k * 2.39996;
      const d = unit([back[0] * .8 + Math.cos(a1) * .85, .35 + ((k * 9) % 7) * .14, back[2] * .8 + Math.sin(a1) * .85]);
      const dist = .06 + progress * (.95 + (k % 3) * .28);
      const p0 = add(e.p, [d[0] * dist, d[1] * dist - progress * progress * .75, d[2] * dist]);
      const p1 = add(p0, scale(d, .18 * inv + .03));
      const spCol = e.gun === 'MS10' && k % 2 === 0 ? '#7cf2ff' : e.metal ? '#ffd875' : '#d7cbb4';
      m.beam(p0, p1, .019 * inv + .004, .019 * inv + .004, 'white', spCol, e.metal || e.gun === 'MS10' ? 3 : 5);
    }
  }

  // Extra graphics atmospheric sea-mist motes glistening in the harbor sun.
  if (extra && match.player) {
    const px = match.player.x, pz = match.player.z;
    for (let i = 0; i < 18; i++) {
      const rx = ((Math.sin(i * 19.3) * 18 + time * (.5 + (i % 3) * .22) + 22) % 44) - 22;
      const rz = ((Math.cos(i * 11.7) * 24 + time * (.35 + (i % 4) * .15) + 26) % 52) - 26;
      const x = clamp(px + rx, -24, 24), z = clamp(pz + rz, -96, 96);
      const y = .7 + (i % 6) * .85 + Math.sin(time * 1.4 + i) * .25;
      m.box(x, y, z, .028, .028, .028, 'white', '#fff2cf', 0, 3);
    }
  }

  return m;
}
