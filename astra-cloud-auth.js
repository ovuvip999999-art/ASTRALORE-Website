/* ASTRA Supabase Auth bootstrap. No database service key is used in the browser. */
(() => {
  "use strict";
  const config = window.supabase;
  const url = window.ASTRA_SUPABASE_URL;
  const key = window.ASTRA_SUPABASE_ANON_KEY;
  const button = document.getElementById("astraAccountButton");
  const dialog = document.getElementById("astraAccountDialog");
  const form = document.getElementById("astraAuthForm");
  const email = document.getElementById("astraAuthEmail");
  const password = document.getElementById("astraAuthPassword");
  const status = document.getElementById("astraAuthStatus");
  const signIn = document.getElementById("astraSignIn");
  const signUp = document.getElementById("astraSignUp");
  const signOut = document.getElementById("astraSignOut");

  if (!config?.createClient || !url || !key || !button || !dialog || !form) {
    if (button) button.disabled = true;
    return;
  }

  const client = config.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  window.ASTRASupabase = client;

  function showStatus(message) {
    if (status) status.textContent = message;
  }

  function updateAccount(user) {
    const authenticated = !!user;
    document.body.dataset.authenticated = authenticated ? "true" : "false";
    document.body.classList.toggle("astra-auth-required", !authenticated);
    button.textContent = authenticated ? "ACCOUNT · " + (user.email || "SIGNED IN") : "SIGN IN";
    signIn.hidden = authenticated;
    signUp.hidden = authenticated;
    signOut.hidden = !authenticated;
    password.autocomplete = authenticated ? "off" : "current-password";
    if (user) email.value = user.email || "";
    if (authenticated && dialog.open) dialog.close();
    if (!authenticated && !dialog.open && typeof dialog.showModal === "function") {
      showStatus("Sign in or create an account before using ASTRA.");
      dialog.showModal();
    }
  }

  button.addEventListener("click", async () => {
    const { data } = await client.auth.getSession();
    updateAccount(data.session?.user || null);
    showStatus(data.session ? "Signed in. Your cloud archive will load when the page finishes connecting." : "Sign in or create an account to access your cloud conversation archive.");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!email.value.trim() || !password.value) return;
    signIn.disabled = true;
    signUp.disabled = true;
    showStatus("Signing in…");
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: email.value.trim(),
        password: password.value
      });
      if (error) throw error;
      updateAccount(data.user);
      password.value = "";
      showStatus("Signed in successfully. Connecting to your cloud conversation archive…");
    } catch (error) {
      showStatus(error.message || "Sign-in failed. Please try again.");
    } finally {
      signIn.disabled = false;
      signUp.disabled = false;
    }
  });

  signUp.addEventListener("click", async () => {
    if (!email.value.trim() || password.value.length < 8) {
      showStatus("Enter a valid email and a password of at least 8 characters.");
      return;
    }
    signUp.disabled = true;
    showStatus("Creating your account…");
    try {
      const { data, error } = await client.auth.signUp({
        email: email.value.trim(),
        password: password.value,
        options: {
          emailRedirectTo: window.location.origin + "/astra.html"
        }
      });
      if (error) throw error;
      password.value = "";
      showStatus(data.session
        ? "Account created and signed in."
        : "Account created. Check your email for the confirmation link, then sign in.");
      updateAccount(data.session?.user || null);
    } catch (error) {
      showStatus(error.message || "Account creation failed. Please try again.");
    } finally {
      signUp.disabled = false;
    }
  });

  signOut.addEventListener("click", async () => {
    signOut.disabled = true;
    const { error } = await client.auth.signOut();
    signOut.disabled = false;
    if (error) {
      showStatus(error.message || "Could not sign out.");
      return;
    }
    updateAccount(null);
    showStatus("You have been signed out. Sign in to use ASTRA again.");
  });

  client.auth.onAuthStateChange((_event, session) => {
    updateAccount(session?.user || null);
    window.dispatchEvent(new CustomEvent("astra-auth-changed", { detail: { user: session?.user || null } }));
  });
  client.auth.getSession().then(({ data }) => {
    updateAccount(data.session?.user || null);
    window.dispatchEvent(new CustomEvent("astra-auth-ready", { detail: { user: data.session?.user || null } }));
  });
})();