'use strict';

/* ════════════════════════════
   A — 앱 전체 네임스페이스
════════════════════════════ */
var A = (function(){

/* ── 상태 ── */
var KEY = '';           // Anthropic API key
var USER = null;        // 현재 로그인 사용자
var _newMode = '';
var _newCtype = '';
var _newStage = 0;
var _pendMeal = null;   // 기록장 식사 슬롯
var _vCtx = null;       // 뷰어 컨텍스트
var _vRot = 0;
var _symNRS = {pain:0, urine:0, fatigue:0};
var _curSym = 'pain';
var _quickNRS = 0;
var _saveTimer = null;
var _chatBusy = false;
var _cardSeq = 0;
var _lastTipIdx = -1;

/* ── 스토리지 헬퍼 ── */
var S = {
  g: function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
  s: function(k,v){ try{ localStorage.setItem(k,v); }catch(e){ alert('저장 오류'); } },
  gj: function(k,d){ try{ return JSON.parse(S.g(k)||'null')||d; }catch(e){ return d; } },
  sj: function(k,v){ S.s(k, JSON.stringify(v)); }
};

// 사용자별 키
function uk(k){ return 'mc_'+USER.id+'_'+k; }
function ug(k){ return S.g(uk(k)); }
function us(k,v){ S.s(uk(k),v); }
function ugj(k,d){ try{ return JSON.parse(ug(k)||'null')||d; }catch(e){ return d; } }
function usj(k,v){ us(k,JSON.stringify(v)); }

/* ── DOM 헬퍼 ── */
function $id(id){ return document.getElementById(id); }
function toast(msg){ var t=$id('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(function(){ t.classList.remove('show'); }, 2500); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function todayStr(){ var d=new Date(); return String(d.getFullYear()).slice(2)+'년 '+pad(d.getMonth()+1)+'월 '+pad(d.getDate())+'일'; }
function pad(n){ return n<10?'0'+n:String(n); }

/* ── 화면 전환 ── */
function goScreen(id){
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  var el = $id(id);
  if(el) el.classList.add('active');
  if(id==='scr-admin') _renderAdminList();
  if(id==='scr-profile') _renderProfileList();
  if(id==='scr-add-user') _resetAddForm();
}

/* ── 최초 설정 ── */
function init(){
  var ant = $id('inp-ant').value.trim();
  var pw  = $id('inp-pw').value.trim();
  if(!ant){ alert('API 키를 입력해 주세요.'); return; }
  if(!pw){  alert('Admin 비밀번호를 설정해 주세요.'); return; }
  S.s('mc_ant', ant);
  S.s('mc_pw', pw);
  KEY = ant;
  goScreen('scr-profile');
  toast('설정 완료!');
}

/* ── Admin 로그인 ── */
function checkPw(){
  var pw = $id('admin-pw-input').value;
  if(pw === S.g('mc_pw')){
    $id('admin-pw-input').value = '';
    goScreen('scr-admin');
  } else {
    toast('비밀번호가 틀렸습니다');
    $id('admin-pw-input').value = '';
  }
}

/* ── Admin 기능 ── */
function _getUsers(){ return S.gj('mc_users', []); }
function _setUsers(u){ S.sj('mc_users', u); }

function _renderAdminList(){
  var users = _getUsers();
  var el = $id('admin-user-list');
  if(!el) return;
  if(!users.length){
    el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--mu);font-size:13px;">등록된 사용자가 없습니다</div>';
    return;
  }
  var ml = {cancer:'암환자', keto:'케토제닉', lchf:'저탄고지', diet:'다이어트 건강식'};
  var mi = {cancer:'🔬', keto:'🥑', lchf:'🥩', diet:'🥗'};
  el.innerHTML = users.map(function(u){
    var ic = u.mode==='cancer';
    var ms = (ic&&u.ctype==='prostate') ? u.stage+'기 전립선암' : (ml[u.mode]||u.mode);
    return '<div class="admin-user-row">'
      +'<div class="admin-user-av '+(ic?'cancer':'health')+'">'+(mi[u.mode]||'👤')+'</div>'
      +'<div style="flex:1"><div class="admin-user-name">'+esc(u.name)+'</div><div class="admin-user-detail">'+esc(ms)+'</div></div>'
      +'<button class="admin-act del" onclick="A.delUser(\''+u.id+'\')"><i class="ti ti-trash"></i> 삭제</button>'
      +'</div>';
  }).join('');
}

function delUser(id){
  if(!confirm('이 사용자를 삭제할까요?')) return;
  _setUsers(_getUsers().filter(function(u){ return u.id!==id; }));
  _renderAdminList();
  _renderProfileList();
  toast('삭제됐어요');
}

function changePw(){
  var p1=$id('new-pw1').value, p2=$id('new-pw2').value;
  if(!p1){ toast('새 비밀번호를 입력하세요'); return; }
  if(p1!==p2){ toast('비밀번호가 일치하지 않아요'); return; }
  S.s('mc_pw', p1);
  $id('new-pw1').value=''; $id('new-pw2').value='';
  toast('비밀번호 변경됐어요 ✓');
}

function backup(){
  var bk = {};
  for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); bk[k]=localStorage.getItem(k); }
  bk['_date'] = new Date().toLocaleString('ko-KR');
  var blob = new Blob([JSON.stringify(bk,null,2)], {type:'application/json'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href=url; a.download='metacare_'+new Date().toISOString().slice(0,10)+'.json'; a.click();
  URL.revokeObjectURL(url);
  toast('백업 완료 ✓');
}

function restore(e){
  var file = e.target.files[0]; if(!file) return;
  var r = new FileReader();
  r.onload = function(ev){
    try{
      var data = JSON.parse(ev.target.result);
      if(!data['mc_pw']){ toast('올바른 백업 파일이 아닙니다'); return; }
      if(!confirm('현재 데이터를 백업으로 덮어쓸까요?\n'+( data['_date']||''))) return;
      localStorage.clear();
      Object.keys(data).forEach(function(k){ if(!k.startsWith('_')) localStorage.setItem(k,data[k]); });
      toast('복원 완료! 새로고침합니다');
      setTimeout(function(){ location.reload(); }, 1500);
    }catch(err){ toast('파일을 읽을 수 없습니다'); }
  };
  r.readAsText(file); e.target.value='';
}

function fullReset(){
  if(!confirm('정말 전체 초기화할까요?\n모든 데이터가 삭제됩니다.')) return;
  if(!confirm('마지막 확인입니다.')) return;
  localStorage.clear(); location.reload();
}

/* ── 사용자 추가 ── */
var _MODES = [
  {id:'cancer', icon:'🔬', name:'암환자', desc:'PSA 추적 · 증상 기록 · 복약 · 식단 분석'},
  {id:'keto',   icon:'🥑', name:'케토제닉', desc:'탄수화물 20g 이하 · 인슐린 억제 · 케톤 생성'},
  {id:'lchf',   icon:'🥩', name:'저탄고지', desc:'탄수화물 50~100g · 혈당 안정 · 체중 관리'},
  {id:'diet',   icon:'🥗', name:'다이어트 건강식', desc:'지중해식 · 칼로리 제한 · 균형 영양'}
];
var _CTYPES = [
  {id:'prostate', icon:'🔬', name:'전립선암', desc:'PSA 추적 · 병기별 관리'},
  {id:'other',    icon:'💊', name:'기타 암',  desc:'증상 · 복약 통합 관리'}
];
var _STAGES = [
  {n:1, name:'국소 저위험',    desc:'적극적 감시·수술·방사선'},
  {n:2, name:'국소 중·고위험', desc:'수술·방사선+ADT'},
  {n:3, name:'국소 진행성',   desc:'방사선+장기ADT'},
  {n:4, name:'전이성',        desc:'뼈전이·ADT·항암'}
];

function _resetAddForm(){
  _newMode=''; _newCtype=''; _newStage=0;
  $id('new-name').value='';
  // 모드 버튼 생성
  $id('mode-btns').innerHTML = _MODES.map(function(m){
    return '<button class="mode-btn" id="mb-'+m.id+'" onclick="A._selMode(\''+m.id+'\')">'
      +'<div class="mode-icon">'+m.icon+'</div>'
      +'<div><div class="mode-name">'+m.name+'</div><div class="mode-desc">'+m.desc+'</div></div>'
      +'</button>';
  }).join('');
  // 암종 버튼
  $id('ctype-btns').innerHTML = _CTYPES.map(function(c){
    return '<button class="mode-btn" id="cb-'+c.id+'" onclick="A._selCtype(\''+c.id+'\')">'
      +'<div class="mode-icon" style="font-size:22px;">'+c.icon+'</div>'
      +'<div><div class="mode-name">'+c.name+'</div><div class="mode-desc">'+c.desc+'</div></div>'
      +'</button>';
  }).join('');
  // 병기 버튼
  $id('stage-btns').innerHTML = _STAGES.map(function(s){
    return '<button class="stage-btn" id="sb'+s.n+'" onclick="A._selStage('+s.n+')">'
      +'<div class="stage-num">'+s.n+'기</div>'
      +'<div class="stage-name">'+s.name+'</div>'
      +'<div class="stage-desc">'+s.desc+'</div>'
      +'</button>';
  }).join('');
  $id('ctype-wrap').style.display='none';
  $id('stage-wrap').style.display='none';
}

function _selMode(m){
  _newMode=m; _newCtype=''; _newStage=0;
  document.querySelectorAll('.mode-btn').forEach(function(b){ b.classList.remove('sel','health','cancer'); });
  var el=$id('mb-'+m); if(el){ el.classList.add('sel', m==='cancer'?'cancer':'health'); }
  $id('ctype-wrap').style.display = m==='cancer'?'':'none';
  $id('stage-wrap').style.display='none';
  document.querySelectorAll('[id^="cb-"]').forEach(function(b){ b.classList.remove('sel','health','cancer'); });
  document.querySelectorAll('[id^="sb"]').forEach(function(b){ b.classList.remove('sel'); });
}

function _selCtype(t){
  _newCtype=t; _newStage=0;
  document.querySelectorAll('[id^="cb-"]').forEach(function(b){ b.classList.remove('sel','health','cancer'); });
  var el=$id('cb-'+t); if(el){ el.classList.add('sel','cancer'); }
  $id('stage-wrap').style.display = t==='prostate'?'':'none';
  document.querySelectorAll('[id^="sb"]').forEach(function(b){ b.classList.remove('sel'); });
}

function _selStage(n){
  _newStage=n;
  document.querySelectorAll('[id^="sb"]').forEach(function(b){ b.classList.remove('sel'); });
  var el=$id('sb'+n); if(el) el.classList.add('sel');
}

function addUser(){
  var name = $id('new-name').value.trim();
  if(!name){ toast('이름을 입력하세요'); return; }
  if(!_newMode){ toast('모드를 선택하세요'); return; }
  if(_newMode==='cancer'&&!_newCtype){ toast('암 종류를 선택하세요'); return; }
  if(_newCtype==='prostate'&&!_newStage){ toast('병기를 선택하세요'); return; }
  var users = _getUsers();
  users.push({id:'u'+Date.now(), name:name, mode:_newMode, ctype:_newCtype, stage:_newStage, treatments:[], createdAt:Date.now()});
  _setUsers(users);
  _renderProfileList();
  toast(name+' 님이 추가됐어요 ✓');
  goScreen('scr-admin');
}

/* ── 프로필 화면 ── */
function _renderProfileList(){
  var users = _getUsers();
  var el = $id('profile-list');
  if(!el) return;
  var ml = {cancer:'암환자', keto:'케토제닉', lchf:'저탄고지', diet:'다이어트 건강식'};
  var mi = {cancer:'🔬', keto:'🥑', lchf:'🥩', diet:'🥗'};
  if(!users.length){
    el.innerHTML = '<div class="profile-empty"><i class="ti ti-users"></i><br>Admin으로 로그인하여<br>사용자를 추가하세요</div>';
    return;
  }
  el.innerHTML = '';
  users.forEach(function(u){
    var ic = u.mode==='cancer';
    var ml2 = (ic&&u.ctype==='prostate') ? u.stage+'기 전립선암' : (ml[u.mode]||u.mode);
    var btn = document.createElement('button');
    btn.className = 'profile-card';
    btn.innerHTML = '<div class="profile-av '+(ic?'cancer':'health')+'">'+(mi[u.mode]||'👤')+'</div>'
      +'<div><div class="profile-name">'+esc(u.name)+'</div>'
      +'<span class="profile-tag '+(ic?'cancer':'health')+'">'+esc(ml2)+'</span></div>'
      +'<i class="ti ti-chevron-right" style="margin-left:auto;color:rgba(255,255,255,.3);font-size:18px;"></i>';
    btn.onclick = function(){ loginUser(u); };
    el.appendChild(btn);
  });
}

/* ── 로그인 ── */
function loginUser(u){
  USER = u;
  KEY = S.g('mc_ant')||'';
  if(!KEY){ toast('API 키가 없습니다. Admin에서 설정해주세요.'); return; }
  _initApp();
  goScreen('scr-app');
}

/* ── 앱 초기화 ── */
function _initApp(){
  var u = USER;
  var ic = u.mode==='cancer';
  var ip = ic && u.ctype==='prostate';
  var ml = {cancer:'암환자', keto:'케토제닉', lchf:'저탄고지', diet:'다이어트 건강식'};

  // 헤더
  var badge=$id('tb-badge'), sub=$id('tb-sub');
  badge.textContent = ip ? u.stage+'기 전립선암' : (ml[u.mode]||'건강관리');
  badge.className = 'badge '+(ic?'cancer':'health');
  if(sub) sub.textContent = u.name+' 님';

  // 이름 표시
  document.querySelectorAll('.uname').forEach(function(el){ el.textContent=u.name; });

  // 홈 설정 (건강관리 vs 암환자 섹션)
  var cancerSec = $id('home-cancer-section');
  if(cancerSec) cancerSec.style.display = ic?'':'none';
  if(!ic){
    _initHealthHome(u.mode);
  } else {
    _initCancerHome(u);
  }

  // 식단 탭 암환자 전용 섹션
  var ce = $id('cancer-record-extra');
  if(ce) ce.style.display = ic?'':'none';

  // 기록장 증상 섹션
  var sl = $id('sym-log-section');
  if(sl) sl.style.display = ic?'':'none';

  // 추적 탭
  var th=$id('track-health'), tc=$id('track-cancer');
  if(th) th.style.display = ic?'none':'';
  if(tc) tc.style.display = ic?'':'none';

  // 내비 추적 레이블
  var nl=$id('nb-track-lbl');
  if(nl) nl.textContent = ic?'PSA추적':'추천';

  // 암환자: PSA/배뇨 관련 표시
  if(ic){
    var ps=$id('psa-banner-wrap'); if(ps) ps.innerHTML=ip?_buildPSABanner():'';
    var ub=$id('sd-urine-btn'); if(ub) ub.style.display=ip?'':'none';
    var nuw=$id('nrs-urine-wrap'); if(nuw) nuw.style.display=ip?'':'none';
    if(ip) _refreshPSABanner();
  }

  // NRS 빌드
  _buildNRS('nrs-pain','pain'); _buildNRS('nrs-urine','urine'); _buildNRS('nrs-fatigue','fatigue');

  // 코치 버튼
  _buildQbtns();

  // 첫 페이지 활성화
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.querySelectorAll('.nb').forEach(function(b){ b.classList.remove('active'); });
  $id('pg-home').classList.add('active');
  $id('nb-home').classList.add('active');

  // 데이터 로드
  _xlLoad();
  if(ic){ _refreshMedHome(); _refreshTodaySym(); }
  else{ _refreshPhotos(); _refreshStats(); _refreshTip(); }

  // 날짜
  var pdi=$id('psa-date'); if(pdi) pdi.value=todayStr();
  _updateDays();

  tts('안녕하세요 '+u.name+' 님!');
}

/* ── 건강관리 홈 ── */
var _TIPS = {
  keto:['전해질 보충이 중요합니다. 나트륨·칼륨·마그네슘을 충분히 섭취하면 케토 독감 증상을 예방할 수 있습니다.','아보카도는 케토의 완벽한 음식입니다. 건강한 지방, 칼륨, 섬유질이 풍부합니다.','저강도 유산소 운동은 케톤 산화를 촉진하여 체지방 연소를 극대화합니다.','버터 커피는 아침 공복에 섭취하면 포만감을 유지하며 케토시스를 강화합니다.'],
  lchf:['정제 탄수화물(흰쌀, 설탕)을 피하고 채소로 대체하면 혈당이 안정됩니다.','식사 순서를 채소 → 단백질 → 탄수화물 순으로 하면 혈당 상승을 크게 줄일 수 있습니다.','식사 후 10~15분 가볍게 걸으면 혈당 스파이크를 효과적으로 낮출 수 있습니다.'],
  diet:['지중해식 식단의 핵심은 올리브오일, 채소, 생선, 견과류입니다. 매 식사 채소를 절반 이상 채우세요.','물을 식사 30분 전에 마시면 포만감이 높아져 칼로리 섭취를 줄일 수 있습니다.','천천히 씹어 먹는 것만으로도 포만감이 향상됩니다.']
};

var _HEALTH_CFG = {
  keto:{sub:'인슐린 통제 대사 모드',daysLbl:'연속 케토',goalBg:'linear-gradient(135deg,#2A7B7B,#1A5C5C)',goalLbl:'케토 목표',goalHtml:'<div class="goal-vals"><div class="goal-val-item"><div class="val">20g</div><div class="lbl-s">탄수화물</div></div><div class="goal-val-item"><div class="val">75%</div><div class="lbl-s">지방</div></div><div class="goal-val-item"><div class="val">20%</div><div class="lbl-s">단백질</div></div></div>',bannerSub:'케토 적합도와 영양 분석을 즉시 알려드려요',tipTitle:'오늘의 케토 팁',vg2:'"오늘 뭐 먹을까" — 케토 식단 추천'},
  lchf:{sub:'저탄고지 혈당 안정 모드',daysLbl:'저탄고지',goalBg:'linear-gradient(135deg,#1a6b4a,#0d4f35)',goalLbl:'저탄고지 목표',goalHtml:'<div class="goal-vals"><div class="goal-val-item"><div class="val">100g</div><div class="lbl-s">탄수화물</div></div><div class="goal-val-item"><div class="val">50%</div><div class="lbl-s">지방</div></div><div class="goal-val-item"><div class="val">25%</div><div class="lbl-s">단백질</div></div></div>',bannerSub:'저탄고지 적합도와 혈당 영향을 분석해 드려요',tipTitle:'오늘의 저탄고지 팁',vg2:'"오늘 뭐 먹을까" — 저탄고지 식단 추천'},
  diet:{sub:'균형 건강식 다이어트 모드',daysLbl:'다이어트',goalBg:'linear-gradient(135deg,#1565C0,#0D47A1)',goalLbl:'건강식 목표',goalHtml:'<div class="goal-vals"><div class="goal-val-item"><div class="val">1,600</div><div class="lbl-s">칼로리 목표</div></div><div class="goal-val-item"><div class="val">½</div><div class="lbl-s">채소 비율</div></div><div class="goal-val-item"><div class="val">30%</div><div class="lbl-s">단백질</div></div></div>',bannerSub:'칼로리와 영양 균형을 즉시 분석해 드려요',tipTitle:'오늘의 건강식 팁',vg2:'"오늘 뭐 먹을까" — 건강 식단 추천'}
};

function _initHealthHome(mode){
  var c = _HEALTH_CFG[mode]||_HEALTH_CFG.keto;
  var g=function(id){ return $id(id); };
  if(g('home-mode-sub')) g('home-mode-sub').textContent=c.sub;
  if(g('home-days-lbl')) g('home-days-lbl').textContent=c.daysLbl;
  if(g('home-goal-card')){ g('home-goal-card').style.background=c.goalBg; }
  if(g('home-goal-lbl')) g('home-goal-lbl').textContent=c.goalLbl;
  if(g('home-goal-items')) g('home-goal-items').innerHTML=c.goalHtml;
  if(g('home-banner-sub')) g('home-banner-sub').textContent=c.bannerSub;
  if(g('tip-title')) g('tip-title').textContent=c.tipTitle;
  if(g('vg2')) g('vg2').innerHTML='<i class="ti ti-salad"></i>'+c.vg2;
}

function _initCancerHome(u){
  var ip = u.ctype==='prostate';
  var sl={1:'1기 국소 저위험',2:'2기 국소 중·고위험',3:'3기 국소 진행성',4:'4기 전이성'};
  var sub=$id('home-mode-sub'); if(sub) sub.textContent=ip?(sl[u.stage]||'전립선암')+' 관리 중':'암 치유 관리 중';
  var dl=$id('home-days-lbl'); if(dl) dl.textContent='관리';
  var gc=$id('home-goal-card'); if(gc){ gc.style.background='linear-gradient(135deg,#4a1d96,#6B3FA0)'; }
  var gl=$id('home-goal-lbl'); if(gl) gl.textContent='최근 PSA 수치';
  var gi=$id('home-goal-items'); if(gi) gi.innerHTML='<div class="goal-vals"><div class="goal-val-item"><div class="val" id="psa-home-val">--</div><div class="lbl-s">ng/mL</div></div></div>';
  var bs=$id('home-banner-sub'); if(bs) bs.textContent='항산화·저당 관점의 암 환자 맞춤 식단 분석';
  var tt=$id('tip-title'); if(tt) tt.style.display='none';
  // 팁 박스 숨김
  var tb=document.querySelector('.tip-box'); if(tb) tb.style.display='none';
  var vg2=$id('vg2'); if(vg2) vg2.innerHTML='<i class="ti ti-chart-line"></i>"PSA 기록해줘"';
  if(ip) _refreshPSABanner();
}

function refreshTip(){
  var el=$id('tip-text'); if(!el) return;
  var mode=USER?USER.mode:'keto';
  var tips=_TIPS[mode]||_TIPS.keto;
  var idx; do{ idx=Math.floor(Math.random()*tips.length); }while(idx===_lastTipIdx&&tips.length>1);
  _lastTipIdx=idx;
  var prompts={keto:'케토제닉 식단 실천자를 위한 오늘의 팁을 1~2문장으로.',lchf:'저탄고지 식단 실천자를 위한 혈당 관리 팁을 1~2문장으로.',diet:'건강 다이어트 실천자를 위한 오늘의 식단 팁을 1~2문장으로.'};
  if(KEY){
    el.innerHTML='<div class="dots"><span></span><span></span><span></span></div>';
    _api({max_tokens:120, messages:[{role:'user',content:prompts[mode]||prompts.keto}]}, function(reply){ el.textContent=reply||tips[idx]; });
  } else { el.textContent=tips[idx]; }
}
var _refreshTip = refreshTip;

function _updateDays(){
  var ic=USER&&USER.mode==='cancer';
  var el=$id('home-days'); if(!el) return;
  var k='start';
  var start=ug(k);
  if(!start){ us(k,Date.now()); start=Date.now(); }
  el.textContent=Math.floor((Date.now()-parseInt(start))/86400000)+1+'일';
  el.style.color = ic?'var(--purple)':'var(--tld)';
}

/* ── 내비게이션 ── */
function goPage(p){
  document.querySelectorAll('.page').forEach(function(e){ e.classList.remove('active'); });
  document.querySelectorAll('.nb').forEach(function(e){ e.classList.remove('active'); });
  var pg=$id('pg-'+p); if(pg) pg.classList.add('active');
  var nb=$id('nb-'+p); if(nb) nb.classList.add('active');
  $id('pages').scrollTop=0;
  if(p==='log'){ _xlLoad(); if(USER&&USER.mode==='cancer') _loadSymCards(); }
  if(p==='track'&&USER&&USER.mode==='cancer'){ _loadPSAHistory(); _loadSymAvg(); }
  if(p==='chat'){ setTimeout(function(){ var cs=$id('chat-scroll'); if(cs) cs.scrollTop=cs.scrollHeight; },100); }
  if(p==='home'){
    if(USER&&USER.mode!=='cancer'){ _refreshPhotos(); _refreshStats(); }
    else{ _refreshMedHome(); _refreshTodaySym(); if(USER.ctype==='prostate') _refreshPSABanner(); }
  }
}

/* ── 음성 ── */
var VS='idle', VQ=[], VR=null, VBusy=false;
function _setVS(s){
  VS=s;
  var fab=$id('vfab'), icon=$id('vfab-i'), bar=$id('vbar'), dot=$id('vdot'), txt=$id('vtxt');
  fab.className='vfab'+(s!=='idle'?' '+s:'');
  if(s==='idle'){ bar.classList.remove('on'); icon.className='ti ti-microphone'; }
  else if(s==='listening'){ bar.classList.add('on'); dot.className='vdot L'; txt.textContent='듣고 있어요...'; icon.className='ti ti-microphone-off'; }
  else if(s==='thinking'){ bar.classList.add('on'); dot.className='vdot T'; txt.textContent='처리 중...'; icon.className='ti ti-loader'; }
  else if(s==='speaking'){ bar.classList.add('on'); dot.className='vdot S'; txt.textContent='답변 중...'; icon.className='ti ti-volume'; }
}
function onMic(){
  if(VS==='listening') _stopRec();
  else if(VS==='speaking'){ window.speechSynthesis&&window.speechSynthesis.cancel(); _setVS('idle'); setTimeout(_startRec,200); }
  else _startRec();
}
function _startRec(){
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ toast('음성 인식을 지원하지 않는 브라우저예요'); return; }
  VR=new SR(); VR.lang='ko-KR'; VR.continuous=false; VR.interimResults=false;
  VR.onresult=function(e){ var cmd=e.results[0][0].transcript.trim(); $id('vtxt').textContent='"'+cmd+'"'; _stopRec(); VQ.push(cmd); _runQ(); };
  VR.onerror=function(e){ _stopRec(); if(e.error==='no-speech') tts('소리가 들리지 않았어요.'); else if(e.error==='not-allowed') toast('마이크 권한이 필요합니다'); };
  VR.onend=function(){ if(VS==='listening') _stopRec(); };
  try{ VR.start(); _setVS('listening'); }catch(e){ _setVS('idle'); }
}
function _stopRec(){ try{ VR&&VR.stop(); }catch(e){} VR=null; if(VS==='listening') _setVS('idle'); }
function _runQ(){
  if(VBusy||!VQ.length) return;
  VBusy=true; var cmd=VQ.shift(); _setVS('thinking');
  _interpret(cmd).then(function(){ VBusy=false; _setVS('idle'); if(VQ.length) _runQ(); });
}
function _interpret(cmd){
  if(!KEY){ tts('API 키가 없어요.'); return Promise.resolve(); }
  var sys='한국어 음성 명령 분류기. JSON만 출력.\n출력:{"action":"페이지이동|AI코치|PSA기록|증상기록|없음","page":"diet|log|track|chat|home","say":"","query":"","psa":"","sym":"pain|urine|fatigue","nrs":""}\n규칙:-기록장/일지→페이지이동,log\n-홈/처음→페이지이동,home\n-사진/카메라→페이지이동,diet\n-PSA+숫자→PSA기록\n-통증/배뇨/피로+숫자→증상기록\n-나머지→AI코치,chat,query에원문';
  return _api({max_tokens:120,system:sys,messages:[{role:'user',content:cmd}]}, function(txt){
    txt=(txt||'').replace(/```json|```/g,'').trim();
    var r; try{ r=JSON.parse(txt); }catch(e){ r={action:'AI코치',page:'chat',query:cmd}; }
    return _execCmd(r,cmd);
  });
}
function _execCmd(r,orig){
  var a=r.action||'없음',p=r.page||'',say=r.say||'',q=r.query||orig||'';
  if(a==='페이지이동'){ if(p==='home') goPage('home'); else if(p) goPage(p); return _ttsP(say||p+'으로 이동했어요.'); }
  if(a==='AI코치'){ goPage('chat'); return _ttsP(say).then(function(){ if(q){ $id('chat-in').value=q; return _sendChatP(); } }); }
  if(a==='PSA기록'){ var v=parseFloat(r.psa); if(!isNaN(v)){ _quickSavePSA(v); return _ttsP('PSA '+v+'를 기록했어요.'); } openSheet('sh-psa'); return _ttsP('PSA 수치를 입력해 주세요.'); }
  if(a==='증상기록'){ var nrs=parseInt(r.nrs||0),sym=r.sym||'pain'; if(nrs>=0&&nrs<=10){ _quickSaveSym(sym,nrs); return _ttsP(_symLbl(sym)+' '+nrs+'점 기록됐어요.'); } openSymSheet(sym); return _ttsP(_symLbl(sym)+' 강도를 선택해 주세요.'); }
  goPage('chat'); return _ttsP('').then(function(){ $id('chat-in').value=q; return _sendChatP(); });
}
function _symLbl(s){ return{pain:'통증',urine:'배뇨 불편',fatigue:'피로'}[s]||s; }

/* ── TTS ── */
function tts(t){ _ttsP(t); }
function _ttsP(text){
  return new Promise(function(resolve){
    if(!text||!('speechSynthesis' in window)){ resolve(); return; }
    window.speechSynthesis.cancel(); _setVS('speaking');
    var u=new SpeechSynthesisUtterance(text); u.lang='ko-KR'; u.rate=0.88;
    var done=function(){ _setVS('idle'); resolve(); };
    u.onend=done; u.onerror=done; window.speechSynthesis.speak(u); setTimeout(done,15000);
  });
}

/* ── API 헬퍼 ── */
function _api(opts, cb){
  var body = {model:'claude-haiku-4-5', max_tokens:opts.max_tokens||500};
  if(opts.system) body.system=opts.system;
  body.messages=opts.messages;
  return fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':KEY,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
    body:JSON.stringify(body)
  })
  .then(function(r){ return r.json(); })
  .then(function(d){ var txt=(d.content&&d.content[0]&&d.content[0].text)||''; return cb?cb(txt):txt; })
  .catch(function(){ return cb?cb(''):null; });
}

