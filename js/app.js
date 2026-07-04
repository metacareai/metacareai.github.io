'use strict';

/* 랜딩 태그 선택 — A 로드 전에도 동작하도록 전역 함수 */
function landingTagPick(el){
  document.querySelectorAll('.landing-tag').forEach(function(t){
    t.style.background='rgba(25,184,155,.2)';
    t.style.color='#19B89B';
    t.style.border='1px solid rgba(25,184,155,.35)';
  });
  el.style.background='#19B89B';
  el.style.color='#fff';
  el.style.border='1px solid #19B89B';
  setTimeout(function(){
    document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
    var p=document.getElementById('scr-profile'); if(p) p.classList.add('active');
  }, 280);
}

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
    // 사용자별 records는 컬렉션에 저장 - 메인 문서에서 제외
    var slim = {};
    Object.keys(_cache).forEach(function(k){
      var v = _cache[k];
      if(typeof v === 'string' && v.includes('data:image')) return;
      if(k.startsWith('mc_backup_')) return;
      if(k.endsWith('_records')) return; // records는 컬렉션에 별도 저장
      slim[k] = v;
    });
    var size = JSON.stringify(slim).length;
    if(size > 900000){
      console.error('🚨 저장 데이터 크기 초과:', size, 'bytes');
      toast('⚠️ 데이터 크기 초과 - 관리자에게 문의하세요');
      return;
    }
    _docRef.set(slim).catch(function(err){ console.error('Firestore 저장 오류', err); });
  }, 500);
}

