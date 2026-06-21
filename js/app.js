'use strict';

/* ════════════════════════════
   A — 앱 전체 네임스페이스
════════════════════════════ */
var A = (function(){

/* ══════════════════════════════════════════════════════
   ⚠️  절대 변경 금지 구역 (CRITICAL - DO NOT MODIFY)
   아래 함수/변수는 데이터 구조의 핵심입니다.
   변경 시 기존 사용자 데이터가 모두 손실됩니다.
   
   - todayStr()       : 날짜 형식 YYYY-MM-DD 고정
   - uk(k)            : 사용자별 키 접두사 고정
   - _getRecs()       : records 키 이름 고정
   - _setRecs()       : records 키 이름 고정
   - _cache           : Firestore 동기화 캐시
   - _docRef          : Firestore 문서 경로 고정
══════════════════════════════════════════════════════ */

/* ── 상태 ── */
var KEY = ''; // Anthropic API key - Firebase에서 로드
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
var _logoTapCount = 0;
var _logoTapTimer = null;

/* ── Firebase 초기화 ── */
var firebaseConfig = {
  apiKey: "AIzaSyCOYX1JyAqM7nZHQGc4QzjiOS6mNvFlEYc",
  authDomain: "metacare-voice.firebaseapp.com",
  projectId: "metacare-voice",
  storageBucket: "metacare-voice.firebasestorage.app",
  messagingSenderId: "977034749190",
  appId: "1:977034749190:web:077af2245949e0134b2a87"
};
firebase.initializeApp(firebaseConfig);
var _db = firebase.firestore();
var _docRef = _db.collection('metacare').doc('data');
var _storage = firebase.storage();

/* ── 스토리지 헬퍼 (메모리 캐시 + Firestore 동기화) ── */
var _cache = {};        // 모든 키-값을 메모리에 보관 (동기 접근용)
var _cacheReady = false;
var _saveCloudTimer = null;

function _saveCloud(){
  if(_saveCloudTimer) clearTimeout(_saveCloudTimer);
  _saveCloudTimer = setTimeout(function(){
    _docRef.set(_cache).catch(function(err){ console.error('Firestore 저장 오류', err); });
  }, 500);
}

var S = {
  g: function(k){ return (_cache[k]===undefined||_cache[k]===null) ? null : _cache[k]; },
  s: function(k,v){ _cache[k]=v; _saveCloud(); },
  gj: function(k,d){ try{ return JSON.parse(S.g(k)||'null')||d; }catch(e){ return d; } },
  sj: function(k,v){ S.s(k, JSON.stringify(v)); }
};

// 사용자별 키
function uk(k){ return 'mc_'+USER.id+'_'+k; }
function ug(k){ return S.g(uk(k)); }
function us(k,v){ S.s(uk(k),v); }
function ugj(k,d){ try{ return JSON.parse(ug(k)||'null')||d; }catch(e){ return d; } }
function usj(k,v){ us(k,JSON.stringify(v)); }

/* ── 클라우드에서 초기 데이터 로드 ── */
function _loadCloudData(cb){
  // API 키와 앱 데이터를 병렬로 로드
  var keyLoaded = false, dataLoaded = false;
  var tryDone = function(){
    if(keyLoaded && dataLoaded) cb();
  };

  // API 키 로드
  _db.collection('config').doc('api').get().then(function(doc){
    if(doc.exists && doc.data().Key) KEY = doc.data().Key;
    else if(doc.exists && doc.data().key) KEY = doc.data().key;
    console.log('KEY 로드:', KEY ? '성공 ('+KEY.slice(0,20)+'...)' : '실패 - doc.exists:'+doc.exists);
    keyLoaded = true; tryDone();
  }).catch(function(err){ console.error('KEY 로드 오류:', err); keyLoaded = true; tryDone(); });

  // 앱 데이터 로드
  _docRef.get().then(function(doc){
    _cache = doc.exists ? (doc.data()||{}) : {};
    _cacheReady = true;
    dataLoaded = true;
    // 데이터 로드 후 자동 백업
    setTimeout(_autoBackup, 2000);
    tryDone();
  }).catch(function(err){
    console.error('Firestore 로드 오류', err);
    _cache = {};
    _cacheReady = true;
    dataLoaded = true; tryDone();
  });
}

/* ══════════════════════════════════════════════════════
   🛡️  자동 백업 시스템 (AUTO-BACKUP SYSTEM)
   앱 로드 시 자동으로 스냅샷 저장
   최근 7일치 보관, 언제든 복구 가능
══════════════════════════════════════════════════════ */
function _autoBackup(){
  try {
    var today = new Date();
    var dateKey = today.getFullYear()+'-'
      +String(today.getMonth()+1).padStart(2,'0')+'-'
      +String(today.getDate()).padStart(2,'0');
    var backupKey = 'mc_backup_'+dateKey;
    
    // 오늘 백업이 이미 있으면 건너뜀
    if(_cache[backupKey]) return;
    
    // 현재 전체 캐시를 스냅샷으로 저장
    var snapshot = JSON.stringify(_cache);
    _cache[backupKey] = snapshot;
    
    // 7일 이상 된 백업 자동 삭제
    var cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - 7);
    Object.keys(_cache).forEach(function(k){
      if(k.startsWith('mc_backup_')){
        var keyDate = k.replace('mc_backup_','');
        if(keyDate < cutoff.getFullYear()+'-'
          +String(cutoff.getMonth()+1).padStart(2,'0')+'-'
          +String(cutoff.getDate()).padStart(2,'0')){
          delete _cache[k];
        }
      }
    });
    
    // Firestore에 저장
    _saveCloud();
    console.log('✅ 자동 백업 완료:', dateKey);
  } catch(e) {
    console.error('백업 오류:', e);
  }
}

function _listBackups(){
  return Object.keys(_cache)
    .filter(function(k){ return k.startsWith('mc_backup_'); })
    .sort().reverse();
}

function _restoreBackup(dateKey){
  var backupKey = 'mc_backup_'+dateKey;
  if(!_cache[backupKey]){ toast('백업을 찾을 수 없습니다'); return false; }
  try {
    var snapshot = JSON.parse(_cache[backupKey]);
    // 백업 데이터를 현재 캐시에 복원 (백업 키는 유지)
    var backups = {};
    Object.keys(_cache).forEach(function(k){
      if(k.startsWith('mc_backup_')) backups[k]=_cache[k];
    });
    _cache = Object.assign({}, snapshot, backups);
    _saveCloud();
    toast('✅ '+dateKey+' 백업으로 복원됐습니다. 앱을 새로고침하세요.');
    return true;
  } catch(e) {
    toast('복원 실패: '+e.message);
    return false;
  }
}
function $id(id){ return document.getElementById(id); }
function toast(msg){ var t=$id('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(function(){ t.classList.remove('show'); }, 2500); }

function _showGreeting(name){
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(26,47,76,.92);z-index:9999;gap:14px;';
  el.innerHTML = '<div style="font-size:52px;">🧬</div>'
    +'<div style="color:#fff;font-size:22px;font-weight:700;">안녕하세요</div>'
    +'<div style="color:#7DFFC8;font-size:26px;font-weight:700;">'+esc(name)+' 님!</div>'
    +'<div style="color:rgba(255,255,255,.55);font-size:14px;margin-top:4px;">AI로 관리 받으세요</div>';
  document.body.appendChild(el);
  setTimeout(function(){ el.style.transition='opacity .5s'; el.style.opacity='0'; setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 500); }, 2000);
}
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function todayStr(){ var d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function pad(n){ return n<10?'0'+n:String(n); }

/* ── 화면 전환 ── */
var _navStack = [];
var _suppressPush = false;

function goScreen(id, opts){
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  var el = $id(id);
  if(el) el.classList.add('active');
  if(id==='scr-profile'){
    // 로그아웃 시 자동 로그인 정보 삭제
    try{ localStorage.removeItem('mc_last_user'); }catch(e){}
    USER = null;
  }
  if(id==='scr-admin-users') _renderAdminList();
  if(id==='scr-admin-monitor') _renderMonitorList();
  if(id==='scr-add-user') _resetAddForm();
  if(!_suppressPush){
    _navStack.push({type:'screen', id:id});
    try{ history.pushState({navIdx:_navStack.length-1}, '', '#'+id); }catch(e){}
  }
}

function _handlePopState(e){
  goBack();
  try{ history.pushState({navIdx:0}, '', location.href); }catch(e2){}
}
window.addEventListener('popstate', _handlePopState);

// 앱 종료 방지 - 초기 히스토리 2개 쌓기
try{
  history.pushState({navIdx:-1}, '', location.href);
  history.pushState({navIdx:0}, '', location.href);
}catch(e){}

/* (최초 설정 화면 제거됨 — API 키는 코드에 내장되어 있음) */

/* ── Admin 진입 (로고 5탭) ── */
function logoTap(){
  _logoTapCount++;
  if(_logoTapTimer) clearTimeout(_logoTapTimer);
  _logoTapTimer = setTimeout(function(){ _logoTapCount=0; }, 1500);
  if(_logoTapCount>=5){
    _logoTapCount=0;
    $id('admin-pw-input').value='';
    goScreen('scr-admin-pw');
  }
}

/* ── Admin 로그인 ── */
function checkPw(){
  var pw = $id('admin-pw-input').value;
  var stored = S.g('mc_admin_pw')||'Kevin';
  if(pw === stored){
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

/* ── 환자 현황 모니터링 ── */
function _renderMonitorList(){
  var users = _getUsers();
  var el = $id('monitor-list'); if(!el) return;
  if(!users.length){
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--mu);">등록된 환자가 없습니다</div>';
    return;
  }
  var ml = {cancer:'암환자', keto:'케토제닉', carnivore:'카니보어', lchf:'저탄고지', diet:'다이어트 건강식'};
  var mi = {cancer:'🔬', keto:'🥑', carnivore:'🥩', lchf:'🍖', diet:'🥗'};
  var cn = {thyroid:'갑상선암',colorectal:'대장암',lung:'폐암',stomach:'위암',breast:'유방암',liver:'간암',pancreas:'췌장암',bile:'담낭·담도암',kidney:'신장암',cervical:'자궁경부암',prostate:'전립선암',other:'기타 암'};

  el.innerHTML = users.map(function(u){
    var ic = u.mode==='cancer';
    var ctypeName = (u.ctype==='other'&&u.otherCancerName) ? u.otherCancerName : (cn[u.ctype]||'암환자');
    var ms = ic ? ((u.stage)?u.stage+'기 '+ctypeName:ctypeName) : (ml[u.mode]||u.mode);

    // 최근 증상
    var symData = S.gj('mc_'+u.id+'_sym', {});
    var symKeys = Object.keys(symData).sort().reverse();
    var lastSym = symKeys.length ? symData[symKeys[0]] : null;
    var symTxt = lastSym ? '통증 '+( lastSym.pain!==undefined?lastSym.pain+'점':'미기록')+' / 피로 '+(lastSym.fatigue!==undefined?lastSym.fatigue+'점':'미기록') : '기록 없음';

    // 최근 PSA
    var psaData = S.gj('mc_'+u.id+'_psa', []);
    var lastPsa = psaData.length ? psaData[psaData.length-1] : null;
    var psaTxt = lastPsa ? lastPsa.v.toFixed(1)+' ng/mL ('+lastPsa.date+')' : '기록 없음';

    // 최근 기록장
    var recs = S.gj('mc_'+u.id+'_records', []);
    var lastRec = recs.length ? recs[recs.length-1] : null;
    var recTxt = lastRec ? lastRec.date+' ('+Object.keys(lastRec.photos||{}).length+'끼)' : '기록 없음';

    // 복약
    var meds = S.gj('mc_'+u.id+'_meds', []);
    var medDone = S.gj('mc_'+u.id+'_med_done', {});
    var today = new Date();
    var todayStr = String(today.getFullYear()).slice(2)+'년 '+(today.getMonth()+1<10?'0':'')+(today.getMonth()+1)+'월 '+(today.getDate()<10?'0':'')+today.getDate()+'일';
    var doneToday = medDone[todayStr]||{};
    var medTxt = meds.length ? meds.filter(function(m){return doneToday[m.id];}).length+'/'+meds.length+'개 완료' : '약 없음';

    return '<div class="admin-user-card" onclick="A.showPatient(\''+u.id+'\')" style="cursor:pointer;flex-direction:column;align-items:flex-start;gap:10px;">'
      +'<div style="display:flex;align-items:center;gap:10px;width:100%;">'
      +'<div class="admin-user-av '+(ic?'cancer':'health')+'" style="font-size:18px;">'+(mi[u.mode]||'👤')+'</div>'
      +'<div style="flex:1"><div class="admin-user-name">'+esc(u.name)+(u.birthYear?' · '+u.birthYear+'년생':'')+'</div>'
      +'<div class="admin-user-detail">'+esc(ms)+'</div></div>'
      +'<i class="ti ti-chevron-right" style="color:var(--mu);font-size:18px;"></i>'
      +'</div>'
      +(ic?'<div style="display:flex;gap:8px;width:100%;flex-wrap:wrap;">'
        +'<span style="background:var(--purple-l);color:var(--purple);font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;">PSA: '+esc(psaTxt)+'</span>'
        +'<span style="background:var(--red-l);color:var(--red);font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;">'+esc(symTxt)+'</span>'
        +'</div>':'')
      +'<div style="font-size:12px;color:var(--mu);">최근기록: '+esc(recTxt)+' · 복약: '+esc(medTxt)+'</div>'
      +'</div>';
  }).join('');
}

function showPatient(userId){
  var users = _getUsers();
  var u = users.find(function(x){return x.id===userId;});
  if(!u) return;

  var ic = u.mode==='cancer';
  var cn = {thyroid:'갑상선암',colorectal:'대장암',lung:'폐암',stomach:'위암',breast:'유방암',liver:'간암',pancreas:'췌장암',bile:'담낭·담도암',kidney:'신장암',cervical:'자궁경부암',prostate:'전립선암',other:'기타 암'};
  var ctypeName = (u.ctype==='other'&&u.otherCancerName) ? u.otherCancerName : (cn[u.ctype]||'암환자');
  var ms = ic ? ((u.stage)?u.stage+'기 '+ctypeName:ctypeName) : u.mode;

  var el = $id('patient-detail'); if(!el) return;
  var title = $id('patient-topbar-title'); if(title) title.textContent = u.name+' 님';

  var html = '';

  // 기본 정보
  html += '<div class="card"><div class="card-hd"><span>👤 기본 정보</span></div>'
    +'<div class="card-body">'
    +'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bd);"><span style="color:var(--mu);">이름</span><span style="font-weight:700;">'+esc(u.name)+'</span></div>'
    +(u.birthYear?'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bd);"><span style="color:var(--mu);">출생년도</span><span style="font-weight:700;">'+u.birthYear+'년생</span></div>':'')
    +'<div style="display:flex;justify-content:space-between;padding:6px 0;"><span style="color:var(--mu);">모드</span><span style="font-weight:700;">'+esc(ms)+'</span></div>'
    +'</div></div>';

  // PSA 기록 (암환자)
  if(ic){
    var psaData = S.gj('mc_'+u.id+'_psa', []);
    html += '<div class="card"><div class="card-hd"><span>📈 PSA 기록</span></div><div class="card-body">';
    if(!psaData.length){ html += '<div style="color:var(--mu);font-size:13px;">기록 없음</div>'; }
    else {
      [].concat(psaData).reverse().slice(0,5).forEach(function(p){
        html += '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--bd);">'
          +'<span style="color:var(--mu);font-size:13px;">'+esc(p.date)+'</span>'
          +'<span style="font-weight:700;color:var(--purple);">'+p.v.toFixed(1)+' ng/mL</span></div>';
      });
    }
    html += '</div></div>';

    // 증상 기록
    var symData = S.gj('mc_'+u.id+'_sym', {});
    var symKeys = Object.keys(symData).sort().reverse().slice(0,5);
    html += '<div class="card"><div class="card-hd"><span>🩺 최근 증상</span></div><div class="card-body">';
    if(!symKeys.length){ html += '<div style="color:var(--mu);font-size:13px;">기록 없음</div>'; }
    else {
      symKeys.forEach(function(date){
        var d = symData[date];
        html += '<div style="padding:7px 0;border-bottom:1px solid var(--bd);">'
          +'<div style="font-size:12px;color:var(--mu);margin-bottom:4px;">'+esc(date)+'</div>'
          +'<div style="display:flex;gap:10px;flex-wrap:wrap;">'
          +(d.pain!==undefined?'<span style="background:var(--red-l);color:var(--red);font-size:12px;font-weight:700;padding:2px 8px;border-radius:20px;">통증 '+d.pain+'점</span>':'')
          +(d.fatigue!==undefined?'<span style="background:var(--wb);color:var(--warn);font-size:12px;font-weight:700;padding:2px 8px;border-radius:20px;">피로 '+d.fatigue+'점</span>':'')
          +(d.urine!==undefined?'<span style="background:#E3F2FD;color:#1976D2;font-size:12px;font-weight:700;padding:2px 8px;border-radius:20px;">배뇨 '+d.urine+'점</span>':'')
          +'</div>'+(d.memo?'<div style="font-size:12px;color:var(--mu);margin-top:3px;">'+esc(d.memo)+'</div>':'')
          +'</div>';
      });
    }
    html += '</div></div>';

    // 복약
    var meds = S.gj('mc_'+u.id+'_meds', []);
    html += '<div class="card"><div class="card-hd"><span>💊 복약 목록</span></div><div class="card-body">';
    if(!meds.length){ html += '<div style="color:var(--mu);font-size:13px;">등록된 약 없음</div>'; }
    else { meds.forEach(function(m){ html += '<div style="padding:6px 0;border-bottom:1px solid var(--bd);font-size:13px;">'+esc(m.name)+(m.dose?' ('+esc(m.dose)+')':'')+(m.time?' · '+esc(m.time):'')+'</div>'; }); }
    html += '</div></div>';
  }

  // 식단 기록
  var recs = S.gj('mc_'+u.id+'_records', []);
  html += '<div class="card"><div class="card-hd"><span>🍽️ 최근 식단 기록</span></div><div class="card-body">';
  if(!recs.length){ html += '<div style="color:var(--mu);font-size:13px;">기록 없음</div>'; }
  else {
    [].concat(recs).reverse().slice(0,5).forEach(function(r){
      var cnt = Object.keys(r.photos||{}).length;
      html += '<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--bd);">'
        +'<span style="color:var(--mu);font-size:13px;">'+esc(r.date)+'</span>'
        +'<span style="font-weight:700;">식사 '+cnt+'끼'+(r.steps?' · '+r.steps+'보':'')+'</span></div>';
    });
  }
  html += '</div></div>';

  el.innerHTML = html;
  goScreen('scr-admin-patient');
}

function _renderAdminList(){
  var users = _getUsers();
  var q = ($id('admin-user-search')&&$id('admin-user-search').value||'').trim().toLowerCase();
  if(q) users = users.filter(function(u){ return u.name.toLowerCase().indexOf(q)>=0; });
  var el = $id('admin-user-list');
  if(!el) return;
  if(!users.length){
    el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--mu);font-size:13px;">'+(q?'검색 결과가 없습니다':'등록된 사용자가 없습니다')+'</div>';
    return;
  }
  var ml = {cancer:'암환자', keto:'케토제닉', carnivore:'카니보어', lchf:'저탄고지', diet:'다이어트 건강식'};
  var mi = {cancer:'🔬', keto:'🥑', carnivore:'🥩', lchf:'🍖', diet:'🥗'};
  var cn = {thyroid:'갑상선암',colorectal:'대장암',lung:'폐암',stomach:'위암',breast:'유방암',liver:'간암',pancreas:'췌장암',bile:'담낭·담도암',kidney:'신장암',cervical:'자궁경부암',prostate:'전립선암',other:'기타 암'};
  el.innerHTML = users.map(function(u){
    var ic = u.mode==='cancer';
    var ctypeName = (u.ctype==='other'&&u.otherCancerName) ? u.otherCancerName : (cn[u.ctype]||'암환자');
    var ms = ic ? ((u.stage) ? u.stage+'기 '+ctypeName : ctypeName) : (ml[u.mode]||u.mode);
    var by = u.birthYear ? ' · '+u.birthYear+'년생' : '';
    return '<div class="admin-user-card">'
      +'<div class="admin-user-av '+(ic?'cancer':'health')+'">'+(mi[u.mode]||'👤')+'</div>'
      +'<div style="flex:1"><div class="admin-user-name">'+esc(u.name)+'</div><div class="admin-user-detail">'+esc(ms)+esc(by)+'</div></div>'
      +'<button class="admin-act del" onclick="A.delUser(\''+u.id+'\')"><i class="ti ti-trash"></i> 삭제</button>'
      +'</div>';
  }).join('');
}
function filterAdminUsers(){ _renderAdminList(); }

function delUser(id){
  if(!confirm('이 사용자를 삭제할까요?\n삭제하면 모든 기록이 사라집니다.')) return;
  if(!confirm('정말 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
  _setUsers(_getUsers().filter(function(u){ return u.id!==id; }));
  _renderAdminList();
  toast('삭제됐어요');
}

function changePw(){
  var p1=$id('new-pw1').value, p2=$id('new-pw2').value;
  if(!p1){ toast('새 비밀번호를 입력하세요'); return; }
  if(p1!==p2){ toast('비밀번호가 일치하지 않아요'); return; }
  S.s('mc_admin_pw', p1);
  $id('new-pw1').value=''; $id('new-pw2').value='';
  toast('비밀번호 변경됐어요 ✓');
}

function backup(){
  var bk = JSON.parse(JSON.stringify(_cache));
  bk['_date'] = new Date().toLocaleString('ko-KR');
  var blob = new Blob([JSON.stringify(bk,null,2)], {type:'application/json'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href=url; a.download='metacare_'+new Date().toISOString().slice(0,10)+'.json'; a.click();
  URL.revokeObjectURL(url);
  toast('백업 완료 ✓');
}

function backupText(){
  var bk = JSON.parse(JSON.stringify(_cache));
  bk['_date'] = new Date().toLocaleString('ko-KR');
  var json = JSON.stringify(bk);
  var ta = $id('backup-text-area');
  if(ta){ ta.value = json; ta.style.display=''; }
  var btn = $id('backup-copy-btn');
  if(btn) btn.style.display='';
}

function copyBackupText(){
  var ta = $id('backup-text-area');
  if(!ta) return;
  ta.select();
  ta.setSelectionRange(0, 999999);
  try{
    document.execCommand('copy');
    toast('복사됐어요! 카카오톡에 붙여넣기 하세요');
  }catch(e){
    navigator.clipboard&&navigator.clipboard.writeText(ta.value).then(function(){ toast('복사됐어요! 카카오톡에 붙여넣기 하세요'); });
  }
}

function restore(e){
  var file = e.target.files[0]; if(!file) return;
  var r = new FileReader();
  r.onload = function(ev){
    try{
      var data = JSON.parse(ev.target.result);
      if(!data['mc_ant']&&!data['mc_users']){ toast('올바른 백업 파일이 아닙니다'); return; }
      if(!confirm('현재 데이터를 백업으로 덮어쓸까요?\n'+( data['_date']||''))) return;
      var newCache = {};
      Object.keys(data).forEach(function(k){ if(!k.startsWith('_')) newCache[k]=data[k]; });
      _cache = newCache;
      _docRef.set(_cache).then(function(){
        toast('복원 완료! 새로고침합니다');
        setTimeout(function(){ location.reload(); }, 1500);
      }).catch(function(){ toast('복원 중 오류가 발생했습니다'); });
    }catch(err){ toast('파일을 읽을 수 없습니다'); }
  };
  r.readAsText(file); e.target.value='';
}

function fullReset(){
  if(!confirm('정말 전체 초기화할까요?\n모든 데이터가 삭제됩니다.')) return;
  if(!confirm('마지막 확인입니다.')) return;
  _cache = {};
  _docRef.set({}).then(function(){ location.reload(); }).catch(function(){ location.reload(); });
}

/* ── 사용자 추가 ── */
var _MODES = [
  {id:'cancer', icon:'🔬', name:'암환자', desc:'PSA 추적 · 증상 기록 · 복약 · 식단 분석'},
  {id:'keto',   icon:'🥑', name:'케토제닉', desc:'탄수화물 20g 이하 · 인슐린 억제 · 케톤 생성'},
  {id:'carnivore', icon:'🥩', name:'카니보어', desc:'동물성 식품만 · 식물성 식품 배제 · 극단적 저탄수'},
  {id:'lchf',   icon:'🍖', name:'저탄고지', desc:'탄수화물 50~100g · 혈당 안정 · 체중 관리'},
  {id:'diet',   icon:'🥗', name:'다이어트 건강식', desc:'지중해식 · 칼로리 제한 · 균형 영양'}
];
var _CTYPES = [
  {id:'thyroid',    icon:'🦋', name:'갑상선암',    desc:'갑상선 종양 · 수술 후 관리'},
  {id:'colorectal', icon:'🫁', name:'대장암',       desc:'대장·직장암 · 식단 관리'},
  {id:'lung',       icon:'🫧', name:'폐암',         desc:'폐 종양 · 호흡기 관리'},
  {id:'stomach',    icon:'🫃', name:'위암',         desc:'위 종양 · 소화기 관리'},
  {id:'breast',     icon:'🎀', name:'유방암',       desc:'유방 종양 · 호르몬 관리'},
  {id:'liver',      icon:'🫀', name:'간암',         desc:'간 종양 · 간 기능 관리'},
  {id:'pancreas',   icon:'💊', name:'췌장암',       desc:'췌장 종양 · 혈당 관리'},
  {id:'bile',       icon:'💊', name:'담낭·담도암',  desc:'담낭·담도 종양 관리'},
  {id:'kidney',     icon:'💊', name:'신장암',       desc:'신장 종양 · 신기능 관리'},
  {id:'cervical',   icon:'💊', name:'자궁경부암',   desc:'자궁경부 종양 관리'},
  {id:'prostate',   icon:'🔬', name:'전립선암',     desc:'PSA 추적 · 병기별 관리'},
  {id:'other',      icon:'💊', name:'기타 암',      desc:'증상 · 복약 통합 관리'}
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
  $id('new-year').value='';
  var oc=$id('other-cancer-name'); if(oc) oc.value='';
  var ow=$id('other-cancer-wrap'); if(ow) ow.style.display='none';
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
  $id('stage-wrap').style.display='';
  $id('other-cancer-wrap').style.display = t==='other'?'':'none';
  if(t!=='other') { var oc=$id('other-cancer-name'); if(oc) oc.value=''; }
  document.querySelectorAll('[id^="sb"]').forEach(function(b){ b.classList.remove('sel'); });
}

function _selStage(n){
  _newStage=n;
  document.querySelectorAll('[id^="sb"]').forEach(function(b){ b.classList.remove('sel'); });
  var el=$id('sb'+n); if(el) el.classList.add('sel');
}

function addUser(){
  var name = $id('new-name').value.trim();
  var year = $id('new-year').value.trim();
  if(!name){ toast('이름을 입력하세요'); return; }
  if(!year||year.length!==4||isNaN(parseInt(year))){ toast('출생년도 4자리를 입력하세요'); return; }
  if(!_newMode){ toast('모드를 선택하세요'); return; }
  if(_newMode==='cancer'&&!_newCtype){ toast('암 종류를 선택하세요'); return; }
  if(_newMode==='cancer'&&_newCtype==='other'){
    var otherNm = ($id('other-cancer-name')&&$id('other-cancer-name').value.trim())||'';
    if(!otherNm){ toast('암 종류를 직접 입력해 주세요'); return; }
  }
  if(_newMode==='cancer'&&!_newStage){ toast('병기를 선택하세요'); return; }
  var otherCancerName = (_newCtype==='other'&&$id('other-cancer-name')) ? $id('other-cancer-name').value.trim() : '';
  var users = _getUsers();
  if(users.some(function(u){ return u.name===name && String(u.birthYear)===String(year); })){
    toast('이미 같은 이름과 출생년도로 등록된 사용자가 있어요'); return;
  }
  users.push({id:'u'+Date.now(), name:name, birthYear:year, mode:_newMode, ctype:_newCtype, otherCancerName:otherCancerName, stage:_newStage, treatments:[], createdAt:Date.now()});
  _setUsers(users);
  toast(name+' 님이 추가됐어요 ✓');
  goScreen('scr-admin-users');
}

/* ── 프로필 화면 ── */
function enterByName(){
  var name = ($id('login-name').value||'').trim();
  var year = ($id('login-year').value||'').trim();
  var errEl = $id('login-error');
  errEl.style.display = 'none';
  if(!name){
    errEl.textContent = '이름을 입력해 주세요';
    errEl.style.display = 'block';
    return;
  }
  var users = _getUsers();
  var match;
  if(year){
    // 이름+출생년도 모두 입력한 경우: 둘 다 일치해야 함
    match = users.find(function(u){ return u.name===name && String(u.birthYear)===String(year); });
    // 출생년도가 없는 기존 사용자도 이름만으로 허용
    if(!match) match = users.find(function(u){ return u.name===name && !u.birthYear; });
  } else {
    // 이름만 입력한 경우: 이름 일치하면 입장
    match = users.find(function(u){ return u.name===name; });
  }
  if(!match){
    errEl.textContent = '등록된 정보를 찾을 수 없습니다. 관리자에게 문의하세요';
    errEl.style.display = 'block';
    return;
  }
  $id('login-name').value=''; $id('login-year').value='';
  loginUser(match);
}

/* ── 로그인 ── */
function loginUser(u){
  USER = u;
  // 마지막 로그인 사용자 저장 (새로고침 시 자동 재로그인)
  try{ 
    var lastPage = localStorage.getItem('mc_last_page')||'home';
    localStorage.setItem('mc_last_user', JSON.stringify({id:u.id, name:u.name, birthYear:u.birthYear, lastPage:lastPage})); 
  }catch(e){}
  if(!KEY){ toast('API 키가 없습니다. Admin에서 설정해주세요.'); return; }
  _initApp();
  goScreen('scr-app');
}

/* ── 자동 재로그인 ── */
function _tryAutoLogin(){
  try{
    var saved = localStorage.getItem('mc_last_user');
    if(!saved) return false;
    var info = JSON.parse(saved);
    var users = _getUsers();
    var match = users.find(function(u){ return u.id===info.id; });
    if(!match) return false;
    USER = match;
    if(!KEY){ return false; }
    _initApp();
    goScreen('scr-app');
    // 마지막 페이지로 이동
    var lastPage = info.lastPage||'home';
    if(lastPage!=='home') setTimeout(function(){ goPage(lastPage); }, 100);
    return true;
  }catch(e){ return false; }
}

/* ── 앱 초기화 ── */
function _initApp(){
  var u = USER;
  var ic = u.mode==='cancer';
  var ip = ic && u.ctype==='prostate';
  var ml = {cancer:'암환자', keto:'케토제닉', carnivore:'카니보어', lchf:'저탄고지', diet:'다이어트 건강식'};

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
  _refreshPhotos();
  _refreshCondSummary();
  _refreshHomeAnalysis();
  _refreshHomeExercise();
  _refreshComprehensiveBtn();
  if(ic){ _refreshMedHome(); _refreshTodaySym(); }
  else{ _refreshStats(); _refreshTip(); }

  // 날짜
  var pdi=$id('psa-date'); if(pdi) pdi.value=todayStr();
  _updateDays();

  tts('안녕하세요 '+u.name+' 님!');
  _showGreeting(u.name);
}

/* ── 건강관리 홈 ── */
var _TIPS = {
  keto:['전해질 보충이 중요합니다. 나트륨·칼륨·마그네슘을 충분히 섭취하면 케토 독감 증상을 예방할 수 있습니다.','아보카도는 케토의 완벽한 음식입니다. 건강한 지방, 칼륨, 섬유질이 풍부합니다.','저강도 유산소 운동은 케톤 산화를 촉진하여 체지방 연소를 극대화합니다.','버터 커피는 아침 공복에 섭취하면 포만감을 유지하며 케토시스를 강화합니다.'],
  carnivore:['붉은 고기, 생선, 달걀, 일부 유제품만 섭취합니다. 식물성 식품(채소, 과일, 곡물)은 완전히 배제합니다.','내장육(간, 심장)은 영양 밀도가 매우 높아 비타민과 미네랄 보충에 좋습니다.','뼈 국물(본브로스)은 관절 건강과 소화에 도움이 됩니다.','적응 기간(2~4주) 동안 피로감이 있을 수 있으니 충분한 염분과 수분을 섭취하세요.'],
  lchf:['정제 탄수화물(흰쌀, 설탕)을 피하고 채소로 대체하면 혈당이 안정됩니다.','식사 순서를 채소 → 단백질 → 탄수화물 순으로 하면 혈당 상승을 크게 줄일 수 있습니다.','식사 후 10~15분 가볍게 걸으면 혈당 스파이크를 효과적으로 낮출 수 있습니다.'],
  diet:['지중해식 식단의 핵심은 올리브오일, 채소, 생선, 견과류입니다. 매 식사 채소를 절반 이상 채우세요.','물을 식사 30분 전에 마시면 포만감이 높아져 칼로리 섭취를 줄일 수 있습니다.','천천히 씹어 먹는 것만으로도 포만감이 향상됩니다.']
};

var _HEALTH_CFG = {
  keto:{sub:'인슐린 통제 대사 모드',daysLbl:'연속 케토',goalBg:'linear-gradient(135deg,#2A7B7B,#1A5C5C)',goalLbl:'케토 목표',goalHtml:'<div class="goal-vals"><div class="goal-val-item"><div class="val">20g</div><div class="lbl-s">탄수화물</div></div><div class="goal-val-item"><div class="val">75%</div><div class="lbl-s">지방</div></div><div class="goal-val-item"><div class="val">20%</div><div class="lbl-s">단백질</div></div></div>',bannerSub:'케토 적합도와 영양 분석을 즉시 알려드려요',tipTitle:'오늘의 케토 팁',vg2:'"오늘 뭐 먹을까" — 케토 식단 추천'},
  carnivore:{sub:'동물성 식품 전용 극단적 저탄수 모드',daysLbl:'연속 카니보어',goalBg:'linear-gradient(135deg,#7A2E2E,#4A1818)',goalLbl:'카니보어 목표',goalHtml:'<div class="goal-vals"><div class="goal-val-item"><div class="val">0g</div><div class="lbl-s">탄수화물</div></div><div class="goal-val-item"><div class="val">동물성</div><div class="lbl-s">식품만</div></div><div class="goal-val-item"><div class="val">고단백</div><div class="lbl-s">고지방</div></div></div>',bannerSub:'동물성 식품 적합도를 즉시 분석해 드려요',tipTitle:'오늘의 카니보어 팁',vg2:'"오늘 뭐 먹을까" — 카니보어 식단 추천'},
  lchf:{sub:'저탄고지 혈당 안정 모드',daysLbl:'저탄고지',goalBg:'linear-gradient(135deg,#1a6b4a,#0d4f35)',goalLbl:'저탄고지 목표',goalHtml:'<div class="goal-vals"><div class="goal-val-item"><div class="val">100g</div><div class="lbl-s">탄수화물</div></div><div class="goal-val-item"><div class="val">50%</div><div class="lbl-s">지방</div></div><div class="goal-val-item"><div class="val">25%</div><div class="lbl-s">단백질</div></div></div>',bannerSub:'저탄고지 적합도와 혈당 영향을 분석해 드려요',tipTitle:'오늘의 저탄고지 팁',vg2:'"오늘 뭐 먹을까" — 저탄고지 식단 추천'},
  diet:{sub:'균형 건강식 다이어트 모드',daysLbl:'다이어트',goalBg:'linear-gradient(135deg,#1565C0,#0D47A1)',goalLbl:'건강식 목표',goalHtml:'<div class="goal-vals"><div class="goal-val-item"><div class="val">1,600</div><div class="lbl-s">칼로리 목표</div></div><div class="goal-val-item"><div class="val">½</div><div class="lbl-s">채소 비율</div></div><div class="goal-val-item"><div class="val">30%</div><div class="lbl-s">단백질</div></div></div>',bannerSub:'칼로리와 영양 균형을 즉시 분석해 드려요',tipTitle:'오늘의 건강식 팁',vg2:'"오늘 뭐 먹을까" — 건강 식단 추천'}
};

function _initHealthHome(mode){
  var c = _HEALTH_CFG[mode]||_HEALTH_CFG.keto;
  var g=function(id){ return $id(id); };
  if(g('home-mode-sub')) g('home-mode-sub').textContent=c.sub;
  if(g('home-days-lbl')) g('home-days-lbl').textContent=c.daysLbl;
  if(g('home-goal-card')){ g('home-goal-card').style.background=c.goalBg; }
  if(g('home-goal-lbl')) g('home-goal-lbl').textContent='오늘의 '+c.goalLbl;
  var vals = c.goalHtml.match(/<div class="val">([^<]+)<\/div>/g)||[];
  var lbls = c.goalHtml.match(/<div class="lbl-s">([^<]+)<\/div>/g)||[];
  var txt = lbls.map(function(l,i){
    var lbl=l.replace(/<[^>]+>/g,'');
    var val=vals[i]?(vals[i].replace(/<[^>]+>/g,'')):'';
    return lbl+' '+val;
  }).join(' · ');
  if(g('home-goal-items')) g('home-goal-items').textContent=txt;
  if(g('home-banner-sub')) g('home-banner-sub').textContent=c.bannerSub;
  if(g('tip-title')) g('tip-title').textContent=c.tipTitle;
  if(g('vg2')) g('vg2').innerHTML='<i class="ti ti-salad"></i>'+c.vg2;
  // 식사 슬롯 색상 동기화
  var goalBg = c.goalBg;
  setTimeout(function(){
    ['ms-breakfast','ms-lunch','ms-dinner'].forEach(function(id){
      var el=$id(id); if(!el) return;
      el.style.background=goalBg;
      el.style.color='#fff';
      el.classList.add('colored');
    });
  }, 100);
}

function _initCancerHome(u){
  var ip = u.ctype==='prostate';
  var sl={1:'1기 국소 저위험',2:'2기 국소 중·고위험',3:'3기 국소 진행성',4:'4기 전이성'};
  var sub=$id('home-mode-sub'); if(sub) sub.textContent=ip?(sl[u.stage]||'전립선암')+' 관리 중':'암 치유 관리 중';
  var dl=$id('home-days-lbl'); if(dl) dl.textContent='관리';
  var gc=$id('home-goal-card'); if(gc){ gc.style.background='linear-gradient(135deg,#4a1d96,#6B3FA0)'; }
  var markers = _getMarkers(u.ctype);
  var gl=$id('home-goal-lbl'); if(gl) gl.textContent=markers[0]||'종양 마커';
  var gi=$id('home-goal-items'); if(gi) gi.textContent='-- '+_getMarkerUnit(markers[0]);
  ['ms-breakfast','ms-lunch','ms-dinner'].forEach(function(id){
    var el=$id(id); if(!el) return;
    el.style.background='linear-gradient(135deg,#4a1d96,#6B3FA0)';
    el.style.color='#fff'; el.classList.add('colored');
  });
  var bs=$id('home-banner-sub'); if(bs) bs.textContent='항산화·저당 관점의 암 환자 맞춤 식단 분석';
  var tt=$id('tip-title'); if(tt) tt.style.display='none';
  var tb=document.querySelector('.tip-box'); if(tb) tb.style.display='none';
  var vg2=$id('vg2'); if(vg2) vg2.innerHTML='<i class="ti ti-chart-line"></i>"마커 기록해줘"';
  if(ip) _refreshPSABanner();
}

/* ── 암종별 종양 마커 설정 ── */
var _MARKER_CFG = {
  prostate:  {markers:['PSA'],           units:{PSA:'ng/mL'},          label:'PSA 추적'},
  breast:    {markers:['CA 15-3','CEA'], units:{'CA 15-3':'U/mL', CEA:'ng/mL'}, label:'유방암 마커'},
  colon:     {markers:['CEA','CA 19-9'], units:{CEA:'ng/mL','CA 19-9':'U/mL'},  label:'대장암 마커'},
  stomach:   {markers:['CEA','CA 19-9'], units:{CEA:'ng/mL','CA 19-9':'U/mL'},  label:'위암 마커'},
  lung:      {markers:['CEA','CYFRA 21-1'], units:{CEA:'ng/mL','CYFRA 21-1':'ng/mL'}, label:'폐암 마커'},
  liver:     {markers:['AFP'],           units:{AFP:'ng/mL'},           label:'간암 마커'},
  pancreas:  {markers:['CA 19-9','CEA'], units:{'CA 19-9':'U/mL', CEA:'ng/mL'}, label:'췌장암 마커'},
  bile:      {markers:['CA 19-9','CEA'], units:{'CA 19-9':'U/mL', CEA:'ng/mL'}, label:'담도암 마커'},
  thyroid:   {markers:['Tg','TSH'],      units:{Tg:'ng/mL', TSH:'μIU/mL'},      label:'갑상선 마커'},
  cervical:  {markers:['SCC','CEA'],     units:{SCC:'ng/mL', CEA:'ng/mL'},       label:'자궁경부암 마커'},
  kidney:    {markers:['CEA'],           units:{CEA:'ng/mL'},           label:'종양 마커'},
  other:     {markers:['CEA'],           units:{CEA:'ng/mL'},           label:'종양 마커'}
};

function _getMarkers(ctype){ var c=_MARKER_CFG[ctype]||_MARKER_CFG.other; return c.markers; }
function _getMarkerUnit(marker){ if(!USER) return ''; var c=_MARKER_CFG[USER.ctype]||_MARKER_CFG.other; return c.units[marker]||''; }
function _getMarkerLabel(){ if(!USER) return '종양 마커 추적'; var c=_MARKER_CFG[USER.ctype]||_MARKER_CFG.other; return c.label; }

function openMarkerSheet(){
  if(!USER) return;
  var markers = _getMarkers(USER.ctype);
  var label = _getMarkerLabel();
  // 바텀시트 제목 업데이트
  var t=$id('sh-marker-title'); if(t) t.textContent=label+' 기록';
  // 마커가 여러 개면 선택 UI, 하나면 바로 입력
  var inp=$id('sh-marker-inputs');
  if(inp){
    var html='';
    if(markers.length>1){
      html+='<label class="lbl">마커 선택</label>';
      html+='<select class="inp-sm" id="marker-select" style="margin-bottom:8px;">';
      markers.forEach(function(m){ html+='<option value="'+m+'">'+m+' ('+(_getMarkerUnit(m)||'수치')+')</option>'; });
      html+='</select>';
    } else {
      html+='<div style="font-size:13px;font-weight:700;color:var(--purple);margin-bottom:6px;">'+markers[0]+' ('+(_getMarkerUnit(markers[0])||'수치')+')</div>';
    }
    html+='<input class="inp-sm" id="psa-val" type="number" placeholder="수치 입력" step="0.01" min="0">';
    html+='<input class="inp-sm" id="psa-date" type="text" placeholder="날짜 (예: 2026-06-20)" style="margin-top:8px;" value="'+todayStr()+'">';
    html+='<input class="inp-sm" id="psa-note" type="text" placeholder="메모 (선택)" style="margin-top:8px;">';
    inp.innerHTML=html;
  }
  openSheet('sh-psa');
}

// 추적 탭 진입 시 마커 제목 업데이트
function _initMarkerTrack(){
  if(!USER||USER.mode!=='cancer') return;
  var t=$id('marker-title'); if(t) t.textContent=_getMarkerLabel();
}

function refreshTip(){
  var el=$id('tip-text'); if(!el) return;
  var mode=USER?USER.mode:'keto';
  var tips=_TIPS[mode]||_TIPS.keto;
  var idx; do{ idx=Math.floor(Math.random()*tips.length); }while(idx===_lastTipIdx&&tips.length>1);
  _lastTipIdx=idx;
  
  // 다양한 팁 주제 목록
  var topics = {
    keto:['지방 섭취','케톤 생성','전해질 관리','케토 식품 선택','운동과 케토','케토 부작용 예방','간헐적 단식','케토 외식 방법'],
    carnivore:['육류 선택','지방 비율','전해질 보충','카니보어 적응기','장 건강','단백질 소화','카니보어 외식'],
    lchf:['혈당 안정','탄수화물 선택','저탄고지 간식','혈당 측정','인슐린 저항성','저탄고지 외식','수면과 혈당'],
    diet:['칼로리 조절','영양 균형','채소 섭취','수분 섭취','건강한 간식','식사 타이밍','포만감 관리'],
    cancer:['항산화 식품','항염 식단','면역 강화','체중 유지','소화 개선','수분 섭취','항암 식품']
  };
  
  var topicList = topics[mode]||topics.lchf;
  var randomTopic = topicList[Math.floor(Math.random()*topicList.length)];
  var hour = new Date().getHours();
  var timeStr = hour < 12 ? '아침' : hour < 18 ? '점심' : '저녁';
  
  var prompts={
    keto:'케토제닉 식단 실천자를 위한 ['+randomTopic+'] 관련 '+timeStr+' 팁을 오늘 날짜('+todayStr()+') 기준으로 새롭고 구체적으로 1~2문장으로.',
    carnivore:'카니보어(육식) 식단 실천자를 위한 ['+randomTopic+'] 관련 팁을 새롭고 구체적으로 1~2문장으로.',
    lchf:'저탄고지 식단 실천자를 위한 ['+randomTopic+'] 관련 혈당 관리 팁을 오늘('+todayStr()+') 기준으로 새롭고 구체적으로 1~2문장으로.',
    diet:'건강 다이어트 실천자를 위한 ['+randomTopic+'] 관련 '+timeStr+' 팁을 새롭고 구체적으로 1~2문장으로.',
    cancer:'암 환자를 위한 ['+randomTopic+'] 관련 식단 팁을 새롭고 구체적으로 1~2문장으로.'
  };
  
  if(KEY){
    el.innerHTML='<div class="dots"><span></span><span></span><span></span></div>';
    _api({max_tokens:150, messages:[{role:'user',content:prompts[mode]||prompts.lchf}]}, function(reply){ 
      el.textContent=reply||tips[idx]; 
    });
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

/* ── 도움말 ── */
function goHelp(){
  var u = USER;
  var ic = u && u.mode==='cancer';
  var modeNames = {keto:'케토제닉', carnivore:'카니보어', lchf:'저탄고지', diet:'다이어트 건강식', cancer:'암환자'};
  var modeName = ic ? (u.ctype==='prostate' ? u.stage+'기 전립선암' : '암환자') : (modeNames[u.mode]||'건강관리');

  var commonHelp = [
    {icon:'ti-camera', title:'식사 사진 찍기', desc:'화면 가운데 초록색 배너를 누르면 사진을 찍을 수 있어요.\nAI가 사진을 보고 바로 분석해 드립니다.'},
    {icon:'ti-table', title:'기록장', desc:'아래 메뉴에서 "기록장"을 누르면 날짜별로 식사 사진과 만보를 기록할 수 있어요.\n"엑셀" 버튼을 누르면 파일로 저장됩니다.'},
    {icon:'ti-message-circle', title:'AI 코치', desc:'아래 메뉴에서 "코치"를 누르면 AI에게 무엇이든 물어볼 수 있어요.\n식단 추천, 운동 방법, 건강 궁금증 모두 물어보세요.'},
    {icon:'ti-microphone', title:'음성 명령', desc:'화면 오른쪽 아래 초록 동그라미 버튼을 누르고 말하면 됩니다.\n"사진 찍어줘", "기록장 보여줘" 이렇게 말해보세요.'},
  ];

  var modeHelp = {
    keto:[
      {icon:'ti-salad', title:'케토제닉이란?', desc:'탄수화물을 하루 20g 이하로 줄이는 식단이에요.\n밥, 빵, 면, 과자를 피하고 고기, 계란, 아보카도, 견과류를 드세요.'},
      {icon:'ti-chart-bar', title:'목표', desc:'탄수화물 20g 이하, 지방 75%, 단백질 20%\n이 비율을 맞추면 몸이 지방을 태우기 시작합니다.'},
    ],
    carnivore:[
      {icon:'ti-flame', title:'카니보어란?', desc:'고기, 생선, 달걀, 유제품만 드시는 식단이에요.\n채소, 과일, 곡물은 드시지 않습니다.'},
      {icon:'ti-heart-rate-monitor', title:'적응 기간', desc:'처음 2~4주는 피로감이 있을 수 있어요.\n물을 충분히 드시고 소금을 적당히 섭취하세요.'},
    ],
    lchf:[
      {icon:'ti-salad', title:'저탄고지란?', desc:'탄수화물을 하루 50~100g으로 줄이는 식단이에요.\n케토제닉보다 유연해서 현미, 고구마는 조금 드실 수 있어요.'},
      {icon:'ti-clock', title:'식사 순서', desc:'채소 먼저 → 고기/생선 → 밥/면 순서로 드세요.\n혈당이 천천히 올라서 몸에 좋습니다.'},
    ],
    diet:[
      {icon:'ti-salad', title:'건강식이란?', desc:'하루 1,600칼로리를 목표로 채소를 절반 이상 드세요.\n올리브오일, 생선, 견과류가 중심인 지중해식 식단입니다.'},
      {icon:'ti-droplet', title:'물 마시기', desc:'식사 30분 전에 물 한 잔을 마시면 덜 드시게 됩니다.\n하루 1.5~2리터를 목표로 하세요.'},
    ],
    cancer:[
      {icon:'ti-activity', title:'증상 기록', desc:'홈 화면에서 통증, 배뇨, 피로를 매일 기록하세요.\n0점(없음)부터 10점(매우 심함)으로 표시합니다.'},
      {icon:'ti-pill', title:'복약 체크', desc:'홈 화면에서 오늘 드신 약에 체크 표시를 하세요.\n약을 빠뜨리지 않도록 도와드립니다.'},
      {icon:'ti-chart-line', title:'PSA 기록', desc:'"추적" 메뉴에서 PSA 수치를 날짜별로 기록하세요.\n검사 후 바로 입력해두면 변화를 쉽게 확인할 수 있어요.'},
    ],
  };

  var items = (modeHelp[u?u.mode:'keto']||[]).concat(commonHelp);

  var el = $id('help-body');
  if(!el) return;
  el.innerHTML = '<div style="background:var(--navy);border-radius:var(--r);padding:16px 18px;margin-bottom:4px;">'
    +'<div style="color:rgba(255,255,255,.6);font-size:13px;margin-bottom:4px;">'+esc(modeName)+' 모드</div>'
    +'<div style="color:#fff;font-size:18px;font-weight:700;">'+esc(u?u.name:'')+'님을 위한 사용 방법</div>'
    +'</div>'
    + items.map(function(item){
      return '<div style="background:#fff;border:1px solid var(--bd);border-radius:var(--r);padding:18px;margin-bottom:10px;">'
        +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
        +'<div style="width:40px;height:40px;border-radius:50%;background:var(--tl);display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
        +'<i class="ti '+item.icon+'" style="font-size:20px;color:var(--teal);"></i></div>'
        +'<div style="font-size:17px;font-weight:700;color:var(--navy);">'+esc(item.title)+'</div>'
        +'</div>'
        +'<div style="font-size:15px;color:#374151;line-height:1.9;white-space:pre-line;">'+esc(item.desc)+'</div>'
        +'</div>';
    }).join('');

  goScreen('scr-help');
}

/* ── 내비게이션 ── */
var _currentPage = 'home';

function goPage(p){
  document.querySelectorAll('.page').forEach(function(e){ e.classList.remove('active'); });
  document.querySelectorAll('.nb').forEach(function(e){ e.classList.remove('active'); });
  var pg=$id('pg-'+p); if(pg) pg.classList.add('active');
  var nb=$id('nb-'+p); if(nb) nb.classList.add('active');
  $id('pages').scrollTop=0;
  _currentPage = p;
  // 마지막 페이지 저장
  try{ 
    var saved=localStorage.getItem('mc_last_user');
    if(saved){ var info=JSON.parse(saved); info.lastPage=p; localStorage.setItem('mc_last_user',JSON.stringify(info)); }
  }catch(e){}
  if(p==='log'){ _xlLoad(); if(USER&&USER.mode==='cancer') _loadSymCards(); }
  if(p==='track'&&USER&&USER.mode==='cancer'){ _initMarkerTrack(); _loadPSAHistory(); _loadSymAvg(); }
  if(p==='chat'){ setTimeout(function(){ var cs=$id('chat-scroll'); if(cs) cs.scrollTop=cs.scrollHeight; },100); }
  if(p==='home'){
    _refreshPhotos();
    _refreshCondSummary();
    _refreshHomeAnalysis();
    _refreshHomeExercise();
    _refreshComprehensiveBtn();
    if(USER&&USER.mode!=='cancer'){ _refreshStats(); }
    else{ _refreshMedHome(); _refreshTodaySym(); if(USER.ctype==='prostate') _refreshPSABanner(); }
  }
}

/* ── 음성 ── */
var VS='idle', VQ=[], VR=null, VBusy=false;
function _setVS(s){
  VS=s;
  var icon=$id('mic-icon'), bar=$id('vbar'), dot=$id('vdot'), txt=$id('vtxt');
  if(s==='idle'){ bar.classList.remove('on'); if(icon) icon.className='ti ti-microphone'; }
  else if(s==='listening'){ bar.classList.add('on'); dot.className='vdot L'; txt.textContent='듣고 있어요...'; if(icon) icon.className='ti ti-microphone-off'; }
  else if(s==='thinking'){ bar.classList.add('on'); dot.className='vdot T'; txt.textContent='처리 중...'; if(icon) icon.className='ti ti-loader'; }
}
function onMic(){
  if(VS==='listening') _stopRec();
  else _startRec();
}

function goBack(){
  var activeScreen = document.querySelector('.screen.active');
  if(!activeScreen) return;
  var id = activeScreen.id;

  if(id==='scr-profile') return; // 로그인 화면에서는 동작 안 함

  if(id==='scr-app'){
    if(_currentPage!=='home'){ goPage('home'); }
    else { goScreen('scr-profile'); }
    return;
  }

  // Admin 하위 화면
  var adminSubs = ['scr-admin-users','scr-admin-backup','scr-admin-password','scr-admin-reset','scr-admin-monitor','scr-admin-patient','scr-add-user'];
  if(adminSubs.indexOf(id)>=0){ goScreen('scr-admin'); return; }
  if(id==='scr-admin'||id==='scr-admin-pw'){ goScreen('scr-profile'); return; }
  if(id==='scr-help'){ goScreen('scr-app'); return; }

  goScreen('scr-profile');
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
function tts(t){ if(t) toast(t); }
function _ttsP(text){ if(text) toast(text); return Promise.resolve(); }

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
  else if(u.mode==='carnivore') qs=[{i:'ti-camera',q:'이 음식 카니보어로 분석해줘'},{i:'ti-flame',q:'오늘 카니보어 식단 추천해줘'},{i:'ti-heart-rate-monitor',q:'카니보어 적응 기간 증상이 뭔가요?'}];
  else if(u.mode==='lchf') qs=[{i:'ti-camera',q:'이 음식 저탄고지로 분석해줘'},{i:'ti-salad',q:'저탄고지 식단 오늘 메뉴 추천해줘'},{i:'ti-chart-bar',q:'저탄고지와 케토의 차이가 뭔가요?'}];
  else if(u.mode==='diet') qs=[{i:'ti-camera',q:'이 음식 다이어트 관점으로 분석해줘'},{i:'ti-salad',q:'오늘 건강하고 살 빠지는 식단 추천해줘'},{i:'ti-heart',q:'지중해식 식단이 뭔가요?'}];
  else if(ip)           qs=[{i:'ti-camera',q:'식사 사진 암 환자 식단으로 분석해줘'},{i:'ti-chart-line',q:'PSA 수치가 올랐어요 어떻게 해야 하나요?'},{i:'ti-flame',q:'뼈 통증 관리 방법 알려주세요'}];
  else                  qs=[{i:'ti-camera',q:'식사 사진 암 환자 식단으로 분석해줘'},{i:'ti-flame',q:'항암 치료 중 통증 관리 방법은?'},{i:'ti-salad',q:'암 환자에게 좋은 항산화 식단 알려줘'}];
  wrap.innerHTML=qs.map(function(q){ return '<button class="qbtn" onclick="A.askQ(\''+esc(q.q)+'\')"><i class="ti '+q.i+'"></i>'+esc(q.q)+'</button>'; }).join('');
  var g=$id('chat-greeting');
  var mn={keto:'케토제닉',carnivore:'카니보어',lchf:'저탄고지',diet:'다이어트 건강식'};
  if(g) g.textContent='안녕하세요, '+u.name+' 님! '+(ip?u.stage+'기 전립선암':(mn[u.mode]||'암 치유'))+' AI 코치입니다.';
}

function _buildSys(){
  var u=USER; if(!u) return'건강 코치입니다.';
  var ic=u.mode==='cancer', ip=ic&&u.ctype==='prostate';
  if(u.mode==='keto') return '케토제닉 식단 전문 건강 코치. 탄수화물 20g 이하, 지방 70~75%, 단백질 20~25%. 한국어 3~5문장.';
  if(u.mode==='carnivore') return '카니보어(육식) 식단 전문 건강 코치. 동물성 식품(고기, 생선, 달걀, 일부 유제품)만 섭취, 식물성 식품 완전 배제. 영양 균형, 적응 증상 관리, 내장육 활용법 안내. 한국어 3~5문장.';
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
    ld.querySelector('.bub.ai').textContent=reply||'답변을 가져오지 못했어요.'; sd(); _chatBusy=false;
  });
}

/* ── AI 식단/운동 분석 ── */
function analyze(){
  if(!KEY){ toast('API 키가 없습니다'); return; }
  var name=$id('food-name').value.trim();
  var pre=$id('preview-img'), hasPic=pre.src&&$id('preview-wrap').style.display!=='none';
  if(!hasPic&&!name){ toast('사진 또는 메뉴명을 입력하세요'); return; }
  var ar=$id('ai-result'); ar.style.display='block'; ar.innerHTML='<div class="tip-lbl">AI 식단 분석</div><div class="dots"><span></span><span></span><span></span></div>';
  var u=USER;
  var ps={cancer:'암 환자 식단 관점에서(항산화,저당,항염,케토 적합도) 분석해 주세요. 전립선암이면 리코펜·십자화과도 언급. 3~4문장.',keto:'케토제닉 관점에서(탄단지 비율, 케토 적합도 0~10점, 혈당 영향) 분석해 주세요. 3~4문장.',carnivore:'카니보어(육식) 관점에서(동물성 식품 비율, 카니보어 적합도 0~10점, 식물성 성분 포함 여부) 분석해 주세요. 3~4문장.',lchf:'저탄고지 관점에서(탄수화물 함량, 혈당 지수, 포만감) 분석해 주세요. 3~4문장.',diet:'균형 건강식 관점에서(칼로리 추정, 영양 균형, 지중해식 적합도) 분석해 주세요. 3~4문장.'};
  var p=(ps[u?u.mode:'keto']||ps.keto);
  var msgs;
  if(hasPic){ var b64=pre.src.split(',')[1],mt=pre.src.startsWith('data:image/png')?'image/png':'image/jpeg'; var txt=p; if(name)txt+=' 음식:'+name; msgs=[{role:'user',content:[{type:'image',source:{type:'base64',media_type:mt,data:b64}},{type:'text',text:txt}]}]; }
  else{ msgs=[{role:'user',content:'"'+name+'"을 '+p}]; }
  _api({max_tokens:400,messages:msgs}, function(reply){
    var result = reply||'분석 결과를 가져오지 못했어요.';
    ar.innerHTML='<div class="tip-lbl">AI 식단 분석</div>'+esc(result);
    // 분석 결과를 오늘 기록장에 저장
    _saveAnalysisResult(result);
  });
}

function _saveAnalysisResult(result){
  var today=todayStr();
  var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===today;});
  if(!dayRec){ dayRec={date:today,photos:{},steps:''}; days.push(dayRec); }
  // 시간대별로 분석 결과 저장
  var hour=new Date().getHours();
  var meal=hour<10?'breakfast':hour<15?'lunch':'dinner';
  if(!dayRec.analysis) dayRec.analysis={};
  dayRec.analysis[meal]=result;
  dayRec.analysis.latest=result;
  dayRec.analysis.ts=Date.now();
  _setRecs(days);
  // 홈 화면 분석 결과 업데이트
  _refreshHomeAnalysis();
}

function _refreshHomeAnalysis(){
  var el=$id('home-ai-result'); if(!el) return;
  var today=todayStr();
  var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===today;});
  if(dayRec&&dayRec.analysis&&dayRec.analysis.latest){
    el.style.display='block';
    el.innerHTML='<div class="tip-lbl">오늘의 식단 분석</div>'+esc(dayRec.analysis.latest);
  } else {
    el.style.display='none';
  }
}

function analyzeEx(){
  if(!KEY){ toast('API 키가 없습니다'); return; }
  var type=$id('ex-type').value.trim(); if(!type){ toast('운동 종류를 입력하세요'); return; }
  var dur=$id('ex-dur').value.trim();
  var memo=$id('ex-memo')?$id('ex-memo').value.trim():'';
  var ar=$id('ex-result')||$id('ai-result');
  ar.style.display='block';
  ar.innerHTML='<div class="tip-lbl">AI 운동 분석</div><div class="dots"><span></span><span></span><span></span></div>';
  var u=USER, ic=u&&u.mode==='cancer';
  var p='"'+type+'"'+(dur?' '+dur:'')+(memo?' ('+memo+')':'')+'을 ';
  p+=ic?'암 환자 관점에서(면역 기능, 체력 유지, 피로 관리) 분석해 주세요. 3~4문장.':
    (u&&u.mode?({keto:'케토제닉',carnivore:'카니보어',lchf:'저탄고지',diet:'다이어트'}[u.mode]||''):'')+' 식단 관점에서(지방 연소, 체력, 운동 후 식사 주의사항) 분석해 주세요. 3~4문장.';
  _api({max_tokens:350,messages:[{role:'user',content:p}]}, function(reply){
    var result=reply||'분석 결과를 가져오지 못했어요.';
    ar.innerHTML='<div class="tip-lbl">AI 운동 분석</div>'+esc(result);
    _saveExerciseResult(type, dur, memo, result);
  });
}

function _saveExerciseResult(type, dur, memo, analysis){
  var today=todayStr();
  var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===today;});
  if(!dayRec){ dayRec={date:today,photos:{},steps:''}; days.push(dayRec); }
  if(!dayRec.exercise) dayRec.exercise=[];
  dayRec.exercise.push({type:type,dur:dur,memo:memo,analysis:analysis,ts:Date.now()});
  _setRecs(days);
  _refreshHomeExercise();
}

function _refreshHomeExercise(){
  var el=$id('home-exercise-result'); if(!el) return;
  var today=todayStr();
  var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===today;});
  if(dayRec&&dayRec.exercise&&dayRec.exercise.length){
    var latest=dayRec.exercise[dayRec.exercise.length-1];
    el.style.display='block';
    el.innerHTML='<div class="tip-lbl">오늘의 운동 분석</div><div style="font-size:12px;font-weight:700;margin-bottom:4px;">🏃 '+esc(latest.type)+(latest.dur?' · '+esc(latest.dur):'')+'</div>'+esc(latest.analysis);
  } else {
    el.style.display='none';
  }
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
  var sel=$id('marker-select');
  var markerName = sel ? sel.value : (_getMarkers(USER?USER.ctype:'prostate')[0]||'PSA');
  var unit = _getMarkerUnit(markerName)||'ng/mL';
  var data=_getPSA();
  data.push({v:v, marker:markerName, unit:unit, date:$id('psa-date').value||todayStr(), note:$id('psa-note').value||'', ts:Date.now()});
  _setPSA(data); closeSheet('sh-psa'); _refreshPSABanner(); _loadPSAHistory();
  toast(markerName+' '+v+' '+unit+' 저장됐어요');
}

