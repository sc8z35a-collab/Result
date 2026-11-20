import {color, random} from './geometry.js';
import {dockFixtures} from './port-layout.js';

// Each entry is a photograph or a baked face on a 400px page. Geometry carries
// the sub-rectangle in its UVs, so all objects use the normal terrain draw.
const insets = {
  valve: ['portHardware', 0], dial: ['portHardware', 1], hatch: ['portHardware', 2], hose: ['portHardware', 3],
  tarp: ['portFreight', 0], timberBands: ['portFreight', 1], fishTotes: ['portFreight', 2], slingNet: ['portFreight', 3],
  intake: ['portPanels', 0], chiller: ['portPanels', 1], serviceDoor: ['portPanels', 2], duct: ['portPanels', 3],
  officeGlass: ['portWindows', 0], wiredGlass: ['portWindows', 1], pumpDoor: ['portWindows', 2], tiles: ['portWindows', 3],
  pumpSign: ['portSigns', 0], coldSign: ['portSigns', 1], weighSign: ['portSigns', 2], worksSign: ['portSigns', 3]
};
const faces = {
  south: [0, 1], east: [1, 0], north: [0, -1], west: [-1, 0]
};
const neutral = '#f1ecdc';

function surface(m, points, normal, material, tint = neutral, u = 1, v = 1, kind = 1) {
  const inset = insets[material];
  if (!inset) {
    m.quad(...points, material, tint, u, v, kind, normal);
    return;
  }
  const [page, cell] = inset, strip = page === 'portSigns';
  const left = strip ? .006 : (cell % 2) * .5 + .011;
  const top = strip ? cell * .25 + .005 : Math.floor(cell / 2) * .5 + .011;
  const right = left + (strip ? .988 : .478), bottom = top + (strip ? .240 : .478);
  const uv = [[left,bottom], [right,bottom], [right,top], [left,top]], rgb = color(tint);
  for (const i of [0, 1, 2, 0, 2, 3]) m.vertex(points[i], normal, uv[i], page, rgb, kind);
}

export function dockFace(m, x, y, z, w, h, dir, material, tint = neutral, u = 1, v = 1, kind = 1) {
  const [nx, nz] = faces[dir], dx = nz*w/2, dz = -nx*w/2, lo = y-h/2, hi = y+h/2;
  surface(m, [[x-dx,lo,z-dz], [x+dx,lo,z+dz], [x+dx,hi,z+dz], [x-dx,hi,z-dz]],
    [nx,0,nz], material, tint, u, v, kind);
}

function lid(m, x, y, z, w, d, material, tint = neutral, u = 1, v = 1, kind = 1) {
  surface(m, [[x-w/2,y,z+d/2], [x+w/2,y,z+d/2], [x+w/2,y,z-d/2], [x-w/2,y,z-d/2]],
    [0,1,0], material, tint, u, v, kind);
}

function onWall(m, p, dir, along, height, w, h, material, tint = neutral, u = 1, v = 1, kind = 1) {
  const [nx,nz] = faces[dir];
  dockFace(m, p.x+nx*(p.w/2+.012)+nz*along, p.base+height, p.z+nz*(p.d/2+.012)-nx*along,
    w, h, dir, material, tint, u, v, kind);
}

function shell(m, p, wall, top, tint = neutral, metres = 0, kind = 1) {
  for (const [dir, [nx, nz]] of Object.entries(faces)) {
    const width = nx ? p.d : p.w;
    dockFace(m, p.x+nx*p.w/2, p.base+p.h/2, p.z+nz*p.d/2, width, p.h, dir,
      wall, tint, metres ? width/metres : 1, metres ? p.h/metres : 1, kind);
  }
  lid(m, p.x, p.base+p.h, p.z, p.w, p.d, top, tint, metres ? p.w/metres : 1, metres ? p.d/metres : 1, kind);
  // The underside of the pump canopy is visible from inside the passage.
  if (p.name === 'canopy' || p.name === 'parapet') {
    m.quad([p.x-p.w/2,p.base,p.z-p.d/2], [p.x+p.w/2,p.base,p.z-p.d/2],
      [p.x+p.w/2,p.base,p.z+p.d/2], [p.x-p.w/2,p.base,p.z+p.d/2], 'bondTimber', '#978873', 2, 2, 0, [0,-1,0]);
  }
}