/* ── AI 코치 ── */
function _buildQbtns(){
  var wrap=$id('qbtns'); if(!wrap) return; wrap.innerHTML='';
  var u=USER; if(!u) return;
  var ic=u.mode==='cancer', ip=ic&&u.ctype==='prostate';
  var qs;
  if(u.mode==='keto')   qs=[{i:'ti-camera',q:'방금 찍은 식사 사진 케토로 분석해줘'},{i:'ti-salad',q:'오늘 케토 식단 추천해줘'},{i:'ti-heart-rate-monitor',q:'케톤 수치가 낮아요 이유가 뭔가요?'}];
  else if(u.mode==='lchf') qs=[{i:'ti-camera',q:'이 음식 저탄고지로 분석해줘'},{i:'ti-salad',q:'저탄고지 식단 오늘 메뉴 추천해줘'},{i:'ti-chart-bar',q:'저탄고지와 케토의 차이가 뭔가요?'}];
  else if(u.mode==='diet') qs=[{i:'ti-camera',q:'이 음식 다이어트 관점으로 분석해줘'},{i:'ti-salad',q:'오늘 건강하고 살 빠지는 식단 추천해줘'},{i:'ti-heart',q:'지중해식 식단이 뭔가요?'}];
  else if(ip)           qs=[{i:'ti-camera',q:'식사 사진 암 환자 식단으로 분석해줘'},{i:'ti-chart-line',q:'PSA 수치가 올랐어요 어떻게 해야 하나요?'},{i:'ti-flame',q:'뼈 통증 관리 방법 알려주세요'}];
  else                  qs=[{i:'ti-camera',q:'식사 사진 암 환자 식단으로 분석해줘'},{i:'ti-flame',q:'항암 치료 중 통증 관리 방법은?'},{i:'ti-salad',q:'암 환자에게 좋은 항산화 식단 알려줘'}];
  wrap.innerHTML=qs.map(function(q){ return '<button class="qbtn" onclick="A.askQ(\''+esc(q.q)+'\')"><i class="ti '+q.i+'"></i>'+esc(q.q)+'</button>'; }).join('');
  var g=$id('chat-greeting');
  var mn={keto:'케토제닉',lchf:'저탄고지',diet:'다이어트 건강식'};
  if(g) g.textContent='안녕하세요, '+u.name+' 님! '+(ip?u.stage+'기 전립선암':(mn[u.mode]||'암 치유'))+' AI 코치입니다.';
}

