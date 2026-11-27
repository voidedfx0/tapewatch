"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../../lib/supabase";

type Mode = "signin" | "signup" | "reset";
type Access = "visitor" | "authenticated";

export default function AuthPanel({
  onAccessChange,
  requestAuth = 0,
  showTrigger = true,
  openOnVisitor = true,
}: {
  onAccessChange?: (access: Access) => void;
  requestAuth?: number;
  showTrigger?: boolean;
  openOnVisitor?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      onAccessChange?.("visitor");
      if (openOnVisitor) {
        setOpen(true);
        setMessage("Account sign-in is temporarily unavailable. You can still continue as a visitor.");
      }
      return;
    }
    const refresh = async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (session?.user.is_anonymous) {
        await supabase.auth.signOut();
        setUserEmail(null);
        onAccessChange?.("visitor");
        if (openOnVisitor) setOpen(true);
        return;
      }
      setUserEmail(session?.user.email ?? null);
      if (session?.user.email) {
        onAccessChange?.("authenticated");
      } else {
        onAccessChange?.("visitor");
        if (openOnVisitor) setOpen(true);
      }
    };
    void refresh();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const signedIn = Boolean(session?.user.email && !session.user.is_anonymous);
      setUserEmail(signedIn ? session?.user.email ?? null : null);
      onAccessChange?.(signedIn ? "authenticated" : "visitor");
    });
    return () => listener.subscription.unsubscribe();
  }, [onAccessChange, openOnVisitor]);

  useEffect(() => {
    if (requestAuth > 0) {
      setMode("signin");
      setOpen(true);
      setMessage("Sign in or create an account to use this service.");
    }
  }, [requestAuth]);

  function continueAsVisitor() {
    setOpen(false);
    setMessage("");
    onAccessChange?.("visitor");
  }

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
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setMessage("Check your inbox to verify your email and finish creating your account.");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        if (!data.user || data.user.is_anonymous) throw new Error("A verified account is required.");
        setUserEmail(data.user.email ?? null);
        onAccessChange?.("authenticated");
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
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setMessage(error.message);
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
      onAccessChange?.("visitor");
      window.location.reload();
    }
  }

  return (
    <>
      {showTrigger && <button type="button" className="account-trigger" onClick={() => { setOpen(true); setMessage(""); setMode("signin"); }}>
        <span className="account-trigger-dot" />
        {userEmail || "Visitor · Sign in"}
      </button>}
      {open && typeof document !== "undefined" && createPortal(
        <div className="auth-backdrop auth-dropdown-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="auth-dialog auth-dropdown-panel" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <button className="auth-close" type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            <div className="auth-presence" aria-hidden="true">
              <span className="auth-eye"><svg viewBox="0 0 36 24"><path d="M2 12C6 5.5 11.5 2.5 18 2.5S30 5.5 34 12c-4 6.5-9.5 9.5-16 9.5S6 18.5 2 12Z"/><circle cx="18" cy="12" r="5.2"/><circle className="auth-eye-glint" cx="20" cy="10" r="1.3"/><path className="auth-eye-lid" d="M2 12C6 5.5 11.5 2.5 18 2.5S30 5.5 34 12"/></svg></span>
              <span className="auth-presence-copy" key={mode}>TAPEWATCH <i>·</i> YOUR SIGNAL, IN FOCUS</span>
            </div>
            <div className="eyebrow">TAPEWATCH ACCOUNT</div>
            <h2 id="auth-title">{userEmail ? "Your account" : mode === "signup" ? "Create your account" : mode === "reset" ? "Reset password" : "Welcome to TapeWatch"}</h2>
            <p className="auth-description">{userEmail ? "Your workspace is connected to this account." : "Explore Circuits and Networks as a visitor. Sign in to add websites, run checks, enable monitoring and save your work."}</p>
            {!supabase ? <>
              <p className="auth-message">Account sign-in is not configured for this deployment yet.</p>
              <button type="button" className="auth-secondary auth-visitor" onClick={continueAsVisitor}>Continue as visitor</button>
            </> : userEmail ? <>
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
              <button type="button" className="auth-secondary auth-visitor" disabled={busy} onClick={continueAsVisitor}>Continue as visitor</button>
            </>}
            {message && <p className="auth-message" role="status">{message}</p>}
            <p className="auth-footnote">Visitor activity is not saved. An account is required for personal workspaces and monitoring services.</p>
          </section>
        </div>,
        document.body
      )}
    </>
  );
}
