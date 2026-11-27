import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("ASTRA exposes a cloud-backed extracted-document editor", async () => {
  const [html, page, editor, worker, serviceWorker, migration, editorMigration, css] = await Promise.all([
    read("astra.html"),
    read("astra-page.js"),
    read("astra-document-editor.js"),
    read("backend/worker.js"),
    read("astra-sw.js"),
    read("backend/migrations/0004_astra_original_pdf_storage.sql"),
    read("backend/migrations/0005_astra_pdf_editor_state.sql"),
    read("astra-page.css")
  ]);
  assert.ok(html.includes('id="astraDocumentEditorButton"'));
  assert.ok(html.includes('id="astraDocumentDialog"'));
  assert.ok(html.includes('src="astra-document-editor.js"'));
  assert.ok(page.includes('sendDocumentAction("load")'));
  assert.ok(page.includes('sendDocumentAction("save"'));
  assert.ok(worker.includes('documentAction.operation === "load"'));
  assert.ok(worker.includes("await documentStore.save(conversationId, authenticatedUser.id, documentToSave)"));
  assert.ok(worker.includes('documentPersistenceStatus: savedDocument ? "RESTORED" : "NOT_FOUND"'));
  assert.ok(html.includes('id="astraDocumentSave"'));
  assert.ok(html.includes('id="astraDocumentExportPdf"'));
  assert.ok(editor.includes("SAVED TO CLOUD"));
  assert.ok(editor.includes("Original layout is preserved"));
  assert.ok(editor.includes("renderSelectableText"));
  assert.ok(editor.includes("Position and size are automatic."));
  assert.ok(editor.includes("previewFontSize"));
  assert.ok(editor.includes("ctx.measureText(String(item.text || \"\"))"));
  assert.ok(editor.includes("PDF.js's actual loaded font-family name"));
  assert.ok(editor.includes('pdf.embedPng(textCanvas.toDataURL("image/png"))'));
  assert.ok(editor.includes("document.fonts?.ready"));
  assert.ok(editor.includes("ensureFontkit"));
  assert.ok(editor.includes("getPdfJsFontBytes"));
  assert.ok(editor.includes("pdf.registerFontkit(window.fontkit)"));
  assert.ok(editor.includes("pdf.embedFont(fontBytes, { subset: true })"));
  assert.ok(editor.includes("originalFont.widthOfTextAtSize(text, fontSize)"));
  assert.ok(editor.includes("fontFallbacks"));
  assert.ok(editor.includes("document.fonts.load"));
  assert.ok(editor.includes("could not recover the original embedded font"));
  assert.ok(editor.includes("Export cancelled to avoid silently substituting the original font"));
  assert.ok(editor.includes("textDirection"));
  assert.ok(editor.includes("TEXT SELECTED"));
  assert.ok(editor.includes("REPLACEMENT PREVIEW ADDED"));
  assert.ok(editor.includes("ASTRA IS ANALYSING THIS PAGE"));
  assert.ok(editor.includes("aiEditHandler"));
  assert.ok(html.includes("astraPdfAiInstruction"));
  assert.ok(html.includes("astraPdfAiApply"));
  assert.ok(page.includes('sendDocumentAction("plan-edit"'));
  assert.ok(worker.includes('"plan-edit"'));
  assert.ok(worker.includes("ASTRA PDF edit planner"));
  assert.ok(html.includes("astraPdfTextLayer"));
  assert.ok(html.includes("pdf-manual-geometry"));
  assert.ok(html.includes("value=\"replace\""));
  assert.ok(css.includes(".pdf-detected-text"));
  assert.ok(editor.includes("PDFDocument.load(pdfBytes)"));
  assert.ok(editor.includes("No PDF edits are available to export"));
  assert.ok(editor.includes("Applying \" + exportAnnotations.length + \" saved edit layers"));
  assert.ok(editor.includes("EDIT LAYERS APPLIED"));
  assert.ok(editor.includes("Always paint all cover rectangles before replacement text"));
  assert.ok(editor.includes("No valid edit layers to apply"));
  assert.ok(html.includes("astraPdfVisualEditor"));
  assert.ok(migration.includes("astra-original-documents"));
  assert.ok(migration.includes("auth.uid()::text"));
  assert.ok(editorMigration.includes("editor_state"));
  assert.ok(serviceWorker.includes('"/astra-document-editor.js"'));
});