function _buildSys(){
  var u=USER; if(!u) return'건강 코치입니다.';
  var ic=u.mode==='cancer', ip=ic&&u.ctype==='prostate';
  if(u.mode==='keto') return '케토제닉 식단 전문 건강 코치. 탄수화물 20g 이하, 지방 70~75%, 단백질 20~25%. 한국어 3~5문장.';
  if(u.mode==='lchf') return '저탄고지(LCHF) 식단 전문 건강 코치. 탄수화물 50~100g, 혈당 안정, 자연식 지방 강조. 한국어 3~5문장.';
  if(u.mode==='diet') return '다이어트 건강식 전문 코치. 지중해식·DASH 기반, 칼로리 제한, 균형 영양. 한국어 3~5문장.';
  var cd='최적 암환자 식단: ①케토/저탄고지로 암세포 포도당 차단 ②항산화(십자화과,베리,토마토) ③오메가3 ④강황·생강 항염 ⑤정제당·가공식품 배제.';
  if(ip){ var si={1:'국소 저위험',2:'국소 중·고위험',3:'국소 진행성',4:'전이성'}; return '전립선암 '+u.stage+'기('+si[u.stage]+') 환자 AI 건강 코치. '+cd+' 리코펜(토마토),십자화과,녹차 강조. 한국어 3~5문장, 필요시 의사 상담 권유.'; }
  return '암 환자 통합 치유 AI 코치. '+cd+' 한국어 3~5문장.';
}

