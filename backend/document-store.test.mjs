import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentStore } from "./document-store.js";

const conversationId = "7b6a3b7a-45d8-4f1d-9a6e-5c7d8e9f0123";
const userId = "2c4d6e8f-1234-4abc-8def-0123456789ab";

test("saves extracted document text under the authenticated conversation", async () => {
  let request;
  const store = createDocumentStore({
    baseUrl: "https://example.supabase.co/",
    anonKey: "public-key",
    authorization: "Bearer user-token",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 201 };
    }
  });

  await store.save(conversationId, userId, {
    name: "planner.pdf",
    mimeType: "application/pdf",
    text: "[Page 1] Test schedule",
    storagePath: null,
    editorState: { annotations: [] }
  });

  assert.equal(request.url, "https://example.supabase.co/rest/v1/astra_documents?on_conflict=conversation_id");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer user-token");
  assert.match(request.options.headers.Prefer, /resolution=merge-duplicates/);
  const body = JSON.parse(request.options.body);
  assert.equal(body.conversation_id, conversationId);
  assert.equal(body.user_id, userId);
  assert.equal(body.file_name, "planner.pdf");
  assert.equal(body.extracted_text, "[Page 1] Test schedule");
});

test("restores the saved document for the same conversation and user", async () => {
  let requestUrl = "";
  const store = createDocumentStore({
    baseUrl: "https://example.supabase.co",
    anonKey: "public-key",
    authorization: "Bearer user-token",
    fetchImpl: async (url, options) => {
      requestUrl = url;
      assert.equal(options.method, "GET");
      return {
        ok: true,
        status: 200,
        json: async () => [{
          file_name: "planner.pdf",
          mime_type: "application/pdf",
          extracted_text: "[Page 1] Test schedule"
        }]
      };
    }
  });

  const document = await store.load(conversationId, userId);
  assert.match(requestUrl, /conversation_id=eq\./);
  assert.match(requestUrl, /user_id=eq\./);
  assert.deepEqual(document, {
    name: "planner.pdf",
    mimeType: "application/pdf",
    text: "[Page 1] Test schedule",
    storagePath: null,
    editorState: { annotations: [] }
  });
});

test("returns null when the conversation has no saved document", async () => {
  const store = createDocumentStore({
    baseUrl: "https://example.supabase.co",
    anonKey: "public-key",
    authorization: "Bearer user-token",
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] })
  });
  assert.equal(await store.load(conversationId, userId), null);
});


test("a document is restored only for the matching conversation and user", async () => {
  const rows = new Map();
  const store = createDocumentStore({
    baseUrl: "https://example.supabase.co",
    anonKey: "public-key",
    authorization: "Bearer user-token",
    fetchImpl: async (url, options) => {
      if (options.method === "POST") {
        const row = JSON.parse(options.body);
        rows.set(row.conversation_id + ":" + row.user_id, row);
        return { ok: true, status: 201 };
      }
      const parsed = new URL(url);
      const conversation = parsed.searchParams.get("conversation_id")?.slice(3);
      const user = parsed.searchParams.get("user_id")?.slice(3);
      const row = rows.get(conversation + ":" + user);
      return {
        ok: true,
        status: 200,
        json: async () => row ? [{
          file_name: row.file_name,
          mime_type: row.mime_type,
          extracted_text: row.extracted_text
        }] : []
      };
    }
  });

  await store.save(conversationId, userId, {
    name: "planner.pdf",
    mimeType: "application/pdf",
    text: "Test 15 schedule"
  });

  assert.equal((await store.load(conversationId, userId))?.text, "Test 15 schedule");
  assert.equal(await store.load(conversationId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), null);
  assert.equal(await store.load("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userId), null);
});
