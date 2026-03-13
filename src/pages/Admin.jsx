import React, { useMemo, useEffect, useState } from "react";
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
  const [openRideouts, setOpenRideouts] = useState({});
  const [openIncidents, setOpenIncidents] = useState({});

  const [activeRideout, setActiveRideout] = useState(null);
  const [rideoutTitle, setRideoutTitle] = useState("");
  const [rideoutLoading, setRideoutLoading] = useState(false);
  const [deletingRideoutId, setDeletingRideoutId] = useState(null);

  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesRows, setProfilesRows] = useState([]);
  const [savingProfileId, setSavingProfileId] = useState(null);
  const [removingProfileId, setRemovingProfileId] = useState(null);

  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [rideouts, setRideouts] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [assignmentsByIncident, setAssignmentsByIncident] = useState({});
  const [helpersByRideout, setHelpersByRideout] = useState({});
  const [nameByUserId, setNameByUserId] = useState({});
  const [closingIncidentId, setClosingIncidentId] = useState(null);

  const isAdmin = profile?.role === "admin";

  const incidentsByRideout = useMemo(() => {
    const grouped = {};
    incidents.forEach((incident) => {
      const key = incident.rideout_id ?? "__legacy__";
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(incident);
    });
    return grouped;
  }, [incidents]);

  const displayNameByUserId = useMemo(() => {
    const map = { ...nameByUserId };
    (profilesRows ?? []).forEach((p) => {
      if (p?.user_id && p?.full_name) map[p.user_id] = p.full_name;
    });
    return map;
  }, [nameByUserId, profilesRows]);

  const resolveUserName = (userId, fallbackName = null) => {
    const name = displayNameByUserId[userId] ?? fallbackName;
    if (name && String(name).trim().length > 0) return name;
    return "Unbenannter Helfer";
  };

  const activeRideoutLink = useMemo(() => {
    if (!activeRideout?.join_token) return "";
    return `${window.location.origin}/?rideout=${activeRideout.join_token}`;
  }, [activeRideout?.join_token]);

  const toggleSection = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleRideout = (rideoutId) => {
    setOpenRideouts((prev) => ({ ...prev, [rideoutId]: !prev[rideoutId] }));
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

      let insertResult = await supabase
        .from("rideouts")
        .insert(payload)
        .select("id, title, join_token, started_at, closed_at")
        .single();

      if (insertResult.error?.message?.includes("rideout_date")) {
        insertResult = await supabase
          .from("rideouts")
          .insert({
            ...payload,
            rideout_date: new Date().toISOString().slice(0, 10),
          })
          .select("id, title, join_token, started_at, closed_at")
          .single();
      }

      const { data, error } = insertResult;
      if (error) throw error;

      setActiveRideout(data);
      setRideoutTitle("");
      setToast("Rideout gestartet.");
      await loadAnalytics();
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

      // Remove live helper locations once rideout closes.
      const { error: clearLocErr } = await supabase.from("helper_locations").delete();
      if (clearLocErr) throw clearLocErr;

      localStorage.removeItem(RIDEOUT_TOKEN_STORAGE_KEY);
      setActiveRideout(null);
      setToast("Rideout geschlossen. Link ist nicht mehr gueltig.");
      await loadAnalytics();
    } catch (e) {
      console.warn("[Admin] closeRideout failed", e);
      setToast(e?.message ?? "Rideout konnte nicht geschlossen werden.");
    } finally {
      setRideoutLoading(false);
    }
  };

  const deleteRideout = async (rideout) => {
    if (!isAdmin || !rideout?.id) return;
    const confirmDelete = window.confirm(
      `Rideout "${rideout.title}" inklusive aller zugehörigen Pins und Einsätze löschen?`
    );
    if (!confirmDelete) return;

    setDeletingRideoutId(rideout.id);
    setToast(null);
    try {
      const { data: incidentRows, error: incidentRowsErr } = await supabase
        .from("incidents")
        .select("id")
        .eq("rideout_id", rideout.id);
      if (incidentRowsErr) throw incidentRowsErr;

      const incidentIds = (incidentRows ?? []).map((r) => r.id);
      if (incidentIds.length > 0) {
        const { error: assignmentsErr } = await supabase
          .from("incident_assignments")
          .delete()
          .in("incident_id", incidentIds);
        if (assignmentsErr) throw assignmentsErr;

        const { error: incidentsErr } = await supabase
          .from("incidents")
          .delete()
          .in("id", incidentIds);
        if (incidentsErr) throw incidentsErr;
      }

      const { error: rideoutHelpersErr } = await supabase
        .from("rideout_helpers")
        .delete()
        .eq("rideout_id", rideout.id);
      if (rideoutHelpersErr) throw rideoutHelpersErr;

      const { error: rideoutErr } = await supabase
        .from("rideouts")
        .delete()
        .eq("id", rideout.id);
      if (rideoutErr) throw rideoutErr;

      if (activeRideout?.id === rideout.id) {
        localStorage.removeItem(RIDEOUT_TOKEN_STORAGE_KEY);
        setActiveRideout(null);
      }

      setToast(`Rideout "${rideout.title}" wurde gelöscht.`);
      await loadActiveRideout();
      await loadAnalytics();
    } catch (e) {
      console.warn("[Admin] deleteRideout failed", e);
      setToast(e?.message ?? "Rideout konnte nicht gelöscht werden.");
    } finally {
      setDeletingRideoutId(null);
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
      const [
        { data: profileData, error: profileErr },
        { data: helperRideoutData, error: helperRideoutErr },
      ] = await withTimeout(
        Promise.all([
          supabase.from("profiles").select("user_id, full_name, role"),
          activeRideout?.id
            ? supabase.from("rideout_helpers").select("helper_id").eq("rideout_id", activeRideout.id)
            : Promise.resolve({ data: [], error: null }),
        ]),
        12000,
        "Zeitüberschreitung beim Laden der Benutzerverwaltung."
      );
      if (profileErr) throw profileErr;
      if (helperRideoutErr) throw helperRideoutErr;

      const profileMap = new Map((profileData ?? []).map((p) => [p.user_id, p]));
      const ids = new Set([
        ...Array.from(profileMap.keys()),
        ...(helperRideoutData ?? []).map((h) => h.helper_id).filter(Boolean),
      ]);

      const merged = Array.from(ids).map((userId) => {
        const p = profileMap.get(userId);
        return {
          user_id: userId,
          full_name: p?.full_name ?? "",
          role: p?.role ?? "helper",
        };
      });

      merged.sort((a, b) => {
        const an = String(a.full_name ?? "").trim();
        const bn = String(b.full_name ?? "").trim();
        if (an && bn) return an.localeCompare(bn, "de");
        if (an && !bn) return -1;
        if (!an && bn) return 1;
        return String(a.user_id).localeCompare(String(b.user_id), "de");
      });

      setProfilesRows(merged);
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

  const removeHelperRow = async (row) => {
    if (!isAdmin || !row?.user_id) return;
    const confirmed = window.confirm(
      "Helfer wirklich entfernen? Der Helfer muss danach den Rideout-Link neu anklicken."
    );
    if (!confirmed) return;

    setRemovingProfileId(row.user_id);
    setToast(null);
    try {
      if (activeRideout?.id) {
        const { error: kickErr } = await supabase.from("rideout_kicks").upsert(
          {
            rideout_id: activeRideout.id,
            user_id: row.user_id,
            kicked_at: new Date().toISOString(),
          },
          { onConflict: "rideout_id,user_id" }
        );
        if (kickErr) throw kickErr;

        const { error: activeRideoutDeleteErr } = await supabase
          .from("rideout_helpers")
          .delete()
          .eq("rideout_id", activeRideout.id)
          .eq("helper_id", row.user_id);
        if (activeRideoutDeleteErr) throw activeRideoutDeleteErr;
      }

      const { error: helperLocDeleteErr } = await supabase
        .from("helper_locations")
        .delete()
        .eq("user_id", row.user_id);
      if (helperLocDeleteErr) throw helperLocDeleteErr;

      const { error: profileDeleteErr } = await supabase
        .from("profiles")
        .delete()
        .eq("user_id", row.user_id);
      if (profileDeleteErr) throw profileDeleteErr;

      setToast("Helfer entfernt. Er muss den Rideout-Link neu öffnen.");
      await loadProfiles();
      await loadAnalytics();
    } catch (e) {
      console.warn("[Admin] removeHelperRow failed", e);
      setToast(e?.message ?? "Helfer konnte nicht entfernt werden.");
    } finally {
      setRemovingProfileId(null);
    }
  };

  const loadAnalytics = async () => {
    if (!isAdmin) return;
    setAnalyticsLoading(true);
    setToast(null);

    try {
      const [
        { data: rideoutsData, error: rideoutsErr },
        { data: incidentsData, error: incidentsErr },
        { data: assignmentsData, error: assignmentsErr },
        { data: rideoutHelpersData, error: rideoutHelpersErr },
        { data: profilesData, error: profilesErr },
      ] = await withTimeout(
        Promise.all([
          supabase
            .from("rideouts")
            .select("id, title, started_at, closed_at, created_by")
            .order("started_at", { ascending: false })
            .limit(300),
          supabase
            .from("incidents")
            .select("id, rideout_id, created_at, closed_at, lat, lng, severity, note, needs_backup, created_by")
            .order("created_at", { ascending: false })
            .limit(2000),
          supabase
            .from("incident_assignments")
            .select("incident_id, helper_id, helper_name, joined_at, left_at")
            .order("joined_at", { ascending: true })
            .limit(8000),
          supabase
            .from("rideout_helpers")
            .select("rideout_id, helper_id, helper_name, joined_at, last_seen_at")
            .order("joined_at", { ascending: true })
            .limit(8000),
          supabase.from("profiles").select("user_id, full_name"),
        ]),
        15000,
        "Zeitüberschreitung beim Laden der Incident-Auswertung."
      );

      if (rideoutsErr) throw rideoutsErr;
      if (incidentsErr) throw incidentsErr;
      if (assignmentsErr) throw assignmentsErr;
      if (rideoutHelpersErr) throw rideoutHelpersErr;
      if (profilesErr) throw profilesErr;

      const assignmentsGrouped = {};
      (assignmentsData ?? []).forEach((a) => {
        if (!assignmentsGrouped[a.incident_id]) assignmentsGrouped[a.incident_id] = [];
        assignmentsGrouped[a.incident_id].push(a);
      });

      const names = {};
      (profilesData ?? []).forEach((p) => {
        names[p.user_id] = p.full_name ?? p.user_id;
      });

      const rideoutHelpersGrouped = {};
      (rideoutHelpersData ?? []).forEach((h) => {
        if (!rideoutHelpersGrouped[h.rideout_id]) rideoutHelpersGrouped[h.rideout_id] = [];
        rideoutHelpersGrouped[h.rideout_id].push(h);
      });

      setRideouts(rideoutsData ?? []);
      setIncidents(incidentsData ?? []);
      setAssignmentsByIncident(assignmentsGrouped);
      setHelpersByRideout(rideoutHelpersGrouped);
      setNameByUserId(names);
      setOpenIncidents({});
    } catch (e) {
      console.warn("[Admin] loadAnalytics failed", e);
      setToast(e?.message ?? "Auswertung konnte nicht geladen werden.");
      setRideouts([]);
      setIncidents([]);
      setAssignmentsByIncident({});
      setHelpersByRideout({});
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

  useEffect(() => {
    if (!isAdmin) return;
    loadProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, activeRideout?.id]);

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
                  <button
                    className="btn"
                    type="button"
                    onClick={() => removeHelperRow(r)}
                    disabled={removingProfileId === r.user_id || r.role === "admin"}
                  >
                    {removingProfileId === r.user_id ? "Entferne..." : "Helfer entfernen"}
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
            {rideouts.map((rideout) => {
              const rideoutIncidentList = incidentsByRideout[rideout.id] ?? [];
              const isRideoutOpen = !!openRideouts[rideout.id];
              const isDeleting = deletingRideoutId === rideout.id;
              return (
                <div className="kv" key={rideout.id}>
                  <div className="row row--between">
                    <div>
                      <div className="kv__v">{rideout.title}</div>
                      <div className="mutedTiny">
                        {fmtDate(rideout.started_at)}{rideout.closed_at ? ` bis ${fmtDate(rideout.closed_at)}` : " (aktiv)"}
                      </div>
                    </div>
                    <div className="row">
                      <button className="btn" type="button" onClick={() => toggleRideout(rideout.id)}>
                        {isRideoutOpen ? "Zuklappen" : "Aufklappen"}
                      </button>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => deleteRideout(rideout)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? "Lösche..." : "Rideout löschen"}
                      </button>
                    </div>
                  </div>

                  {isRideoutOpen && (
                    <div className="stack" style={{ marginTop: 10, gap: 8 }}>
                      <div className="card" style={{ padding: 10 }}>
                        <div className="mutedTiny" style={{ marginBottom: 6 }}>Helfer im Rideout:</div>
                        {(helpersByRideout[rideout.id] ?? []).length === 0 ? (
                          <div className="mutedSmall">Keine Helfer gespeichert.</div>
                        ) : (
                          (helpersByRideout[rideout.id] ?? []).map((h, idx) => (
                              <div key={`${h.helper_id}-${h.joined_at}-${idx}`} className="mutedSmall">
                              {resolveUserName(h.helper_id, h.helper_name)} | seit {fmtDate(h.joined_at)}
                            </div>
                          ))
                        )}
                      </div>

                      {rideoutIncidentList.length === 0 ? (
                        <div className="mutedSmall">Keine Pins in diesem Rideout.</div>
                      ) : (
                        rideoutIncidentList.map((incident, index) => {
                          const isIncidentOpen = !!openIncidents[incident.id];
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
                            <div className="card" key={incident.id} style={{ padding: 10 }}>
                              <div className="row row--between">
                                <div className="kv__v">
                                  Incident {index + 1} · {severityLabelDe(incident.severity)}
                                </div>
                                <button className="btn" type="button" onClick={() => toggleIncident(incident.id)}>
                                  {isIncidentOpen ? "Zuklappen" : "Aufklappen"}
                                </button>
                              </div>

                              {isIncidentOpen && (
                                <div className="stack" style={{ marginTop: 8, gap: 6 }}>
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
                                          {resolveUserName(a.helper_id, a.helper_name)} | von {fmtDate(a.joined_at)} bis {a.left_at ? fmtDate(a.left_at) : "offen"} | {fmtDuration(durationMs)}
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
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {!analyticsLoading && rideouts.length === 0 && (
              <div className="mutedSmall">Keine Rideouts vorhanden.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
