/* ASTRA Local Memory v1
 * Device-only storage. No account or cross-device sync.
 * Store only information the user explicitly chooses to remember.
 */
(() => {
  "use strict";
  const KEY = "astralore.astra.memory.v1";
  const MAX_MEMORIES = 12;
  const MAX_HISTORY = 16;
  const MAX_TEXT = 240;

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || "{}");
      return {
        memories: Array.isArray(value.memories) ? value.memories.filter(x => x && typeof x.id === "string" && typeof x.text === "string").slice(0, MAX_MEMORIES) : [],
        history: Array.isArray(value.history) ? value.history.filter(x => x && ["user", "assistant"].includes(x.role) && typeof x.content === "string").slice(-MAX_HISTORY) : []
      };
    } catch {
      return { memories: [], history: [] };
    }
  }

  function write(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        version: 1,
        memories: data.memories.slice(0, MAX_MEMORIES),
        history: data.history.slice(-MAX_HISTORY),
        updatedAt: new Date().toISOString()
      }));
      return true;
    } catch {
      return false;
    }
  }

  function getMemories() {
    return read().memories;
  }

  function addMemory(text) {
    const clean = String(text || "").trim().replace(/\s+/g, " ").slice(0, MAX_TEXT);
    if (!clean) return { ok: false, reason: "empty" };
    const data = read();
    if (data.memories.some(item => item.text.toLowerCase() === clean.toLowerCase())) return { ok: false, reason: "duplicate" };
    if (data.memories.length >= MAX_MEMORIES) return { ok: false, reason: "limit" };
    data.memories.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text: clean, createdAt: new Date().toISOString() });
    return { ok: write(data) };
  }

  function removeMemory(id) {
    const data = read();
    data.memories = data.memories.filter(item => item.id !== id);
    return write(data);
  }

  function clearMemories() {
    const data = read();
    data.memories = [];
    return write(data);
  }

  function getHistory() {
    return read().history;
  }

  function saveHistory(history) {
    const data = read();
    data.history = Array.isArray(history) ? history.filter(x => x && ["user", "assistant"].includes(x.role) && typeof x.content === "string").slice(-MAX_HISTORY) : [];
    return write(data);
  }

  function clearHistory() {
    return saveHistory([]);
  }

  window.ASTRAMemory = Object.freeze({
    getMemories, addMemory, removeMemory, clearMemories,
    getHistory, saveHistory, clearHistory
  });
})();