function _quickSavePSA(v){ var data=_getPSA(); data.push({v:v,date:todayStr(),note:'',ts:Date.now()}); _setPSA(data); _refreshPSABanner(); _loadPSAHistory(); }

function _loadPSAHistory(){
  var el=$id('psa-history'); if(!el) return;
  var data=_getPSA();
  if(!data.length){ el.innerHTML='<div class="empty-state" style="padding:18px;"><i class="ti ti-chart-line"></i><br>기록이 없어요</div>'; return; }
  el.innerHTML='';
  [].concat(data).reverse().forEach(function(item,i,arr){
    var prev=arr[i+1],ac='',at='→';
    if(prev&&prev.marker===item.marker){ if(item.v>prev.v){ac='up';at='▲';}else if(item.v<prev.v){ac='dn';at='▼';} }
    var markerName=item.marker||'PSA';
    var unit=item.unit||'ng/mL';
    var row=document.createElement('div'); row.className='psa-row-item';
    row.innerHTML='<div><div class="psa-row-date">'+item.date+' <span style="font-size:10px;background:var(--purple-l);color:var(--purple);padding:1px 6px;border-radius:8px;font-weight:700;">'+markerName+'</span></div>'+(item.note?'<div style="font-size:10px;color:var(--mu);">'+esc(item.note)+'</div>':'')+'</div>'
      +'<div style="display:flex;align-items:center;gap:6px;"><span class="psa-arr '+(ac||'')+'">'+at+'</span><span class="psa-row-val">'+item.v.toFixed(2)+' <span style="font-size:10px;font-weight:400;color:var(--mu);">'+unit+'</span></span></div>';
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
    var c=$id('cc'),MAX=480,w=img.width,h=img.height;
    if(w>MAX){h=Math.round(h*MAX/w);w=MAX;}
    c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);
    cb(c.toDataURL('image/jpeg',0.55));
  }; img.src=dataUrl;
}

