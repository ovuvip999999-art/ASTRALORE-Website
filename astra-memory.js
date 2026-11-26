/* ASTRA Automatic Memory v2
 * Device-only memory and conversation archive. Memories are distilled by ASTRA
 * after successful exchanges; users can review and delete them at any time.
 */
(() => {
  "use strict";
  const KEY = "astralore.astra.memory.v1";
  const MAX_MEMORIES = 40;
  const MAX_HISTORY = 500;
  const MAX_TEXT = 240;

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || "{}");
      return {
        memories: Array.isArray(value.memories)
          ? value.memories.filter(x => x && typeof x.id === "string" && typeof x.text === "string").slice(0, MAX_MEMORIES)
          : [],
        history: Array.isArray(value.history)
          ? value.history.filter(x => x && ["user", "assistant"].includes(x.role) && typeof x.content === "string").slice(-MAX_HISTORY)
          : []
      };
    } catch {
      return { memories: [], history: [] };
    }
  }

  function write(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        version: 2,
        memories: data.memories.slice(0, MAX_MEMORIES),
        history: data.history.slice(-MAX_HISTORY),
        updatedAt: new Date().toISOString()
      }));
      return true;
    } catch {
      return false;
    }
  }

  function getMemories() { return read().memories; }

  function addMemories(items) {
    if (!Array.isArray(items)) return 0;
    const data = read();
    let added = 0;
    for (const raw of items.slice(0, 3)) {
      const clean = String(raw || "").trim().replace(/\s+/g, " ").replace(/[<>]/g, "").slice(0, MAX_TEXT);
      if (!clean) continue;
      const existing = data.memories.findIndex(item => item.text.toLowerCase() === clean.toLowerCase());
      if (existing >= 0) {
        data.memories[existing].updatedAt = new Date().toISOString();
        continue;
      }
      data.memories.unshift({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        text: clean,
        createdAt: new Date().toISOString()
      });
      added++;
    }
    data.memories = data.memories.slice(0, MAX_MEMORIES);
    write(data);
    return added;
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

  function getHistory() { return read().history; }

  function saveHistory(history) {
    const data = read();
    data.history = Array.isArray(history)
      ? history.filter(x => x && ["user", "assistant"].includes(x.role) && typeof x.content === "string").slice(-MAX_HISTORY)
      : [];
    return write(data);
  }

  function clearHistory() { return saveHistory([]); }

  window.ASTRAMemory = Object.freeze({
    getMemories, addMemories, removeMemory, clearMemories,
    getHistory, saveHistory, clearHistory
  });
})();
