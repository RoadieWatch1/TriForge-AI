// Webview client-side JS — extracted from panel.ts.
// Accepts lsCheckout so the license checkout URL is injected at build time.
export function buildClientScript(lsCheckout: string): string {
  return `
(function(){
'use strict';
try {
const vs = acquireVsCodeApi();
function send(cmd, d){ vs.postMessage(Object.assign({command:cmd}, d||{})); }

// State
var LS_CHECKOUT='${lsCheckout}';
const S = { phase:'IDLE', intensity:'adaptive', providers:{}, debOpen:false, running:false, councilMode:'FULL', dlVersions:[], audioEnabled:true, wsFiles:[], ctxFiles:[], promptHistory:[], upgradeUrl:'', reviewRuntime:null };
const PH_ORD = ['DRAFTING','RISK_CHECK','CRITIQUE','DEBATE','COMPLETE'];

// DOM
function $(i){ return document.getElementById(i); }
function show(i){ const e=$(i); if(e){ e.classList.remove('hidden'); } }
function hide(i){ const e=$(i); if(e){ e.classList.add('hidden'); } }
function txt(i,t){ const e=$(i); if(e){ e.textContent=t; } }
function cod(i,t){ const e=$(i); if(e){ e.textContent=t||''; } }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// Centralized run-button state — call instead of mutating S.running + btn visibility inline
function setRunning(running){
  S.running = running;
  var run=$('btn-run'), rvw=$('btn-run-review'), abt=$('btn-abort');
  if(run){ run.style.display = running ? 'none' : ''; }
  if(rvw){ rvw.style.display = running ? 'none' : ''; }
  if(abt){ abt.style.display = running ? '' : 'none'; }
}

function pLbl(n){ return n==='openai'?'GPT':n==='claude'?'Claude':'Grok'; }
function pCls(n){ return n==='openai'?'p-gpt':n==='claude'?'p-cld':'p-grk'; }
function rCls(r){ return 'r-'+(r||'low').toLowerCase().slice(0,4); }
function cCls(c){ return 'c-'+(c||'unani').toLowerCase().slice(0,5); }

// Provider dots
function updDots(st){
  ['openai','claude','grok'].forEach(function(p){
    const e=$('d-'+p);
    if(!e){ return; }
    st[p]? e.classList.add('on'): e.classList.remove('on');
  });
  S.providers=st;
}

// Phase steps
function updSteps(ph){
  const idx=PH_ORD.indexOf(ph);
  document.querySelectorAll('.ps').forEach(function(el){
    const pi=PH_ORD.indexOf(el.dataset.ph);
    el.classList.remove('active','done');
    if(el.dataset.ph===ph){ el.classList.add('active'); }
    else if(pi<idx){ el.classList.add('done'); }
  });
}

// Node states
function setNode(prov, state){
  const nid='vn-'+(prov==='openai'?'gpt':prov);
  const bid='bm-'+(prov==='openai'?'gpt':prov);
  const n=$(nid), b=$(bid);
  if(n){ n.classList.remove('drafting','reviewing','agreed','disagreed','offline','analyzing','challenging','voting','synthesizing'); if(state){ n.classList.add(state); } }
  if(b){ b.classList.remove('fl'); if(state==='drafting'||state==='reviewing'||state==='analyzing'||state==='voting'){ b.classList.add('fl'); } }
}
function setForge(st){
  const f=$('vn-forge');
  if(!f){ return; }
  f.classList.remove('forge-pulse','forge-unani','forge-split','forge-deadlock');
  if(st){ f.classList.add(st); }
}
function resetNodes(){
  ['claude','gpt','grok'].forEach(function(p){
    const n=$('vn-'+p), b=$('bm-'+p);
    if(n){ n.classList.remove('drafting','reviewing','agreed','disagreed','offline','analyzing','challenging','voting','synthesizing'); }
    if(b){ b.classList.remove('fl'); }
  });
  setForge(null);
}

// Phase handler
function onPhase(d){
  S.phase=d.phase;
  if(d.message){ txt('pmsg', d.message); }

  if(d.phase==='IDLE'||d.phase==='BYPASSED'||d.phase==='COMPLETE'){
    const viz=$('s-viz'); if(viz){ viz.classList.remove('depth-active'); }
    ['claude','gpt','grok'].forEach(function(p){ const n=$('vn-'+p); if(n){ n.classList.remove('depth-on'); } });
    document.body.classList.remove('ruthless-active');
    if(d.phase!=='COMPLETE'){
      var ca=$('center-active'), ci=$('center-idle'), tp=$('topbar-phase');
      if(ca){ ca.classList.add('hidden'); }
      if(ci){ ci.classList.remove('hidden'); }
      if(tp){ tp.classList.remove('active'); }
      setRunning(false);
      resetNodes();
    }
    if(d.phase==='BYPASSED'){ const b=$('bypass-b'); if(b){ b.style.display='block'; } }
    return;
  }

  setRunning(true);
  var ca2=$('center-active'), ci2=$('center-idle'), tp2=$('topbar-phase');
  if(ca2){ ca2.classList.remove('hidden'); }
  if(ci2){ ci2.classList.add('hidden'); }
  if(tp2){ tp2.classList.add('active'); }
  show('s-viz');
  updSteps(d.phase);

  // Depth activation during cognition
  const viz=$('s-viz'); if(viz){ viz.classList.add('depth-active'); }
  ['openai','claude','grok'].forEach(function(p){ if(S.providers[p]){ const nid='vn-'+(p==='openai'?'gpt':p); const n=$(nid); if(n){ n.classList.add('depth-on'); } } });
  if(S.intensity==='ruthless'){ document.body.classList.add('ruthless-active'); }

  if(d.phase==='DRAFTING'){
    // Clear stale views from other pipelines before legacy council starts
    clearGovernedWorkflowView();
    hide('s-review-runtime');
    clearReviewRuntimeView();
    resetNodes();
    const prim=S.providers['grok']?'grok':S.providers['openai']?'openai':'claude';
    setNode(prim,'drafting');
    // Re-apply depth after reset
    ['openai','claude','grok'].forEach(function(p){ if(S.providers[p]){ const nid='vn-'+(p==='openai'?'gpt':p); const n=$(nid); if(n){ n.classList.add('depth-on'); } } });
  } else if(d.phase==='CRITIQUE'){
    ['openai','claude','grok'].forEach(function(p){ if(S.providers[p]){ setNode(p,'analyzing'); } });
  } else if(d.phase==='DEBATE'){
    ['openai','claude','grok'].forEach(function(p){ if(S.providers[p]){ setNode(p,'voting'); } });
    setForge('forge-pulse');
  }
}

// Draft handler
function onDraft(dr){
  const pb=$('dp-badge');
  if(pb){ pb.textContent=pLbl(dr.provider); pb.className='badge '+pCls(dr.provider); }
  const rb=$('dr-badge');
  if(rb){ rb.textContent=dr.preliminaryRisk; rb.className='badge '+rCls(dr.preliminaryRisk); }
  const cb=$('dc-badge');
  if(cb){ cb.textContent=dr.confidence+'%'; }
  txt('d-reason', dr.reasoning);
  cod('d-code', dr.code);
  // Populate per-column draft
  var p=dr.provider;
  var rea=$('col-rea-'+p); if(rea){ rea.textContent=dr.reasoning||''; }
  var codel=$('col-code-'+p); if(codel){ codel.textContent=dr.code||''; }
  var draftEl=$('col-draft-'+p); if(draftEl){ draftEl.style.display='block'; }
  var idleEl=$('col-idle-'+p); if(idleEl){ idleEl.style.display='none'; }
  var stEl=$('col-state-'+p); if(stEl){ stEl.textContent='drafting'; stEl.className='ai-state st-drafting'; }
  setNode(dr.provider, 'drafting');
}

// Risk handler
function onRisk(r){
  const rb=$('rl-badge');
  if(rb){ rb.textContent=r.level; rb.className='badge '+rCls(r.level); }
  const ul=$('rtlist');
  if(ul){
    ul.innerHTML='';
    const tgs=r.triggers||[];
    if(tgs.length===0){
      const li=document.createElement('li'); li.textContent='No risk factors detected.'; li.className='ok'; ul.appendChild(li);
    } else {
      tgs.forEach(function(t){ const li=document.createElement('li'); li.textContent=t; ul.appendChild(li); });
    }
  }
  // Show risk summary in all active provider columns
  var summary=(r.level||'')+(r.triggers&&r.triggers.length?' — '+r.triggers.slice(0,2).join(', '):'');
  ['openai','claude','grok'].forEach(function(p){
    if(S.providers[p]){
      var rlbl=$('col-risk-lbl-'+p); if(rlbl){ rlbl.textContent=summary; }
      var rEl=$('col-risk-'+p); if(rEl){ rEl.style.display='block'; }
      var stEl=$('col-state-'+p); if(stEl){ stEl.textContent='risk·'+r.level; stEl.className='ai-state'; }
    }
  });
}

// Verdict handler
function onVerdict(v){
  show('s-agree');
  if(!v.agrees){
    setNode(v.provider,'challenging');
    setTimeout(function(){ setNode(v.provider,'disagreed'); }, 400);
  } else {
    setNode(v.provider,'agreed');
  }
  // Update column state badge
  var stEl=$('col-state-'+v.provider);
  if(stEl){ stEl.textContent=v.agrees?'agreed':'disagrees'; stEl.className='ai-state '+(v.agrees?'st-agreed':'st-disagrees'); }
  // Build card HTML
  var objH=(v.agrees||!v.objections||!v.objections.length)?'':
    '<ul class="vobjl">'+v.objections.slice(0,3).map(function(o){ return '<li>'+esc(o)+'</li>'; }).join('')+'</ul>';
  var sugH=(v.agrees&&v.suggestedChanges&&v.suggestedChanges.length)?
    '<ul class="vsugl">'+v.suggestedChanges.slice(0,2).map(function(c){ return '<li>'+esc(c)+'</li>'; }).join('')+'</ul>':'';
  var altH=(!v.agrees)?
    '<button class="btn-s" style="font-size:11px;padding:3px 8px;margin-top:5px;" data-action="reqAlt" data-provider="'+esc(v.provider)+'">Ask '+esc(pLbl(v.provider))+' for Alternative</button>':'';
  var inner=
    '<div class="vrow">'+
      '<span class="vicon">'+(v.agrees?'&#x2713;':'&#x2717;')+'</span>'+
      '<span class="vpro '+pCls(v.provider)+'">'+esc(pLbl(v.provider))+'</span>'+
      '<span class="vcon">'+v.confidence+'% confidence</span>'+
      '<span class="badge '+rCls(v.riskLevel)+'" style="margin-left:auto;">'+esc(v.riskLevel)+'</span>'+
    '</div>'+objH+sugH+altH;
  // Append to hidden vcards (export compat)
  var vc=$('vcards');
  if(vc){ var c1=document.createElement('div'); c1.className='vcard '+(v.agrees?'ag':'dis'); c1.innerHTML=inner; vc.appendChild(c1); }
  // Append to per-column cards
  var cc=$('col-cards-'+v.provider);
  if(cc){ var c2=document.createElement('div'); c2.className='col-card '+(v.agrees?'ag':'dis'); c2.innerHTML=inner; cc.appendChild(c2); }
}

// Debate handler
function onDebate(db){
  txt('db-prop', db.proposal); txt('db-crit', db.critique);
  txt('db-rev',  db.revision); txt('db-fin',  db.final);
  txt('db-c1', db.confidenceInitial+'%');
  txt('db-c2', db.confidenceAfterCritique+'%');
  txt('db-c3', db.confidenceFinal+'%');
  const delta=db.confidenceFinal-db.confidenceInitial;
  const dt=$('db-dt');
  if(dt){ dt.textContent=(delta>=0?'+':'')+delta+'%'; dt.className='cd '+(delta>=0?'up':'down'); }
  if(db.finalCode){ cod('db-fcode', db.finalCode); const fc=$('db-fcode'); if(fc){ fc.style.display='block'; } }
  show('s-debate');
  setForge(null);
}

// Complete handler
function onComplete(d){
  setRunning(false); S.phase='COMPLETE';
  updSteps('COMPLETE');
  const viz=$('s-viz'); if(viz){ viz.classList.remove('depth-active'); }
  ['claude','gpt','grok'].forEach(function(p){ const n=$('vn-'+p); if(n){ n.classList.remove('depth-on'); } });
  document.body.classList.remove('ruthless-active');
  if(d.consensus==='UNANIMOUS'){
    setForge('forge-unani');
    ['openai','claude','grok'].forEach(function(p){ if(S.providers[p]){ setNode(p,'agreed'); } });
    playConsensusTone();
  } else if(d.consensus==='SPLIT'||d.consensus==='BLOCKED'){
    setForge('forge-split');
  } else { setForge(null); }
  const cb=$('cs-badge');
  if(cb){ cb.textContent=d.consensus; cb.className='badge '+cCls(d.consensus); }
  cod('r-code', d.finalCode);
  const rc=$('rc-badge');
  if(rc){ rc.textContent=d.consensus; rc.className='badge '+cCls(d.consensus); }
  // Remove phase bar, show right-panel result
  var tp3=$('topbar-phase'); if(tp3){ tp3.classList.remove('active'); }
  hide('right-idle');
  show('s-result');
}

// Alternative handler
function onAlt(a){
  const pb=$('ap-badge'); if(pb){ pb.textContent=pLbl(a.provider); pb.className='badge '+pCls(a.provider); }
  const cb=$('ac-badge'); if(cb){ cb.textContent=a.confidence+'%'; }
  const rb=$('ar-badge'); if(rb){ rb.textContent=a.riskLevel; rb.className='badge '+rCls(a.riskLevel); }
  txt('a-reason', a.reasoning);
  cod('a-code', a.implementation);
  show('s-alt');
}

// Council mode handler
function onCouncilMode(d){
  S.councilMode=d.mode;
  const b=$('cm-badge');
  if(!b){ return; }
  b.textContent=d.mode;
  b.className='badge cm-'+d.mode.toLowerCase();
  b.classList.remove('hidden');
}

// Provider offline handler
function onProviderOffline(d){
  setNode(d.provider, 'offline');
}

// Intensity resolved (adaptive auto-detection)
function onIntensityResolved(d){
  const lvl=d.level.toLowerCase();
  document.querySelectorAll('.ibtn').forEach(function(b){ b.classList.remove('on'); });
  const ab=document.querySelector('.ibtn[data-i="'+lvl+'"]');
  if(ab){ ab.classList.add('on'); }
  const al=$('i-auto-lbl');
  if(al){ al.textContent='(Auto: '+d.level+')'; al.classList.remove('hidden'); }
  S.intensity=lvl;
}

// Deadlock handler
function onDeadlock(d){
  S.dlVersions=d.versions||[];
  hide('s-phase');
  show('s-deadlock');
  setForge('forge-deadlock');
  // Pre-populate version cards (hidden until user picks "User Breaks Tie")
  const vc=$('version-cards');
  if(vc){
    vc.innerHTML='';
    S.dlVersions.forEach(function(v,i){
      const lbl=String.fromCharCode(65+i);
      const card=document.createElement('div');
      card.className='vc-card';
      card.innerHTML=
        '<div class="vc-header">'+
          '<span class="badge '+pCls(v.provider)+'">'+esc(pLbl(v.provider))+'</span>'+
          '<span style="font-size:11px;color:rgba(255,255,255,0.4);">Version '+esc(lbl)+'</span>'+
          '<span style="font-size:11px;color:rgba(255,255,255,0.45);flex:1;">'+esc(v.reasoning)+'</span>'+
          '<button class="btn-s" style="font-size:11px;padding:3px 9px;" data-action="selectVersion" data-provider="'+esc(v.provider)+'">Select</button>'+
        '</div>'+
        '<div class="vc-code">'+esc((v.code||'').slice(0,200))+'</div>';
      vc.appendChild(card);
    });
  }
}

// Synthesis rationale
function onSynthesisReady(d){
  txt('synth-rationale', d.rationale||'');
  show('s-synth-note');
  ['openai','claude','grok'].forEach(function(p){ if(S.providers[p]){ setNode(p,'synthesizing'); } });
  setTimeout(function(){ ['openai','claude','grok'].forEach(function(p){ if(S.providers[p]){ setNode(p,'reviewing'); } }); }, 1500);
  playConsensusTone();
}

// File explorer
function renderFileList(q){
  var fl=$('file-list'); if(!fl){ return; }
  var list=S.wsFiles;
  if(q){ list=list.filter(function(f){ return f.rel.toLowerCase().indexOf(q.toLowerCase())>=0; }); }
  fl.innerHTML='';
  list.slice(0,120).forEach(function(f){
    var on=S.ctxFiles.indexOf(f.rel)>=0;
    var div=document.createElement('div');
    div.className='fitem'+(on?' ctx-on':'');
    div.title=f.rel;
    div.innerHTML='<span class="fext">'+esc(f.lang||'')+'</span><span class="fname">'+esc(f.rel)+'</span>';
    div.addEventListener('click',function(){ send(on?'workspace:removeContext':'workspace:addContext',{relPath:f.rel}); });
    fl.appendChild(div);
  });
  if(list.length===0){ fl.innerHTML='<div style="font-size:11px;color:rgba(255,255,255,0.3);padding:4px 6px;">No files found.</div>'; }
}
function onWorkspaceTree(d){
  S.wsFiles=d.files||[];
  renderFileList(($('file-search')||{}).value||'');
}
function onContextUpdated(d){
  S.ctxFiles=d.contextFiles||[];
  var cc=$('ctx-count'), cb=$('btn-ctx-clear');
  if(cc){ if(S.ctxFiles.length){ cc.textContent=S.ctxFiles.length+' file'+(S.ctxFiles.length!==1?'s':''); cc.classList.remove('hidden'); } else { cc.classList.add('hidden'); } }
  if(cb){ cb.style.display=S.ctxFiles.length?'inline-block':'none'; }
  var cf=$('ctx-files'); if(!cf){ return; }
  cf.innerHTML='';
  S.ctxFiles.forEach(function(rel){
    var tag=document.createElement('div'); tag.className='ctx-tag';
    var lbl=document.createElement('span'); lbl.title=rel; lbl.textContent=rel;
    var rm=document.createElement('button'); rm.className='ctx-rm'; rm.title='Remove'; rm.textContent='\u00d7';
    rm.addEventListener('click',function(){ send('workspace:removeContext',{relPath:rel}); });
    tag.appendChild(lbl); tag.appendChild(rm);
    cf.appendChild(tag);
  });
  renderFileList(($('file-search')||{}).value||'');
}

// Git helpers
function mkGFile(f,type){
  var div=document.createElement('div'); div.className='gfile gfile-'+type;
  var btn=document.createElement('button'); btn.className='gbtn';
  if(type==='staged'){
    btn.textContent='Unstage';
    btn.addEventListener('click',function(){ send('git:unstage',{file:f}); });
  } else {
    btn.textContent='Stage';
    btn.addEventListener('click',function(){ send('git:stage',{file:f}); });
  }
  var nm=document.createElement('span'); nm.className='gname'; nm.title=f; nm.textContent=f;
  div.appendChild(btn); div.appendChild(nm);
  return div;
}
function onGitStatus(d){
  var bb=$('git-branch');
  if(bb){ if(d.branch){ bb.textContent=d.branch; bb.style.display='inline'; } else { bb.style.display='none'; } }
  var stgS=$('git-staged-sec'), stg=$('git-staged');
  if(d.staged&&d.staged.length){
    if(stgS){ stgS.style.display='block'; }
    if(stg){ stg.innerHTML=''; d.staged.forEach(function(f){ stg.appendChild(mkGFile(f,'staged')); }); }
  } else { if(stgS){ stgS.style.display='none'; } }
  var chS=$('git-changes-sec'), ch=$('git-changes');
  var allCh=(d.modified||[]).concat(d.untracked||[]);
  if(allCh.length){
    if(chS){ chS.style.display='block'; }
    if(ch){
      ch.innerHTML='';
      (d.modified||[]).forEach(function(f){ ch.appendChild(mkGFile(f,'changed')); });
      (d.untracked||[]).forEach(function(f){ ch.appendChild(mkGFile(f,'untracked')); });
    }
  } else { if(chS){ chS.style.display='none'; } }
  var ma=$('git-msg-area');
  var total=(d.staged||[]).length+allCh.length;
  if(ma){ ma.textContent=total?'':'Working tree clean.'; ma.style.display=total?'none':'block'; }
}

function onLicenseStatus(s){
  if(!s){ return; }
  var badge=$('lic-badge'),msg=$('lic-msg'),trialBar=$('lic-trial-bar'),
      keyRow=$('lic-key-row'),activeRow=$('lic-active-row'),keyDisp=$('lic-key-disp'),
      daysEl=$('lic-days'),prog=$('lic-prog'),lg=$('lic-gate');
  [trialBar,keyRow,activeRow].forEach(function(el){ if(el){ el.style.display='none'; } });
  if(badge){ badge.className=''; }
  if(lg){ lg.style.display='none'; }
  if(s.state==='active'){
    if(badge){ badge.classList.add('lic-active'); badge.textContent='PRO'; }
    if(msg){ msg.textContent=s.statusLabel||''; }
    if(activeRow){ activeRow.style.display='flex'; }
    if(keyDisp){ keyDisp.textContent=s.licenseKey||''; }
  } else if(s.state==='trial'){
    if(badge){ badge.classList.add('lic-trial'); badge.textContent='TRIAL'; }
    if(msg){ msg.textContent=s.statusLabel||''; }
    if(trialBar){ trialBar.style.display='block'; }
    if(daysEl){ daysEl.textContent=(s.trialDaysLeft||0)+' days'; }
    var pct=Math.max(0,Math.min(100,((s.trialDaysLeft||0)/7)*100));
    if(prog){ prog.style.width=pct+'%'; prog.style.background=pct<30?'#ef4444':pct<60?'#f59e0b':'linear-gradient(90deg,#6366f1,#10b981)'; }
  } else {
    if(badge){ badge.classList.add('lic-expired'); badge.textContent='EXPIRED'; }
    if(msg){ msg.textContent=s.statusLabel||''; }
    if(keyRow){ keyRow.style.display='flex'; }
  }
}
function onBranches(d){
  var sel=$('git-branch-select'); if(!sel){ return; }
  sel.innerHTML='';
  (d.all||[]).forEach(function(b){
    var o=document.createElement('option'); o.value=b; o.textContent=b;
    if(b===d.current){ o.selected=true; }
    sel.appendChild(o);
  });
}
function onGitDiff(d){
  var pre=$('git-diff-view'), wrap=$('git-diff-wrap');
  if(!pre||!wrap){ return; }
  if(!d.diff||!d.diff.trim()){ pre.textContent='No staged changes.'; wrap.style.display='block'; return; }
  pre.innerHTML='';
  d.diff.split('\n').forEach(function(line){
    var span=document.createElement('span');
    if(line.startsWith('+')&&!line.startsWith('+++'))      { span.className='diff-add'; }
    else if(line.startsWith('-')&&!line.startsWith('---')) { span.className='diff-rm'; }
    else if(line.startsWith('@@'))                         { span.className='diff-hunk'; }
    else if(/^(diff |index |--- |\+\+\+ )/.test(line))    { span.className='diff-file'; }
    span.textContent=line+'\n';
    pre.appendChild(span);
  });
  wrap.style.display='block';
}
function onGitLog(d){
  var ll=$('git-log-list'); if(!ll){ return; }
  ll.innerHTML='';
  if(!d.commits||!d.commits.length){ ll.innerHTML='<span style="font-size:10px;color:rgba(255,255,255,0.2);">No commits yet.</span>'; return; }
  d.commits.forEach(function(c){
    var row=document.createElement('div'); row.className='gcommit';
    var h=document.createElement('span'); h.className='ghash'; h.textContent=c.hash;
    var m=document.createElement('span'); m.className='gmsg'; m.title=c.message; m.textContent=c.message;
    row.appendChild(h); row.appendChild(m); ll.appendChild(row);
  });
}
function onConfigModels(d){
  var mo=$('m-openai'); if(mo){ mo.value=d.openai||'gpt-4o'; }
  var mc=$('m-claude'); if(mc){ mc.value=d.claude||'claude-sonnet-4-6'; }
  var mg=$('m-grok');   if(mg){ mg.value=d.grok||'grok-3'; }
}
function renderPromptHistory(){
  var hl=$('hist-list'), hw=$('s-history'); if(!hl||!hw){ return; }
  if(!S.promptHistory.length){ hw.style.display='none'; return; }
  hw.style.display='block'; hl.innerHTML='';
  S.promptHistory.forEach(function(p){
    var el=document.createElement('div'); el.className='hitem'; el.title=p; el.textContent=p;
    el.addEventListener('click',function(){ var ti=$('task-input'); if(ti){ ti.value=p; ti.focus(); } });
    hl.appendChild(el);
  });
}
function addToHistory(text){
  if(!text||!text.trim()){ return; }
  S.promptHistory=S.promptHistory.filter(function(p){ return p!==text; });
  S.promptHistory.unshift(text);
  if(S.promptHistory.length>20){ S.promptHistory.length=20; }
  renderPromptHistory();
}

// Apply cancelled
function onApplyCancelled(){
  toast('Patch not applied.', false);
}

// Critical objection handler
function onCriticalObjection(d){
  txt('cobj-who', pLbl(d.objector)+' has raised a critical objection.');
  txt('cobj-summary', d.objectionSummary||'Implementation rejected due to critical risk.');
  S.dlVersions=d.versions||[];
  hide('s-phase'); show('s-critical-obj');
  setForge('forge-split');
}

// Web Audio API — consensus tone (no external file)
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let _audioCtx = null, _lastToneAt = 0;
const TONE_PARAMS = {
  adaptive:   {freq:740, detune:0,  gain:0.10, dur:0.28},
  cooperative:{freq:880, detune:-5, gain:0.07, dur:0.22},
  analytical: {freq:740, detune:-3, gain:0.10, dur:0.28},
  critical:   {freq:622, detune:0,  gain:0.12, dur:0.30},
  ruthless:   {freq:523, detune:5,  gain:0.13, dur:0.32},
};
function playConsensusTone(){
  if(!S.audioEnabled){ return; }
  const now=Date.now(); if(now-_lastToneAt<1500){ return; } _lastToneAt=now;
  try{
    if(!_audioCtx){ _audioCtx=new AudioCtx(); }
    if(_audioCtx.state==='suspended'){ _audioCtx.resume(); }
    const p=TONE_PARAMS[S.intensity]||TONE_PARAMS.analytical;
    const osc=_audioCtx.createOscillator(), gain=_audioCtx.createGain();
    osc.type='sine';
    osc.frequency.setValueAtTime(p.freq,_audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(p.freq+p.detune,_audioCtx.currentTime+p.dur);
    gain.gain.setValueAtTime(0,_audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(p.gain,_audioCtx.currentTime+0.04);
    gain.gain.exponentialRampToValueAtTime(0.001,_audioCtx.currentTime+p.dur);
    osc.connect(gain); gain.connect(_audioCtx.destination);
    osc.start(); osc.stop(_audioCtx.currentTime+p.dur+0.05);
  }catch(e){}
}

// Toast
function toast(msg, ok){
  const t=$('etst'); if(!t){ return; }
  t.textContent=msg;
  t.className=ok?'toast-ok':'';
  t.style.display='block';
  setTimeout(function(){ t.style.display='none'; }, 4500);
}

// Reset
function reset(){
  S.phase='IDLE'; S.running=false; S.debOpen=false; S.dlVersions=[];
  // Restore new layout idle state
  var rca=$('center-active'), rci=$('center-idle'), rtp=$('topbar-phase');
  if(rca){ rca.classList.add('hidden'); }
  if(rci){ rci.classList.remove('hidden'); }
  if(rtp){ rtp.classList.remove('active'); }
  setRunning(false);
  // Clear AI columns
  ['openai','claude','grok'].forEach(function(p){
    var cd=$('col-draft-'+p); if(cd){ cd.style.display='none'; }
    var cr=$('col-risk-'+p); if(cr){ cr.style.display='none'; }
    var cc=$('col-cards-'+p); if(cc){ cc.innerHTML=''; }
    var ci=$('col-idle-'+p); if(ci){ ci.style.display=''; }
    var cs=$('col-state-'+p); if(cs){ cs.textContent='idle'; cs.className='ai-state'; }
  });
  // Restore right panel idle
  show('right-idle'); hide('s-result'); hide('s-review-runtime');
  S.reviewRuntime = null;
  clearReviewRuntimeView();
  ['s-viz','s-draft','s-risk','s-agree','s-debate','s-alt','s-deadlock','s-synth-note','s-critical-obj'].forEach(hide);
  resetNodes();
  const vc=$('vcards'); if(vc){ vc.innerHTML=''; }
  const dlvc=$('version-cards'); if(dlvc){ dlvc.innerHTML=''; dlvc.classList.add('hidden'); }
  document.querySelectorAll('.ps').forEach(function(el){ el.classList.remove('active','done'); });
  const bb=$('bypass-b'); if(bb){ bb.style.display='none'; }
  const al=$('i-auto-lbl'); if(al){ al.textContent=''; al.classList.add('hidden'); }
  const cmb=$('cm-badge'); if(cmb){ cmb.classList.add('hidden'); }
  // Reset deadlock buttons
  const dlub=$('btn-dl-user'); if(dlub){ dlub.textContent='\u{1F9D1} User Breaks Tie\u2026'; dlub.disabled=false; }
  // Reset depth classes
  const rviz=$('s-viz'); if(rviz){ rviz.classList.remove('depth-active'); }
  document.body.classList.remove('ruthless-active');
  ['claude','gpt','grok'].forEach(function(p){ const n=$('vn-'+p); if(n){ n.classList.remove('depth-on'); } });
  // Reset context files (keep file tree loaded)
  send('workspace:clearContext');
}

// ── Mode-switch clear helpers ─────────────────────────────────────────────
function clearLegacyCouncilView(){
  ['s-result','s-alt','s-synth-note','s-debate','s-deadlock','s-critical-obj','s-draft','s-risk','s-agree','s-viz'].forEach(hide);
  var vc=$('vcards'); if(vc){ vc.innerHTML=''; }
  resetNodes();
}
function clearGovernedWorkflowView(){
  ['wf-plan-preview','wf-code-preview','wf-commit-preview'].forEach(function(id){
    var el=$(id); if(el){ el.innerHTML=''; }
  });
  ['wf-reviews','wf-roles','wf-msg'].forEach(function(id){
    var el=$(id); if(el){ el.innerHTML=''; }
  });
  var wfp=$('workflow-phase'); if(wfp){ hide('workflow-phase'); }
  // reset phase bar steps
  document.querySelectorAll('.wf-step').forEach(function(el){ el.classList.remove('active','done'); });
}

// ── Review Runtime helpers ────────────────────────────────────────────────
function clearReviewRuntimeView(){
  var ids=['rr-objective','rr-plan-summary','rr-impl-summary','rr-plan-reviews','rr-code-reviews','rr-reconciliation','rr-verification','rr-submit'];
  ids.forEach(function(id){
    var el=$(id); if(!el){ return; }
    if(id==='rr-submit'){ el.textContent=''; } else { el.innerHTML=''; }
  });
  var status=$('rr-status');
  if(status){ status.textContent='\u2014'; status.className='badge'; }
  var acts=$('rr-actions'); if(acts){ acts.style.display='none'; }
  var sum=$('rr-summary'); if(sum){ sum.innerHTML=''; sum.style.display='none'; }
}
function rrVerdictClass(verdict){
  if(verdict==='approve') return 'badge-ok';
  if(verdict==='approve_with_notes') return 'badge-warn';
  if(verdict==='revise_required') return 'badge-warn';
  if(verdict==='reject') return 'badge-error';
  return '';
}
function renderReviewDecisionList(decisions){
  if(!decisions||!decisions.length) return '<em>None</em>';
  return decisions.map(function(d){
    return '<div class="rr-decision"><span class="badge '+rrVerdictClass(d.verdict)+'">'+d.verdict+'</span> '
      +'<strong>'+d.reviewer+'</strong> &mdash; '+esc(d.summary||'')
      +' <span class="rr-meta">('+d.findingCount+' finding'+(d.findingCount!==1?'s':'')+', '
      +d.mustFixCount+' must-fix)</span></div>';
  }).join('');
}
function onReviewRuntimeResult(session, gate){
  if(!session) return;
  S.reviewRuntime = session;
  show('s-review-runtime');
  var rrs=$('rr-status');
  if(rrs){
    var cls = gate&&gate.allowed ? 'badge-ok' : (session.status==='blocked'?'badge-error':'badge-warn');
    rrs.textContent = session.phase||session.status;
    rrs.className='badge '+cls;
  }
  var obj=$('rr-objective'); if(obj){ obj.textContent=session.objective||''; }
  var ps=$('rr-plan-summary'); if(ps){ ps.textContent=session.authorPlanSummary||''; }
  var is=$('rr-impl-summary'); if(is){ is.textContent=session.implementationSummary||''; }
  var pr=$('rr-plan-reviews'); if(pr){ pr.innerHTML=renderReviewDecisionList(session.planReviewDecisions); }
  var cr=$('rr-code-reviews'); if(cr){ cr.innerHTML=renderReviewDecisionList(session.codeReviewDecisions); }
  var rec=$('rr-reconciliation');
  if(rec){
    if(session.reconciliation){
      var r=session.reconciliation;
      rec.innerHTML='<strong>'+r.winningAlignment+'</strong> &mdash; '+esc(r.summary||'')
        +' <span class="rr-meta">('+r.mustDoCount+' must-do, '+r.unresolvedRiskCount+' risks)</span>';
    } else {
      rec.innerHTML='<em>Not yet reconciled</em>';
    }
  }
  var ver=$('rr-verification');
  if(ver){
    if(session.verification){
      var vl=session.verification.checks.map(function(c){
        return '<span class="badge '+(c.status==='passed'?'badge-ok':'badge-warn')+'">'+c.intent+'</span> '+esc(c.summary||'');
      }).join('<br>');
      ver.innerHTML=vl||'<em>No checks</em>';
    } else {
      ver.innerHTML='<em>Not yet verified</em>';
    }
  }
  var sub=$('rr-submit');
  if(sub){
    if(session.submission&&session.submission.commitMessageDraft){
      sub.textContent=session.submission.commitMessageDraft;
    } else if(gate&&gate.commitMessage){
      sub.textContent=gate.commitMessage;
    } else {
      sub.textContent='';
    }
  }
  // Show action row now that we have a result
  var acts=$('rr-actions'); if(acts){ acts.style.display=''; }
  // Populate compact terminal summary
  var sum=$('rr-summary');
  if(sum){
    var mustDo=0, unresolvedRisk=0;
    if(session.reconciliation){ mustDo=session.reconciliation.mustDoCount||0; unresolvedRisk=session.reconciliation.unresolvedRiskCount||0; }
    var hasCommit=!!(session.submission&&session.submission.commitMessageDraft)||(gate&&!!gate.commitMessage);
    var isAllowed=gate&&gate.allowed;
    var isBlocked=session.status==='blocked';
    var label, bg, borderColor;
    if(isBlocked){
      label='Blocked by must-fix findings';
      bg='rgba(239,68,68,0.10)'; borderColor='rgba(239,68,68,0.30)';
    } else if(mustDo>0||unresolvedRisk>0){
      label='Needs revision';
      bg='rgba(245,158,11,0.10)'; borderColor='rgba(245,158,11,0.30)';
    } else {
      label='Ready for submission';
      bg='rgba(16,185,129,0.10)'; borderColor='rgba(16,185,129,0.30)';
    }
    sum.innerHTML='<strong>'+label+'</strong>'
      +' &nbsp;&bull;&nbsp; Gate: <span class="badge '+(isAllowed?'badge-ok':'badge-error')+'">'+(isAllowed?'allowed':'blocked')+'</span>'
      +' &nbsp;&bull;&nbsp; Must-do: '+mustDo
      +' &nbsp;&bull;&nbsp; Unresolved risks: '+unresolvedRisk
      +' &nbsp;&bull;&nbsp; Commit draft: '+(hasCommit?'<span class="badge badge-ok">yes</span>':'<span class="badge badge-warn">no</span>');
    sum.style.background=bg;
    sum.style.borderColor=borderColor;
    sum.style.display='';
  }
}

// Message listener
window.addEventListener('message', function(e){
  const d=e.data;
  switch(d.type){
    case 'providers':    updDots(d.status||{}); break;
    case 'phase':        onPhase(d); break;
    case 'draft-ready':  onDraft(d.draft); break;
    case 'risk-result':  onRisk(d.risk); break;
    case 'verdict':      onVerdict(d.verdict); break;
    case 'debate-complete': onDebate(d.debate); break;
    case 'session-complete': onComplete(d); break;
    case 'alternative-ready': onAlt(d.alternative); break;
    case 'apply-done':        toast('\\u2713 Applied to '+d.filePath, true); break;
    case 'apply-cancelled':   onApplyCancelled(); break;
    case 'error':
      toast(d.message||'An error occurred.', false);
      if(S.running){
        setRunning(false);
        var eca=$('center-active'), eci=$('center-idle'), etp=$('topbar-phase');
        if(eca){ eca.classList.add('hidden'); }
        if(eci){ eci.classList.remove('hidden'); }
        if(etp){ etp.classList.remove('active'); }
      }
      break;
    case 'council-mode':      onCouncilMode(d); break;
    case 'provider-offline':  onProviderOffline(d); break;
    case 'intensity-resolved': onIntensityResolved(d); break;
    case 'deadlock':          onDeadlock(d); break;
    case 'synthesis-ready':   onSynthesisReady(d); break;
    case 'critical-objection': onCriticalObjection(d); break;
    case 'workspace-tree':  onWorkspaceTree(d); break;
    case 'context-updated': onContextUpdated(d); break;
    case 'git-status':        onGitStatus(d); break;
    case 'git-error':         toast(d.message||'Git error.',false); break;
    case 'git-committed':
      toast('\u2713 Committed.',true);
      onGitStatus(d.status||{});
      var gm=$('git-commit-msg'); if(gm){ gm.value=''; }
      send('git:log'); send('git:branches');
      break;
    case 'git-pushed':        toast('\u2713 Pushed.',true); send('git:status'); send('git:log'); break;
    case 'git-generating':
      var b=$('btn-git-ai-msg'); if(b){ b.textContent='Generating\u2026'; b.disabled=true; }
      break;
    case 'git-message-ready':
      var b=$('btn-git-ai-msg'); if(b){ b.textContent='AI Message'; b.disabled=false; }
      var gm=$('git-commit-msg'); if(gm){ gm.value=d.message||''; }
      break;
    case 'git-branches':       onBranches(d); break;
    case 'git-diff':           onGitDiff(d); break;
    case 'git-log':            onGitLog(d); break;
    case 'config-models':      onConfigModels(d); break;
    case 'config-model-saved': toast('\u2713 Model saved.',true); break;
    case 'license-status':     onLicenseStatus(d.status); break;
    case 'license-activating':
      var ab=$('btn-lic-activate'); if(ab){ ab.textContent='Activating\u2026'; ab.disabled=true; }
      var er=$('lic-err'); if(er){ er.style.display='none'; }
      break;
    case 'license-error':
      var ab=$('btn-lic-activate'); if(ab){ ab.textContent='Activate'; ab.disabled=false; }
      var er=$('lic-err'); if(er){ er.textContent=d.error||'Activation failed.'; er.style.display='block'; }
      break;
    case 'license-gate':
      S.upgradeUrl=d.checkoutUrl||LS_CHECKOUT;
      var lg=$('lic-gate'),lgm=$('lic-gate-msg');
      if(lg){ lg.style.display='flex'; }
      if(lgm){ lgm.textContent=d.message||'Council mode requires an active license.'; }
      break;
    case 'escalated':
      S.intensity=d.intensity;
      document.querySelectorAll('.ibtn').forEach(function(b){ b.classList.toggle('on', b.dataset.i===d.intensity); });
      toast('Intensity escalated to '+d.intensity.toUpperCase()+'. Re-run to apply.', false);
      break;
    case 'council-started':
      WF.pipeline = 'legacy';
      if(d.prompt){ const ti=$('task-input'); if(ti){ ti.value=d.prompt; } }
      if(d.originalCode){ const ci=$('ctx-input'); if(ci){ ci.value=d.originalCode; } }
      if(d.intensity){
        S.intensity=d.intensity;
        document.querySelectorAll('.ibtn').forEach(function(b){ b.classList.toggle('on', b.dataset.i===d.intensity); });
      }
      break;
    case 'insert-prompt':
      if(d.text){ const ti=$('task-input'); if(ti){ ti.value=d.text; } }
      show('s-input');
      const fi=$('task-input'); if(fi){ fi.focus(); }
      break;

    // ── Governed Workflow Messages ────────────────────────────────────────
    case 'workflow-started':
      WF.pipeline = 'governed';
      // Clear stale views from other pipelines
      clearLegacyCouncilView();
      hide('s-review-runtime');
      clearReviewRuntimeView();
      // Show workflow phase bar, hide legacy
      var tp2=$('topbar-phase'); if(tp2){ tp2.classList.remove('active'); }
      var wfp=$('workflow-phase'); if(wfp){ wfp.classList.add('active'); }
      // Clear previous reviews
      var wfr=$('wf-reviews'); if(wfr){ wfr.innerHTML=''; }
      // Remove old previews
      ['wf-plan-preview','wf-code-preview','wf-commit-preview'].forEach(function(id){
        var el=document.getElementById(id); if(el) el.remove();
      });
      showWorkflowRoles(d.roles);
      updateWorkflowPhase('intake','Starting governed pipeline ('+d.mode+')...');
      // Switch to active state
      var ca=$('center-active'),ci=$('center-idle'); if(ca){ca.classList.remove('hidden');} if(ci){ci.classList.add('hidden');}
      setRunning(true);
      break;
    case 'workflow-phase':
      updateWorkflowPhase(d.phase, d.message||('Phase: '+d.phase));
      break;
    case 'workflow-stage':
      updateWorkflowPhase(d.stage, d.stage.replace(/_/g,' ')+' (round '+(d.round||1)+')');
      break;
    case 'workflow-review':
      addWorkflowReview(d.provider, d.role, d.approved);
      break;
    case 'workflow-plan-approved':
      updateWorkflowPhase('plan_approved','Plan approved by council');
      showWorkflowPlanPreview(d.plan, d.reviews, d.round);
      break;
    case 'workflow-code-approved':
      updateWorkflowPhase('ready_to_commit','Code approved');
      showWorkflowCodePreview(d.files, d.round);
      break;
    case 'workflow-scope-drift':
      toast('Scope drift detected: '+((d.extraFiles||[]).join(', ')),false);
      break;
    case 'workflow-check':
      // Individual check result
      break;
    case 'workflow-verify-complete':
      if(d.allPassed){
        updateWorkflowPhase('ready_to_commit','All checks passed');
      } else {
        updateWorkflowPhase('verify_failed','Verification failed');
      }
      break;
    case 'workflow-git-gate':
      showWorkflowCommitPreview(d.gate);
      break;
    case 'workflow-committed':
      toast('Committed: '+(d.commitHash||''),true);
      updateWorkflowPhase('pushed','Committed successfully');
      break;
    case 'workflow-pushed':
      toast('Pushed to '+(d.remote||'origin')+'/'+(d.branch||''),true);
      updateWorkflowPhase('pushed','Pushed');
      break;
    case 'workflow-input-required':
      // Phase bar already shows current state
      break;
    case 'workflow-complete':
      updateWorkflowPhase('pushed',d.summary||'Complete');
      setRunning(false);
      break;
    case 'workflow-blocked':
      updateWorkflowPhase('blocked',d.reason||'Blocked');
      setRunning(false);
      toast(d.reason||'Workflow blocked.',false);
      break;
    case 'workflow-error':
      toast(d.error||'Workflow error.',false);
      setRunning(false);
      break;

    // ── Review Runtime Messages ───────────────────────────────────────────
    case 'review-runtime-started':
      WF.pipeline = 'review';
      setRunning(true);
      hide('right-idle');
      clearLegacyCouncilView();
      clearGovernedWorkflowView();
      show('s-review-runtime');
      clearReviewRuntimeView();
      var rrs=$('rr-status'); if(rrs){ rrs.textContent='Running\u2026'; rrs.className='badge badge-warn'; }
      break;
    case 'review-runtime-result':
      setRunning(false);
      onReviewRuntimeResult(d.session, d.gate);
      break;
    case 'review-runtime-error':
      setRunning(false);
      hide('right-idle');
      show('s-review-runtime');
      var rrs2=$('rr-status'); if(rrs2){ rrs2.textContent='Error'; rrs2.className='badge badge-error'; }
      toast(d.message||'Review runtime error.',false);
      break;
  }
});

// ── Governed Workflow State ──────────────────────────────────────────────────
var WF = {
  pipeline: 'governed',   // 'governed' or 'legacy'
  mode: 'safe',           // 'quick', 'safe', 'trusted'
  action: 'plan_then_code', // 'plan_only', 'plan_then_code', 'review_existing', 'prepare_commit'
  currentPhase: '',
};

// Pipeline selector
document.querySelectorAll('[data-pipe]').forEach(function(b){
  b.addEventListener('click',function(){
    WF.pipeline = this.dataset.pipe;
    document.querySelectorAll('[data-pipe]').forEach(function(x){ x.classList.remove('on'); });
    this.classList.add('on');
    // Show/hide mode selectors
    var modeRow = document.querySelectorAll('[data-mode],[data-action],#mode-label,#action-label');
    var intRow = $('topbar-row-intensity');
    modeRow.forEach(function(el){ el.style.display = WF.pipeline==='governed' ? '' : 'none'; });
    if(intRow){ intRow.style.display = WF.pipeline==='legacy' ? 'flex' : 'none'; }
    send('workflow:setMode',{governed: WF.pipeline==='governed'});
  });
});

// Mode selector
document.querySelectorAll('[data-mode]').forEach(function(b){
  b.addEventListener('click',function(){
    WF.mode = this.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(function(x){ x.classList.remove('on'); });
    this.classList.add('on');
  });
});

// Action selector
document.querySelectorAll('[data-action]').forEach(function(b){
  b.addEventListener('click',function(){
    WF.action = this.dataset.action;
    document.querySelectorAll('[data-action]').forEach(function(x){ x.classList.remove('on'); });
    this.classList.add('on');
  });
});

// ── Governed Workflow Phase Updates ─────────────────────────────────────────
var WORKFLOW_PHASE_ORDER = ['intake','plan_draft','plan_review','plan_approved','code_draft','code_review','verifying','ready_to_commit','pushed'];
function updateWorkflowPhase(phase, msg) {
  WF.currentPhase = phase;
  var wfp = $('workflow-phase');
  if(!wfp) return;
  wfp.classList.add('active');
  var idx = WORKFLOW_PHASE_ORDER.indexOf(phase);
  document.querySelectorAll('.wps').forEach(function(el, i){
    var elPhase = el.dataset.wph;
    var elIdx = WORKFLOW_PHASE_ORDER.indexOf(elPhase);
    el.classList.remove('active','done','blocked');
    if(phase === 'blocked') { el.classList.add(elIdx <= idx ? 'blocked' : ''); }
    else if(elIdx < idx) { el.classList.add('done'); }
    else if(elIdx === idx) { el.classList.add('active'); }
  });
  var wfMsg = $('wf-msg');
  if(wfMsg && msg) { wfMsg.textContent = msg; }
}

function showWorkflowRoles(roles) {
  var container = $('wf-roles');
  if(!container || !roles) return;
  container.innerHTML = '';
  var ROLE_LABELS = {architect:'Architect',precision:'Precision',adversarial:'Adversarial'};
  roles.forEach(function(r){
    var badge = document.createElement('span');
    badge.className = 'wf-role-badge';
    badge.dataset.role = r.role;
    badge.textContent = (r.provider||'').toUpperCase() + ' ' + (ROLE_LABELS[r.role]||r.role);
    container.appendChild(badge);
  });
}

function addWorkflowReview(provider, role, approved) {
  var container = $('wf-reviews');
  if(!container) return;
  var entry = document.createElement('div');
  entry.className = 'wf-review-entry ' + (approved ? 'approved' : 'objected');
  var ROLE_COLORS = {architect:'#f97316',precision:'#10b981',adversarial:'#818cf8'};
  entry.innerHTML = '<span style="color:'+(ROLE_COLORS[role]||'#ccc')+';">'+provider+'</span> '
    + '<span style="font-weight:600;">' + (approved ? 'APPROVED' : 'OBJECTED') + '</span>';
  container.appendChild(entry);
}

function showWorkflowPlanPreview(plan, reviews, round) {
  // Show plan in center panel
  var center = $('center-panel');
  if(!center || !plan) return;
  var existing = document.getElementById('wf-plan-preview');
  if(existing) existing.remove();

  var div = document.createElement('div');
  div.id = 'wf-plan-preview';
  div.innerHTML = '<div style="font-weight:700;font-size:12px;margin-bottom:6px;">Approved Plan (Round '+round+')</div>'
    + '<div style="font-size:11px;color:rgba(255,255,255,0.6);margin-bottom:8px;">'+plan.summary+'</div>'
    + '<div style="font-size:10px;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:4px;">Files to Modify</div>'
    + (plan.filesToModify||[]).map(function(f){ return '<div class="wf-file-entry"><span class="wf-file-path">'+f+'</span></div>'; }).join('')
    + '<div style="font-size:10px;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-top:8px;margin-bottom:4px;">Acceptance Criteria</div>'
    + (plan.acceptanceCriteria||[]).map(function(c){ return '<div style="font-size:11px;padding:2px 0;color:rgba(255,255,255,0.55);">&#x2022; '+c+'</div>'; }).join('')
    + '<div style="margin-top:10px;display:flex;gap:6px;">'
    + '<button class="btn-p" id="wf-approve-plan" style="font-size:11px;padding:4px 10px;">Approve Plan</button>'
    + '<button class="btn-s" id="wf-narrow-plan" style="font-size:11px;padding:4px 10px;">Narrow Scope</button>'
    + '<button class="btn-s" id="wf-reject-plan" style="font-size:11px;padding:4px 10px;color:#ef4444;">Reject</button>'
    + '</div>';
  center.insertBefore(div, center.firstChild);

  // Bind buttons
  var approveBtn = document.getElementById('wf-approve-plan');
  if(approveBtn) approveBtn.addEventListener('click', function(){ send('workflow:approvePlan'); });
  var narrowBtn = document.getElementById('wf-narrow-plan');
  if(narrowBtn) narrowBtn.addEventListener('click', function(){
    var inst = prompt('Enter instructions to narrow the plan:');
    if(inst) send('workflow:narrowPlan',{instructions:inst});
  });
  var rejectBtn = document.getElementById('wf-reject-plan');
  if(rejectBtn) rejectBtn.addEventListener('click', function(){
    send('workflow:rejectPlan',{reason:'Rejected by user'});
  });
}

function showWorkflowCodePreview(files, round) {
  var center = $('center-panel');
  if(!center || !files) return;
  var existing = document.getElementById('wf-code-preview');
  if(existing) existing.remove();

  var div = document.createElement('div');
  div.id = 'wf-code-preview';
  div.innerHTML = '<div style="font-weight:700;font-size:12px;margin-bottom:6px;">Implementation (Round '+round+')</div>'
    + files.map(function(f){
      return '<div class="wf-file-entry"><span class="wf-file-path">'+f.filePath+'</span>'
        + '<div class="wf-file-why">'+f.explanation+'</div></div>';
    }).join('');
  center.insertBefore(div, center.firstChild);
}

function showWorkflowCommitPreview(gate) {
  var center = $('center-panel');
  if(!center) return;
  var existing = document.getElementById('wf-commit-preview');
  if(existing) existing.remove();

  var div = document.createElement('div');
  div.id = 'wf-commit-preview';
  var statusItems = [
    { label: 'Plan Approved', ok: gate.planApproved },
    { label: 'Code Approved', ok: gate.codeApproved },
    { label: 'Checks Green',  ok: gate.checksGreen },
  ];
  div.innerHTML = '<div style="font-weight:700;font-size:12px;margin-bottom:6px;">Git Gate</div>'
    + statusItems.map(function(s){
      return '<div style="font-size:11px;padding:2px 0;">'
        + (s.ok ? '<span style="color:#10b981;">&#x2713;</span>' : '<span style="color:#ef4444;">&#x2717;</span>')
        + ' ' + s.label + '</div>';
    }).join('')
    + (gate.commitMessage ? '<div style="font-size:11px;margin-top:6px;padding:6px;background:rgba(0,0,0,0.2);border-radius:4px;font-family:monospace;">'+gate.commitMessage.replace(/\\n/g,'<br>')+'</div>' : '')
    + (gate.commitReady ? '<div style="margin-top:8px;display:flex;gap:6px;">'
      + '<button class="btn-p" id="wf-approve-commit" style="font-size:11px;padding:4px 10px;">Commit</button>'
      + '<button class="btn-s" id="wf-reject-commit" style="font-size:11px;padding:4px 10px;">Skip</button>'
      + '</div>' : '')
    + (gate.blockingRisks && gate.blockingRisks.length ? '<div style="color:#ef4444;font-size:11px;margin-top:4px;">Blocked: '+gate.blockingRisks.join(', ')+'</div>' : '');
  center.insertBefore(div, center.firstChild);

  var commitBtn = document.getElementById('wf-approve-commit');
  if(commitBtn) commitBtn.addEventListener('click', function(){ send('workflow:approveCommit'); });
  var skipBtn = document.getElementById('wf-reject-commit');
  if(skipBtn) skipBtn.addEventListener('click', function(){ send('workflow:rejectCommit'); });
}

// Button bindings
$('btn-run')&&$('btn-run').addEventListener('click',function(){
  if(S.running){ toast('A run is already in progress. Abort first.'); return; }
  const p=($('task-input')||{}).value||'', c=($('ctx-input')||{}).value||'';
  if(!p.trim()){ toast('Please describe your task before running the council.'); return; }
  addToHistory(p.trim());
  const al=$('i-auto-lbl'); if(al){ al.textContent=''; al.classList.add('hidden'); }
  send('council:run',{prompt:p.trim(),context:c.trim(),intensity:S.intensity,mode:WF.mode,action:WF.action});
});
$('btn-run-review')&&$('btn-run-review').addEventListener('click',function(){
  if(S.running){ toast('A run is already in progress. Abort first.'); return; }
  const p=($('task-input')||{}).value||'', c=($('ctx-input')||{}).value||'';
  if(!p.trim()){ toast('Please describe your task before running the review runtime.'); return; }
  addToHistory(p.trim());
  send('review:run',{prompt:p.trim(),context:c.trim(),intensity:S.intensity});
});
$('btn-abort')&&$('btn-abort').addEventListener('click',function(){
  if(WF.pipeline==='governed'){
    send('workflow:abort');
  } else if(WF.pipeline==='review'){
    // Review runtime is non-cancellable server-side; clean up UI state immediately
    setRunning(false);
    var rrs=$('rr-status'); if(rrs){ rrs.textContent='Aborted'; rrs.className='badge badge-warn'; }
  } else {
    send('council:abort');
  }
});
$('btn-bypass')&&$('btn-bypass').addEventListener('click',function(){ send('council:applyDraft'); });
$('btn-apply')&&$('btn-apply').addEventListener('click',function(){ send('council:apply'); });
$('btn-esc')&&$('btn-esc').addEventListener('click',function(){ send('council:escalate'); });
$('btn-export')&&$('btn-export').addEventListener('click',function(){ send('council:export'); });
// ── Review Runtime action row ─────────────────────────────────────────────
$('btn-rr-copy-commit')&&$('btn-rr-copy-commit').addEventListener('click',function(){
  var el=$('rr-submit'); if(!el||!el.textContent.trim()){ toast('No commit message to copy.'); return; }
  navigator.clipboard.writeText(el.textContent.trim()).then(function(){ toast('Commit message copied.'); });
});
$('btn-rr-send-commit')&&$('btn-rr-send-commit').addEventListener('click',function(){
  var el=$('rr-submit'); if(!el||!el.textContent.trim()){ toast('No commit message available.'); return; }
  var box=$('git-commit-msg'); if(box){ box.value=el.textContent.trim(); toast('Sent to commit box.'); }
});
$('btn-rr-run-again')&&$('btn-rr-run-again').addEventListener('click',function(){
  send('review:run', { prompt: S.reviewRuntime&&S.reviewRuntime.objective||'' });
});
$('btn-rr-close')&&$('btn-rr-close').addEventListener('click',function(){
  hide('s-review-runtime');
  clearReviewRuntimeView();
  S.reviewRuntime = null;
  show('right-idle');
});
$('btn-reset')&&$('btn-reset').addEventListener('click',reset);
$('file-search')&&$('file-search').addEventListener('input',function(){ renderFileList(this.value); });
$('btn-ctx-clear')&&$('btn-ctx-clear').addEventListener('click',function(){ send('workspace:clearContext'); });
$('btn-git-refresh')&&$('btn-git-refresh').addEventListener('click',function(){ send('git:status'); });
$('btn-stage-all')&&$('btn-stage-all').addEventListener('click',function(){ send('git:stageAll'); });
$('btn-unstage-all')&&$('btn-unstage-all').addEventListener('click',function(){ send('git:unstageAll'); });
$('btn-git-commit')&&$('btn-git-commit').addEventListener('click',function(){
  var msg=($('git-commit-msg')||{}).value||'';
  if(!msg.trim()){ toast('Enter a commit message first.'); return; }
  send('git:commit',{message:msg.trim()});
});
$('btn-git-push')&&$('btn-git-push').addEventListener('click',function(){ send('git:push'); });
$('btn-git-ai-msg')&&$('btn-git-ai-msg').addEventListener('click',function(){ send('git:generateMessage'); });
$('btn-git-switch')&&$('btn-git-switch').addEventListener('click',function(){
  var sel=$('git-branch-select'); if(!sel||!sel.value){ return; }
  send('git:switchBranch',{name:sel.value});
});
$('btn-git-create')&&$('btn-git-create').addEventListener('click',function(){
  var inp=$('git-new-branch'); if(!inp||!inp.value.trim()){ return; }
  send('git:createBranch',{name:inp.value.trim()}); inp.value='';
});
$('btn-git-diff')&&$('btn-git-diff').addEventListener('click',function(){
  var wrap=$('git-diff-wrap');
  if(wrap&&wrap.style.display!=='none'){ wrap.style.display='none'; this.textContent='View Staged Diff'; return; }
  this.textContent='Hide Diff'; send('git:diff');
});
$('ms-openai')&&$('ms-openai').addEventListener('click',function(){ send('config:setModel',{provider:'openai',model:($('m-openai')||{}).value||''}); });
$('ms-claude')&&$('ms-claude').addEventListener('click',function(){ send('config:setModel',{provider:'claude',model:($('m-claude')||{}).value||''}); });
$('ms-grok')&&$('ms-grok').addEventListener('click',function(){   send('config:setModel',{provider:'grok',  model:($('m-grok')||{}).value||''}); });
$('btn-debate')&&$('btn-debate').addEventListener('click',function(){
  const ds=$('s-debate');
  if(!ds){ return; }
  if(ds.classList.contains('hidden')){
    show('s-debate');
    const db=$('dbody'); if(db){ db.classList.add('open'); S.debOpen=true; }
    this.textContent='Hide Debate';
  } else {
    hide('s-debate');
    this.textContent='View Debate';
  }
});
$('btn-adopt')&&$('btn-adopt').addEventListener('click',function(){ send('council:adoptAlt'); });
$('btn-vote')&&$('btn-vote').addEventListener('click',function(){ send('council:runVoteOnAlt'); hide('s-alt'); });
$('btn-discard')&&$('btn-discard').addEventListener('click',function(){ hide('s-alt'); });
$('dtoggle')&&$('dtoggle').addEventListener('click',function(){
  const db=$('dbody'); if(!db){ return; }
  S.debOpen=!S.debOpen;
  db.classList.toggle('open', S.debOpen);
  txt('darr', S.debOpen?'\\u25B2':'\\u25BC');
});
$('btn-cfg')&&$('btn-cfg').addEventListener('click',function(){
  const sc=$('s-cfg'); if(!sc){ return; }
  if(sc.classList.contains('hidden')){ show('s-cfg'); this.classList.add('active'); }
  else { hide('s-cfg'); this.classList.remove('active'); }
});
// Settings open by default — mark gear active on load
(function(){ var b=$('btn-cfg'); if(b){ b.classList.add('active'); } })();
// Collapsible settings section
$('cfg-sh')&&$('cfg-sh').addEventListener('click',function(){
  var body=$('cfg-body'), chev=$('cfg-chevron'); if(!body){ return; }
  var collapsed=body.style.display==='none';
  body.style.display=collapsed?'flex':'none';
  if(chev){ chev.style.transform=collapsed?'':'rotate(-90deg)'; }
});
document.querySelectorAll('.ibtn').forEach(function(btn){
  btn.addEventListener('click',function(){
    document.querySelectorAll('.ibtn').forEach(function(b){ b.classList.remove('on'); });
    btn.classList.add('on');
    S.intensity=btn.dataset.i;
    const al=$('i-auto-lbl'); if(al){ al.textContent=''; al.classList.add('hidden'); }
    if(btn.dataset.i==='adaptive'){
      send('council:setIntensity',{lock:false});
    } else {
      send('council:setIntensity',{lock:true,level:(btn.dataset.i||'analytical').toUpperCase()});
    }
  });
});

// Deadlock button bindings
$('btn-dl-escalate')&&$('btn-dl-escalate').addEventListener('click',function(){
  hide('s-deadlock'); show('s-phase'); send('council:deadlock:escalate');
});
$('btn-dl-user')&&$('btn-dl-user').addEventListener('click',function(){
  const vc=$('version-cards');
  if(vc){ vc.classList.remove('hidden'); vc.style.display='flex'; }
  this.textContent='Select a version below\u2026'; this.disabled=true;
  send('council:deadlock:user');
});
$('btn-dl-synthesis')&&$('btn-dl-synthesis').addEventListener('click',function(){
  hide('s-deadlock'); show('s-phase'); send('council:deadlock:synthesis');
});
$('btn-dl-extended')&&$('btn-dl-extended').addEventListener('click',function(){
  hide('s-deadlock'); show('s-phase'); send('council:deadlock:extended');
});

// Critical objection button bindings
$('btn-co-alt')&&$('btn-co-alt').addEventListener('click',function(){
  hide('s-critical-obj');
  // Populate deadlock version cards from stored versions
  const vc=$('version-cards');
  if(vc && S.dlVersions.length){
    vc.innerHTML='';
    S.dlVersions.forEach(function(v,i){
      const lbl=String.fromCharCode(65+i);
      const card=document.createElement('div'); card.className='vc-card';
      card.innerHTML='<div class="vc-header">'+
        '<span class="badge '+pCls(v.provider)+'">'+esc(pLbl(v.provider))+'</span>'+
        '<span style="font-size:11px;color:rgba(255,255,255,0.4);">Version '+esc(lbl)+'</span>'+
        '<span style="font-size:11px;color:rgba(255,255,255,0.45);flex:1;">'+esc(v.reasoning)+'</span>'+
        '<button class="btn-s" style="font-size:11px;padding:3px 9px;" data-action="selectVersion" data-provider="'+esc(v.provider)+'">Select</button>'+
        '</div><div class="vc-code">'+esc((v.code||'').slice(0,200))+'</div>';
      vc.appendChild(card);
    });
    vc.classList.remove('hidden'); vc.style.display='flex';
  }
  const dlub=$('btn-dl-user'); if(dlub){ dlub.textContent='Select a version below\u2026'; dlub.disabled=true; }
  show('s-deadlock');
  send('council:deadlock:user');
});
$('btn-co-override')&&$('btn-co-override').addEventListener('click',function(){ hide('s-critical-obj'); send('council:override:apply'); });
$('btn-co-debate')&&$('btn-co-debate').addEventListener('click',function(){ hide('s-critical-obj'); show('s-phase'); send('council:deadlock:extended'); });
$('btn-co-synth')&&$('btn-co-synth').addEventListener('click',function(){ hide('s-critical-obj'); show('s-phase'); send('council:deadlock:synthesis'); });

// API key buttons — event delegation for robustness
document.addEventListener('click',function(ev){
  var tgt=ev.target; if(!tgt||!tgt.id){ return; }
  var id=tgt.id;
  if(id==='ks-openai'||id==='ks-claude'||id==='ks-grok'){
    var p2=id.slice(3);
    var inp=$('k-'+p2);
    if(!inp||!inp.value.trim()){ toast('Enter a '+pLbl(p2)+' API key first.',false); return; }
    var key2=inp.value.trim();
    send('setApiKey',{provider:p2,key:key2});
    inp.value='';
    tgt.textContent='Saved!';
    setTimeout(function(){ tgt.textContent='Save'; },2000);
    toast('\u2713 '+pLbl(p2)+' key sent to extension.',true);
  } else if(id==='kr-openai'||id==='kr-claude'||id==='kr-grok'){
    var p3=id.slice(3);
    send('removeApiKey',{provider:p3});
    toast(pLbl(p3)+' key removed.',true);
  }
});
$('btn-audio')&&$('btn-audio').addEventListener('click',function(){ S.audioEnabled=!S.audioEnabled; this.textContent=S.audioEnabled?'On':'Off'; this.classList.toggle('on',S.audioEnabled); });
$('btn-reset2')&&$('btn-reset2').addEventListener('click',reset);
// Context toggle — hide by default, toggle on click
(function(){
  var cw=$('ctx-wrap'); if(cw){ cw.style.display='none'; }
  var ctb=$('btn-ctx-toggle'); if(ctb){ ctb.addEventListener('click',function(){
    if(!cw){ return; }
    var hidden=cw.style.display==='none';
    cw.style.display=hidden?'':'none';
    this.textContent=hidden?'- Context':'+ Context';
  }); }
})();

// License button bindings
$('btn-lic-activate')&&$('btn-lic-activate').addEventListener('click',function(){
  var k=($('lic-key-inp')||{}).value||''; if(!k.trim()){ return; }
  send('license:activate',{key:k.trim()}); $('lic-key-inp').value='';
});
$('btn-lic-remove')&&$('btn-lic-remove').addEventListener('click',function(){ send('license:deactivate'); });
$('btn-lic-upgrade')&&$('btn-lic-upgrade').addEventListener('click',function(){ send('openExternal',{url:S.upgradeUrl||LS_CHECKOUT}); });
$('btn-gate-upgrade')&&$('btn-gate-upgrade').addEventListener('click',function(){ send('openExternal',{url:S.upgradeUrl||LS_CHECKOUT}); });
$('btn-gate-key')&&$('btn-gate-key').addEventListener('click',function(){
  var lg=$('lic-gate'); if(lg){ lg.style.display='none'; }
  var kr=$('lic-key-row'); if(kr){ kr.style.display='flex'; }
  var inp=$('lic-key-inp'); if(inp){ inp.focus(); }
});

// Event delegation for dynamic card buttons (CSP-safe, no inline onclick)
document.addEventListener('click',function(e){
  var t=e.target; if(!t){ return; }
  var action=t.dataset&&t.dataset.action;
  var prov=t.dataset&&t.dataset.provider;
  if(action==='reqAlt'){ send('council:requestAlt',{provider:prov}); }
  if(action==='selectVersion'){ hide('s-deadlock'); show('s-phase'); send('council:selectVersion',{provider:prov}); }
});

// Init
send('getProviders');
send('config:getModels');
send('workspace:getTree');
send('git:status');
send('git:branches');
send('git:log');
send('license:getStatus');
} catch(e) {
  var t=document.getElementById('etst');
  if(t){ t.textContent='JS Error: '+(e&&e.message||String(e)); t.className=''; t.style.display='block'; t.style.color='#ef4444'; t.style.padding='8px'; t.style.fontSize='11px'; }
}
})();
`;
}
