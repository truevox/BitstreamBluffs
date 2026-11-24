/**
 * One compact jukebox strip for Title, Pause and Game Over.
 * Read-only playlist state comes from the game's ONE StemMusicDirector.
 * Playback buttons invoke AudioSynth's canonical transport, not a second
 * audio context. Optional queue expands on click, leaving the game UI
 * unobstructed unless the user specifically asks for history/upcoming.
 */
import Phaser from 'phaser';
import {REG} from '../constants.js';
import {Panel} from './Panel.js';
import {Button} from './Button.js';
import {NeonText} from './Neon.js';
import {ellipsize} from './PixelFont.js';
import {isReducedMotion} from './Motion.js';
import { cosmeticRandom } from '../systems/CosmeticRandom.js';

/**
 * Compact cabinet variant (Title): 102x30, an animated level meter beside the song name, and four glyph
 * keys (<<, play/pause, >>, queue) instead of the word buttons. Same transport, same queue, same bounds
 * contract; Pause and Game Over keep the default 141x31 strip.
 */
export const JUKEBOX_COMPACT=Object.freeze({w:102,h:30,keyW:23,keyH:13,keyGap:2});

export class JukeboxHUD {
	/** @param {Phaser.Scene} scene @param {Theme} theme
	 * @param {{x?:number,y?:number,variant?:'default'|'compact',queueAt?:{x:number,y:number},depth?:number}} opts
	 *   queueAt: top-left of the expanded queue panel (default 245,94).
	 */
	constructor(scene,theme,{x=335,y=61,variant='default',queueAt=null,depth=320}={}){
		this.scene=scene;
		this.theme=theme;
		this.audio=scene.registry.get(REG.AUDIO);
		this.compact=variant==='compact';
		const w=this.compact?JUKEBOX_COMPACT.w:141;
		const h=this.compact?JUKEBOX_COMPACT.h:31;
		// Scene-level tap-to-retry cannot rely solely on Phaser's
		// pointerover array: overlapping UI/backdrops can briefly report
		// zero interactive objects during a real queue click.
		this.bounds={x,y,w,h};
		this.queueBounds={x:queueAt?queueAt.x:245,y:queueAt?queueAt.y:94,w:230,h:93};
		this.depth=depth;
		this.panel=new Panel(scene,theme,{
			x,y,w,h,fillAlpha:this.compact?.66:.88,color:'cyan',
		}).setDepth(depth);
		this.now=new NeonText(scene,theme,this.compact?15:4,2,'MUSIC / READY',{
			color:'cyan',outline:'none',
		});
		this.panel.add(this.now);
		this.labels=this.compact?
			{prev:'<<',play:'▶',pause:'II',next:'>>',list:'▼'}:
			{prev:'PREV',play:'PLAY',pause:'PAUSE',next:'NEXT',list:'LIST'};
		const defs=[
			{label:this.labels.prev,fn:()=>this._action('previous')},
			{label:this.labels.play,fn:()=>this._action('toggle')},
			{label:this.labels.next,fn:()=>this._action('next')},
			{label:this.labels.list,fn:()=>this._toggleQueue()},
		];
		const K=JUKEBOX_COMPACT;
		this.buttons=defs.map((item,i)=>new Button(scene,theme,this.compact?{
			x:3+i*(K.keyW+K.keyGap),y:h-K.keyH-3,w:K.keyW,h:K.keyH,label:item.label,
			color:i===1?'lime':i===3?'magenta':'cyan',onClick:item.fn,parent:this.panel,
		}:{
			x:2+i*35,y:14,w:33,h:14,label:item.label,
			color:i===1?'lime':'cyan',onClick:item.fn,parent:this.panel,
		}));
		// compact: a five-bar level meter left of the song name, bouncing while music plays
		this.meter=null;
		this.playing=false;
		if(this.compact){
			this.meter=new Phaser.GameObjects.Graphics(scene);
			this.panel.add(this.meter);
			this._meterTimer=scene.time.addEvent({
				delay:110,loop:true,callback:()=>this._paintMeter(),
			});
		}
		this.queue=null;
		this._last='';
		this._closed=false;
		this._timer=scene.time.addEvent({
			delay:300,loop:true,callback:()=>this.refresh(),
		});
		this.refresh();
	}

	_action(command){
		if(this._closed||!this.audio)return;
		try {
			const state=this.audio.jukeboxSnapshot().state;
			if(command==='toggle'){
				if(state==='playing'||state==='loading')this.audio.jukeboxPause();
				else this.audio.jukeboxPlay();
			}else this.audio.jukeboxStep(command==='previous'?-1:1);
		}catch(e){/* unavailable audio stays silent; never breaks menu */}
		this.refresh();
	}

