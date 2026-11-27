export function createDocumentStore({ baseUrl, anonKey, authorization, fetchImpl = fetch }) {
  const root = String(baseUrl || "").replace(/\/+$/, "");
  if (!root || !anonKey || !authorization) {
    throw new Error("ASTRA document storage is not configured.");
  }

  const headers = {
    apikey: anonKey,
    Authorization: authorization,
    "Content-Type": "application/json"
  };

  return {
    async save(conversationId, userId, document) {
      const response = await fetchImpl(root + "/rest/v1/astra_documents?on_conflict=conversation_id", {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          conversation_id: conversationId,
          user_id: userId,
          file_name: document.name,
          mime_type: document.mimeType,
          extracted_text: document.text,
          storage_path: typeof document.storagePath === "string" ? document.storagePath : null,
          updated_at: new Date().toISOString()
        })
      });
      if (!response.ok) {
        throw new Error("Document save failed (" + response.status + ").");
      }
    },

    async load(conversationId, userId) {
      const query = new URLSearchParams({
        select: "file_name,mime_type,extracted_text,storage_path",
        conversation_id: "eq." + conversationId,
        user_id: "eq." + userId,
        limit: "1"
      });
      const response = await fetchImpl(root + "/rest/v1/astra_documents?" + query.toString(), {
        method: "GET",
        headers
      });
      if (!response.ok) {
        throw new Error("Document retrieval failed (" + response.status + ").");
      }
      const rows = await response.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row || typeof row.extracted_text !== "string") return null;
      return {
        name: String(row.file_name || "Previously uploaded document"),
        mimeType: String(row.mime_type || "text/plain"),
        text: row.extracted_text,
        storagePath: typeof row.storage_path === "string" ? row.storage_path : null
      };
    }
  };
}
