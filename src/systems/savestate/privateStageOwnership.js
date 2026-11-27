/**
 * #119 private, one-shot application-owned RunScene staging gate.
 *
 * No player-facing API, score authority or ability to restore bytes here.
 * Title owns this local, per-Phaser-Game capability. A queued SceneManager
 * create consumes it exactly once; normal RunScene starts never see it.
 * Never publish tokens through a registry or scene-start data descriptor.
 */
const pending=new WeakMap();

export function armPrivateRunSceneStage(game) {
 if(!game||typeof game!=='object'||pending.has(game))
  throw Error('suspend-stage:already-armed-or-invalid-game');
 if(!game.scene?.isActive?.('TitleScene')||game.scene.isActive('RunScene'))
  throw Error('suspend-stage:title-required');
 let resolveReady,rejectReady,settled=false;
 const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 ready.catch(()=>{});
 const record=Object.freeze({
  accept(run){if(settled)return;settled=true;resolveReady(run);},
  fail(error){if(settled)return;settled=true;rejectReady(error instanceof Error?error:Error(String(error)));},
 });
 pending.set(game,record);
 return Object.freeze({
  ready,
  cancel(){
   if(pending.get(game)===record)pending.delete(game);
   record.fail(Error('suspend-stage:cancelled'));
  },
 });
}

/** Called ONLY from RunScene.create(), never from saved data or Title view. */
export function takePrivateRunSceneStage(game) {
 const stage=pending.get(game)||null;
 if(stage)pending.delete(game);
 return stage;
}