function askQ(q){ $id('chat-in').value=q; _sendChatP(); }
function sendChat(){ _sendChatP(); }
function _sendChatP(){
  if(_chatBusy||!KEY){ if(!KEY) toast('API 키가 없습니다'); return Promise.resolve(); }
  var inp=$id('chat-in'), msg=inp.value.trim(); if(!msg) return Promise.resolve();
  inp.value='';
  var cs=$id('chat-scroll');
  var uw=document.createElement('div'); uw.className='bub-user-wrap';
  uw.innerHTML='<div class="bub user">'+esc(msg)+'</div>'; cs.appendChild(uw);
  var ld=document.createElement('div');
  ld.innerHTML='<div class="bub-lbl">AI 코치</div><div class="bub ai"><div class="dots"><span></span><span></span><span></span></div></div>';
  cs.appendChild(ld); function sd(){ setTimeout(function(){ cs.scrollTop=cs.scrollHeight; },80); } sd(); _chatBusy=true;
  return _api({max_tokens:500,system:_buildSys(),messages:[{role:'user',content:msg}]}, function(reply){
    ld.querySelector('.bub.ai').textContent=reply||'답변을 가져오지 못했어요.'; sd(); _chatBusy=false; tts(reply);
  });
}

/* ── AI 식단/운동 분석 ── */
function analyze(){
  if(!KEY){ toast('API 키가 없습니다'); return; }
  var name=$id('food-name').value.trim(), memo=$id('food-memo').value.trim();
  var pre=$id('preview-img'), hasPic=pre.src&&$id('preview-wrap').style.display!=='none';
  if(!hasPic&&!name){ toast('사진 또는 메뉴명을 입력하세요'); return; }
  var ar=$id('ai-result'); ar.style.display='block'; ar.innerHTML='<div class="dots"><span></span><span></span><span></span></div>';
  var u=USER;
  var ps={cancer:'암 환자 식단 관점에서(항산화,저당,항염,케토 적합도) 분석해 주세요. 전립선암이면 리코펜·십자화과도 언급. 3~4문장.',keto:'케토제닉 관점에서(탄단지 비율, 케토 적합도 0~10점, 혈당 영향) 분석해 주세요. 3~4문장.',lchf:'저탄고지 관점에서(탄수화물 함량, 혈당 지수, 포만감) 분석해 주세요. 3~4문장.',diet:'균형 건강식 관점에서(칼로리 추정, 영양 균형, 지중해식 적합도) 분석해 주세요. 3~4문장.'};
  var p=(ps[u?u.mode:'keto']||ps.keto);
  var msgs;
  if(hasPic){ var b64=pre.src.split(',')[1],mt=pre.src.startsWith('data:image/png')?'image/png':'image/jpeg'; var txt=p; if(name)txt+=' 음식:'+name; if(memo)txt+=' 메모:'+memo; msgs=[{role:'user',content:[{type:'image',source:{type:'base64',media_type:mt,data:b64}},{type:'text',text:txt}]}]; }
  else{ msgs=[{role:'user',content:'"'+name+'"을 '+p}]; }
  _api({max_tokens:400,messages:msgs}, function(reply){ ar.textContent=reply||'분석 결과를 가져오지 못했어요.'; tts(reply); });
}

