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

export function character(team, gun, variant = 'standard', detail = 'high') {
  const m = new Mesh();
  const isSpy = variant === 'spy';
  const hi = detail !== 'low';
  const seg = hi ? 12 : 7;
  const eSeg = hi ? 14 : 8;
  const eBand = hi ? 7 : 4;
  const cSeg = hi ? 8 : 5;
  const ribs = hi ? 4 : 2;

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
    m.ellipsoid(hipX, .895, .012, .092, .088, .092, 'rubber', gasketCol, 0, seg, hi ? 6 : 4);
    m.hingeRotor([hipX + side * .068, .895, .012], [1, 0, 0], .042, .036, 'blackMetal', jointMetal, steelPin, seg, 1);
    m.ribbedJoint([hipX, .875, .012], [legX, .815, .010], .084, .098, ribs - 1, 'rubber', gasketCol, seg, 0);
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
    for (const sy of [.645, .755]) {
      m.tube([legX, sy, .006], [legX, sy + .018, .006], .106, .106, 'rubber', strapCol, seg, 0);
    }
    // Outer drop-leg tactical holster (right) / modular spy utility rig (left) with steel buckle clasps
    plateBox(legX + side * .095, .705, .008, .048, .155, .118, .010, 'blackMetal', darkArmor, 1);
    plateBox(legX + side * .118, .735, -.016, .018, .032, .032, .005, 'steel', steelPin, 1);
    if (isSpy) plateBox(legX + side * .116, .668, -.010, .014, .062, .016, .004, 'white', accent, 3);
    // Distal suprapatellar ribbed cuff right above knee hinge
    m.ribbedJoint([legX, .555, .006], [legX, .505, .006], .068, .080, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);

    // 2. Knee + Shin (Bone 10 / 13): dual-axis mechanical knee rotor + inner ribbed bellows + floating beveled patella cap + lofted calf + armored shin greave
    m.boneOffset = (baseBone + 1) * 10;
    // Inner spherical joint core & corrugated posterior flex-bellows
    m.ellipsoid(legX, .500, .008, .074, .072, .076, 'rubber', gasketCol, 0, seg, hi ? 6 : 4);
    m.ribbedJoint([legX, .455, .012], [legX, .540, .010], .064, .076, ribs, 'rubber', gasketCol, seg, 0);
    // Concentric machined lateral knee hinge rotor & brushed steel pivot bolts on both sides of knee!
    m.hingeRotor([legX, .500, .006], [1, 0, 0], .046, .162, 'blackMetal', jointMetal, steelPin, seg, 1);
    // Multi-piece floating patella knee-pad (tracks bisector half-angle in rig.js!)
    m.curvedPlate([legX, .500, -.018], [0, 1, 0], [0, 0, -1], .084, .112, 1.55, .018, 'steel', midArmor, cSeg, 1);
    plateBox(legX, .500, -.104, .078, .086, .032, .011, 'blackMetal', darkArmor, 1);
    plateBox(legX, .500, -.120, .054, .042, .014, .005, 'white', accent, isSpy ? 3 : 1);
    // Side patella hinge brackets connecting rotor to knee shield
    for (const sx of [-1, 1]) {
      m.beam([legX + sx * .076, .500, .002], [legX + sx * .048, .500, -.092], .018, .024, 'steel', jointMetal, 1);
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

    // 3. Ankle + Multi-Part Articulated Combat Boot (Bone 11 / 14): ankle hinge rotor + ribbed gaiter + heel counter + arch + hinged forefoot toe box + lugged outsole (sole y=0.000)
    m.boneOffset = (baseBone + 2) * 10;
    m.ribbedJoint([legX, .085, .014], [legX, .155, .014], .052, .064, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);
    m.hingeRotor([legX, .115, .014], [1, 0, 0], .038, .128, 'blackMetal', jointMetal, steelPin, seg, 1);
    // Reinforced beveled heel cup & Achilles armor bumper
    plateBox(legX, .062, .034, .112, .096, .098, .012, 'blackMetal', darkArmor, 1);
    plateBox(legX, .072, .080, .068, .064, .020, .007, 'steel', midArmor, 1);
    // Contoured midfoot vamp & armored instep strap
    plateBox(legX, .056, -.026, .114, .078, .076, .012, 'rubber', rubber, 0);
    plateBox(legX, .082, -.028, .118, .022, .036, .006, 'steel', midArmor, 1);
    // Articulated forefoot toe box (bends naturally at z < -0.041 in rig.js!)
    m.ellipsoid(legX, .044, -.092, .058, .038, .064, 'rubber', '#394143', 0, seg, hi ? 5 : 4);
    plateBox(legX, .042, -.118, .096, .044, .058, .012, 'blackMetal', darkArmor, 1); // reinforced steel toe bumper
    // Multi-piece rugged lugged combat outsole cleanly touching y = 0.000
    m.box(legX, .014, .036, .118, .028, .096, 'rubber', '#22282a', 0, 0); // heel lug block (y=0.000..0.028)
    m.box(legX, .016, -.024, .106, .024, .046, 'rubber', '#1d2224', 0, 0); // recessed midfoot arch
    m.box(legX, .014, -.092, .122, .028, .108, 'rubber', '#22282a', 0, 0); // forefoot grip sole (y=0.000..0.028)
    if (hi) {
      for (const lz of [-.060, -.095, -.128]) {
        m.box(legX, .012, lz, .126, .018, .018, 'rubber', '#171c1e', 0, 0); // grip tread cleats
      }
    }
  }

  // ---- Bone 0: Pelvis, Hip Joint Sockets & Tactical Battle Belt ----
  m.boneOffset = 0;
  m.ellipsoid(0, .900, .012, .212, .108, .144, 'blackMetal', suitDark, 0, eSeg, eBand);
  plateBox(0, .865, -.116, .155, .122, .062, .014, 'blackMetal', darkArmor, 1); // armored front groin/codpiece guard
  plateBox(0, .890, .124, .215, .108, .052, .012, 'blackMetal', darkArmor, 1); // rear sacral armor guard
  // Heavy modular battle belt + beveled Cobra steel buckle
  plateBox(0, .948, .010, .426, .072, .296, .010, 'blackMetal', darkArmor, 1);
  plateBox(0, .948, -.152, .102, .058, .030, .008, 'steel', steelPin, 1);
  plateBox(0, .948, -.164, .056, .026, .014, .004, 'blackMetal', darkArmor, 1);
  // Hip socket collars & side modular pouches
  for (const sx of [-1, 1]) {
    m.curvedPlate([sx * .182, .895, .010], [0, 1, 0], [sx, 0, 0], .042, .088, 2.2, .014, 'steel', midArmor, cSeg, 1);
    plateBox(sx * .222, .932, -.026, .056, .096, .118, .009, 'canvas', pouchCol, 0);
    plateBox(sx * .224, .962, -.026, .060, .022, .120, .005, 'blackMetal', strapCol, 1);
  }
  plateBox(0, .922, .162, .178, .095, .062, .009, 'canvas', pouchCol, 0); // rear utility dump pouch

  // ---- Bone 1: Articulated Lumbar Spine, Ribbed Waist Flex-Gasket & Exo-Braces ----
  m.boneOffset = 10;
  // Corrugated ballistic flex-sleeve waist joint bridging pelvis to ribcage
  m.ribbedJoint([0, .965, .010], [0, 1.140, .010], .165, .184, ribs, 'rubber', gasketCol, eSeg, 0);
  m.ellipsoid(0, 1.055, .010, .196, .135, .138, 'canvas', suitLight, 0, seg, hi ? 5 : 4);
  // 3-tier overlapping beveled abdominal flex plates (front)
  for (let i = 0; i < 3; i++) {
    const ay = 1.000 + i * .054, aw = .245 + i * .018, az = -.122 - i * .005;
    plateBox(0, ay, az, aw, .042, .048, .008, 'blackMetal', midArmor, 1);
  }
  // 3-vertebrae dorsal spine armor plates + twin lateral hydraulic stabilizer struts (back)
  for (let i = 0; i < 3; i++) {
    plateBox(0, .995 + i * .056, .132, .138 - i * .008, .044, .046, .008, 'steel', jointMetal, 1);
  }
  if (hi) {
    for (const sx of [-1, 1]) {
      m.tube([sx * .142, .972, .082], [sx * .158, 1.148, .086], .016, .014, 'steel', steelPin, 8, 1);
      m.tube([sx * .146, 1.010, .083], [sx * .152, 1.095, .084], .022, .022, 'blackMetal', darkArmor, 8, 1);
    }
  }

  // ---- Bone 2: Thoracic Chest Armor, Collarbone Yoke, Shoulder Sockets & Tactical Backpack ----
  m.boneOffset = 20;
  // Contoured anatomical chest torso shell
  m.sculptLimb([0, 1.135, .008], [0, 1.430, .004], [
    [0.00, .195, .138, 0, 0],
    [0.25, .232, .156, 0, -.005],
    [0.62, .258, .168, 0, -.006],
    [0.88, .240, .152, 0, -.002],
    [1.00, .165, .128, 0, 0]
  ], 'canvas', vest, eSeg, 0);
  // Beveled front SAPI ballistic plate carrier + angled pectoral armor
  plateBox(0, 1.255, -.138, .356, .244, .086, .016, 'blackMetal', plate, 1);
  plateBox(0, 1.335, -.162, .312, .082, .052, .012, 'steel', midArmor, 1);
  plateBox(0, 1.356, -.190, .318, .034, .020, .005, 'white', accent, isSpy ? 3 : 0);
  // Glowing team/spy sternum IFF beacon
  plateBox(.098, 1.258, -.190, .084, .042, .022, .005, 'white', light, 3);
  // Triple front MOLLE magazine pouches (left chest reload target!) with steel retention clips
  for (let p = 0; p < 3; p++) {
    const px = -.118 + p * .058;
    plateBox(px, 1.202, -.192, .048, .096, .042, .006, 'canvas', pouchCol, 0);
    m.box(px, 1.256, -.190, .034, .018, .028, 'blackMetal', darkArmor, 0, 1); // exposed mag baseplate
  }
  // Shoulder harness straps + machined steel D-ring buckles + armored clavicle gorget yoke
  for (const sx of [-1, 1]) {
    m.beam([sx * .132, 1.355, -.135], [sx * .142, 1.425, .020], .062, .026, 'blackMetal', darkArmor, 1);
    m.beam([sx * .142, 1.425, .020], [sx * .135, 1.360, .152], .062, .026, 'blackMetal', darkArmor, 1);
    plateBox(sx * .132, 1.372, -.142, .042, .026, .022, .005, 'steel', steelPin, 1);
    // Recessed shoulder ball-joint collar ring seated on thorax flanks
    m.hingeRotor([sx * .218, 1.398, .000], [1, 0, 0], .068, .032, 'blackMetal', darkArmor, jointMetal, seg, 1);
  }
  m.curvedPlate([0, 1.418, .002], [0, 1, 0], [0, 0, -1], .136, .064, 3.6, .022, 'blackMetal', darkArmor, cSeg + 2, 1);

  // Tactical backpack: chamfered armored chassis + left shield condenser cylinder + right ammo-refiner + comms whip antenna
  plateBox(0, 1.248, .182, .378, .362, .084, .014, 'blackMetal', darkArmor, 1);
  m.tube([-.098, 1.07, .240], [-.098, 1.425, .240], .076, .076, 'steel', metal, seg, 1);
  for (const y of [1.115, 1.225, 1.335]) {
    m.tube([-.098, y, .240], [-.098, y + .034, .240], .082, .082, 'white', isSpy ? '#58ffe8' : '#77d4c6', seg, 3);
  }
  plateBox(.096, 1.242, .242, .152, .358, .128, .012, 'blackMetal', isSpy ? '#36464d' : '#969d8d', 1);
  for (let j = 0; j < 4; j++) {
    plateBox(.096, 1.132 + j * .062, .310, .118, .018, .014, .003, 'white', isSpy ? accent : '#e1b163', isSpy ? 3 : 1);
  }
  // Tactical whip comms antenna + Spy stealth dorsal fins
  m.tube([-.152, 1.415, .195], [-.178, 1.725, .215], .010, .004, 'blackMetal', darkArmor, 6, 1);
  m.ellipsoid(-.178, 1.732, .216, .010, .010, .010, 'white', light, 3, 6, 4);
  if (isSpy) {
    for (const sx of [-1, 1]) {
      m.beam([sx * .165, 1.36, .205], [sx * .205, 1.50, .285], .020, .062, 'steel', darkArmor, 1);
      m.beam([sx * .185, 1.42, .245], [sx * .208, 1.495, .290], .008, .022, 'white', light, 3);
    }
  }

  // ---- Bone 3: Cervical Neck, Ribbed Ballistic Gasket & Armored Throat Guard ----
  m.boneOffset = 30;
  m.ribbedJoint([0, 1.425, .002], [0, 1.545, -.006], .068, .082, ribs, 'rubber', gasketCol, seg, 0);
  m.curvedPlate([0, 1.472, -.004], [0, 1, 0], [0, 0, -1], .088, .064, 2.2, .016, 'blackMetal', darkArmor, cSeg, 1);
  if (hi) {
    for (const sx of [-1, 1]) {
      m.tube([sx * .058, 1.430, .048], [sx * .048, 1.535, .042], .012, .010, 'steel', jointMetal, 6, 1);
    }
  }

  // ---- Bone 4: Sculpted Multi-Plane Tactical Helmet, Visor, Mandible Respirator & Comms Headset ----
  m.boneOffset = 40;
  // Sculpted high-cut ballistic helmet dome
  m.ellipsoid(0, 1.648, -.006, .148, .174, .154, 'steel', helmetShell, 1, eSeg, eBand);
  // Armored brow hood & top crown crest shell
  m.ellipsoid(0, 1.748, .004, .158, .074, .156, 'steel', isSpy ? darkArmor : accent, 1, eSeg, hi ? 5 : 4);
  plateBox(0, 1.716, -.136, .185, .036, .062, .009, 'blackMetal', darkArmor, 1); // brow sun/sensor hood
  // NVG forehead shroud mount + rear counterweight battery box
  plateBox(0, 1.738, -.156, .062, .054, .036, .007, 'steel', jointMetal, 1);
  plateBox(0, 1.640, .148, .106, .074, .042, .009, 'blackMetal', darkArmor, 1);
  // Curved recessed optical visor shield
  m.ellipsoid(0, 1.655, -.076, .148, .092, .108, 'blackMetal', visorTint, 1, eSeg, hi ? 6 : 4);
  if (isSpy) {
    // NV2.1 Signature Tri-Optic Stealth Recon NVG Goggles (3 glowing emerald-cyan lenses + carbon housings!)
    for (const [gx, gy, gz, gr] of [[-.062, 1.666, -.174, .026], [0, 1.682, -.180, .028], [.062, 1.666, -.174, .026]]) {
      m.tube([gx, gy, gz + .032], [gx, gy, gz - .014], gr * 1.18, gr * 1.05, 'blackMetal', darkArmor, 10, 1);
      m.tube([gx, gy, gz - .014], [gx, gy, gz - .022], gr * .82, gr * .82, 'white', light, 10, 3);
    }
    plateBox(0, 1.676, -.152, .155, .022, .032, .005, 'steel', jointMetal, 1); // NVG bridge bar
  } else {
    // Standard glowing panoramic optical visor strip + brow rim
    plateBox(0, 1.668, -.178, .198, .026, .020, .005, 'white', light, 3);
  }
  // Sculpted angled jaw mandible respirator mask + twin cheek filter canisters + chin grille
  plateBox(0, 1.568, -.116, .148, .078, .092, .014, 'blackMetal', darkArmor, 1);
  plateBox(0, 1.558, -.162, .068, .042, .018, .005, 'steel', jointMetal, 1); // front respirator vent
  for (const sx of [-1, 1]) {
    // Cheek filter pods
    m.tube([sx * .068, 1.568, -.122], [sx * .096, 1.562, -.148], .024, .022, 'steel', midArmor, 8, 1);
    // Side ARC accessory rails + active ear-pro tactical comms headset cups
    plateBox(sx * .148, 1.678, -.018, .022, .032, .148, .005, 'blackMetal', darkArmor, 1);
    m.hingeRotor([sx * .156, 1.635, .004], [1, 0, 0], .048, .034, 'blackMetal', darkArmor, accent, seg, 1);
  }
  // Tactical boom microphone curving from left ear-pro cup to mandible
  if (hi) m.beam([-.156, 1.615, -.010], [-.068, 1.565, -.150], .012, .012, 'blackMetal', strapCol, 1);

  // ---- Bones 5..8: 2-Bone Analytical IK Sculpted Arms (Shoulder Pauldron -> Upper Arm -> Hinged Elbow -> Forearm Bracer -> Wrist -> Articulated Hand) ----
  const arms = [
    {s: -1, bUp: 5, bLo: 6, sh: [-.225, 1.400, .000], el: [-.210, 1.160, -.165], hn: [.035, 1.205, -.395]},
    {s: 1, bUp: 7, bLo: 8, sh: [.225, 1.400, .000], el: [.265, 1.145, -.065], hn: [.072, 1.170, -.240]}
  ];
  for (const arm of arms) {
    const uDir = unit(sub(arm.el, arm.sh));
    const fDir = unit(sub(arm.hn, arm.el));
    const shOut = [arm.s, .28, 0];
    const elMid = add(arm.sh, scale(sub(arm.el, arm.sh), .52));
    const elHint = unit(cross(uDir, fDir)); // exact anatomical elbow flexion hinge axis!

    // Upper Arm (Bone 5 / 7): shoulder ball joint + ribbed flex-bellows + dual-tier curved pauldron + anatomically lofted bicep/tricep + bicep cuff
    m.boneOffset = arm.bUp * 10;
    m.ellipsoid(...arm.sh, .084, .082, .084, 'rubber', gasketCol, 0, seg, hi ? 6 : 4);
    m.ribbedJoint(arm.sh, add(arm.sh, scale(uDir, .078)), .064, .078, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);
    // Dual-tier sculpted curved shoulder pauldron (upper cap + lower floating deltoid shield + rivets!)
    m.curvedPlate(add(arm.sh, [arm.s * .018, .018, 0]), uDir, shOut, .086, .118, 2.15, .018, 'steel', isSpy ? darkArmor : accent, cSeg, 1);
    m.curvedPlate(add(arm.sh, add(scale(uDir, .088), [arm.s * .014, 0, 0])), uDir, [arm.s, 0, -.15], .078, .086, 1.85, .015, 'blackMetal', darkArmor, cSeg, 1);
    if (isSpy) {
      m.curvedPlate(add(arm.sh, [arm.s * .022, .020, 0]), uDir, shOut, .096, .024, 1.65, .008, 'white', accent, cSeg, 3);
    }
    // Anatomically lofted upper arm (deltoid -> muscular bicep/tricep -> tapered distal humerus)
    m.sculptLimb(arm.sh, arm.el, [
      [0.05, .072, .074, 0, 0],
      [0.32, .076, .080, 0, -.004],
      [0.62, .074, .078, 0, -.004],
      [0.88, .064, .066, 0, 0],
      [1.00, .058, .060, 0, 0]
    ], 'canvas', suitDark, seg, 0);
    // Bicep compression strap & distal elbow-side ribbed sleeve
    m.tube(add(elMid, scale(uDir, -.016)), add(elMid, scale(uDir, .018)), .077, .077, 'rubber', strapCol, seg, 0);
    m.ribbedJoint(add(arm.el, scale(uDir, -.055)), arm.el, .054, .065, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);

    // Forearm + Hinged Elbow + Wrist + Articulated Glove (Bone 6 / 8)
    m.boneOffset = arm.bLo * 10;
    // Inner spherical joint + corrugated flex-bellows + precision machined elbow hinge rotor along true flexion axis!
    m.ellipsoid(...arm.el, .062, .062, .062, 'rubber', gasketCol, 0, seg, hi ? 5 : 4);
    m.ribbedJoint(arm.el, add(arm.el, scale(fDir, .058)), .052, .062, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);
    m.hingeRotor(arm.el, elHint, .036, .118, 'blackMetal', jointMetal, steelPin, seg, 1);
    // Outer hard-shell beveled tactical elbow guard (cop) positioned on posterior/outer elbow
    const elOut = unit(add(scale(uDir, .55), scale(fDir, -.55)));
    const padC = add(arm.el, scale(elOut, .056));
    m.curvedPlate(arm.el, elHint, elOut, .066, .082, 1.75, .016, 'blackMetal', darkArmor, cSeg, 1);
    plateBox(padC[0], padC[1], padC[2], .054, .056, .048, .009, 'steel', midArmor, 1);

    // Anatomically tapered forearm (muscular brachioradialis near elbow -> slim wrist)
    m.sculptLimb(arm.el, arm.hn, [
      [0.02, .060, .060, 0, 0],
      [0.26, .068, .066, 0, 0],
      [0.58, .058, .056, 0, 0],
      [0.82, .048, .046, 0, 0],
      [0.95, .046, .044, 0, 0]
    ], 'canvas', suitLight, seg, 0);

    // Curved armored forearm gauntlet bracer + glowing left-wrist tactical holo-display!
    const bracerC = add(arm.el, scale(sub(arm.hn, arm.el), .54));
    const bracerOut = unit([arm.s * .7, .4, .2]);
    m.curvedPlate(bracerC, fDir, bracerOut, .058, .125, 2.2, .014, 'blackMetal', darkArmor, cSeg, 1);
    if (arm.s < 0) {
      // Left wrist tactical mini-computer screen (extra bright cyan/emerald on NV2.1 Spy!)
      const tacC = add(bracerC, scale(bracerOut, .062));
      plateBox(tacC[0], tacC[1], tacC[2], .032, .022, .056, .004, 'blackMetal', darkArmor, 1);
      m.box(tacC[0] + bracerOut[0] * .011, tacC[1] + bracerOut[1] * .011, tacC[2] + bracerOut[2] * .011, .020, .010, .040, 'white', light, 0, 3);
    }

    // Articulated ribbed wrist joint + metallic cuff collar
    const wrStart = add(arm.el, scale(sub(arm.hn, arm.el), .76));
    const wrEnd = add(arm.el, scale(sub(arm.hn, arm.el), .90));
    m.ribbedJoint(wrStart, wrEnd, .044, .052, hi ? 3 : 2, 'rubber', gasketCol, seg, 0);
    m.hingeRotor(wrEnd, elHint, .024, .092, 'steel', jointMetal, steelPin, 8, 1);

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
