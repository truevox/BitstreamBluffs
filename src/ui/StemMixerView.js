/** Isolated in-game Music Lab six-role audition mixer.
 * Pointer + keyboard/gamepad controls. All values exist only in the
 * SoundLabView's ephemeral sandbox director, never persisted to the game.
 */
import Phaser from 'phaser';
import {Panel} from './Panel.js';
import {Button} from './Button.js';
import {NeonText} from './Neon.js';
import {LAB_STEMS,LAB_MIX_PRESETS,labGainFor} from '../systems/music/LabStemMix.js';

export class StemMixerView {
  constructor(scene,theme,{lab,onClose}){
    this.scene=scene;this.theme=theme;this.labView=lab;this.onClose=onClose;
    this.alive=true;this.selected=0;
    this.panel=new Panel(scene,theme,{x:6,y:7,w:468,h:253,
      title:'STEM MIXER // LAB SANDBOX ONLY',color:'cyan',fillAlpha:1})
      .setDepth(560);
    const shield=new Phaser.GameObjects.Zone(scene,0,0,468,253)
      .setOrigin(0,0).setInteractive();
    this.panel.add(shield);
    this.panel.add(new NeonText(scene,theme,12,25,
      '5 INSTRUMENT STEMS + BIOME MELODY / NOTES = PLAYHEAD',
      {color:'cyan',outline:'none'}));
    this.panel.add(new NeonText(scene,theme,12,37,
      'SOLO IS TEMPORARY. BOOST MAY INCREASE MIX LOUDNESS.',
      {color:'text',outline:'none'}).setAlpha(.72));
    this.roleLabels=[];
    this.rows=[];
    for(let i=0;i<LAB_STEMS.length;i++){
      const role=LAB_STEMS[i],y=54+i*25;
      const name=new NeonText(scene,theme,12,y+4,role.toUpperCase(),
        {color:'lime',outline:'none'});
      this.panel.add(name);this.roleLabels.push(name);
      const create=(x,w,label,action,color='cyan')=>new Button(scene,theme,{
        x,y,w,h:18,label,color,parent:this.panel,
        onClick:()=>{this.selected=i;action();this.refresh();},
      });
      const solo=create(87,47,'SOLO',()=>this.toggleSolo(role),'magenta');
      const buttons=LAB_MIX_PRESETS.map((preset,j)=>
        create([139,197,255,320][j],[53,53,60,60][j],
          ['MUTE','DUCK','1.0x','BOOST'][j],
          ()=>this.setLevel(role,preset.gain),
          ['magenta','amber','cyan','lime'][j]));
      const level=new NeonText(scene,theme,386,y+4,'1.00x',
        {color:'amber',outline:'none'});
      this.panel.add(level);
      this.rows.push({solo,buttons,level});
    }
    this.status=new NeonText(scene,theme,12,209,'',
      {color:'cyan',outline:'none'});this.panel.add(this.status);
    this.hint=new NeonText(scene,theme,12,222,
      'UP/DOWN STEM  LEFT/RIGHT LEVEL  CONFIRM SOLO',
      {color:'text',outline:'none'});this.panel.add(this.hint);
    this.reset=new Button(scene,theme,{x:12,y:235,w:135,h:14,
      label:'RESET ALL LEVELS',color:'amber',parent:this.panel,
      onClick:()=>this.resetAll()});
    this.clearSolo=new Button(scene,theme,{x:152,y:235,w:91,h:14,
      label:'CLEAR SOLO',color:'cyan',parent:this.panel,
      onClick:()=>{this.labView._solo('ALL');this.refresh();}});
    this.back=new Button(scene,theme,{x:390,y:233,w:68,h:16,
      label:'BACK',color:'magenta',parent:this.panel,onClick:()=>this.close()});
    this.refresh();
  }

  setLevel(role,gain){
    if(!LAB_STEMS.includes(role)||!LAB_MIX_PRESETS.some(p=>p.gain===gain))return;
    this.labView._setStemLevel(role,gain);
    this.refresh();
  }
  toggleSolo(role){
    if(!LAB_STEMS.includes(role))return;
    this.labView._solo(this.labView.solo===role.toUpperCase()?
      'ALL':role.toUpperCase());
    this.refresh();
  }
  resetAll(){
    this.labView._resetStemMix();
    this.refresh();
  }
  refresh(){
    if(!this.alive)return;
    const lab=this.labView;
    const levels=lab.mixLevels||{};
    for(let i=0;i<LAB_STEMS.length;i++){
      const role=LAB_STEMS[i],row=this.rows[i];
      const own=levels[role]??1;
      const audible=labGainFor(role,levels,lab.solo);
      row.solo.setLabel(lab.solo===role.toUpperCase()?'SOLO*':'SOLO');
      row.level.setText(`${audible.toFixed(2)}x`);
      row.level.setAlpha(audible===0?.43:1);
      this.roleLabels[i].setAlpha(i===this.selected?1:.72);
      for(let j=0;j<row.buttons.length;j++)
        row.buttons[j].setLabel(own===LAB_MIX_PRESETS[j].gain?
          ['MUTE*','DUCK*','1.0x*','BOOST*'][j]:
          ['MUTE','DUCK','1.0x','BOOST'][j]);
    }
    const selected=LAB_STEMS[this.selected];
    this.status.setText(`${selected.toUpperCase()} ${(levels[selected]??1).toFixed(2)}x`+
      `  /  SOLO ${lab.solo}  /  UNSAVED LAB MIX`);
  }
  handleAction(action){
    if(action==='cancel'){this.close();return true;}
    if(action==='up'||action==='down'){
      this.selected=(this.selected+(action==='down'?1:-1)+LAB_STEMS.length)%LAB_STEMS.length;
      this.refresh();return true;
    }
    if(action==='left'||action==='right'){
      const role=LAB_STEMS[this.selected];
      const level=this.labView.mixLevels[role]??1;
      const index=LAB_MIX_PRESETS.findIndex(p=>p.gain===level);
      const next=Math.max(0,Math.min(LAB_MIX_PRESETS.length-1,
        (index<0?2:index)+(action==='left'?-1:1)));
      this.setLevel(role,LAB_MIX_PRESETS[next].gain);return true;
    }
    if(action==='confirm'||action==='alt'){
      this.toggleSolo(LAB_STEMS[this.selected]);return true;
    }
    return true;
  }
  close(){if(this.alive)this.onClose();}
  destroy(){if(!this.alive)return;this.alive=false;this.panel.destroy();this.panel=null;}
}