function analyzeEx(){
  if(!KEY){ toast('API 키가 없습니다'); return; }
  var type=$id('ex-type').value.trim(); if(!type){ toast('운동 종류를 입력하세요'); return; }
  var dur=$id('ex-dur').value.trim();
  var ar=$id('ai-result'); ar.style.display='block'; ar.innerHTML='<div class="dots"><span></span><span></span><span></span></div>';
  var u=USER, ic=u&&u.mode==='cancer';
  var p='"'+type+'" '+dur+'을 ';
  p+=ic?'암 환자 관점에서(면역 기능, 체력 유지, 피로 관리) 분석해 주세요. 3~4문장.':'케토/저탄고지 식단 관점에서(지방 연소, 케톤 생성, 운동 후 식사 주의사항) 분석해 주세요. 3~4문장.';
  _api({max_tokens:350,messages:[{role:'user',content:p}]}, function(reply){ ar.textContent=reply||'분석 결과를 가져오지 못했어요.'; tts(reply); });
}

function setDietTab(t){
  ['food','ex'].forEach(function(x){ $id('tb-'+x).className='tbtn '+x+(t===x?' active':''); });
  $id('food-form').style.display=t==='food'?'':'none';
  $id('ex-form').style.display=t==='ex'?'':'none';
  $id('preview-wrap').style.display='none';
  $id('ai-result').style.display='none';
}

function setCancerTab(t){
  ['sym','med'].forEach(function(x){ $id('tb-'+x).className='tbtn '+x+(t===x?' active':''); });
  $id('sym-form').style.display=t==='sym'?'':'none';
  $id('med-form').style.display=t==='med'?'':'none';
}

/* ── PSA ── */
function _getPSA(){ return ugj('psa',[]); }
function _setPSA(d){ usj('psa',d); }

function _buildPSABanner(){ return '<div class="psa-banner"><div class="psa-lbl">최근 PSA 수치</div><div class="psa-main"><div class="psa-num" id="psa-home-num">--</div><div class="psa-unit" style="margin-bottom:5px;">ng/mL</div></div><div id="psa-home-badge"></div><button class="psa-rec-btn" onclick="A.openSheet(\'sh-psa\')"><i class="ti ti-plus"></i> PSA 기록</button></div>'; }

function _refreshPSABanner(){
  var data=_getPSA();
  var numEl=$id('psa-home-num'), gv=$id('home-goal-items');
  if(!data.length){ if(numEl) numEl.textContent='--'; return; }
  var last=data[data.length-1];
  if(numEl) numEl.textContent=last.v.toFixed(1);
  if(gv) gv.querySelector&&(gv.querySelector('.val')&&(gv.querySelector('.val').textContent=last.v.toFixed(1)));
  var badge=$id('psa-home-badge'); if(!badge) return;
  var cls='warn',txt='첫 기록';
  if(data.length>=2){ var diff=last.v-data[data.length-2].v; if(diff<-0.5){cls='good';txt='▼ 감소';}else if(diff>0.5){cls='danger';txt='▲ 증가 — 의사 상담';}else{cls='warn';txt='→ 안정적';} }
  badge.innerHTML='<span class="psa-badge '+cls+'">'+txt+'</span>';
}

function openSheet(id){ $id(id)&&$id(id).classList.add('on'); }
function closeSheet(id){ $id(id)&&$id(id).classList.remove('on'); }

function savePSA(){
  var v=parseFloat($id('psa-val').value); if(isNaN(v)||v<0){ toast('유효한 수치를 입력하세요'); return; }
  var data=_getPSA();
  data.push({v:v,date:$id('psa-date').value||todayStr(),note:$id('psa-note').value||'',ts:Date.now()});
  _setPSA(data); closeSheet('sh-psa'); _refreshPSABanner(); _loadPSAHistory();
  toast('PSA '+v+' ng/mL 저장됐어요');
}