	/** Conservative ownership of a tap on jukebox or its open queue.
	 * Coordinates are Phaser GAME coordinates, never CSS pixel offsets.
	 * Only Game Over's background-tap retry uses this explicit guard.
	 */
	ownsPointer(pointer){
		if(this._closed||!pointer)return false;
		const x=Number(pointer.x),y=Number(pointer.y);
		if(!Number.isFinite(x)||!Number.isFinite(y))return false;
		const inside=rect=>x>=rect.x&&x<=rect.x+rect.w&&
			y>=rect.y&&y<=rect.y+rect.h;
		return inside(this.bounds)||(!!this.queue&&inside(this.queueBounds));
	}

	_toggleQueue(){
		if(this.queue){
			this.queue.destroy();
			this.queue=null;
			return;
		}
		const scene=this.scene,theme=this.theme;
		const Q=this.queueBounds;
		const expanded=new Panel(scene,theme,{
			x:Q.x,y:Q.y,w:230,h:93,title:'JUKEBOX / QUEUE',
			color:'cyan',fillAlpha:.96,
		}).setDepth(this.depth+15);
		// Block Game-Over's background tap-to-retry while queue is open.
		const backdrop=new Phaser.GameObjects.Zone(scene,0,0,230,93)
			.setOrigin(0,0).setInteractive();
		expanded.add(backdrop);
		const names=[
			['last',20,'LAST:'],
			['now',34,'NOW:'],
			['next',48,'NEXT:'],
			['after',62,'THEN:'],
			['hint',77,'PLAY / PAUSE / BACK / SKIP ABOVE'],
		];
		this.queueTexts={};
		for(const [key,y,label] of names){
			const line=new NeonText(scene,theme,8,y,label,{
				color:key==='now'?'lime':key==='hint'?'text':'cyan',
				outline:'none',
			});
			if(key==='hint')line.setAlpha(.55);
			expanded.add(line);
			this.queueTexts[key]=line;
		}
		this.queue=expanded;
		this.refresh();
	}

	refresh(){
		if(this._closed)return;
		const state=this.audio?.jukeboxSnapshot?.()||{
			state:'stopped',current:null,previous:null,upcoming:[],
		};
		const name=state.current?.title||'NO MUSIC';
		const mode=state.state==='playing'?'ON ':state.state==='loading'?'... ':
			state.state==='paused'?'II ':'> ';
		this.playing=state.state==='playing';
		const label=this.compact?ellipsize(name.toUpperCase(),JUKEBOX_COMPACT.w-19):
			mode+ellipsize(name.toUpperCase(),119);
		if(label!==this._last){
			this._last=label;
			this.now.setText(label);
		}
		const available=state.current!==null;
		this.buttons[0].setDisabled(!available);
		this.buttons[1].setDisabled(!available);
		this.buttons[2].setDisabled(!available);
		this.buttons[1].setLabel(state.state==='playing'||state.state==='loading'?
			this.labels.pause:this.labels.play);
		if(!this.queue)return;
		const entries={
			last:'LAST: '+(state.previous?.title||'--'),
			now:'NOW: '+(state.current?.title||'SILENCE')+
				' ['+state.state.toUpperCase()+']',
			next:'NEXT: '+(state.upcoming?.[0]?.title||'--'),
			after:'THEN: '+(state.upcoming?.[1]?.title||'--'),
		};
		for(const [key,value] of Object.entries(entries))
			this.queueTexts[key].setText(ellipsize(value.toUpperCase(),211));
	}

	/** Compact level meter: five 2px bars, random heights while playing, a flat line otherwise. */
	_paintMeter(){
		const g=this.meter;
		if(this._closed||!g||!g.scene)return;
		const pal=this.theme.pal;
		g.clear();
		const still=!this.playing||isReducedMotion(this.scene);
		for(let i=0;i<5;i++){
			const hgt=still?(this.playing?[3,5,4,6,3][i]:1):1+Math.floor(cosmeticRandom('ui/jukebox').next()*7);
			g.fillStyle(i<2?pal.lime:i<4?pal.cyan:pal.magenta,this.playing?.95:.45);
			g.fillRect(3+i*2,10-hgt,1,hgt);
		}
	}

	destroy(){
		if(this._closed)return;
		this._closed=true;
		this._timer?.remove();
		this._meterTimer?.remove();
		this.queue?.destroy();this.queue=null;
		this.panel?.destroy();this.panel=null;
	}
}
