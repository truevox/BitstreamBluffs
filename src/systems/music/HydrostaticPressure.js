/**
 * Underwater Mountain pressure-memory policy. Reads authoritative terrain and
 * rider state only; never changes simulation, score, or soundtrack timing.
 * World Y is positive-down. Only a confirmed biome exit resets a high-water mark.
 */
const bounded = (x,lo,hi) => Math.min(hi,Math.max(lo,x));
const finite = x => typeof x === 'number' && Number.isFinite(x);

export class HydrostaticPressure {
	constructor({depthScalePx=460,reliefDepth=.90}={}) {
		this.depthScalePx = finite(depthScalePx) && depthScalePx > 0 ? depthScalePx : 460;
		this.reliefDepth = finite(reliefDepth) ? bounded(reliefDepth,0,.95) : .78;
		this.reset();
	}

	reset() {
		this.entryTerrainY = null;
		this.deepestTerrainDescentPx = 0;
		this.storedPressure01 = 0;
		this.audiblePressure01 = 0;
		this.jumpRelief01 = 0;
		this.last = Object.freeze({valid:false, initialized:false,
			deepestTerrainDescentPx:0,storedPressure01:0,
			jumpRelief01:0,audiblePressure01:0});
		return this.last;
	}

	/** Invalid/partial samples hold the last known pressure, never invent depth. */
	update({terrainY,riderY,vy,grounded}={}) {
		if (!finite(terrainY)) return this.last;
		if (this.entryTerrainY === null) this.entryTerrainY = terrainY;
		// Terrain high-water mark; rider's altitude is NEVER accumulated.
		this.deepestTerrainDescentPx = Math.max(this.deepestTerrainDescentPx,
			Math.max(0,terrainY-this.entryTerrainY));
		this.storedPressure01 = bounded(1-Math.exp(-this.deepestTerrainDescentPx/this.depthScalePx),0,1);
		// Jump relief is temporary. Upward speed quickly lifts the pressure;
		// descent restores it; touchdown sets relief exactly zero.
		let relief = 0;
		if (grounded === false && finite(riderY) && finite(vy)) {
			const height = bounded((terrainY-riderY)/170,0,1);
			const ascending = bounded(-vy/420,0,1);
			const falling = bounded(vy/390,0,1);
			relief = bounded(Math.max(height*.55,ascending*.80)*(1-falling*.93),0,1);
		}
		this.jumpRelief01 = relief;
		this.audiblePressure01 = this.storedPressure01 * (1-this.reliefDepth*relief);
		this.last = Object.freeze({valid:true,initialized:true,
			deepestTerrainDescentPx:this.deepestTerrainDescentPx,
			storedPressure01:this.storedPressure01,
			jumpRelief01:relief,
			audiblePressure01:this.audiblePressure01});
		return this.last;
	}
}
