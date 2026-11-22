/* 한글(HWPX) 공문서 파일 만들기 – 외부 라이브러리 없이 브라우저에서 바로 생성
   model: [{t:'title'|'date'|'h1'|'sq'|'ci'|'da'|'note'|'gap', text, sig?}, {t:'table', widths:[mm], head:[..], rows:[[{text,align}]]}]
   서식 번호는 hwpx/header.xml(한글 기본 서식 + 공문서 서식)과 맞춰져 있음 */
(function (root) {
  'use strict';
  const C = { title: 7, date: 8, h1: 9, sq: 10, body: 11, dash: 12, note: 13, th: 14, td: 15, sig: 16 };      // 글자 모양
  const P = { title: 20, date: 21, h1: 22, sq: 23, ci: 24, da: 25, note: 26, tdc: 27, tdl: 28, gap: 29 };    // 문단 모양
  const BF = { cell: 3, head: 4, titleBox: 5 };
  const MM = 283.465; // 1mm = 283.465 HWPUNIT
  const TEXT_W = Math.round(170 * MM); // A4(210mm) - 좌우 여백 20mm씩

  const x = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const run = (cid, text) => `<hp:run charPrIDRef="${cid}"><hp:t>${x(text)}</hp:t></hp:run>`;
  const para = (pid, runs) => `<hp:p id="0" paraPrIDRef="${pid}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${runs}</hp:p>`;

  // 문서 첫 문단: A4, 여백(위 20·아래 15·좌우 20mm), 머리말/꼬리말 10mm
  const SEC_PR = '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">'
    + '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/><hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>'
    + '<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>'
    + '<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>'
    + `<hp:pagePr landscape="WIDELY" width="59528" height="84186" gutterType="LEFT_ONLY"><hp:margin header="${Math.round(10 * MM)}" footer="${Math.round(10 * MM)}" gutter="0" left="${Math.round(20 * MM)}" right="${Math.round(20 * MM)}" top="${Math.round(20 * MM)}" bottom="${Math.round(15 * MM)}"/></hp:pagePr>`
    + '<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>'
    + '<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>'
    + ['BOTH', 'EVEN', 'ODD'].map(t => `<hp:pageBorderFill type="${t}" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>`).join('')
    + '</hp:secPr>';
  const COL_PR = '<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>';
  // 쪽 번호: 아래 가운데 "- 1 -"
  const PAGE_NUM = '<hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/></hp:ctrl>';

  let zOrder = 0;
  function cellParas(text, align, bold) {
    const pid = align === 'left' ? P.tdl : P.tdc, cid = bold ? C.th : C.td;
    const lines = String(text == null ? '' : text).split('\n');
    return lines.map(l => para(pid, run(cid, l))).join('');
  }
  function table(b) {
    const widths = b.widths.map(w => Math.round(w * MM));
    const total = widths.reduce((a, c) => a + c, 0);
    const rows = (b.head ? [b.head.map(h => ({ text: h, head: true }))] : []).concat(b.rows);
    const H = 1700;
    const tr = rows.map((r, ri) => '<hp:tr>' + r.map((cell, ci) => {
      const c = typeof cell === 'object' ? cell : { text: cell };
      const head = !!c.head || !!c.th;
      return `<hp:tc name="" header="${head && ri === 0 && b.head ? 1 : 0}" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${head ? BF.head : BF.cell}">`
        + '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">'
        + cellParas(c.text, head ? 'center' : (c.align || 'left'), head || c.bold) + '</hp:subList>'
        + `<hp:cellAddr colAddr="${ci}" rowAddr="${ri}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${widths[ci]}" height="${H}"/>`
        + '<hp:cellMargin left="510" right="510" top="283" bottom="283"/></hp:tc>';
    }).join('') + '</hp:tr>').join('');
    zOrder++;
    return para(P.gap, `<hp:run charPrIDRef="${C.td}"><hp:tbl id="${1000 + zOrder}" zOrder="${zOrder}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${rows.length}" colCnt="${widths.length}" cellSpacing="0" borderFillIDRef="${BF.cell}" noAdjust="0">`
      + `<hp:sz width="${total}" widthRelTo="ABSOLUTE" height="${H * rows.length}" heightRelTo="ABSOLUTE" protect="0"/>`
      + '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
      + '<hp:outMargin left="0" right="0" top="141" bottom="141"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>'
      + tr + '</hp:tbl></hp:run>');
  }
  // 줄바꿈이 있는 글은 같은 수준의 문단으로 나눔 (첫 줄만 기호)
  function block(b) {
    const map = { title: [P.title, C.title], date: [P.date, C.date], h1: [P.h1, C.h1], sq: [P.sq, C.sq], ci: [P.ci, C.body], da: [P.da, C.dash], note: [P.note, C.note], gap: [P.gap, C.td] };
    if (b.t === 'table') return table(b);
    if (b.t === 'title') { // 제목: 위·아래 굵은 줄이 있는 한 칸짜리 표 (여러 줄이어도 상자 하나)
      zOrder++;
      const W = TEXT_W, paras = String(b.text).split('\n').map(l => para(P.title, run(C.title, l))).join('');
      return para(P.gap, `<hp:run charPrIDRef="${C.td}"><hp:tbl id="${1000 + zOrder}" zOrder="${zOrder}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="1" colCnt="1" cellSpacing="0" borderFillIDRef="${BF.titleBox}" noAdjust="0">`
        + `<hp:sz width="${W}" widthRelTo="ABSOLUTE" height="4000" heightRelTo="ABSOLUTE" protect="0"/>`
        + '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
        + '<hp:outMargin left="0" right="0" top="0" bottom="600"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>'
        + `<hp:tr><hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${BF.titleBox}">`
        + '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">'
        + paras + '</hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>'
        + `<hp:cellSz width="${W}" height="4000"/><hp:cellMargin left="510" right="510" top="700" bottom="700"/></hp:tc></hp:tr></hp:tbl></hp:run>`);
    }
    const [pid, cid] = map[b.t];
    const lines = String(b.text == null ? '' : b.text).split('\n');
    return lines.map((l, i) => {
      let runs = run(cid, l);
      if (b.label && i === 0) runs = run(C.sq, b.label) + run(cid, l);
      if (b.sig && i === lines.length - 1) runs += run(C.sig, ' (' + b.sig + ')');
      return para(pid, runs);
    }).join('');
  }
  function section(model) {
    zOrder = 0;
    const first = `<hp:p id="0" paraPrIDRef="${P.gap}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${C.td}">${SEC_PR}${COL_PR}${PAGE_NUM}</hp:run><hp:run charPrIDRef="${C.td}"><hp:t/></hp:run></hp:p>`;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'
      + '<hs:sec xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0">'
      + first + model.map(block).join('') + '</hs:sec>';
  }

  /* ---------- 압축(zip, 무압축 저장) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) { // files: [{name, data: Uint8Array}]
    const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
    const d = new Date(); const dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosT, true); lh.setUint16(12, dosD, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosT, true); ch.setUint16(14, dosD, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + size;
    }
    const cSize = central.reduce((a, p) => a + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cSize, true); end.setUint32(16, off, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0)); let p = 0;
    all.forEach(a => { out.set(a, p); p += a.length; });
    return out;
  }

  /* ---------- HWPX 묶음 ---------- */
  function build(model, headerXml, meta) {
    const enc = new TextEncoder(); const f = (name, s) => ({ name, data: typeof s === 'string' ? enc.encode(s) : s });
    const NS = 'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const hpf = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><opf:package ${NS} version="" unique-identifier="" id=""><opf:metadata><opf:title>${x(meta.title)}</opf:title><opf:language>ko</opf:language><opf:meta name="creator" content="text">${x(meta.creator || '')}</opf:meta><opf:meta name="subject" content="text"/><opf:meta name="description" content="text"/><opf:meta name="lastsaveby" content="text">${x(meta.creator || '')}</opf:meta><opf:meta name="CreatedDate" content="text">${now}</opf:meta><opf:meta name="ModifiedDate" content="text">${now}</opf:meta><opf:meta name="keyword" content="text"/></opf:metadata><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`;
    const plain = model.filter(b => b.t !== 'table').map(b => b.text).join('\n').slice(0, 1000);
    return zip([
      f('mimetype', 'application/hwp+zip'),
      f('version.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="1" buildNumber="0" os="1" xmlVersion="1.5" application="Hancom Office Hangul" appVersion="13, 0, 0, 532 WIN32LEWindows_10"/>'),
      f('Contents/header.xml', headerXml),
      f('Contents/section0.xml', section(model)),
      f('Preview/PrvText.txt', plain),
      f('settings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>'),
      f('META-INF/container.rdf', '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/header.xml"/></rdf:Description><rdf:Description rdf:about="Contents/header.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#HeaderFile"/></rdf:Description><rdf:Description rdf:about=""><ns0:hasPart xmlns:ns0="http://www.hancom.co.kr/hwpml/2016/meta/pkg#" rdf:resource="Contents/section0.xml"/></rdf:Description><rdf:Description rdf:about="Contents/section0.xml"><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#SectionFile"/></rdf:Description><rdf:Description rdf:about=""><rdf:type rdf:resource="http://www.hancom.co.kr/hwpml/2016/meta/pkg#Document"/></rdf:Description></rdf:RDF>'),
      f('Contents/content.hpf', hpf),
      f('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/><ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/><ocf:rootfile full-path="META-INF/container.rdf" media-type="application/rdf+xml"/></ocf:rootfiles></ocf:container>'),
      f('META-INF/manifest.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>')
    ]);
  }

  const api = { build, section, zip, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HWPX = api;
})(typeof window !== 'undefined' ? window : globalThis);