function pumpPart(m, p, lite) {
  if (p.name === 'roofVent') {
    shell(m, p, 'slatDoor', 'workTin', '#bdc9c0', 1.35);
    for (const dir of ['south','north']) onWall(m, p, dir, 0, .64, p.w, .12, 'yardStripes', '#c1b9a2');
    return;
  }
  if (p.name === 'canopy') {
    shell(m, p, 'portBlue', 'workTin', '#c0cebd', 2.8);
    for (const z of [-2.56, 2.56]) m.box(1.32, p.base-.085, z, 2.48, .17, .16, 'saltCladding', '#949f93', 0, 1);
    if (!lite) {
      onWall(m, p, 'east', 0, .14, p.d, .08, 'saltCladding');
      for (const z of [-1.73,1.73]) m.box(.84,p.base-.044,z,.32,.08,.57,'white','#ffefcb',0,3);
    }
    return;
  }
  if (p.name === 'pier') {
    shell(m, p, 'portBlue', 'saltCladding', '#b6c7b6', 1.8);
    for (const dir of ['south','east']) onWall(m, p, dir, 0, .61, .38, .52, 'yardStripes');
    return;
  }
  shell(m, p, 'saltConcrete', 'cement', '#d5cdb7', 2.7, 0);
  onWall(m, p, 'east', 0, 1.56, p.d-.05, 2.98, 'tiles');
  onWall(m, p, 'south', 0, 2.59, 2.58, .64, 'pumpSign');
  onWall(m, p, 'south', -.57, 1.12, 1.02, 2.14, 'pumpDoor');
  onWall(m, p, 'south', .79, 1.35, .88, 1.06, 'intake');
  onWall(m, p, 'north', 0, 1.55, 1.84, 1.28, 'duct');
  onWall(m, p, 'west', 0, 1.95, 3.20, .80, 'pumpSign');
  // A ceramic dado, pipe manifold and wheel valves sit against the solid wall.
  const x = p.x+p.w/2+.047;
  for (const z of [-1.62, .0, 1.62]) {
    dockFace(m, x, 1.56, z, .66, .66, 'east', 'valve');
    if (!lite) {
      m.tube([x+.018,.30,z], [x+.018,1.20,z], .058, .058, 'portBlue', '#92ab99', 6);
      dockFace(m, x+.012, 2.19, z, .32, .32, 'east', 'dial');
    }
  }
  if (!lite) m.tube([x+.03,.49,-2.2], [x+.03,.49,2.2], .082, .082, 'portBlue', '#91b0a0', 8);
}

function officePart(m, p, lite) {
  if (p.name === 'scaleReader') {
    shell(m, p, 'saltCladding', 'portBlue', '#a7b6aa');
    onWall(m, p, 'south', 0, 1.08, .47, .46, 'dial');
    onWall(m, p, 'north', 0, .52, .50, .55, 'yardStripes');
    return;
  }
  if (p.name === 'parapet') {
    shell(m, p, 'portBlue', 'workTin', '#aebeb8', 2.0);
    return;
  }
  shell(m, p, 'saltCladding', 'slatDoor', '#d6cfb8', 2.1);
  for (const dir of ['south', 'east', 'west', 'north']) {
    const width = faces[dir][0] ? p.d : p.w;
    onWall(m, p, dir, 0, .38, width, .72, 'portBlue', '#9ebbb7', width/2, .67);
    if (dir !== 'north') onWall(m, p, dir, 0, 1.98, width-.26, 1.11, 'officeGlass');
  }
  onWall(m, p, 'south', 0, .99, 2.84, .69, 'weighSign');
  onWall(m, p, 'north', .84, 1.18, 1.06, 2.27, 'serviceDoor');
  onWall(m, p, 'north', -.89, 1.73, 1.65, .82, 'wiredGlass');
  m.plane(0, .053, 3.85, 8.25, 2.74, 'tread', '#abb3aa', 5, 2, 2);
  for (const z of [2.39, 5.31]) m.plane(0, .057, z, 8.4, .14, 'yardStripes', '#ccb566', 5, .3);
  if (!lite) {
    // Three standing seams and a projecting sill give the kiosk depth at eye level.
    for (const x of [-2.24,0,2.24]) m.box(x,2.03,p.d/2+.047,.055,1.19,.082,'saltCladding','#abb6a9',0,1);
    m.box(0,1.38,p.d/2+.051,p.w-.16,.085,.14,'workTin','#bcc6b9',2,1);
    for (const x of [-3.37, 0, 3.37]) m.plane(x, .057, 3.85, .065, 2.72, 'blackMetal', '#556261');
  }
}