// records 전용 컬렉션 저장
var _saveRecsTimer = null;
function _saveRecsCloud(userId, recs){
  if(!userId) return;
  if(_saveRecsTimer) clearTimeout(_saveRecsTimer);
  _saveRecsTimer = setTimeout(function(){
    var ref = _db.collection('users').doc(userId).collection('data').doc('records');
    ref.set({records: JSON.stringify(recs), ts: Date.now()})
      .then(function(){ console.log('✅ records 저장:', recs.length+'개'); })
      .catch(function(err){ console.error('records 저장 오류:', err); });
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
    // 데이터 로드 후 자동 백업 + 무결성 검사
    setTimeout(function(){
      _autoBackup();
      _verifyDataIntegrity();
    }, 2000);
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
    var hour = today.getHours() < 14 ? 'am' : 'pm';
    var backupKey = 'mc_backup_'+dateKey+'_'+hour;
    
    // 같은 시간대 백업이 이미 있으면 건너뜀
    if(_cache[backupKey]) return;
    
    // base64 제외하고 스냅샷 저장
    var slimCache = {};
    Object.keys(_cache).forEach(function(k){
      var v = _cache[k];
      if(typeof v === 'string' && v.includes('data:image')) return; // base64 제외
      if(k.startsWith('mc_backup_')) return; // 백업 중첩 제외
      slimCache[k] = v;
    });
    // records 안의 base64도 제거
    if(slimCache['records'] || slimCache[Object.keys(slimCache).find(function(k){return k.endsWith('_records');})]){
      Object.keys(slimCache).forEach(function(k){
        if(k.endsWith('_records')){
          try{
            var recs = JSON.parse(slimCache[k]);
            recs.forEach(function(r){
              if(r&&r.photos) Object.keys(r.photos).forEach(function(m){
                if(r.photos[m]&&r.photos[m].startsWith('data:image')) delete r.photos[m];
              });
            });
            slimCache[k] = JSON.stringify(recs);
          }catch(e){}
        }
      });
    }
    var snapshot = JSON.stringify(slimCache);
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
    
    // 백업은 별도 backups 컬렉션에만 저장 (메인 문서에 포함 안 함)
    _db.collection('metacare').doc('backups').set(
      _cache[backupKey] ? {[backupKey]: _cache[backupKey]} : {}
    , {merge: true}).catch(function(e){ console.warn('백업 저장 실패:', e.message); });
    console.log('✅ 자동 백업 완료:', dateKey);
  } catch(e) {
    console.error('백업 오류:', e);
  }
}

function _verifyDataIntegrity(){
  try{
    var recs = ugj('records',[]);
    var users = S.gj('mc_users',[]);
    console.log('📊 데이터 무결성 검사: records='+recs.length+'개, users='+users.length+'명');
    if(users.length > 0 && recs.length === 0){
      console.warn('⚠️ 사용자는 있는데 기록이 없습니다. 백업 복원을 확인하세요.');
    }
    // base64 정리는 저장 시점에만 처리 (데이터 손실 방지)
  }catch(e){ console.error('무결성 검사 오류:', e); }
}

function _cleanBase64FromRecs(){
  // 안전 버전: records의 base64만 제거, 백업/users 절대 건드리지 않음
  try{
    var recs = ugj('records',[]);
    var cleaned = false;
    recs.forEach(function(rec){
      if(!rec.photos) return;
      Object.keys(rec.photos).forEach(function(meal){
        if(rec.photos[meal] && rec.photos[meal].startsWith('data:image')){
          console.warn('🧹 base64 제거:', rec.date, meal);
          delete rec.photos[meal];
          cleaned = true;
        }
      });
    });
    if(cleaned){
      usj('records', recs);
      console.log('✅ base64 정리 완료');
    }
  }catch(e){ console.error('base64 정리 오류:', e); }
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
function md(s){
  // 마크다운 → HTML 간단 변환 (**굵게**, *기울임*, # 제목, 줄바꿈)
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g,'<em>$1</em>')
    .replace(/^#{1,3} (.+)/gm,'<strong>$1</strong>')
    .replace(/\n/g,'<br>');
}
function todayStr(){ var d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
// YYYYMMDD → YYYY-MM-DD 변환 (잘못된 형식 보정)
function normDate(s){
  if(!s) return todayStr();
  s=s.trim();
  if(/^\d{8}$/.test(s)) return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8);
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return todayStr();
}
function pad(n){ return n<10?'0'+n:String(n); }

/* ── 화면 전환 ── */
var _navStack = [];
var _suppressPush = false;

function goScreen(id, opts){
  document.querySelectorAll('.screen').forEach(function(s){ s.classList.remove('active'); });
  var el = $id(id);
  if(el) el.classList.add('active');
  // scr-profile 이동 시 자동 로그인 정보는 유지 (명시적 로그아웃 시에만 삭제)
  if(id==='scr-admin-users') _renderAdminList();
  if(id==='scr-admin-monitor') _renderMonitorList();
  if(id==='scr-add-user') _resetAddForm();
  if(!_suppressPush){
    _navStack.push({type:'screen', id:id});
    try{ history.pushState({navIdx:_navStack.length-1}, '', '#'+id); }catch(e){}
  }
}

function _handlePopState(e){
  // 뒤로가기 시 로그인 상태면 홈으로, 아니면 기본 동작
  if(USER){ goPage('home'); try{ history.pushState({navIdx:0},'',location.href); }catch(e2){} return; }
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
var _nameTapCount=0, _nameTapTimer=null;
function nameTap(){
  _nameTapCount++;
  if(_nameTapTimer) clearTimeout(_nameTapTimer);
  _nameTapTimer = setTimeout(function(){ _nameTapCount=0; }, 1500);
  if(_nameTapCount>=5){
    _nameTapCount=0;
    $id('admin-pw-input').value='';
    goScreen('scr-admin-pw');
  }
}

/* ── Admin 로그인 ── */
function checkPw(){
  var pw = $id('admin-pw-input').value;
  var stored = S.g('mc_admin_pw')||'Kevin';
  // 임시: 비밀번호 없이도 진입 가능
  if(!stored) stored = 'Kevin';
  if(pw === stored){
    $id('admin-pw-input').value = '';
    localStorage.setItem('mc_is_admin','1');
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
  var ml = {cancer:'질병 관리', keto:'케토제닉', carnivore:'카니보어', lchf:'저탄고지', diet:'다이어트 건강식'};
  var mi = {cancer:'🔬', keto:'🥑', carnivore:'🥩', lchf:'🍖', diet:'🥗'};
  var cn = {thyroid:'갑상선암',colorectal:'대장암',lung:'폐암',stomach:'위암',breast:'유방암',liver:'간암',pancreas:'췌장암',bile:'담낭·담도암',kidney:'신장암',cervical:'자궁경부암',prostate:'전립선암',other:'기타 암'};

  el.innerHTML = users.map(function(u){
    var ic = u.mode==='cancer';
    var ctypeName = (u.ctype==='other'&&u.otherCancerName) ? u.otherCancerName : (cn[u.ctype]||'질병 관리');
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
  var ctypeName = (u.ctype==='other'&&u.otherCancerName) ? u.otherCancerName : (cn[u.ctype]||'질병 관리');
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
  var ml = {cancer:'질병 관리', keto:'케토제닉', carnivore:'카니보어', lchf:'저탄고지', diet:'다이어트 건강식'};
  var mi = {cancer:'🔬', keto:'🥑', carnivore:'🥩', lchf:'🍖', diet:'🥗'};
  var cn = {thyroid:'갑상선암',colorectal:'대장암',lung:'폐암',stomach:'위암',breast:'유방암',liver:'간암',pancreas:'췌장암',bile:'담낭·담도암',kidney:'신장암',cervical:'자궁경부암',prostate:'전립선암',other:'기타 암'};
  el.innerHTML = users.map(function(u){
    var ic = u.mode==='cancer';
    var ctypeName = (u.ctype==='other'&&u.otherCancerName) ? u.otherCancerName : (cn[u.ctype]||'질병 관리');
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

function forceCloudSave(){
  // 현재 _cache를 Firestore에 강제 저장
  var slim = {};
  Object.keys(_cache).forEach(function(k){
    var v = _cache[k];
    if(typeof v === 'string' && v.includes('data:image')) return;
    if(k.startsWith('mc_backup_')) return;
    slim[k] = v;
  });
  console.log('강제 저장 키:', Object.keys(slim));
  _docRef.set(slim).then(function(){
    toast('✅ 데이터 강제 저장 완료!');
    alert('저장 완료! 키: ' + Object.keys(slim).join(', '));
  }).catch(function(err){
    alert('저장 실패: ' + err.message);
  });
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
  {id:'cancer', icon:'🔬', name:'질병 관리', desc:'PSA 추적 · 증상 기록 · 복약 · 식단 분석'},
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
    errEl.textContent = '등록된 정보가 없습니다. 아래에서 가입해 주세요.';
    errEl.style.display = 'block';
    var joinBtn = $id('login-join-btn');
    if(joinBtn) joinBtn.style.display = 'block';
    return;
  }
  $id('login-name').value=''; $id('login-year').value='';
  loginUser(match);
}

/* ── 자가 가입 ── */
var _sjName='', _sjYear='', _sjMode='', _sjCtype='', _sjStage=0;

function goSelfJoin(){
  _sjName = ($id('login-name').value||'').trim();
  _sjYear = ($id('login-year').value||'').trim();
  if(!_sjName){ toast('이름을 먼저 입력해 주세요'); return; }
  var conf = $id('sj-name-confirm');
  if(conf) conf.textContent = _sjName + (_sjYear?' · '+_sjYear+'년생':'') + ' 님';
  _sjMode=''; _sjCtype=''; _sjStage=0;
  // 모드 버튼 렌더
  var mb=$id('sj-mode-btns'); if(!mb) return;
  mb.innerHTML='';
  _MODES.forEach(function(m){
    var btn=document.createElement('button');
    btn.className='mode-card'; btn.id='sj-mc-'+m.id;
    btn.innerHTML='<div class="mode-av">'+m.icon+'</div><div><div class="mode-name">'+m.name+'</div><div class="mode-desc">'+m.desc+'</div></div>';
    btn.onclick=function(){ _sjPickMode(m.id); };
    mb.appendChild(btn);
  });
  if($id('sj-ctype-wrap')) $id('sj-ctype-wrap').style.display='none';
  if($id('sj-other-wrap')) $id('sj-other-wrap').style.display='none';
  if($id('sj-stage-wrap')) $id('sj-stage-wrap').style.display='none';
  goScreen('scr-self-join');
}

function _sjPickMode(id){
  _sjMode=id; _sjCtype=''; _sjStage=0;
  document.querySelectorAll('#sj-mode-btns .mode-card').forEach(function(b){ b.classList.remove('active'); });
  var mc=$id('sj-mc-'+id); if(mc) mc.classList.add('active');
  if($id('sj-ctype-wrap')) $id('sj-ctype-wrap').style.display = id==='cancer'?'':'none';
  if($id('sj-stage-wrap')) $id('sj-stage-wrap').style.display='none';
  if(id==='cancer'){
    var cb=$id('sj-ctype-btns'); if(!cb) return;
    cb.innerHTML='';
    _CTYPES.forEach(function(c){
      var btn=document.createElement('button');
      btn.className='mode-card'; btn.id='sj-ct-'+c.id;
      btn.innerHTML='<div class="mode-av">'+c.icon+'</div><div><div class="mode-name">'+c.name+'</div><div class="mode-desc">'+c.desc+'</div></div>';
      btn.onclick=function(){ _sjPickCtype(c.id); };
      cb.appendChild(btn);
    });
  }
}

function _sjPickCtype(id){
  _sjCtype=id;
  document.querySelectorAll('#sj-ctype-btns .mode-card').forEach(function(b){ b.classList.remove('active'); });
  var mc=$id('sj-ct-'+id); if(mc) mc.classList.add('active');
  if($id('sj-other-wrap')) $id('sj-other-wrap').style.display = id==='other'?'':'none';
  if($id('sj-stage-wrap')) $id('sj-stage-wrap').style.display='';
  var sb=$id('sj-stage-btns'); if(!sb) return;
  sb.innerHTML='';
  _STAGES.forEach(function(s){
    var btn=document.createElement('button');
    btn.className='stage-card'; btn.id='sj-st-'+s.n;
    btn.innerHTML='<div class="stage-num">'+s.n+'기</div><div class="stage-name">'+s.name+'</div>';
    btn.onclick=function(){ _sjStage=s.n; document.querySelectorAll('#sj-stage-btns .stage-card').forEach(function(b){b.classList.remove('active');}); btn.classList.add('active'); };
    sb.appendChild(btn);
  });
}

function selfJoin(){
  if(!_sjMode){ toast('목적을 선택해 주세요'); return; }
  if(_sjMode==='cancer'&&!_sjCtype){ toast('암 종류를 선택해 주세요'); return; }
  if(_sjMode==='cancer'&&!_sjStage){ toast('병기를 선택해 주세요'); return; }
  if(_sjMode==='cancer'&&_sjCtype==='other'){
    var on=($id('sj-other-name')&&$id('sj-other-name').value.trim())||'';
    if(!on){ toast('암 종류를 직접 입력해 주세요'); return; }
  }
  var users=_getUsers();
  if(users.some(function(u){ return u.name===_sjName && String(u.birthYear)===String(_sjYear); })){
    toast('이미 가입된 계정이 있습니다'); loginUser(users.find(function(u){ return u.name===_sjName; })); return;
  }
  var otherNm=(_sjCtype==='other'&&$id('sj-other-name'))?$id('sj-other-name').value.trim():'';
  var newUser={id:'u'+Date.now(), name:_sjName, birthYear:_sjYear, mode:_sjMode, ctype:_sjCtype, otherCancerName:otherNm, stage:_sjStage, treatments:[], createdAt:Date.now()};
  users.push(newUser);
  _setUsers(users);
  toast(_sjName+' 님, 환영합니다! 🎉');
  loginUser(newUser);
}

/* ── 로그인 ── */
function loginUser(u){
  USER = u;
  try{ 
    var saved = localStorage.getItem('mc_last_user');
    var lastPage = 'home';
    if(saved){
      var info = JSON.parse(saved);
      if(info.id === u.id) lastPage = info.lastPage||'home';
    }
    localStorage.setItem('mc_last_user', JSON.stringify({id:u.id, name:u.name, birthYear:u.birthYear, lastPage:lastPage})); 
    // 빠른 입장 버튼 숨기기
    var quickBtn=$id('quick-login-btn'); if(quickBtn) quickBtn.style.display='none';
  }catch(e){}
  if(!KEY){ toast('API 키가 없습니다. Admin에서 설정해주세요.'); return; }
  // 컬렉션에서 해당 사용자 records 로드
  _loadUserRecords(u.id, function(){
    _initApp();
    goScreen('scr-app');
    if(typeof initInstallBanner==='function') initInstallBanner();
  });
  // 마지막 페이지 복원 (같은 사용자일 때만)
  try{
    var s=localStorage.getItem('mc_last_user');
    if(s){ var inf=JSON.parse(s); var lp=inf.lastPage||'home'; if(lp!=='home') setTimeout(function(){ goPage(lp); },100); }
  }catch(e){}
}

/* ── 자동 재로그인 (한 번 로그인하면 유지) ── */
function _tryAutoLogin(){
  try{
    var saved = localStorage.getItem('mc_last_user');
    if(!saved) return false;
    var info = JSON.parse(saved);
    var users = _getUsers();
    var match = users.find(function(u){ return u.id===info.id; });
    if(!match) return false;
    // 바로 앱으로 진입
    loginUser(match);
    return true;
  }catch(e){ return false; }
}

/* ── 사용자 records 컬렉션 로드 ── */
function _loadUserRecords(userId, cb){
  var ref = _db.collection('users').doc(userId).collection('data').doc('records');
  ref.get().then(function(doc){
    if(doc.exists && doc.data().records){
      try{
        var recs = JSON.parse(doc.data().records);
        console.log('✅ 컬렉션에서 records 로드:', recs.length+'개');
        // 캐시 업데이트 (메인 문서의 records보다 컬렉션 우선)
        _cache['mc_'+userId+'_records'] = JSON.stringify(recs);
      }catch(e){ console.warn('컬렉션 records 파싱 실패:', e); }
    } else {
      console.log('ℹ️ 컬렉션 records 없음 - 메인 문서 사용');
    }
    cb();
  }).catch(function(err){
    console.warn('컬렉션 records 로드 실패:', err);
    cb();
  });
}

/* ── 앱 초기화 ── */
function _initApp(){
  var u = USER;
  var ic = u.mode==='cancer';
  var ip = ic && u.ctype==='prostate';
  var ml = {cancer:'질병 관리', keto:'케토제닉', carnivore:'카니보어', lchf:'저탄고지', diet:'다이어트 건강식'};

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
  _refreshYesterdayFeedback();
  if(ic){ _refreshMedHome(); _refreshTodaySym(); }
  else{ _refreshStats(); }

  // 날짜
  var pdi=$id('psa-date'); if(pdi) pdi.value=todayStr();
  _updateDays();

  _refreshHomeProgress();
  tts('안녕하세요 '+u.name+' 님!');
  _showGreeting(u.name);
  setTimeout(_initDragDrop, 500);
}

/* ── 건강관리 홈 ── */
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
  var gc=$id('home-goal-card'); if(gc){ gc.style.background='linear-gradient(135deg,#3B1F8A,var(--purple))'; }
  var markers = _getMarkers(u.ctype);
  var gl=$id('home-goal-lbl'); if(gl) gl.textContent=markers[0]||'종양 마커';
  var gi=$id('home-goal-items'); if(gi) gi.textContent='-- '+_getMarkerUnit(markers[0]);
  ['ms-breakfast','ms-lunch','ms-dinner'].forEach(function(id){
    var el=$id(id); if(!el) return;
    el.style.background='linear-gradient(135deg,#4a1d96,#6B3FA0)';
    el.style.color='#fff'; el.classList.add('colored');
  });
  var bs=$id('home-banner-sub'); if(bs) bs.textContent='항산화·저당 관점의 암 환자 맞춤 식단 분석';
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
/* ── AI 맞춤 추천 ── */
function loadAiRec(){
  if(!KEY){ toast('API 키가 없습니다'); return; }
  var recEl=$id('ai-rec-text'); if(!recEl) return;
  recEl.innerHTML='<div class="dots"><span></span><span></span><span></span></div>';
  var today=todayStr();
  var days=_getRecs();
  var todayRec=days.find(function(d){return d.date===today;});
  var foodAnalysis=todayRec&&todayRec.analysis?todayRec.analysis.latest:'';
  var exercise=todayRec&&todayRec.exercise&&todayRec.exercise.length?todayRec.exercise[todayRec.exercise.length-1]:null;
  var photos=todayRec&&todayRec.photos?Object.keys(todayRec.photos).length:0;
  var recentDays=days.slice(-7);
  var exDays=recentDays.filter(function(d){return d.exercise&&d.exercise.length;}).length;
  var mealDays=recentDays.filter(function(d){return d.photos&&Object.keys(d.photos).length>0;}).length;
  var mode=USER?USER.mode:'lchf';
  var modeDesc={keto:'케토제닉',carnivore:'카니보어',lchf:'저탄고지',diet:'균형 건강식',cancer:'암 환자'}[mode]||mode;
  var prompt='['+modeDesc+' 모드] 오늘 건강 기록:\n';
  if(photos>0) prompt+='식사 '+photos+'끼 촬영\n';
  if(foodAnalysis) prompt+='식단 분석 요약: '+foodAnalysis.substring(0,200)+'\n';
  if(exercise) prompt+='운동: '+exercise.type+(exercise.dur?' '+exercise.dur:'')+(exercise.steps?' '+exercise.steps+'보':'')+'\n';
  prompt+='최근 7일: 식사 기록 '+mealDays+'일, 운동 '+exDays+'일\n\n';
  prompt+='이 데이터를 바탕으로 내일을 위한 식단 추천 1가지, 운동 추천 1가지, 생활 습관 조언 1가지를 구체적으로 3~4문장으로 해주세요.';
  _api({max_tokens:600,messages:[{role:'user',content:prompt}]},function(reply){
    recEl.innerHTML=esc(reply||'추천을 가져오지 못했어요. 다시 시도해주세요.');
    _renderWeekStats();
  });
}

function _renderWeekStats(){
  var el=$id('week-stats-box'); if(!el) return;
  var days=_getRecs();
  var recentDays=days.slice(-7);
  var mealDays=recentDays.filter(function(d){return d.photos&&Object.keys(d.photos).length>0;}).length;
  var exDays=recentDays.filter(function(d){return d.exercise&&d.exercise.length;}).length;
  el.innerHTML='<div class="prog-row"><div class="row space-between mb4"><span>식사 기록</span><span style="color:var(--teal);font-weight:700;">'+mealDays+'/7일</span></div>'
    +'<div class="prog-bg"><div class="prog-bar" style="width:'+(mealDays/7*100).toFixed(0)+'%;background:var(--teal)"></div></div></div>'
    +'<div class="prog-row"><div class="row space-between mb4"><span>운동 기록</span><span style="color:var(--warn);font-weight:700;">'+exDays+'/7일</span></div>'
    +'<div class="prog-bg"><div class="prog-bar" style="width:'+(exDays/7*100).toFixed(0)+'%;background:var(--warn)"></div></div></div>';
}

function _initMarkerTrack(){
  if(!USER||USER.mode!=='cancer') return;
  var t=$id('marker-title'); if(t) t.textContent=_getMarkerLabel();
}

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
  var modeNames = {keto:'케토제닉', carnivore:'카니보어', lchf:'저탄고지', diet:'다이어트 건강식', cancer:'질병 관리'};
  var modeName = ic ? (u.ctype==='prostate' ? u.stage+'기 전립선암' : '암환자') : (modeNames[u.mode]||'건강관리');
  var modeColor = {keto:'#2A7B7B', carnivore:'#7A2E2E', lchf:'#1a6b4a', diet:'#1565C0', cancer:'#6B21A8'}[u?u.mode:'lchf'] || 'var(--navy)';

  // ── 빠른 시작 3단계 ──
  var quickStart = ic ? [
    {num:'1', emoji:'📋', title:'매일 아침 증상 기록', desc:'홈에서 통증·배뇨·피로 점수를 입력하세요'},
    {num:'2', emoji:'📸', title:'식사 사진 찍기', desc:'아침·점심·저녁 칸을 탭 → 사진 촬영 → AI가 암환자 식단으로 분석'},
    {num:'3', emoji:'💊', title:'복약 체크', desc:'드신 약마다 체크 표시 → 하루 복약률 자동 계산'},
  ] : [
    {num:'1', emoji:'📸', title:'식사 사진 찍기', desc:'홈 화면 아침·점심·저녁 칸을 탭 → 사진 촬영 or 갤러리 선택'},
    {num:'2', emoji:'🤖', title:'AI 분석 확인', desc:'몇 초 후 식단 분석 결과가 홈 화면에 자동으로 나타나요'},
    {num:'3', emoji:'🏃', title:'운동 기록', desc:'하단 "운동" 탭 → 종류·시간 입력 → 여러 운동 연속 기록 가능'},
  ];

  // ── 기능별 상세 안내 ──
  var sections = [];

  // 모드별 식단 팁
  var modeTips = {
    keto:{
      color:'#2A7B7B', icon:'🥑', title:'케토제닉 식단 핵심',
      items:[
        '탄수화물 하루 <b>20g 이하</b> — 밥·빵·면·과자 제외',
        '지방 75% · 단백질 20% · 탄수화물 5% 비율 목표',
        '<b>먹어도 되는 것</b>: 소고기, 삼겹살, 계란, 아보카도, 버터, 치즈, 견과류',
        '<b>피해야 할 것</b>: 쌀밥, 고구마, 과일, 과자, 음료수, 빵',
        '처음 1~2주 두통·피로(케토 플루) → 소금물, 물 충분히 섭취',
      ]
    },
    carnivore:{
      color:'#7A2E2E', icon:'🥩', title:'카니보어 식단 핵심',
      items:[
        '동물성 식품만 — 고기, 생선, 달걀, 유제품(버터·치즈)',
        '채소·과일·곡물·견과류 <b>완전 제외</b>',
        '소금은 적당히 섭취 (전해질 보충)',
        '처음 2~4주 적응 기간: 피로감, 소화 변화 정상',
        '물 하루 <b>2리터 이상</b> 필수',
      ]
    },
    lchf:{
      color:'#1a6b4a', icon:'🥗', title:'저탄고지 식단 핵심',
      items:[
        '탄수화물 하루 <b>50~100g</b> — 케토보다 유연',
        '현미밥 반 공기, 고구마 조금은 허용',
        '<b>식사 순서</b>: 채소 → 단백질(고기·생선) → 밥·면',
        '<b>좋은 지방</b>: 올리브오일, 아보카도, 견과류, 등 푸른 생선',
        '혈당 스파이크 방지 → 식후 10~15분 가벼운 걷기 추천',
      ]
    },
    diet:{
      color:'#1565C0', icon:'🥦', title:'균형 건강식 핵심',
      items:[
        '하루 <b>1,600kcal</b> 목표 — 식사 사진으로 AI가 추정',
        '채소·과일 <b>절반 이상</b>, 단백질 30%, 탄수화물 40%',
        '올리브오일·생선·견과류 중심의 지중해식',
        '<b>식사 30분 전</b> 물 한 잔 → 포만감↑ 과식 방지',
        '하루 <b>1.5~2리터</b> 물 섭취 목표',
      ]
    },
    cancer:{
      color:'#6B21A8', icon:'🛡️', title:'암환자 식단 핵심',
      items:[
        '항염 식품 위주 — 연어·고등어, 강황, 블루베리, 브로콜리',
        '설탕·정제 탄수화물 최소화 (암세포 먹이)',
        '단백질 충분히 — 근육 유지·면역력 강화',
        '항암 치료 중: 메스꺼움 시 소량 자주, 부드러운 음식',
        '식욕 없을 땐 고열량 스무디(바나나+아몬드버터+우유)',
      ]
    }
  };
  if(modeTips[u?u.mode:'lchf']) sections.push({type:'tips', data:modeTips[u.mode], color:modeColor});

  // 공통 기능 섹션
  sections.push({type:'features', title:'📱 주요 기능 안내', items:[
    {icon:'ti-home', color:'#19B89B', title:'홈 화면',
     steps:['오늘의 목표(상단 초록 박스)에서 식단 목표 확인','아침·점심·저녁 칸 탭 → 사진 촬영 or 갤러리 선택','PC에서는 사진을 슬롯으로 드래그 앤 드롭도 가능','AI 분석 결과가 자동으로 홈에 표시']},
    {icon:'ti-run', color:'#F0A500', title:'운동 탭 (하단 메뉴)',
     steps:['운동 종류·시간 입력 후 "AI 운동 분석" 버튼','분석 완료 후 폼이 초기화 → 바로 다음 운동 추가 가능','여러 운동을 연속으로 기록할 수 있어요 (조깅 후 수영 등)','목록의 ✕ 버튼으로 개별 운동 삭제']},
    {icon:'ti-sparkles', color:'#9B59B6', title:'오늘 종합 평가',
     steps:['식단 분석 + 운동 분석이 모두 있을 때 홈에 버튼 표시','AI가 식단·운동을 종합해 오늘 하루 총평 제공','내일을 위한 맞춤 조언도 함께']},
    {icon:'ti-table', color:'#1565C0', title:'기록장 탭',
     steps:['날짜별 식사 사진·분석·운동 기록 확인','홈에서 찍은 사진이 기록장에 자동 저장','엑셀 다운로드 버튼으로 전체 기록 내보내기']},
    {icon:'ti-activity-heartbeat', color:'#E74C3C', title:'컨디션 기록',
     steps:['홈 화면 "오늘의 컨디션 기록" 버튼 탭','체중·혈당·혈압·수면시간 입력 가능','기록 후 홈 화면에 오늘 컨디션 요약 표시']},
    {icon:'ti-message-circle', color:'#2ECC71', title:'AI 코치 탭',
     steps:['"코치" 탭에서 AI에게 자유롭게 질문','식단 추천, 운동 방법, 건강 궁금증 모두 OK','하단 빠른 질문 버튼으로 자주 쓰는 질문 1탭']},
    {icon:'ti-microphone', color:'#E67E22', title:'음성 명령',
     steps:['상단 오른쪽 🎤 마이크 탭 후 말하기','"아침 사진 찍어줘", "기록장 보여줘", "운동 탭 열어줘"','손이 불편할 때 음성으로 모든 기능 제어 가능']},
  ]});

  // 암환자 전용 추가 섹션
  if(ic){
    sections.push({type:'features', title:'🏥 암환자 전용 기능', items:[
      {icon:'ti-activity', color:'#9B59B6', title:'증상 기록 (홈 화면)',
       steps:['통증·배뇨·피로 각각 0~10점 슬라이더','매일 기록하면 변화 추이 파악 가능','10점: 매우 심함, 0점: 전혀 없음']},
      {icon:'ti-pill', color:'#E74C3C', title:'복약 체크 (홈 화면)',
       steps:['등록된 약 목록에서 드신 약 체크','하루 복약률 자동 계산','빠뜨린 약 한눈에 확인']},
      {icon:'ti-chart-line', color:'#1565C0', title:'종양 마커 추적 탭',
       steps:['PSA 등 마커 수치를 날짜별로 기록','추적 탭에서 수치 변화 그래프 확인','검사 직후 바로 입력하는 습관 추천']},
    ]});
  }

  // 팁 섹션
  sections.push({type:'tips-plain', title:'💡 알아두면 좋은 팁', color:'#F59E0B', items:[
    '📶 오프라인에서도 기록 가능 — 연결 복구 시 자동 동기화',
    '🔄 기록은 클라우드(Firestore)에 자동 저장 — 폰을 바꿔도 유지',
    '📊 기록장 → 엑셀 내보내기로 주치의에게 리포트 제출 가능',
    '🖼️ PC 사용 시 식사 사진을 홈 슬롯에 드래그 앤 드롭으로 업로드',
    '🏃 운동은 하루에 여러 개 기록 가능 (조깅 30분 + 수영 40분 등)',
    '🧬 로그인 화면에서 로고를 5번 탭하면 관리자 화면 진입',
  ]});

  // ── 렌더링 ──
  var el = $id('help-body');
  if(!el) return;

  var html = '';

  // 헤더 배너
  html += '<div style="background:linear-gradient(135deg,'+modeColor+','+modeColor+'dd);border-radius:var(--r-md);padding:20px 18px;margin-bottom:12px;">'
    +'<div style="color:rgba(255,255,255,.7);font-size:12px;font-weight:600;letter-spacing:.5px;margin-bottom:4px;">'+esc(modeName)+' 모드</div>'
    +'<div style="color:#fff;font-size:20px;font-weight:800;margin-bottom:2px;">'+esc(u?u.name:'')+'님 가이드</div>'
    +'<div style="color:rgba(255,255,255,.75);font-size:13px;">스마트 메타케어 완전 정복</div>'
    +'</div>';

  // 빠른 시작 3단계
  html += '<div style="background:#fff;border:1px solid var(--bd);border-radius:var(--r-md);padding:16px 18px;margin-bottom:12px;">'
    +'<div style="font-size:14px;font-weight:800;color:var(--navy);margin-bottom:12px;">🚀 빠른 시작 — 오늘 당장 해보세요</div>'
    +'<div style="display:flex;flex-direction:column;gap:10px;">'
    +quickStart.map(function(s){
      return '<div style="display:flex;align-items:flex-start;gap:12px;">'
        +'<div style="width:28px;height:28px;border-radius:50%;background:'+modeColor+';color:#fff;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'+s.num+'</div>'
        +'<div><div style="font-size:14px;font-weight:700;color:var(--navy);margin-bottom:2px;">'+s.emoji+' '+esc(s.title)+'</div>'
        +'<div style="font-size:13px;color:#6B7280;line-height:1.6;">'+esc(s.desc)+'</div></div>'
        +'</div>';
    }).join('')
    +'</div></div>';

  // 섹션 렌더링
  sections.forEach(function(sec){
    if(sec.type==='tips'){
      html += '<div style="background:'+sec.data.color+'12;border:1px solid '+sec.data.color+'33;border-radius:var(--r-md);padding:16px 18px;margin-bottom:12px;">'
        +'<div style="font-size:14px;font-weight:800;color:'+sec.data.color+';margin-bottom:10px;">'+sec.data.icon+' '+esc(sec.data.title)+'</div>'
        +'<ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:8px;">'
        +sec.data.items.map(function(t){
          return '<li style="font-size:13px;color:#374151;line-height:1.7;">'+t+'</li>';
        }).join('')
        +'</ul></div>';
    } else if(sec.type==='features'){
      html += '<div style="font-size:14px;font-weight:800;color:var(--navy);margin:16px 0 8px;">'+esc(sec.title)+'</div>';
      sec.items.forEach(function(item){
        html += '<div style="background:#fff;border:1px solid var(--bd);border-radius:var(--r-md);padding:14px 16px;margin-bottom:8px;">'
          +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
          +'<div style="width:36px;height:36px;border-radius:10px;background:'+item.color+'1a;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
          +'<i class="ti '+item.icon+'" style="font-size:18px;color:'+item.color+';"></i></div>'
          +'<div style="font-size:15px;font-weight:700;color:var(--navy);">'+esc(item.title)+'</div>'
          +'</div>'
          +'<div style="display:flex;flex-direction:column;gap:6px;">'
          +item.steps.map(function(s,i){
            return '<div style="display:flex;align-items:flex-start;gap:8px;">'
              +'<span style="font-size:11px;font-weight:700;color:'+item.color+';background:'+item.color+'18;border-radius:4px;padding:1px 6px;flex-shrink:0;margin-top:1px;">'+(i+1)+'</span>'
              +'<span style="font-size:13px;color:#374151;line-height:1.6;">'+esc(s)+'</span>'
              +'</div>';
          }).join('')
          +'</div></div>';
      });
    } else if(sec.type==='tips-plain'){
      html += '<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:var(--r-md);padding:16px 18px;margin-bottom:12px;">'
        +'<div style="font-size:14px;font-weight:800;color:#92400E;margin-bottom:10px;">'+esc(sec.title)+'</div>'
        +'<div style="display:flex;flex-direction:column;gap:8px;">'
        +sec.items.map(function(t){
          return '<div style="font-size:13px;color:#374151;line-height:1.6;">'+esc(t)+'</div>';
        }).join('')
        +'</div></div>';
    }
  });

  el.innerHTML = html;
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
  if(p==='log'){ _schedSave(); setTimeout(function(){ _xlLoad(); if(USER&&USER.mode==='cancer') _loadSymCards(); }, 100); }
  if(p==='ex'){ _refreshExPage(); }
  if(p==='track'){
    if(USER&&USER.mode==='cancer'){ _initMarkerTrack(); _loadPSAHistory(); _loadSymAvg(); }
    else { _renderWeekStats(); loadAiRec(); }
  }
  if(p==='chat'){ setTimeout(function(){ var cs=$id('chat-scroll'); if(cs) cs.scrollTop=cs.scrollHeight; },100); }
  if(p==='home'){
    _refreshPhotos();
    _refreshCondSummary();
    _refreshHomeAnalysis();
    _refreshHomeExercise();
    _refreshComprehensiveBtn();
    _refreshYesterdayFeedback();
    _refreshHomeProgress();
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

function _refreshHomeProgress(){
  var el=$id('home-progress-items'); if(!el) return;
  var today=todayStr();
  var days=_getRecs();
  var rec=days.find(function(d){return d.date===today;})||{};
  var ic=USER&&USER.mode==='cancer';

  var photos=rec.photos?Object.keys(rec.photos).filter(function(k){return rec.photos[k];}).length:0;
  var hasEx=!!(rec.exercise&&rec.exercise.length);
  var hasCond=!!(rec.cond||rec.weight||rec.glucose);
  // 복약: med_done[today] 에 하나라도 체크된 항목이 있으면 완료
  var medDone=ic?(_getMedDone()[todayStr()]||{}):{};
  var hasMed=ic&&Object.keys(medDone).some(function(k){return medDone[k];});
  var hasSym=ic&&(rec.pain!==undefined||rec.urine!==undefined||rec.fatigue!==undefined);

  function chip(done, label){
    return '<div style="display:flex;align-items:center;gap:5px;padding:6px 10px;border-radius:20px;font-size:12px;font-weight:700;'
      +(done?'background:#D1FAE5;color:#065F46;':'background:#F3F4F6;color:#9CA3AF;')
      +'">'+(done?'✓ ':'')+'<span>'+label+'</span></div>';
  }

  var html='';
  html+=chip(photos>=1, '아침');
  html+=chip(photos>=2, '점심');
  html+=chip(photos>=3, '저녁');
  html+=chip(hasEx, '운동');
  html+=chip(hasCond, '컨디션');
  if(ic){
    html+=chip(hasSym, '증상');
    html+=chip(hasMed, '복약');
  }

  // 달성률 계산
  var total=ic?5:5;
  var done=(photos>=1?1:0)+(photos>=2?1:0)+(photos>=3?1:0)+(hasEx?1:0)+(hasCond?1:0);
  if(ic){ total=7; done+=(hasSym?1:0)+(hasMed?1:0); }
  var pct=Math.round(done/total*100);

  var pctEl=$id('home-progress-pct');
  if(pctEl){ pctEl.textContent=pct+'%'; pctEl.style.color=pct===100?'#059669':'var(--teal)'; }

  el.innerHTML=html;

  // 김창호 계정에만 관리자 메뉴 버튼 표시
  var adminBtn=$id('home-admin-btn');
  if(adminBtn){ adminBtn.style.display=(USER&&localStorage.getItem('mc_is_admin')==='1')?'flex':'none'; }
}

function goBack(){
  var activeScreen = document.querySelector('.screen.active');
  if(!activeScreen) return;
  var id = activeScreen.id;

  if(id==='scr-landing') return;
  if(id==='scr-profile'){ goScreen('scr-landing'); return; }

  if(id==='scr-app'){
    if(_currentPage!=='home'){ goPage('home'); return; }
    // 홈에서 사용자 아이콘 탭 → 로그아웃 확인
    if(!confirm(USER ? (USER.name+'님, 로그아웃 할까요?') : '로그아웃 할까요?')) return;
    try{ localStorage.removeItem('mc_last_user'); }catch(e){}
    USER = null;
    goScreen('scr-profile');
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
  .catch(function(err){
    console.error('API 오류:', err);
    toast('네트워크 오류 - 잠시 후 다시 시도하세요');
    return cb?cb(''):null;
  });
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
  _api({max_tokens:400,messages:msgs,system:'음식 분석 시 첫 줄에 "주요 음식: 음식1, 음식2" 형식으로 인식된 음식명을 먼저 나열해주세요.'}, function(reply){
    var result = reply||'분석 결과를 가져오지 못했어요.';
    ar.innerHTML='<div class="tip-lbl">AI 식단 분석</div>'+esc(result);
    // 인식된 음식명 → food-name 자동 채우기
    if(hasPic && !name){
      var m = result.match(/주요\s*음식[:\s：]+([^\n]+)/);
      if(m){ var fn=$id('food-name'); if(fn) fn.value=m[1].trim(); }
    }
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
  if(!dayRec||!dayRec.analysis){ el.style.display='none'; return; }
  var ana=dayRec.analysis;
  var parts=[];
  var labels={morning:'🌅 아침',lunch:'☀️ 점심',dinner:'🌙 저녁'};
  ['morning','lunch','dinner'].forEach(function(k){
    if(ana[k]) parts.push('<div style="margin-bottom:8px;"><span style="font-size:11px;font-weight:700;color:var(--teal);">'+labels[k]+'</span><div style="margin-top:3px;">'+md(ana[k])+'</div></div>');
  });
  // latest 폴백 제거 - 끼니별 분석만 표시
  if(!parts.length){ el.style.display='none'; return; } // 분석 없으면 숨김
  el.style.display='block';
  el.innerHTML='<div class="tip-lbl"><i class="ti ti-salad" style="font-size:10px;"></i> 오늘의 식단 분석</div>'+parts.join('');
}

var _stepsExTypes  = ['걷기','빠르게 걷기','런닝','등산','계단 오르기'];
var _repsExTypes   = ['윗몸 일으키기','플랭크','푸시업','스쿼트','줄넘기','풀업','턱걸이','버피'];
var _stairsExTypes = ['계단 오르기'];

function _toggleExFields(type){
  var needSteps  = _stepsExTypes.some(function(t){ return type.includes(t); });
  var needReps   = _repsExTypes.some(function(t){ return type.includes(t); });
  var isStairs   = _stairsExTypes.some(function(t){ return type.includes(t); });
  var durWrap=$id('ex-dur-wrap'), repsWrap=$id('ex-reps-wrap'), stepsWrap=$id('ex-steps-wrap');
  if(durWrap)   durWrap.style.display   = needReps ? 'none' : '';
  if(repsWrap)  repsWrap.style.display  = needReps ? ''     : 'none';
  if(stepsWrap) stepsWrap.style.display = needSteps? ''     : 'none';
  var stepsInp=$id('ex-steps');
  if(stepsInp) stepsInp.placeholder = isStairs ? '계단 수' : '걸음 수';
  if(needReps  && $id('ex-dur'))   $id('ex-dur').value='';
  if(!needReps && $id('ex-reps'))  $id('ex-reps').value='';
  if(!needSteps&& stepsInp) stepsInp.value='';
}

function pickExType(type){
  var inp=$id('ex-type'); if(!inp) return;
  inp.value=type;
  document.querySelectorAll('.ex-chip').forEach(function(c){
    c.classList.toggle('active', c.textContent.trim().includes(type));
  });
  _toggleExFields(type);
  // 칩으로 선택 시 텍스트 입력 필드 숨김 (직접 입력 필요 없음)
  inp.style.display = type ? 'none' : '';
}

var _exPendingList = [];

function addExToList(){
  var type=($id('ex-type')||{}).value.trim(); if(!type){ toast('운동 종류를 입력하세요'); return; }
  var dur=($id('ex-dur')||{}).value.trim();
  var reps=($id('ex-reps')||{}).value.trim();
  var steps=($id('ex-steps')||{}).value.trim();
  var memo=($id('ex-memo')||{}).value.trim();
  _exPendingList.push({type:type, dur:dur, reps:reps, steps:steps, memo:memo});
  // 폼 초기화
  if($id('ex-type')) $id('ex-type').value='';
  if($id('ex-dur')) $id('ex-dur').value='';
  if($id('ex-reps')) $id('ex-reps').value='';
  if($id('ex-steps')) $id('ex-steps').value='';
  if($id('ex-memo')) $id('ex-memo').value='';
  document.querySelectorAll('.ex-chip').forEach(function(c){ c.classList.remove('active'); });
  _toggleExFields('');
  _renderExPending();
  toast(type+' 추가됐어요 ✓');
}

function _renderExPending(){
  var wrap=$id('ex-pending-wrap'), list=$id('ex-pending-list'); if(!wrap||!list) return;
  wrap.style.display=_exPendingList.length?'block':'none';
  list.innerHTML=_exPendingList.map(function(ex,i){
    return '<div style="display:flex;align-items:center;gap:8px;background:#fff;border-radius:8px;padding:8px 10px;border:1px solid var(--bd);">'
      +'<div style="flex:1;font-size:13px;font-weight:700;">🏃 '+esc(ex.type)+(ex.reps?' <span style="font-weight:400;color:var(--mu);">· '+esc(ex.reps)+'회</span>':'')+(ex.dur?' <span style="font-weight:400;color:var(--mu);">· '+esc(ex.dur)+'</span>':'')+(ex.steps?' <span style="font-weight:400;color:var(--mu);">· '+esc(ex.steps)+(ex.type==='계단 오르기'?'계단':'보')+'</span>':'')+'</div>'
      +'<button onclick="A.removeExFromList('+i+')" style="background:none;border:none;color:var(--mu);font-size:16px;cursor:pointer;padding:0 4px;">✕</button>'
      +'</div>';
  }).join('');
}

function removeExFromList(i){
  _exPendingList.splice(i,1);
  _renderExPending();
}

function analyzeExAll(){
  if(!KEY){ toast('API 키가 없습니다'); return; }
  if(!_exPendingList.length){ toast('운동을 먼저 추가해주세요'); return; }
  var exDate=normDate(($id('ex-date')||{}).value.trim());
  var ar=$id('ex-result'); if(ar){ ar.style.display='block'; ar.innerHTML='<div class="tip-lbl">AI 운동 분석 중...</div><div class="dots"><span></span><span></span><span></span></div>'; }
  var list=_exPendingList.slice();
  var u=USER, ic=u&&u.mode==='cancer';
  var modeLabel=ic?'암 환자 관점(면역·체력·피로 관리)':({keto:'케토제닉',carnivore:'카니보어',lchf:'저탄고지',diet:'다이어트'}[(u&&u.mode)||'']||'건강 관리')+' 관점(지방 연소·체력·운동 후 식사)';
  var summary=list.map(function(ex){ return ex.type+(ex.reps?' '+ex.reps+'회':'')+(ex.dur?' '+ex.dur:'')+(ex.steps?' '+(ex.type==='계단 오르기'?'계단:':'걸음:')+ex.steps:''); }).join(', ');
  // 오늘 식사 메모 포함
  var todayMealMemo = (function(){
    var fn=$id('food-name'); return fn&&fn.value.trim()||'';
  })();
  var prompt='오늘 운동 기록: '+summary+'.'+(todayMealMemo?' 오늘 식사: '+todayMealMemo+'.':'')+' '+modeLabel+'에서 전체 평가를 3~4문장으로 해주세요.';
  _api({max_tokens:400,messages:[{role:'user',content:prompt}]}, function(reply){
    var result=reply||'분석 결과를 가져오지 못했어요.';
    var mealTag = todayMealMemo ? '<div style="font-size:11px;color:var(--teal);margin-bottom:6px;">🍽 식사 메모: '+esc(todayMealMemo)+'</div>' : '';
    if(ar) ar.innerHTML='<div class="tip-lbl">AI 운동 분석</div>'+mealTag+md(result);
    // 한 번에 모두 저장 (중복 _xlLoad 방지)
    var days=_getRecs();
    var dayRec=days.find(function(d){return d.date===exDate;});
    if(!dayRec){ dayRec={date:exDate,photos:{},steps:''}; days.push(dayRec); days.sort(function(a,b){return a.date<b.date?-1:1;}); }
    if(!dayRec.exercise) dayRec.exercise=[];
    list.forEach(function(ex){
      dayRec.exercise.push({type:ex.type,dur:ex.dur,reps:ex.reps,steps:ex.steps,memo:ex.memo,analysis:result,ts:Date.now()});
      if(ex.steps) dayRec.steps=ex.steps;
    });
    _setRecs(days);
    _exPendingList=[];
    _renderExPending();
    _refreshHomeExercise();
    _refreshComprehensiveBtn();
    _xlLoad();
    _refreshExPage();
    toast('운동 '+list.length+'개 저장됐어요 ✓');
  });
}

function analyzeEx(){
  if(!KEY){ toast('API 키가 없습니다'); return; }
  var type=$id('ex-type').value.trim(); if(!type){ toast('운동 종류를 입력하세요'); return; }
  var dur=$id('ex-dur').value.trim();
  var steps=$id('ex-steps')?$id('ex-steps').value.trim():'';
  var memo=$id('ex-memo')?$id('ex-memo').value.trim():'';
  var ar=$id('ex-result')||$id('ai-result');
  if(!ar){ toast('운동 결과 표시 영역을 찾을 수 없습니다'); return; }
  ar.style.display='block';
  ar.innerHTML='<div class="tip-lbl">AI 운동 분석</div><div class="dots"><span></span><span></span><span></span></div>';
  var u=USER, ic=u&&u.mode==='cancer';
  var p='"'+type+'"'+(dur?' '+dur:'')+(steps?' 걸음수:'+steps:'')+' ';
  p+=ic?'암 환자 관점에서(면역 기능, 체력 유지, 피로 관리) 분석해 주세요. 3~4문장.':
    (u&&u.mode?({keto:'케토제닉',carnivore:'카니보어',lchf:'저탄고지',diet:'다이어트'}[u.mode]||''):'')+' 식단 관점에서(지방 연소, 체력, 운동 후 식사 주의사항) 분석해 주세요. 3~4문장.';
  var exDateEl=$id('ex-date');
  var exDate = normDate(exDateEl&&exDateEl.value.trim());
  _api({max_tokens:350,messages:[{role:'user',content:p}]}, function(reply){
    var result=reply||'분석 결과를 가져오지 못했어요.';
    ar.innerHTML='<div class="tip-lbl">AI 운동 분석</div>'+md(result);
    _saveExerciseResult(type, dur, steps, memo, result, exDate);
  });
}

function _saveExerciseResult(type, dur, steps, memo, analysis, targetDate){
  var today=targetDate||todayStr();
  var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===today;});
  if(!dayRec){ dayRec={date:today,photos:{},steps:''}; days.push(dayRec); days.sort(function(a,b){return a.date<b.date?-1:1;}); }
  // 기존 배열에 추가 (여러 운동 지원)
  if(!dayRec.exercise) dayRec.exercise=[];
  dayRec.exercise.push({type:type,dur:dur,steps:steps,memo:memo,analysis:analysis,ts:Date.now()});
  // 걸음 수를 steps 필드에도 저장 (마지막 입력값 우선)
  if(steps) dayRec.steps=steps;
  _setRecs(days);
  _refreshHomeExercise();
  _refreshComprehensiveBtn();
  // 기록장 카드 업데이트
  _xlLoad();
  // 폼 초기화 (다음 운동 바로 입력 가능)
  if($id('ex-type')) $id('ex-type').value='';
  if($id('ex-dur')) $id('ex-dur').value='';
  if($id('ex-steps')) $id('ex-steps').value='';
  if($id('ex-memo')) $id('ex-memo').value='';
  document.querySelectorAll('.ex-chip').forEach(function(c){ c.classList.remove('active'); });
  var ar=$id('ex-result'); if(ar) ar.style.display='none';
  _refreshExPage();
  // 기록장에서 왔으면 기록장으로 돌아가기
  if(_exFromLog){ _exFromLog=null; setTimeout(function(){ goPage('log'); },300); }
  toast('운동 기록이 저장됐어요 ✓');
}

function _refreshHomeExercise(){
  var el=$id('home-exercise-result'); if(!el) return;
  var today=todayStr();
  var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===today;});
  if(dayRec&&dayRec.exercise&&dayRec.exercise.length){
    var exList=dayRec.exercise;
    el.style.display='block';
    var html='<div class="tip-lbl"><i class="ti ti-run" style="font-size:10px;"></i> 운동 분석 ('+exList.length+'개)</div>';
    exList.forEach(function(ex,i){
      html+=(i>0?'<div style="border-top:1px solid var(--bd);margin:6px 0;"></div>':'')
        +'<div style="font-size:11px;font-weight:700;margin-bottom:2px;">🏃 '+esc(ex.type)+(ex.dur?' · '+esc(ex.dur):'')+'</div>'
        +(ex.analysis?'<div style="font-size:11px;">'+esc(ex.analysis)+'</div>':'');
    });
    el.innerHTML=html;

  } else {
    el.style.display='none';
  }
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
// Storage URL → base64 변환 (CORS 우회)
function _urlToBase64(url, cb){
  var img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function(){
    var c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    try{
      cb(c.toDataURL('image/jpeg', 0.8));
    }catch(e){
      // CORS 여전히 막히면 img src 직접 전달
      console.warn('canvas CORS 실패, img 직접 사용');
      cb(null);
    }
  };
  img.onerror = function(){ cb(null); };
  img.src = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
}

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
var _pendingImg = null; // 사진 데이터 임시 보관 (메모 입력 전)
var _pendingImgMeal = null;

function onFile(e,src){
  var f=e.target.files[0]; e.target.value=''; if(!f) return;
  var meal = _pendingMeal; _pendingMeal = null;
  var mealName = {morning:'🌅 아침', lunch:'☀️ 점심', dinner:'🌙 저녁'}[meal] || '식사';
  var r=new FileReader(); r.onload=function(ev){ _compress(ev.target.result,function(small){
    // 사진 데이터 임시 저장
    _pendingImg = small;
    _pendingImgMeal = meal;
    // 메모 입력 시트 표시
    var thumb=$id('sh-memo-thumb');
    if(thumb){ thumb.innerHTML='<img src="'+small+'" style="width:100%;height:100%;object-fit:cover;">'; }
    var titleEl=$id('sh-memo-title');
    if(titleEl) titleEl.textContent = mealName + ' 메모';
    var memoEl=$id('sh-memo-text');
    if(memoEl){ memoEl.value=''; setTimeout(function(){ memoEl.focus(); },300); }
    openSheet('sh-meal-memo');
  }); }; r.readAsDataURL(f);
}



function _autoSavePhotoToLog(imgData, forceMeal, note){
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
  // 메모 저장
  if(note){
    if(!dayRec.mealNotes) dayRec.mealNotes={};
    dayRec.mealNotes[meal]=note;
  }

  // Storage에 업로드
  var path = 'photos/'+USER.id+'/'+today+'_'+meal+'_'+Date.now()+'.jpg';
  var ref = _storage.ref(path);
  var byteStr = atob(imgData.split(',')[1]);
  var ab = new ArrayBuffer(byteStr.length);
  var ia = new Uint8Array(ab);
  for(var i=0;i<byteStr.length;i++) ia[i]=byteStr.charCodeAt(i);
  var blob = new Blob([ab],{type:'image/jpeg'});

  var mealNameForAI = {morning:'아침', lunch:'점심', dinner:'저녁'}[meal] || meal;
  ref.put(blob).then(function(){ return ref.getDownloadURL(); }).then(function(url){
    dayRec.photos[meal] = url;
    _setRecs(recs);
    _refreshPhotos(); _refreshStats();
    _xlLoad(); // 기록장 카드 DOM 업데이트
    toast(mealNameForAI+' 사진 저장됐어요 ✓');
    _analyzeHomeMeal(imgData, mealNameForAI, note);
  }).catch(function(err){
    console.error('Storage 업로드 실패:', err);
    toast('사진 업로드 실패 - 네트워크를 확인하고 다시 시도하세요');
    // base64를 Firestore에 저장하지 않음 (용량 초과 방지)
  });
}

function pickMeal(src){
  var note=$id('sh-meal-note'); if(note) note.value='';
  closeSheet('sh-meal'); $id('f-meal-'+src).value=''; $id('f-meal-'+src).click();
}
function onMealFile(e,src){
  var f=e.target.files[0]; e.target.value=''; if(!f) return;
  var r=new FileReader(); r.onload=function(ev){ _compress(ev.target.result,function(small){
    if(!_pendMeal) return;
    var p=_pendMeal; _pendMeal=null;
    var card=$id(p.cardId); if(!card) return;
    var slot=card.querySelector('[data-meal="'+p.meal+'"]'); if(!slot) return;
    var dateVal = card.querySelector('.day-date').value;
    var mealName={morning:'🌅 아침',lunch:'☀️ 점심',dinner:'🌙 저녁'}[p.meal]||p.meal;

    // 메모 입력 시트 열기 (홈과 동일)
    _pendingImg = small;
    _pendingImgMeal = p.meal;
    _pendingLogCtx = {cardId:p.cardId, slot:slot, dateVal:dateVal};
    var thumb=$id('sh-memo-thumb');
    if(thumb) thumb.innerHTML='<img src="'+small+'" style="width:100%;height:100%;object-fit:cover;">';
    var titleEl=$id('sh-memo-title');
    if(titleEl) titleEl.textContent = mealName + ' 메모';
    var memoEl=$id('sh-memo-text');
    // 기존 메모 로드
    var days=_getRecs();
    var dayRec=days.find(function(d){return d.date===dateVal;});
    var existNote=dayRec&&dayRec.mealNotes?(dayRec.mealNotes[p.meal]||''):'';
    if(memoEl){ memoEl.value=existNote; setTimeout(function(){ memoEl.focus(); },300); }
    openSheet('sh-meal-memo');
  }); }; r.readAsDataURL(f);
}

var _pendingLogCtx = null; // 기록장에서 사진 저장 컨텍스트

function saveMealWithMemo(){
  var img = _pendingImg; var meal = _pendingImgMeal;
  var logCtx = _pendingLogCtx;
  _pendingImg = null; _pendingImgMeal = null; _pendingLogCtx = null;
  var memoEl=$id('sh-memo-text');
  var note = memoEl ? memoEl.value.trim() : '';
  closeSheet('sh-meal-memo');

  if(!img) return;

  // 기록장에서 온 경우
  if(logCtx){
    var card=$id(logCtx.cardId); if(!card) return;
    var slot=logCtx.slot||card.querySelector('[data-meal="'+meal+'"]'); if(!slot) return;
    var dateVal=logCtx.dateVal;
    var mealName={morning:'아침',lunch:'점심',dinner:'저녁'}[meal]||meal;
    // 메모 저장
    if(note){
      var days=_getRecs();
      var dayRec=days.find(function(d){return d.date===dateVal;});
      if(!dayRec){ dayRec={date:dateVal,photos:{},steps:''}; days.push(dayRec); }
      if(!dayRec.mealNotes) dayRec.mealNotes={};
      dayRec.mealNotes[meal]=note;
      _setRecs(days);
      var na=card.querySelector('[data-note-cardid]');
      if(na){ var allN=Object.values(dayRec.mealNotes).filter(Boolean).join(' / '); na.value=allN; }
    }
    // Storage 업로드
    var path='photos/'+USER.id+'/'+logCtx.cardId+'_'+meal+'_'+Date.now()+'.jpg';
    var ref=_storage.ref(path);
    var byteStr=atob(img.split(',')[1]);
    var ab=new ArrayBuffer(byteStr.length);
    var ia=new Uint8Array(ab);
    for(var i=0;i<byteStr.length;i++) ia[i]=byteStr.charCodeAt(i);
    var blob=new Blob([ab],{type:'image/jpeg'});
    toast('업로드 중...');
    ref.put(blob).then(function(){ return ref.getDownloadURL(); }).then(function(url){
      _saveRot(logCtx.cardId,meal,0); _renderFilled(slot,url,0); _schedSave(); _refreshPhotos();
      toast(mealName+' 사진 저장됐어요 ✓');
      // AI 분석 자동 실행
      var mealNameFull={morning:'🌅 아침',lunch:'☀️ 점심',dinner:'🌙 저녁'}[meal]||meal;
      _analyzeLogMeal(img, mealNameFull, note, dateVal, meal);
    }).catch(function(err){
      console.error('Storage 업로드 실패:', err);
      toast('사진 업로드 실패 - 네트워크를 확인하세요');
    });
    return;
  }

  // 홈에서 온 경우
  _autoSavePhotoToLog(img, meal, note);
}

// 기록장 전용 AI 분석
function _analyzeLogMeal(imgData, mealName, note, dateVal, mealKey){
  if(!KEY) return;
  toast('AI 분석 중...');
  var mode=USER?USER.mode:'lchf';
  var modeDesc={keto:'케토제닉(탄수화물 20g 이하)',carnivore:'카니보어(동물성 식품)',lchf:'저탄고지(탄수화물 100g 이하)',diet:'균형 건강식',cancer:'암 환자 항산화 식단'}[mode]||mode;
  var prompt='['+mealName+' 식사 사진] '+modeDesc+' 관점에서 분석해주세요.';
  if(note) prompt+=' 사용자 메모: "'+note+'"';
  prompt+=' 주요 음식명, 적합도, 개선 제안을 2~3문장으로 간결하게.';
  _api({max_tokens:300,messages:[{role:'user',content:[
    {type:'image',source:{type:'base64',media_type:'image/jpeg',data:imgData.split(',')[1]}},
    {type:'text',text:prompt}
  ]}]}, function(reply){
    if(!reply) return;
    var days=_getRecs();
    var dayRec=days.find(function(d){return d.date===dateVal;});
    if(!dayRec) return;
    if(!dayRec.analysis) dayRec.analysis={};
    dayRec.analysis[mealKey]=reply;
    if(dateVal===todayStr()) dayRec.analysis.latest=reply;
    _setRecs(days);
    toast('분석 완료 ✓');
    if(dateVal===todayStr()) _refreshHomeAnalysis();
  });
}

/* ── 식단 기록장 ── */
function _getRecs(){ return ugj('records',[]); }
function _setRecs(d){
  if(!Array.isArray(d)){ console.error('🚨 _setRecs: 배열이 아닌 값 저장 차단'); return; }
  var existing = ugj('records',[]);
  if(existing.length > 3 && d.length === 0){
    console.error('🚨 _setRecs: 빈 배열 저장 차단 (기존:', existing.length, '개)');
    toast('⚠️ 데이터 저장 오류 - 관리자에게 문의하세요');
    return;
  }
  if(existing.length > 5 && d.length < existing.length * 0.5){
    console.warn('⚠️ _setRecs: 데이터 급감 감지 ('+existing.length+'→'+d.length+')');
  }
  // base64 자동 제거
  d.forEach(function(rec){
    if(!rec||!rec.photos) return;
    Object.keys(rec.photos).forEach(function(meal){
      if(rec.photos[meal]&&rec.photos[meal].startsWith('data:image')){
        console.warn('🧹 base64 자동 제거:', rec.date, meal);
        delete rec.photos[meal];
      }
    });
  });
  usj('records', d);
  // 컬렉션에도 저장 (이중 저장으로 안전성 확보)
  if(USER) _saveRecsCloud(USER.id, d);
  _schedSafetyBackup();
}

var _safetyBackupTimer = null;
function _schedSafetyBackup(){
  if(_safetyBackupTimer) clearTimeout(_safetyBackupTimer);
  _safetyBackupTimer = setTimeout(function(){
    try{
      if(!USER) return;
      var recs = ugj('records',[]);
      if(!recs.length) return;
      // 컬렉션에 저장 (이미 _saveRecsCloud가 즉시 저장하므로 여기서는 백업용)
      var backupDoc = _db.collection('users').doc(USER.id).collection('data').doc('records_backup');
      backupDoc.set({
        records: JSON.stringify(recs),
        ts: Date.now(),
        date: todayStr(),
        count: recs.length
      }).then(function(){ console.log('✅ 안전 백업 저장:', recs.length+'개'); })
        .catch(function(e){ console.error('안전 백업 실패:', e); });
    }catch(e){ console.error('안전 백업 오류:', e); }
  }, 1800000); // 30분
}

function addLogDay(){
  var days=_getRecs();
  // 날짜 선택 (기본값: 오늘)
  var dateInput=prompt('추가할 날짜를 입력하세요 (YYYY-MM-DD)', todayStr());
  if(!dateInput) return;
  // 형식 검사
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)){ toast('날짜 형식이 올바르지 않아요 (YYYY-MM-DD)'); return; }
  // 중복 확인
  if(days.find(function(d){return d.date===dateInput;})){ toast('이미 있는 날짜예요'); return; }
  // 추가 후 날짜순 정렬
  days.push({date:dateInput,photos:{},steps:''});
  days.sort(function(a,b){ return a.date<b.date?-1:a.date>b.date?1:0; });
  _setRecs(days);
  // 기록장 새로고침 후 해당 카드로 스크롤
  _xlLoad();
  setTimeout(function(){
    var cards=document.querySelectorAll('.day-date');
    cards.forEach(function(el){
      if(el.value===dateInput){
        el.closest('.day-card').scrollIntoView({behavior:'smooth',block:'start'});
      }
    });
  }, 200);
}

function _makeCard(d){
  _cardSeq++;
  var id='card-'+_cardSeq;
  var card=document.createElement('div'); card.className='day-card'; card.id=id;
  var hd=document.createElement('div'); hd.className='day-hd';
  var di=document.createElement('input'); di.className='day-date'; di.type='text'; di.value=d.date||''; di.placeholder='날짜'; di.addEventListener('input',_schedSave);
  var del=document.createElement('button'); del.className='day-del'; del.innerHTML='<i class="ti ti-trash"></i>'; del.addEventListener('click',function(){_delCard(card);});
  hd.appendChild(di); hd.appendChild(del); card.appendChild(hd);

  // 식사 사진 3칸
  var grid=document.createElement('div'); grid.className='meal-grid';
  ['morning','lunch','dinner'].forEach(function(meal){ var slot=document.createElement('div'); slot.setAttribute('data-meal',meal); grid.appendChild(slot); });
  card.appendChild(grid);

  // 걸음수 제거 (불필요)

  // 운동 기록 섹션
  var ex = d.exercise && d.exercise.length ? d.exercise[d.exercise.length-1] : null;
  var exRow=document.createElement('div');
  exRow.className='steps-row'; exRow.style.borderTop='1px solid var(--bd)';
  exRow.setAttribute('data-ex-cardid', id);
  var exLbl=document.createElement('span'); exLbl.className='steps-lbl';
  exLbl.innerHTML='<i class="ti ti-run" style="color:var(--warn);"></i>운동';
  var exVal=document.createElement('div'); exVal.style.cssText='flex:1;font-size:12px;color:var(--mu);';
  exVal.setAttribute('data-ex-val','1');
  if(ex){
    exVal.innerHTML='<span style="color:var(--navy);font-weight:600;">'+esc(ex.type)+(ex.dur?' · '+esc(ex.dur):'')+'</span>';
  } else {
    exVal.innerHTML='<span style="color:var(--mu);">기록 없음</span>';
  }
  var exBtn=document.createElement('button');
  exBtn.style.cssText='padding:5px 10px;background:var(--warn);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;';
  exBtn.textContent = ex ? '수정' : '기록';
  exBtn.onclick = function(){ _openExerciseSheet(id, d.date); };
  exRow.appendChild(exLbl); exRow.appendChild(exVal); exRow.appendChild(exBtn);
  card.appendChild(exRow);

  card.querySelectorAll('[data-meal]').forEach(function(slot){ var meal=slot.getAttribute('data-meal'),photo=d.photos?d.photos[meal]:null; if(photo) _renderFilled(slot,photo,_loadRot(id,meal)); else _renderEmpty(slot); });

  // 식사 메모 영역 (기록장)
  var noteRow=document.createElement('div'); noteRow.className='meal-note-row';
  var noteLbl=document.createElement('div'); noteLbl.style.cssText='font-size:11px;font-weight:700;color:var(--mu2);margin-bottom:5px;text-transform:uppercase;letter-spacing:.3px;'; noteLbl.textContent='식사 메모';
  var noteArea=document.createElement('textarea'); noteArea.className='meal-note-inp'; noteArea.rows=2;
  noteArea.placeholder='아침/점심/저녁 식사 내용을 간단히 적어두세요 (예: 닭가슴살 샐러드, 현미밥 반공기)';
  noteArea.setAttribute('data-note-cardid', id);
  var existNotes = d.mealNotes ? Object.values(d.mealNotes).filter(Boolean).join(' / ') : '';
  noteArea.value = existNotes || (d.mealNote||'');
  noteArea.addEventListener('input', _schedSave);
  noteRow.appendChild(noteLbl); noteRow.appendChild(noteArea);
  card.appendChild(noteRow);

  return card;
}

function _openExerciseSheet(cardId, date){
  // 기존 운동 데이터 불러오기
  var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===date;});
  var ex = dayRec&&dayRec.exercise&&dayRec.exercise.length ? dayRec.exercise[dayRec.exercise.length-1] : null;

  // 식단 탭 운동 폼으로 이동
  goPage('ex');
  setTimeout(function(){
    var dateEl=$id('ex-date'); if(dateEl) dateEl.value=date;
    var typeEl=$id('ex-type'); if(typeEl) typeEl.value=ex?ex.type:'';
    var durEl=$id('ex-dur'); if(durEl) durEl.value=ex?ex.dur:'';
    var memoEl=$id('ex-memo'); if(memoEl) memoEl.value=ex?ex.memo:'';
    _exFromLog={cardId:cardId, date:date};
  }, 200);
}

var _exFromLog = null;

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

function _openMealSheet(cardId,meal){
  _pendMeal={cardId:cardId,meal:meal};
  var lm={morning:'아침',lunch:'점심',dinner:'저녁'};
  $id('sh-meal-title').textContent=(lm[meal]||meal)+' 사진 선택';
  // 기록장에서 기존 메모 로드
  var days=_getRecs();
  var card=$id(cardId);
  var dateVal = card ? card.querySelector('.day-date').value : '';
  var dayRec = days.find(function(d){return d.date===dateVal;});
  var existNote = dayRec&&dayRec.mealNotes ? (dayRec.mealNotes[meal]||'') : '';
  var noteEl=$id('sh-meal-note'); if(noteEl) noteEl.value=existNote;
  openSheet('sh-meal');
}

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
    var noteArea = card.querySelector('[data-note-cardid]');
    var mealNote = noteArea ? noteArea.value.trim() : '';
    var rec = {date:dateVal, steps:card.querySelector('.steps-in').value, photos:photos};
    if(mealNote) rec.mealNote = mealNote;
    if(existing&&existing.analysis) rec.analysis=existing.analysis;
    if(existing&&existing.exercise) rec.exercise=existing.exercise;
    if(existing&&existing.comprehensive) rec.comprehensive=existing.comprehensive;
    if(existing&&existing.condRecs) rec.condRecs=existing.condRecs;
    if(existing&&existing.mealNotes) rec.mealNotes=existing.mealNotes;
    days.push(rec);
  });
  _setRecs(days); _showAutosave(); _refreshPhotos(); _refreshStats();
}

function _xlLoad(){
  var days=_getRecs();
  // 날짜 형식 보정 (YYYYMMDD → YYYY-MM-DD)
  days.forEach(function(d){ if(d&&d.date) d.date=normDate(d.date); });
  // 중복 날짜 제거 (데이터 많은 쪽 병합)
  var merged={};
  days.forEach(function(d){
    if(!d||!d.date) return;
    if(!merged[d.date]){
      merged[d.date]=d;
    } else {
      var a=merged[d.date];
      // photos 병합
      if(d.photos) a.photos=Object.assign({},d.photos,a.photos);
      // exercise 병합 (중복 ts 제거)
      if(d.exercise&&d.exercise.length){
        if(!a.exercise) a.exercise=[];
        var tss=a.exercise.map(function(e){return e.ts;});
        d.exercise.forEach(function(e){ if(!tss.includes(e.ts)) a.exercise.push(e); });
      }
      // analysis 병합
      if(d.analysis&&!a.analysis) a.analysis=d.analysis;
      if(d.steps&&!a.steps) a.steps=d.steps;
    }
  });
  days=Object.keys(merged).sort().map(function(k){return merged[k];});

  // 오늘 날짜 없으면 자동 추가
  var today=todayStr();
  if(!merged[today]){
    days.push({date:today,photos:{},steps:''});
  }
  // 날짜순 정렬
  days.sort(function(a,b){ return a.date<b.date?-1:a.date>b.date?1:0; });
  // 중복 제거된 결과를 저장 (Firestore에도 반영)
  _setRecs(days);

  var c=$id('log-cards'); c.innerHTML=''; _cardSeq=0;
  $id('log-empty').style.display='none';
  days.forEach(function(d){ c.appendChild(_makeCard(d)); });
  // 맨 아래(오늘)로 자동 스크롤
  var pages=$id('pages'); if(pages) setTimeout(function(){ pages.scrollTop=pages.scrollHeight; },50);
}

function exportExcel(){
  var days=_getRecs(); if(!days.length){toast('기록이 없습니다');return;}
  
  // 식단 + 운동 시트
  var aoa=[['스마트 메타케어 건강 일지'],[],
    ['날짜','아침','점심','저녁','걸음수','운동종류','운동시간','식단분석요약']];
  days.forEach(function(d){
    var ex=d.exercise&&d.exercise.length?d.exercise[d.exercise.length-1]:null;
    var analysis=d.analysis&&d.analysis.latest?d.analysis.latest.replace(/#+\s/g,'').substring(0,100):'';
    aoa.push([
      d.date,
      d.photos&&d.photos.morning?'✓':'',
      d.photos&&d.photos.lunch?'✓':'',
      d.photos&&d.photos.dinner?'✓':'',
      d.steps||'',
      ex?ex.type:'',
      ex?ex.dur:'',
      analysis
    ]);
  });

  // 컨디션 시트
  var condRecs=_getCondRecs();
  var aoa2=[['컨디션 기록'],[],
    ['날짜','몸상태','체중(kg)','혈당','혈압(수축)','혈압(이완)','수면(시간)','메모']];
  condRecs.forEach(function(c){
    aoa2.push([c.date,c.state||'',c.weight||'',c.glucose||'',c.bpSys||'',c.bpDia||'',c.sleep||'',c.memo||'']);
  });

  var wb=XLSX.utils.book_new();
  var ws1=XLSX.utils.aoa_to_sheet(aoa);
  ws1['!cols']=[{wch:14},{wch:6},{wch:6},{wch:6},{wch:10},{wch:16},{wch:10},{wch:40}];
  XLSX.utils.book_append_sheet(wb,ws1,'식단·운동');

  if(condRecs.length){
    var ws2=XLSX.utils.aoa_to_sheet(aoa2);
    ws2['!cols']=[{wch:14},{wch:10},{wch:8},{wch:8},{wch:10},{wch:10},{wch:8},{wch:20}];
    XLSX.utils.book_append_sheet(wb,ws2,'컨디션');
  }

  if(USER&&USER.mode==='cancer'){
    var symData=_getSym(),psaData=_getPSA(),medData=_getMeds();
    var aoa3=[['증상 기록'],[],['날짜','통증','배뇨','피로','메모']];
    Object.keys(symData).sort().forEach(function(date){ var d=symData[date]; aoa3.push([date,d.pain!==undefined?d.pain:'',d.urine!==undefined?d.urine:'',d.fatigue!==undefined?d.fatigue:'',d.memo||'']); });
    var ws3=XLSX.utils.aoa_to_sheet(aoa3);
    XLSX.utils.book_append_sheet(wb,ws3,'증상');
    if(psaData.length){
      var aoa4=[['마커 기록'],[],['날짜','수치','메모']];
      psaData.forEach(function(p){ aoa4.push([p.date,p.v,p.note||'']); });
      XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa4),'마커');
    }
  }

  XLSX.writeFile(wb,'metacare_'+todayStr()+'.xlsx');
  toast('엑셀 저장 완료!');
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
      var ov=document.createElement('div');
      ov.style.cssText='position:absolute;inset:0;background:rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center;pointer-events:none;border-radius:var(--r-md);';
      ov.innerHTML='<i class="ti ti-zoom-in" style="font-size:22px;color:#fff;opacity:.85;"></i>';
      el.innerHTML='<img src="'+photo+'" alt="'+meal+'" style="width:100%;height:100%;object-fit:cover;display:block;">';
      el.appendChild(ov);
      el.style.position='relative';
    } else {
      el.innerHTML='<i class="ti ti-camera" style="font-size:40px;color:#fff;"></i>';
      el.style.position='';
    }
  });
  _refreshHomeProgress();
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
  // 분석 내용 표시
  var dateVal = card.querySelector('.day-date') ? card.querySelector('.day-date').value : '';
  var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===dateVal;});
  // 키 변환 (morning↔breakfast 모두 시도)
  var altMeal = {morning:'breakfast',breakfast:'morning',lunch:'lunch',dinner:'dinner'}[meal]||meal;
  var ana = '';
  if(dayRec&&dayRec.analysis){
    // 해당 끼니 분석만 표시 (latest는 폴백 안 함 - 다른 끼니 내용 섞임 방지)
    ana = dayRec.analysis[meal]||dayRec.analysis[altMeal]||'';
  }
  var note = dayRec&&dayRec.mealNotes ? (dayRec.mealNotes[meal]||dayRec.mealNotes[altMeal]||'') : '';
  var infoEl=$id('viewer-analysis');
  if(infoEl){
    var txt='';
    if(note) txt+='<div style="font-size:12px;color:rgba(255,255,255,.6);margin-bottom:4px;">📝 '+esc(note)+'</div>';
    if(ana)  txt+='<div style="font-size:12px;color:rgba(255,255,255,.85);line-height:1.7;">'+md(ana)+'</div>';
    else txt+='<div style="font-size:12px;color:rgba(255,255,255,.45);">AI 분석 없음 — AI분석 버튼을 눌러주세요</div>';
    infoEl.style.display='block';
    infoEl.innerHTML=txt;
  }
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
function vAnalyze(){
  if(!_vCtx){ toast('뷰어가 열려있지 않습니다'); return; }
  if(!KEY){ toast('API 키가 없습니다'); return; }
  var card=$id(_vCtx.cid); if(!card) return;
  var dateVal=card.querySelector('.day-date')?card.querySelector('.day-date').value:'';
  var meal=_vCtx.meal;
  var mealName={morning:'🌅 아침',lunch:'☀️ 점심',dinner:'🌙 저녁'}[meal]||meal;
  var photoUrl=$id('viewer-img').src;
  if(!photoUrl){ toast('사진이 없습니다'); return; }
  var infoEl=$id('viewer-analysis');
  if(infoEl) infoEl.innerHTML='<div class="dots"><span></span><span></span><span></span></div>';
  toast('분석 중...');
  _urlToBase64(photoUrl, function(dataUrl){
    if(!dataUrl){ toast('사진을 분석할 수 없습니다 (CORS). Firebase Storage CORS 설정이 필요합니다'); return; }
    (function(){
      var base64=dataUrl.split(',')[1];
      var mode=USER?USER.mode:'lchf';
      var modeDesc={keto:'케토제닉(탄수화물 20g 이하)',carnivore:'카니보어(동물성 식품)',lchf:'저탄고지(탄수화물 100g 이하)',diet:'균형 건강식',cancer:'암 환자 항산화 식단'}[mode]||mode;
      var days=_getRecs();
      var dayRec=days.find(function(d){return d.date===dateVal;});
      var note=dayRec&&dayRec.mealNotes?(dayRec.mealNotes[meal]||''):'';
      var prompt='['+mealName+' 식사 사진] '+modeDesc+' 관점에서 분석해주세요.';
      if(note) prompt+=' 사용자 메모: "'+note+'"';
      prompt+=' 주요 음식명, 적합도, 개선 제안을 2~3문장으로.';
      _api({max_tokens:300,messages:[{role:'user',content:[
        {type:'image',source:{type:'base64',media_type:'image/jpeg',data:base64}},
        {type:'text',text:prompt}
      ]}]},function(reply){
        if(!reply){ if(infoEl) infoEl.innerHTML='<div style="font-size:12px;color:rgba(255,255,255,.45);">분석 실패 - 다시 시도하세요</div>'; return; }
        if(!dayRec) { dayRec={date:dateVal,photos:{},steps:''}; days.push(dayRec); }
        if(!dayRec.analysis) dayRec.analysis={};
        dayRec.analysis[meal]=reply;
        dayRec.analysis.latest=reply;
        _setRecs(days);
        if(infoEl) infoEl.innerHTML='<div style="font-size:12px;color:rgba(255,255,255,.85);line-height:1.7;">'+md(reply)+'</div>';
        toast('분석 완료 ✓');
        _refreshHomeAnalysis();
      });
    })();
  });
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
    // 기존 방문자(mc_last_user 있음)는 로그인 화면으로, 첫 방문자는 랜딩으로
    var firstScr = localStorage.getItem('mc_last_user') ? 'scr-profile' : 'scr-landing';
    $id(firstScr).classList.add('active');
    _navStack.push({type:'screen',id:firstScr});
    try{ history.replaceState({navIdx:0}, '', '#'+firstScr); }catch(e){}
  }
});

