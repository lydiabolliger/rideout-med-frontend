import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { severityLabelDe } from "../lib/severity";

const RIDEOUT_TOKEN_STORAGE_KEY = "rideout_join_token";

function generateJoinToken() {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fmtDate(v) {
  if (!v) return "-";
  return new Date(v).toLocaleString();
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function msBetween(fromIso, toIso) {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, to - from);
}

function withTimeout(promise, ms = 12000, message = "Zeitüberschreitung beim Laden.") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

export default function Admin({ profile, onProfileUpdated }) {
  const [toast, setToast] = useState(null);
  const [openSections, setOpenSections] = useState({
    rideout: false,
    users: false,
    analytics: false,
  });
  const [openIncidents, setOpenIncidents] = useState({});

  const [activeRideout, setActiveRideout] = useState(null);
  const [rideoutTitle, setRideoutTitle] = useState("");
  const [rideoutLoading, setRideoutLoading] = useState(false);

  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesRows, setProfilesRows] = useState([]);
  const [savingProfileId, setSavingProfileId] = useState(null);

  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [incidents, setIncidents] = useState([]);
  const [assignmentsByIncident, setAssignmentsByIncident] = useState({});
  const [nameByUserId, setNameByUserId] = useState({});
  const [closingIncidentId, setClosingIncidentId] = useState(null);

  const isAdmin = profile?.role === "admin";

  const activeRideoutLink = useMemo(() => {
    if (!activeRideout?.join_token) return "";
    return `${window.location.origin}/login?rideout=${activeRideout.join_token}`;
  }, [activeRideout?.join_token]);

  const toggleSection = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleIncident = (incidentId) => {
    setOpenIncidents((prev) => ({ ...prev, [incidentId]: !prev[incidentId] }));
  };

  const loadActiveRideout = async () => {
    if (!isAdmin) return;
    setRideoutLoading(true);
    try {
      const { data, error } = await withTimeout(
        supabase
          .from("rideouts")
          .select("id, title, join_token, started_at, closed_at")
          .is("closed_at", null)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        12000,
        "Zeitüberschreitung beim Laden des Rideout-Status."
      );
      if (error) throw error;
      setActiveRideout(data ?? null);
    } catch (e) {
      console.warn("[Admin] loadActiveRideout failed", e);
      setToast(e?.message ?? "Aktiver Rideout konnte nicht geladen werden.");
      setActiveRideout(null);
    } finally {
      setRideoutLoading(false);
    }
  };

  const startRideout = async () => {
    if (!isAdmin) return;
    if (activeRideout?.id) {
      setToast("Es ist bereits ein Rideout aktiv. Bitte zuerst schliessen.");
      return;
    }

    setRideoutLoading(true);
    setToast(null);
    try {
      const token = generateJoinToken();
      const payload = {
        title: rideoutTitle.trim() || `Rideout ${new Date().toLocaleDateString()}`,
        join_token: token,
        started_at: new Date().toISOString(),
        created_by: profile?.user_id ?? null,
      };

      const { data, error } = await supabase
        .from("rideouts")
        .insert(payload)
        .select("id, title, join_token, started_at, closed_at")
        .single();
      if (error) throw error;

      setActiveRideout(data);
      setRideoutTitle("");
      setToast("Rideout gestartet.");
    } catch (e) {
      console.warn("[Admin] startRideout failed", e);
      setToast(e?.message ?? "Rideout konnte nicht gestartet werden.");
    } finally {
      setRideoutLoading(false);
    }
  };

  const closeRideout = async () => {
    if (!isAdmin || !activeRideout?.id) return;
    setRideoutLoading(true);
    setToast(null);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("rideouts")
        .update({ closed_at: now })
        .eq("id", activeRideout.id);
      if (error) throw error;

      localStorage.removeItem(RIDEOUT_TOKEN_STORAGE_KEY);
      setActiveRideout(null);
      setToast("Rideout geschlossen. Link ist nicht mehr gueltig.");
    } catch (e) {
      console.warn("[Admin] closeRideout failed", e);
      setToast(e?.message ?? "Rideout konnte nicht geschlossen werden.");
    } finally {
      setRideoutLoading(false);
    }
  };

  const copyActiveRideoutLink = async () => {
    if (!activeRideoutLink) return;
    try {
      await navigator.clipboard.writeText(activeRideoutLink);
      setToast("Rideout-Link kopiert.");
    } catch (e) {
      console.warn("[Admin] copy link failed", e);
      setToast("Link konnte nicht kopiert werden.");
    }
  };

  const loadProfiles = async () => {
    if (!isAdmin) return;
    setProfilesLoading(true);
    try {
      const { data, error } = await withTimeout(
        supabase
          .from("profiles")
          .select("user_id, full_name, role")
          .order("full_name", { ascending: true, nullsFirst: false }),
        12000,
        "Zeitüberschreitung beim Laden der Benutzerverwaltung."
      );
      if (error) throw error;
      setProfilesRows(data ?? []);
    } catch (e) {
      console.warn("[Admin] loadProfiles failed", e);
      setToast(e?.message ?? "Profile konnten nicht geladen werden.");
      setProfilesRows([]);
    } finally {
      setProfilesLoading(false);
    }
  };

  const updateProfileRow = (userId, patch) => {
    setProfilesRows((prev) =>
      prev.map((r) => (r.user_id === userId ? { ...r, ...patch } : r))
    );
  };

  const saveProfileRow = async (row) => {
    if (!isAdmin) return;
    setSavingProfileId(row.user_id);
    setToast(null);
    try {
      const payload = {
        user_id: row.user_id,
        full_name: row.full_name?.trim() || null,
        role: row.role === "admin" ? "admin" : "helper",
      };
      const { data, error } = await supabase
        .from("profiles")
        .upsert(payload, { onConflict: "user_id" })
        .select("user_id, full_name, role")
        .single();
      if (error) throw error;

      updateProfileRow(row.user_id, data);
      if (profile?.user_id === row.user_id) onProfileUpdated?.(data);
      setToast(`Profil gespeichert: ${data.full_name ?? data.user_id}`);
    } catch (e) {
      console.warn("[Admin] saveProfileRow failed", e);
      setToast(e?.message ?? "Profil konnte nicht gespeichert werden.");
    } finally {
      setSavingProfileId(null);
    }
  };

  const loadAnalytics = async () => {
    if (!isAdmin) return;
    setAnalyticsLoading(true);
    setToast(null);

    try {
      const [{ data: incidentsData, error: incidentsErr }, { data: assignmentsData, error: assignmentsErr }, { data: profilesData, error: profilesErr }] =
        await withTimeout(
          Promise.all([
            supabase
              .from("incidents")
              .select("id, created_at, closed_at, lat, lng, severity, note, needs_backup, created_by")
              .order("created_at", { ascending: false })
              .limit(500),
            supabase
              .from("incident_assignments")
              .select("incident_id, helper_id, joined_at, left_at")
              .order("joined_at", { ascending: true })
              .limit(5000),
            supabase.from("profiles").select("user_id, full_name"),
          ]),
          12000,
          "Zeitüberschreitung beim Laden der Incident-Auswertung."
        );

      if (incidentsErr) throw incidentsErr;
      if (assignmentsErr) throw assignmentsErr;
      if (profilesErr) throw profilesErr;

      const grouped = {};
      (assignmentsData ?? []).forEach((a) => {
        if (!grouped[a.incident_id]) grouped[a.incident_id] = [];
        grouped[a.incident_id].push(a);
      });

      const names = {};
      (profilesData ?? []).forEach((p) => {
        names[p.user_id] = p.full_name ?? p.user_id;
      });

      setAssignmentsByIncident(grouped);
      setIncidents(incidentsData ?? []);
      setNameByUserId(names);
      setOpenIncidents({});
    } catch (e) {
      console.warn("[Admin] loadAnalytics failed", e);
      setToast(e?.message ?? "Auswertung konnte nicht geladen werden.");
      setIncidents([]);
      setAssignmentsByIncident({});
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const closeIncident = async (incidentId) => {
    setClosingIncidentId(incidentId);
    setToast(null);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("incidents")
        .update({ closed_at: now })
        .eq("id", incidentId);
      if (error) throw error;
      await loadAnalytics();
      setToast("Incident geschlossen.");
    } catch (e) {
      console.warn("[Admin] closeIncident failed", e);
      setToast(e?.message ?? "Incident konnte nicht geschlossen werden.");
    } finally {
      setClosingIncidentId(null);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    loadActiveRideout();
    loadProfiles();
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="page">
        <div className="card">
          <div className="card__title">Kein Zugriff</div>
          <div className="mutedSmall">Dieser Bereich ist nur fuer Admins.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page stack">
      {toast && (
        <div className="card">
          <div className="mutedSmall">{toast}</div>
        </div>
      )}

      <div className="card">
        <div className="row row--between">
          <div className="card__title" style={{ margin: 0 }}>Rideout-Management</div>
          <div className="row">
            <button className="btn" type="button" onClick={loadActiveRideout} disabled={rideoutLoading}>
              {rideoutLoading ? "Lade..." : "Neu laden"}
            </button>
            <button className="btn" type="button" onClick={() => toggleSection("rideout")}>
              {openSections.rideout ? "Einklappen" : "Ausklappen"}
            </button>
          </div>
        </div>

        {openSections.rideout && (
          <div className="stack" style={{ marginTop: 10 }}>
            {activeRideout ? (
              <>
                <div className="kv">
                  <div className="kv__k">Aktiv</div>
                  <div className="kv__v">{activeRideout.title}</div>
                </div>
                <div className="mutedSmall">Gestartet: {fmtDate(activeRideout.started_at)}</div>
                <input className="btn mono" value={activeRideoutLink} readOnly />
                <div className="row">
                  <button className="btn" type="button" onClick={copyActiveRideoutLink}>
                    Link kopieren
                  </button>
                  <button className="btn" type="button" onClick={closeRideout} disabled={rideoutLoading}>
                    Rideout schliessen
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mutedSmall">
                  Kein Rideout aktiv. Starte einen neuen Rideout, damit ein gueltiger Link erzeugt wird.
                </div>
                <input
                  className="btn"
                  type="text"
                  value={rideoutTitle}
                  onChange={(e) => setRideoutTitle(e.target.value)}
                  placeholder="Rideout-Name (optional)"
                />
                <button className="btn" type="button" onClick={startRideout} disabled={rideoutLoading}>
                  Rideout starten
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="row row--between">
          <div className="card__title" style={{ margin: 0 }}>Benutzerverwaltung</div>
          <div className="row">
            <button className="btn" type="button" onClick={loadProfiles} disabled={profilesLoading}>
              {profilesLoading ? "Lade..." : "Neu laden"}
            </button>
            <button className="btn" type="button" onClick={() => toggleSection("users")}>
              {openSections.users ? "Einklappen" : "Ausklappen"}
            </button>
          </div>
        </div>

        {openSections.users && (
          <div className="list" style={{ marginTop: 10 }}>
            {profilesRows.map((r) => (
              <div className="kv" key={r.user_id}>
                <div className="stack" style={{ gap: 8 }}>
                  <div className="mutedTiny">User ID: <span className="mono">{r.user_id}</span></div>
                  <input
                    className="btn"
                    type="text"
                    value={r.full_name ?? ""}
                    onChange={(e) => updateProfileRow(r.user_id, { full_name: e.target.value })}
                    placeholder="Vor- und Nachname"
                    autoComplete="off"
                  />
                  <select
                    className="btn"
                    value={r.role ?? "helper"}
                    onChange={(e) => updateProfileRow(r.user_id, { role: e.target.value })}
                  >
                    <option value="helper">Helfer</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => saveProfileRow(r)}
                    disabled={savingProfileId === r.user_id}
                  >
                    {savingProfileId === r.user_id ? "Speichere..." : "Speichern"}
                  </button>
                </div>
              </div>
            ))}
            {!profilesLoading && profilesRows.length === 0 && (
              <div className="mutedSmall">Keine Profile gefunden.</div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="row row--between">
          <div className="card__title" style={{ margin: 0 }}>Incident-Auswertung</div>
          <div className="row">
            <button className="btn" type="button" onClick={loadAnalytics} disabled={analyticsLoading}>
              {analyticsLoading ? "Lade..." : "Neu laden"}
            </button>
            <button className="btn" type="button" onClick={() => toggleSection("analytics")}>
              {openSections.analytics ? "Einklappen" : "Ausklappen"}
            </button>
          </div>
        </div>

        {openSections.analytics && (
          <div className="list" style={{ marginTop: 10 }}>
            {incidents.map((incident) => {
              const isOpen = !!openIncidents[incident.id];
              const assignments = assignmentsByIncident[incident.id] ?? [];
              const endCandidates = assignments
                .map((a) => a.left_at || a.joined_at)
                .filter(Boolean)
                .map((iso) => new Date(iso).getTime())
                .filter(Number.isFinite);
              const fallbackEnd = endCandidates.length
                ? new Date(Math.max(...endCandidates)).toISOString()
                : null;
              const incidentEndIso = incident.closed_at || fallbackEnd || new Date().toISOString();
              const incidentDurationMs = msBetween(incident.created_at, incidentEndIso);

              return (
                <div className="kv" key={incident.id}>
                  <div className="row row--between">
                    <div className="kv__v">Incident {incident.id.slice(0, 8)}</div>
                    <div className="row">
                      <span className="badge">{severityLabelDe(incident.severity)}</span>
                      <button className="btn" type="button" onClick={() => toggleIncident(incident.id)}>
                        {isOpen ? "Zuklappen" : "Aufklappen"}
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="stack" style={{ gap: 8, marginTop: 10 }}>
                      <div className="mutedSmall">
                        Wann: {fmtDate(incident.created_at)}{incident.closed_at ? ` bis ${fmtDate(incident.closed_at)}` : " (offen)"}
                      </div>
                      <div className="mutedSmall">
                        Wo: {Number(incident.lat).toFixed(5)}, {Number(incident.lng).toFixed(5)}
                      </div>
                      <div className="mutedSmall">
                        Dauer gesamt: {fmtDuration(incidentDurationMs)}
                      </div>
                      <div className="mutedSmall">
                        Verstärkung benötigt: {incident.needs_backup ? "Ja" : "Nein"}
                      </div>
                      {incident.note ? <div className="mutedSmall">Notiz: {incident.note}</div> : null}

                      <div className="mutedTiny">Wer war da:</div>
                      {assignments.length === 0 ? (
                        <div className="mutedSmall">Keine Einsaetze zugeordnet.</div>
                      ) : (
                        assignments.map((a, idx) => {
                          const leaveIso = a.left_at || incident.closed_at || new Date().toISOString();
                          const durationMs = msBetween(a.joined_at, leaveIso);
                          return (
                            <div key={`${a.helper_id}-${a.joined_at}-${idx}`} className="mutedSmall">
                              {nameByUserId[a.helper_id] ?? a.helper_id} | von {fmtDate(a.joined_at)} bis {a.left_at ? fmtDate(a.left_at) : "offen"} | {fmtDuration(durationMs)}
                            </div>
                          );
                        })
                      )}

                      {!incident.closed_at && (
                        <button
                          className="btn"
                          type="button"
                          onClick={() => closeIncident(incident.id)}
                          disabled={closingIncidentId === incident.id}
                        >
                          {closingIncidentId === incident.id ? "Schliesse..." : "Incident schliessen"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {!analyticsLoading && incidents.length === 0 && (
              <div className="mutedSmall">Keine Incident-Daten vorhanden.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
