/* ASTRA cloud archive. All database access uses the signed-in user's JWT and RLS. */
(() => {
  "use strict";
  const client = window.ASTRASupabase;
  if (!client) return;
  const MAX_CONTENT = 30000;
  async function requireUser() {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new Error("Sign in to use cloud conversations.");
    return data.user;
  }
  async function listConversations() {
    const user = await requireUser();
    const all = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from("astra_conversations")
        .select("id,title,created_at,updated_at")
        .eq("user_id", user.id).order("updated_at", { ascending: false })
        .range(offset, offset + 499);
      if (error) throw error;
      all.push(...(data || []));
      if (!data || data.length < 500) break;
    }
    return all;
  }
  async function createConversation(title) {
    const user = await requireUser();
    const { data, error } = await client.from("astra_conversations")
      .insert({ user_id: user.id, title: String(title || "New conversation").slice(0,160) })
      .select("id,title,created_at,updated_at").single();
    if (error) throw error;
    return data;
  }
  async function loadMessages(conversationId) {
    const user = await requireUser();
    const all = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from("astra_messages")
        .select("role,content,sequence_no,created_at")
        .eq("user_id", user.id).eq("conversation_id", conversationId)
        .order("sequence_no", { ascending: true })
        .range(offset, offset + 999);
      if (error) throw error;
      all.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return all.map(row => ({ role: row.role, content: row.content }));
  }
  async function appendMessages(conversation, messages) {
    const user = await requireUser();
    if (!conversation?.id || !Array.isArray(messages) || !messages.length) return;
    const rows = messages.map((item, index) => ({
      conversation_id: conversation.id,
      user_id: user.id,
      role: item.role,
      content: String(item.content || "").slice(0, MAX_CONTENT),
      sequence_no: Number(item.sequence_no ?? index)
    })).filter(row => ["user","assistant"].includes(row.role) && row.content);
    if (!rows.length) return;
    const { error } = await client.from("astra_messages")
      .upsert(rows, { onConflict: "conversation_id,sequence_no", ignoreDuplicates: true });
    if (error) throw error;
    const firstUser = rows.find(row => row.role === "user");
    const updates = { updated_at: new Date().toISOString() };
    if (firstUser) updates.title = firstUser.content.replace(/\\s+/g, " ").slice(0,64);
    const { error: updateError } = await client.from("astra_conversations")
      .update(updates)
      .eq("id", conversation.id).eq("user_id", user.id);
    if (updateError) throw updateError;
  }
  async function searchMessages(query) {
    const user = await requireUser();
    const { data, error } = await client.rpc("astra_search_messages", {
      p_user_id: user.id, p_query: String(query || "").slice(0,300), p_limit: 20
    });
    if (error) throw error;
    return data || [];
  }
  async function deleteConversation(id) {
    const user = await requireUser();
    const { error } = await client.from("astra_conversations").delete()
      .eq("id", id).eq("user_id", user.id);
    if (error) throw error;
  }
  window.ASTRACloud = Object.freeze({
    requireUser, listConversations, createConversation, loadMessages,
    appendMessages, searchMessages, deleteConversation
  });
})();