function _quickSavePSA(v){ var data=_getPSA(); data.push({v:v,date:todayStr(),note:'',ts:Date.now()}); _setPSA(data); _refreshPSABanner(); _loadPSAHistory(); }

function _loadPSAHistory(){
  var el=$id('psa-history'); if(!el) return;
  var data=_getPSA();
  if(!data.length){ el.innerHTML='<div class="empty-state" style="padding:18px;"><i class="ti ti-chart-line"></i><br>PSA 기록이 없어요.</div>'; return; }
  el.innerHTML='';
  [].concat(data).reverse().forEach(function(item,i,arr){
    var prev=arr[i+1],ac='',at='→';
    if(prev){ if(item.v>prev.v){ac='up';at='▲';}else if(item.v<prev.v){ac='dn';at='▼';} }
    var row=document.createElement('div'); row.className='psa-row-item';
    row.innerHTML='<div><div class="psa-row-date">'+item.date+'</div>'+(item.note?'<div style="font-size:10px;color:var(--mu);">'+esc(item.note)+'</div>':'')+'</div>'
      +'<div style="display:flex;align-items:center;gap:6px;"><span class="psa-arr '+(ac||'')+'">'+at+'</span><span class="psa-row-val">'+item.v.toFixed(1)+' <span style="font-size:10px;font-weight:400;color:var(--mu);">ng/mL</span></span></div>';
    el.appendChild(row);
  });
}

/* ── 증상 ── */
function _buildNRS(cid,type){
  var c=$id(cid); if(!c) return; c.innerHTML='';
  for(var i=0;i<=10;i++){ (function(n){
    var dot=document.createElement('div'); dot.className='nrs-dot'; dot.textContent=n;
    dot.onclick=function(){ c.querySelectorAll('.nrs-dot').forEach(function(d){ d.classList.remove('sel','low','mid','high'); }); dot.classList.add('sel',n<=3?'low':n<=6?'mid':'high'); _symNRS[type]=n; };
    c.appendChild(dot);
  })(i); }
}

function _buildNRSQuick(){
  var c=$id('sh-nrs-scale'); if(!c) return; c.innerHTML='';
  for(var i=0;i<=10;i++){ (function(n){
    var dot=document.createElement('div'); dot.className='nrs-sd'; dot.textContent=n;
    dot.onclick=function(){ c.querySelectorAll('.nrs-sd').forEach(function(d){ d.classList.remove('sel','low','mid','high'); }); dot.classList.add('sel',n<=3?'low':n<=6?'mid':'high'); _quickNRS=n; };
    c.appendChild(dot);
  })(i); }
}

function openSymSheet(type){ _curSym=type; _quickNRS=0; _buildNRSQuick(); var lbls={pain:'통증',urine:'배뇨 불편',fatigue:'피로도'}; var t=$id('sh-sym-title'); if(t) t.textContent=(lbls[type]||type)+' 기록'; openSheet('sh-sym'); }

function saveSymQuick(){
  var today=todayStr(), data=_getSym();
  if(!data[today]) data[today]={};
  data[today][_curSym]=_quickNRS; data[today].ts=Date.now();
  _setSym(data); closeSheet('sh-sym'); _refreshTodaySym();
  toast(_symLbl(_curSym)+' '+_quickNRS+'점 저장됐어요');
}

function _getSym(){ return ugj('sym',{}); }
function _setSym(d){ usj('sym',d); }

function _quickSaveSym(type,nrs){ var today=todayStr(),data=_getSym(); if(!data[today])data[today]={}; data[today][type]=nrs; data[today].ts=Date.now(); _setSym(data); _refreshTodaySym(); }

function _refreshTodaySym(){
  var today=todayStr(), d=(_getSym()[today])||{};
  [{k:'pain',id:'sd-pain'},{k:'urine',id:'sd-urine'},{k:'fatigue',id:'sd-fatigue'}].forEach(function(x){
    var el=$id(x.id); if(el) el.textContent=d[x.k]!==undefined?d[x.k]+'점':'미기록';
  });
}

function saveSym(){
  var today=todayStr(),data=_getSym();
  if(!data[today])data[today]={};
  data[today].pain=_symNRS.pain; data[today].urine=_symNRS.urine; data[today].fatigue=_symNRS.fatigue;
  data[today].memo=$id('sym-memo').value; data[today].ts=Date.now();
  _setSym(data); _refreshTodaySym(); toast('증상 저장됐어요'); _showAutosave();
  $id('sym-memo').value='';
}

function _loadSymCards(){
  var sc=$id('sym-log-cards'), se=$id('sym-log-empty'); if(!sc) return;
  sc.innerHTML='';
  var data=_getSym(), keys=Object.keys(data).sort().reverse();
  if(se) se.style.display=keys.length?'none':'block';
  keys.forEach(function(date){
    var d=data[date];
    var card=document.createElement('div'); card.className='sym-log-card';
    var hd=document.createElement('div'); hd.className='sym-log-hd';
    var del=document.createElement('button'); del.className='sym-log-del'; del.innerHTML='<i class="ti ti-trash"></i>';
    del.onclick=function(){ var sd=_getSym(); delete sd[date]; _setSym(sd); _loadSymCards(); };
    hd.innerHTML='<div class="sym-log-date">'+esc(date)+'</div>'; hd.appendChild(del); card.appendChild(hd);
    var body=document.createElement('div'); body.className='sym-log-body';
    [{k:'pain',l:'통증',ic:'pain'},{k:'urine',l:'배뇨',ic:'urine'},{k:'fatigue',l:'피로',ic:'fatigue'}].forEach(function(r){
      if(d[r.k]===undefined) return;
      var row=document.createElement('div'); row.className='sym-log-row';
      row.innerHTML='<div class="sym-log-icon '+r.ic+'"><i class="ti ti-'+({pain:'flame',urine:'droplet',fatigue:'zzz'}[r.k])+'"></i></div><div class="sym-log-key">'+r.l+'</div><div class="sym-log-val">'+d[r.k]+'점</div>';
      body.appendChild(row);
    });
    if(d.memo){ var m=document.createElement('div'); m.style.cssText='font-size:11px;color:var(--mu);padding-top:3px;'; m.textContent=d.memo; body.appendChild(m); }
    card.appendChild(body); sc.appendChild(card);
  });
}

function _loadSymAvg(){
  var data=_getSym(),now=Date.now(),week=7*86400000,pain=[],fatigue=[];
  Object.values(data).forEach(function(d){ if(d.ts&&now-d.ts<week){ if(d.pain!==undefined)pain.push(d.pain); if(d.fatigue!==undefined)fatigue.push(d.fatigue); } });
  var avg=function(arr){ return arr.length?(arr.reduce(function(a,b){return a+b;},0)/arr.length).toFixed(1):'-'; };
  var ep=$id('avg-pain'),ef=$id('avg-fatigue');
  if(ep)ep.textContent=avg(pain); if(ef)ef.textContent=avg(fatigue);
}

/* ── 복약 ── */
function _getMeds(){ return ugj('meds',[]); }
function _setMeds(d){ usj('meds',d); }
function _getMedDone(){ return ugj('med_done',{}); }
function _setMedDone(d){ usj('med_done',d); }

function saveMedForm(){
  var name=$id('med-nm').value.trim(); if(!name){toast('약 이름을 입력하세요');return;}
  var meds=_getMeds(); meds.push({id:Date.now(),name:name,dose:$id('med-dose').value.trim(),time:$id('med-time').value.trim()});
  _setMeds(meds); _refreshMedHome();
  $id('med-nm').value=''; $id('med-dose').value=''; $id('med-time').value='';
  toast(name+' 추가됐어요');
}

function saveMedSheet(){
  var name=$id('sh-med-nm').value.trim(); if(!name){toast('약 이름을 입력하세요');return;}
  var meds=_getMeds(); meds.push({id:Date.now(),name:name,dose:'',time:$id('sh-med-time').value.trim()});
  _setMeds(meds); closeSheet('sh-med'); _refreshMedHome(); toast(name+' 추가됐어요');
}

