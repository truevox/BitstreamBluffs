/** Game Over local percentile/Pareto comparison; no mutation or remote ranking. */
import { View } from './View.js';
import { NeonText } from './Neon.js';
import { ellipsize } from './PixelFont.js';
import { presentLocalRunRankings } from '../systems/local-ranking-presentation.js';

export class LocalRankingsView extends View {
  constructor(scene, theme, { onClose, record }) {
    super(scene, theme, { w: 432, h: 232, title: 'LOCAL RUN COMPARISON', color: 'cyan', onClose });
    this.record = record;
    const text = (x,y,value,color='text',anchor='left') => {
      const t = new NeonText(scene,theme,x,y,value,{color,anchor,outline:'none'});
      this.panel.add(t);return t;
    };
    this.scope = text(14,24,'READING DEVICE HISTORY...','cyan');
    this.summary = text(14,36,'SAME BOARD, COURSE, RULE AND EQUIPMENT.','amber');
    this.hint = text(14,48,'LOCAL HASH IS NOT PLAYER VERIFICATION.');
    text(14,60,'METRIC');text(265,60,'VALUE','text','right');
    text(344,60,'LOCAL %ILE','text','right');text(413,60,'N','text','right');
    this.cells = Array.from({length:7},(_,i)=>{
      const y=74+i*16;
      return {label:text(14,y,'...','cyan'),value:text(265,y,'...','lime','right'),
        percentile:text(344,y,'--','amber','right'),count:text(413,y,'--','text','right')};
    });
    this.frontier = text(14,190,'PARETO: READING...','amber');
    text(14,207,'SAME DEVICE ONLY. DOES NOT CHANGE SCOREBOARDS.');
  }

  showHistory(history) {
    if (!this.alive) return;
    let data;
    try { data = presentLocalRunRankings(history,this.record); }
    catch { this.showFailure();return; }
    if (data.status !== 'ready') { this.showFailure(data.message);return; }
    this.scope.setText(ellipsize(`BOARD: ${data.board.toUpperCase()}   SEED: ${data.seed.toUpperCase()}   MASK: ${data.mask}`,395));
    this.summary.setText(`${data.sampleSize} MATCHING HASH-CHECKED LOCAL RUN${data.sampleSize===1?'':'S'}`);
    this.hint.setText('LOCAL MIDRANK; NOT A GLOBAL PERCENTILE.');
    for (let i=0;i<this.cells.length;i++) {
      const c=this.cells[i],m=data.metrics[i];
      c.label.setText(m.label);c.value.setText(`${m.value} ${m.unit}`);
      c.percentile.setText(m.percentile);c.count.setText(String(m.sampleSize));
    }
    this.frontier.setText(data.frontier===null?'PARETO: TOO FEW COMPLETE COMPARABLE RUNS':
      data.frontier==='nondominated'?`PARETO: FRONTIER (${data.frontierSampleSize} COMPLETE RUNS)`:
        `PARETO: DOMINATED (${data.frontierSampleSize} COMPLETE RUNS)`);
  }

  showFailure(message='LOCAL HISTORY UNAVAILABLE; NO RANKING CLAIM') {
    if (!this.alive)return;
    this.scope.setText(ellipsize(message,400));
    this.summary.setText('NO VALID LOCAL COHORT RESULT TO DISPLAY.');
    this.hint.setText('RETRY AND EXISTING SCOREBOARDS ARE UNAFFECTED.');
    for (const c of this.cells) {
      c.label.setText('');c.value.setText('');c.percentile.setText('');c.count.setText('');
    }
    this.frontier.setText('PARETO: UNAVAILABLE');
  }

  handleAction(action) {
    if (action==='confirm'||action==='cancel') { this.close();return true; }
    return true;
  }
}
