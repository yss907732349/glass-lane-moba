import Phaser from 'phaser';
import type { MatchState, Unit, Team, Command, Effect, Point } from './shared/types.ts';
import { WORLD, HEROES, RULES, SUMMONERS, TERRAIN } from './shared/data.ts';
import { bushAt, displacementEndpoint, isPointInTeamVision, isUnitVisibleToTeam } from './shared/simulation.ts';

export function project(x:number,y:number){return{x:800+(x-WORLD.width/2)*.72+(y-WORLD.laneY)*.42,y:365+(y-WORLD.laneY)*.52-(x-WORLD.width/2)*.14};}
function unproject(x:number,y:number){const px=x-800,py=y-365,d=.72*.52+.42*.14;return{x:WORLD.width/2+(px*.52-py*.42)/d,y:WORLD.laneY+(py*.72+px*.14)/d};}
const hash=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return(h>>>0)/4294967295;};
const tint=(team:Team)=>team===0?0x81bbae:0xcf9b7d;
const pale=(team:Team)=>team===0?0xb7dfd7:0xe6c4a5;
const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
type View={sprite:Phaser.GameObjects.Sprite,label:Phaser.GameObjects.Text,body:Phaser.GameObjects.Graphics,weapon:Phaser.GameObjects.Image,x:number,y:number,hitAt:number,attackAt:number};
type Popup={text:Phaser.GameObjects.Text,x:number,y:number,start:number,end:number};
type Sample={hp:number,shield:number,attackTimer:number,buffUntil:number};