function toggleMed(id){
  var done=_getMedDone(),today=todayStr();
  if(!done[today])done[today]={};
  done[today][id]=!done[today][id]; _setMedDone(done); _refreshMedHome();
  if(done[today][id]) toast('복약 완료 ✓');
}

function deleteMed(id){ _setMeds(_getMeds().filter(function(m){return m.id!==id;})); _refreshMedHome(); }

function _refreshMedHome(){
  var el=$id('med-list-home'); if(!el) return;
  var meds=_getMeds(),done=_getMedDone(),today=todayStr();
  el.innerHTML='';
  meds.forEach(function(med){
    var isDone=done[today]&&done[today][med.id];
    var item=document.createElement('div'); item.className='med-item';
    item.innerHTML='<div class="med-check'+(isDone?' done':'')+'" onclick="A.toggleMed('+med.id+')">'+(isDone?'<i class="ti ti-check"></i>':'')+'</div>'
      +'<div style="flex:1"><div class="med-nm">'+esc(med.name)+(med.dose?' <span style="font-size:10px;color:var(--mu);">'+esc(med.dose)+'</span>':'')+'</div>'+(med.time?'<div class="med-tm">'+esc(med.time)+'</div>':'')+'</div>'
      +'<button style="background:none;border:none;color:var(--mu);font-size:15px;padding:3px;" onclick="A.deleteMed('+med.id+')"><i class="ti ti-x"></i></button>';
    el.appendChild(item);
  });
  var addBtn=document.createElement('button'); addBtn.className='med-add-btn';
  addBtn.innerHTML='<i class="ti ti-plus"></i> 복약 추가';
  addBtn.onclick=function(){ $id('sh-med-nm').value=''; $id('sh-med-time').value=''; openSheet('sh-med'); };
  el.appendChild(addBtn);
}

/* ── 이미지 압축 ── */
function _compress(dataUrl,cb){
  var img=new Image(); img.onload=function(){
    var c=$id('cc'),MAX=700,w=img.width,h=img.height;
    if(w>MAX){h=Math.round(h*MAX/w);w=MAX;}
    c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);
    cb(c.toDataURL('image/jpeg',0.72));
  }; img.src=dataUrl;
}

/* ── 사진 파일 선택 ── */
function pickPhoto(src){ closeSheet('sh-photo'); $id('f-'+src).value=''; $id('f-'+src).click(); }
function onFile(e,src){
  var f=e.target.files[0]; e.target.value=''; if(!f) return;
  var r=new FileReader(); r.onload=function(ev){ _compress(ev.target.result,function(small){
    $id('preview-img').src=small; $id('preview-wrap').style.display=''; goPage('diet');
  }); }; r.readAsDataURL(f);
}

function pickMeal(src){ closeSheet('sh-meal'); $id('f-meal-'+src).value=''; $id('f-meal-'+src).click(); }
function onMealFile(e,src){
  var f=e.target.files[0]; e.target.value=''; if(!f) return;
  var r=new FileReader(); r.onload=function(ev){ _compress(ev.target.result,function(small){
    if(!_pendMeal) return;
    var p=_pendMeal; _pendMeal=null;
    var card=$id(p.cardId); if(!card) return;
    var slot=card.querySelector('[data-meal="'+p.meal+'"]'); if(!slot) return;
    _saveRot(p.cardId,p.meal,0); _renderFilled(slot,small,0); _schedSave(); _refreshPhotos(); _refreshStats();
    toast('사진이 저장됐어요 ✓');
  }); }; r.readAsDataURL(f);
}

/* ── 식단 기록장 ── */
function _getRecs(){ return ugj('records',[]); }
function _setRecs(d){ usj('records',d); }

function addLogDay(){
  var card=_makeCard({date:todayStr(),photos:{},steps:''});
  $id('log-cards').appendChild(card); $id('log-empty').style.display='none';
  card.scrollIntoView({behavior:'smooth',block:'nearest'}); _schedSave();
}

function _makeCard(d){
  _cardSeq++;
  var id='card-'+_cardSeq;
  var card=document.createElement('div'); card.className='day-card'; card.id=id;
  var hd=document.createElement('div'); hd.className='day-hd';
  var di=document.createElement('input'); di.className='day-date'; di.type='text'; di.value=d.date||''; di.placeholder='26년 05월 25일'; di.addEventListener('input',_schedSave);
  var del=document.createElement('button'); del.className='day-del'; del.innerHTML='<i class="ti ti-trash"></i>'; del.addEventListener('click',function(){_delCard(card);});
  hd.appendChild(di); hd.appendChild(del); card.appendChild(hd);
  var grid=document.createElement('div'); grid.className='meal-grid';
  ['morning','lunch','dinner'].forEach(function(meal){ var slot=document.createElement('div'); slot.setAttribute('data-meal',meal); grid.appendChild(slot); });
  card.appendChild(grid);
  var sr=document.createElement('div'); sr.className='steps-row';
  var sl=document.createElement('span'); sl.className='steps-lbl'; sl.innerHTML='<i class="ti ti-walk"></i>만보';
  var si=document.createElement('input'); si.className='steps-in'; si.type='text'; si.value=d.steps||''; si.placeholder='오늘 걸음 수'; si.addEventListener('input',_schedSave);
  sr.appendChild(sl); sr.appendChild(si); card.appendChild(sr);
  card.querySelectorAll('[data-meal]').forEach(function(slot){ var meal=slot.getAttribute('data-meal'),photo=d.photos?d.photos[meal]:null; if(photo) _renderFilled(slot,photo,_loadRot(id,meal)); else _renderEmpty(slot); });
  return card;
}

function _renderEmpty(slot){
  var meal=slot.getAttribute('data-meal'),cid=slot.closest('.day-card').id;
  var lm={morning:'아침',lunch:'점심',dinner:'저녁'},lc={morning:'am',lunch:'pm',dinner:'ev'};
  slot.innerHTML='<div class="meal-lbl '+lc[meal]+'">'+lm[meal]+'</div><div class="meal-empty" onclick="A._openMealSheet(\''+cid+'\',\''+meal+'\')"><i class="ti ti-camera-plus"></i><span>탭하여<br>선택</span></div>';
  slot.removeAttribute('data-photo');
}

function _renderFilled(slot,url,rot){
  var meal=slot.getAttribute('data-meal'),cid=slot.closest('.day-card').id;
  var lm={morning:'아침',lunch:'점심',dinner:'저녁'},lc={morning:'am',lunch:'pm',dinner:'ev'};
  slot.setAttribute('data-photo',url);
  slot.innerHTML='<div class="meal-lbl '+lc[meal]+'">'+lm[meal]+'</div><div class="meal-filled" onclick="A._openViewer(\''+cid+'\',\''+meal+'\')" ><img src="'+url+'" alt="'+lm[meal]+'" style="transform:rotate('+(rot||0)+'deg)"><div class="meal-overlay"><i class="ti ti-eye"></i></div></div>';
}

function _openMealSheet(cardId,meal){ _pendMeal={cardId:cardId,meal:meal}; var lm={morning:'아침',lunch:'점심',dinner:'저녁'}; $id('sh-meal-title').textContent=(lm[meal]||meal)+' 사진 선택'; openSheet('sh-meal'); }

function _delCard(card){ card.remove(); if(!$id('log-cards').children.length) $id('log-empty').style.display='block'; _schedSave(); _refreshPhotos(); }

function _schedSave(){ if(_saveTimer) clearTimeout(_saveTimer); _saveTimer=setTimeout(_doSave,800); }
function _doSave(){
  var days=[]; document.querySelectorAll('#log-cards .day-card').forEach(function(card){
    var photos={}; card.querySelectorAll('[data-meal]').forEach(function(slot){ var p=slot.getAttribute('data-photo'); if(p) photos[slot.getAttribute('data-meal')]=p; });
    days.push({date:card.querySelector('.day-date').value,steps:card.querySelector('.steps-in').value,photos:photos});
  });
  _setRecs(days); _showAutosave(); _refreshPhotos(); _refreshStats();
}

function _xlLoad(){
  var days=_getRecs(); var c=$id('log-cards'); c.innerHTML=''; _cardSeq=0;
  $id('log-empty').style.display=days.length?'none':'block';
  days.forEach(function(d){ c.appendChild(_makeCard(d)); });
}

