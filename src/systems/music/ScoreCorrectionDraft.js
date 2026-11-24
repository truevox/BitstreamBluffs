/**
 * Non-destructive candidate correction queue for the game's source-event
 * inspector. Not live audio, not an accepted gold transcription.
 *
 * All changes are rendered as ONE atomic operation per stable note ID.
 * Offline performance_v1.apply_patch_layer is the sole materializer.
 * A new score hash never inherits corrections without explicit reconciliation.
 */
import { PERFORMANCE_ROLES } from './PerformanceScore.js';

const integer=n=>Number.isSafeInteger(n);
const inRange=(x,lo,hi)=>integer(x)&&x>=lo&&x<=hi;

export class ScoreCorrectionDraft {
	constructor(score){
		if(!score?.scoreHash||!score?.songId)throw new Error('Missing immutable source score');
		this.songId=score.songId;
		this.scoreHash=score.scoreHash;
		this.frameCount=score.frameCount;
		this.original=new Map();
		this.roleEvents=new Map();
		for(const role of PERFORMANCE_ROLES){
			this.roleEvents.set(role,score.events[role]||[]);
			for(const event of score.events[role]||[]){
				if(this.original.has(event.id))throw new Error('Duplicate score event ID');
				this.original.set(event.id,{role,event});
			}
		}
		this.edits=new Map();
	}

	get count(){return this.edits.size;}

	/** Return preview only; never mutate the underlying score. */
	preview(id){
		const original=this.original.get(id);
		if(!original)return null;
		const op=this.edits.get(id);
		const e=original.event;
		return {
			id,role:original.role,
			startFrame:op?.action==='correct'?op.startFrame:e.startFrame,
			endFrame:original.role==='drums'?undefined:
				op?.action==='correct'?op.endFrame:e.endFrame,
			pitch:original.role==='drums'?null:
				op?.action==='correct'?op.pitch:e.pitch,
			class:e.class,
			status:op?.action||'source-candidate',
		};
	}

	/** One edit per ID even if user nudges and changes octave repeatedly. */
	modify(id,action,amount=0){
		const original=this.original.get(id);
		if(!original)return false;
		if(action==='undo'){
			this.edits.delete(id);
			return true;
		}
		if(action==='reject'||action==='accept'){
			this.edits.set(id,{action,id});
			return true;
		}
		if(action!=='nudge'||!integer(amount)) {
			if(action!=='octave'||!integer(amount))return false;
		}
		if(!['nudge','octave'].includes(action))return false;
		const e=original.event, role=original.role;
		if(action==='octave'&&(role==='drums'||Math.abs(amount)!==12))
			return false;
		if(action==='nudge'&&(!amount||Math.abs(amount)>4800))return false;
		const prior=this.preview(id);
		const startFrame=prior.startFrame+(action==='nudge'?amount:0);
		const endFrame=role==='drums'?undefined:
			prior.endFrame+(action==='nudge'?amount:0);
		const pitch=role==='drums'?undefined:
			prior.pitch+(action==='octave'?amount:0);
		if(!inRange(startFrame,0,this.frameCount-1)||(
			role!=='drums'&&(!inRange(endFrame,startFrame+1,this.frameCount)||
				!inRange(pitch,0,127))))return false;
		// Canonical performance events remain monotonically time-ordered.
		// Never export a patch the offline materializer would reject.
		// Simultaneous chords may need a future coordinated group operation.
		const siblings=this.roleEvents.get(role)||[];
		const index=siblings.findIndex(item=>item.id===id);
		for(let i=index-1;i>=0;i--){
			const adjacent=this.preview(siblings[i].id);
			if(adjacent.status==='reject')continue;
			if(adjacent.startFrame>startFrame)return false;
			break;
		}
		for(let i=index+1;i<siblings.length;i++){
			const adjacent=this.preview(siblings[i].id);
			if(adjacent.status==='reject')continue;
			if(adjacent.startFrame<startFrame)return false;
			break;
		}
		// A nudge followed by octave MUST retain both changes.
		if(startFrame===e.startFrame && (
			role==='drums'||(endFrame===e.endFrame&&pitch===e.pitch))){
			this.edits.delete(id);
			return true;
		}
		this.edits.set(id,{id,action:'correct',startFrame,...(
			role==='drums'?{}:{endFrame,pitch})});
		return true;
	}

	/** This JSON is human feedback, not an approved musical release. */
	export(){
		if(!this.edits.size)return null;
		return {
			format:'bitstream-performance-patches-v1',
			status:'draft-unreviewed-not-applied-to-audio',
			songId:this.songId,
			baseScoreHash:this.scoreHash,
			sampleRate:48000,
			operations:[...this.edits.values()],
		};
	}
}
