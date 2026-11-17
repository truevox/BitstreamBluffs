/**
 * Score inspector INSIDE the game, over the actual StemMusicDirector lab.
 * Draws unverified SOURCE candidates (not the actual waveform / gold notes).
 *
 * Any edit is an isolated, exported PATCH, NOT a live music correction.
 * The game's audio, saved profile, settings and base performance.json stay
 * byte-for-byte untouched. Music Lab remains the source of the real clock.
 */
import Phaser from 'phaser';
import { Panel } from './Panel.js';
import { Button } from './Button.js';
import { MenuList } from './MenuList.js';
import { NeonText } from './Neon.js';
import { ellipsize } from './PixelFont.js';
import { ScoreCorrectionDraft } from '../systems/music/ScoreCorrectionDraft.js';
import { nearbyPerformanceEvents } from '../systems/music/PerformanceScore.js';

const RATE=48000;
const HALF_WINDOW=2*RATE;
const GRAPH={x:41,y:51,w:409,h:105};
const ROLES=['melody','bass','drums','guitar','piano','other'];
const DRUMS=['kick','snare','hat','tom','cymbal'];
const noteName=n=>['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n%12]+
	(Math.floor(n/12)-1);
const ms=x=>Math.round(x/RATE*1000);

export class ScoreInspectorView {
	constructor(scene,theme,{lab,onClose,draft}){
		if(!lab?.score||!lab?.lab?.pack)throw new Error('No verified source score to inspect');
		this.scene=scene;
		this.theme=theme;
		this.labView=lab;
		this.score=lab.score;
		this.draft=draft||new ScoreCorrectionDraft(this.score);
		if(this.draft.scoreHash!==this.score.scoreHash)
			throw new Error('Cannot inspect patches for different source version');
		this.onClose=onClose;
		this.alive=true;
		this.role=ROLES.includes(lab.solo.toLowerCase())?
			lab.solo.toLowerCase():lab.score.featuredStem;
		this.anchorFrame=lab._clockFrame()||0;
		this.follow=true;
		this.selectedId=null;
		this.message='TENTATIVE NOTES. NO EDITS ARE APPLIED TO MUSIC.';
		this.windowStart=0;
		this._hitBoxes=[];
		this.panel=new Panel(scene,theme,{
			x:6,y:7,w:468,h:253,title:'SCORE INSPECTOR  //  DRAFT ONLY',
			color:'amber',fillAlpha:1,
		}).setDepth(560);
		// Prevent hidden parent Music Lab buttons from handling pointer
		// events in the inspector's blank areas.
		const shield=new Phaser.GameObjects.Zone(scene,0,0,468,253)
			.setOrigin(0,0).setInteractive();
		this.panel.add(shield);

		this.menu=new MenuList(scene,theme,{
			x:10,y:23,w:446,rowH:18,color:'amber',parent:this.panel,
			items:[{kind:'choice',label:'INSTRUMENT ROLE',options:
				ROLES.map(role=>({value:role,label:role.toUpperCase()})),
				get:()=>this.role,set:role=>this.setRole(role)}],
		});

		this.graph=new Phaser.GameObjects.Graphics(scene);
		this.graph.setPosition(GRAPH.x,GRAPH.y);
		this.panel.add(this.graph);
		this.hitArea=new Phaser.GameObjects.Zone(scene,
			GRAPH.x,GRAPH.y,GRAPH.w,GRAPH.h).setOrigin(0,0).setInteractive(
				{useHandCursor:true});
		this.panel.add(this.hitArea);
		this.hitArea.on('pointerdown',(pointer,x,y)=>this.pick(x,y));

		this.windowLabel=new NeonText(scene,theme,10,161,'',{
			color:'cyan',outline:'none',
		});
		this.panel.add(this.windowLabel);
		this.detailLine=new NeonText(scene,theme,10,172,'',{
			color:'amber',outline:'none',
		});
		this.panel.add(this.detailLine);
		this.helpLine=new NeonText(scene,theme,10,184,'',{
			color:'text',outline:'none',
		});
		this.panel.add(this.helpLine);
		this.messageLine=new NeonText(scene,theme,10,195,'',{
			color:'magenta',outline:'none',
		});
		this.panel.add(this.messageLine);
		const control=(x,y,w,label,fn,color='cyan')=>{
			return new Button(scene,theme,{x,y,w,h:15,label,
				onClick:fn,color,parent:this.panel});
		};
		this.controls={
			prev:control(10,210,57,'< NOTE',()=>this.shift(-1)),
			next:control(71,210,57,'NOTE >',()=>this.shift(1)),
			early:control(132,210,54,'-10MS',()=>this.modify('nudge',-480)),
			late:control(190,210,54,'+10MS',()=>this.modify('nudge',480)),
			down:control(248,210,54,'-OCT',()=>this.modify('octave',-12)),
			up:control(306,210,54,'+OCT',()=>this.modify('octave',12)),
			hear:control(364,210,87,'HEAR STEM',()=>this.hear()),
			reject:control(10,233,66,'REJECT',()=>this.modify('reject'), 'magenta'),
			accept:control(81,233,66,'ACCEPT',()=>this.modify('accept'), 'lime'),
			undo:control(152,233,62,'UNDO',()=>this.modify('undo'), 'amber'),
			export:control(219,233,108,'EXPORT PATCH',()=>this.exportPatch()),
			follow:control(332,233,53,'FOLLOW',()=>this.toggleFollow()),
		};
		this.back=control(390,231,68,'BACK',()=>this.close(),'magenta');
		this._paletteUnbind=theme.bind(()=>this.refresh());
		this.refresh();
	}

	setRole(role){
		if(!ROLES.includes(role))return;
		this.role=role;
		this.selectedId=null;
		this._selectNearest();
		this.message='CHANGED ROLE. SOURCE ESTIMATES ARE NOT GOLD NOTES.';
		this.refresh();
	}

	_clock(){
		return this.labView?._clockFrame()??this.anchorFrame;
	}

	_events(){
		return this.score.events[this.role]||[];
	}

	_selectNearest(){
		const events=this._events();
		if(!events.length){this.selectedId=null;return;}
		const frame=this.anchorFrame;
		let low=0,high=events.length;
		while(low<high){
			const mid=(low+high)>>1;
			if(events[mid].startFrame<frame)low=mid+1;
			else high=mid;
		}
		const idx=low===0?0:low===events.length?events.length-1:
			Math.abs(events[low].startFrame-frame)<
				Math.abs(events[low-1].startFrame-frame)?low:low-1;
		this.selectedId=events[idx].id;
	}

	_selected(){
		const events=this._events();
		return events.find(event=>event.id===this.selectedId)||null;
	}

	_preview(event){
		return this.draft.preview(event.id)||event;
	}

	/** Move to the previous/next source event (not a guessed beat). */
	shift(direction){
		const events=this._events();
		if(!events.length)return;
		const current=events.findIndex(e=>e.id===this.selectedId);
		const next=(current<0?0:Math.max(0,Math.min(events.length-1,
			current+(direction<0?-1:1))));
		this.selectedId=events[next].id;
		this.anchorFrame=events[next].startFrame;
		this.follow=false;
		this.message='SOURCE EVENT SELECTED; AUDIO NOT CHANGED.';
		this.refresh();
	}

	pick(x,y){
		if(!this._hitBoxes.length)return;
		let best=null,score=Infinity;
		for(const rect of this._hitBoxes){
			// Pointer is local to the rectangle; choose closest note.
			const dx=Math.max(0,rect.x-x,x-(rect.x+rect.w));
			const dy=Math.max(0,rect.y-y,y-(rect.y+rect.h));
			const distance=dx*dx+dy*dy;
			if(distance<score){score=distance;best=rect;}
		}
		if(!best||score>100)return;
		this.selectedId=best.id;
		this.anchorFrame=this.draft.preview(best.id).startFrame;
		this.follow=false;
		this.message='SOURCE EVENT SELECTED; USE +10MS/-10MS OR OCTAVE.';
		this.refresh();
	}

	modify(action,amount=0){
		const event=this._selected();
		if(!event)return;
		if(!this.draft.modify(event.id,action,amount)){
			this.message='INVALID EDIT: FRAME/PITCH LIMIT OR NEIGHBOR ORDER.';
			this.refresh();return;
		}
		this.follow=false;
		this.message=action.toUpperCase()+
			' DRAFT ONLY. EXPORT PATCH TO KEEP THIS CORRECTION.';
		this.refresh();
	}

	hear(){
		const event=this._selected();
		if(!event||!this.labView?.lab?.pack)return;
		const frame=this.draft.preview(event.id).startFrame;
		// A transcription guess is NOT a soloable sound. Listen to its
		// instrument ROLE via the actual game mixer, honoring the current
		// Dynamic Orchestra source/replacement setting. This is not an
		// invented single-note audition or the old standalone lab.
		this.labView._solo(this.role.toUpperCase());
		this.labView.lab.seekTo(Math.max(0,(frame/RATE)-.18));
		this.message='REAL GAME ROLE SOLOED AND SEEKED NEAR THE ATTACK.';
		this.refresh();
	}

	toggleFollow(){
		this.follow=!this.follow;
		if(this.follow)this.anchorFrame=this._clock();
		this.message=this.follow?'FOLLOWING LIVE WEB AUDIO CLOCK':
			'VIEW FIXED TO SELECTED CANDIDATES';
		this.refresh();
	}

	exportPatch(){
		const data=this.draft.export();
		if(!data||typeof document==='undefined')return;
		const blob=new Blob([JSON.stringify(data,null,2)+'\n'],
			{type:'application/json'});
		const url=URL.createObjectURL(blob);
		try{
			const link=document.createElement('a');
			link.href=url;
			link.download='bitstream-candidate-fixes-'+this.score.songId+
				'-'+this.score.scoreHash.slice(0,10)+'.json';
			document.body.appendChild(link);
			link.click();
			link.remove();
		}finally{
			setTimeout(()=>URL.revokeObjectURL(url),10000);
		}
		this.message='PATCH EXPORTED. MUSIC AND SAVE ARE STILL UNCHANGED.';
		this.refresh();
	}

	/** Draw only a four-second viewport, even for full 3-minute songs. */
	refresh(){
		if(!this.alive)return;
		if(this.follow)this.anchorFrame=this._clock();
		if(!this._selected())this._selectNearest();
		this.windowStart=Math.max(0,Math.min(
			this.score.frameCount-2*HALF_WINDOW,
			this.anchorFrame-HALF_WINDOW));
		const g=this.graph,pal=this.theme.pal;
		g.clear();
		g.fillStyle(pal.bg,1);
		g.fillRect(0,0,GRAPH.w,GRAPH.h);
		g.lineStyle(1,pal.text,.11);
		for(let i=1;i<4;i++){
			g.lineBetween(i*GRAPH.w/4,0,i*GRAPH.w/4,GRAPH.h);
		}
		let events=nearbyPerformanceEvents(this.score,[this.role],
			this.windowStart+HALF_WINDOW,HALF_WINDOW);
		// A role's events are original-source hypotheses, not rendered
		// audio transients. The viewed clock is the real game's clock.
		this._hitBoxes=[];
		const pitches=events.filter(e=>e.event.pitch!==undefined).map(e=>e.event.pitch);
		const sorted=pitches.slice().sort((a,b)=>a-b);
		const median=sorted.length?sorted[Math.floor(sorted.length/2)]:60;
		const minPitch=Math.max(0,Math.min(103,median-11));
		const maxPitch=minPitch+23;
		const roleDrums=this.role==='drums';
		const yFor=e=>{
			if(roleDrums){
				const lane=DRUMS.indexOf(e.class);
				return Math.max(2,Math.min(GRAPH.h-11,
					2+(lane<0?4:lane)*(GRAPH.h-4)/5));
			}
			return 2+(maxPitch-e.pitch)*(GRAPH.h-4)/24;
		};
		if(roleDrums){
			g.lineStyle(1,pal.cyan,.16);
			for(let lane=1;lane<5;lane++){
				g.lineBetween(0,lane*GRAPH.h/5,GRAPH.w,lane*GRAPH.h/5);
			}
		}else{
			g.lineStyle(1,pal.cyan,.08);
			for(let p=minPitch;p<=maxPitch;p+=12){
				const y=2+(maxPitch-p)*(GRAPH.h-4)/24;
				g.lineBetween(0,y,GRAPH.w,y);
			}
		}
		for(const {event} of events){
			const adjusted=this._preview(event);
			if(adjusted.status==='reject')continue;
			const x=(adjusted.startFrame-this.windowStart)/
				(2*HALF_WINDOW)*GRAPH.w;
			if(x<0||x>=GRAPH.w)continue;
			const y=yFor(adjusted);
			if(y<0||y>=GRAPH.h-4)continue;
			const width=roleDrums?3:Math.max(3,Math.min(120,
				(adjusted.endFrame-adjusted.startFrame)/
				(2*HALF_WINDOW)*GRAPH.w));
			const height=roleDrums?11:4;
			const selected=event.id===this.selectedId;
			const color=selected?pal.amber:
				this.draft.edits.has(event.id)?pal.magenta:pal.cyan;
			g.fillStyle(color,selected?1:.7);
			g.fillRect(x,y,width,height);
			this._hitBoxes.push({id:event.id,x,y,w:width,h:height});
		}
		const clockX=(this._clock()-this.windowStart)/
			(2*HALF_WINDOW)*GRAPH.w;
		if(clockX>=0&&clockX<=GRAPH.w){
			g.lineStyle(1,pal.lime,.9);
			g.lineBetween(clockX,0,clockX,GRAPH.h);
		}
		g.lineStyle(1,pal.cyan,.5);
		g.strokeRect(.5,.5,GRAPH.w-1,GRAPH.h-1);
		const a=Math.floor(this.windowStart/RATE*10)/10;
		const b=Math.ceil((this.windowStart+2*HALF_WINDOW)/RATE*10)/10;
		this.windowLabel.setText(ellipsize(
			this.role.toUpperCase()+'  '+a.toFixed(1)+'-'+b.toFixed(1)+
			'S  /  VERTICAL = '+(roleDrums?'DRUM CLASS':'MIDI PITCH')+
			'  /  GREEN = LIVE AUDIO CLOCK',443));
		const event=this._selected();
		const preview=event&&this._preview(event);
		const desc=preview?(this.role.toUpperCase()+'  '+
			(roleDrums?preview.class.toUpperCase():
				noteName(preview.pitch)+' ('+preview.pitch+')')+
			' @'+(preview.startFrame/RATE).toFixed(3)+'S  '+
			event.id.slice(0,12)+'  '+preview.status.toUpperCase()):
			'NO SOURCE CANDIDATES';
		this.detailLine.setText(ellipsize(desc,446));
		this.helpLine.setText(ellipsize(
			'SELECT A NOTE; SHIFT/OCTAVE/REJECT/ACCEPT ARE PATCH DRAFTS ONLY. ',446));
		this.messageLine.setText(ellipsize(
			this.message+'  ('+this.draft.count+' EDITS)',447));
		this.controls.up.setDisabled(!event||roleDrums);
		this.controls.down.setDisabled(!event||roleDrums);
		this.controls.export.setDisabled(!this.draft.count);
		this.controls.follow.setLabel(this.follow?'FREEZE':'FOLLOW');
	}

	handleAction(action){
		if(action==='cancel'){this.close();return true;}
		if(action==='left'){this.shift(-1);return true;}
		if(action==='right'){this.shift(1);return true;}
		if(action==='up'||action==='down'){
			const index=ROLES.indexOf(this.role);
			this.setRole(ROLES[(index+(action==='up'?-1:1)+ROLES.length)%
				ROLES.length]);
			return true;
		}
		if(action==='confirm'){this.hear();return true;}
		return true;
	}

	close(){
		if(this.alive)this.onClose();
	}

	destroy(){
		if(!this.alive)return;
		this.alive=false;
		this._paletteUnbind?.();
		this.panel.destroy();
		this.panel=null;
	}
}
