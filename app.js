(function(){
  const diag = document.getElementById('diag');
  function log(msg){ const t=new Date().toLocaleTimeString(); diag.textContent += `\n[${t}] ${msg}`; diag.scrollTop = diag.scrollHeight; }
  window.addEventListener('error', e=>log('ERROR: '+(e.message||e)));
  window.addEventListener('unhandledrejection', e=>log('REJECTION: '+e.reason));

  const overlay = document.getElementById('overlay');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  if(!ctx){ log('No 2D context.'); return; }

  let dpr = window.devicePixelRatio||1;
  function resize(){
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(2, Math.floor(rect.width*dpr));
    const h = Math.max(2, Math.floor(rect.height*dpr));
    if(canvas.width!==w || canvas.height!==h){ canvas.width=w; canvas.height=h; }
  }
  resize(); window.addEventListener('resize', resize);

  const $ = id => document.getElementById(id);
  const ctl = {
    preset: $('preset'), nBodies: $('nBodies'), seed: $('seed'),
    mMin: $('mMin'), mMax: $('mMax'), spawnR: $('spawnR'),
    G: $('G'), dt: $('dt'), eps: $('eps'), speed: $('speed'),
    collisions: $('collisions'), bounds: $('bounds'), trails: $('trails'),
    radius: $('radius'),
    btnStart: $('btnStart'), btnPause: $('btnPause'), btnReset: $('btnReset'),
    btnAdd: $('btnAdd'), btnClear: $('btnClear'), btnRebuildStart: $('btnRebuildStart'),
    btnResetSettings: $('btnResetSettings'), btnCameraDefaults: $('btnCameraDefaults'),
    statStep: $('statStep'), statE: $('statE'), statP: $('statP'), statFPS: $('statFPS')
  };

  const DEFAULTS = {
    preset:'random', nBodies:200, seed:42, mMin:0.5, mMax:3, spawnR:0.45,
    G:1, dt:0.02, eps:0.02, speed:1, collisions:'merge', bounds:'open',
    trails:'short', radius:2
  };

  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

  let world = { bodies: [], step: 0, paused: false, cam:{x:0,y:0,scale:240,angle:0} };

  // ---------- Trackball ----------
  const tb = document.getElementById('trackball');
  const tbc = tb.getContext('2d');
  const tbAngleEl = document.getElementById('tbAngle');
  const tbZoomEl = document.getElementById('tbZoom');
  const tbXEl = document.getElementById('tbX');
  const tbYEl = document.getElementById('tbY');

  function drawTrackball(){
    const w=tb.width, h=tb.height, r=Math.min(w,h)/2-2;
    tbc.clearRect(0,0,w,h);
    const cx=w/2, cy=h/2;

    const g = tbc.createRadialGradient(cx-0.3*r,cy-0.3*r, r*0.2, cx,cy, r);
    g.addColorStop(0,'#2a4cff'); g.addColorStop(0.6,'#0b1a44'); g.addColorStop(1,'#071025');
    tbc.fillStyle=g; tbc.beginPath(); tbc.arc(cx,cy,r,0,Math.PI*2); tbc.fill();
    tbc.strokeStyle='#2a3a7a'; tbc.lineWidth=1; tbc.stroke();

    tbc.strokeStyle='#3a4a8a'; tbc.lineWidth=0.5;
    for(let i=-2;i<=2;i++){
      const a=i*Math.PI/6;
      tbc.beginPath();
      for(let th=0;th<=64;th++){
        const t=th/64*Math.PI*2;
        const x=cx + r*Math.cos(t)*Math.cos(a);
        const y=cy + r*Math.sin(t);
        if(th===0) tbc.moveTo(x,y); else tbc.lineTo(x,y);
      }
      tbc.stroke();
    }
    tbc.save(); tbc.translate(cx,cy); tbc.rotate(-world.cam.angle);
    tbc.beginPath(); tbc.strokeStyle='#cfe2ff'; tbc.lineWidth=2; tbc.arc(0,0,r-4,-0.15,0.15); tbc.stroke(); tbc.restore();

    tbc.beginPath(); tbc.strokeStyle='#5a7aff'; tbc.lineWidth=1; tbc.arc(cx,cy,r+4,0,Math.PI*2); tbc.stroke();
    const zoom01 = (Math.log(world.cam.scale)-Math.log(60))/(Math.log(4000)-Math.log(60));
    const zhAng = -Math.PI/2 + zoom01*2*Math.PI;
    tbc.beginPath(); tbc.strokeStyle='#d7e7ff'; tbc.lineWidth=2; tbc.arc(cx,cy,r+6, zhAng-0.12, zhAng+0.12); tbc.stroke();

    const px = Math.max(-1,Math.min(1,world.cam.x));
    const py = Math.max(-1,Math.min(1,world.cam.y));
    tbc.beginPath(); tbc.fillStyle='#9fffd8'; tbc.arc(cx + px*r*0.6, cy - py*r*0.6, 4, 0, Math.PI*2); tbc.fill();
  }
  function updateTbLabels(){
    tbAngleEl.textContent = Math.round(world.cam.angle*180/Math.PI) + '°';
    tbZoomEl.textContent = Math.round(world.cam.scale);
    tbXEl.textContent = world.cam.x.toFixed(2);
    tbYEl.textContent = world.cam.y.toFixed(2);
  }
  function tbPos(e){
    const rect = tb.getBoundingClientRect();
    return { x:e.clientX-rect.left, y:e.clientY-rect.top, cx:rect.width/2, cy:rect.height/2, r:Math.min(rect.width,rect.height)/2-2 };
  }
  let tbDragging=false;
  tb.addEventListener('mousedown',e=>{ tbDragging=true; e.preventDefault(); });
  window.addEventListener('mouseup',()=>{ tbDragging=false; });
  window.addEventListener('mousemove',e=>{
    if(!tbDragging) return;
    const p = tbPos(e); const dx = p.x - p.cx, dy = p.y - p.cy; const ang = Math.atan2(dy, dx);
    if(e.shiftKey){ world.cam.scale = clamp(world.cam.scale * Math.exp((-dy)*0.006), 60, 4000); }
    else if(e.altKey){ world.cam.x += dx/(p.r*8); world.cam.y -= dy/(p.r*8); }
    else { world.cam.angle = ang; }
    drawTrackball(); updateTbLabels();
  });
  tb.addEventListener('wheel',e=>{ e.preventDefault(); world.cam.scale = clamp(world.cam.scale * Math.exp(-e.deltaY*0.001), 60, 4000); drawTrackball(); updateTbLabels(); }, {passive:false});
  tb.addEventListener('dblclick',()=>{ world.cam={x:0,y:0,scale:240,angle:0}; drawTrackball(); updateTbLabels(); });

  // ---------- Physics ----------
  const palette=['#a4b9ff','#9fe2ff','#ffd27f','#ff9fb2','#d6ff9f','#c6a8ff','#9fffd8'];
  const pick=i=>palette[i%palette.length];
  function createBodies(n, opts){
    const out=[]; const { mMin=0.5, mMax=3, radius=0.45, preset='random' } = opts||{}; const r=radius; const G=parseFloat(ctl.G.value)||1;
    function push(x,y,vx,vy,m,c){ out.push({x,y,vx,vy,ax:0,ay:0,m,color:c}); }
    if(preset==='random'){
      for(let i=0;i<n;i++){ const a=Math.random()*2*Math.PI, rr=r*(0.2+0.8*Math.sqrt(Math.random()));
        const x=rr*Math.cos(a), y=rr*Math.sin(a);
        const m=mMin + (mMax-mMin)*Math.random();
        push(x,y, (Math.random()-0.5)*0.4, (Math.random()-0.5)*0.4, m, pick(i)); }
    }else if(preset==='disk'){
      for(let i=0;i<n;i++){ const rr=r*Math.sqrt(Math.random()), a=Math.random()*2*Math.PI;
        const x=rr*Math.cos(a), y=rr*Math.sin(a);
        const m=mMin + (mMax-mMin)*Math.random();
        const v=0.6*Math.sqrt(G*(i+1)/n/Math.max(rr,0.01));
        push(x,y, -v*Math.sin(a), v*Math.cos(a), m, pick(i)); }
      push(0,0,0,0, Math.max(mMax*10,20), '#ffd27f');
    }else if(preset==='binary'){
      const M=Math.max(mMax*10,20); push(-0.2,0,0,-0.4,M,'#ffd27f'); push(0.2,0,0,0.4,M,'#ffd27f');
      for(let i=0;i<n;i++){ const a=Math.random()*2*Math.PI, rr=0.9*r*Math.sqrt(Math.random());
        const x=rr*Math.cos(a), y=rr*Math.sin(a);
        const m=mMin + (mMax-mMin)*Math.random();
        push(x,y, (Math.random()-0.5)*0.2, (Math.random()-0.5)*0.2, m, pick(i)); }
    }else if(preset==='solar'){
      push(0,0,0,0,100,'#ffd27f');
      const planets=Math.min(8, Math.max(1, Math.floor(n/20)));
      for(let i=0;i<planets;i++){ const a=Math.random()*2*Math.PI, rr=0.1+(i+1)*0.07; const v=Math.sqrt(G*100/rr);
        push(rr*Math.cos(a), rr*Math.sin(a), -v*Math.sin(a), v*Math.cos(a), 1.5+0.2*i, pick(i)); }
    }
    return out;
  }

  function computeAccelerations(bodies,G,eps2){
    const n=bodies.length;
    for(let i=0;i<n;i++){ bodies[i].ax=0; bodies[i].ay=0; }
    for(let i=0;i<n;i++){
      const bi=bodies[i];
      for(let j=i+1;j<n;j++){
        const bj=bodies[j];
        const dx=bj.x-bi.x, dy=bj.y-bi.y;
        const r2=dx*dx+dy*dy+eps2;
        const invR=1/Math.sqrt(r2), invR3=invR*invR*invR;
        const f=G*invR3, fx=f*dx, fy=f*dy;
        bi.ax += fx * bj.m; bi.ay += fy * bj.m;
        bj.ax -= fx * bi.m; bj.ay -= fy * bi.m;
      }
    }
  }

  function stepSystem(w){
    const G = parseFloat(ctl.G.value)||1;
    const eps2 = Math.pow(parseFloat(ctl.eps.value)||0.02,2);
    const dt = (parseFloat(ctl.dt.value)||0.02) * (parseFloat(ctl.speed.value)||1);
    const bounds = ctl.bounds.value; const RBOUND=2.2;
    const bodies = w.bodies;
    for(const b of bodies){ b.vx += 0.5*dt*b.ax; b.vy += 0.5*dt*b.ay; b.x += dt*b.vx; b.y += dt*b.vy; }
    if(bounds!=='open'){
      for(const b of bodies){
        if(bounds==='wrap'){ if(b.x<-RBOUND) b.x+=2*RBOUND; if(b.x>RBOUND) b.x-=2*RBOUND; if(b.y<-RBOUND) b.y+=2*RBOUND; if(b.y>RBOUND) b.y-=2*RBOUND; }
        else if(bounds==='reflect'){ if(b.x<-RBOUND||b.x>RBOUND){ b.vx*=-1; b.x=Math.max(-RBOUND,Math.min(RBOUND,b.x)); } if(b.y<-RBOUND||b.y>RBOUND){ b.vy*=-1; b.y=Math.max(-RBOUND,Math.min(RBOUND,b.y)); } }
      }
    }
    computeAccelerations(bodies,G,eps2);
    for(const b of bodies){ b.vx += 0.5*dt*b.ax; b.vy += 0.5*dt*b.ay; }
    w.step++;
  }

  function worldToScreen(x,y){
    const c = Math.cos(world.cam.angle), s = Math.sin(world.cam.angle);
    const rx =  (x - world.cam.x)*c + (y - world.cam.y)*s;
    const ry = -(x - world.cam.x)*s + (y - world.cam.y)*c;
    return [ canvas.width/2 + rx*world.cam.scale, canvas.height/2 - ry*world.cam.scale ];
  }

  function render(){
    if(ctl.trails.value==='off'){ ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle='rgba(11,16,32,0.22)'; ctx.fillRect(0,0,canvas.width,canvas.height); }
    else { ctx.fillStyle='rgba(5,8,17,0.08)'; ctx.fillRect(0,0,canvas.width,canvas.height); }

    ctx.strokeStyle='#223'; ctx.lineWidth=1;
    let a=worldToScreen(-1000,0), b=worldToScreen(1000,0); ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();
    a=worldToScreen(0,-1000); b=worldToScreen(0,1000); ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.stroke();

    const rPix=parseFloat(ctl.radius.value)||2;
    for(const bo of world.bodies){
      const [sx,sy]=worldToScreen(bo.x,bo.y);
      ctx.beginPath(); const rad = rPix + Math.log10(1+bo.m)*0.6;
      ctx.arc(sx,sy,rad,0,Math.PI*2); ctx.fillStyle=bo.color; ctx.fill();
    }
  }

  function computeStats(){
    const bodies=world.bodies;
    const G=parseFloat(ctl.G.value)||1, eps2=Math.pow(parseFloat(ctl.eps.value)||0.02,2);
    let K=0,U=0,Px=0,Py=0;
    for(const b of bodies){ K+=0.5*b.m*(b.vx*b.vx+b.vy*b.vy); Px+=b.m*b.vx; Py+=b.m*b.vy; }
    for(let i=0;i<bodies.length;i++){ for(let j=i+1;j<bodies.length;j++){ const bi=bodies[i], bj=bodies[j]; const dx=bj.x-bi.x, dy=bj.y-bi.y; const r=Math.sqrt(dx*dx+dy*dy+eps2); U += -G*bi.m*bj.m/r; } }
    ctl.statStep.textContent = String(world.step);
    ctl.statE.textContent = (K+U).toFixed(3);
    ctl.statP.textContent = Math.hypot(Px,Py).toFixed(3);
  }

  function reset(){
    const n=parseInt(ctl.nBodies.value,10)||200;
    const mMin=parseFloat(ctl.mMin.value)||0.5, mMax=parseFloat(ctl.mMax.value)||3, radius=parseFloat(ctl.spawnR.value)||0.45;
    world.bodies = createBodies(n,{mMin,mMax,radius,preset:ctl.preset.value});
    world.step=0; computeAccelerations(world.bodies, parseFloat(ctl.G.value)||1, Math.pow(parseFloat(ctl.eps.value)||0.02,2));
    overlay.textContent='Running… (Space to pause)';
    log('Reset — bodies='+world.bodies.length);
  }

  function addBodies(k=50){
    world.bodies.push(...createBodies(k,{ mMin:parseFloat(ctl.mMin.value)||0.5, mMax:parseFloat(ctl.mMax.value)||3, radius:parseFloat(ctl.spawnR.value)||0.45, preset:'random' }));
    log('Added '+k+' bodies — total='+world.bodies.length);
  }

  function togglePause(){
    world.paused = !world.paused;
    ctl.btnPause.textContent = world.paused ? '⏵ Resume' : '⏸ Pause';
    overlay.textContent = world.paused ? 'Paused (Space to resume)' : 'Running… (Space to pause)';
    log(world.paused ? 'Paused' : 'Running');
  }

  ctl.btnStart.addEventListener('click',()=>{ world.paused=false; log('Start clicked'); });
  ctl.btnPause.addEventListener('click',togglePause);
  ctl.btnReset.addEventListener('click',reset);
  ctl.btnAdd.addEventListener('click',()=>addBodies(50));
  ctl.btnClear.addEventListener('click',()=>{ world.bodies.length=0; world.step=0; log('Cleared bodies'); });
  ctl.btnRebuildStart.addEventListener('click',()=>{ reset(); world.paused=false; });
  ctl.btnResetSettings.addEventListener('click',()=>{
    Object.entries(DEFAULTS).forEach(([k,v])=>{ if(ctl[k]) ctl[k].value=String(v); });
    world.cam = {x:0,y:0,scale:240,angle:0};
    drawTrackball(); updateTbLabels();
    reset();
  });
  ctl.btnCameraDefaults.addEventListener('click',()=>{ world.cam={x:0,y:0,scale:240,angle:0}; drawTrackball(); updateTbLabels(); });

  ['preset','nBodies','seed','mMin','mMax','spawnR'].forEach(id=>{
    document.getElementById(id).addEventListener('change',()=>{ reset(); log('Rebuilt after control change'); });
  });

  // init
  reset();
  drawTrackball(); updateTbLabels();
  let last=performance.now(), acc=0, frames=0;
  function loop(t){
    const dt=t-last; last=t;
    if(!world.paused){ stepSystem(world); if(world.step%4===0) computeStats(); }
    render();
    frames++; acc+=dt; if(acc>=500){ document.getElementById('statFPS').textContent = String(Math.round(frames/(acc/1000))); frames=0; acc=0; }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();