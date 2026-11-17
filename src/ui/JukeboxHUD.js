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

export class JukeboxHUD {
	/** @param {Phaser.Scene} scene @param {Theme} theme
	 * @param {{x?:number,y?:number}} opts
	 */
	constructor(scene,theme,{x=335,y=61}={}){
		this.scene=scene;
		this.theme=theme;
		this.audio=scene.registry.get(REG.AUDIO);
		// Scene-level tap-to-retry cannot rely solely on Phaser's
		// pointerover array: overlapping UI/backdrops can briefly report
		// zero interactive objects during a real queue click.
		this.bounds={x,y,w:141,h:31};
		this.queueBounds={x:245,y:94,w:230,h:93};
		this.panel=new Panel(scene,theme,{
			x,y,w:141,h:31,fillAlpha:.88,color:'cyan',
		}).setDepth(320);
		this.now=new NeonText(scene,theme,4,2,'MUSIC / READY',{
			color:'cyan',outline:'none',
		});
		this.panel.add(this.now);
		const defs=[
			{label:'PREV',fn:()=>this._action('previous')},
			{label:'PLAY',fn:()=>this._action('toggle')},
			{label:'NEXT',fn:()=>this._action('next')},
			{label:'LIST',fn:()=>this._toggleQueue()},
		];
		this.buttons=defs.map((item,i)=>new Button(scene,theme,{
			x:2+i*35,y:14,w:33,h:14,label:item.label,
			color:i===1?'lime':'cyan',onClick:item.fn,parent:this.panel,
		}));
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
		const expanded=new Panel(scene,theme,{
			x:245,y:94,w:230,h:93,title:'JUKEBOX / QUEUE',
			color:'cyan',fillAlpha:.96,
		}).setDepth(335);
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
		const label=mode+ellipsize(name.toUpperCase(),119);
		if(label!==this._last){
			this._last=label;
			this.now.setText(label);
		}
		const available=state.current!==null;
		this.buttons[0].setDisabled(!available);
		this.buttons[1].setDisabled(!available);
		this.buttons[2].setDisabled(!available);
		this.buttons[1].setLabel(state.state==='playing'||state.state==='loading'?
			'PAUSE':'PLAY');
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

	destroy(){
		if(this._closed)return;
		this._closed=true;
		this._timer?.remove();
		this.queue?.destroy();this.queue=null;
		this.panel?.destroy();this.panel=null;
	}
}
