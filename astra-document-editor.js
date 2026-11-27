/* ASTRA extracted-document editor.
 * Edits the extracted text representation and exports a newly generated copy.
 * It does not modify the original PDF/DOCX page layout or retain original binaries.
 */
(() => {
  "use strict";
  const dialog = document.getElementById("astraDocumentDialog");
  const title = document.getElementById("astraDocumentTitle");
  const editor = document.getElementById("astraDocumentText");
  const status = document.getElementById("astraDocumentEditorStatus");
  const saveButton = document.getElementById("astraDocumentSave");
  const pdfButton = document.getElementById("astraDocumentExportPdf");
  const textButton = document.getElementById("astraDocumentExportText");
  const closeButton = document.getElementById("astraDocumentClose");
  if (!dialog || !editor || !saveButton || !pdfButton || !textButton) return;

  let current = null;
  let saveHandler = null;
  let savedText = "";

  function showStatus(message) {
    if (status) status.textContent = message;
  }

  function safeBaseName(name) {
    return String(name || "ASTRA-document")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "ASTRA-document";
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function open(documentData, onSave) {
    if (!documentData || typeof documentData.text !== "string") {
      throw new Error("No saved document is available in this conversation.");
    }
    current = {
      name: String(documentData.name || "document.txt"),
      mimeType: String(documentData.mimeType || "text/plain"),
      text: documentData.text.slice(0, 50000)
    };
    saveHandler = typeof onSave === "function" ? onSave : null;
    savedText = current.text;
    title.textContent = current.name + " · EXTRACTED TEXT";
    editor.value = current.text;
    editor.disabled = false;
    saveButton.disabled = !saveHandler;
    showStatus(saveHandler ? "Edit the extracted text, then save to cloud." : "Read-only document preview.");
    if (!dialog.open) dialog.showModal();
  }

  let pdfLibraryPromise = null;
  async function loadPdfLibrary() {
    if (window.jspdf?.jsPDF || window.jsPDF) return;
    if (pdfLibraryPromise) return pdfLibraryPromise;

    pdfLibraryPromise = (async () => {
      const sources = [
        "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js",
        "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
        "https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js"
      ];
      const previous = document.querySelector('script[data-astra-document-pdf="true"]');
      if (previous) previous.remove();

      let lastError = null;
      for (const src of sources) {
        try {
          await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            const timeout = window.setTimeout(() => {
              script.remove();
              reject(new Error("PDF library request timed out."));
            }, 15000);
            script.src = src;
            script.async = true;
            script.dataset.astraDocumentPdf = "true";
            script.onload = () => {
              window.clearTimeout(timeout);
              resolve();
            };
            script.onerror = () => {
              window.clearTimeout(timeout);
              script.remove();
              reject(new Error("PDF library source failed."));
            };
            document.head.appendChild(script);
          });
          if (window.jspdf?.jsPDF || window.jsPDF) return;
          throw new Error("PDF library loaded without its export API.");
        } catch (error) {
          lastError = error;
        }
      }
      throw new Error("PDF export library could not be loaded from the available sources. " +
        String(lastError?.message || ""));
    })();

    try { await pdfLibraryPromise; }
    catch (error) { pdfLibraryPromise = null; throw error; }
  }

  saveButton.addEventListener("click", async () => {
    if (!current || !saveHandler) return;
    const text = editor.value;
    if (!text.trim()) {
      showStatus("A document cannot be saved empty.");
      return;
    }
    if (text.length > 50000) {
      showStatus("Document text exceeds the 50,000-character limit.");
      return;
    }
    saveButton.disabled = true;
    showStatus("Saving edited document to cloud…");
    try {
      await saveHandler({ ...current, text });
      current.text = text;
      savedText = text;
      showStatus("SAVED TO CLOUD · " + current.name);
    } catch (error) {
      showStatus("SAVE FAILED · " + String(error?.message || error).slice(0, 160));
    } finally {
      saveButton.disabled = false;
    }
  });

  pdfButton.addEventListener("click", async () => {
    if (!current) return;
    pdfButton.disabled = true;
    showStatus("Preparing a new PDF copy…");
    try {
      await loadPdfLibrary();
      const JsPDF = window.jspdf?.jsPDF || window.jsPDF;
      if (!JsPDF) throw new Error("PDF export library is unavailable.");
      const pdf = new JsPDF({ unit: "mm", format: "a4" });
      const margin = 16;
      const width = 210 - margin * 2;
      const lines = String(editor.value).replace(/\r\n?/g, "\n").split("\n");
      let y = margin;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(13);
      pdf.text(current.name.slice(0, 90), margin, y);
      y += 9;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9.5);
      for (const paragraph of lines) {
        const wrapped = pdf.splitTextToSize(paragraph || " ", width);
        for (const line of wrapped) {
          if (y > 281) { pdf.addPage(); y = margin; }
          pdf.text(line, margin, y);
          y += 4.8;
        }
        y += 1.8;
      }
      pdf.save(safeBaseName(current.name) + "-edited.pdf");
      showStatus("NEW PDF EXPORTED · ORIGINAL FILE UNCHANGED");
    } catch (error) {
      showStatus("PDF EXPORT FAILED · " + String(error?.message || error).slice(0, 140));
    } finally {
      pdfButton.disabled = false;
    }
  });

  textButton.addEventListener("click", () => {
    if (!current) return;
    const blob = new Blob([editor.value], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, safeBaseName(current.name) + "-edited.txt");
    showStatus("TEXT COPY EXPORTED");
  });

  if (closeButton) closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => {
    if (editor.value !== savedText && !window.confirm("Discard unsaved document edits?")) event.preventDefault();
  });

  window.ASTRADocumentEditor = Object.freeze({ open });
})();
