import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("ASTRA exposes a cloud-backed extracted-document editor", async () => {
  const [html, page, editor, worker, serviceWorker, migration] = await Promise.all([
    read("astra.html"),
    read("astra-page.js"),
    read("astra-document-editor.js"),
    read("backend/worker.js"),
    read("astra-sw.js"),
    read("backend/migrations/0004_astra_original_pdf_storage.sql")
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
  assert.ok(editor.includes("Original page design is preserved"));
  assert.ok(editor.includes("PDFDocument.load(pdfBytes)"));
  assert.ok(html.includes("astraPdfVisualEditor"));
  assert.ok(migration.includes("astra-original-documents"));
  assert.ok(migration.includes("auth.uid()::text"));
  assert.ok(serviceWorker.includes('"/astra-document-editor.js"'));
});