/* ── 컨디션 빠른 팝업 ── */
var _quickCondState = '';

function openQuickCond(){
  _quickCondState = '';
  var today = todayStr();
  var recs = _getCondRecs();
  var todayRec = recs.find(function(r){ return r.date===today; });
  if(todayRec && todayRec.state) _quickCondState = todayRec.state;
  var el=$id('qc-date'); if(el) el.textContent = today;
  ['good','normal','bad'].forEach(function(s){
    var b=$id('qc-'+s); if(!b) return;
    var sel = _quickCondState===s;
    b.style.border = sel ? '2px solid var(--teal)' : '2px solid #eee';
    b.style.background = sel ? 'rgba(25,184,155,.1)' : '#f9f9f9';
  });
  var popup=$id('sh-condition-quick');
  if(popup){ popup.style.display='flex'; }
}

function quickCondPick(s){
  _quickCondState = s;
  ['good','normal','bad'].forEach(function(st){
    var b=$id('qc-'+st); if(!b) return;
    var sel = st===s;
    b.style.border = sel ? '2px solid var(--teal)' : '2px solid #eee';
    b.style.background = sel ? 'rgba(25,184,155,.1)' : '#f9f9f9';
  });
}

function closeQuickCond(){
  var popup=$id('sh-condition-quick'); if(popup) popup.style.display='none';
}

