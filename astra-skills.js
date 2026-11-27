/* ASTRA V2 — private Markdown skill manager. */
(() => {
  "use strict";
  const client = window.ASTRASupabase;
  const openButton = document.getElementById("astraSkillsButton");
  const dialog = document.getElementById("astraSkillsDialog");
  const fileInput = document.getElementById("astraSkillFile");
  const uploadButton = document.getElementById("astraSkillUpload");
  const list = document.getElementById("astraSkillsList");
  const status = document.getElementById("astraSkillsStatus");
  if (!client || !openButton || !dialog || !fileInput || !uploadButton || !list || !status) return;

  const MAX_FILE_BYTES = 24 * 1024;
  const MAX_SKILL_CHARS = 20000;
  const MAX_SKILLS = 10;
  let skills = [];

  function say(message) { status.textContent = message; }

  async function requireUser() {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new Error("Sign in to manage your ASTRA skills.");
    return data.user;
  }

  function render() {
    list.replaceChildren();
    if (!skills.length) {
      const empty = document.createElement("p");
      empty.className = "astra-skills-empty";
      empty.textContent = "No skill files yet. Upload a .md file to give ASTRA extra task-specific guidance.";
      list.appendChild(empty);
      return;
    }
    skills.forEach(skill => {
      const row = document.createElement("article");
      row.className = "astra-skill-row";
      const details = document.createElement("div");
      details.className = "astra-skill-details";
      const name = document.createElement("strong");
      name.textContent = skill.name;
      const description = document.createElement("small");
      description.textContent = skill.description || "Markdown skill";
      details.append(name, description);

      const controls = document.createElement("div");
      controls.className = "astra-skill-actions";
      const toggleLabel = document.createElement("label");
      toggleLabel.className = "astra-skill-toggle";
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = !!skill.enabled;
      toggle.setAttribute("aria-label", "Enable " + skill.name);
      toggle.addEventListener("change", () => updateSkill(skill.id, { enabled: toggle.checked }));
      const toggleText = document.createElement("span");
      toggleText.textContent = skill.enabled ? "ON" : "OFF";
      toggleLabel.append(toggle, toggleText);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "astra-skill-delete";
      remove.textContent = "DELETE";
      remove.addEventListener("click", () => deleteSkill(skill));
      controls.append(toggleLabel, remove);
      row.append(details, controls);
      list.appendChild(row);
    });
  }

  async function loadSkills() {
    await requireUser();
    const { data, error } = await client.from("astra_skills")
      .select("id,name,description,enabled,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(MAX_SKILLS);
    if (error) throw error;
    skills = Array.isArray(data) ? data : [];
    render();
    say(skills.length + " / " + MAX_SKILLS + " skill files");
  }

  async function updateSkill(id, changes) {
    try {
      const { error } = await client.from("astra_skills")
        .update({ ...changes, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      await loadSkills();
      say("Skill settings saved.");
    } catch (error) {
      say(error.message || "Could not update this skill.");
      await loadSkills().catch(() => {});
    }
  }

  async function deleteSkill(skill) {
    if (!window.confirm("Delete the skill file “" + skill.name + "”?")) return;
    try {
      const { error } = await client.from("astra_skills").delete().eq("id", skill.id);
      if (error) throw error;
      await loadSkills();
      say("Skill deleted.");
    } catch (error) {
      say(error.message || "Could not delete this skill.");
    }
  }

  async function uploadSkill() {
    const file = fileInput.files?.[0];
    if (!file) { say("Choose a Markdown .md file first."); return; }
    if (!/\.md$/i.test(file.name)) { say("Only .md Markdown files are supported."); return; }
    if (file.size < 1 || file.size > MAX_FILE_BYTES) {
      say("Keep each Markdown file under 24 KB.");
      return;
    }
    uploadButton.disabled = true;
    try {
      const user = await requireUser();
      if (skills.length >= MAX_SKILLS) throw new Error("You have reached the 10-skill limit. Delete one before adding another.");
      const content = await file.text();
      if (!content.trim() || content.length > MAX_SKILL_CHARS) throw new Error("This file is empty or exceeds the 20,000-character limit.");
      const cleanName = file.name.replace(/[^a-z0-9._ -]/gi, "").slice(0, 120) || "custom-skill.md";
      const { error } = await client.from("astra_skills").insert({
        user_id: user.id,
        name: cleanName,
        description: "Uploaded Markdown skill",
        content,
        enabled: true
      });
      if (error) throw error;
      fileInput.value = "";
      await loadSkills();
      say("Uploaded and enabled " + cleanName + ".");
    } catch (error) {
      say(error.message || "Skill upload failed.");
    } finally {
      uploadButton.disabled = false;
    }
  }

  openButton.addEventListener("click", async () => {
    openButton.disabled = true;
    try {
      await loadSkills();
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } catch (error) {
      say(error.message || "Could not open your skills.");
      if (typeof dialog.showModal === "function") dialog.showModal();
    } finally {
      openButton.disabled = false;
    }
  });
  uploadButton.addEventListener("click", uploadSkill);
  window.addEventListener("astra-auth-changed", event => {
    if (!event.detail?.user) {
      skills = [];
      render();
      if (dialog.open) dialog.close();
    }
  });
})();
