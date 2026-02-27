import React from "react";
import { NavLink } from "react-router-dom";

const tabs = [
  { to: "/dashboard", label: "Home" },
  { to: "/incidents", label: "Pins" },
  { to: "/profile", label: "Profil" },
  { to: "/admin", label: "Admin", adminOnly: true },
];

export default function AppShell({ children, profile, onLogout }) {
  const isAdmin = profile?.role === "admin";
  const visibleTabs = tabs.filter((t) => (t.adminOnly ? isAdmin : true));

  return (
    <div className="app">
      <div className="app__frame">
        <header className="app__header">
          <div className="app__brand">
            <div className="app__brandTitle">Rideout Med</div>
            <div className="app__brandSub">
              {profile?.role ? `${profile.role} · ` : ""}
              {profile?.full_name ?? ""}
            </div>
          </div>

          <button className="btn btn--ghost" onClick={onLogout}>
            Logout
          </button>
        </header>

        <main className="app__content">{children}</main>

        <nav className="tabbar">
          {visibleTabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                "tabbar__item" + (isActive ? " is-active" : "")
              }
            >
              <span className="tabbar__label">{t.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="tabbar__safe" />
      </div>
    </div>
  );
}