function saveQuickCond(){
  if(!_quickCondState){ toast('상태를 선택해주세요'); return; }
  var today = todayStr();
  var recs = _getCondRecs();
  var idx = recs.findIndex(function(r){ return r.date===today; });
  var rec = idx>=0 ? recs[idx] : {date:today, ts:Date.now()};
  rec.state = _quickCondState;
  rec.ts = Date.now();
  if(idx>=0) recs[idx]=rec; else recs.push(rec);
  _setCondRecs(recs);
  closeQuickCond();
  _refreshCondSummary();
  _refreshHomeProgress();
  toast('컨디션이 저장됐어요 ✓');
}

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
  _refreshHomeProgress();
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

function restoreCloudBackup(){
  if(!USER){ toast('로그인 필요'); return; }
  if(!confirm('클라우드 백업으로 복원하시겠습니까?\n현재 데이터가 교체됩니다.')) return;
  _db.collection('backups').doc(USER.id).get().then(function(doc){
    if(!doc.exists){ toast('클라우드 백업이 없습니다'); return; }
    var d=doc.data();
    if(!d.records){ toast('백업 데이터가 손상됐습니다'); return; }
    try{
      var recs=JSON.parse(d.records);
      usj('records', recs);
      toast('✅ 클라우드 백업 복원 완료 ('+recs.length+'일치). 앱을 새로고침하세요.');
      setTimeout(function(){ location.reload(); }, 2000);
    }catch(e){ toast('복원 실패: '+e.message); }
  }).catch(function(e){ toast('복원 오류: '+e.message); });
}

