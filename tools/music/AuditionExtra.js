/** Optional audition-only source-fed bloom, absent at exactly 0%.
 * Adds a filtered, time-dispersed stereo copy of each biome's OWN processed
 * audio, not a louder copy of the whole master. Never changes the source media,
 * gameplay DSP presets, event trigger levels or original dry path.
 */
export function attachAuditionExtra(ctx,processed,master,slider=document.getElementById('extra')) {
	if(!slider || !processed || !master)return {dispose(){}};
	const nodes=[];const create=fn=>{const n=fn();nodes.push(n);return n;};
	const high=create(()=>ctx.createBiquadFilter());high.type='highpass';high.frequency.value=280;
	const low=create(()=>ctx.createBiquadFilter());low.type='lowpass';low.frequency.value=7300;
	const delayed=create(()=>ctx.createDelay(.2));delayed.delayTime.value=.064;
	const wet=create(()=>ctx.createGain());wet.gain.value=0;
	processed.connect(high);high.connect(low);low.connect(delayed);delayed.connect(wet);wet.connect(master);
	const update=()=>{
		const amount=Math.max(0,Math.min(200,Number(slider.value)||0));
		const label=document.getElementById('extra-value');
		if(label)label.textContent=amount+'%';
		// Subtle dispersed second layer at 100%; bounded 0.46 at 200%.
		wet.gain.setTargetAtTime(amount*.0023,ctx.currentTime,.035);
	};
	slider.addEventListener('input',update);update();
	return {dispose(){slider.removeEventListener('input',update);
		try{processed.disconnect(high)}catch{}
		for(const n of nodes)try{n.disconnect()}catch{}}};
}
