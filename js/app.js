(function () {
  "use strict";

  pdfjsLib.GlobalWorkerOptions.workerSrc = "libs/pdf.worker.min.js";

  var els = {};
  var state = { docs: [], output: null };
  var nextId = 1;
  var pdfjsCache = new Map();
  var viewers = new Set();

  function $(sel, el) {
    return (el || document).querySelector(sel);
  }

  function $$(sel, el) {
    return Array.prototype.slice.call((el || document).querySelectorAll(sel));
  }

  function init() {
    els.headerDocs = $("#headerDocs");
    els.dropzone = $("#dropzone");
    els.fileInput = $("#fileInput");
    els.pickBtn = $("#pickBtn");
    els.docList = $("#docList");
    els.emptyNote = $("#emptyNote");
    els.summaryBar = $("#summaryBar");
    els.statDocs = $("#statDocs");
    els.statPages = $("#statPages");
    els.statSheets = $("#statSheets");
    els.clearBtn = $("#clearBtn");
    els.exportBtn = $("#exportBtn");
    els.outputEmpty = $("#outputEmpty");
    els.outputWrap = $("#outputWrap");
    els.outName = $("#outName");
    els.outStats = $("#outStats");
    els.outputViewer = $("#outputViewer");
    els.goDocsBtn = $("#goDocsBtn");
    els.downloadBtn = $("#downloadBtn");
    els.previewModal = $("#previewModal");
    els.previewTitle = $("#previewTitle");
    els.previewBody = $("#previewBody");
    els.progressOverlay = $("#progressOverlay");
    els.progressFill = $("#progressFill");
    els.progressText = $("#progressText");
    els.tabDocs = $("#tab-docs");
    els.tabOutput = $("#tab-output");

    moveIndicator($(".seg-tabs"), $('.seg-tabs .seg-item[data-tab="docs"]'));

    els.pickBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      els.fileInput.click();
    });

    els.fileInput.addEventListener("change", function () {
      addFiles(els.fileInput.files);
      els.fileInput.value = "";
    });

    els.dropzone.addEventListener("click", function (e) {
      if (e.target.closest("button")) return;
      els.fileInput.click();
    });

    els.dropzone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        els.fileInput.click();
      }
    });

    ["dragenter", "dragover"].forEach(function (ev) {
      els.dropzone.addEventListener(ev, function (e) {
        e.preventDefault();
        els.dropzone.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach(function (ev) {
      els.dropzone.addEventListener(ev, function (e) {
        e.preventDefault();
        els.dropzone.classList.remove("dragover");
      });
    });

    els.dropzone.addEventListener("drop", function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });

    els.clearBtn.addEventListener("click", clearAll);
    els.exportBtn.addEventListener("click", runExport);
    els.goDocsBtn.addEventListener("click", function () { switchTab("docs"); });
    els.downloadBtn.addEventListener("click", downloadOutput);

    els.docList.addEventListener("click", onListClick);
    els.docList.addEventListener("change", onListChange);

    $$(".seg-tabs .seg-item").forEach(function (b) {
      b.addEventListener("click", function () { switchTab(b.dataset.tab); });
    });

    els.previewModal.addEventListener("click", function (e) {
      if (e.target === els.previewModal) closePreview();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closePreview();
        if (!els.progressOverlay.hidden) hideProgress();
      }
    });

    window.addEventListener("resize", debounce(function () {
      viewers.forEach(function (v) { v.refresh(); });
    }, 200));
  }

  /* ---------- upload ---------- */

  async function addFiles(fileList) {
    var files = Array.prototype.filter.call(fileList, function (f) {
      return f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    });
    if (!files.length) return;
    if (state.docs.length + files.length > 60) {
      alert("每次最多處理 60 份文件。");
      return;
    }
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      try {
        var bytes = new Uint8Array(await file.arrayBuffer());
        var analysis = await PdfEngine.analyze(bytes);
        var doc = {
          id: nextId++,
          name: file.name,
          bytes: bytes,
          analysis: analysis,
          settings: { copies: 1, side: "duplex", color: "color", orient: "auto" },
        };
        state.docs.push(doc);
        appendRow(doc);
      } catch (err) {
        console.error("讀取失敗：", file.name, err);
      }
    }
    updateSummary();
    if (state.docs.length) switchTab("docs");
  }

  function appendRow(doc) {
    var row = buildRow(doc);
    doc._row = row;
    els.docList.hidden = false;
    els.docList.appendChild(row);
    $$(".seg", row).forEach(function (seg) {
      var setting = seg.dataset.setting;
      setSegValue(seg, doc.settings[setting]);
    });
    updateRow(doc);
    setThumb(doc);
  }

  function buildRow(doc) {
    var a = doc.analysis;
    var orientText = a.landscape === 0 ? "直向" : a.portrait === 0 ? "橫向" : "直向 " + a.portrait + " · 橫向 " + a.landscape;
    var row = document.createElement("div");
    row.className = "doc-row";
    row.dataset.id = doc.id;
    row.innerHTML =
      '<div class="doc-head">' +
        '<div class="doc-thumb"><canvas></canvas><span class="thumb-empty">—</span></div>' +
        '<div class="doc-info">' +
          '<div class="doc-name"></div>' +
          '<div class="doc-meta">' +
            '<span data-meta-pages></span>' +
            '<span class="dot"></span>' +
            '<span data-meta-orient></span>' +
            '<span class="chip" data-chip-pad hidden>補 1 頁空白</span>' +
            '<span class="chip chip-warn" data-hint-orient hidden>橫向 → 轉直向</span>' +
          "</div>" +
        "</div>" +
        '<div class="doc-actions">' +
          '<button type="button" class="btn btn-sm" data-action="preview">預覽</button>' +
          '<button type="button" class="btn btn-icon" data-action="remove" aria-label="移除">×</button>' +
        "</div>" +
      "</div>" +
      '<div class="doc-settings">' +
        '<div class="field"><label class="field-label">份數</label><div class="stepper">' +
          '<button type="button" data-action="copies-dec" aria-label="減少份數">−</button>' +
          '<input class="copies-input" type="number" min="1" max="999" value="1" aria-label="份數">' +
          '<button type="button" data-action="copies-inc" aria-label="增加份數">+</button>' +
        "</div></div>" +
        '<div class="field"><label class="field-label">打印面</label>' + segHtml("side", [
          { value: "duplex", label: "雙面" },
          { value: "simplex", label: "單面" },
        ], doc.settings.side) + "</div>" +
        '<div class="field"><label class="field-label">顏色</label>' + segHtml("color", [
          { value: "color", label: "彩色" },
          { value: "mono", label: "黑白" },
        ], doc.settings.color) + "</div>" +
        '<div class="field"><label class="field-label">方向</label>' + segHtml("orient", [
          { value: "auto", label: "轉直向" },
          { value: "keep", label: "保留" },
        ], doc.settings.orient) + "</div>" +
        '<div class="doc-estimate">' +
          '<span class="est-num" data-est-num>0</span><span>輸出頁</span>' +
          '<span class="meta" data-est-sub></span>' +
        "</div>" +
      "</div>";
    row.querySelector(".doc-name").textContent = doc.name;
    row.querySelector("[data-meta-pages]").textContent = a.pageCount + " 頁";
    row.querySelector("[data-meta-orient]").textContent = orientText;
    return row;
  }

  function segHtml(setting, options, current) {
    var html = '<div class="seg" data-setting="' + setting + '">';
    for (var i = 0; i < options.length; i++) {
      var o = options[i];
      html += '<button type="button" class="seg-item" data-opt="' + o.value + '" aria-selected="' + (o.value === current ? "true" : "false") + '">' + o.label + "</button>";
    }
    html += '<span class="seg-indicator" aria-hidden="true"></span></div>';
    return html;
  }

  function setSegValue(seg, value) {
    var btn = seg.querySelector('[data-opt="' + value + '"]');
    $$(".seg-item", seg).forEach(function (b) {
      b.setAttribute("aria-selected", b === btn ? "true" : "false");
    });
    moveIndicator(seg, btn);
  }

  function moveIndicator(seg, active) {
    var ind = seg.querySelector(".seg-indicator");
    if (!ind || !active) return;
    var sb = seg.getBoundingClientRect();
    var ab = active.getBoundingClientRect();
    ind.style.width = ab.width + "px";
    ind.style.transform = "translateX(" + (ab.left - sb.left) + "px)";
  }

  /* ---------- list events ---------- */

  function onListClick(e) {
    var segBtn = e.target.closest(".seg-item");
    if (segBtn) {
      var seg = segBtn.closest(".seg[data-setting]");
      var rowEl = segBtn.closest(".doc-row");
      var doc = getDoc(rowEl.dataset.id);
      var setting = seg.dataset.setting;
      doc.settings[setting] = segBtn.dataset.opt;
      setSegValue(seg, segBtn.dataset.opt);
      updateRow(doc);
      updateSummary();
      return;
    }
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var action = btn.dataset.action;
    var id = btn.closest(".doc-row") ? btn.closest(".doc-row").dataset.id : null;
    if (action === "preview" && id) openPreview(id);
    if (action === "remove" && id) removeDoc(id);
    if (action === "copies-dec") changeCopies(id, -1);
    if (action === "copies-inc") changeCopies(id, 1);
  }

  function onListChange(e) {
    var inp = e.target.closest(".copies-input");
    if (!inp) return;
    var doc = getDoc(inp.closest(".doc-row").dataset.id);
    var v = parseInt(inp.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    if (v > 999) v = 999;
    inp.value = v;
    doc.settings.copies = v;
    updateRow(doc);
    updateSummary();
  }

  function changeCopies(id, delta) {
    var doc = getDoc(id);
    if (!doc) return;
    var inp = doc._row.querySelector(".copies-input");
    var v = (parseInt(inp.value, 10) || 1) + delta;
    if (v < 1) v = 1;
    if (v > 999) v = 999;
    inp.value = v;
    doc.settings.copies = v;
    updateRow(doc);
    updateSummary();
  }

  function getDoc(id) {
    for (var i = 0; i < state.docs.length; i++) {
      if (String(state.docs[i].id) === String(id)) return state.docs[i];
    }
    return null;
  }

  /* ---------- estimates / summary ---------- */

  function unitLenFor(doc) {
    var n = doc.analysis.pageCount;
    return doc.settings.side === "duplex" && n % 2 === 1 ? n + 1 : n;
  }

  function estFor(doc) {
    var unit = unitLenFor(doc);
    return { unit: unit, pages: unit * doc.settings.copies, sheets: Math.ceil(unit / 2) * doc.settings.copies };
  }

  function updateRow(doc) {
    if (!doc._row) return;
    var est = estFor(doc);
    doc._row.querySelector("[data-est-num]").textContent = est.pages;
    doc._row.querySelector("[data-est-sub]").textContent = "約 " + est.sheets + " 張";
    var padChip = doc._row.querySelector("[data-chip-pad]");
    if (padChip) padChip.hidden = !(doc.settings.side === "duplex" && doc.analysis.pageCount % 2 === 1);
    var hint = doc._row.querySelector("[data-hint-orient]");
    if (hint) hint.hidden = !(doc.settings.orient === "auto" && doc.analysis.landscape > 0);
  }

  function updateSummary() {
    var pages = 0;
    var sheets = 0;
    for (var i = 0; i < state.docs.length; i++) {
      var est = estFor(state.docs[i]);
      pages += est.pages;
      sheets += est.sheets;
    }
    els.headerDocs.textContent = state.docs.length;
    els.statDocs.textContent = state.docs.length;
    els.statPages.textContent = pages.toLocaleString("en-US");
    els.statSheets.textContent = sheets.toLocaleString("en-US");
    els.summaryBar.hidden = state.docs.length === 0;
    els.docList.hidden = state.docs.length === 0;
    els.emptyNote.hidden = state.docs.length !== 0;
  }

  /* ---------- thumbnails ---------- */

  async function setThumb(doc) {
    try {
      var pdf = await getPdfjs(doc);
      var page = await pdf.getPage(1);
      var v0 = page.getViewport({ scale: 1 });
      var scale = 56 / v0.height;
      var vp = page.getViewport({ scale: scale });
      var canvas = doc._row.querySelector(".doc-thumb canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      doc._row.querySelector(".doc-thumb .thumb-empty").hidden = true;
    } catch (err) {
      console.error("縮圖失敗：", doc.name, err);
    }
  }

  function getPdfjs(doc) {
    if (!pdfjsCache.has(doc.id)) {
      pdfjsCache.set(doc.id, pdfjsLib.getDocument({ data: doc.bytes.slice(0) }).promise);
    }
    return pdfjsCache.get(doc.id);
  }

  function removeDoc(id) {
    var idx = -1;
    for (var i = 0; i < state.docs.length; i++) {
      if (String(state.docs[i].id) === String(id)) idx = i;
    }
    if (idx < 0) return;
    var doc = state.docs[idx];
    if (doc._row) doc._row.remove();
    var p = pdfjsCache.get(doc.id);
    if (p) p.then(function (pdf) { try { pdf.destroy(); } catch (e) {} });
    pdfjsCache.delete(doc.id);
    state.docs.splice(idx, 1);
    updateSummary();
  }

  function clearAll() {
    if (!state.docs.length) return;
    if (!confirm("清空全部 " + state.docs.length + " 份文件？")) return;
    state.docs.slice().forEach(function (d) { removeDoc(d.id); });
    state.output = null;
    resetOutputView();
  }

  /* ---------- tabs ---------- */

  function switchTab(name) {
    $$(".seg-tabs .seg-item").forEach(function (b) {
      b.setAttribute("aria-selected", b.dataset.tab === name ? "true" : "false");
    });
    moveIndicator($(".seg-tabs"), $('.seg-tabs .seg-item[data-tab="' + name + '"]'));
    els.tabDocs.hidden = name !== "docs";
    els.tabOutput.hidden = name !== "output";
    if (name === "output") {
      setTimeout(function () { viewers.forEach(function (v) { v.refresh(); }); }, 50);
    }
  }

  /* ---------- export ---------- */

  async function runExport() {
    if (!state.docs.length) return;
    showProgress(0);
    try {
      var items = state.docs.map(function (d) {
        return {
          name: d.name,
          bytes: d.bytes,
          copies: d.settings.copies,
          duplex: d.settings.side === "duplex",
          autoPortrait: d.settings.orient === "auto",
        };
      });
      var res = await PdfEngine.processBatch(items, function (p) {
        showProgress(p.done / p.total, p.done + " / " + p.total);
      });
      state.output = { bytes: res.bytes, report: res.report };
      hideProgress();
      renderOutput();
      switchTab("output");
    } catch (err) {
      console.error(err);
      hideProgress();
      alert("處理失敗：" + (err && err.message ? err.message : err));
    }
  }

  function renderOutput() {
    var out = state.output;
    els.outputEmpty.hidden = true;
    els.outputWrap.hidden = false;
    var totalPages = 0;
    var totalSheets = 0;
    var allColor = true;
    var allMono = true;
    var allDuplex = true;
    var allSimplex = true;
    for (var i = 0; i < out.report.length; i++) {
      var r = out.report[i];
      totalPages += r.total;
      totalSheets += r.sheets;
    }
    for (var j = 0; j < state.docs.length; j++) {
      var s = state.docs[j].settings;
      if (s.color === "color") allMono = false;
      else allColor = false;
      if (s.side === "duplex") allSimplex = false;
      else allDuplex = false;
    }
    var colorText = allColor ? "彩色" : allMono ? "黑白" : "彩色 / 黑白混合";
    var sideText = allDuplex ? "雙面" : allSimplex ? "單面" : "單面 / 雙面混合";
    var now = new Date();
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    var name = "PDF-輸出-" + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + "-" + pad(now.getHours()) + pad(now.getMinutes()) + ".pdf";
    out.name = name;
    els.outName.textContent = name;
    els.outStats.textContent = state.docs.length + " 份文件 · " + totalPages.toLocaleString("en-US") + " 頁 · " + totalSheets.toLocaleString("en-US") + " 張 · " + sideText + " · " + colorText;
    els.outputViewer.innerHTML = "";
    var viewer = createViewer();
    els.outputViewer.appendChild(viewer.el);
    viewer.load(out.bytes);
  }

  function downloadOutput() {
    var out = state.output;
    if (!out) return;
    var blob = new Blob([out.bytes], { type: "application/pdf" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = out.name || "output.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function resetOutputView() {
    els.outputWrap.hidden = true;
    els.outputEmpty.hidden = false;
    els.outputViewer.innerHTML = "";
  }

  /* ---------- preview modal ---------- */

  var modalViewer = null;

  function openPreview(id) {
    var doc = getDoc(id);
    if (!doc) return;
    els.previewTitle.textContent = doc.name + " · " + doc.analysis.pageCount + " 頁";
    if (!modalViewer) {
      modalViewer = createViewer();
      els.previewBody.appendChild(modalViewer.el);
    }
    els.previewModal.hidden = false;
    modalViewer.load(doc.bytes);
  }

  function closePreview() {
    els.previewModal.hidden = true;
  }

  /* ---------- viewer ---------- */

  function createViewer() {
    var el = document.createElement("div");
    el.className = "viewer";
    el.innerHTML =
      '<div class="viewer-stage"><span class="loading">載入中…</span></div>' +
      '<div class="viewer-bar">' +
        '<button type="button" class="btn btn-icon" data-act="first" aria-label="第一頁">«</button>' +
        '<button type="button" class="btn btn-icon" data-act="prev" aria-label="上一頁">‹</button>' +
        '<input class="page-input" data-act="goto" type="number" min="1" value="1" aria-label="頁碼">' +
        '<span class="page-total" data-act="total">/ 0</span>' +
        '<button type="button" class="btn btn-icon" data-act="next" aria-label="下一頁">›</button>' +
        '<button type="button" class="btn btn-icon" data-act="last" aria-label="最後一頁">»</button>' +
      "</div>";

    var pdf = null;
    var page = 1;
    var total = 0;
    var renderTask = null;
    var disposed = false;

    function stage() {
      return el.querySelector(".viewer-stage");
    }

    async function render() {
      if (!pdf || disposed) return;
      if (renderTask) {
        try { renderTask.cancel(); } catch (e) {}
        renderTask = null;
      }
      var pageObj;
      try {
        pageObj = await pdf.getPage(page);
      } catch (e) {
        return;
      }
      if (disposed) return;
      var s = stage();
      var availW = Math.max(120, s.clientWidth - 48);
      var availH = Math.max(120, s.clientHeight - 48);
      var v0 = pageObj.getViewport({ scale: 1 });
      var scale = Math.min(availW / v0.width, availH / v0.height);
      scale = Math.max(0.15, Math.min(scale, 2.5));
      var vp = pageObj.getViewport({ scale: scale });
      var canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      s.innerHTML = "";
      s.appendChild(canvas);
      renderTask = pageObj.render({ canvasContext: canvas.getContext("2d"), viewport: vp });
      try {
        await renderTask.promise;
      } catch (e) {
        if (e && e.name === "RenderingCancelledException") return;
      }
    }

    async function load(bytes) {
      try { if (pdf) pdf.destroy(); } catch (e) {}
      pdf = null;
      var st = stage();
      st.innerHTML = '<span class="loading">載入中…</span>';
      var doc;
      try {
        doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
      } catch (e) {
        st.innerHTML = '<span class="loading">無法讀取 PDF</span>';
        return;
      }
      if (disposed) return;
      pdf = doc;
      total = doc.numPages;
      page = 1;
      var totalEl = el.querySelector("[data-act=total]");
      totalEl.textContent = "/ " + total;
      var inp = el.querySelector("[data-act=goto]");
      inp.max = total;
      inp.value = "1";
      await render();
    }

    function setPage(n) {
      if (!pdf || disposed) return;
      if (n < 1) n = 1;
      if (n > total) n = total;
      page = n;
      var inp = el.querySelector("[data-act=goto]");
      inp.value = n;
      render();
    }

    el.querySelector(".viewer-bar").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-act]");
      if (!btn || btn.dataset.act === "goto") return;
      var act = btn.dataset.act;
      if (act === "first") setPage(1);
      if (act === "prev") setPage(page - 1);
      if (act === "next") setPage(page + 1);
      if (act === "last") setPage(total);
    });

    el.querySelector("[data-act=goto]").addEventListener("change", function () {
      var v = parseInt(this.value, 10);
      if (isNaN(v)) v = page;
      setPage(v);
    });

    var viewer = {
      el: el,
      load: load,
      refresh: render,
      get total() { return total; },
      destroy: function () {
        disposed = true;
        if (renderTask) { try { renderTask.cancel(); } catch (e) {} }
        try { if (pdf) pdf.destroy(); } catch (e) {}
        viewers.delete(viewer);
      },
    };

    viewers.add(viewer);
    return viewer;
  }

  /* ---------- progress ---------- */

  function showProgress(frac, text) {
    els.progressOverlay.hidden = false;
    els.progressFill.style.width = Math.round((frac || 0) * 100) + "%";
    els.progressText.textContent = text || "處理緊…";
  }

  function hideProgress() {
    els.progressOverlay.hidden = true;
    els.progressFill.style.width = "0%";
  }

  function debounce(fn, wait) {
    var t = null;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, wait);
    };
  }

  document.addEventListener("DOMContentLoaded", init);
})();