function _refreshExPage(){
  var exDateEl=$id('ex-date');
  var targetDate=(exDateEl&&exDateEl.value.trim())||todayStr();
  var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===targetDate;});
  var exList=dayRec&&dayRec.exercise&&dayRec.exercise.length?dayRec.exercise:[];
  var statusEl=$id('today-ex-status');
  if(!statusEl) return;
  if(exList.length){
    statusEl.style.display='block';
    var html='<div class="tip-lbl">오늘 기록된 운동 ('+exList.length+'개)</div>';
    exList.forEach(function(ex,i){
      html+='<div style="display:flex;align-items:flex-start;justify-content:space-between;padding:8px 0;'+(i>0?'border-top:1px solid var(--bd);':'')+'">'
        +'<div style="flex:1;">'
        +'<div style="font-size:13px;font-weight:700;">🏃 '+esc(ex.type)+(ex.dur?' · '+esc(ex.dur):'')+'</div>'
        +(ex.steps?'<div style="font-size:11px;color:var(--mu);margin-top:2px;">👣 '+esc(ex.steps)+'보</div>':'')
        +(ex.memo?'<div style="font-size:11px;color:var(--mu);margin-top:2px;">'+esc(ex.memo)+'</div>':'')
        +'</div>'
        +'<button onclick="A.deleteExItem('+i+')" style="background:none;border:none;cursor:pointer;color:var(--mu);font-size:16px;padding:0 0 0 8px;line-height:1;" title="삭제">✕</button>'
        +'</div>';
    });
    statusEl.innerHTML=html;
  } else {
    statusEl.style.display='none';
  }
}