export class Arena extends Phaser.Scene{
  state?:MatchState;team:Team=0;active=false;inMatch=false;onCommand:(c:Command)=>void=()=>{};
  ground!:Phaser.GameObjects.Graphics;ink!:Phaser.GameObjects.Graphics;units=new Map<string,View>();
  mouse={x:WORLD.width/2,y:WORLD.laneY};marker?:{x:number,y:number,at:number,attack?:boolean};aimSlot=-1;aimAttack=false;
  following=true;mouseInside=false;aimedSummoner:'heal'|'flash'|null=null;
  private fx!:Phaser.GameObjects.Graphics;private riverFlow!:Phaser.GameObjects.Graphics;private previousActive=false;private previousState?:MatchState;private sampledState?:MatchState;
  private fog!:Phaser.GameObjects.Graphics;private visionShape!:Phaser.GameObjects.Graphics;private visionMask!:Phaser.Display.Masks.GeometryMask;
  private drag?:{x:number,y:number};private arrows?:Record<'left'|'right'|'up'|'down',Phaser.Input.Keyboard.Key>;
  private samples=new Map<string,Sample>();private popups:Popup[]=[];private seenEffects=new Set<string>();private reducedMotion=false;private lastImpulse=-1000;
  constructor(){super('arena');}
  preload(){
    for(const hero of ['knight','mage'])this.load.spritesheet(hero,`/assets/hero-${hero}-sheet.png`,{frameWidth:32,frameHeight:32});
    for(const name of ['minion-melee','minion-ranged','sword','staff','shield'])this.load.image(name,`/assets/${name}.png`);
  }
  create(){
    this.reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.ground=this.add.graphics().setDepth(-10000);this.riverFlow=this.add.graphics().setDepth(-9990);this.ink=this.add.graphics().setDepth(-8000);this.fx=this.add.graphics().setDepth(7000);this.drawGround();
    // The fog occupies only the terrain island; the surrounding desktop stays transparent.
    this.fog=this.add.graphics().setDepth(-10001).setVisible(false);
    this.raisedTile(this.fog,[[40,WORLD.minY-60],[WORLD.width-40,WORLD.minY-60],[WORLD.width-40,WORLD.maxY+60],[40,WORLD.maxY+60]],0x111315,0x111315,32);
    this.visionShape=this.add.graphics().setVisible(false);this.visionMask=this.visionShape.createGeometryMask();
    const corners=[[40,WORLD.minY-60],[WORLD.width-40,WORLD.minY-60],[WORLD.width-40,WORLD.maxY+60],[40,WORLD.maxY+60]].map(([x,y])=>project(x,y));const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);
    this.cameras.main.setBounds(Math.min(...xs)-100,Math.min(...ys)-150,Math.max(...xs)-Math.min(...xs)+200,Math.max(...ys)-Math.min(...ys)+300);
    for(const hero of ['knight','mage'])for(const [name,start]of [['idle',0],['walk',4],['attack',8]] as const)this.anims.create({key:`${hero}-${name}`,frames:this.anims.generateFrameNumbers(hero,{start,end:start+3}),frameRate:name==='idle'?4:10,repeat:-1});
    this.input.mouse?.disableContextMenu();this.arrows=this.input.keyboard?.addKeys({left:'LEFT',right:'RIGHT',up:'UP',down:'DOWN'},false)as typeof this.arrows;
    this.input.on('gameover',()=>this.mouseInside=true);this.input.on('gameout',()=>{this.mouseInside=false;this.drag=undefined;});
    this.input.on('pointermove',(p:Phaser.Input.Pointer)=>{const point=this.screenWorld(p.x,p.y);this.mouse=unproject(point.x,point.y);if(this.drag&&p.middleButtonDown()&&!this.uiBlocked()){this.following=false;this.cameras.main.scrollX-=(p.x-this.drag.x)/this.cameras.main.zoom;this.cameras.main.scrollY-=(p.y-this.drag.y)/this.cameras.main.zoom;this.drag={x:p.x,y:p.y};}});
    this.input.on('pointerup',()=>this.drag=undefined);
    this.input.on('wheel',(_p:unknown,_o:unknown,_x:number,y:number)=>{if(this.active&&!this.uiBlocked())this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom-y*.001,.8,1.65));});
    this.input.on('pointerdown',(p:Phaser.Input.Pointer)=>{
      if(!this.active||!this.state||this.uiBlocked())return;
      if(p.middleButtonDown()){this.drag={x:p.x,y:p.y};return;}
      const world=this.screenWorld(p.x,p.y),pos=unproject(world.x,world.y);this.mouse=pos;
      if(p.rightButtonDown()){
        this.cancelAim();const target=this.mouseTarget(false);
        if(target)this.onCommand({type:'attack',targetId:target.id});else this.onCommand({type:'move',x:pos.x,y:pos.y});
        this.marker={...pos,at:this.time.now,attack:!!target};
      }else if(p.leftButtonDown()){
        if(this.aimAttack){const target=this.mouseTarget(false);if(target)this.onCommand({type:'attack',targetId:target.id});else this.onCommand({type:'attackMove',x:pos.x,y:pos.y});this.marker={...pos,at:this.time.now,attack:true};this.cancelAim();}
        else if(this.aimedSummoner){this.castSummoner(this.aimedSummoner);this.cancelAim();}
        else if(this.aimSlot>=0){this.cast(this.aimSlot);this.cancelAim();}
      }
    });
  }
  private drawVision(){
    const hero=this.ownHero();this.fog.setVisible(this.inMatch);
    if(!this.inMatch){this.ground.clearMask();this.riverFlow.clearMask();this.fx.clearMask();this.ink.clearMask();return;}
    this.visionShape.clear();
    if(hero){const circle=Array.from({length:129},(_,i)=>project(hero.x+Math.cos(i*Math.PI/64)*RULES.visionRadius,hero.y+Math.sin(i*Math.PI/64)*RULES.visionRadius));this.visionShape.fillStyle(0xffffff).fillPoints(circle,true);}
    this.ground.setMask(this.visionMask);this.riverFlow.setMask(this.visionMask);this.fx.setMask(this.visionMask);this.ink.setMask(this.visionMask);
  }
  private uiBlocked(){return['window-menu','scale-popup','opacity-popup','settings','shop'].some(id=>{const el=document.getElementById(id);return el&&!el.hidden;});}
  private ownHero(){return this.state?.units.find(u=>u.kind==='hero'&&u.team===this.team);}
  private screenWorld(x:number,y:number){const c=this.cameras.main;return{x:c.scrollX+c.width*c.originX+(x-c.x-c.width*c.originX)/c.zoom,y:c.scrollY+c.height*c.originY+(y-c.y-c.height*c.originY)/c.zoom};}
  private updateAim(){const p=this.input.activePointer,w=this.screenWorld(p.x,p.y);this.mouse=unproject(w.x,w.y);}
  private mouseTarget(combatOnly:boolean){
    if(!this.state)return;const point=project(this.mouse.x,this.mouse.y);
    const candidates=this.state.units.filter(u=>u.team!==this.team&&u.hp>0&&isUnitVisibleToTeam(this.state!,u,this.team)&&(!combatOnly||(u.kind!=='tower'&&u.kind!=='base'))).map(u=>{const p=project(u.x,u.y),height=u.kind==='hero'?28:u.kind==='tower'?69:u.kind==='base'?52:17,rx=u.kind==='base'?65:u.kind==='tower'?44:u.kind==='hero'?33:24,ry=u.kind==='tower'?83:u.kind==='base'?69:u.kind==='hero'?42:28;return{u,score:Math.hypot((p.x-point.x)/rx,(p.y-height-point.y)/ry)};}).filter(v=>v.score<1).sort((a,b)=>a.score-b.score);
    return candidates[0]?.u;
  }
  cancelAim(){this.aimSlot=-1;this.aimedSummoner=null;this.aimAttack=false;}
  selectSkill(slot:number){if(!this.active||!HEROES[this.ownHero()?.heroKind??'knight'].skills[slot])return;this.cancelAim();this.updateAim();this.aimSlot=slot;}
  selectSummoner(slot:'heal'|'flash'){if(!this.active)return;this.cancelAim();this.updateAim();this.aimedSummoner=slot;}
  selectAttack(){if(!this.active)return;this.cancelAim();this.updateAim();this.aimAttack=true;}
  cast(slot:number){if(!this.active||!this.state)return;this.updateAim();const skill=HEROES[this.ownHero()?.heroKind??'knight'].skills[slot];if(!skill)return;const target=skill.targeting==='unit'?this.mouseTarget(true):undefined;this.onCommand({type:'skill',slot:slot as 0|1|2|3,x:this.mouse.x,y:this.mouse.y,...(target?{targetId:target.id}:{})});}
  castSummoner(slot:'heal'|'flash'){if(!this.active)return;this.updateAim();this.onCommand({type:'summoner',slot,x:this.mouse.x,y:this.mouse.y});}
  focusWorld(x:number,y:number){this.following=false;const p=project(Phaser.Math.Clamp(x,0,WORLD.width),Phaser.Math.Clamp(y,WORLD.minY,WORLD.maxY));this.cameras.main.centerOn(p.x,p.y);}
  centerHero(){const hero=this.ownHero();if(hero){const p=project(hero.x,hero.y);this.cameras.main.centerOn(p.x,p.y);}}
  toggleFollow(){this.following=!this.following;if(this.following)this.centerHero();return this.following;}
  getCameraWorldBounds(){const c=this.cameras.main,points=[[0,0],[c.width,0],[c.width,c.height],[0,c.height]].map(([x,y])=>{const p=this.screenWorld(x,y);return unproject(p.x,p.y);}),xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);return{x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y};}
  polygon(g:Phaser.GameObjects.Graphics,points:number[][],color:number,alpha=1){g.fillStyle(color,alpha);g.fillPoints(points.map(p=>project(p[0],p[1])),true);}
  worldCircle(g:Phaser.GameObjects.Graphics,x:number,y:number,radius:number,color:number,alpha=1,fill=0){if(radius<=0)return;const points=Array.from({length:49},(_,i)=>project(x+Math.cos(i*Math.PI/24)*radius,y+Math.sin(i*Math.PI/24)*radius));if(fill){g.fillStyle(color,fill);g.fillPoints(points,true);}g.lineStyle(1.5,color,alpha);g.strokePoints(points,true);}
  private worldLine(g:Phaser.GameObjects.Graphics,a:Point,b:Point,color:number,width=1,alpha=1){const pa=project(a.x,a.y),pb=project(b.x,b.y);g.lineStyle(width,color,alpha);g.lineBetween(pa.x,pa.y,pb.x,pb.y);}
  private screenPoly(g:Phaser.GameObjects.Graphics,points:number[][],color:number,alpha=1){g.fillStyle(color,alpha);g.fillPoints(points.map(([x,y])=>({x,y})),true);}
  private raisedTile(g:Phaser.GameObjects.Graphics,points:number[][],top:number,edge:number,depth:number){const ps=points.map(([x,y])=>project(x,y));g.fillStyle(edge);g.fillPoints(ps.map(p=>({x:p.x,y:p.y+depth})),true);for(let i=0;i<ps.length;i++){const a=ps[i],b=ps[(i+1)%ps.length];if(b.x<a.x)continue;this.screenPoly(g,[[a.x,a.y],[b.x,b.y],[b.x,b.y+depth],[a.x,a.y+depth]],edge);}g.fillStyle(top);g.fillPoints(ps,true);}
  drawGround(){
    const g=this.ground,edgeTop=WORLD.minY-60,edgeBottom=WORLD.maxY+60,roadTop=WORLD.laneY-140,roadBottom=WORLD.laneY+140;g.clear();
    this.raisedTile(g,[[40,edgeTop],[WORLD.width-40,edgeTop],[WORLD.width-40,edgeBottom],[40,edgeBottom]],0x304d3e,0x1d302b,32);
    this.polygon(g,[[75,WORLD.minY],[4725,WORLD.minY],[4725,WORLD.maxY],[75,WORLD.maxY]],0x405a43);
    // Seeded patches remain stable while the camera moves.
    for(let i=0;i<95;i++){
      const r=hash(`patch-${i}`),x=100+hash(`x${i}`)*4600,y=i%2?WORLD.minY+20+hash(`y${i}`)*38:WORLD.maxY-20-hash(`y${i}`)*38,rx=30+r*65,ry=6+r*11;
      this.polygon(g,[[x-rx,y],[x-rx*.3,y-ry],[x+rx*.8,y-ry*.65],[x+rx,y+ry*.4],[x-rx*.2,y+ry]],i%3===0?0x556a46:0x36513c,.8);
    }
    this.raisedTile(g,[[88,roadTop],[4712,roadTop],[4712,roadBottom],[88,roadBottom]],0x7d8371,0x3b4d43,7);
    this.polygon(g,[[100,roadTop+10],[4700,roadTop+10],[4700,roadBottom-10],[100,roadBottom-10]],0x526154);
    for(let row=0;row<4;row++)for(let col=0;col<42;col++){
      const x=100+col*112+(row%2?56:0),y=roadTop+10+row*65;if(x>4685)continue;
      const right=Math.min(4700,x+106),r=hash(`pave${row}-${col}`),shade=r>.7?0x8b907b:r>.34?0x788474:0x6b7a6a;
      this.polygon(g,[[x+3,y+2],[right,y],[right-2,y+61],[x,y+63]],shade);
      this.worldLine(g,{x:x+7,y:y+5},{x:right-5,y:y+3},0xbabf9d,1,.27);
      if(r>.79){this.worldLine(g,{x:x+20,y:y+25},{x:x+36,y:y+37},0x405343,1,.6);this.worldLine(g,{x:x+36,y:y+37},{x:x+29,y:y+52},0x405343,1,.6);}
      if(r<.14)this.polygon(g,[[x+4,y+57],[x+45,y+56],[x+39,y+62],[x,y+63]],0x425c3e,.9);
    }
    for(const y of [roadTop+6,roadBottom-6])for(let x=100;x<4680;x+=80){this.worldLine(g,{x,y:y-4},{x:x+72,y:y-4},0xb9bc9a,1,.42);this.worldLine(g,{x:x+75,y:y-6},{x:x+75,y:y+5},0x415448,1,.7);}
    const {river,bridge}=TERRAIN;
    // River water covers the complete crossing; only this narrow stone bridge is walkable.
    this.polygon(g,[[river.minX-7,edgeTop],[river.maxX+7,edgeTop],[river.maxX+7,edgeBottom],[river.minX-7,edgeBottom]],0x263e49);
    this.polygon(g,[[river.minX,edgeTop],[river.maxX,edgeTop],[river.maxX,edgeBottom],[river.minX,edgeBottom]],0x3d6475);
    this.polygon(g,[[river.minX+27,edgeTop],[river.maxX-25,edgeTop],[river.maxX-25,edgeBottom],[river.minX+27,edgeBottom]],0x4b7786,.75);
    for(const x of [river.minX-9,river.maxX+9])for(let y=edgeTop+16;y<edgeBottom;y+=38){if(y>bridge.minY-20&&y<bridge.maxY+20)continue;this.polygon(g,[[x-9,y],[x-3,y-12],[x+10,y-8],[x+14,y+8],[x,y+12]],y%3?0x788a7c:0x9ca38a);}
    this.raisedTile(g,[[river.minX-10,bridge.minY],[river.maxX+10,bridge.minY],[river.maxX+10,bridge.maxY],[river.minX-10,bridge.maxY]],0x949b7f,0x40554b,8);
    for(let x=river.minX-6;x<river.maxX+7;x+=32)for(let row=0;row<2;row++){const y=bridge.minY+5+row*42;this.polygon(g,[[x+2,y],[Math.min(x+29,river.maxX+7),y],[Math.min(x+29,river.maxX+7),y+35],[x+2,y+35]],row%2?0x89947f:0x7f8b76);this.worldLine(g,{x:x+3,y:y+2},{x:Math.min(x+27,river.maxX+5),y:y+2},0xbec29e,1,.45);}
    for(const x of [river.minX-15,river.maxX+15])for(const y of [bridge.minY-3,bridge.maxY+3]){const p=project(x,y);g.fillStyle(0x283e36);g.fillEllipse(p.x,p.y+7,24,13);g.fillStyle(0x89947f);g.fillRect(p.x-7,p.y-19,14,24);g.fillStyle(0xb9a67c);g.fillEllipse(p.x,p.y-20,19,7);}
    for(const x of [1320,3480]){const p=project(x,1000);this.worldCircle(g,x,1000,62,0xa6ad86,.38);g.lineStyle(1,0xb8ae83,.38);g.strokePoints([{x:p.x,y:p.y-21},{x:p.x+21,y:p.y},{x:p.x,y:p.y+21},{x:p.x-21,y:p.y}],true);}
    // A quiet stone inset marks the respawn position; it is not a healing fountain.
    for(const team of [0,1]as Team[]){const x=WORLD.spawnX[team];this.polygon(g,[[x-80,960],[x+60,960],[x+90,1000],[x+60,1040],[x-80,1040],[x-100,1000]],0x6f8070);this.worldCircle(g,x,1000,65,0xafb294,.28);for(const side of [-1,1])this.polygon(g,[[x+side*75-7,992],[x+side*75,985],[x+side*75+7,992],[x+side*75,999]],tint(team),.65);}
    for(let i=0;i<42;i++){
      const x=140+hash(`bushx${i}`)*4520,y=i%2?WORLD.minY-25:WORLD.maxY+25,p=project(x,y),r=10+hash(`bushr${i}`)*8;
      if(x>2050&&x<2750)continue;
      g.fillStyle(0x1e392d,.45);g.fillEllipse(p.x+8,p.y+8,r*3,r*.8);
      for(let j=0;j<4;j++){const bx=p.x+(j-1.5)*r*.55,by=p.y-(j%2)*8;g.fillStyle(j%2?0x536f45:0x405e3a);g.fillEllipse(bx,by,r*1.5,r);g.fillStyle(0x7e965f,.25);g.fillEllipse(bx-3,by-r*.2,r*.7,r*.35);}
      if(i%7===0){g.fillStyle(0xbfa77a,.75);g.fillCircle(p.x-5,p.y-4,2);g.fillCircle(p.x+8,p.y-8,2);}
    }
    for(let i=0;i<24;i++){
      const x=145+i*190,y=i%2?WORLD.minY-25:WORLD.maxY+25,p=project(x,y),r=17+hash(`tree${i}`)*6;if(x>2050&&x<2750)continue;
      g.fillStyle(0x173127,.55);g.fillEllipse(p.x+17,p.y+8,76,25);g.fillStyle(0x60684d);g.fillRect(p.x-5,p.y-40,10,43);
      g.fillStyle(0x2c4c36);g.fillEllipse(p.x,p.y-51,r*2.6,r*1.9);g.fillStyle(0x426641);g.fillEllipse(p.x-r*.52,p.y-62,r*1.65,r*1.65);g.fillStyle(0x59784b);g.fillEllipse(p.x+r*.25,p.y-72,r*1.7,r*1.35);g.fillStyle(0x7e965f,.35);g.fillEllipse(p.x-3,p.y-80,r*1.15,r*.5);
    }
    for(let i=0;i<36;i++){const x=130+hash(`rockx${i}`)*4540,y=i%2?WORLD.minY-8:WORLD.maxY+8,p=project(x,y);if(x>2170&&x<2590)continue;g.fillStyle(0x293f33,.5);g.fillEllipse(p.x+3,p.y+4,26,10);this.screenPoly(g,[[p.x-11,p.y],[p.x-6,p.y-10],[p.x+7,p.y-12],[p.x+13,p.y-3],[p.x+4,p.y+3]],0x7b8370);this.screenPoly(g,[[p.x-6,p.y-10],[p.x+7,p.y-12],[p.x+1,p.y-4],[p.x-11,p.y]],0x9da38a,.7);}
    for(const brush of TERRAIN.bushes)this.drawBrush(g,brush);
    for(const y of [WORLD.minY,WORLD.maxY])this.worldLine(g,{x:85,y},{x:4715,y},0xb6bc94,1,.28);
  }
  private drawBrush(g:Phaser.GameObjects.Graphics,brush:typeof TERRAIN.bushes[number]){
    const {x,y,width,height}=brush,left=x-width/2,right=x+width/2,top=y-height/2,bottom=y+height/2;
    this.polygon(g,[[left,top],[right,top],[right,bottom],[left,bottom]],0x35583b,.82);
    g.lineStyle(1,0x96ac69,.45);g.strokePoints([[left,top],[right,top],[right,bottom],[left,bottom]].map(([px,py])=>project(px,py)),true);
    for(let row=0;row<3;row++)for(let col=0;col<7;col++){
      const px=left+11+col*(width-22)/6+(row%2?3:-3),py=top+12+row*(height-24)/2,p=project(px,py),seed=hash(`${brush.id}-${row}-${col}`),h=13+seed*9;
      g.fillStyle(0x294c31,.65);g.fillEllipse(p.x+3,p.y+5,24,11);
      g.lineStyle(1,0x80985d,.8);g.lineBetween(p.x,p.y+3,p.x-2,p.y-h);
      this.screenPoly(g,[[p.x,p.y],[p.x-10,p.y-h*.63],[p.x-5,p.y-h],[p.x+1,p.y-h*.33]],col%2?0x65894c:0x4d723e);
      this.screenPoly(g,[[p.x,p.y],[p.x+9,p.y-h*.72],[p.x+5,p.y-h-3],[p.x-1,p.y-h*.3]],row%2?0x789757:0x65894c);
      g.lineStyle(1,0xa6b978,.35);g.lineBetween(p.x,p.y-3,p.x+4,p.y-h+1);
    }
  }
  private drawRiverFlow(){
    const g=this.riverFlow,{river,bridge}=TERRAIN,top=WORLD.minY-60,bottom=WORLD.maxY+60;g.clear();
    const drift=this.reducedMotion?0:(this.time.now*.015)%39;
    for(let i=0;i<16;i++){const y=top+((i*39+drift)%(bottom-top)),x=river.minX+20+hash(`stream${i}`)*57;if(y>bridge.minY-10&&y<bridge.maxY+12)continue;this.worldLine(g,{x,y},{x:Math.min(river.maxX-15,x+29+hash(`ripple${i}`)*22),y:y+3},0x9bbcc6,1,.24);this.worldLine(g,{x:x+5,y:y+5},{x:x+17,y:y+6},0x9bbcc6,1,.1);}
  }
  private popup(text:string,x:number,y:number,color:string,large=false){if(this.popups.length>=96)this.popups.shift()!.text.destroy();const node=this.add.text(x,y,text,{fontFamily:'Bahnschrift, DengXian, sans-serif',fontSize:large?'21px':'16px',fontStyle:'bold',color,stroke:'#202121',strokeThickness:3}).setOrigin(.5).setDepth(9000);this.popups.push({text:node,x,y,start:this.time.now,end:this.time.now+(large?1050:760)});}
  private impulse(strength=.002){if(this.reducedMotion||!this.active||this.time.now-this.lastImpulse<500)return;this.lastImpulse=this.time.now;this.cameras.main.shake(90,strength);}
  private readSnapshot(){
    if(!this.state||this.sampledState===this.state)return;
    if(this.sampledState&&this.state.time<this.sampledState.time){this.samples.clear();this.seenEffects.clear();for(const p of this.popups)p.text.destroy();this.popups=[];}
    for(const u of this.state.units){if(!isUnitVisibleToTeam(this.state,u,this.team)){this.samples.delete(u.id);continue;}const old=this.samples.get(u.id),v=this.units.get(u.id);if(old&&this.active){const lost=old.hp-u.hp,blocked=old.shield-(u.shield??0);if(lost>1){const p=project(u.x,u.y);this.popup(String(Math.round(lost)),p.x,p.y-(u.kind==='hero'?74:u.kind==='tower'?130:45),u.team===this.team?'#dfad92':'#e7d097',lost>160);if(v)v.hitAt=this.time.now;if(u.kind==='hero'&&u.team===this.team&&lost>40)this.impulse();}else if(blocked>1&&u.hp===old.hp&&old.buffUntil>this.state.time){const p=project(u.x,u.y);this.popup(`${Math.round(blocked)}`,p.x,p.y-64,'#a8cddc');if(v)v.hitAt=this.time.now;}if(v&&u.attackTimer>old.attackTimer+.1)v.attackAt=this.time.now;}
      this.samples.set(u.id,{hp:u.hp,shield:u.shield??0,attackTimer:u.attackTimer,buffUntil:u.buffUntil??0});
    }
    const ids=new Set(this.state.units.map(u=>u.id));for(const id of this.samples.keys())if(!ids.has(id))this.samples.delete(id);
    for(const e of this.state.effects){if(this.seenEffects.has(e.id))continue;this.seenEffects.add(e.id);if(!this.active||!this.effectVisible(e))continue;const p=project(e.x,e.y);if(e.kind==='gold')this.popup(e.text||'+金币',p.x,p.y-48,'#e0c17d');if(e.kind==='heal'&&e.text)this.popup(e.text,p.x,p.y-101,'#b4d8a0');if(e.kind==='nova'&&(e.radius??0)>=250&&e.text!=='预警'&&this.ownHero()&&dist(this.ownHero()!,e)<850)this.impulse(.0028);}
    if(this.seenEffects.size>500)this.seenEffects=new Set(this.state.effects.map(e=>e.id));
    this.sampledState=this.state;
  }
  private makeView(u:Unit,p:Point){const texture=u.kind==='hero'?(u.heroKind??'knight'):u.kind==='ranged'?'minion-ranged':'minion-melee';const view:View={sprite:this.add.sprite(p.x,p.y,texture).setOrigin(.5,u.kind==='hero'?.875:1),label:this.add.text(p.x,p.y,'',{fontFamily:'DengXian, sans-serif',fontSize:u.kind==='hero'?'12px':'11px',color:'#d0d0d0',stroke:'#202224',strokeThickness:3}).setOrigin(.5),body:this.add.graphics(),weapon:this.add.image(p.x,p.y,u.kind==='ranged'?'staff':'sword').setOrigin(.5,.8).setVisible(false),x:p.x,y:p.y,hitAt:-1000,attackAt:-1000};this.units.set(u.id,view);return view;}
  private crystal(g:Phaser.GameObjects.Graphics,x:number,y:number,width:number,height:number,color:number){this.screenPoly(g,[[x,y-height],[x-width,y-height*.45],[x,y]],color);this.screenPoly(g,[[x,y-height],[x+width,y-height*.45],[x,y]],pale(color===tint(0)?0:1),.86);g.lineStyle(1,0xd9e7d8,.7);g.lineBetween(x,y-height,x,y);g.lineStyle(1,0xeee2bd,.5);g.lineBetween(x-width,y-height*.45,x,y-height);}
  private drawStructure(u:Unit,v:View){
    const g=v.body,x=v.x,y=v.y,base=u.kind==='base',color=tint(u.team),alive=u.hp>0,hit=this.time.now-v.hitAt<110,attack=Math.max(0,1-(this.time.now-v.attackAt)/230);
    g.clear().setDepth(y-1);v.sprite.setVisible(false);v.weapon.setVisible(false);g.fillStyle(0x1a302c,.4);g.fillEllipse(x+11,y+9,base?161:104,base?68:44);
    if(!alive){for(let i=0;i<8;i++){const a=i*2.39,r=12+i*3,px=x+Math.cos(a)*r,py=y+Math.sin(a)*r*.42;this.screenPoly(g,[[px-12,py],[px-7,py-13],[px+8,py-11],[px+14,py+3]],i%2?0x7b8372:0x4e6359);}g.lineStyle(1,color,.2);g.strokeEllipse(x,y,base?120:75,base?57:34);v.label.setText('');return;}
    const w=base?71:43,h=base?29:19,top=y-13;
    this.screenPoly(g,[[x-w,y],[x-w*.7,y+h*.65],[x+w*.6,y+h*.65],[x+w,y],[x+w,y-11],[x+w*.6,y+h*.65-11],[x-w*.7,y+h*.65-11],[x-w,y-11]],0x374d44);
    this.screenPoly(g,[[x-w,top],[x-w*.5,top-h],[x+w*.55,top-h],[x+w,top],[x+w*.6,top+h*.6],[x-w*.65,top+h*.6]],hit?0xb8b497:0x899580);
    g.lineStyle(1,0xbec09b,.55);g.lineBetween(x-w,top,x-w*.5,top-h);g.lineBetween(x-w*.5,top-h,x+w*.55,top-h);
    g.lineStyle(2,color,.55);g.strokeEllipse(x,top,base?103:56,base?41:24);
    if(base){
      this.screenPoly(g,[[x-41,y-15],[x-41,y-49],[x-17,y-65],[x+35,y-60],[x+44,y-24],[x+22,y-6]],0x506960);
      this.screenPoly(g,[[x-41,y-49],[x-17,y-65],[x+35,y-60],[x+44,y-42],[x+12,y-29]],hit?0xb8bc9f:0x96a18a);
      for(const side of [-1,1]){const xx=x+side*47;g.fillStyle(0x5c7262);g.fillRect(xx-6,y-53,12,38);g.fillStyle(0xc4ad79);g.fillRect(xx-8,y-55,16,5);g.fillStyle(color,.65);g.fillRect(xx-3,y-45,6,17);}
      g.fillStyle(color,.1);g.fillEllipse(x,y-47,77,98);this.crystal(g,x,y-30,21,79,color);
      g.lineStyle(1,color,.65);g.strokeEllipse(x,y-12,106,45);for(let i=0;i<6;i++){const a=i*Math.PI/3;g.fillStyle(pale(u.team),.8);g.fillCircle(x+Math.cos(a)*48,y-12+Math.sin(a)*19,2);}
    }else{
      this.screenPoly(g,[[x-22,y-22],[x-22,y-93],[x+13,y-104],[x+27,y-86],[x+27,y-25],[x+7,y-14]],hit?0xa0a98f:0x6d816d);
      this.screenPoly(g,[[x-22,y-93],[x+13,y-104],[x+27,y-86],[x-7,y-75]],0xa0a98f);
      this.screenPoly(g,[[x+8,y-80],[x+27,y-86],[x+27,y-25],[x+7,y-14]],0x465f51);
      for(let row=0;row<4;row++){const yy=y-32-row*15;g.lineStyle(1,0x374d44,.6);g.lineBetween(x-20,yy,x+7,yy+5);g.lineBetween(x-8+(row%2)*12,yy,x-8+(row%2)*12,yy-14);}
      g.fillStyle(0xc5ad79);g.fillRect(x-25,y-77,51,7);g.fillStyle(color,.8);g.fillRect(x-12,y-62,7,18);g.fillStyle(0x395649);g.fillRect(x-4,y-61,10,25);g.lineStyle(2,pale(u.team),.65);g.lineBetween(x-7,y-55,x-7,y-48);
      this.screenPoly(g,[[x-31,y-98],[x-31,y-113],[x-20,y-113],[x-20,y-104],[x-9,y-108],[x-9,y-120],[x+3,y-120],[x+3,y-110],[x+16,y-114],[x+16,y-126],[x+28,y-126],[x+28,y-101],[x-4,y-87]],0x939f83);
      this.crystal(g,x+1,y-105,11,35,color);
      if(attack>0){g.fillStyle(0xe1bd82,attack*.35);g.fillCircle(x,y-126,18*attack+6);g.lineStyle(2,0xe7cf98,attack);g.strokeCircle(x,y-126,12+(1-attack)*14);}
    }
    const labelY=y-(base?132:158);v.label.setText(`${u.team===this.team?'我方':'敌方'}${base?'基地':'防御塔'}`).setPosition(x,labelY).setDepth(y+2).setAlpha(.9);this.bar(g,x,labelY+14,base?90:67,u.hp/u.maxHp,color,5);
  }
  private drawUnit(u:Unit,v:View,delta:number){
    const p=project(u.x,u.y),moving=Math.hypot(p.x-v.x,p.y-v.y)>1.4,k=this.reducedMotion?1:Math.min(1,delta/70);v.x+=(p.x-v.x)*k;v.y+=(p.y-v.y)*k;
    if(u.kind==='tower'||u.kind==='base'){this.drawStructure(u,v);return;}
    const x=v.x,y=v.y,g=v.body,color=tint(u.team),hero=u.kind==='hero',hit=this.time.now-v.hitAt<95,attackAge=this.time.now-v.attackAt,attacking=attackAge<280;
    g.clear().setDepth(y-.1);g.fillStyle(0x1c3029,.4);g.fillEllipse(x+3,y+3,hero?45:30,hero?15:10);
    const target=u.targetId?this.state!.units.find(t=>t.id===u.targetId&&isUnitVisibleToTeam(this.state!,t,this.team)):undefined,flip=target?target.x<u.x:u.moveTarget?u.moveTarget.x<u.x:u.team===1;
    const bob=!this.reducedMotion&&moving?Math.sin(this.time.now/95+hash(u.id)*6)*1.1:0;
    v.sprite.setVisible(true).setPosition(x,y-2+bob).setDepth(y).setFlipX(flip).setAngle(hit&&!this.reducedMotion?(flip?3:-3):0);
    if(hit)v.sprite.setTintFill(0xeee0bf);else v.sprite.clearTint();
    if(hero){
      const concealed=u.team===this.team&&!!bushAt(u)&&(u.revealedUntil??0)<=this.state!.time;
      v.sprite.setAlpha(concealed ? .55:1).setDisplaySize(90,90).play(`${u.heroKind}-${attacking?'attack':moving?'walk':'idle'}`,true);v.weapon.setVisible(false);
      g.lineStyle(u.team===this.team?2:1,color,.9);g.strokeEllipse(x,y,44,20);if(u.team===this.team){g.fillStyle(0xe1d5a6,.9);g.fillTriangle(x,y+15,x-4,y+20,x+4,y+20);}
      if((u.shield??0)>0){g.fillStyle(0xb0cfc0,.07);g.fillEllipse(x,y-29,57,70);g.lineStyle(1.5,0xc9b77d,.8);g.strokeEllipse(x,y-29,57,70);g.lineStyle(1,0xdbe0b7,.55);g.strokeEllipse(x-2,y-29,47,63);}
      v.label.setText(`${u.name} · ${u.level??1}${concealed?' · 草丛':''}`).setPosition(x,y-77).setDepth(y+1).setAlpha(concealed ? .8:1);this.bar(g,x,y-66,56,u.hp/u.maxHp,color);this.bar(g,x,y-58,56,(u.mana??0)/(u.maxMana||1),0x789fbb,3);
    }else{
      v.label.setText('');v.sprite.setAlpha(1).setDisplaySize(34,34);g.lineStyle(2,color,.9);g.strokeEllipse(x,y,26,12);g.fillStyle(color,.7);g.fillTriangle(x-15,y-19,x-10,y-23,x-10,y-15);
      const swing=attacking&&!this.reducedMotion?Math.sin(attackAge/280*Math.PI)*1.1:0;v.weapon.clearTint().setVisible(true).setPosition(x+(flip?-1:1)*12,y-10+bob).setDisplaySize(u.kind==='ranged'?24:23,24).setRotation((flip?-.1:.1)+(flip?-swing:swing)).setFlipX(flip).setDepth(y+.1);
      this.bar(g,x,y-40,30,u.hp/u.maxHp,color,3);
    }
    if(target&&attacking&&u.range<130){const tp=project(target.x,target.y),angle=Math.atan2(tp.y-y,tp.x-x),length=hero?34:20;this.fx.lineStyle(hero?3:2,pale(u.team),Math.max(0,1-attackAge/280));this.fx.beginPath();this.fx.arc(x+Math.cos(angle)*length*.6,y-22+Math.sin(angle)*length*.4,length,angle-.9,angle+.8,false);this.fx.strokePath();}
  }
  private effectVisible(e:Effect){
    if(!this.state)return true;
    if(!isPointInTeamVision(this.state,e,this.team))return false;
    if(e.team===this.team)return true;
    if(e.sourceId){const source=this.state.units.find(u=>u.id===e.sourceId);if(source&&!isUnitVisibleToTeam(this.state,source,this.team))return false;if(!source&&e.sourceId.startsWith('hero-'))return false;}
    return!this.state.units.some(u=>u.kind==='hero'&&u.team===e.team&&!isUnitVisibleToTeam(this.state!,u,this.team)&&dist(u,e)<3);
  }
  private drawEffect(e:Effect){
    if(!this.state||!this.effectVisible(e))return;const g=this.fx,p=project(e.x,e.y),life=Phaser.Math.Clamp((this.state.time-e.start)/Math.max(.01,e.end-e.start),0,1),fade=1-life,color=pale(e.team);
    if(e.kind==='attack'){
      const target=project(e.toX??e.x,e.toY??e.y),tower=this.state.units.find(u=>u.kind==='tower'&&u.team===e.team&&dist(u,e)<5),ranged=(e.radius??0)<=4||!!tower;
      if(ranged){const fromY=p.y-(tower?127:23),t=Math.min(1,life*1.65),px=Phaser.Math.Linear(p.x,target.x,t),py=Phaser.Math.Linear(fromY,target.y-20,t),back=Math.max(0,t-.16);g.lineStyle(tower?4:2,tower?0xe1b67a:color,fade);g.lineBetween(Phaser.Math.Linear(p.x,target.x,back),Phaser.Math.Linear(fromY,target.y-20,back),px,py);g.fillStyle(tower?0xf1ddb3:0xe6e5c3,fade);g.fillCircle(px,py,tower?5:2.5);if(t>.9){g.lineStyle(2,tower?0xe1b67a:color,fade);g.strokeCircle(target.x,target.y-20,3+life*12);}}
    }else if(e.kind==='slash'){
      const target=project(e.toX??e.x,e.toY??e.y),cx=(p.x+target.x)/2,cy=(p.y+target.y)/2-20,angle=Math.atan2(target.y-p.y,target.x-p.x);g.lineStyle(9,0x9ec3cb,fade*.2);g.beginPath();g.arc(cx,cy,43,angle-1.3,angle+.8,false);g.strokePath();g.lineStyle(3,0xe6d2a5,fade);g.beginPath();g.arc(cx,cy,36+life*8,angle-1.2,angle+.65,false);g.strokePath();
    }else if(e.kind==='dash'){
      const target=project(e.toX??e.x,e.toY??e.y);g.lineStyle(12,color,fade*.11);g.lineBetween(p.x,p.y-20,target.x,target.y-20);g.lineStyle(2,0xe5d4a5,fade*.7);g.lineBetween(p.x,p.y-20,target.x,target.y-20);for(let i=0;i<3;i++){const t=(i+1)/4;g.lineStyle(1,color,fade*.5);g.strokeEllipse(Phaser.Math.Linear(p.x,target.x,t),Phaser.Math.Linear(p.y,target.y,t),13+life*24,24+life*35);}
    }else if(e.kind==='nova'){
      if(e.text==='预警')return;const radius=e.radius||135,ultimate=radius>=250;this.worldCircle(g,e.x,e.y,radius*(.4+life*.6),ultimate?0xd5bd85:0x9ec3cb,fade,fade*.13);this.worldCircle(g,e.x,e.y,radius*(.75+life*.3),color,fade*.5);for(let i=0;i<(ultimate?10:7);i++){const a=i*Math.PI*2/(ultimate?10:7),r=radius*(.35+life*.6),v=project(e.x+Math.cos(a)*r,e.y+Math.sin(a)*r);g.lineStyle(ultimate?3:2,ultimate?0xe5d4a5:0xb5dde1,fade*.8);g.lineBetween(v.x,v.y-6,v.x+(v.x-p.x)*.1,v.y-20-life*20);}
    }else if(e.kind==='heal'){
      this.worldCircle(g,e.x,e.y,37+life*28,0xadc995,fade);g.lineStyle(2,0xc9dfa9,fade);g.lineBetween(p.x-7,p.y-35-life*14,p.x+7,p.y-35-life*14);g.lineBetween(p.x,p.y-42-life*14,p.x,p.y-28-life*14);
    }else if(e.kind==='shield'){
      g.lineStyle(2,0xcdbb87,fade);g.strokeEllipse(p.x,p.y-28,49+life*20,64+life*20);
    }else if(e.kind==='death'){
      this.worldCircle(g,e.x,e.y,(e.radius||40)*(.4+life*.6),color,fade*.65);for(let i=0;i<5;i++){const a=i*1.256,r=life*23;g.fillStyle(color,fade*.7);g.fillRect(p.x+Math.cos(a)*r-2,p.y-10+Math.sin(a)*r*.5-2,4,4);}
    }
  }
  private boundedMouse(){return{x:Phaser.Math.Clamp(this.mouse.x,WORLD.minX,WORLD.maxX),y:Phaser.Math.Clamp(this.mouse.y,WORLD.minY,WORLD.maxY)};}
  private cappedPoint(hero:Unit,range:number){const point=this.boundedMouse(),d=dist(hero,point),t=d>range?range/d:1;return{x:Phaser.Math.Clamp(hero.x+(point.x-hero.x)*t,WORLD.minX,WORLD.maxX),y:Phaser.Math.Clamp(hero.y+(point.y-hero.y)*t,WORLD.minY,WORLD.maxY)};}
  private directionGuide(hero:Unit,range:number,width:number,color:number){const point=this.boundedMouse(),d=dist(hero,point),dx=d>.01?(point.x-hero.x)/d:hero.team===0?1:-1,dy=d>.01?(point.y-hero.y)/d:0,end={x:hero.x+dx*range,y:hero.y+dy*range},nx=-dy*width/2,ny=dx*width/2;const points=[[hero.x+nx,hero.y+ny],[end.x+nx,end.y+ny],[end.x-nx,end.y-ny],[hero.x-nx,hero.y-ny]];this.polygon(this.ink,points,color,.09);this.ink.lineStyle(1.5,color,.75);this.ink.strokePoints(points.map(([x,y])=>project(x,y)),true);this.worldLine(this.ink,hero,end,color,1,.4);const tip=project(end.x,end.y),back=project(end.x-dx*22,end.y-dy*22);this.ink.lineStyle(2,color,.9);this.ink.lineBetween(tip.x,tip.y,back.x+dy*10,back.y-dx*10);this.ink.lineBetween(tip.x,tip.y,back.x-dy*10,back.y+dx*10);}
  private drawTowerCoverage(){
    if(!this.active||!this.state||this.uiBlocked())return;this.updateAim();const point=project(this.mouse.x,this.mouse.y),hero=this.ownHero(),towers=this.state.units.filter(u=>u.kind==='tower'&&u.hp>0&&isUnitVisibleToTeam(this.state!,u,this.team));
    const hovered=this.mouseInside?towers.map(u=>{const p=project(u.x,u.y);return{u,d:Math.hypot((p.x-point.x)/46,(p.y-69-point.y)/83)};}).filter(t=>t.d<1).sort((a,b)=>a.d-b.d)[0]?.u:undefined;
    const nearby=hero&&hero.hp>0?towers.filter(u=>u.team!==this.team&&dist(hero,u)<=u.range+80).sort((a,b)=>dist(hero,a)-dist(hero,b))[0]:undefined;
    const selected=towers.find(u=>u.id===hero?.orderedTargetId),tower=hovered??selected??nearby;if(!tower)return;
    const danger=tower.team!==this.team,color=danger?0xcd9278:0x83bca8,inside=!!hero&&hero.hp>0&&dist(hero,tower)<=tower.range;
    this.worldCircle(this.ink,tower.x,tower.y,tower.range,color,danger&&inside ? .7:.45,danger&&inside ? .035:.015);
    if(danger&&tower.targetId===hero?.id&&hero){this.worldLine(this.ink,tower,hero,0xd8a27b,1.5,.65);this.worldCircle(this.ink,hero.x,hero.y,36,0xd8a27b,.8);}
  }
  private drawAim(){
    const hero=this.ownHero();if(!hero||hero.hp<=0||!this.active||this.uiBlocked())return;const g=this.ink;this.updateAim();
    if(this.aimAttack){this.worldCircle(g,hero.x,hero.y,hero.range,0xd8ba77,.85,.035);const target=this.mouseTarget(false);if(target){this.worldCircle(g,target.x,target.y,target.kind==='hero'?44:33,0xdba66e,.95);this.worldLine(g,hero,target,0xd5ae78,1,.7);}else{const p=project(this.mouse.x,this.mouse.y);g.lineStyle(1.5,0xdbc189,.9);g.lineBetween(p.x-9,p.y,p.x+9,p.y);g.lineBetween(p.x,p.y-6,p.x,p.y+6);}return;}
    if(this.aimedSummoner){const flash=this.aimedSummoner==='flash',color=flash?0xe2c387:0xadd496;if(flash){this.worldCircle(g,hero.x,hero.y,SUMMONERS.flash.range,color,.6,.02);const p=displacementEndpoint(hero,this.boundedMouse(),SUMMONERS.flash.range);this.worldLine(g,hero,p,color,2,.8);this.worldCircle(g,p.x,p.y,30,color,.95,.08);}else this.worldCircle(g,hero.x,hero.y,70,color,.8,.06);return;}
    if(this.aimSlot<0)return;const skill=HEROES[hero.heroKind??'knight'].skills[this.aimSlot];if(!skill)return;const valid=(hero.skillRanks[this.aimSlot]??0)>0&&(hero.cooldowns?.[this.aimSlot]??0)<=0&&(hero.mana??0)>=skill.mana,color=valid?0xd8c18d:0x8e968d;
    if(skill.targeting==='self'){this.worldCircle(g,hero.x,hero.y,64,color,.85,.08);return;}
    this.worldCircle(g,hero.x,hero.y,skill.range,color,.45);
    if(skill.targeting==='unit'){const target=this.mouseTarget(true);if(target){const inRange=dist(hero,target)<=skill.range;this.worldCircle(g,target.x,target.y,43,inRange?0xe1cb91:0xcd9d85,.95,.08);this.worldLine(g,hero,target,inRange?color:0xcd9d85,1,.75);}}
    else if(skill.targeting==='ground'){const p=this.cappedPoint(hero,skill.range);this.worldCircle(g,p.x,p.y,this.aimSlot===3?260:135,color,.9,.075);this.worldLine(g,hero,p,color,1,.35);}
    else if(hero.heroKind==='mage'&&this.aimSlot===0)this.directionGuide(hero,skill.range,60,color);
    else{const p=displacementEndpoint(hero,this.boundedMouse(),skill.range);this.worldLine(g,hero,p,color,2,.8);this.worldCircle(g,p.x,p.y,hero.heroKind==='knight'?110:30,color,.9,.055);}
  }
  update(_time:number,delta:number){
    if(!this.state||!this.ink)return;const camera=this.cameras.main;
    if(this.active&&!this.previousActive){camera.setZoom(1.25);this.following=true;this.centerHero();this.cancelAim();}
    if(!this.active&&this.state!==this.previousState&&!this.previousActive){camera.setZoom(.39);camera.centerOn(800,365);}
    if(this.active&&!this.uiBlocked()){if(this.following){const hero=this.ownHero();if(hero){const p=project(hero.x,hero.y),k=this.reducedMotion?1:1-Math.exp(-delta/90);camera.centerOn(Phaser.Math.Linear(camera.scrollX+camera.width/2,p.x,k),Phaser.Math.Linear(camera.scrollY+camera.height/2,p.y,k));}}else{const p=this.input.activePointer,speed=delta*.8/camera.zoom,keys=!document.activeElement?.matches('input,textarea,select');if((keys&&this.arrows?.left.isDown)||(this.mouseInside&&p.x<25))camera.scrollX-=speed;if((keys&&this.arrows?.right.isDown)||(this.mouseInside&&p.x>1575))camera.scrollX+=speed;if((keys&&this.arrows?.up.isDown)||(this.mouseInside&&p.y<25))camera.scrollY-=speed;if((keys&&this.arrows?.down.isDown)||(this.mouseInside&&p.y>725))camera.scrollY+=speed;camera.scrollX=Phaser.Math.Clamp(camera.scrollX,-1500,2800);camera.scrollY=Phaser.Math.Clamp(camera.scrollY,-900,900);}}
    this.previousActive=this.active;this.previousState=this.state;this.ink.clear();this.fx.clear();this.drawRiverFlow();this.drawVision();this.readSnapshot();const live=new Set<string>();
    for(const u of [...this.state.units].filter(u=>(u.hp>0||u.kind==='tower'||u.kind==='base')&&isUnitVisibleToTeam(this.state!,u,this.team)).sort((a,b)=>project(a.x,a.y).y-project(b.x,b.y).y)){const p=project(u.x,u.y),v=this.units.get(u.id)??this.makeView(u,p);live.add(u.id);this.drawUnit(u,v,delta);}
    for(const [id,v]of this.units)if(!live.has(id)){v.sprite.destroy();v.label.destroy();v.body.destroy();v.weapon.destroy();this.units.delete(id);}
    for(const e of this.state.effects)this.drawEffect(e);
    for(const missile of this.state.projectiles??[]){if(!this.ownHero()||dist(this.ownHero()!,missile)>RULES.visionRadius+missile.radius)continue;const p=project(missile.x,missile.y),color=pale(missile.team);if(missile.kind==='nova'){const remaining=Math.max(0,(missile.activateAt??this.state.time)-this.state.time),ultimate=missile.radius>=250;this.worldCircle(this.ink,missile.x,missile.y,missile.radius,color,.85,.065);this.worldCircle(this.ink,missile.x,missile.y,missile.radius*(1-remaining/(ultimate?1:.65)),color,.55);if(ultimate){this.fx.lineStyle(3,0xe1c99a,.7);this.fx.lineBetween(p.x,p.y-25,p.x,p.y-25-remaining*110);}}else{const back=project(missile.x-missile.dirX*65,missile.y-missile.dirY*65);this.fx.lineStyle(11,color,.15);this.fx.lineBetween(back.x,back.y-18,p.x,p.y-18);this.fx.lineStyle(4,color,.9);this.fx.lineBetween(back.x,back.y-18,p.x,p.y-18);this.fx.fillStyle(0xe4e9ce);this.fx.fillCircle(p.x,p.y-18,5);this.worldCircle(this.ink,missile.x,missile.y,missile.radius,color,.3);}}
    if(this.marker&&this.time.now-this.marker.at<500){const p=project(this.marker.x,this.marker.y),life=(this.time.now-this.marker.at)/500,r=8+life*12,color=this.marker.attack?0xdaa478:0xd5c490;this.ink.lineStyle(1.5,color,1-life);this.ink.strokeEllipse(p.x,p.y,r*2,r);for(let i=0;i<4;i++){const a=i*Math.PI/2;this.ink.lineBetween(p.x+Math.cos(a)*r*1.6,p.y+Math.sin(a)*r*.8,p.x+Math.cos(a)*r*2.1,p.y+Math.sin(a)*r*1.05);}}
    this.drawTowerCoverage();this.drawAim();this.popups=this.popups.filter(p=>{if(this.time.now>=p.end||(this.active&&!isPointInTeamVision(this.state!,unproject(p.x,p.y),this.team))){p.text.destroy();return false;}const t=(this.time.now-p.start)/(p.end-p.start);p.text.setPosition(p.x,p.y-(this.reducedMotion?0:t*35)).setAlpha(Math.min(1,(1-t)*3));return true;});
  }
  bar(g:Phaser.GameObjects.Graphics,x:number,y:number,w:number,ratio:number,color:number,h=5){g.fillStyle(0x1f2020,.9);g.fillRect(x-w/2-1,y-1,w+2,h+2);g.fillStyle(color);g.fillRect(x-w/2,y,w*Phaser.Math.Clamp(ratio,0,1),h);g.fillStyle(0xc7ccd2,.16);g.fillRect(x-w/2,y,w*Phaser.Math.Clamp(ratio,0,1),1);}
}
export function bootArena(parent:HTMLElement){const scene=new Arena(),game=new Phaser.Game({type:Phaser.AUTO,parent,width:1600,height:750,transparent:true,antialias:false,pixelArt:true,scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},scene:[scene],banner:false,render:{preserveDrawingBuffer:true},fps:{target:60}});return{game,scene};}

