/* 여행모아 v2 – 모바일 우선 · Supabase 즉시 저장 */
(function () {
  'use strict';
  const T = window.TRIP;
  const CFG = window.SB_CONFIG || {};
  const READY = !!(CFG.url && CFG.key);
  const BASE = (CFG.url || '').replace(/\/+$/, '');
  const BUCKET = 'trip-photos';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl2br = s => esc(s).replace(/\n/g, '<br>');
  const pad = n => String(n).padStart(2, '0');
  const hhmm = (d = new Date()) => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const app = $('#app');

  const ETC = { id: 'etc', no: '+', name: '문화체험 · 기타', cn: '', en: '', time: '일정 중 자유 기록', city: '', day: null, desc: [], q: [] };
  const ORGS = T.orgs.concat([ETC]);
  const orgById = id => ORGS.find(o => o.id === id);

  /* ---------- 로컬 보관 (끊겨도 기록이 사라지지 않도록) ---------- */
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 용량 초과 등 무시 */ } }
  };
  const myName = () => { try { return localStorage.getItem('tm-name') || ''; } catch (e) { return ''; } };

  /* ---------- Supabase REST ---------- */
  function headers(extra) {
    const h = { apikey: CFG.key };
    if (/^eyJ/.test(CFG.key)) h.Authorization = 'Bearer ' + CFG.key; // 예전 anon(JWT) 키
    return Object.assign(h, extra || {});
  }
  async function sb(path, opt = {}) {
    const r = await fetch(BASE + path, Object.assign({}, opt, { headers: headers(Object.assign({ 'Content-Type': 'application/json' }, opt.headers)) }));
    if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 200));
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  const photoUrl = p => `${BASE}/storage/v1/object/public/${BUCKET}/${p.path}`;

  /* ---------- 상태 ---------- */
  let E = ls.get('tm2-cache-' + T.id, {});      // key -> {value, author, updated_at}
  let PH = ls.get('tm2-photos-' + T.id, []);    // 사진 목록
  let OB = ls.get('tm2-outbox-' + T.id, {});    // 아직 서버에 못 보낸 기록
  let online = null;
  const v = k => (E[k] && E[k].value) || '';
  const saveLocal = () => { ls.set('tm2-cache-' + T.id, E); ls.set('tm2-outbox-' + T.id, OB); };

  function setSync(msg, kind) {
    const el = $('#sync'); el.textContent = msg; el.className = 'sync ' + (kind || '');
  }
  function syncStatus() {
    const n = Object.keys(OB).length;
    if (!READY) setSync('⚠ 저장 서버 미설정', 'warn');
    else if (n) setSync(`⏳ 대기 ${n}건 · 연결되면 자동 저장`, 'warn');
    else if (online === false) setSync('⚠ 오프라인 · 휴대폰에 보관 중', 'warn');
    else setSync('✓ 저장됨 ' + hhmm(), 'ok');
  }

  // 서버에서 최신 기록·사진을 받아옴. 내용이 바뀌었을 때만 true (불필요한 다시 그리기 방지)
  const sigOf = (rows, photos) => rows.map(r => r.key + r.updated_at).sort().join() + '|' + photos.map(p => p.id + p.caption).join();
  // 휴대폰에 저장된 내용 기준으로 시작 → 서버 내용이 같으면 다시 그리지 않음
  let lastSig = sigOf(Object.values(E).filter(r => !OB[r.key]), PH), pulling = null, lastPullAt = 0;
  function pull(force) {
    if (!READY) { syncStatus(); return Promise.resolve(false); }
    if (pulling) return pulling; // 동시에 여러 번 부르면 한 번만 요청
    if (!force && Date.now() - lastPullAt < 3000) return Promise.resolve(false); // 3초 안에 다시 부르면 생략
    pulling = (async () => {
      let changed = false;
      try {
        const [rows, photos] = await Promise.all([ // 기록과 사진 목록을 동시에 요청
          sb(`/rest/v1/entries?trip=eq.${T.id}&select=key,value,author,updated_at`),
          sb(`/rest/v1/photos?trip=eq.${T.id}&select=*&order=created_at.asc`)
        ]);
        lastPullAt = Date.now();
        const sig = sigOf(rows, photos);
        changed = sig !== lastSig; lastSig = sig;
        if (changed) {
          const fresh = {};
          rows.forEach(r => { fresh[r.key] = r; });
          Object.values(OB).forEach(r => { fresh[r.key] = r; }); // 미전송 내 기록이 우선
          E = fresh; PH = photos;
          ls.set('tm2-photos-' + T.id, PH); saveLocal();
        }
        online = true;
      } catch (e) { online = false; }
      syncStatus();
      pulling = null;
      return changed;
    })();
    return pulling;
  }

  function put(key, value) {
    const row = { trip: T.id, key, value, author: myName(), updated_at: new Date().toISOString() };
    E[key] = row; OB[key] = row; saveLocal();
    setSync('저장 중…', '');
    clearTimeout(put.t); put.t = setTimeout(push, 800);
  }
  let pushing = false;
  async function push(keepalive) {
    if (!READY || pushing) return;
    const rows = Object.values(OB);
    if (!rows.length) { syncStatus(); return; }
    pushing = true;
    try {
      await sb('/rest/v1/entries?on_conflict=trip,key', {
        method: 'POST', keepalive: !!keepalive,
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(rows)
      });
      rows.forEach(r => { if (OB[r.key] === r) delete OB[r.key]; });
      saveLocal(); online = true;
    } catch (e) { online = false; }
    pushing = false;
    // 보내는 동안 새로 적은 내용이 있으면 바로 이어서 전송
    if (online && Object.keys(OB).length) { setTimeout(push, 300); return; }
    syncStatus();
    if (online && !Object.keys(OB).length) { const s = $('#sync'); s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); }
  }
  setInterval(() => { if (Object.keys(OB).length) push(); }, 15000);
  window.addEventListener('online', () => push());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') push(true);
    else refresh();
  });
  const isTyping = () => { const a = document.activeElement; return a && /^(TEXTAREA|INPUT)$/.test(a.tagName); };

  /* ---------- 날짜 ---------- */
  const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const dayIdxToday = () => T.days.findIndex(d => d.date === todayStr());
  const defaultDay = () => { const i = dayIdxToday(); return i >= 0 ? i + 1 : 1; };
  const toMin = s => { const m = /(\d{1,2}):(\d{2})/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  function currentItem(day) {
    if (day.date !== todayStr()) return -1;
    const d = new Date(), nm = d.getHours() * 60 + d.getMinutes();
    let idx = -1; day.items.forEach((it, i) => { const st = toMin(it.t); if (st != null && st <= nm) idx = i; });
    return idx;
  }
  const ddays = () => Math.round((new Date(T.start + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000);
  const fmtTs = ts => { if (!ts) return ''; const d = new Date(ts); return (d.getMonth() + 1) + '.' + d.getDate() + '. ' + hhmm(d); };

  /* ---------- 공통 UI ---------- */
  let toastT;
  function toast(msg, ms = 2400) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }
  const tel = s => s.replace(/[^+\d]/g, '');
  // 기록자 표시: 내용 바로 아래 "✍️ 이름 · 시각"
  const writerText = k => E[k] && (E[k].value || '').trim() ? `✍️ ${E[k].author || '이름 없음'} · ${fmtTs(E[k].updated_at)}` : '';
  // 보고서·공유용: 내용 뒤에 (성명)
  const sig = k => E[k] && (E[k].value || '').trim() && E[k].author ? ` (${E[k].author})` : '';
  const withSig = k => v(k).trim() ? v(k).trim() + sig(k) : '';
  function area(key, label, ph, rows = 4) {
    return `<label class="f">${label}<textarea class="inp" rows="${rows}" data-key="${key}" placeholder="${esc(ph || '')}">${esc(v(key))}</textarea></label><div class="writer" data-w="${key}">${esc(writerText(key))}</div>`;
  }
  // 접이식 카드: 아이콘 배지 + 제목 + 한 줄 미리보기 + 회전 화살표 (sub는 이미 안전한 문자열)
  const fold = (ico, tone, title, sub, body) => `<details class="card fold"><summary>
      <span class="f-ico ${tone}" aria-hidden="true">${ico}</span>
      <span class="f-txt"><b>${title}</b><small>${sub}</small></span>
      <span class="f-chev" aria-hidden="true"></span></summary><div class="fold-body">${body}</div></details>`;
  const dayTabs = (sel, base) => `<div class="day-tabs">${T.days.map(x => `<button data-act="go" data-to="${base}/${x.n}" class="${x.n === sel ? 'on' : ''} ${x.date === todayStr() ? 'today' : ''}">${x.n}일차<small>${x.label}</small></button>`).join('')}</div>`;

  function questions(org) {
    // 준비 질문: 고친 문장(qt:키)이 있으면 그것을, 없으면 원래 질문을 사용
    const seed = org.q.map((q, i) => {
      const id = `seed-${org.id}-${i}`, key = `qt:${id}`, edited = v(key).trim();
      return { id, q: edited || q, orig: q, edited: !!edited, custom: false, key };
    });
    // 현장 추가 질문: 추가한 순서대로 (고쳐도 순서가 바뀌지 않음)
    const custom = Object.keys(E).filter(k => k.startsWith(`qx:${org.id}:`) && v(k).trim())
      .sort((a, b) => parseInt(a.split(':')[2], 36) - parseInt(b.split(':')[2], 36))
      .map(k => ({ id: k.split(':')[2], q: v(k), custom: true, key: k }));
    return seed.concat(custom);
  }
  function orgProgress(o) {
    const qs = questions(o);
    return { q: qs.length, a: qs.filter(x => v(`qa:${x.id}:a`).trim()).length, memo: !!v(`note:${o.id}:summary`).trim(), ph: PH.filter(p => p.org === o.id).length };
  }

  /* =================== 페이지 =================== */
  const pages = {};

  /* --- 일정 (홈) --- */
  pages.home = p => {
    const sel = Math.min(5, Math.max(1, +p || defaultDay()));
    const d = T.days[sel - 1];
    const dd = ddays(), di = dayIdxToday();
    const chip = di >= 0 ? `오늘은 ${di + 1}일차` : dd > 0 ? `출국까지 D-${dd}` : '출장 완료 · 보고서를 작성하세요';
    const cur = currentItem(d);
    const h = d.hotel != null ? T.hotels[d.hotel] : null;
    return `<div class="hero-s"><b>${esc(T.title)}</b><span>2026.11.29.(일) ~ 12.3.(목)</span><span class="dday">${chip}</span></div>
    ${dd > 0 && sel === 1 ? `<div class="card accent"><b>🧳 11.29.(일) 오전 ${T.meet.time} 김해공항 집결</b><br>부산 12:35 출발 → 상하이 13:25 도착 (중국동방항공)</div>` : ''}
    ${dayTabs(sel, 'home')}
    <div class="card"><h3>${d.n}일차 · ${d.label} <span class="tag">${esc(d.city)}</span></h3>
      <ul class="timeline">${d.items.map((it, i) => {
        const link = it.org ? `#org/${it.org}` : '';
        return `<li class="${it.org ? 'visit' : ''} ${i === cur ? 'now' : ''}"><span class="tm">${esc(it.t)}</span><div>${link ? `<a class="what" href="${link}">${i === cur ? '▶ ' : ''}${esc(it.what)} <span class="go">기록 ›</span></a>` : `<span class="what">${i === cur ? '▶ ' : ''}${esc(it.what)}</span>`}${it.note ? `<span class="note">${esc(it.note)}</span>` : ''}</div></li>`;
      }).join('')}</ul></div>
    ${h ? `<div class="card"><h3>🏨 오늘 숙소</h3><p class="big" style="margin:0">${esc(h.ko)}</p><p class="muted">${esc(h.name)}</p>
      <div class="btn-row"><a class="btn" href="tel:${tel(h.tel)}">📞 전화</a><button class="btn orange" data-act="taxi" data-kind="hotel" data-i="${d.hotel}">🚕 기사에게 보여주기</button></div></div>`
      : `<div class="card"><h3>🛫 귀국</h3><p>상하이 푸동 18:30 출발 → 부산 20:30 도착 (춘추항공)</p></div>`}
    <div class="fold-group">
    ${fold('✈️', 'c1', '항공 · 차량 · 숙소', '출국 11.29. 12:35 · 귀국 12.3. 18:30 · 호텔 2곳',
      T.flights.map(f => `<p><b>${f.type} ${esc(f.date)}</b> ${esc(f.airline)}<br>${esc(f.from)} ${f.dep} → ${esc(f.to)} ${f.arr}</p>`).join('') +
      `<p><b>차량</b> ${esc(T.vehicle.title)} (상하이↔항저우 약 3시간)</p>` +
      T.hotels.map((x, i) => `<p><b>${esc(x.city)}</b> ${esc(x.nights)}<br>${esc(x.ko)}<br><span class="muted">${esc(x.addr)}</span><br><a href="tel:${tel(x.tel)}">📞 ${esc(x.tel)}</a> · <a href="#" data-act="taxi" data-kind="hotel" data-i="${i}">🚕 중국어 주소</a></p>`).join(''))}
    ${fold('🚨', 'c2', '비상 연락처', '총영사관 · 경찰 110 · 구급 120',
      T.emergency.map(e => `<p class="em"><span>${esc(e.k)}</span><a class="btn small line" href="tel:${tel(e.v)}">📞 ${esc(e.v)}</a></p>`).join(''))}
    ${fold('💱', 'c3', '환율 · 날씨 · 시차', `1위안 ≈ ${T.rate}원 · 중국이 1시간 느림`,
      `<p>1위안 = <b>${T.rate}원</b> (11.16. 기준) · 중국은 한국보다 <b>1시간 느림</b></p>
      <label class="f">위안 → 원<input class="inp" id="cny" inputmode="decimal" placeholder="위안 입력"></label><p class="big" id="krwOut"></p>` +
      T.weather.map(w => `<p>🌤️ ${w.city}: 평균 ${w.low}°~${w.high}°, 강수 ${w.rain}</p>`).join(''))}
    ${fold('📚', 'c4', '참고: 중국 교육 동향', `AI+교육 행동계획 등 ${T.edu.trends.length}가지 · PISA`,
      T.edu.trends.map((t, i) => `<p><b>${i + 1}. ${esc(t.t)}</b><br>${esc(t.d)}</p>`).join('') +
      `<p><b>학제</b> 초6·중3·고3 (상하이 초5·중4) · 의무교육 9년 · 대입 가오카오</p><p>${esc(T.edu.pisa)}</p>`)}
    ${fold('👥', 'c5', '업무분장', `${T.members.map(m => m.role.split('·')[0]).join(' · ')}`,
      T.members.map(m => `<p><b>${esc(m.role)}</b> ${esc(m.name)}<br><span class="muted">${m.duty.map(esc).join(' · ')}</span></p>`).join(''))}
    </div>
    <footer class="org-foot"><img src="img/logo-wide.jpg" alt="부산광역시교육청" loading="lazy" decoding="async" width="600" height="162"><span>초등교육과 · 2026 상하이교육위원회 정기 방문</span></footer>`;
  };

  /* --- 기관 기록 목록 --- */
  pages.orgs = () => `<h2 class="ph2">✏️ 기관 기록</h2><p class="muted">기관을 누르면 질의·답변, 메모, 사진을 바로 기록합니다.</p>
    <div class="org-list">${ORGS.map(o => {
      const g = orgProgress(o);
      return `<a href="#org/${o.id}" class="org-row"><span class="no">${o.no}</span><span class="nm"><b>${esc(o.name)}</b><small>${esc(o.time)}</small>
        <small class="st">${o.q.length ? `<span class="${g.a >= g.q ? 'ok' : ''}">답변 ${g.a}/${g.q}</span> · ` : ''}<span class="${g.memo ? 'ok' : ''}">메모 ${g.memo ? '✓' : '–'}</span> · 사진 ${g.ph}</small></span><span class="arr">›</span></a>`;
    }).join('')}</div>`;

  /* --- 기관 상세 (기록 화면) --- */
  pages.org = id => {
    const o = orgById(id); if (!o) return pages.orgs();
    const idx = ORGS.indexOf(o);
    const phs = PH.filter(p => p.org === o.id);
    return `<a class="back" href="#orgs">‹ 기관 목록</a>
    <div class="org-head"><span class="no">${o.no}</span><div><h2 class="ph2" style="margin:0">${esc(o.name)}</h2>
      <small class="muted">${esc(o.time)}${o.cn ? ` · <span class="cn">${esc(o.cn)}</span>` : ''}</small></div></div>
    ${o.cn ? `<div class="btn-row"><button class="btn line small" data-act="taxi" data-kind="org" data-id="${o.id}">🚕 기관명 크게 보기</button></div>` : ''}
    ${o.desc.length ? fold('ℹ️', 'c1', '기관 소개', `${esc(o.en)} · 사진과 주요 특징`, `${o.img ? `<img class="cover" src="${o.img}" alt="" loading="lazy" decoding="async">` : ''}<ul>${o.desc.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`) : ''}

    ${o.q.length || questions(o).length ? `<h3 class="sec">💬 질의 · 답변</h3>
    ${questions(o).map((x, i) => `<div class="qa-item ${v(`qa:${x.id}:a`).trim() ? 'done' : ''}">
      <div class="q-row"><div class="q"><span>Q${i + 1}</span><span class="q-text">${esc(x.q)}</span></div>
        <button class="q-edit" data-act="q-edit" data-key="${x.key}" aria-label="Q${i + 1} 질문 수정">✏️ 수정</button></div>
      <div class="q-editor" hidden>
        <textarea class="inp" rows="3" aria-label="질문 고치기">${esc(x.q)}</textarea>
        <div class="q-editor-btns"><button class="btn small" data-act="q-save" data-key="${x.key}">저장</button>
          <button class="btn small line" data-act="q-cancel">취소</button>
          ${x.edited ? `<button class="btn small line" data-act="q-restore" data-key="${x.key}">원래 질문으로</button>` : ''}</div>
        ${x.edited ? `<p class="q-orig">원래 질문: ${esc(x.orig)}</p>` : ''}
      </div>
      ${x.edited ? `<div class="writer">✏️ 질문 수정됨 · ${esc((E[x.key] && E[x.key].author) || '')}</div>` : ''}
      ${area(`qa:${x.id}:a`, '답변', '들은 답변을 적어 주세요', 3)}
      ${x.custom ? `<button class="link-del" data-act="q-del" data-key="${x.key}">이 질문 삭제</button>` : ''}</div>`).join('')}
    <div class="add-q"><textarea class="inp" rows="2" id="newq" placeholder="현장에서 나온 질문 추가"></textarea><button class="btn small" data-act="q-add" data-org="${o.id}">＋ 추가</button></div>` : ''}

    <h3 class="sec">📝 메모</h3>
    ${area(`note:${o.id}:summary`, '주요 내용', '설명·견학하며 보고 들은 내용', 5)}
    ${area(`note:${o.id}:insight`, '시사점 · 부산교육 적용', '배울 점, 우리 교육에 적용할 점', 4)}

    <h3 class="sec">📷 사진 <small class="muted">${phs.length}장</small></h3>
    <label class="upload-zone"><span class="ico">📷</span><b>사진 찍기 · 앨범에서 올리기</b><small class="muted">여러 장 선택 가능</small>
      <input type="file" accept="image/*" multiple hidden data-upload="${o.id}"></label>
    <div class="photo-grid">${phs.map(p => `<div class="ph"><img src="${photoUrl(p)}" alt="" loading="lazy" data-act="view">
      <input class="inp" data-photo="${p.id}" value="${esc(p.caption)}" placeholder="사진 설명">
      <div class="ph-meta"><span>${esc(p.author || '')}</span><button data-act="ph-del" data-id="${p.id}">삭제</button></div></div>`).join('')}</div>

    <div class="btn-row" style="margin-top:22px">${idx > 0 ? `<a class="btn line" href="#org/${ORGS[idx - 1].id}">‹ 이전</a>` : ''}${idx < ORGS.length - 1 ? `<a class="btn" href="#org/${ORGS[idx + 1].id}">다음 기관 ›</a>` : ''}</div>`;
  };

  /* --- 일일보고 --- */
  function dailyText(n) {
    const d = T.days[n - 1];
    const L = [`[상하이 출장 ${n}일차 일일보고] ${d.label} ${d.city}`, '■ 일정', d.items.map(i => `${i.t} ${i.what}`).join('\n')];
    if (v(`daily:${n}:summary`)) L.push('■ 주요 내용', withSig(`daily:${n}:summary`));
    T.orgs.filter(o => o.day === n).forEach(o => {
      const qs = questions(o).filter(x => v(`qa:${x.id}:a`).trim());
      if (qs.length) { L.push(`■ ${o.name} 질의응답`); qs.forEach(x => L.push(`Q. ${x.q}\nA. ${withSig(`qa:${x.id}:a`)}`)); }
      if (v(`note:${o.id}:summary`).trim()) L.push(`■ ${o.name} 메모`, withSig(`note:${o.id}:summary`));
    });
    if (v(`daily:${n}:insight`)) L.push('■ 시사점', withSig(`daily:${n}:insight`));
    if (v(`daily:${n}:issue`)) L.push('■ 특이사항·건의', withSig(`daily:${n}:issue`));
    return L.join('\n');
  }
  // '보고' 탭 안의 [일일보고 | 결과보고서] 전환
  const reportTabs = active => `<div class="seg no-print" role="tablist">
    <a href="#daily" role="tab" aria-selected="${active === 'daily'}" class="${active === 'daily' ? 'on' : ''}">📅 일일보고</a>
    <a href="#report" role="tab" aria-selected="${active === 'report'}" class="${active === 'report' ? 'on' : ''}">📄 결과보고서</a></div>`;
  const dayDone = n => !!(v(`daily:${n}:summary`).trim() || v(`daily:${n}:insight`).trim() || v(`daily:${n}:issue`).trim());
  const goesTo = t => `<span class="goes">→ 결과보고서 ${t}</span>`;
  pages.daily = p => {
    const n = Math.min(5, Math.max(1, +p || defaultDay()));
    const d = T.days[n - 1];
    const visits = T.orgs.filter(o => o.day === n);
    return `${reportTabs('daily')}
    <div class="day-tabs">${T.days.map(x => `<button data-act="go" data-to="daily/${x.n}" class="${x.n === n ? 'on' : ''} ${x.date === todayStr() ? 'today' : ''}">${dayDone(x.n) ? '✅ ' : ''}${x.n}일차<small>${x.label}</small></button>`).join('')}</div>
    <div class="card"><h3>${n}일차 · ${d.label} <span class="tag">${esc(d.city)}</span></h3>
      ${visits.length ? `<p class="muted">방문: ${visits.map(o => `<a href="#org/${o.id}">${esc(o.name)}</a>`).join(', ')} <small>(기관별 내용은 '기관 기록'에)</small></p>` : ''}
      <div class="auto-note">✓ 적은 내용은 자동 저장되고, <b>결과보고서에 그대로 들어갑니다.</b> 따로 옮겨 적을 필요가 없습니다.</div>
      ${area(`daily:${n}:summary`, `오늘 주요 내용 ${goesTo('Ⅱ. 일자별 활동')}`, '오늘 있었던 일, 성과', 5)}
      ${area(`daily:${n}:insight`, `시사점 · 배운 점 ${goesTo('Ⅳ. 주요 시사점')}`, '부산교육에 참고할 점, 배운 점', 3)}
      ${area(`daily:${n}:issue`, `특이사항 · 건의 ${goesTo('Ⅱ. 비고')}`, '일정 변경, 건강, 건의 등 (선택)', 2)}
      <div class="btn-row"><a class="btn" href="#report/day${n}">📄 결과보고서에서 ${n}일차 보기</a>
      <button class="btn line small" data-act="share" data-n="${n}">카톡 공유 (선택)</button></div></div>`;
  };

  /* --- 결과 보고서 --- */
  const rv = (k, d) => v('report:' + k).trim() || d || '';
  const emp = '<span class="empty">(미작성)</span>';
  const cell = s => (s || '').trim() ? nl2br(s.trim()) : emp;
  function buildReport() {
    const d = new Date();
    const title = rv('title', `2026년 ${T.title} 공무국외출장 결과보고서`);
    // Ⅳ 주요 시사점 = 기관 메모의 시사점 + 일일보고의 시사점 (자동 모음)
    const insights = T.orgs.map(o => v(`note:${o.id}:insight`).trim() ? `○ (${o.name}) ${withSig(`note:${o.id}:insight`)}` : '')
      .concat(T.days.map(x => v(`daily:${x.n}:insight`).trim() ? `○ (${x.n}일차) ${withSig(`daily:${x.n}:insight`)}` : ''))
      .filter(Boolean).join('\n');
    return { title, html: `<div class="rep-logo"><img src="${new URL('img/logo-wide.jpg', location.href).href}" alt="부산광역시교육청" width="220"></div><h1>${esc(title)}</h1><div class="rep-org">${esc(T.org)} · ${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.</div>
    <h2>Ⅰ. 출장 개요</h2><table>
      <tr><th>목적</th><td>${T.purpose.map(esc).join('<br>')}</td></tr>
      <tr><th>기간</th><td>2026. 11. 29.(일) ~ 12. 3.(목) [${T.nights}]</td></tr>
      <tr><th>장소</th><td>${esc(T.region)}</td></tr>
      <tr><th>출장자</th><td>${T.members.map(m => `${esc(m.role)}: ${esc(m.name)}`).join('<br>')}</td></tr>
      <tr><th>방문 기관</th><td>${T.orgs.map(o => `${o.no}. ${esc(o.name)}`).join('<br>')}</td></tr></table>
    <h2>Ⅱ. 일자별 활동</h2><table><tr><th style="width:18%">일자</th><th>주요 일정</th><th>활동 내용</th></tr>
      ${T.days.map(x => `<tr id="rep-day${x.n}"><td>${x.n}일차<br>${x.label}</td><td>${x.items.map(i => `${esc(i.t)} ${esc(i.what)}`).join('<br>')}</td><td>${cell(withSig(`daily:${x.n}:summary`))}${v(`daily:${x.n}:issue`).trim() ? `<br><br><b>[비고]</b> ${nl2br(withSig(`daily:${x.n}:issue`))}` : ''}</td></tr>`).join('')}</table>
    <h2>Ⅲ. 기관별 방문 결과</h2>
    ${T.orgs.map(o => `<h3>${o.no}. ${esc(o.name)} (${esc(o.cn)})</h3><table>
      <tr><th>일시</th><td>${esc(o.time)}</td></tr>
      <tr><th>기관 개요</th><td>${o.desc.map(esc).join('<br>')}</td></tr>
      <tr><th>주요 내용</th><td>${cell(withSig(`note:${o.id}:summary`))}</td></tr>
      <tr><th>시사점</th><td>${cell(withSig(`note:${o.id}:insight`))}</td></tr>
      <tr><th>질의 응답</th><td>${questions(o).map((x, i) => `<b>Q${i + 1}. ${esc(x.q)}</b><br>A. ${cell(withSig(`qa:${x.id}:a`))}`).join('<br><br>')}</td></tr></table>
      ${PH.filter(p => p.org === o.id).length ? `<div class="rep-photos">${PH.filter(p => p.org === o.id).slice(0, 4).map(p => `<figure><img src="${photoUrl(p)}" alt=""><figcaption>${esc(p.caption || o.name)}</figcaption></figure>`).join('')}</div>` : ''}`).join('')}
    <h2>Ⅳ. 종합 의견 및 시사점</h2><p>${cell(v('report:overall'))}</p>${insights ? `<p>${nl2br(insights)}</p>` : ''}
    <h2>Ⅴ. 부산교육 정책 제언</h2><p>${cell(v('report:suggest'))}</p>
    <h2>Ⅵ. 향후 계획</h2><p>${cell(v('report:plan'))}</p>
    ${PH.filter(p => p.org === 'etc').length ? `<h2>붙임. 문화체험 사진</h2><div class="rep-photos">${PH.filter(p => p.org === 'etc').map(p => `<figure><img src="${photoUrl(p)}" alt=""><figcaption>${esc(p.caption)}</figcaption></figure>`).join('')}</div>` : ''}` };
  }
  pages.report = () => {
    const done = T.orgs.filter(o => v(`note:${o.id}:summary`).trim()).length;
    const qa = T.orgs.reduce((s, o) => { const g = orgProgress(o); return [s[0] + g.a, s[1] + g.q]; }, [0, 0]);
    return `${reportTabs('report')}<div class="no-print">
      <p class="muted">일일보고·기관 기록·사진이 자동으로 모입니다. 아래 3칸만 채우면 완성됩니다.</p>
      <div class="card"><p style="margin:0 0 8px"><b>일일보고</b> ${T.days.map(x => `<a class="day-chip ${dayDone(x.n) ? 'ok' : ''}" href="#daily/${x.n}">${dayDone(x.n) ? '✅' : '⬜'} ${x.n}일차</a>`).join(' ')}</p>
        <p style="margin:0">기관 메모 <b>${done}/${T.orgs.length}</b> · 질의 답변 <b>${qa[0]}/${qa[1]}</b> · 사진 <b>${PH.length}장</b></p></div>
      ${area('report:overall', 'Ⅳ. 종합 의견', '이번 방문의 총평', 5)}
      ${area('report:suggest', 'Ⅴ. 부산교육 정책 제언', '', 5)}
      ${area('report:plan', 'Ⅵ. 향후 계획', '예: 결과보고회, 교류협력 추진 등', 3)}
      <div class="btn-row" style="margin:16px 0"><button class="btn" data-act="go" data-to="report">🔄 미리보기 새로고침</button>
      <button class="btn orange" data-act="print">🖨️ PDF 저장 · 인쇄</button><button class="btn line" data-act="doc">⬇ 워드 파일</button></div>
      <p class="muted" style="font-size:.8rem">※ 보고서 다듬기는 PC에서 하시는 것이 편합니다. 워드 파일은 한글(HWP)에서도 열립니다.</p></div>
    <div class="sheet" id="sheet">${buildReport().html}</div>`;
  };

  /* 설정 안 됨 화면 */
  const setupPage = () => `<div class="card accent"><h3>⚙️ 저장 서버(Supabase) 연결이 필요합니다</h3>
    <p>관리자가 <b>js/config.js</b>에 Supabase 주소와 키를 넣으면 기록 기능이 켜집니다.</p><p>일정 안내는 지금도 볼 수 있습니다.</p>
    <a class="btn" href="#home">일정 보기</a></div>`;

  /* =================== 사진 =================== */
  function resize(file, max = 1280, q = 0.78) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(b => b ? res(b) : rej(new Error('변환 실패')), 'image/jpeg', q);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('읽기 실패')); };
      img.src = url;
    });
  }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  async function upload(files, orgId) {
    const list = Array.from(files); let ok = 0, badFile = 0, netFail = 0;
    const o = orgById(orgId);
    for (let i = 0; i < list.length; i++) {
      toast(`사진 올리는 중… ${i + 1}/${list.length}`, 120000);
      try {
        let blob; try { blob = await resize(list[i]); } catch (e1) { badFile++; continue; } // 사진이 아니거나 열 수 없는 파일
        const id = uuid(); const path = `${T.id}/${orgId}/${id}.jpg`;
        const r = await fetch(`${BASE}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: headers({ 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }), body: blob });
        if (!r.ok) throw new Error(await r.text());
        const row = await sb('/rest/v1/photos', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ id, trip: T.id, org: orgId, day: o.day, caption: '', path, author: myName() }) });
        PH.push(row[0]); ok++;
      } catch (e) { netFail++; } // 전송 실패
    }
    ls.set('tm2-photos-' + T.id, PH);
    toast(ok === list.length ? `사진 ${ok}장 저장 완료` : [`${ok}장 저장`, badFile ? `${badFile}장은 열 수 없는 파일` : '', netFail ? `${netFail}장 전송 실패(인터넷 확인 후 다시)` : ''].filter(Boolean).join(' · '), 4000);
    render();
  }

  /* =================== 라우터 =================== */
  let cur = 'home';
  let lastRoute = '';
  function render(animate) {
    const route = location.hash.replace(/^#/, '') || 'home';
    const [page, param] = route.split('/');
    cur = pages[page] ? page : 'home';
    // 같은 화면을 다시 그릴 때는 펼친 카드·스크롤 위치를 그대로 유지
    const same = route === lastRoute;
    const openIdx = same ? $$('details', app).map((d, i) => d.open ? i : -1).filter(i => i >= 0) : [];
    const y = same ? window.scrollY : 0;
    const needDb = ['orgs', 'org', 'daily', 'report'].includes(cur);
    app.innerHTML = needDb && !READY ? setupPage() : pages[cur](param);
    if (same) { const ds = $$('details', app); openIdx.forEach(i => { if (ds[i]) ds[i].open = true; }); window.scrollTo(0, y); }
    lastRoute = route;
    const navOf = { org: 'orgs', daily: 'report', report: 'report' }; // 일일보고·결과보고서는 '보고' 탭 하나
    $$('.bottom-nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === (navOf[cur] || cur)));
    growAll();
    if (animate) { app.classList.remove('page-in'); requestAnimationFrame(() => app.classList.add('page-in')); } // 강제 재계산 없이 애니메이션 재시작
  }
  function grow(t) { t.style.height = 'auto'; t.style.height = Math.max(t.scrollHeight + 4, 90) + 'px'; }
  function growAll() { // 읽기→쓰기를 한꺼번에 해서 화면 재계산을 최소화
    const ts = $$('textarea.inp', app);
    ts.forEach(t => { t.style.height = 'auto'; });
    const hs = ts.map(t => Math.max(t.scrollHeight + 4, 90));
    ts.forEach((t, i) => { t.style.height = hs[i] + 'px'; });
  }
  const refresh = () => pull().then(changed => { if (changed && !isTyping()) render(false); });
  // #report/day3 처럼 오면 결과보고서의 그 날 줄로 이동해 잠깐 강조
  function scrollAnchor() {
    const m = /^#report\/day(\d)$/.exec(location.hash); if (!m) return;
    const row = document.getElementById('rep-day' + m[1]); if (!row) return;
    row.scrollIntoView({ block: 'center' }); // 즉시 이동 (배경 새로고침이 와도 위치 유지)
    row.classList.remove('hl'); requestAnimationFrame(() => row.classList.add('hl'));
  }
  window.addEventListener('hashchange', () => { render(true); window.scrollTo(0, 0); scrollAnchor(); if (READY) refresh(); });

  /* =================== 이벤트 =================== */
  app.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.key) {
      put(el.dataset.key, el.value); grow(el);
      const w = app.querySelector(`[data-w="${el.dataset.key}"]`); if (w) w.textContent = writerText(el.dataset.key); const q = el.closest('.qa-item'); if (q) q.classList.toggle('done', !!el.value.trim()); return; }
    if (el.dataset.photo) {
      const p = PH.find(x => x.id === el.dataset.photo); if (!p) return; p.caption = el.value;
      clearTimeout(p._t); p._t = setTimeout(() => sb(`/rest/v1/photos?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ caption: p.caption }) }).then(syncStatus).catch(() => toast('설명 저장 실패 – 인터넷을 확인해 주세요')), 700);
      return;
    }
    if (el.id === 'cny') { const n = parseFloat(el.value.replace(/,/g, '')); $('#krwOut').textContent = isNaN(n) ? '' : '= ' + Math.round(n * T.rate).toLocaleString('ko-KR') + '원'; }
  });
  app.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.upload && el.files.length) upload(el.files, el.dataset.upload);
  });
  document.addEventListener('click', async e => {
    const f = e.target.closest('.fs-btns button'); if (f) { setFs(f.dataset.fs, true); return; }
    const el = e.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act;
    if (a === 'go') { location.hash = el.dataset.to; return; }
    if (a === 'home') { // 로고·제목: 처음 화면(오늘 일정)으로
      e.preventDefault();
      if (location.hash === '#home' || location.hash === '') { render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else location.hash = 'home';
      return;
    }
    if (a === 'name') { openName(); return; }
    if (a === 'name-save') {
      const n = $('#nameInput').value.trim(); if (!n) { $('#nameInput').focus(); return; }
      try { localStorage.setItem('tm-name', n); } catch (e2) { /* ignore */ }
      $('#nameModal').classList.remove('on'); showWho(); return;
    }
    if (a === 'taxi') {
      e.preventDefault();
      let cn, addr, ph, ko;
      if (el.dataset.kind === 'hotel') { const h = T.hotels[+el.dataset.i]; cn = h.cn; addr = h.cnAddr; ph = h.tel; ko = h.ko; }
      else { const o = orgById(el.dataset.id); cn = o.cn; ko = o.name; }
      $('#taxi').innerHTML = `<div class="hint">기사님께 보여주세요<br><span class="cn">请带我去这里，谢谢！</span></div><div class="cn-big cn">${esc(cn)}</div>${addr ? `<div class="cn-addr cn">${esc(addr)}</div>` : ''}${ph ? `<a class="big" href="tel:${tel(ph)}">☎ ${esc(ph)}</a>` : ''}<div class="muted" style="margin:12px 0 24px">${esc(ko)}</div><button class="btn" data-act="taxi-close" style="min-width:60%">닫기</button>`;
      $('#taxi').classList.add('on'); return;
    }
    if (a === 'taxi-close') { $('#taxi').classList.remove('on'); return; }
    if (a === 'view') { $('#viewer img').src = el.src; $('#viewer').classList.add('on'); return; }
    if (a === 'q-add') {
      const t = $('#newq'); const q = t.value.trim(); if (!q) { t.focus(); return; }
      put(`qx:${el.dataset.org}:${Date.now().toString(36)}`, q); await push(); render(); toast('질문을 추가했습니다'); return;
    }
    if (a === 'q-edit' || a === 'q-cancel') { // 질문 수정 칸 열기/닫기
      const item = el.closest('.qa-item'); const ed = $('.q-editor', item); const open = a === 'q-edit';
      ed.hidden = !open; $('.q-row', item).hidden = open;
      if (open) { const t = $('textarea', ed); grow(t); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
      else { $('textarea', ed).value = $('.q-text', item).textContent; }
      return;
    }
    if (a === 'q-save') {
      const t = $('textarea', el.closest('.q-editor')); const q = t.value.trim();
      if (!q) { toast('질문 내용을 입력해 주세요'); t.focus(); return; }
      put(el.dataset.key, q); await push(); render(); toast('질문을 수정했습니다'); return;
    }
    if (a === 'q-restore') { put(el.dataset.key, ''); await push(); render(); toast('원래 질문으로 되돌렸습니다'); return; }
    if (a === 'q-del') { if (!confirm('이 질문을 삭제할까요?')) return; put(el.dataset.key, ''); await push(); render(); return; }
    if (a === 'ph-del') {
      if (!confirm('이 사진을 삭제할까요?')) return;
      const p = PH.find(x => x.id === el.dataset.id); if (!p) return;
      try {
        await fetch(`${BASE}/storage/v1/object/${BUCKET}/${p.path}`, { method: 'DELETE', headers: headers() });
        await sb(`/rest/v1/photos?id=eq.${p.id}`, { method: 'DELETE' });
        PH = PH.filter(x => x.id !== p.id); ls.set('tm2-photos-' + T.id, PH); render();
      } catch (e2) { toast('삭제 실패 – 인터넷을 확인해 주세요'); }
      return;
    }
    if (a === 'share') {
      await push(); const text = dailyText(+el.dataset.n);
      if (navigator.share) { try { await navigator.share({ text }); return; } catch (e2) { if (e2.name === 'AbortError') return; } }
      try { await navigator.clipboard.writeText(text); toast('복사했습니다. 카톡에 붙여넣기 하세요', 3000); } catch (e3) { toast('복사 실패'); }
      return;
    }
    if (a === 'print') { await push(); window.print(); return; }
    if (a === 'doc') {
      await push(); const r = buildReport();
      const css = `body{font-family:'맑은 고딕',sans-serif;font-size:11pt;line-height:1.6}h1{text-align:center;font-size:18pt;border:3px double #000;padding:8pt}h2{font-size:14pt;border-bottom:1.5pt solid #000}table{border-collapse:collapse;width:100%}th,td{border:1px solid #555;padding:4pt 6pt;vertical-align:top;text-align:left}th{background:#e9ecf4;width:20%}.rep-org{text-align:center}.empty{color:#999}figure{display:inline-block;width:45%;margin:4pt}img{width:300px}figcaption{font-size:9pt}`;
      const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><style>${css}</style></head><body>${r.html}</body></html>`;
      const aEl = document.createElement('a'); aEl.href = URL.createObjectURL(new Blob(['﻿', html], { type: 'application/msword' }));
      aEl.download = r.title.replace(/[\\/:*?"<>|]/g, '') + '.doc'; document.body.appendChild(aEl); aEl.click(); aEl.remove();
      return;
    }
  });
  $('#viewer').addEventListener('click', () => $('#viewer').classList.remove('on'));

  function setFs(n, save) {
    document.documentElement.dataset.fs = n;
    if (save) { try { localStorage.setItem('tm-fs-v2', n); } catch (e) { /* ignore */ } } // 직접 고른 크기만 기억
    $$('.fs-btns button').forEach(b => b.classList.toggle('on', b.dataset.fs === String(n)));
  }
  function showWho() { $('#who').textContent = myName() ? `✏️ ${myName()}` : '✏️ 기록자 이름 설정'; }
  function openName() { $('#nameInput').value = myName(); $('#nameModal').classList.add('on'); setTimeout(() => $('#nameInput').focus(), 50); }

  /* =================== 한국·중국 시계 (기기 시간대와 무관하게 정확) =================== */
  const clkFmt = tz => { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); } catch (e) { return null; } };
  const fKR = clkFmt('Asia/Seoul'), fCN = clkFmt('Asia/Shanghai');
  function clockParts(f, offsetH) {
    if (f) return f.format(new Date()).split(':');
    const d = new Date(Date.now() + (offsetH * 60 + new Date().getTimezoneOffset()) * 60000);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(pad);
  }
  // 시계 숫자만 글자로 바꿔 끼움 (매초 HTML을 새로 만들지 않아 가벼움)
  const CLK = [['#clkKR', fKR, 9], ['#clkCN', fCN, 8]].map(([sel, f, off]) => {
    const el = $(sel); if (!el) return null;
    el.textContent = ''; const hm = document.createTextNode(''); const s = document.createElement('small');
    el.append(hm, s); return { f, off, hm, s, lastHm: '' };
  }).filter(Boolean);
  function tick() {
    if (document.hidden) return; // 화면이 꺼져 있으면 쉬기 (배터리 절약)
    CLK.forEach(c => { const [h, m, sec] = clockParts(c.f, c.off); const hmT = h + ':' + m; if (hmT !== c.lastHm) { c.hm.data = hmT; c.lastHm = hmT; } c.s.textContent = ':' + sec; });
  }
  tick(); setInterval(tick, 1000);
  document.addEventListener('visibilitychange', tick);

  /* =================== 시작 =================== */
  setFs(document.documentElement.dataset.fs || '1'); // 기본: 가장 작은 글씨
  showWho(); syncStatus(); render(true); scrollAnchor();
  if (READY) { refresh().then(() => push()); if (!myName()) openName(); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