function deleteExItem(idx){
  var exDateEl=$id('ex-date');
  var targetDate=(exDateEl&&exDateEl.value.trim())||todayStr();
  var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===targetDate;});
  if(!dayRec||!dayRec.exercise) return;
  dayRec.exercise.splice(idx,1);
  _setRecs(days);
  _refreshExPage();
  _refreshHomeExercise();
  _refreshComprehensiveBtn();
  _refreshHomeProgress();
  toast('운동 기록을 삭제했어요');
}

function _refreshExPage_dummy(){} // placeholder
function _refreshComprehensiveBtn(){
  var today=todayStr();
  var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===today;});
  var hasFood=dayRec&&((dayRec.analysis&&dayRec.analysis.latest)||(dayRec.photos&&(dayRec.photos.morning||dayRec.photos.lunch||dayRec.photos.dinner)));
  var hasEx=dayRec&&dayRec.exercise&&dayRec.exercise.length;
  var wrap=$id('home-comprehensive-wrap');
  if(wrap) wrap.style.display=(hasFood&&hasEx)?'block':'none';
  var compEl=$id('home-comprehensive-result');
  if(compEl&&dayRec&&dayRec.comprehensive){
    compEl.style.display='block';
    compEl.innerHTML='<div class="tip-lbl">오늘의 종합 평가</div>'+md(dayRec.comprehensive);
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
  _api({max_tokens:700,messages:[{role:'user',content:prompt}]},function(reply){
    var result=reply||'종합 평가를 가져오지 못했어요.';
    compEl.innerHTML='<div class="tip-lbl">오늘의 종합 평가</div>'+md(result);
    dayRec.comprehensive=result; _setRecs(days);
  });
}