function equipment(m, p, lite) {
  switch (p.name) {
    case 'reefer':
      shell(m, p, 'saltCladding', 'slatDoor', '#d7ddce', 1.7);
      onWall(m, p, 'south', 0, 1.13, p.w-.13, p.h-.12, 'chiller');
      onWall(m, p, 'north', 0, 1.15, 2.68, 1.68, 'duct');
      for (const dir of ['east','west']) onWall(m, p, dir, 0, 1.42, 1.42, .89, 'wiredGlass');
      if (!lite) onWall(m, p, 'east', 0, .50, .80, .52, 'intake');
      break;
    case 'generator':
      shell(m, p, 'portBlue', 'slatDoor', '#bfbba1', 1.8);
      onWall(m, p, 'south', -.55, .78, 1.67, 1.25, 'duct');
      onWall(m, p, 'south', 1.02, .76, .92, 1.22, 'intake');
      onWall(m, p, 'north', 0, .77, 2.88, 1.11, 'slatDoor', '#b1a78d', 1.7, 1);
      onWall(m, p, 'east', 0, .75, 1.30, 1.20, 'hose');
      if (!lite) onWall(m, p, 'west', 0, .70, 1.03, .91, 'hatch');
      break;
    case 'silencer':
      shell(m, p, 'workTin', 'duct', '#8d998c', .94);
      break;
    case 'ice':
      shell(m, p, 'fishTotes', 'saltCladding', '#d3dbce');
      lid(m, p.x, p.h+.008, p.z, p.w-.10, p.d-.10, 'tarp');
      break;
    case 'timber':
      shell(m, p, 'timberBands', 'bondTimber', '#d6ba91', 0, 0);
      for (const x of [-p.w*.27, p.w*.27]) m.plane(x, p.h+.009, 0, .077, p.d, 'blackMetal', '#8c9791');
      break;
    case 'sling':
      shell(m, p, 'slingNet', 'tarp', '#c9c6ab', 0, 0);
      for (const dir of ['south','east','north','west']) {
        const w = faces[dir][0] ? p.d : p.w;
        onWall(m, p, dir, 0, .105, w, .21, 'bondTimber', '#c3ac8d', 1, .6, 0);
      }
      break;
    case 'gabion':
      shell(m, p, 'stoneWall', 'chip', '#c4c3ad', 1.36, 0);
      for (const dir of ['south','north']) {
        for (const along of [-1.52,-.5,.5,1.52]) onWall(m, p, dir, along, p.h/2, .039, p.h, 'blackMetal');
        onWall(m, p, dir, 0, .93, p.w, .055, 'workTin');
      }
      break;
    case 'locker':
      shell(m, p, 'portBlue', 'bondTimber', '#c3cbc0', 1.5);
      onWall(m, p, 'south', 0, .74, 1.86, 1.14, 'hose');
      onWall(m, p, 'north', 0, .74, 1.69, 1.04, 'slatDoor', '#c3b69e');
      if (!lite) onWall(m, p, 'east', 0, .75, .82, .82, 'hatch');
      break;
  }
}

export function drawDockFixtures(m, lite) {
  const previous = m.transform;
  for (const f of dockFixtures) {
    m.transform = {origin: [f.x,0,f.z], right: [f.cos,0,-f.sin], up: [0,1,0], back: [f.sin,0,f.cos]};
    for (const part of f.parts) {
      if (f.kind === 'pumpHouse') pumpPart(m, part, lite);
      else if (f.kind === 'weighOffice') officePart(m, part, lite);
      else equipment(m, part, lite);
    }
    if (f.kind === 'pumpHouse') {
      m.plane(1.48, .053, 0, 2.33, 5.9, 'grate', '#8c9284', 2.2, 5.2, 2);
      for (const z of [-3.12,3.12]) m.plane(1.42, .056, z, 2.27, .20, 'yardStripes', neutral, 2, .5);
    }
  }
  m.transform = previous;
}

// The sea face uses a single vertical UV span, keeping the wet mark at a
// consistent elevation even where the wall runs for 200 metres.
export function quayEdge(m, lite) {
  dockFace(m, -25.012, -1.55, 0, 200, 3.10, 'west', 'seaWall', '#c7c8b3', 45, 1, 0);
  for (const z of [-86,-48,-10,28,66]) {
    // A vertical ladder and two rubber rubbing strips sit outside the playable lip.
    for (const dz of [-1.10,1.10]) {
      if (lite) dockFace(m,-25.24,-.98,z+dz,.32,1.52,'west','rubber','#6d7770',1,1);
      else m.box(-25.13,-.98,z+dz,.22,1.52,.32,'rubber','#6d7770',1.15);
    }
    if (!lite) {
      for (const dz of [-.27,.27]) m.box(-25.22,-.74,z+dz,.065,1.83,.066,'saltCladding','#a29f83');
      for (let i=0;i<6;i++) m.box(-25.23,-1.51+i*.30,z,.072,.052,.57,'workTin','#b4a787');
    }
  }
}

// A continuous broken limestone bank replaces intersecting closed rock spheres.
// The upper edge is above water, and individual boulders break its silhouette.
export function breakwater(m, lite) {
  const rng = random(417), n = lite ? 10 : 40;
  let last;
  for (let i=0;i<=n;i++) {
    const z = -164+66*i/n;
    const shoulder = -25.3+.44*Math.sin(i*1.17), width = 2.4+rng()*1.3;
    const crest = -.73+rng()*.57+.12*Math.sin(i*1.9);
    const row = [[shoulder+.6,-1.91,z], [shoulder,crest,z], [shoulder-width*.48,crest-.18-rng()*.34,z],
      [shoulder-width,-1.72-rng()*.46,z]];
    if (last) {
      for (let k=0;k<3;k++) {
        const mat = k === 2 ? 'wetStone' : k === 0 ? 'stoneMoss' : i%5===0 ? 'chip' : 'quarry';
        m.quad(last[k], last[k+1], row[k+1], row[k], mat, '#b8b9aa', 1, 1, 0);
      }
    }
    last = row;
  }
  if (!lite) {
    for (let i=0;i<31;i++) {
      const z = -163+rng()*64, r = .34+rng()*.74;
      m.ellipsoid(-27+rng()*1.9,-.86+rng()*.45,z,r,.68*r,.84*r,i%3===0?'stoneMoss':'quarry','#adb1a2',0,5,2);
    }
  }
}
