import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("ASTRA exposes a cloud-backed extracted-document editor", async () => {
  const [html, page, editor, worker, serviceWorker] = await Promise.all([
    read("astra.html"),
    read("astra-page.js"),
    read("astra-document-editor.js"),
    read("backend/worker.js"),
    read("astra-sw.js")
  ]);
  assert.ok(html.includes('id="astraDocumentEditorButton"'));
  assert.ok(html.includes('id="astraDocumentDialog"'));
  assert.ok(html.includes('src="astra-document-editor.js"'));
  assert.ok(page.includes('sendDocumentAction("load")'));
  assert.ok(page.includes('sendDocumentAction("save"'));
  assert.ok(worker.includes('documentAction.operation === "load"'));
  assert.ok(worker.includes('documentAction.operation === "save"') || worker.includes('documentAction.operation !== "load"'));
  assert.ok(worker.includes('documentPersistenceStatus: savedDocument ? "RESTORED" : "NOT_FOUND"'));
  assert.ok(editor.includes("SAVE TO CLOUD"));
  assert.ok(editor.includes("EXPORT NEW PDF"));
  assert.ok(editor.includes("ORIGINAL FILE UNCHANGED"));
  assert.ok(serviceWorker.includes('"/astra-document-editor.js"'));
});

