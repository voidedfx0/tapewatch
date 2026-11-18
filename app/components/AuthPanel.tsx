"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type Mode = "signin" | "signup" | "reset";

export default function AuthPanel() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    const refresh = async () => {
      const { data } = await supabase.auth.getSession();
      setUserEmail(data.session?.user.email ?? null);
      setAnonymous(Boolean(data.session?.user.is_anonymous));
    };
    void refresh();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? null);
      setAnonymous(Boolean(session?.user.is_anonymous));
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    try {
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setMessage("If an account exists for that address, a password reset link has been sent.");
      } else if (mode === "signup") {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session?.user.is_anonymous) {
          const { error } = await supabase.auth.updateUser(
            { email: email.trim(), password },
            { emailRedirectTo: window.location.origin }
          );
          if (error) throw error;
          setMessage("Check your inbox to verify your email. Your current workspace stays linked to this account.");
        } else {
          const { error } = await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: { emailRedirectTo: window.location.origin },
          });
          if (error) throw error;
          setMessage("Check your inbox to verify your email and finish creating your account.");
        }
      } else {
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session?.user.is_anonymous) {
          const { count, error: countError } = await supabase
            .from("websites")
            .select("id", { count: "exact", head: true })
            .eq("user_id", sessionData.session.user.id);
          if (countError) throw countError;
          if ((count ?? 0) > 0) {
            throw new Error("This temporary workspace contains saved websites. Create an account from Sign up first so your existing work stays attached.");
          }
          await supabase.auth.signOut();
        }
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        setMessage("You are signed in.");
        setOpen(false);
        window.location.reload();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Authentication could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    if (!supabase) return;
    setBusy(true);
    setMessage("");
    const { data: sessionData } = await supabase.auth.getSession();
    const options = { redirectTo: window.location.origin };
    const result = sessionData.session?.user.is_anonymous
      ? await supabase.auth.linkIdentity({ provider: "google", options })
      : await supabase.auth.signInWithOAuth({ provider: "google", options });
    if (result.error) {
      setMessage(result.error.message);
      setBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signOut();
    setBusy(false);
    if (error) setMessage(error.message);
    else {
      setMessage("Signed out. A new temporary workspace will be created if you continue without signing in.");
      window.location.reload();
    }
  }

  if (!supabase) return null;

  return (
    <>
      <button type="button" className="account-trigger" onClick={() => { setOpen(true); setMessage(""); }}>
        <span className="account-trigger-dot" />
        {userEmail ? userEmail : anonymous ? "Save your workspace" : "Sign in"}
      </button>
      {open && <div className="auth-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
          <button className="auth-close" type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button>
          <div className="eyebrow">TAPEWATCH ACCOUNT</div>
          <h2 id="auth-title">{userEmail ? "Your account" : mode === "signup" ? "Create your account" : mode === "reset" ? "Reset password" : "Welcome back"}</h2>
          <p className="auth-description">{userEmail ? "Your workspace is connected to this account." : "Sign in to keep your personal websites, checks and history together across sessions."}</p>
          {userEmail ? <>
            <div className="auth-current-account"><strong>{userEmail}</strong><span>Signed in</span></div>
            <button type="button" className="auth-secondary" disabled={busy} onClick={() => void signOut()}>{busy ? "Signing out…" : "Sign out"}</button>
          </> : <>
            <button type="button" className="auth-google" disabled={busy} onClick={() => void google()}><span className="google-mark">G</span> Continue with Google</button>
            <div className="auth-divider"><span>OR USE EMAIL</span></div>
            <form onSubmit={submit} className="auth-form">
              <label htmlFor="auth-email">Email address</label>
              <input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@gmail.com" />
              {mode !== "reset" && <><label htmlFor="auth-password">Password</label><input id="auth-password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></>}
              <button className="auth-primary" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in with email"}</button>
            </form>
            <div className="auth-links">
              {mode === "signin" ? <><button type="button" onClick={() => setMode("signup")}>Create an account</button><button type="button" onClick={() => setMode("reset")}>Forgot password?</button></> : <button type="button" onClick={() => setMode("signin")}>Back to sign in</button>}
            </div>
          </>}
          {message && <p className="auth-message" role="status">{message}</p>}
          <p className="auth-footnote">By continuing, you agree to use TapeWatch responsibly. Your private workspace is protected by account-based database policies.</p>
        </section>
      </div>}
    </>
  );
}
