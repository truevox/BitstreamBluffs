/** Issue #253: fail if either real marker is ever handed the mutating heightFn. */
import { readFileSync } from 'node:fs';
import { BestMarker } from '../../src/entities/BestMarker.js';
import { LastDeathMarker } from '../../src/entities/LastDeathMarker.js';
import { joinedMarkerHeight } from '../../src/systems/MarkerLayout.js';

function fakeDrawObject() {
  return {
    visible:false, text:'',
    setDepth(){return this;}, setOrigin(){return this;}, setVisible(v){this.visible=v;return this;},
    setPosition(){return this;}, setColor(){return this;}, setText(t){this.text=t;return this;},
    lineStyle(){return this;}, lineBetween(){return this;}, clear(){return this;},
    fillStyle(){return this;}, fillRect(){return this;}, destroy(){return this;},
  };
}
const scene={add:{graphics:fakeDrawObject,text:fakeDrawObject}};
const palette={lime:0x00ff00,amber:0xffff00,danger:0xff0000};
const points=(startX, ys) => ({
  startX,endX:startX+1600,points:ys.map((y,i)=>({x:startX+i*800,y})),
});

test('RunScene wires both marker update methods exclusively to joined collision geometry',()=>{
  const source=readFileSync(new URL('../../src/scenes/RunScene.js',import.meta.url),'utf8');
  expect(source).toMatch(/this\.markerHeightFn\s*=\s*\(x\)\s*=>\s*joinedMarkerHeight\(x,\s*this\.mesh\.chunks\)/);
  expect(source).toMatch(/this\.bestMarker\.update\(t,\s*sled\.x,\s*this\.markerHeightFn\)/);
  expect(source).toMatch(/this\.deathMarker\.update\(t,\s*sled\.x,\s*this\.markerHeightFn\)/);
  expect(source).not.toMatch(/this\.(?:bestMarker|deathMarker)\.update\([^;]*this\.heightFn/);
});

test.each([['BEST',BestMarker],['DIED HERE',LastDeathMarker]])('%s actual marker defers outside joined mesh then draws at exact joined height without terrain generator call',(_name,Marker)=>{
  const marker=new Marker(scene,palette,4500,225);
  const joined=new Map([[0,points(0,[400,500,600])]]);
  const generator={_lastChunk:Symbol('left-neighbor'),_pendingAdded:[],activeList:[],
    heightAt:()=>{throw Error('CRITICAL: marker invoked mutating TerrainGenerator.heightAt');}};
  const firstCache=generator._lastChunk;
  const heightFn=(x)=>joinedMarkerHeight(x,joined);
  // The marker is within 2600px lookahead but no chunk is physically joined there.
  marker.update(1000,2000,heightFn);
  expect(marker.y).toBeNull(); expect(marker.label.visible).toBe(false);
  expect(generator._lastChunk).toBe(firstCache);
  joined.set(2,points(3200,[900,1100,1300]));
  marker.update(1000,2000,heightFn);
  expect(marker.y).toBe(1225);expect(marker.label.visible).toBe(true);
  expect(generator._lastChunk).toBe(firstCache);
  expect(generator._pendingAdded).toHaveLength(0);
  expect(generator.activeList).toHaveLength(0);
});
