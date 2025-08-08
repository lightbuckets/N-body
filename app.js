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
    camZoom: $('camZoom'), camAngle: $('camAngle'), camX: $('camX'), camY: $('camY'), camPanSpeed: $('camPanSpeed'),
    btnCameraCenter: $('btnCameraCenter'), btnCameraDefaults: $('btnCameraDefaults'),
    btnStart: $('btnStart'), btnPause: $('btnPause'), btnReset: $('btnReset'), btnAdd: $('btnAdd'), btnClear: $('btnClear'),
    btnRebuildStart: $('btnRebuildStart'), btnResetSettings: $('btnResetSettings'),
    statStep: $('statStep'), statE: $('statE'), statP: $('statP'), statFPS: $('statFPS')
  };

  const DEFAULTS = {
    preset:'random', nBodies:200, seed:42, mMin:0.5, mMax:3, spawnR:0.45,
    G:1, dt:0.02, eps:0.02, speed:1, collisions:'merge', bounds:'open',
    trails:'short', radius:2, camZoom:240, camAngle:0, camX:0, camY:0, camPanSpeed:1
  };
  function applyDefaults(){
    Object.entries(DEFAULTS).forEach(([k,v])=>{
      if(ctl[k] instanceof HTMLInputElement || ctl[k] instanceof HTMLSelectElement){ ctl[k].value = String(v); }
    });
  }

  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const rand = (seed => {
    function m32(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296}}
    let prng = m32(seed||1);
    return { reseed(s){ prng = m32((s>>>0)||1) }, f(){ return prng() }, range(min,max){ return min+(max-min)*prng() }, norm(){ let u=0,v=0;while(u===0)u=prng();while(v===0)v=prng(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);} };
  })(42);

  let world = {
    bodies: [], step: 0, paused: false,
    cam: { x: parseFloat(ctl.camX.value)||0, y: parseFloat(ctl.camY.value)||0, scale: parseFloat(ctl.camZoom.value)||240, angle: 0 }
  };

  function resetCamera(){
    world.cam.x = parseFloat(ctl.camX.value)||0;
    world.cam.y = parseFloat(ctl.camY.value)||0;
    world.cam.scale = parseFloat(ctl.camZoom.value)||240;
    world.cam.angle = (parseFloat(ctl.camAngle.value)||0) * Math.PI/180;
  }
  resetCamera();

  function worldToScreen(x,y){
    const c = Math.cos(world.cam.angle), s = Math.sin(world.cam.angle);
    const rx =  (x - world.cam.x)*c + (y - world.cam.y)*s;
    const ry = -(x - world.cam.x)*s + (y - world.cam.y)*c;
    return [ canvas.width/2 + rx*world.cam.scale, canvas.height/2 - ry*world.cam.scale ];
  }

  let dragging=false, lx=0, ly=0;
  canvas.addEventListener('mousedown',e=>{ dragging=true; lx=e.clientX; ly=e.clientY; });
  window.addEventListener('mouseup',()=>{ dragging=false; });
  window.addEventListener('mousemove',e=>{
    if(!dragging) return;
    const dx=e.clientX-lx, dy=e.clientY-ly; lx=e.clientX; ly=e.clientY;
    const c=Math.cos(world.cam.angle), s=Math.sin(world.cam.angle);
    const wx = (-dx/world.cam.scale)*c + (dy/world.cam.scale)*s;
    const wy = (-dx/world.cam.scale)*s - (dy/world.cam.scale)*c;
    world.cam.x += wx; world.cam.y += wy;
    ctl.camX.value = world.cam.x.toFixed(2); ctl.camY.value = world.cam.y.toFixed(2);
  });
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    const factor = Math.exp(-e.deltaY*0.001);
    world.cam.scale = clamp(world.cam.scale*factor, 60, 4000);
    ctl.camZoom.value = String(Math.round(world.cam.scale));
  }, {passive:false});

  window.addEventListener('keydown',e=>{
    const sp = parseFloat(ctl.camPanSpeed.value)||1;
    const step = 0.02 * sp;
    if(e.code==='ArrowUp'){ pan(0, +step); }
    if(e.code==='ArrowDown'){ pan(0, -step); }
    if(e.code==='ArrowLeft'){ pan(+step, 0); }
    if(e.code==='ArrowRight'){ pan(-step, 0); }
    if(e.key==='+'){ zoom(1.1); }
    if(e.key==='-'){ zoom(1/1.1); }
    if(e.code==='KeyQ'){ rotate(+2); }
    if(e.code==='KeyE'){ rotate(-2); }
    if(e.code==='KeyC'){ cameraDefaults(); }
    if(e.code==='Space'){ togglePause(); }
    if(e.code==='KeyR'){ reset(); }
  });

  function pan(dx,dy){
    const c=Math.cos(world.cam.angle), s=Math.sin(world.cam.angle);
    const wx = dx*c - dy*s;
    const wy = dx*s + dy*c;
    world.cam.x += wx; world.cam.y += wy;
    ctl.camX.value = world.cam.x.toFixed(2); ctl.camY.value = world.cam.y.toFixed(2);
  }
  function zoom(mult){
    world.cam.scale = clamp(world.cam.scale*mult, 60, 4000);
    ctl.camZoom.value = String(Math.round(world.cam.scale));
  }
  function rotate(deg){
    const rad = (deg*Math.PI/180);
    world.cam.angle = ((world.cam.angle + rad + Math.PI)%(2*Math.PI)) - Math.PI;
    ctl.camAngle.value = String(Math.round(world.cam.angle*180/Math.PI));
  }
  function cameraDefaults(){
    ctl.camZoom.value = String(DEFAULTS.camZoom);
    ctl.camAngle.value = String(DEFAULTS.camAngle);
    ctl.camX.value = String(DEFAULTS.camX);
    ctl.camY.value = String(DEFAULTS.camY);
    resetCamera();
  }

  ctl.camZoom.addEventListener('input',()=>{ world.cam.scale = parseFloat(ctl.camZoom.value)||240; });
  ctl.camAngle.addEventListener('input',()=>{ world.cam.angle = (parseFloat(ctl.camAngle.value)||0)*Math.PI/180; });
  ctl.camX.addEventListener('change',()=>{ world.cam.x = parseFloat(ctl.camX.value)||0; });
  ctl.camY.addEventListener('change',()=>{ world.cam.y = parseFloat(ctl.camY.value)||0; });
  ctl.btnCameraCenter.addEventListener('click',()=>cameraDefaults());
  ctl.btnCameraDefaults.addEventListener('click',()=>cameraDefaults());

  const palette=['#a4b9ff','#9fe2ff','#ffd27f','#ff9fb2','#d6ff9f','#c6a8ff','#9fffd8'];
  const pick=i=>palette[i%palette.length];
  function createBodies(n, opts){
    const out=[]; const { mMin=0.5, mMax=3, radius=0.45, preset='random' } = opts||{}; const r=radius;
    function push(x,y,vx,vy,m,c){ out.push({x,y,vx,vy,ax:0,ay:0,m,color:c,trail:[]}); }
    if(preset==='random'){
      for(let i=0;i<n;i++){ const a=rand.f()*2*Math.PI, rr=r*(0.2+0.8*Math.sqrt(rand.f()));
        const x=rr*Math.cos(a), y=rr*Math.sin(a), m=rand.range(mMin,mMax);
        push(x,y, rand.norm()*0.2, rand.norm()*0.2, m, pick(i)); }
    }else if(preset==='disk'){
      const G=parseFloat(ctl.G.value)||1;
      for(let i=0;i<n;i++){ const rr=r*Math.sqrt(rand.f()), a=rand.f()*2*Math.PI;
        const x=rr*Math.cos(a), y=rr*Math.sin(a), m=rand.range(mMin,mMax);
        const v=0.6*Math.sqrt(G * (i+1)/n / Math.max(rr,0.01));
        push(x,y, -v*Math.sin(a), v*Math.cos(a), m, pick(i)); }
      push(0,0,0,0, Math.max(mMax*10,20), '#ffd27f');
    }else if(preset==='binary'){
      const M=Math.max(mMax*10,20); push(-0.2,0,0,-0.4,M,'#ffd27f'); push(0.2,0,0,0.4,M,'#ffd27f');
      for(let i=0;i<n;i++){ const a=rand.f()*2*Math.PI, rr=0.9*r*Math.sqrt(rand.f());
        const x=rr*Math.cos(a), y=rr*Math.sin(a), m=rand.range(mMin,mMax);
        push(x,y, rand.norm()*0.1, rand.norm()*0.1, m, pick(i)); }
    }else if(preset==='solar'){
      const G=parseFloat(ctl.G.value)||1;
      push(0,0,0,0,100,'#ffd27f');
      const planets=Math.min(8, Math.max(1, Math.floor(n/20)));
      for(let i=0;i<planets;i++){ const a=rand.f()*2*Math.PI, rr=0.1+(i+1)*0.07; const v=Math.sqrt(G*100/rr);
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
    const G=parseFloat(ctl.G.value)||1;
    const eps2=Math.pow(parseFloat(ctl.eps.value)||0.02,2);
    const dt=(parseFloat(ctl.dt.value)||0.02) * (parseFloat(ctl.speed.value)||1);
    const bounds=ctl.bounds.value; const RBOUND=2.2;
    const bodies=w.bodies;
    for(const b of bodies){ b.vx += 0.5*dt*b.ax; b.vy += 0.5*dt*b.ay; b.x += dt*b.vx; b.y += dt*b.vy; }
    if(bounds!=='open'){
      for(const b of bodies){
        if(bounds==='wrap'){ if(b.x<-RBOUND) b.x+=2*RBOUND; if(b.x>RBOUND) b.x-=2*RBOUND; if(b.y<-RBOUND) b.y+=2*RBOUND; if(b.y>RBOUND) b.y-=2*RBOUND; }
        else if(bounds==='reflect'){ if(b.x<-RBOUND||b.x>RBOUND){ b.vx*=-1; b.x=clamp(b.x,-RBOUND,RBOUND);} if(b.y<-RBOUND||b.y>RBOUND){ b.vy*=-1; b.y=clamp(b.y,-RBOUND,RBOUND);} }
      }
    }
    computeAccelerations(bodies,G,eps2);
    for(const b of bodies){ b.vx += 0.5*dt*b.ax; b.vy += 0.5*dt*b.ay; }
    w.step++;
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
    rand.reseed(parseInt(ctl.seed.value,10)||1);
    const n=parseInt(ctl.nBodies.value,10)||200;
    world.bodies = createBodies(n,{ mMin:parseFloat(ctl.mMin.value)||0.5, mMax:parseFloat(ctl.mMax.value)||3, radius:parseFloat(ctl.spawnR.value)||0.45, preset:ctl.preset.value });
    world.step=0; computeAccelerations(world.bodies, parseFloat(ctl.G.value)||1, Math.pow(parseFloat(ctl.eps.value)||0.02,2));
    overlay.textContent='Running… (Space to pause)';
    log('Reset — bodies='+world.bodies.length);
  }

  function addBodies(k=50){
    rand.reseed((rand.f()*1e9)|0);
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
  ctl.btnResetSettings.addEventListener('click',()=>{ applyDefaults(); resetCamera(); reset(); log('Settings reset to defaults.'); });

  ['preset','nBodies','seed','mMin','mMax','spawnR'].forEach(id=>{
    $(id).addEventListener('change',()=>{ reset(); log('Rebuilt after control change'); });
  });

  applyDefaults();
  resetCamera();
  reset();
  world.paused=false; ctl.btnPause.textContent='⏸ Pause'; overlay.textContent='Running… (Space to pause)';

  let last=performance.now(), acc=0, frames=0;
  function loop(t){
    const dt=t-last; last=t;
    if(!world.paused){ stepSystem(world); if(world.step%4===0) computeStats(); }
    render();
    frames++; acc+=dt; if(acc>=500){ ctl.statFPS.textContent = String(Math.round(frames/(acc/1000))); frames=0; acc=0; }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();