var _homeMealSlot = null;
var _pendingMeal = null; // 홈 식사 슬롯에서 넘어올 때 시간대 기억
function openMealSlot(meal){
  var mealMap = {breakfast:'morning', lunch:'lunch', dinner:'dinner'};
  var mealKey = mealMap[meal] || meal;
  var mealName = {breakfast:'🌅 아침',lunch:'☀️ 점심',dinner:'🌙 저녁'}[meal]||meal;
  var days=_getRecs(), today=todayStr();
  var todayRec=days.find(function(d){return d.date===today;});
  var existingPhoto = todayRec && todayRec.photos && todayRec.photos[mealKey];

  if(existingPhoto){
    var analysis = todayRec && todayRec.analysis && (todayRec.analysis[mealKey]||todayRec.analysis.latest);
    _openHomeMealViewer(existingPhoto, mealName, analysis, meal);
    return;
  }

  // 사진 없으면 sh-photo 시트 열기
  _pendingMeal = mealKey;
  var titleEl = $id('sh-photo-title');
  if(titleEl) titleEl.textContent = mealName + ' 사진 선택';
  setTimeout(function(){ openSheet('sh-photo'); }, 200);
}

var _viewerMeal = null; // 현재 뷰어에서 보고 있는 끼니 키

function _openHomeMealViewer(photoUrl, mealName, analysis, meal){
  _viewerMeal = meal;
  var mealKey={breakfast:'morning',lunch:'lunch',dinner:'dinner'}[meal]||meal;
  var today=todayStr(); var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===today;});
  var note = dayRec&&dayRec.mealNotes ? (dayRec.mealNotes[mealKey]||'') : '';
  // 해당 끼니 분석만 (latest 폴백 제거)
  var mealAna = dayRec&&dayRec.analysis ? (dayRec.analysis[mealKey]||'') : '';

  // 뷰어 이미지
  var img=$id('hv-img'); if(img) img.src=photoUrl;

  // 뷰어 하단 분석 텍스트
  var infoEl=$id('home-viewer-analysis');
  if(infoEl){
    var txt='';
    if(mealAna) txt+='<div style="font-size:13px;color:#fff;line-height:1.8;">'+md(mealAna)+'</div>';
    infoEl.style.display=txt?'block':'none';
    infoEl.innerHTML=txt;
  }

  // 메모 입력창에 기존 메모 채우기
  var noteInp=$id('hv-note-input'), noteSave=$id('hv-note-save');
  if(noteInp){ noteInp.value=note; }
  if(noteSave){ noteSave.style.opacity=note?'1':'.5'; }

  // 버튼에 meal 값 세팅
  var replBtn=$id('hv-replace-btn'); if(replBtn) replBtn.onclick=function(){ A.replaceHomeMealPhoto(meal); };
  var delBtn=$id('hv-delete-btn');   if(delBtn)  delBtn.onclick=function(){ A.deleteMealPhoto(meal); };
  var reBtn=$id('hv-reanalyze-btn'); if(reBtn)   reBtn.onclick=function(){ A.reanalyzeMealPhoto(); };

  var viewer=$id('home-viewer'); if(viewer) viewer.classList.add('on');
}

function toggleMemoArea(){
  var area=$id('hv-memo-area'), btn=$id('hv-memo-btn');
  if(!area) return;
  var open=area.style.display!=='none';
  area.style.display=open?'none':'block';
  if(btn) btn.style.background=open?'':'#0e8f79';
  if(!open){ var inp=$id('hv-note-input'); if(inp) inp.focus(); }
}

function saveMealViewerNote(){
  var noteEl=$id('hv-note-input'); if(!noteEl) return;
  var note=noteEl.value.trim();
  var meal=_viewerMeal;
  var mealKey={breakfast:'morning',lunch:'lunch',dinner:'dinner'}[meal]||meal;
  var today=todayStr(); var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===today;});
  if(!dayRec){ dayRec={date:today,photos:{},steps:''}; days.push(dayRec); }
  if(!dayRec.mealNotes) dayRec.mealNotes={};
  dayRec.mealNotes[mealKey]=note;
  _setRecs(days);
  toast('메모가 저장됐어요 ✓');
  var btn=$id('hv-note-save');
  if(btn){ btn.textContent='✓ 저장됨'; btn.style.opacity='1'; btn.style.background='#0e8f79';
    setTimeout(function(){ btn.innerHTML='<i class="ti ti-check"></i> 메모 저장'; btn.style.background='#19B89B'; btn.style.opacity='.5'; },2000); }
}

function reanalyzeMealPhoto(){
  if(!KEY){ toast('API 키가 없습니다'); return; }
  var meal=_viewerMeal;
  var mealKey={breakfast:'morning',lunch:'lunch',dinner:'dinner'}[meal]||meal;
  var mealName={breakfast:'🌅 아침',lunch:'☀️ 점심',dinner:'🌙 저녁'}[meal]||meal;
  var today=todayStr(); var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===today;});
  var photoUrl=dayRec&&dayRec.photos&&dayRec.photos[mealKey];
  var note=dayRec&&dayRec.mealNotes&&dayRec.mealNotes[mealKey]||'';
  if(!photoUrl){ toast('사진이 없습니다'); return; }

  // 분석 중 표시
  var anaEl=$id('home-viewer-analysis');
  if(anaEl) anaEl.innerHTML='<div class="dots"><span></span><span></span><span></span></div>';
  toast('분석 중...');

  // Firebase Storage URL → fetch → base64 변환 후 API 전송
  _urlToBase64(photoUrl, function(dataUrl){
    if(!dataUrl){ toast('사진을 분석할 수 없습니다 (CORS)'); return; }
    (function(){
      var base64=dataUrl.split(',')[1];
      var mode=USER?USER.mode:'lchf';
      var modeDesc={keto:'케토제닉(탄수화물 20g 이하)',carnivore:'카니보어(동물성 식품)',lchf:'저탄고지(탄수화물 100g 이하)',diet:'균형 건강식',cancer:'암 환자 항산화 식단'}[mode]||mode;
      var prompt='['+mealName+' 식사 사진] '+modeDesc+' 관점에서 분석해주세요.';
      if(note) prompt+=' 사용자 메모: "'+note+'"';
      prompt+=' 주요 음식명, 적합도, 개선 제안을 2~3문장으로 간결하게.';
      _api({max_tokens:300,messages:[{role:'user',content:[
        {type:'image',source:{type:'base64',media_type:'image/jpeg',data:base64}},
        {type:'text',text:prompt}
      ]}]}, function(reply){
        if(!reply){ toast('분석 실패 - 다시 시도하세요'); return; }
        if(!dayRec.analysis) dayRec.analysis={};
        dayRec.analysis[mealKey]=reply;
        dayRec.analysis.latest=reply;
        _setRecs(days);
        _refreshHomeAnalysis();
        var anaEl2=$id('home-viewer-analysis');
        if(anaEl2){ anaEl2.style.display='block'; anaEl2.innerHTML='<div style="font-size:13px;color:#fff;line-height:1.8;">'+md(reply)+'</div>'; }
        toast('분석 완료 ✓');
      });
    })();
  });
}

function deleteMealPhoto(meal){
  if(!confirm('이 사진을 삭제할까요?')) return;
  var mealKey={breakfast:'morning',lunch:'lunch',dinner:'dinner'}[meal]||meal;
  var today=todayStr(); var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===today;});
  if(dayRec&&dayRec.photos) delete dayRec.photos[mealKey];
  if(dayRec&&dayRec.analysis) { delete dayRec.analysis[mealKey]; dayRec.analysis.latest=''; }
  _setRecs(days);
  closeHomeMealViewer();
  _refreshPhotos();
  _refreshHomeAnalysis();
  toast('사진이 삭제됐어요');
}

function closeHomeMealViewer(){
  var viewer=$id('home-viewer'); if(viewer) viewer.classList.remove('on');
  var analysisEl=$id('home-meal-analysis'); if(analysisEl) analysisEl.style.display='none';
}

