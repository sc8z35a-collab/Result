import test from 'node:test';
import assert from 'node:assert/strict';
import {Mesh, STRIDE} from '../dist/js/geometry.js';
import {dockFixtures, dockBounds} from '../dist/js/port-layout.js';
import {drawDockFixtures} from '../dist/js/dockworks.js';
import {walkable, floorAt, raycastMaterial, obstruction, obstacles, tankers, teams} from '../dist/js/yard.js';
import {WharfNavigation} from '../dist/js/nv1.js';

test('Every placed dock component has matching render and collision extents in both detail modes', () => {
  const roofs = [false, true].map(lite => {
    const mesh = new Mesh(), points = new Set();
    drawDockFixtures(mesh, lite);
    for (let i = 0; i < mesh.data.length; i += STRIDE) {
      if (mesh.data[i+4] > .999) points.add(mesh.data.slice(i,i+3).map(n => n.toFixed(4)).join(','));
    }
    return points;
  });
  for (const f of dockFixtures) for (const part of f.parts) {
    const box = dockBounds(f, part), x = (box.x0+box.x1)/2, z = (box.z0+box.z1)/2;
    assert(obstacles.some(o => Object.keys(box).every(k => o[k] === box[k])), f.kind);
    assert.equal(floorAt(x, z, box.y1+.001), box.y1);
    if (!part.base) assert.equal(walkable(x,z,.35), false, f.kind);
    const mid = [x, (box.y0+box.y1)/2, z];
    assert.equal(raycastMaterial(mid, [x+.01,mid[1],z])?.mat, part.mat);
    for (const xx of [box.x0,box.x1]) for (const zz of [box.z0,box.z1]) {
      const corner = [xx,box.y1,zz].map(n => n.toFixed(4)).join(',');
      for (const visible of roofs) assert(visible.has(corner), f.kind+' '+corner);
    }
  }
});

test('The pump gallery admits actors and a clear view along the passage, with solid sides and roof', () => {
  const {x,z} = dockFixtures.find(f => f.kind === 'pumpHouse');
  const aisle = x+1.45;
  for (let dz=-3.5; dz<=3.5; dz+=.25) assert(walkable(aisle,z+dz,.60));
  for (const y of [1.61,2.67]) assert.equal(obstruction([aisle,y,z-3.6],[aisle,y,z+3.6]), Infinity);
  assert.equal(raycastMaterial([aisle,1.61,z],[x-2,1.61,z]).mat,'concrete');
  const roof = raycastMaterial([aisle,1.61,z],[aisle,5,z]);
  assert.equal(roof.mat,'steel');
  assert.equal(roof.point[1],3.38);
});

test('Every team start can reach the opposing team and the pickup apron on each supply tanker', () => {
  const nav = new WharfNavigation(), starts = teams.flat();
  for (const [x,z] of starts) assert(walkable(x,z,.6));
  for (const start of starts) {
    for (const goal of starts) assert(nav.route(start,goal).length > 0);
    for (const tanker of tankers) {
      const target = [tanker.x+tanker.w/2+.9,tanker.z];
      assert(walkable(...target,.6));
      const path = nav.route(start,target);
      assert(path.length > 0);
      assert(Math.hypot(path.at(-1)[0]-tanker.x,path.at(-1)[1]-tanker.z) < tanker.radius);
    }
  }
});