function exportExcel(){
  var days=_getRecs(); if(!days.length){toast('기록이 없습니다');return;}
  var aoa=[['스마트 메타케어 식단 일지'],[],['날짜','아침','점심','저녁','만보']];
  days.forEach(function(d){ aoa.push([d.date,d.photos&&d.photos.morning?'✓':'',d.photos&&d.photos.lunch?'✓':'',d.photos&&d.photos.dinner?'✓':'',d.steps]); });
  if(USER&&USER.mode==='cancer'){
    var symData=_getSym(),psaData=_getPSA(),medData=_getMeds();
    aoa.push([],[' === 증상 기록 ==='],['날짜','통증','배뇨','피로','메모']);
    Object.keys(symData).sort().forEach(function(date){ var d=symData[date]; aoa.push([date,d.pain!==undefined?d.pain:'',d.urine!==undefined?d.urine:'',d.fatigue!==undefined?d.fatigue:'',d.memo||'']); });
    if(psaData.length){ aoa.push([],[' === PSA 기록 ==='],['날짜','수치(ng/mL)','메모']); psaData.forEach(function(p){ aoa.push([p.date,p.v,p.note||'']); }); }
    if(medData.length){ aoa.push([],[' === 복약 목록 ==='],['약 이름','용량','시간']); medData.forEach(function(m){ aoa.push([m.name,m.dose||'',m.time||'']); }); }
  }
  var ws=XLSX.utils.aoa_to_sheet(aoa); ws['!cols']=[{wch:16},{wch:8},{wch:8},{wch:8},{wch:12}];
  var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'기록');
  XLSX.writeFile(wb,'metacare_'+todayStr().replace(/[년월일\s]/g,'')+'.xlsx'); toast('엑셀 저장 완료!');
}

/* ── 홈 그리드 & 통계 ── */
function _refreshPhotos(){
  var grid=$id('home-photos'); if(!grid) return;
  var days=_getRecs(), meals=['morning','lunch','dinner'], lbls={morning:'아침',lunch:'점심',dinner:'저녁'}, photos=[];
  for(var i=days.length-1;i>=0&&photos.length<4;i--){ if(!days[i].photos) continue; for(var m=0;m<meals.length&&photos.length<4;m++){ var p=days[i].photos[meals[m]]; if(p) photos.push({url:p,label:lbls[meals[m]]}); } }
  grid.innerHTML='';
  photos.forEach(function(ph){ var item=document.createElement('div'); item.className='photo-item'; item.onclick=(function(u,l){return function(){_openHomeViewer(u,l);};})(ph.url,ph.label); item.innerHTML='<img src="'+ph.url+'" alt="'+ph.label+'"><span class="ph-tag">'+ph.label+'</span>'; grid.appendChild(item); });
  for(var k=photos.length;k<4;k++){ var empty=document.createElement('div'); empty.className='photo-empty'; empty.innerHTML='<i class="ti ti-camera-plus"></i><span>기록장에서<br>추가</span>'; empty.onclick=function(){goPage('log');}; grid.appendChild(empty); }
}

function _refreshStats(){
  var days=_getRecs(),today=todayStr();
  var todayData=days.find(function(d){return d.date===today;});
  // 건강관리 모드에서만 stat 섹션 있음
}

/* ── 뷰어 ── */
function _openViewer(cid,meal){
  var card=$id(cid); if(!card) return;
  var slot=card.querySelector('[data-meal="'+meal+'"]'); if(!slot) return;
  var photo=slot.getAttribute('data-photo'); if(!photo) return;
  _vCtx={cid:cid,meal:meal}; _vRot=_loadRot(cid,meal);
  $id('viewer-img').src=photo; $id('viewer-img').style.transform='rotate('+_vRot+'deg)';
  $id('viewer').classList.add('on');
}
function closeViewer(){ $id('viewer').classList.remove('on'); _vCtx=null; }
function vRot(deg){
  if(!_vCtx) return; _vRot=(_vRot+deg+360)%360;
  $id('viewer-img').style.transform='rotate('+_vRot+'deg)';
  _saveRot(_vCtx.cid,_vCtx.meal,_vRot);
  var card=$id(_vCtx.cid); if(card){ var si=card.querySelector('[data-meal="'+_vCtx.meal+'"] img'); if(si) si.style.transform='rotate('+_vRot+'deg)'; }
}
function vChg(){
  if(!_vCtx) return; _pendMeal={cardId:_vCtx.cid,meal:_vCtx.meal}; closeViewer();
  var lm={morning:'아침',lunch:'점심',dinner:'저녁'}; $id('sh-meal-title').textContent=(lm[_pendMeal.meal]||_pendMeal.meal)+' 사진 교체'; openSheet('sh-meal');
}
function vDel(){
  if(!_vCtx) return; if(!confirm('이 사진을 삭제할까요?')) return;
  var card=$id(_vCtx.cid); if(card){ var slot=card.querySelector('[data-meal="'+_vCtx.meal+'"]'); if(slot) _renderEmpty(slot); }
  _delRot(_vCtx.cid,_vCtx.meal); closeViewer(); _schedSave(); toast('사진이 삭제됐어요');
}
function _openHomeViewer(url,lbl){ $id('hv-img').src=url; $id('home-viewer').classList.add('on'); }
function closeHomeViewer(){ $id('home-viewer').classList.remove('on'); }

/* ── 회전값 ── */
function _allRot(){ return ugj('rot',{}); }
function _loadRot(c,m){ var a=_allRot(); return(a[c]&&a[c][m])||0; }
function _saveRot(c,m,d){ var a=_allRot(); if(!a[c])a[c]={}; a[c][m]=d; usj('rot',a); }
function _delRot(c,m){ var a=_allRot(); if(a[c]){ delete a[c][m]; usj('rot',a); } }

/* ── 자동저장 배지 ── */
function _showAutosave(){ var b=$id('autosave'); if(!b) return; b.classList.add('show'); setTimeout(function(){b.classList.remove('show');},1800); }

/* ── 초기 진입 ── */
(function(){
  var pw=S.g('mc_pw')||S.g('mc_admin_pw');
  if(!pw){ $id('scr-init').classList.add('active'); }
  else {
    // 구버전 키 마이그레이션
    if(!S.g('mc_pw')&&S.g('mc_admin_pw')) S.s('mc_pw', S.g('mc_admin_pw'));
    if(!S.g('mc_ant')&&S.g('mc_ant_key')) S.s('mc_ant', S.g('mc_ant_key'));
    KEY=S.g('mc_ant')||''; _renderProfileList(); $id('scr-profile').classList.add('active');
  }
})();

/* ── 공개 API ── */
return {
  // 화면
  goScreen:goScreen,
  // 설정
  init:init, checkPw:checkPw,
  // Admin
  delUser:delUser, changePw:changePw, backup:backup, restore:restore, fullReset:fullReset,
  // 사용자 추가
  _selMode:_selMode, _selCtype:_selCtype, _selStage:_selStage, addUser:addUser,
  // 앱
  goPage:goPage, onMic:onMic,
  // 팁
  refreshTip:refreshTip,
  // 코치
  askQ:askQ, sendChat:sendChat,
  // 식단 분석
  analyze:analyze, analyzeEx:analyzeEx, setDietTab:setDietTab, setCancerTab:setCancerTab,
  // PSA
  openSheet:openSheet, closeSheet:closeSheet, savePSA:savePSA,
  // 증상
  openSymSheet:openSymSheet, saveSymQuick:saveSymQuick, saveSym:saveSym,
  // 복약
  saveMedForm:saveMedForm, saveMedSheet:saveMedSheet, toggleMed:toggleMed, deleteMed:deleteMed,
  // 사진
  pickPhoto:pickPhoto, onFile:onFile, pickMeal:pickMeal, onMealFile:onMealFile,
  // 기록장
  addLogDay:addLogDay, exportExcel:exportExcel,
  // 뷰어
  _openViewer:_openViewer, closeViewer:closeViewer, vRot:vRot, vChg:vChg, vDel:vDel,
  closeHomeViewer:closeHomeViewer,
  // 기록장 내부
  _openMealSheet:_openMealSheet
};

})();