/* ── 사진 파일 선택 ── */
function pickPhoto(src){ closeSheet('sh-photo'); $id('f-'+src).value=''; $id('f-'+src).click(); }
function onFile(e,src){
  var f=e.target.files[0]; e.target.value=''; if(!f) return;
  var meal = _pendingMeal; _pendingMeal = null;
  var r=new FileReader(); r.onload=function(ev){ _compress(ev.target.result,function(small){
    $id('preview-img').src=small; $id('preview-wrap').style.display=''; goPage('diet');
    // 오늘 날짜로 기록장에 자동 저장 (홈에서 넘어온 경우 해당 시간대로)
    _autoSavePhotoToLog(small, meal);
  }); }; r.readAsDataURL(f);
}

function _autoSavePhotoToLog(imgData, forceMeal){
  var today = todayStr();
  var hour = new Date().getHours();
  // 기록장과 키 통일: morning/lunch/dinner
  var mealMap = {breakfast:'morning', lunch:'lunch', dinner:'dinner'};
  var rawMeal = forceMeal || (hour < 10 ? 'breakfast' : hour < 15 ? 'lunch' : 'dinner');
  var meal = mealMap[rawMeal] || rawMeal;

  var recs = _getRecs();
  var dayRec = recs.find(function(r){ return r.date === today; });

  if(!dayRec){
    dayRec = {date:today, photos:{}, steps:''};
    recs.push(dayRec);
  }

  // Storage에 업로드
  var path = 'photos/'+USER.id+'/'+today+'_'+meal+'_'+Date.now()+'.jpg';
  var ref = _storage.ref(path);
  var byteStr = atob(imgData.split(',')[1]);
  var ab = new ArrayBuffer(byteStr.length);
  var ia = new Uint8Array(ab);
  for(var i=0;i<byteStr.length;i++) ia[i]=byteStr.charCodeAt(i);
  var blob = new Blob([ab],{type:'image/jpeg'});

  ref.put(blob).then(function(){ return ref.getDownloadURL(); }).then(function(url){
    dayRec.photos[meal] = url;
    _setRecs(recs);
    _refreshPhotos(); _refreshStats();
    _xlLoad(); // 기록장 카드 DOM 업데이트
    toast('기록장에도 저장됐어요 ✓');
  }).catch(function(){
    // Storage 실패 시 base64로 폴백
    dayRec.photos[meal] = imgData;
    _setRecs(recs);
    _refreshPhotos(); _refreshStats();
    _xlLoad();
  });
}

