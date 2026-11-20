/** Issue #54: renders the generic "NOW PLAYING" billboard card used for any
 * song without a confirmed YouTube ID. Original art (no YouTube branding, no
 * claimed album cover), drawn procedurally so it can be regenerated:
 *
 *   node tools/render-billboard-generic-art.mjs [out.png]
 */
import {chromium} from 'playwright';
import {writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';

const out=process.argv[2]||'public/music/billboard/generic-now-playing.png';
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();
 const dataUrl=await page.evaluate(()=>{
  const W=320,H=180,c=document.createElement('canvas');c.width=W;c.height=H;
  const x=c.getContext('2d');x.imageSmoothingEnabled=false;
  // 5x7 pixel font for the few glyphs we need.
  const F={A:'01110100011000111111100011000110001',B:'11110100011000111110100011000111110',
   F:'11111100001000011110100001000010000',G:'01110100011000010111100011000101111',
   I:'01110001000010000100001000010001110',L:'10000100001000010000100001000011111',
   M:'10001110111010110101100011000110001',N:'10001110011010110011100011000110001',
   O:'01110100011000110001100011000101110',P:'11110100011000111110100001000010000',
   R:'11110100011000111110101001001010001',S:'01111100001000001110000010000111110',
   T:'11111001000010000100001000010000100',U:'10001100011000110001100011000101110',
   W:'10001100011000110101101011101110001',Y:'10001100010101000100001000010000100',
   E:'11111100001000011110100001000011111',' ':'00000000000000000000000000000000000',
   '·':'00000000000000000100000000000000000'};
  const textW=(s,k)=>s.length*6*k-k;
  const text=(s,cx,y,k,fill,glow,blur)=>{
   let px=Math.round(cx-textW(s,k)/2);
   x.save();x.fillStyle=fill;x.shadowColor=glow;x.shadowBlur=blur;
   for(const ch of s){const g=F[ch]||F[' '];
    for(let i=0;i<35;i++)if(g[i]==='1')x.fillRect(px+(i%5)*k,y+Math.floor(i/5)*k,k,k);
    px+=6*k;}
   x.restore();
  };
  // Night-to-magenta sky.
  const sky=x.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,'#070a24');sky.addColorStop(.52,'#3a0d52');sky.addColorStop(.78,'#a3205f');sky.addColorStop(1,'#140720');
  x.fillStyle=sky;x.fillRect(0,0,W,H);
  // Stars.
  let seed=54;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
  x.fillStyle='#cfe8ff';for(let i=0;i<60;i++){const sx=rnd()*W,sy=rnd()*H*.45;x.globalAlpha=.3+rnd()*.6;x.fillRect(sx|0,sy|0,1,1);}
  x.globalAlpha=1;
  // Striped synthwave sun behind the bluffs.
  const sunY=118,r=46;
  const sun=x.createLinearGradient(0,sunY-r,0,sunY+r);sun.addColorStop(0,'#ffe46b');sun.addColorStop(.6,'#ff6f61');sun.addColorStop(1,'#d6246e');
  x.save();x.beginPath();x.arc(W/2,sunY,r,0,Math.PI*2);x.clip();x.fillStyle=sun;x.fillRect(W/2-r,sunY-r,2*r,2*r);
  x.fillStyle='#3a0d52';for(let i=0;i<7;i++){const yy=sunY+4+i*7;x.fillRect(W/2-r,yy,2*r,1+i*.6);}x.restore();
  // Bluff silhouettes (snowy slopes).
  x.fillStyle='#1b0b33';x.beginPath();x.moveTo(0,128);
  for(const [px,py] of [[30,104],[62,116],[96,92],[128,120],[176,126],[214,98],[246,112],[284,88],[320,110],[320,140],[0,140]])x.lineTo(px,py);
  x.fill();
  x.strokeStyle='#7fe9ff';x.lineWidth=1;x.globalAlpha=.55;x.beginPath();x.moveTo(0,128);
  for(const [px,py] of [[30,104],[62,116],[96,92],[128,120],[176,126],[214,98],[246,112],[284,88],[320,110]])x.lineTo(px,py);
  x.stroke();x.globalAlpha=1;
  // Neon perspective grid floor.
  x.fillStyle='#12061f';x.fillRect(0,136,W,H-136);
  x.strokeStyle='#ff3fb4';x.shadowColor='#ff3fb4';x.shadowBlur=4;
  for(let i=0;i<7;i++){const yy=136+Math.pow(i/6,1.8)*44;x.globalAlpha=.35+.5*(i/6);x.beginPath();x.moveTo(0,yy);x.lineTo(W,yy);x.stroke();}
  for(let i=-10;i<=10;i++){x.globalAlpha=.55;x.beginPath();x.moveTo(W/2+i*8,136);x.lineTo(W/2+i*40,H);x.stroke();}
  x.globalAlpha=1;x.shadowBlur=0;
  // Equalizer bars rising from the horizon.
  const bars=[9,15,22,13,27,18,31,20,12,25,16,29,21,11,24,14];
  bars.forEach((h,i)=>{const bx=W/2-((bars.length*9)/2)+i*9;
   const eq=x.createLinearGradient(0,136-h,0,136);eq.addColorStop(0,'#7fffd4');eq.addColorStop(1,'#1ec8ff');
   x.fillStyle=eq;x.shadowColor='#3ff';x.shadowBlur=6;x.globalAlpha=.85;x.fillRect(bx,136-h,6,h);});
  x.globalAlpha=1;x.shadowBlur=0;
  // Neon title card.
  x.fillStyle='rgba(7,4,20,.62)';x.fillRect(14,14,W-28,62);
  x.strokeStyle='#29f0ff';x.lineWidth=2;x.shadowColor='#29f0ff';x.shadowBlur=10;x.strokeRect(14,14,W-28,62);x.shadowBlur=0;
  text('BITSTREAM BLUFFS',W/2,22,2,'#9ff6ff','#29f0ff',6);
  text('NOW PLAYING',W/2,40,4,'#ffd1f3','#ff2fb0',12);
  text('NOW PLAYING',W/2,40,4,'#ffffff','#ff2fb0',0);
  // Light scanlines.
  x.fillStyle='rgba(0,0,0,.16)';for(let yy=0;yy<H;yy+=2)x.fillRect(0,yy,W,1);
  return c.toDataURL('image/png');
 });
 await mkdir(dirname(out),{recursive:true});
 await writeFile(out,Buffer.from(dataUrl.split(',')[1],'base64'));
 console.log('wrote',out);
}finally{await browser.close();}
