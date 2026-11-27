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
  assert.match(source, /pagesRendered\+\+/);
  assert.match(source, /pagesProcessed\+\+/);
  assert.match(source, /averageConfidence/);
  assert.match(source, /failureStage = "OCR_QUALITY_CHECK"/);
  assert.match(source, /ocrPages\.join\("\\n\\n"\)/);
  assert.match(source, /ocrText\.replace\(\/\\[Page/);
  assert.match(source, /match\(\/\[\\p\{L\}\\p\{N\}\\p\{P\}\]\/gu\)/);
});