function pickMeal(src){ closeSheet('sh-meal'); $id('f-meal-'+src).value=''; $id('f-meal-'+src).click(); }
function onMealFile(e,src){
  var f=e.target.files[0]; e.target.value=''; if(!f) return;
  var r=new FileReader(); r.onload=function(ev){ _compress(ev.target.result,function(small){
    if(!_pendMeal) return;
    var p=_pendMeal; _pendMeal=null;
    var card=$id(p.cardId); if(!card) return;
    var slot=card.querySelector('[data-meal="'+p.meal+'"]'); if(!slot) return;
    // Storage에 업로드
    var path = 'photos/'+USER.id+'/'+p.cardId+'_'+p.meal+'_'+Date.now()+'.jpg';
    var ref = _storage.ref(path);
    // base64 → blob 변환
    var byteStr = atob(small.split(',')[1]);
    var ab = new ArrayBuffer(byteStr.length);
    var ia = new Uint8Array(ab);
    for(var i=0;i<byteStr.length;i++) ia[i]=byteStr.charCodeAt(i);
    var blob = new Blob([ab],{type:'image/jpeg'});
    toast('사진 업로드 중...');
    ref.put(blob).then(function(){ return ref.getDownloadURL(); }).then(function(url){
      _saveRot(p.cardId,p.meal,0); _renderFilled(slot,url,0); _schedSave(); _refreshPhotos(); _refreshStats();
      toast('사진이 저장됐어요 ✓');
    }).catch(function(err){
      console.error('Storage 업로드 실패', err);
      // 실패 시 base64로 폴백
      _saveRot(p.cardId,p.meal,0); _renderFilled(slot,small,0); _schedSave(); _refreshPhotos(); _refreshStats();
      toast('사진이 저장됐어요 ✓');
    });
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
  var existingRecs = _getRecs(); // 기존 저장된 데이터
  var days=[]; document.querySelectorAll('#log-cards .day-card').forEach(function(card){
    var dateVal = card.querySelector('.day-date').value;
    var photos={};
    card.querySelectorAll('[data-meal]').forEach(function(slot){
      var p=slot.getAttribute('data-photo');
      if(p) photos[slot.getAttribute('data-meal')]=p;
    });
    // 기존 records에 있는 photos와 병합 (홈에서 저장된 것 보존)
    var existing = existingRecs.find(function(r){ return r.date===dateVal; });
    if(existing&&existing.photos){
      Object.keys(existing.photos).forEach(function(k){
        if(!photos[k]) photos[k]=existing.photos[k];
      });
    }
    var rec = {date:dateVal, steps:card.querySelector('.steps-in').value, photos:photos};
    if(existing&&existing.analysis) rec.analysis=existing.analysis;
    days.push(rec);
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
  var days=_getRecs(), today=todayStr();
  var todayRec = days.find(function(d){ return d.date===today; });
  var meals = ['morning','lunch','dinner'];
  var slotMap = {morning:'breakfast', lunch:'lunch', dinner:'dinner'};
  meals.forEach(function(meal){
    var slotId = 'ms-img-'+slotMap[meal];
    var el = $id(slotId); if(!el) return;
    var photo = todayRec && todayRec.photos && todayRec.photos[meal];
    if(photo){
      el.innerHTML = '<img src="'+photo+'" alt="'+meal+'" style="width:100%;height:100%;object-fit:cover;">';
    } else {
      el.innerHTML = '<i class="ti ti-camera" style="font-size:40px;color:#fff;"></i>';
    }
  });
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
_loadCloudData(function(){
  var lo = $id('loading-overlay'); if(lo) lo.style.display='none';
  // 자동 재로그인 시도
  if(!_tryAutoLogin()){
    $id('scr-profile').classList.add('active');
    _navStack.push({type:'screen',id:'scr-profile'});
    try{ history.replaceState({navIdx:0}, '', '#scr-profile'); }catch(e){}
  }
});

/* ── 컨디션 기록 ── */
var _condState = '';

function openConditionSheet(){
  // 오늘 기록이 있으면 불러오기
  var today = todayStr();
  var recs = _getCondRecs();
  var todayRec = recs.find(function(r){ return r.date===today; });
  _condState = todayRec ? (todayRec.state||'') : '';
  // UI 초기화
  ['good','normal','bad'].forEach(function(s){
    var el=$id('cs-'+s); if(el) el.classList.toggle('sel', _condState===s);
  });
  $id('cond-weight').value = todayRec ? (todayRec.weight||'') : '';
  $id('cond-glucose').value = todayRec ? (todayRec.glucose||'') : '';
  $id('cond-bp-sys').value = todayRec ? (todayRec.bpSys||'') : '';
  $id('cond-bp-dia').value = todayRec ? (todayRec.bpDia||'') : '';
  $id('cond-sleep').value = todayRec ? (todayRec.sleep||'') : '';
  $id('cond-memo').value = todayRec ? (todayRec.memo||'') : '';
  openSheet('sh-condition');
}

function selectCondState(s){
  _condState = s;
  ['good','normal','bad'].forEach(function(st){
    var el=$id('cs-'+st); if(el) el.classList.toggle('sel', st===s);
  });
}

function saveCondition(){
  var today = todayStr();
  var rec = {
    date: today,
    state: _condState,
    weight: $id('cond-weight').value ? parseFloat($id('cond-weight').value) : null,
    glucose: $id('cond-glucose').value ? parseFloat($id('cond-glucose').value) : null,
    bpSys: $id('cond-bp-sys').value ? parseInt($id('cond-bp-sys').value) : null,
    bpDia: $id('cond-bp-dia').value ? parseInt($id('cond-bp-dia').value) : null,
    sleep: $id('cond-sleep').value ? parseFloat($id('cond-sleep').value) : null,
    memo: $id('cond-memo').value || '',
    ts: Date.now()
  };
  var recs = _getCondRecs();
  var idx = recs.findIndex(function(r){ return r.date===today; });
  if(idx>=0) recs[idx]=rec; else recs.push(rec);
  _setCondRecs(recs);
  closeSheet('sh-condition');
  _refreshCondSummary();
  toast('컨디션이 저장됐어요 ✓');
}

function _getCondRecs(){ return ugj('condRecs',[]); }
function _setCondRecs(d){ usj('condRecs',d); _schedSave(); }

function _refreshCondSummary(){
  var el=$id('condition-summary'); if(!el) return;
  var today=todayStr();
  var recs=_getCondRecs();
  var rec=recs.find(function(r){return r.date===today;});
  if(!rec){ el.textContent='탭해서 기록하세요'; return; }
  var parts=[];
  var stateMap={good:'😊 좋음',normal:'😐 보통',bad:'😔 나쁨'};
  if(rec.state) parts.push(stateMap[rec.state]||rec.state);
  if(rec.weight) parts.push(rec.weight+'kg');
  if(rec.glucose) parts.push('혈당 '+rec.glucose);
  if(rec.bpSys&&rec.bpDia) parts.push(rec.bpSys+'/'+rec.bpDia);
  if(rec.sleep) parts.push('수면 '+rec.sleep+'h');
  el.textContent = parts.length ? parts.join(' · ') : '탭해서 기록하세요';
}

function loadBackupList(){
  var el=$id('auto-backup-list'); if(!el) return;
  var backups=_listBackups();
  if(!backups.length){ el.innerHTML='<p class="sub dark-text">자동 백업 없음</p>'; return; }
  el.innerHTML='';
  backups.forEach(function(k){
    var dateKey=k.replace('mc_backup_','');
    var btn=document.createElement('div');
    btn.className='row gap';
    btn.style.marginBottom='6px';
    btn.innerHTML='<div style="flex:1;font-size:13px;font-weight:700;color:var(--navy);">📅 '+dateKey+'</div>'
      +'<button class="btn-sm teal" onclick="if(confirm(\''+dateKey+' 백업으로 복원하시겠습니까?\')){A.restoreBackup(\''+dateKey+'\');}">복원</button>';
    el.appendChild(btn);
  });
}

/* ── 범용 백업 모듈 (다른 앱에도 적용 가능) ──
   사용법:
   1. _autoBackup() - 앱 로드 시 호출
   2. _listBackups() - 백업 목록 조회
   3. _restoreBackup(dateKey) - 특정 날짜 백업으로 복원
   
   조건:
   - Firebase Firestore 사용
   - _cache 객체로 데이터 관리
   - _saveCloud() 함수로 저장
   
   키 이름 규칙: mc_backup_YYYY-MM-DD
── */

/* ── 종합 AI 분석 ── */
function _refreshComprehensiveBtn(){
  var today=todayStr();
  var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===today;});
  var hasFood=dayRec&&dayRec.analysis&&dayRec.analysis.latest;
  var hasEx=dayRec&&dayRec.exercise&&dayRec.exercise.length;
  var wrap=$id('home-comprehensive-wrap');
  if(wrap) wrap.style.display=(hasFood&&hasEx)?'block':'none';
  var compEl=$id('home-comprehensive-result');
  if(compEl&&dayRec&&dayRec.comprehensive){
    compEl.style.display='block';
    compEl.innerHTML='<div class="tip-lbl">오늘의 종합 평가</div>'+esc(dayRec.comprehensive);
  }
}

function analyzeComprehensive(){
  if(!KEY){ toast('API 키가 없습니다'); return; }
  var today=todayStr();
  var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===today;});
  if(!dayRec){ toast('오늘 기록이 없습니다'); return; }
  var foodAnalysis=dayRec.analysis&&dayRec.analysis.latest;
  var exList=dayRec.exercise||[];
  if(!foodAnalysis||!exList.length){ toast('식단과 운동 분석이 모두 필요합니다'); return; }
  var compEl=$id('home-comprehensive-result');
  compEl.style.display='block';
  compEl.innerHTML='<div class="tip-lbl">오늘의 종합 평가</div><div class="dots"><span></span><span></span><span></span></div>';
  var exSummary=exList.map(function(e){return e.type+(e.dur?' '+e.dur:'');}).join(', ');
  var mode=USER?USER.mode:'lchf';
  var modeDesc={keto:'케토제닉',carnivore:'카니보어',lchf:'저탄고지',diet:'균형 건강식',cancer:'암 환자'}[mode]||mode;
  var prompt='['+modeDesc+' 모드] 오늘의 종합 평가를 해주세요.\n\n[식단 분석]\n'+foodAnalysis+'\n\n[운동 기록]\n'+exSummary+'\n\n식단과 운동을 종합해서 오늘 하루 건강 관리를 평가하고, 내일을 위한 조언을 3~4문장으로 해주세요.';
  _api({max_tokens:400,messages:[{role:'user',content:prompt}]},function(reply){
    var result=reply||'종합 평가를 가져오지 못했어요.';
    compEl.innerHTML='<div class="tip-lbl">오늘의 종합 평가</div>'+esc(result);
    dayRec.comprehensive=result; _setRecs(days);
  });
}

var _homeMealSlot = null;
var _pendingMeal = null; // 홈 식사 슬롯에서 넘어올 때 시간대 기억
function openMealSlot(meal){
  // 사진이 이미 있으면 뷰어로 보여주기
  var mealMap = {breakfast:'morning', lunch:'lunch', dinner:'dinner'};
  var mealKey = mealMap[meal] || meal;
  var days=_getRecs(), today=todayStr();
  var todayRec=days.find(function(d){return d.date===today;});
  var existingPhoto = todayRec && todayRec.photos && todayRec.photos[mealKey];

  if(existingPhoto){
    // 사진이 있으면 뷰어 열기
    var mealName={breakfast:'🌅 아침',lunch:'☀️ 점심',dinner:'🌙 저녁'}[meal]||meal;
    var analysis = todayRec.analysis && (todayRec.analysis[mealKey]||todayRec.analysis.latest);
    _openHomeMealViewer(existingPhoto, mealName, analysis, meal);
    return;
  }

  // 사진 없으면 식단 탭으로 이동
  _pendingMeal = mealKey;
  goPage('diet');
  setDietTab('food');
  setTimeout(function(){ openSheet('sh-photo'); }, 200);
}

function _openHomeMealViewer(photoUrl, mealName, analysis, meal){
  // 기존 홈 뷰어 활용
  var img=$id('hv-img'); if(img) img.src=photoUrl;
  var viewer=$id('home-viewer'); if(viewer) viewer.classList.add('on');

  // 분석 내용 표시
  var analysisEl=$id('home-meal-analysis');
  if(!analysisEl){
    // 동적으로 생성
    var div=document.createElement('div');
    div.id='home-meal-analysis';
    div.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#fff;border-radius:18px 18px 0 0;padding:16px;z-index:201;max-height:50vh;overflow-y:auto;';
    div.innerHTML='<div style="font-size:14px;font-weight:700;margin-bottom:8px;">'+mealName+' 분석</div>'
      +'<div style="font-size:13px;line-height:1.8;color:#1A2F4C;">'+(analysis||'분석 내용 없음')+'</div>'
      +'<div style="display:flex;gap:8px;margin-top:12px;">'
      +'<button onclick="A.closeHomeMealViewer()" style="flex:1;padding:12px;background:#f5f4f2;border:none;border-radius:10px;font-size:14px;font-weight:700;">닫기</button>'
      +'<button onclick="A.replaceHomeMealPhoto(\''+meal+'\')" style="flex:1;padding:12px;background:#1a6b4a;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;">사진 교체</button>'
      +'</div>';
    document.body.appendChild(div);
  } else {
    analysisEl.style.display='block';
    analysisEl.innerHTML='<div style="font-size:14px;font-weight:700;margin-bottom:8px;">'+mealName+' 분석</div>'
      +'<div style="font-size:13px;line-height:1.8;color:#1A2F4C;">'+(analysis||'분석 내용 없음')+'</div>'
      +'<div style="display:flex;gap:8px;margin-top:12px;">'
      +'<button onclick="A.closeHomeMealViewer()" style="flex:1;padding:12px;background:#f5f4f2;border:none;border-radius:10px;font-size:14px;font-weight:700;">닫기</button>'
      +'<button onclick="A.replaceHomeMealPhoto(\''+meal+'\')" style="flex:1;padding:12px;background:#1a6b4a;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;">사진 교체</button>'
      +'</div>';
  }
}

function closeHomeMealViewer(){
  var viewer=$id('home-viewer'); if(viewer) viewer.classList.remove('on');
  var analysisEl=$id('home-meal-analysis'); if(analysisEl) analysisEl.style.display='none';
}

function replaceHomeMealPhoto(meal){
  closeHomeMealViewer();
  var mealMap={breakfast:'morning',lunch:'lunch',dinner:'dinner'};
  _pendingMeal=mealMap[meal]||meal;
  goPage('diet');
  setDietTab('food');
  setTimeout(function(){ openSheet('sh-photo'); },200);
}
function pickHomeMeal(src){
  closeSheet('sh-home-meal');
  var inp=$id('f-home-meal-'+src); if(inp){inp.value='';inp.click();}
}
function onHomeMealFile(e,src){
  var f=e.target.files[0]; e.target.value=''; if(!f||!_homeMealSlot) return;
  var s=_homeMealSlot; _homeMealSlot=null;
  var mealName={breakfast:'아침',lunch:'점심',dinner:'저녁'}[s.meal]||s.meal;
  var r=new FileReader(); r.onload=function(ev){ _compress(ev.target.result,function(small){
    // 1. 식단 탭 미리보기에도 표시
    $id('preview-img').src=small; $id('preview-wrap').style.display='';
    // 2. Storage 업로드
    var path='photos/'+USER.id+'/'+s.today+'_'+s.meal+'_'+Date.now()+'.jpg';
    var ref=_storage.ref(path);
    var byteStr=atob(small.split(',')[1]);
    var ab=new ArrayBuffer(byteStr.length);
    var ia=new Uint8Array(ab);
    for(var i=0;i<byteStr.length;i++) ia[i]=byteStr.charCodeAt(i);
    var blob=new Blob([ab],{type:'image/jpeg'});
    toast('저장 중...');
    ref.put(blob).then(function(){return ref.getDownloadURL();}).then(function(url){
      s.todayRec.photos[s.meal]=url; _setRecs(s.days); _refreshPhotos(); 
      toast(mealName+' 사진 저장됐어요 ✓');
      // 3. AI 분석 실행
      _analyzeHomeMeal(small, mealName);
    }).catch(function(){
      s.todayRec.photos[s.meal]=small; _setRecs(s.days); _refreshPhotos();
      toast(mealName+' 사진 저장됐어요 ✓');
      _analyzeHomeMeal(small, mealName);
    });
  }); }; r.readAsDataURL(f);
}

function _analyzeHomeMeal(imgData, mealName){
  if(!KEY) return;
  // 결과를 홈 화면에 표시
  var resultEl = $id('home-ai-result');
  if(!resultEl) return;
  resultEl.style.display='block';
  resultEl.innerHTML='<div class="tip-lbl">AI 식단 분석 · '+mealName+'</div><div class="dots"><span></span><span></span><span></span></div>';
  var mode=USER?USER.mode:'lchf';
  var modeDesc={keto:'케토제닉(탄수화물 20g 이하)',carnivore:'카니보어(동물성 식품)',lchf:'저탄고지(탄수화물 100g 이하)',diet:'균형 건강식',cancer:'암 환자 항산화 식단'}[mode]||mode;
  var prompt='['+mealName+' 식사 사진] '+modeDesc+' 관점에서 분석해주세요. 주요 음식명, 적합도, 개선 제안을 3~4문장으로 간결하게.';
  _api({
    max_tokens:300,
    messages:[{role:'user',content:[
      {type:'image',source:{type:'base64',media_type:'image/jpeg',data:imgData.split(',')[1]}},
      {type:'text',text:prompt}
    ]}]
  }, function(reply){
    resultEl.innerHTML='<div class="tip-lbl">AI 식단 분석 · '+mealName+'</div>'+esc(reply||'분석 결과를 가져오지 못했어요');
  });
}

/* ── 공개 API ── */
return {
  // 화면
  goScreen:goScreen, logoTap:logoTap, enterByName:enterByName, goHelp:goHelp, goBack:goBack,
  // 설정
  checkPw:checkPw,
  // Admin
  delUser:delUser, changePw:changePw, backup:backup, restore:restore, fullReset:fullReset, filterAdminUsers:filterAdminUsers, backupText:backupText, copyBackupText:copyBackupText, showPatient:showPatient,
  loadBackupList:loadBackupList, restoreBackup:_restoreBackup,
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
  openSheet:openSheet, closeSheet:closeSheet, savePSA:savePSA, openMarkerSheet:openMarkerSheet,
  // 컨디션 기록
  openConditionSheet:openConditionSheet, selectCondState:selectCondState, saveCondition:saveCondition,
  // 종합 분석
  analyzeComprehensive:analyzeComprehensive,
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
  _openMealSheet:_openMealSheet,
  // 홈 식사 슬롯
  openMealSlot:openMealSlot, pickHomeMeal:pickHomeMeal, onHomeMealFile:onHomeMealFile,
  closeHomeMealViewer:closeHomeMealViewer, replaceHomeMealPhoto:replaceHomeMealPhoto
};

})();