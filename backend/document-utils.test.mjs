import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDocumentChunks } from "./document-utils.js";

test("retrieves all requested test headers for an en-dash range", () => {
  const sections = [];
  for (let testNumber = 1; testNumber <= 25; testNumber++) {
    if (testNumber >= 10 && testNumber <= 20) {
      sections.push(`${testNumber} Arjuna NEET 2026 Sunday, date for Test ${testNumber}`);
    } else {
      sections.push(`Unrelated chapter material for item ${testNumber}`);
    }
    sections.push(...Array.from({ length: 18 }, (_, index) =>
      `Additional unrelated syllabus text ${testNumber}-${index} `.repeat(8)
    ));
  }

  const result = buildDocumentChunks(sections.join("\n"), "List all tests 10–20 with their dates");
  for (let testNumber = 10; testNumber <= 20; testNumber++) {
    assert.ok(
      result.chunks.some(chunk => new RegExp(`(?:^|\\n)${testNumber} Arjuna NEET`).test(chunk)),
      `Expected retrieved excerpts to include Test ${testNumber}`
    );
  }
  assert.ok(result.selected < result.total, "Long documents should be selectively retrieved");
});

test("keeps every section for a short document", () => {
  const result = buildDocumentChunks("Title\nFirst section\nSecond section", "Summarise this");
  assert.equal(result.selected, result.total);
  assert.equal(result.chunks.length, result.total);
});

test("recognises a hyphenated test range", () => {
  const result = buildDocumentChunks("10 Arjuna\n20 Arjuna", "Tests 10-20");
  assert.ok(result.chunks.some(chunk => chunk.includes("10 Arjuna")));
  assert.ok(result.chunks.some(chunk => chunk.includes("20 Arjuna")));
});


test("browser PDF OCR records separate render, recognition, and quality diagnostics", async () => {
  const source = await readFile(new URL("../astra-page.js", import.meta.url), "utf8");
  assert.ok(source.includes("pagesRendered++"));
  assert.ok(source.includes("pagesProcessed++"));
  assert.ok(source.includes("averageConfidence"));
  assert.ok(source.includes('failureStage = "OCR_QUALITY_CHECK"'));
  assert.ok(source.includes('ocrPages.join("\\n\\n")'));
  assert.ok(source.includes("ocrText.replace("));
  assert.ok(source.includes("[Page "));
  assert.ok(source.includes("ocrReadableRatio"));
  assert.ok(source.includes("page.getViewport({ scale: 2.5 })"), "OCR should render at higher resolution");
  assert.ok(source.includes("makeThresholdCanvas"), "OCR should create a contrast-normalized threshold image");
  assert.ok(source.includes("tessedit_pageseg_mode: \"11\""), "OCR should retry using sparse-text segmentation");
  assert.ok(source.includes("selectedPass"), "Diagnostics should report which OCR pass was selected");
});
