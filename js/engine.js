(function () {
  "use strict";
  var A4 = { w: 595.2756, h: 841.8898 };
  var PDFDocument = PDFLib.PDFDocument;
  var degrees = PDFLib.degrees;

  function norm360(deg) {
    return ((deg % 360) + 360) % 360;
  }

  function pageGeometry(page) {
    var W = page.getWidth();
    var H = page.getHeight();
    var R = norm360(page.getRotation().angle);
    var rotated = R === 90 || R === 270;
    return {
      W: W,
      H: H,
      R: R,
      effW: rotated ? H : W,
      effH: rotated ? W : H,
      landscape: rotated ? H > W : W > H,
    };
  }

  function isA4Portrait(g) {
    return !g.landscape && Math.abs(g.effW - A4.w) < 3 && Math.abs(g.effH - A4.h) < 3 && (g.R === 0 || g.R === 180);
  }

  async function analyze(bytes) {
    var doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    var count = doc.getPageCount();
    var landscape = 0;
    for (var i = 0; i < count; i++) {
      if (pageGeometry(doc.getPage(i)).landscape) landscape++;
    }
    return { pageCount: count, landscape: landscape, portrait: count - landscape };
  }

  async function appendPage(out, src, idx, autoPortrait) {
    var sp = src.getPage(idx);
    var g = pageGeometry(sp);
    if (!autoPortrait) {
      var plain = await out.copyPages(src, [idx]);
      out.addPage(plain[0]);
      return;
    }
    if (isA4Portrait(g)) {
      var fast = await out.copyPages(src, [idx]);
      out.addPage(fast[0]);
      return;
    }
    var embedded = await out.embedPage(sp);
    var theta = norm360(-g.R);
    if (g.landscape) theta = norm360(theta + 90);
    var s;
    if (theta === 0 || theta === 180) {
      s = Math.min(A4.w / g.W, A4.h / g.H);
    } else {
      s = Math.min(A4.w / g.H, A4.h / g.W);
    }
    var dw = g.W * s;
    var dh = g.H * s;
    var cx, cy;
    if (theta === 0) { cx = (A4.w - dw) / 2; cy = (A4.h - dh) / 2; }
    else if (theta === 90) { cx = (A4.w + dh) / 2; cy = (A4.h - dw) / 2; }
    else if (theta === 180) { cx = (A4.w + dw) / 2; cy = (A4.h + dh) / 2; }
    else { cx = (A4.w - dh) / 2; cy = (A4.h + dw) / 2; }
    var page = out.addPage([A4.w, A4.h]);
    page.drawPage(embedded, { x: cx, y: cy, width: dw, height: dh, rotate: degrees(theta) });
  }

  function firstPageSize(src) {
    if (src.getPageCount() === 0) return A4;
    var g = pageGeometry(src.getPage(0));
    return { w: g.W, h: g.H };
  }

  async function processBatch(items, onProgress) {
    var out = await PDFDocument.create();
    var report = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var src = await PDFDocument.load(item.bytes, { ignoreEncryption: true });
      var unitStart = out.getPageCount();
      for (var idx = 0; idx < src.getPageCount(); idx++) {
        await appendPage(out, src, idx, item.autoPortrait);
      }
      var unitLen = out.getPageCount() - unitStart;
      var needPad = item.duplex && unitLen % 2 === 1;
      if (needPad) {
        var bs = item.autoPortrait ? A4 : firstPageSize(src);
        out.addPage([bs.w, bs.h]);
        unitLen += 1;
      }
      for (var c = 1; c < item.copies; c++) {
        var idxs = new Array(unitLen);
        for (var k = 0; k < unitLen; k++) idxs[k] = unitStart + k;
        var added = await out.copyPages(out, idxs);
        for (var p = 0; p < added.length; p++) out.addPage(added[p]);
      }
      var sheetUnit = item.duplex ? Math.ceil(unitLen / 2) : unitLen;
      report.push({ name: item.name, unitLen: unitLen, padded: needPad, copies: item.copies, total: unitLen * item.copies, sheets: sheetUnit * item.copies });
      if (onProgress) onProgress({ done: i + 1, total: items.length });
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    var bytes = await out.save();
    return { bytes: bytes, report: report };
  }

  window.PdfEngine = { analyze: analyze, processBatch: processBatch, A4: A4 };
})();