function replaceHomeMealPhoto(meal){
  closeHomeMealViewer();
  var mealMap={breakfast:'morning',lunch:'lunch',dinner:'dinner'};
  _pendingMeal=mealMap[meal]||meal;
  setTimeout(function(){ openSheet('sh-photo'); },200);
}
function pickHomeMeal(src){
  closeSheet('sh-home-meal');
  var inp=$id('f-home-meal-'+src); if(inp){inp.value='';inp.click();}
}
function onHomeMealFile(e,src){
  var f=e.target.files[0]; e.target.value=''; if(!f||!_homeMealSlot) return;
  var s=_homeMealSlot; _homeMealSlot=null;
  // 메모 가져오기
  var noteEl=$id('sh-photo-note');
  var note = noteEl ? noteEl.value.trim() : '';
  closeSheet('sh-photo');
  var mealName={breakfast:'아침',lunch:'점심',dinner:'저녁'}[s.meal]||s.meal;
  var r=new FileReader(); r.onload=function(ev){ _compress(ev.target.result,function(small){
    $id('preview-img').src=small; $id('preview-wrap').style.display='';
    // 메모 저장
    if(!s.todayRec.mealNotes) s.todayRec.mealNotes={};
    if(note) s.todayRec.mealNotes[s.meal]=note;
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
      _analyzeHomeMeal(small, mealName, note);
    }).catch(function(err){
      console.error('Storage 업로드 실패:', err);
      toast('사진 업로드 실패 - 네트워크를 확인하고 다시 시도하세요');
      // base64를 절대 Firestore에 저장하지 않음
    });
  }); }; r.readAsDataURL(f);
}

function _analyzeHomeMeal(imgData, mealName, note){
  if(!KEY) return;
  // 분석 중 표시
  var resultEl = $id('home-ai-result');
  if(resultEl){
    resultEl.style.display='block';
    var cur=resultEl.innerHTML;
    resultEl.innerHTML=cur+'<div id="meal-analyzing" style="color:var(--mu);font-size:12px;display:flex;align-items:center;gap:6px;margin-top:6px;"><div class="dots"><span></span><span></span><span></span></div>'+mealName+' 분석 중...</div>';
  }
  var mode=USER?USER.mode:'lchf';
  var modeDesc={keto:'케토제닉(탄수화물 20g 이하)',carnivore:'카니보어(동물성 식품)',lchf:'저탄고지(탄수화물 100g 이하)',diet:'균형 건강식',cancer:'암 환자 항산화 식단'}[mode]||mode;
  var prompt='['+mealName+' 식사 사진] '+modeDesc+' 관점에서 분석해주세요.';
  if(note) prompt += ' 사용자 메모: "'+note+'"';
  prompt += ' 주요 음식명, 적합도, 개선 제안을 2~3문장으로 간결하게.';
  _api({
    max_tokens:300,
    messages:[{role:'user',content:[
      {type:'image',source:{type:'base64',media_type:'image/jpeg',data:imgData.split(',')[1]}},
      {type:'text',text:prompt}
    ]}]
  }, function(reply){
    if(!reply) return;
    // 끼니 키로 저장
    var mealKey={아침:'morning',점심:'lunch',저녁:'dinner'};
    var rawKey=null;
    Object.keys(mealKey).forEach(function(k){ if(mealName.indexOf(k)>-1) rawKey=mealKey[k]; });
    var today=todayStr(); var days=_getRecs();
    var dayRec=days.find(function(d){return d.date===today;});
    if(!dayRec){ dayRec={date:today,photos:{},steps:''}; days.push(dayRec); }
    if(!dayRec.analysis) dayRec.analysis={};
    if(rawKey) dayRec.analysis[rawKey]=reply;
    // latest는 종합평가용으로 유지 (홈에서 가장 최근 분석)
    dayRec.analysis.latest=reply;
    dayRec.analysis.ts=Date.now();
    _setRecs(days);
    _refreshHomeAnalysis();
  });
}

/* ── 전날 AI 피드백 ── */
function _refreshYesterdayFeedback(){
  var wrap=$id('home-yesterday-wrap'); if(!wrap) return;
  var card=$id('home-yesterday-card'); if(!card) return;
  var days=_getRecs();
  var today=todayStr();
  // 어제 날짜 계산
  var d=new Date(); d.setDate(d.getDate()-1);
  var yy=d.getFullYear(), mm=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0');
  var yesterday=yy+'-'+mm+'-'+dd;
  var yRec=days.find(function(r){return r.date===yesterday;});
  if(!yRec) { wrap.style.display='none'; return; }
  var comp=yRec.comprehensive||'';
  var foodAna=yRec.analysis&&yRec.analysis.latest||'';
  var exInfo=yRec.exercise&&yRec.exercise.length?yRec.exercise[yRec.exercise.length-1]:null;
  if(!comp&&!foodAna&&!exInfo){ wrap.style.display='none'; return; }
  wrap.style.display='block';
  var tags='';
  if(foodAna) tags+='<span class="ycard-tag food"><i class="ti ti-camera" style="font-size:9px;margin-right:3px;"></i>식단 분석</span>';
  if(exInfo) tags+='<span class="ycard-tag ex"><i class="ti ti-run" style="font-size:9px;margin-right:3px;"></i>'+esc(exInfo.type)+(exInfo.dur?' · '+esc(exInfo.dur):'')+'</span>';
  if(comp) tags+='<span class="ycard-tag comp"><i class="ti ti-sparkles" style="font-size:9px;margin-right:3px;"></i>종합 평가</span>';
  var mainText = comp || foodAna;
  // 너무 길면 자르기
  if(mainText.length>220) mainText=mainText.substring(0,220)+'…';
  card.innerHTML='<div class="ycard-header"><div class="ycard-icon"><i class="ti ti-history" style="font-size:14px;color:var(--teal);"></i></div><div><div class="ycard-title">어제 ('+yesterday.substring(5)+') AI 피드백</div><div class="ycard-meta">클릭하면 추적 탭에서 전체 확인</div></div></div>'
    +'<div class="ycard-body">'+esc(mainText)+'</div>'
    +'<div class="ycard-tags">'+tags+'</div>';
  card.onclick=function(){ goPage('track'); };
  card.style.cursor='pointer';
}

/* ── 기록장 메모만 저장 (사진 없이) ── */
function saveMealNoteOnly(){
  if(!_pendMeal) { closeSheet('sh-meal'); return; }
  var noteEl=$id('sh-meal-note');
  var note=noteEl?noteEl.value.trim():'';
  if(!note){ closeSheet('sh-meal'); return; }
  var p=_pendMeal; _pendMeal=null;
  var card=$id(p.cardId); if(!card){ closeSheet('sh-meal'); return; }
  var dateVal=card.querySelector('.day-date').value;
  var days=_getRecs();
  var dayRec=days.find(function(d){return d.date===dateVal;});
  if(!dayRec){ dayRec={date:dateVal,photos:{},steps:''}; days.push(dayRec); }
  if(!dayRec.mealNotes) dayRec.mealNotes={};
  dayRec.mealNotes[p.meal]=note;
  _setRecs(days);
  // 기록장 카드 메모 textarea에도 반영
  var noteArea=card.querySelector('[data-note-cardid]');
  if(noteArea){
    var allNotes=Object.values(dayRec.mealNotes).filter(Boolean).join(' / ');
    noteArea.value=allNotes;
  }
  closeSheet('sh-meal');
  toast('메모가 저장됐어요 ✓');
}

/* ── _homeMealSlot 세팅 래퍼 ── */
function _prepHomeMealSlot(meal){
  var mealMap={breakfast:'morning',lunch:'lunch',dinner:'dinner'};
  var mealKey=mealMap[meal]||meal;
  var days=_getRecs(), today=todayStr();
  var todayRec=days.find(function(d){return d.date===today;});
  if(!todayRec){ todayRec={date:today,photos:{},steps:''}; days.push(todayRec); }
  _homeMealSlot={meal:mealKey, today:today, days:days, todayRec:todayRec};
}

/* ── 드래그 앤 드롭 ── */
function _handleHomeMealDrop(file, meal){
  if(!file||!file.type.startsWith('image/')) return;
  _prepHomeMealSlot(meal);
  var s=_homeMealSlot; _homeMealSlot=null;
  var mealName={morning:'아침',lunch:'점심',dinner:'저녁'}[s.meal]||s.meal;
  var r=new FileReader(); r.onload=function(ev){ _compress(ev.target.result,function(small){
    var previewImg=$id('preview-img'), previewWrap=$id('preview-wrap');
    if(previewImg) previewImg.src=small;
    if(previewWrap) previewWrap.style.display='';
    if(!s.todayRec.mealNotes) s.todayRec.mealNotes={};
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
      _analyzeHomeMeal(small, mealName, '');
    }).catch(function(err){
      console.error('Storage 업로드 실패:',err);
      toast('사진 업로드 실패 - 네트워크를 확인하고 다시 시도하세요');
    });
  }); }; r.readAsDataURL(file);
}

function _handleRecordMealDrop(file, cardId, meal){
  if(!file||!file.type.startsWith('image/')) return;
  _pendMeal={cardId:cardId, meal:meal};
  onMealFile({target:{files:[file], value:''}}, 'gal');
}

function _initDragDrop(){
  // 홈 식사 슬롯
  var homeSlots=$id('home-meal-slots');
  if(homeSlots){
    homeSlots.addEventListener('dragover',function(e){
      e.preventDefault();
      var slot=e.target.closest('.home-meal-slot');
      if(slot){ e.dataTransfer.dropEffect='copy'; slot.classList.add('drag-over'); }
    });
    homeSlots.addEventListener('dragleave',function(e){
      var slot=e.target.closest('.home-meal-slot');
      if(slot&&!slot.contains(e.relatedTarget)) slot.classList.remove('drag-over');
    });
    homeSlots.addEventListener('drop',function(e){
      e.preventDefault();
      var slot=e.target.closest('.home-meal-slot');
      if(!slot) return;
      slot.classList.remove('drag-over');
      var meal=slot.id.replace('ms-',''); // breakfast, lunch, dinner
      _handleHomeMealDrop(e.dataTransfer.files[0], meal);
    });
  }
  // 기록장 식사 슬롯 (동적 렌더링이므로 부모에 위임)
  var logCards=$id('log-cards');
  if(logCards){
    logCards.addEventListener('dragover',function(e){
      e.preventDefault();
      var slot=e.target.closest('.meal-slot');
      if(slot&&!slot.getAttribute('data-photo')){ e.dataTransfer.dropEffect='copy'; slot.classList.add('drag-over'); }
    });
    logCards.addEventListener('dragleave',function(e){
      var slot=e.target.closest('.meal-slot');
      if(slot&&!slot.contains(e.relatedTarget)) slot.classList.remove('drag-over');
    });
    logCards.addEventListener('drop',function(e){
      e.preventDefault();
      var slot=e.target.closest('.meal-slot');
      if(!slot) return;
      slot.classList.remove('drag-over');
      var meal=slot.getAttribute('data-meal');
      var card=slot.closest('.day-card');
      if(!meal||!card) return;
      _handleRecordMealDrop(e.dataTransfer.files[0], card.id, meal);
    });
  }
}

/* ── 랜딩 태그 선택 ── */
function pickLandingTag(el){
  document.querySelectorAll('.landing-tag').forEach(function(t){
    t.style.background='rgba(25,184,155,.2)';
    t.style.color='#19B89B';
    t.style.border='1px solid rgba(25,184,155,.35)';
  });
  el.style.background='#19B89B';
  el.style.color='#fff';
  el.style.border='1px solid #19B89B';
  setTimeout(function(){ goScreen('scr-profile'); }, 300);
}

/* ── 공개 API ── */
return {
  // 화면
  goScreen:goScreen, logoTap:logoTap, nameTap:nameTap, enterByName:enterByName, goSelfJoin:goSelfJoin, selfJoin:selfJoin, goHelp:goHelp, goBack:goBack, pickLandingTag:pickLandingTag,
  openQuickCond:openQuickCond, quickCondPick:quickCondPick, closeQuickCond:closeQuickCond, saveQuickCond:saveQuickCond,
  // 설정
  checkPw:checkPw,
  // Admin
  delUser:delUser, changePw:changePw, backup:backup, restore:restore, fullReset:fullReset, filterAdminUsers:filterAdminUsers, backupText:backupText, copyBackupText:copyBackupText, showPatient:showPatient,
  loadAiRec:loadAiRec, loadBackupList:loadBackupList, forceCloudSave:forceCloudSave, restoreBackup:_restoreBackup, restoreCloudBackup:restoreCloudBackup,
  // 사용자 추가
  _selMode:_selMode, _selCtype:_selCtype, _selStage:_selStage, addUser:addUser,
  // 앱
  goPage:goPage, onMic:onMic,
  // 팁

  // 코치
  askQ:askQ, sendChat:sendChat,
  // 식단 분석
  // PSA
  openSheet:openSheet, closeSheet:closeSheet, savePSA:savePSA, openMarkerSheet:openMarkerSheet,
  // 컨디션 기록
  openConditionSheet:openConditionSheet, selectCondState:selectCondState, saveCondition:saveCondition,
  // 종합 분석
  analyzeEx:analyzeEx, analyzeExAll:analyzeExAll, addExToList:addExToList, removeExFromList:removeExFromList, deleteExItem:deleteExItem, pickExType:pickExType,
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
  _openViewer:_openViewer, closeViewer:closeViewer, vRot:vRot, vChg:vChg, vDel:vDel, vAnalyze:vAnalyze,
  closeHomeViewer:closeHomeViewer,
  // 기록장 내부
  _openMealSheet:_openMealSheet,
  // 홈 식사 슬롯
  openMealSlot:openMealSlot, pickHomeMeal:pickHomeMeal, onHomeMealFile:onHomeMealFile,
  saveMealNoteOnly:saveMealNoteOnly, saveMealWithMemo:saveMealWithMemo,
  closeHomeMealViewer:closeHomeMealViewer, replaceHomeMealPhoto:replaceHomeMealPhoto,
  saveMealViewerNote:saveMealViewerNote, reanalyzeMealPhoto:reanalyzeMealPhoto, deleteMealPhoto:deleteMealPhoto, toggleMemoArea:toggleMemoArea
};

})();