import React, { useState } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");

  const sendLink = async () => {
    setStatus("Sende Link…");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin, // wichtig für Netlify später
      },
    });

    if (error) setStatus("Fehler: " + error.message);
    else setStatus("Check deine Mails – Magic-Link wurde gesendet.");
  };

  return (
    <div className="screen center">
      <div className="card">
        <h1 className="h1">Rideout Med</h1>
        <p className="muted">
          Login via Magic-Link (E-Mail). Ideal für Handy-Einsatz.
        </p>

        <label className="label">E-Mail</label>
        <input
          className="input"
          placeholder="name@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />

        <button className="btn primary" onClick={sendLink} disabled={!email}>
          Link senden
        </button>

        {status && <p className="status">{status}</p>}
      </div>
    </div>
  );
}
