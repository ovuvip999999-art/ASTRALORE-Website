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
  let pdfDocument = null, pageNumber = 1, annotations = [], pdfLibPromise = null, pdfJsPromise = null, selectedTextBox = null, detectedTextBlocks = [], renderScale = 1;

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
    const family = item.fontFamily === "serif" ? "serif" : item.fontFamily === "monospace" ? "monospace" : "sans-serif";
    const size = base;
    context.font = (item.fontWeight || "normal") + " " + (item.fontStyle || "normal") + " " + size + "px " + family;
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
      const sourceFontName = String(item.fontName || "");
      const fontFamily = /mono|courier/.test(familyName) ? "monospace" : /serif|times|georgia/.test(familyName) ? "serif" : "sans-serif";
      const fontWeight = /bold|black|heavy/i.test(sourceFontName) ? "bold" : "normal";
      const fontStyle = /italic|oblique/i.test(sourceFontName) ? "italic" : "normal";
      const box = {
        text: value,
        x: Math.max(0, Math.min(99, tx[4] / viewport.width * 100)),
        y: Math.max(0, Math.min(99, (tx[5] - fontHeight) / viewport.height * 100)),
        width: Math.max(1, Math.min(100, item.width * viewport.scale / viewport.width * 100 + 0.5)),
        height: Math.max(1, Math.min(100, fontHeight * 1.25 / viewport.height * 100 + 0.8)),
        fontSize: Math.max(4, Math.min(72, Number(item.height) || fontHeight / viewport.scale || 12)),
        fontFamily, fontWeight, fontStyle
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
      annotations.push({ type: "text", page: pageNumber, x: box.x * 10, y: box.y * 10, width: box.width * 10, height: box.height * 10, fontSize: box.fontSize, fontFamily: box.fontFamily, fontWeight: box.fontWeight, fontStyle: box.fontStyle, text });
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
        annotations.push({ type: "text", page: pageNumber, x: block.x * 10, y: block.y * 10, width: block.width * 10, height: block.height * 10, fontSize: block.fontSize, fontFamily: block.fontFamily, fontWeight: block.fontWeight, fontStyle: block.fontStyle, text: edit.replacementText.slice(0, 500) });
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
        await ensurePdfLib();
        const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
        const pdf = await PDFDocument.load(pdfBytes);
        const fontCache = new Map();
        const resolveFontKey = item => {
          const family = String(item.fontFamily || "sans-serif").toLowerCase();
          const bold = item.fontWeight === "bold", italic = item.fontStyle === "italic";
          if (family === "monospace") return bold ? (italic ? "CourierBoldOblique" : "CourierBold") : (italic ? "CourierOblique" : "Courier");
          if (family === "serif") return bold ? (italic ? "TimesRomanBoldItalic" : "TimesRomanBold") : (italic ? "TimesRomanItalic" : "TimesRoman");
          return bold ? (italic ? "HelveticaBoldOblique" : "HelveticaBold") : (italic ? "HelveticaOblique" : "Helvetica");
        };
        for (const item of annotations) {
          const page = pdf.getPage(item.page - 1);
          if (!page) continue;
          const size = page.getSize();
          const x = item.x / 1000 * size.width;
          const top = item.y / 1000 * size.height;
          const width = item.width / 1000 * size.width;
          const height = item.height / 1000 * size.height;
          if (item.type === "cover") {
            page.drawRectangle({ x, y: size.height - top - height, width, height, color: rgb(1, 1, 1), borderWidth: 0 });
          } else {
            const key = resolveFontKey(item);
            if (!fontCache.has(key)) fontCache.set(key, await pdf.embedFont(StandardFonts[key]));
            const font = fontCache.get(key);
            const naturalSize = Math.max(4, Math.min(72, Number(item.fontSize) || 12, height * 0.88));
            const widthAtOne = Math.max(0.01, font.widthOfTextAtSize(item.text, 1));
            const fontSize = Math.max(4, Math.min(naturalSize, Math.max(2, width - 1) / widthAtOne));
            const textHeight = font.heightAtSize(fontSize);
            const y = size.height - top - Math.max(0, (height - textHeight) / 2) - textHeight * 0.82;
            page.drawText(item.text, { x: x + 0.5, y, size: fontSize, font, color: rgb(0.05, 0.05, 0.08) });
          }
        }
        const bytes = await pdf.save();
        downloadBlob(new Blob([bytes], { type: "application/pdf" }), safeBaseName(current.name) + "-edited.pdf");
        showStatus("EDITED PDF EXPORTED · ORIGINAL PAGE DESIGN PRESERVED");
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
