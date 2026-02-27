import React from "react";

export default function Profile({ profile }) {
  return (
    <div className="page stack">
      <div className="card">
        <div className="card__title">Mein Profil</div>

        <div className="stack" style={{ marginTop: 10 }}>
          <div className="kv">
            <div className="kv__k">Name</div>
            <div className="kv__v">{profile?.full_name ?? "-"}</div>
          </div>

          <div className="kv">
            <div className="kv__k">Rolle</div>
            <div className="kv__v">{profile?.role ?? "-"}</div>
          </div>

          <div className="kv">
            <div className="kv__k">User ID</div>
            <div className="kv__v mono">{profile?.user_id ?? "-"}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mutedSmall">
          Name und Rolle werden im Adminbereich verwaltet.
        </div>
      </div>
    </div>
  );
}
