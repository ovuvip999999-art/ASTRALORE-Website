/* ASTRA visual PDF annotation editor.
 * Original PDF pages are preserved; annotations are layered on top in the exported copy.
 * Existing PDF text is not rewritten in place.
 */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const dialog = $("astraDocumentDialog");
  const title = $("astraDocumentTitle");
  const editor = $("astraDocumentText");
  const status = $("astraDocumentEditorStatus");
  const saveButton = $("astraDocumentSave");
  const pdfButton = $("astraDocumentExportPdf");
  const textButton = $("astraDocumentExportText");
  const aiInstruction = $("astraPdfAiInstruction");
  const aiButton = $("astraPdfAiApply");
  const closeButton = $("astraDocumentClose");
  const visual = $("astraPdfVisualEditor");
  const fallback = $("astraTextEditorFallback");
  const canvas = $("astraPdfCanvas");
  const stage = $("astraPdfPageStage");
  const overlayLayer = $("astraPdfOverlayLayer");
  const textLayer = $("astraPdfTextLayer");
  if (!dialog || !editor || !saveButton || !pdfButton || !textButton) return;

  const BUCKET = "astra-original-documents";
  let current = null, saveHandler = null, aiEditHandler = null, savedText = "", pdfBytes = null;
  let pdfDocument = null, pageNumber = 1, annotations = [], pdfLibPromise = null, pdfJsPromise = null, fontkitPromise = null, selectedTextBox = null, detectedTextBlocks = [], renderScale = 1;

  function showStatus(message) { if (status) status.textContent = message; }
  function safeBaseName(name) {
    return String(name || "ASTRA-document").replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "ASTRA-document";
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }
  function loadScript(url, test, label) {
    if (test()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = window.setTimeout(() => { script.remove(); reject(new Error(label + " load timed out.")); }, 18000);
      script.src = url; script.async = true;
      script.onload = () => { window.clearTimeout(timeout); test() ? resolve() : reject(new Error(label + " did not initialize.")); };
      script.onerror = () => { window.clearTimeout(timeout); script.remove(); reject(new Error(label + " could not be loaded.")); };
      document.head.appendChild(script);
    });
  }
  async function ensurePdfJs() {
    if (window.pdfjsLib) return;
    if (!pdfJsPromise) pdfJsPromise = (async () => {
      const urls = [
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"
      ];
      let last;
      for (const url of urls) { try { await loadScript(url, () => !!window.pdfjsLib, "PDF viewer"); break; } catch (e) { last = e; } }
      if (!window.pdfjsLib) throw last || new Error("PDF viewer unavailable.");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    })();
    return pdfJsPromise;
  }
  async function ensurePdfLib() {
    if (window.PDFLib) return;
    if (!pdfLibPromise) pdfLibPromise = (async () => {
      const urls = [
        "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
        "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"
      ];
      let last;
      for (const url of urls) { try { await loadScript(url, () => !!window.PDFLib, "PDF export engine"); break; } catch (e) { last = e; } }
      if (!window.PDFLib) throw last || new Error("PDF export engine unavailable.");
    })();
    try { await pdfLibPromise; } catch (e) { pdfLibPromise = null; throw e; }
  }
  async function ensureFontkit() {
    if (window.fontkit) return;
    if (!fontkitPromise) fontkitPromise = (async () => {
      const urls = [
        "https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js",
        "https://unpkg.com/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js"
      ];
      let last;
      for (const url of urls) {
        try { await loadScript(url, () => !!window.fontkit, "Font embedding engine"); break; }
        catch (error) { last = error; }
      }
      if (!window.fontkit) throw last || new Error("Font embedding engine unavailable.");
    })();
    try { await fontkitPromise; } catch (error) { fontkitPromise = null; throw error; }
  }
  async function getPdfJsFontObject(pageNo, fontName) {
    if (!pdfDocument || !fontName) return null;
    const page = await pdfDocument.getPage(pageNo);
    const objects = page.commonObjs;
    if (!objects || typeof objects.get !== "function") return null;
    try {
      if (typeof objects.has === "function" && !objects.has(fontName)) return null;
      return objects.get(fontName) || null;
    } catch (_) { return null; }
  }
  async function getPdfJsFontBytes(pageNo, fontName) {
    const font = await getPdfJsFontObject(pageNo, fontName);
    const data = font?.data;
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  }
  async function getOriginalBytes(data) {
    if (data.originalFile instanceof Blob) return new Uint8Array(await data.originalFile.arrayBuffer());
    if (data.storagePath && window.ASTRASupabase) {
      const result = await window.ASTRASupabase.storage.from(BUCKET).download(data.storagePath);
      if (result.error) throw new Error("Could not restore original PDF from cloud storage. " + result.error.message);
      return new Uint8Array(await result.data.arrayBuffer());
    }
    return null;
  }
  function numberValue(id, min, max, fallbackValue) {
    const value = Number($(id)?.value);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallbackValue;
  }
  function pageAnnotations() { return annotations.filter(item => item.page === pageNumber); }
  function updateEditorMode() {
    const replacing = $("astraPdfTool")?.value === "replace";
    document.querySelectorAll(".pdf-manual-geometry").forEach(field => { field.hidden = replacing; });
    const addButton = $("astraPdfAddAnnotation");
    if (addButton) addButton.textContent = replacing ? "REPLACE SELECTED TEXT" : "ADD TO PAGE";
  }
  function previewFontSize(item, widthPx) {
    const base = Math.max(4, Number(item.fontSize || 12) * renderScale);
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return base;
    const family = String(item.fontFamily || "sans-serif").replace(/["\\]/g, "");
    const size = base;
    context.font = (item.fontWeight || "normal") + " " + (item.fontStyle || "normal") + " " + size + 'px "' + family + '"';
    const measured = context.measureText(String(item.text || "")).width;
    if (measured > Math.max(2, widthPx - 2)) return Math.max(4, size * Math.max(0.35, (widthPx - 2) / measured));
    return size;
  }
  function renderAnnotations() {
    overlayLayer.replaceChildren();
    const page = pdfDocument?.getPage ? pdfDocument.getPage(pageNumber) : null;
    if (!page || !canvas.width) return;
    for (const item of pageAnnotations()) {
      const el = document.createElement("div");
      el.className = item.type === "cover" ? "pdf-preview-cover" : "pdf-preview-text";
      el.style.left = item.x / 1000 * 100 + "%";
      el.style.top = item.y / 1000 * 100 + "%";
      el.style.width = item.width / 1000 * 100 + "%";
      el.style.minHeight = Math.max(2, item.height / 1000 * 100) + "%";
      if (item.type === "text") { el.textContent = item.text; el.style.display = "flex"; el.style.alignItems = "center"; el.style.whiteSpace = "nowrap"; el.style.padding = "0 1px"; el.style.fontFamily = item.fontFamily || "sans-serif"; el.style.fontWeight = item.fontWeight || "normal"; el.style.fontStyle = item.fontStyle || "normal"; el.style.fontSize = previewFontSize(item, item.width / 1000 * canvas.width) + "px"; }
      overlayLayer.appendChild(el);
    }
    const list = $("astraPdfAnnotationList");
    if (list) {
      list.replaceChildren();
      annotations.forEach((item, index) => {
        const li = document.createElement("li");
        li.textContent = "Page " + item.page + " · " + (item.type === "cover" ? "Covered area" : "Text: " + item.text.slice(0, 55));
        const remove = document.createElement("button");
        remove.type = "button"; remove.textContent = "REMOVE";
        remove.addEventListener("click", () => { annotations.splice(index, 1); renderAnnotations(); });
        li.appendChild(remove); list.appendChild(li);
      });
    }
  }
  async function renderSelectableText(page, viewport) {
    if (!textLayer) return;
    textLayer.replaceChildren();
    textLayer.style.width = viewport.width + "px";
    textLayer.style.height = viewport.height + "px";
    const content = await page.getTextContent();
    detectedTextBlocks = [];
    for (const item of content.items || []) {
      const value = String(item.str || "").trim();
      if (!value || !item.width) continue;
      const tx = window.pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.max(6, Math.hypot(tx[2], tx[3]));
      const style = content.styles?.[item.fontName] || {};
      const familyName = String(style.fontFamily || "").toLowerCase();
      const pdfFont = await getPdfJsFontObject(pageNumber, item.fontName);
      const sourceFontName = [item.fontName, pdfFont?.name, pdfFont?.loadedName].filter(Boolean).join(" ");
      // Prefer PDF.js's registered face and actual font metadata over guessed CSS styles.
      const fontFamily = String(style.fontFamily || pdfFont?.fallbackName ||
        (/mono|courier/.test(familyName + " " + sourceFontName) ? "monospace" :
         /serif|times|georgia/.test(familyName + " " + sourceFontName) ? "serif" : "sans-serif"));
      const fontWeight = pdfFont?.bold || /bold|black|heavy/i.test(sourceFontName) ? "bold" : "normal";
      const fontStyle = pdfFont?.italic || /italic|oblique/i.test(sourceFontName) ? "italic" : "normal";
      // Load PDF.js actual registered face before using it for replacement rendering.
      if (document.fonts?.load && fontFamily && !/^(serif|sans-serif|monospace)$/i.test(fontFamily)) {
        try { await document.fonts.load(fontHeight + 'px "' + fontFamily.replaceAll('"', "") + '"'); } catch (_) {}
      }
      const box = {
        text: value,
        x: Math.max(0, Math.min(99, tx[4] / viewport.width * 100)),
        y: Math.max(0, Math.min(99, (tx[5] - fontHeight) / viewport.height * 100)),
        width: Math.max(1, Math.min(100, item.width * viewport.scale / viewport.width * 100 + 0.5)),
        height: Math.max(1, Math.min(100, fontHeight * 1.25 / viewport.height * 100 + 0.8)),
        fontSize: Math.max(4, Math.min(72, Number(item.height) || fontHeight / viewport.scale || 12)),
        fontFamily, fontWeight, fontStyle, fontName: item.fontName || null,
        fontAscent: Number.isFinite(style.ascent) ? style.ascent : null,
        fontDescent: Number.isFinite(style.descent) ? style.descent : null,
        textDirection: item.dir === "rtl" ? "rtl" : "ltr"
      };
      const span = document.createElement("span");
      span.className = "pdf-detected-text";
      span.textContent = value;
      span.title = "Select to replace this text";
      span.style.left = tx[4] + "px";
      span.style.top = (tx[5] - fontHeight) + "px";
      span.style.width = Math.max(fontHeight * 0.6, item.width * viewport.scale) + "px";
      span.style.height = Math.max(fontHeight * 1.25, 8) + "px";
      span.style.fontSize = fontHeight + "px";
      detectedTextBlocks.push(box);
      span.addEventListener("click", event => {
        event.stopPropagation();
        selectedTextBox = box;
        $("astraPdfTool").value = "replace";
        $("astraPdfOverlayText").value = value;
        updateEditorMode();
        showStatus("TEXT SELECTED · Enter the replacement words, then click REPLACE SELECTED TEXT. Position and size are automatic.");
        $("astraPdfOverlayText").focus();
        $("astraPdfOverlayText").select();
      });
      textLayer.appendChild(span);
    }
  }

  async function renderPage() {
    if (!pdfDocument) return;
    const page = await pdfDocument.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const maxWidth = Math.min(760, Math.max(260, stage.parentElement?.clientWidth || 700));
    const scale = maxWidth / base.width;
    const viewport = page.getViewport({ scale });
    renderScale = scale;
    const context = canvas.getContext("2d", { alpha: false });
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    canvas.style.width = viewport.width + "px"; canvas.style.height = viewport.height + "px";
    stage.style.width = viewport.width + "px"; stage.style.height = viewport.height + "px";
    overlayLayer.style.width = viewport.width + "px"; overlayLayer.style.height = viewport.height + "px";
    await page.render({ canvasContext: context, viewport }).promise;
    await renderSelectableText(page, viewport);
    $("astraPdfPageLabel").textContent = "PAGE " + pageNumber + " / " + pdfDocument.numPages;
    $("astraPdfPrev").disabled = pageNumber <= 1;
    $("astraPdfNext").disabled = pageNumber >= pdfDocument.numPages;
    renderAnnotations();
  }
  async function open(data, onSave, onAiEdit) {
    if (!data || typeof data.text !== "string") throw new Error("No saved document is available.");
    current = {
      name: String(data.name || "document.txt"),
      mimeType: String(data.mimeType || "text/plain"),
      text: data.text.slice(0, 50000),
      storagePath: data.storagePath || null,
      editorState: data.editorState || { annotations: [] }
    };
    saveHandler = typeof onSave === "function" ? onSave : null;
    aiEditHandler = typeof onAiEdit === "function" ? onAiEdit : null;
    savedText = current.text; editor.value = current.text; editor.disabled = false;
    annotations = Array.isArray(current.editorState.annotations) ? current.editorState.annotations.slice(0, 100) : [];
    pdfBytes = null; pdfDocument = null; pageNumber = 1; selectedTextBox = null;
    title.textContent = current.name + " · DOCUMENT EDITOR";
    saveButton.disabled = !saveHandler;
    const isPdf = current.mimeType === "application/pdf" || /\.pdf$/i.test(current.name);
    visual.hidden = true; fallback.hidden = !(!isPdf);
    if (isPdf) {
      try {
        const bytes = await getOriginalBytes(data);
        if (!bytes) throw new Error("The original PDF is not stored yet. Apply the PDF storage setup, then upload this PDF again.");
        await ensurePdfJs();
        pdfBytes = bytes;
        pdfDocument = await window.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
        visual.hidden = false; fallback.hidden = true;
        await renderPage();
        showStatus("VISUAL PDF READY · Add text or cover an area. Original layout is preserved.");
      } catch (error) {
        visual.hidden = true; fallback.hidden = false;
        showStatus("VISUAL PDF UNAVAILABLE · " + String(error?.message || error).slice(0, 170) + " · Extracted-text mode is available below.");
      }
    } else {
      showStatus("Extracted-text mode · Export creates a new text-based file.");
    }
    if (!dialog.open) dialog.showModal();
  }

  $("astraPdfTool")?.addEventListener("change", updateEditorMode);
  updateEditorMode();
  $("astraPdfPrev")?.addEventListener("click", async () => { if (pageNumber > 1) { pageNumber--; await renderPage(); } });
  $("astraPdfNext")?.addEventListener("click", async () => { if (pdfDocument && pageNumber < pdfDocument.numPages) { pageNumber++; await renderPage(); } });
  $("astraPdfAddAnnotation")?.addEventListener("click", () => {
    if (!pdfDocument) return;
    const type = $("astraPdfTool").value;
    const text = $("astraPdfOverlayText").value.trim();
    if ((type === "text" || type === "replace") && !text) { showStatus("Enter the text you want to add."); return; }
    if (type === "replace" && !selectedTextBox) { showStatus("Click an existing detected text block on the PDF page first."); return; }
    if (annotations.length >= 100) { showStatus("Maximum of 100 annotations per document."); return; }
    const x = numberValue("astraPdfX", 0, 100, 10) * 10;
    const y = numberValue("astraPdfY", 0, 100, 15) * 10;
    const width = numberValue("astraPdfW", 1, 100, 35) * 10;
    const height = numberValue("astraPdfH", 1, 100, 8) * 10;
    if (type === "replace" && selectedTextBox) {
      const box = selectedTextBox;
      annotations.push({ type: "cover", page: pageNumber, x: box.x * 10, y: box.y * 10, width: box.width * 10, height: box.height * 10, fontSize: 0, text: "" });
      annotations.push({ type: "text", page: pageNumber, x: box.x * 10, y: box.y * 10, width: box.width * 10, height: box.height * 10, fontSize: box.fontSize, fontFamily: box.fontFamily, fontWeight: box.fontWeight, fontStyle: box.fontStyle, fontName: box.fontName, fontAscent: box.fontAscent, fontDescent: box.fontDescent, textDirection: box.textDirection, text });
      selectedTextBox = null;
      $("astraPdfOverlayText").value = "";
      renderAnnotations();
      showStatus("REPLACEMENT PREVIEW ADDED · ASTRA fitted the text to the selected block. Review before export.");
      return;
    }
    annotations.push({ type, page: pageNumber, x, y, width, height, fontSize: numberValue("astraPdfFontSize", 6, 72, 14), text: type === "text" ? text : "" });
    renderAnnotations();
    showStatus(type === "cover" ? "COVER AREA ADDED · Save or export to apply it." : "TEXT ADDED · Save or export to apply it.");
  });

  if (aiButton) aiButton.addEventListener("click", async () => {
    const instruction = String(aiInstruction?.value || "").trim();
    if (!instruction) { showStatus("Describe the change you want ASTRA to make."); return; }
    if (!aiEditHandler) { showStatus("ASTRA AI editing is not connected yet."); return; }
    if (!detectedTextBlocks.length) { showStatus("No selectable text was detected on this page. Try a text-based PDF page."); return; }
    aiButton.disabled = true;
    showStatus("ASTRA IS ANALYSING THIS PAGE AND YOUR INSTRUCTION…");
    try {
      const result = await aiEditHandler(instruction, detectedTextBlocks.map(item => ({ text: item.text })), pageNumber);
      const edits = Array.isArray(result?.plannedEdits) ? result.plannedEdits : [];
      if (!edits.length) { showStatus("ASTRA COULD NOT MATCH THAT INSTRUCTION TO TEXT ON THIS PAGE. Try naming the exact words."); return; }
      let applied = 0;
      for (const edit of edits) {
        const index = Number(edit.blockIndex);
        const block = detectedTextBlocks[index];
        if (!block || block.text !== edit.sourceText || typeof edit.replacementText !== "string" || !edit.replacementText.trim()) continue;
        annotations.push({ type: "cover", page: pageNumber, x: block.x * 10, y: block.y * 10, width: block.width * 10, height: block.height * 10, fontSize: 0, text: "" });
        annotations.push({ type: "text", page: pageNumber, x: block.x * 10, y: block.y * 10, width: block.width * 10, height: block.height * 10, fontSize: block.fontSize, fontFamily: block.fontFamily, fontWeight: block.fontWeight, fontStyle: block.fontStyle, fontName: block.fontName, fontAscent: block.fontAscent, fontDescent: block.fontDescent, textDirection: block.textDirection, text: edit.replacementText.slice(0, 500) });
        applied++;
      }
      renderAnnotations();
      showStatus(applied ? "ASTRA PREPARED " + applied + " EDIT(S) · REVIEW THE PAGE BEFORE SAVING OR EXPORTING." : "ASTRA COULD NOT SAFELY APPLY THE PROPOSED EDITS.");
    } catch (error) { showStatus("ASTRA AI EDIT FAILED · " + String(error?.message || error).slice(0, 150)); }
    finally { aiButton.disabled = false; }
  });

  saveButton.addEventListener("click", async () => {
    if (!current || !saveHandler) return;
    const text = editor.value;
    if (!text.trim()) { showStatus("A document cannot be saved empty."); return; }
    if (text.length > 50000) { showStatus("Document text exceeds the 50,000-character limit."); return; }
    saveButton.disabled = true; showStatus("Saving document and editor changes to cloud…");
    try {
      const editorState = { annotations: annotations.slice(0, 100) };
      await saveHandler({ ...current, text, editorState });
      current.text = text; current.editorState = editorState; savedText = text;
      showStatus("SAVED TO CLOUD · " + current.name);
    } catch (error) { showStatus("SAVE FAILED · " + String(error?.message || error).slice(0, 160)); }
    finally { saveButton.disabled = false; }
  });

  pdfButton.addEventListener("click", async () => {
    if (!current) return;
    pdfButton.disabled = true; showStatus("Preparing PDF export…");
    try {
      if (pdfBytes && pdfDocument) {
        // Export from the live editor state first; fall back to the last cloud-saved state.
        const savedAnnotations = Array.isArray(current.editorState?.annotations) ? current.editorState.annotations : [];
        const exportAnnotations = (annotations.length ? annotations : savedAnnotations)
          .filter(item => item && (item.type === "text" || item.type === "cover") &&
            Number.isInteger(item.page) && item.page >= 1 && item.page <= pdfDocument.numPages &&
            ["x", "y", "width", "height"].every(key => Number.isFinite(Number(item[key]))));
        if (!exportAnnotations.length) {
          throw new Error("No PDF edits are available to export. Apply an edit on the page first, then export again.");
        }
        // Always paint all cover rectangles before replacement text, regardless of list order.
        exportAnnotations.sort((a, b) => a.page - b.page ||
          (a.type === "cover" ? 0 : 1) - (b.type === "cover" ? 0 : 1));
        showStatus("Applying " + exportAnnotations.length + " saved edit layers to the original PDF…");
        await ensurePdfLib();
        const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
        const pdf = await PDFDocument.load(pdfBytes);
        const textEdits = exportAnnotations.filter(item => item.type === "text");
        const embeddedFonts = new Map();
        const fallbackItems = new Set();
        if (textEdits.length) {
          try {
            await ensureFontkit();
            pdf.registerFontkit(window.fontkit);
          } catch (_) {}
          for (const item of textEdits) {
            if (!item.fontName || !window.fontkit) {
              fallbackItems.add(item);
              continue;
            }
            if (!embeddedFonts.has(item.fontName)) {
              try {
                const fontBytes = await getPdfJsFontBytes(item.page, item.fontName);
                if (!fontBytes?.length) throw new Error("Original embedded font data unavailable");
                const embedded = await pdf.embedFont(fontBytes, { subset: true });
                if (!embedded || typeof embedded.widthOfTextAtSize !== "function") {
                  throw new Error("Original font metrics unavailable");
                }
                embeddedFonts.set(item.fontName, embedded);
              } catch (_) {
                embeddedFonts.set(item.fontName, null);
              }
            }
            const embedded = embeddedFonts.get(item.fontName);
            if (!embedded) {
              fallbackItems.add(item);
              continue;
            }
            // PDF-embedded subsets often contain only glyphs used by the source page.
            // Preflight each replacement so a missing character cannot break export midway.
            try { embedded.encodeText(String(item.text || "")); }
            catch (_) { fallbackItems.add(item); }
          }
        }
        await (document.fonts?.ready || Promise.resolve());
        const fontFallbacks = fallbackItems.size;
        if (fontFallbacks && !window.confirm(
          "ASTRA cannot use the original embedded font for " + fontFallbacks +
          " replacement(s). The font may be subsetted or missing required characters. " +
          "A substitute will be used for those replacements. Continue?"
        )) {
          throw new Error("Export cancelled because the original font cannot render every replacement character.");
        }
        let appliedEdits = 0;
        for (const item of exportAnnotations) {
          const page = pdf.getPage(item.page - 1);
          if (!page) continue;
          const size = page.getSize();
          const x = item.x / 1000 * size.width;
          const top = item.y / 1000 * size.height;
          const width = item.width / 1000 * size.width;
          const height = item.height / 1000 * size.height;
          if (item.type === "cover") {
            page.drawRectangle({
              x, y: size.height - top - height, width, height,
              color: rgb(1, 1, 1), opacity: 1, borderColor: rgb(1, 1, 1), borderOpacity: 1, borderWidth: 0
            });
            appliedEdits++;
          } else {
            const originalFont = item.fontName && !fallbackItems.has(item) ? embeddedFonts.get(item.fontName) : null;
            if (originalFont) {
              const text = String(item.text || "");
              const maxSize = Math.max(4, Math.min(72, Number(item.fontSize) || 12, height * 0.88));
              let fontSize = maxSize;
              const availableWidth = Math.max(2, width - 2);
              const measuredWidth = originalFont.widthOfTextAtSize(text, fontSize);
              if (measuredWidth > availableWidth) fontSize = Math.max(3, fontSize * availableWidth / measuredWidth);
              const textHeight = originalFont.heightAtSize(fontSize);
              const ascent = Number(item.fontAscent);
              const baseline = Number.isFinite(ascent) && ascent > 0 && ascent <= 2
                ? size.height - top - (height / 1.25) * ascent
                : size.height - top - Math.max(0, (height - textHeight) / 2) - textHeight * 0.18;
              const textWidth = originalFont.widthOfTextAtSize(text, fontSize);
              const textX = item.textDirection === "rtl" ? x + width - textWidth : x;
              page.drawText(text, {
                x: textX, y: baseline, size: fontSize, font: originalFont,
                color: rgb(0.05, 0.05, 0.08), maxWidth: availableWidth
              });
              appliedEdits++;
              continue;
            }
            // Only this specific replacement is rasterized when the original font
            // program is unavailable or its embedded subset lacks one or more glyphs.
            const density = 4;
            const textCanvas = document.createElement("canvas");
            textCanvas.width = Math.max(2, Math.ceil(width * density));
            textCanvas.height = Math.max(2, Math.ceil(height * density));
            const ctx = textCanvas.getContext("2d");
            if (!ctx) throw new Error("Could not prepare replacement text artwork.");
            const family = String(item.fontFamily || "sans-serif").replace(/["\\]/g, "");
            const maxFont = Math.max(4, Math.min(72, Number(item.fontSize) || 12, height * 0.88));
            let fontSize = maxFont * density;
            const fontSpec = () => (item.fontStyle || "normal") + " " + (item.fontWeight || "normal") + " " + fontSize + 'px "' + family + '"';
            ctx.font = fontSpec();
            const availableWidth = Math.max(2, textCanvas.width - 4 * density);
            const measured = ctx.measureText(String(item.text || "")).width;
            if (measured > availableWidth) {
              fontSize = Math.max(4 * density, fontSize * availableWidth / measured);
              ctx.font = fontSpec();
            }
            ctx.clearRect(0, 0, textCanvas.width, textCanvas.height);
            ctx.fillStyle = "#0d0d14";
            ctx.textAlign = item.textDirection === "rtl" ? "right" : "left";
            ctx.textBaseline = "middle";
            const textX = item.textDirection === "rtl" ? textCanvas.width - 2 * density : 2 * density;
            ctx.fillText(String(item.text || ""), textX, textCanvas.height / 2, availableWidth);
            const png = await pdf.embedPng(textCanvas.toDataURL("image/png"));
            page.drawImage(png, { x, y: size.height - top - height, width, height });
            appliedEdits++;
          }
        }
        if (!appliedEdits) throw new Error("ASTRA found no valid edit layers to apply. Nothing was downloaded.");
        const bytes = await pdf.save();
        if (!(bytes instanceof Uint8Array) || bytes.length < 100) {
          throw new Error("The edited PDF could not be generated. The original file was not downloaded as an edited copy.");
        }
        downloadBlob(new Blob([bytes], { type: "application/pdf" }), safeBaseName(current.name) + "-edited.pdf");
        showStatus("EDITED PDF EXPORTED · " + appliedEdits + " EDIT LAYERS APPLIED." +
          (fontFallbacks ? " " + fontFallbacks + " REPLACEMENT(S) NEEDED A SUBSTITUTE FONT." : " ORIGINAL EMBEDDED FONTS WERE USED."));
      } else {
        showStatus("No original PDF loaded. Exporting extracted text as a new PDF…");
        await ensurePdfLib();
        const { PDFDocument, StandardFonts } = window.PDFLib;
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        let page = pdf.addPage([595.28, 841.89]), y = 800;
        page.drawText(current.name.slice(0, 90), { x: 48, y, size: 14, font }); y -= 28;
        for (const paragraph of String(editor.value).split(/\r?\n/)) {
          const words = paragraph.split(/\s+/); let line = "";
          for (const word of words) {
            const candidate = line ? line + " " + word : word;
            if (font.widthOfTextAtSize(candidate, 10) > 495 && line) {
              if (y < 45) { page = pdf.addPage([595.28, 841.89]); y = 800; }
              page.drawText(line, { x: 48, y, size: 10, font }); y -= 14; line = word;
            } else line = candidate;
          }
          if (y < 45) { page = pdf.addPage([595.28, 841.89]); y = 800; }
          if (line) { page.drawText(line, { x: 48, y, size: 10, font }); y -= 17; }
        }
        const bytes = await pdf.save();
        downloadBlob(new Blob([bytes], { type: "application/pdf" }), safeBaseName(current.name) + "-text-copy.pdf");
        showStatus("TEXT-BASED PDF EXPORTED · ORIGINAL LAYOUT NOT AVAILABLE");
      }
    } catch (error) { showStatus("PDF EXPORT FAILED · " + String(error?.message || error).slice(0, 160)); }
    finally { pdfButton.disabled = false; }
  });

  textButton.addEventListener("click", () => {
    if (!current) return;
    downloadBlob(new Blob([editor.value], { type: "text/plain;charset=utf-8" }), safeBaseName(current.name) + "-edited.txt");
    showStatus("TEXT COPY EXPORTED");
  });
  if (closeButton) closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => {
    const hasChanges = editor.value !== savedText || annotations.length !== (current?.editorState?.annotations?.length || 0);
    if (hasChanges && !window.confirm("Close the editor? Unsaved changes will be lost.")) event.preventDefault();
  });
  window.ASTRADocumentEditor = Object.freeze({ open });
})();
