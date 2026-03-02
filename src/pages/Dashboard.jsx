// Dashboard.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { mapSeverityToDb, normalizeSeverityUI, severityLabelDe } from "../lib/severity";
import L from "leaflet";

// Fix default marker icon paths (Vite)
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function statusLabel(status) {
  return status === "busy" ? "im Einsatz" : "frei";
}

function statusBorder(status) {
  return status === "busy"
    ? "rgba(239, 68, 68, 0.75)"
    : "rgba(34, 197, 94, 0.75)";
}

function severityColorFromDb(dbSeverity) {
  const s = String(dbSeverity ?? "minor").toLowerCase();
  // minor = blau, medium = orange, severe = rot
  return s === "severe" ? "#ff4d4d" : s === "medium" ? "#ffb020" : "#4da6ff";
}

function choiceBtnStyle(selected, tone = "blue") {
  const tones = {
    red: {
      bg: "rgba(239,68,68,0.18)",
      border: "rgba(239,68,68,0.60)",
      glow: "rgba(239,68,68,0.35)",
    },
    green: {
      bg: "rgba(34,197,94,0.18)",
      border: "rgba(34,197,94,0.60)",
      glow: "rgba(34,197,94,0.35)",
    },
    blue: {
      bg: "rgba(59,130,246,0.18)",
      border: "rgba(59,130,246,0.60)",
      glow: "rgba(59,130,246,0.35)",
    },
    amber: {
      bg: "rgba(245,158,11,0.18)",
      border: "rgba(245,158,11,0.60)",
      glow: "rgba(245,158,11,0.35)",
    },
  };
  const t = tones[tone] ?? tones.blue;

  return {
    borderRadius: 16,
    padding: "10px 14px",
    fontWeight: 800,
    border: selected ? `1px solid ${t.border}` : "1px solid rgba(255,255,255,0.10)",
    background: selected ? t.bg : "rgba(255,255,255,0.06)",
    boxShadow: selected ? `0 0 0 3px ${t.glow}` : "none",
    transform: selected ? "translateY(-1px)" : "none",
    transition: "all 120ms ease",
  };
}

function fmtTime(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleString([], { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(ts);
  }
}

function msToHuman(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function Dashboard({ profile, activeRideoutId }) {
  const [me, setMe] = useState(null);

  // Status nur für Helfer sinnvoll – Admin darf trotzdem melden
  const [myStatus, setMyStatus] = useState("free");

  const [helpers, setHelpers] = useState([]); // merged profiles + locations
  const [incidents, setIncidents] = useState([]);

  const [toast, setToast] = useState(null);

  // Modal: Unfall melden
  const [openReport, setOpenReport] = useState(false);
  const [needsBackup, setNeedsBackup] = useState("no"); // "yes" | "no"
  const [severityUI, setSeverityUI] = useState("minor"); // UI: minor|medium|high
  const [submitting, setSubmitting] = useState(false);

  // Einsatz-Status (für "Einsatz beenden" + Dauer + Verstärkung anfordern)
  const [activeAssignment, setActiveAssignment] = useState(null); // { incident_id, joined_at, left_at, incident: {...} }
  const [nowTick, setNowTick] = useState(Date.now());

  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const helpersLayerRef = useRef(null);
  const incidentsLayerRef = useRef(null);
  const openHelperPopupUserIdRef = useRef(null);
  const suppressHelperPopupCloseRef = useRef(false);

  const canUseLocation = useMemo(
    () => typeof navigator !== "undefined" && !!navigator.geolocation,
    []
  );

  const isHelper = useMemo(() => profile?.role !== "admin", [profile?.role]);

  // ---------- Tick für Live-Dauer ----------
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ---------- Load current user once ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!alive) return;
      if (error) {
        console.warn("[Dashboard] getUser error", error);
        setMe(null);
        return;
      }
      setMe(data?.user ?? null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ---------- Create Leaflet map once ----------
  useEffect(() => {
    if (!mapElRef.current) return;
    if (mapRef.current) return;

    const map = L.map(mapElRef.current, {
      zoomControl: false,
      attributionControl: false,
      closePopupOnClick: false,
    });

    map.setView([47.3769, 8.5417], 11);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    helpersLayerRef.current = L.layerGroup().addTo(map);
    incidentsLayerRef.current = L.layerGroup().addTo(map);

    // Leaflet z-index fix (Modal muss drüber klickbar sein)
    const container = map.getContainer?.();
    if (container) {
      container.style.zIndex = "0";
      container.style.position = "relative";
    }

    return () => {
      map.remove();
      mapRef.current = null;
      helpersLayerRef.current = null;
      incidentsLayerRef.current = null;
    };
  }, []);

  // ---------- Auto-zoom to helpers ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const points = helpers
      .filter((h) => h.lat != null && h.lng != null)
      .map((h) => [h.lat, h.lng]);

    if (points.length === 0) return;

    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
  }, [helpers]);

  // ---------- Render helpers markers ----------
useEffect(() => {
    const layer = helpersLayerRef.current;
    if (!layer) return;

    suppressHelperPopupCloseRef.current = true;
    layer.clearLayers();

    helpers.forEach((h) => {
      if (h.lat == null || h.lng == null) return;

      const busy = h.status === "busy";
      const marker = L.circleMarker([h.lat, h.lng], {
        radius: 8,
        color: busy ? "#ff4d4d" : "#37d67a",
        weight: 3,
        fillColor: "#111",
        fillOpacity: 0.85,
      });

      marker.bindPopup(
        `<b>${h.full_name ?? "Helfer"}</b><br/>Status: ${busy ? "im Einsatz" : "frei"}`
      );

      marker.on("popupopen", () => {
        openHelperPopupUserIdRef.current = h.user_id;
      });
      marker.on("popupclose", () => {
        if (suppressHelperPopupCloseRef.current) return;
        if (openHelperPopupUserIdRef.current === h.user_id) {
          openHelperPopupUserIdRef.current = null;
        }
      });

      layer.addLayer(marker);

      // Keep helper popup open across live location redraws; user closes it explicitly with X.
      if (openHelperPopupUserIdRef.current && openHelperPopupUserIdRef.current === h.user_id) {
        marker.openPopup();
      }
    });
    suppressHelperPopupCloseRef.current = false;
  }, [helpers]);

// ---------- Render incident markers ----------
useEffect(() => {
  const layer = incidentsLayerRef.current;
  if (!layer) return;

  layer.clearLayers();

  incidents.forEach((i, index) => {
    if (i.lat == null || i.lng == null) return;
    const incidentNumber = index + 1;

    const color = severityColorFromDb(i.severity);
    const label = severityLabelDe(i.severity);

    const marker = L.circleMarker([i.lat, i.lng], {
      radius: 10,
      color: "#ffffff",
      weight: 2,
      fillColor: color,
      fillOpacity: 1,
    });

    // Optional: Button-Text/State
    const joinDisabled = !me?.id || submitting; // du kannst hier auch "alreadyJoined" berücksichtigen
    const joinLabel = joinDisabled ? "Beitreten" : "Beitreten";

    marker.bindPopup(`
      <div style="min-width: 220px">
        <div style="font-weight:800; font-size:16px; margin-bottom:6px;">Incident ${incidentNumber}</div>
        <div style="opacity:.85; margin-bottom:2px;">Schweregrad: <b>${label}</b></div>
        <div style="opacity:.85; margin-bottom:10px;">Verstärkung: <b>${i.needs_backup ? "Ja" : "Nein"}</b></div>

        <button
          type="button"
          data-incident-id="${i.id}"
          ${joinDisabled ? "disabled" : ""}
          style="
            width:100%;
            border-radius:14px;
            padding:10px 12px;
            font-weight:800;
            cursor:${joinDisabled ? "not-allowed" : "pointer"};
            border:1px solid rgba(255,255,255,0.14);
            background: rgba(255,255,255,0.08);
          "
        >
          ${joinLabel}
        </button>

        ${!me?.id ? `<div style="margin-top:8px; font-size:12px; opacity:.7">Bitte einloggen, um beizutreten.</div>` : ""}
      </div>
    `);

    // ✅ Click-Handler an den Button hängen, sobald Popup offen ist
    marker.on("popupopen", (e) => {
      const el = e.popup?.getElement?.();
      if (!el) return;

      const btn = el.querySelector(`button[data-incident-id="${i.id}"]`);
      if (!btn) return;

      // wichtig: nicht mehrfach doppelt registrieren
      btn.onclick = async () => {
        if (!me?.id) return;

        try {
          // ⚠️ HIER deine bestehende Join-Funktion aufrufen:
          // z.B. await joinIncident(i.id);
          await joinIncident(i.id);
        } catch (err) {
          console.warn("[Dashboard] joinIncident failed", err);
          setToast(err?.message ?? "Beitreten fehlgeschlagen");
        }
      };
    });

    layer.addLayer(marker);
  });
}, [incidents, me?.id, submitting, activeAssignment?.incident_id]);


  // ---------- Load helpers + realtime updates ----------
  useEffect(() => {
    if (!me?.id) return;
    if (!activeRideoutId) {
      setHelpers([]);
      return;
    }

    let alive = true;
    let channel = null;

    const loadHelpers = async () => {
      try {
        const { data: participants, error: partErr } = await supabase
          .from("rideout_helpers")
          .select("helper_id")
          .eq("rideout_id", activeRideoutId);
        if (partErr) throw partErr;

        const { data: profs, error: pErr } = await supabase
          .from("profiles")
          .select("user_id, full_name, role")
          .neq("role", "admin");
        if (pErr) throw pErr;

        const { data: locs, error: lErr } = await supabase
          .from("helper_locations")
          .select("user_id, lat, lng, status, updated_at");
        if (lErr) throw lErr;

        const profileMap = new Map((profs ?? []).map((p) => [p.user_id, p]));
        const locMap = new Map((locs ?? []).map((x) => [x.user_id, x]));
        const participantIds = (participants ?? []).map((p) => p.helper_id).filter(Boolean);
        const userIds = new Set([
          ...participantIds,
          ...Array.from(profileMap.keys()),
          ...Array.from(locMap.keys()),
        ]);

        const merged = Array.from(userIds).map((userId) => {
          const p = profileMap.get(userId);
          const loc = locMap.get(userId);
          return {
            user_id: userId,
            full_name: p?.full_name ?? "Unbenannter Helfer",
            role: p?.role ?? "helper",
            lat: loc?.lat ?? null,
            lng: loc?.lng ?? null,
            status: loc?.status ?? "free",
            updated_at: loc?.updated_at ?? null,
          };
        });

        // Stable order for UI: with location first, then by display name.
        merged.sort((a, b) => {
          const aHasLoc = a.lat != null && a.lng != null;
          const bHasLoc = b.lat != null && b.lng != null;
          if (aHasLoc !== bHasLoc) return aHasLoc ? -1 : 1;
          return String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""), "de");
        });

        if (alive) setHelpers(merged);
      } catch (e) {
        console.warn("[Dashboard] load helpers failed", e);
        if (alive) setToast(e?.message ?? "Fehler beim Laden der Helfer-Standorte");
      }
    };

    loadHelpers();

    channel = supabase
      .channel("helpers-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rideout_helpers" },
        () => {
          if (!alive) return;
          loadHelpers();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "helper_locations" },
        () => {
          if (!alive) return;
          loadHelpers();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => {
          if (!alive) return;
          loadHelpers();
        }
      )
      .subscribe();

    return () => {
      alive = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [me?.id, activeRideoutId]);

  // ---------- Track my location (only helpers) ----------
  useEffect(() => {
    if (!me?.id || !isHelper || !activeRideoutId) return;

    supabase
      .from("rideout_helpers")
      .upsert(
        {
          rideout_id: activeRideoutId,
          helper_id: me.id,
          joined_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "rideout_id,helper_id" }
      )
      .then(() => {})
      .catch((e) => console.warn("[Dashboard] rideout helper register failed", e));
  }, [me?.id, isHelper, activeRideoutId]);

  // ---------- Track my location (only helpers) ----------
  useEffect(() => {
    if (!me?.id) return;
    if (!isHelper) return;
    if (!activeRideoutId) {
      // Rideout closed/no access: remove stale location entry so live map clears automatically.
      supabase.from("helper_locations").delete().eq("user_id", me.id).then(() => {}).catch(() => {});
      return;
    }

    if (!canUseLocation) {
      setToast("Dein Browser unterstützt Geolocation nicht.");
      return;
    }

    let stopped = false;

    const upsertRideoutParticipant = async () => {
      try {
        await supabase.from("rideout_helpers").upsert(
          {
            rideout_id: activeRideoutId,
            helper_id: me.id,
            joined_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: "rideout_id,helper_id" }
        );
      } catch (e) {
        console.warn("[Dashboard] rideout helper upsert failed", e);
      }
    };

    const upsertLocation = async (lat, lng, status) => {
      try {
        await supabase.from("helper_locations").upsert(
          {
            user_id: me.id,
            lat,
            lng,
            status,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
        await upsertRideoutParticipant();
      } catch (e) {
        console.warn("[Dashboard] upsert location failed", e);
      }
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (stopped) return;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        upsertLocation(lat, lng, myStatus);
      },
      (err) => {
        console.warn("[Dashboard] geolocation error", err);
        setToast("Standort konnte nicht abgerufen werden. Bitte Browser-Rechte prüfen.");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [me?.id, isHelper, myStatus, canUseLocation, activeRideoutId]);

  // ---------- Incidents: load + realtime ----------
  const loadIncidents = useCallback(async () => {
    if (!activeRideoutId) {
      setIncidents([]);
      return;
    }

    const { data, error } = await supabase
      .from("incidents")
      .select("id, created_at, lat, lng, severity, needs_backup, created_by, closed_at, note, rideout_id")
      .eq("rideout_id", activeRideoutId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.warn("[Dashboard] loadIncidents error", error);
      return;
    }
    setIncidents(data ?? []);
  }, [activeRideoutId]);

  useEffect(() => {
    let alive = true;
    let channel = null;

    (async () => {
      await loadIncidents();
    })();

    channel = supabase
      .channel("incidents-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "incidents" },
        () => {
          if (!alive) return;
          loadIncidents();
        }
      )
      .subscribe();

    return () => {
      alive = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [loadIncidents]);

  // ---------- Active assignment laden (für Buttons / Dauer) ----------
  const loadActiveAssignment = useCallback(async () => {
    if (!me?.id) return;

    // aktiver Einsatz = left_at is null
    const { data, error } = await supabase
      .from("incident_assignments")
      .select("id, incident_id, helper_id, joined_at, left_at")
      .eq("helper_id", me.id)
      .is("left_at", null)
      .order("joined_at", { ascending: false })
      .limit(1);

    if (error) {
      console.warn("[Dashboard] loadActiveAssignment error", error);
      return;
    }

    const row = (data ?? [])[0] ?? null;
    if (!row) {
      setActiveAssignment(null);
      return;
    }

    const incident = incidents.find((x) => x.id === row.incident_id) || null;
    setActiveAssignment({ ...row, incident });
  }, [me?.id, incidents]);

  useEffect(() => {
    loadActiveAssignment();
  }, [loadActiveAssignment]);

  // Realtime: Assignments (wenn jemand beitritt/endet)
  useEffect(() => {
    if (!me?.id) return;

    let alive = true;
    const ch = supabase
      .channel("incident-assignments-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "incident_assignments" },
        () => {
          if (!alive) return;
          loadActiveAssignment();
        }
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(ch);
    };
  }, [me?.id, loadActiveAssignment]);

  // ---------- Notifications ----------
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!me?.id) return;
    if (!activeRideoutId) return;

    let alive = true;
    const channel = supabase
      .channel("incidents-notify")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "incidents" },
        (payload) => {
          if (!alive) return;
          const incident = payload.new;
          if (!incident) return;
          if (incident.rideout_id !== activeRideoutId) return;

          const msg = `Neuer Incident (${severityLabelDe(incident.severity)}) · Verstärkung: ${incident.needs_backup ? "Ja" : "Nein"}`;
          setToast(msg);

          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification("Rideout Med", { body: msg });
          }
        }
      )
      .subscribe();

    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [me?.id, activeRideoutId]);

  // ---------- Actions ----------
  const toggleMyStatus = async () => {
    const next = myStatus === "busy" ? "free" : "busy";
    setMyStatus(next);

    if (me?.id && isHelper) {
      try {
        await supabase.from("helper_locations").upsert(
          { user_id: me.id, status: next, updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
      } catch (e) {
        console.warn("[Dashboard] status update failed", e);
      }
    }
  };

  const openReportModal = async () => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // ignore
      }
    }
    setOpenReport(true);
  };

  const submitReport = async () => {
    if (!me?.id) {
      setToast("Nicht eingeloggt.");
      return;
    }
    if (!activeRideoutId) {
      setToast("Kein aktiver Rideout.");
      return;
    }
    if (!canUseLocation) {
      setToast("Geolocation nicht verfügbar.");
      return;
    }

    setSubmitting(true);
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 15000,
        });
      });

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude

      const payload = {
        lat,
        lng,
        severity: mapSeverityToDb(severityUI), // ✅ minor | medium | severe
        created_by: me.id,
        needs_backup: needsBackup === "yes",
        rideout_id: activeRideoutId,
      };

      const { error } = await supabase.from("incidents").insert(payload);
      if (error) throw error;

      // wenn Helfer meldet, automatisch busy setzen
      if (isHelper) setMyStatus("busy");

      setToast("Incident gemeldet ✅");
      setOpenReport(false);
      setNeedsBackup("no");
      setSeverityUI("minor");
    } catch (e) {
      console.warn("[Dashboard] submitReport failed", e);
      setToast(e?.message ?? "Fehler beim Melden des Incidents");
    } finally {
      setSubmitting(false);
    }
  };

  // ✅ Helfer/Admin: einem Incident beitreten (auch wenn needs_backup=false)
  const joinIncident = useCallback(
    async (incidentId) => {
      if (!me?.id) return setToast("Nicht eingeloggt.");
      if (activeAssignment?.incident_id) return setToast("Du bist bereits in einem Einsatz.");

      setSubmitting(true);
      try {
        const { error } = await supabase.from("incident_assignments").insert({
          incident_id: incidentId,
          helper_id: me.id,
          joined_at: new Date().toISOString(),
        });
        if (error) throw error;

        // Helfer: Status busy setzen
        if (isHelper) {
          setMyStatus("busy");
          await supabase.from("helper_locations").upsert(
            { user_id: me.id, status: "busy", updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );
        }

      setToast("Du bist dem Incident beigetreten ✅");
        await loadActiveAssignment();
      } catch (e) {
        console.warn("[Dashboard] joinIncident failed", e);
        setToast(e?.message ?? "Beitreten fehlgeschlagen");
      } finally {
        setSubmitting(false);
      }
    },
    [me?.id, activeAssignment?.incident_id, isHelper, loadActiveAssignment]
  );

  // ✅ Einsatz beenden: left_at setzen + Dauer ist dann ableitbar (left_at - joined_at)
  const endDeployment = async () => {
    if (!me?.id) return setToast("Nicht eingeloggt.");
    if (!activeAssignment?.incident_id) return;

    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("incident_assignments")
        .update({ left_at: new Date().toISOString() })
        .eq("incident_id", activeAssignment.incident_id)
        .eq("helper_id", me.id)
        .is("left_at", null);

      if (error) throw error;

      // Helfer: Status wieder frei
      if (isHelper) {
        setMyStatus("free");
        await supabase.from("helper_locations").upsert(
          { user_id: me.id, status: "free", updated_at: new Date().toISOString() },
          { onConflict: "user_id" }
        );
      }

      setToast("Einsatz beendet ✅");
      await loadActiveAssignment();
    } catch (e) {
      console.warn("[Dashboard] endDeployment failed", e);
      setToast(e?.message ?? "Einsatz beenden fehlgeschlagen");
    } finally {
      setSubmitting(false);
    }
  };

  // ✅ Verstärkung anfordern (während Einsatz): incidents.needs_backup = true
  const requestBackup = async () => {
    if (!activeAssignment?.incident_id) return;
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("incidents")
        .update({ needs_backup: true })
        .eq("id", activeAssignment.incident_id);

      if (error) throw error;

      setToast("Verstärkung angefordert ✅");
      await loadIncidents(); // damit UI/Marker aktualisiert
    } catch (e) {
      console.warn("[Dashboard] requestBackup failed", e);
      setToast(e?.message ?? "Verstärkung anfordern fehlgeschlagen");
    } finally {
      setSubmitting(false);
    }
  };

  const activeDurationMs = useMemo(() => {
    if (!activeAssignment?.joined_at) return 0;
    const start = new Date(activeAssignment.joined_at).getTime();
    return nowTick - start;
  }, [activeAssignment?.joined_at, nowTick]);

  return (
    <div className="page">
      {/* MAP CARD */}
      <div className="card" style={{ padding: 12 }}>
        <div className="row row--between" style={{ marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Live-Standorte</div>
            <div className="mutedSmall">Helfer: grün = frei · rot = im Einsatz</div>
          </div>

          {isHelper && (
            <button className="btn btn--ghost" onClick={toggleMyStatus} type="button">
              Status: {statusLabel(myStatus)}
            </button>
          )}
        </div>

        <div className="mapWrap" style={{ position: "relative" }}>
          <div ref={mapElRef} className="map" />
        </div>
      </div>

      {/* ✅ PRIMARY ACTION AREA (abhängig ob im Einsatz) */}
      {!activeAssignment ? (
        <button
          className="btn"
          type="button"
          onClick={openReportModal}
          style={{
            marginTop: 12,
            width: "100%",
            borderRadius: 18,
            padding: "14px 16px",
            fontWeight: 900,
            background: "rgba(239,68,68,0.20)",
            border: "1px solid rgba(239,68,68,0.35)",
            boxShadow: "0 0 0 3px rgba(239,68,68,0.18)",
          }}
        >
          Incident melden
        </button>
      ) : (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <div
            className="card"
            style={{
              padding: 12,
              borderColor: "rgba(239,68,68,0.25)",
              background: "rgba(20,20,20,0.85)",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 14 }}>Du bist im Einsatz</div>
            <div className="mutedSmall" style={{ marginTop: 4 }}>
              Seit: <span className="mono">{fmtTime(activeAssignment.joined_at)}</span> · Dauer:{" "}
              <span className="mono">{msToHuman(activeDurationMs)}</span>
            </div>
            <div className="mutedTiny" style={{ marginTop: 6 }}>
              Incident: <span className="mono">{activeAssignment.incident_id}</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              className="btn"
              type="button"
              onClick={endDeployment}
              disabled={submitting}
              style={{
                borderRadius: 18,
                padding: "14px 16px",
                fontWeight: 900,
                background: "rgba(34,197,94,0.18)",
                border: "1px solid rgba(34,197,94,0.35)",
              }}
            >
              Einsatz beenden
            </button>

            <button
              className="btn"
              type="button"
              onClick={requestBackup}
              disabled={submitting}
              style={{
                borderRadius: 18,
                padding: "14px 16px",
                fontWeight: 900,
                background: "rgba(239,68,68,0.18)",
                border: "1px solid rgba(239,68,68,0.35)",
              }}
            >
              Verstärkung anfordern
            </button>
          </div>
        </div>
      )}

      {/* ✅ INCIDENTS LIST (beitreten) */}
      <div className="card" style={{ marginTop: 10 }}>
        <div className="card__title">Incidents (live)</div>
        <div className="list">
          {incidents.length === 0 ? (
            <div className="mutedSmall">Keine Incidents vorhanden.</div>
          ) : (
            incidents.map((i, index) => {
              const incidentNumber = index + 1;
              const sevLabel = severityLabelDe(i.severity);
              const sevColor = severityColorFromDb(i.severity);
              const isClosed = !!i.closed_at;

              return (
                <div key={i.id} className="listItem" style={{ alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div className="listItem__title" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: sevColor,
                          boxShadow: "0 0 0 3px rgba(255,255,255,0.06)",
                          display: "inline-block",
                        }}
                      />
                      Incident {incidentNumber} · {sevLabel}
                      {isClosed && <span className="mutedTiny">· geschlossen</span>}
                    </div>

                    <div className="mutedTiny" style={{ marginTop: 2 }}>
                      Erstellt: <span className="mono">{fmtTime(i.created_at)}</span> · Verstärkung:{" "}
                      <span className="mono">{i.needs_backup ? "Ja" : "Nein"}</span>
                    </div>
                  </div>

                  <button
                    className="btn"
                    type="button"
                    disabled={submitting || !!activeAssignment || isClosed}
                    onClick={() => joinIncident(i.id)}
                    style={{
                      borderRadius: 16,
                      padding: "10px 12px",
                      fontWeight: 900,
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      opacity: isClosed ? 0.5 : 1,
                    }}
                    title={activeAssignment ? "Du bist bereits in einem Einsatz" : "Incident beitreten"}
                  >
                    Beitreten
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* HELPERS LIST */}
      <div className="card" style={{ marginTop: 10 }}>
        <div className="card__title">Helfer (live)</div>
        <div className="list">
          {helpers.length === 0 ? (
            <div className="mutedSmall">Noch keine Standorte vorhanden.</div>
          ) : (
            helpers.map((h) => (
              <div key={h.user_id} className="listItem">
                <div>
                  <div className="listItem__title">{h.full_name ?? "Helfer"}</div>
                  <div className="mutedTiny">
                    {h.lat != null && h.lng != null
                      ? `Lat ${Number(h.lat).toFixed(4)} · Lng ${Number(h.lng).toFixed(4)}`
                      : "Kein Standort"}
                  </div>
                </div>
                <span className="badge" style={{ borderColor: statusBorder(h.status) }}>
                  {statusLabel(h.status)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* TOAST */}
      {toast && (
        <div
          className="card"
          style={{ marginTop: 10, borderColor: "rgba(59,130,246,0.35)" }}
          onClick={() => setToast(null)}
          role="button"
          tabIndex={0}
        >
          <div className="mutedSmall">{toast}</div>
          <div className="mutedTiny">Klicken zum Schliessen</div>
        </div>
      )}

      {/* ✅ MODAL (klickbar über Leaflet) */}
      {openReport && (
        <div
          onClick={() => !submitting && setOpenReport(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999999,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            pointerEvents: "auto",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              borderRadius: 22,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(20,20,20,0.92)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
              padding: 16,
              pointerEvents: "auto",
            }}
          >
            <div className="card__title" style={{ fontSize: 20 }}>
              Incident melden
            </div>

            <div style={{ marginTop: 12 }}>
              <div className="mutedSmall" style={{ marginBottom: 6 }}>
                Verstärkung benötigt?
              </div>
              <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setNeedsBackup("no")}
                  disabled={submitting}
                  style={choiceBtnStyle(needsBackup === "no", "green")}
                >
                  Nein
                </button>

                <button
                  className="btn"
                  type="button"
                  onClick={() => setNeedsBackup("yes")}
                  disabled={submitting}
                  style={choiceBtnStyle(needsBackup === "yes", "red")}
                >
                  Ja
                </button>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="mutedSmall" style={{ marginBottom: 6 }}>
                Schweregrad
              </div>

              <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                {[
                  { key: "minor", tone: "blue", label: "tief" },
                  { key: "medium", tone: "amber", label: "mittel" },
                  { key: "high", tone: "red", label: "hoch" },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    className="btn"
                    type="button"
                    onClick={() => setSeverityUI(opt.key)}
                    disabled={submitting}
                    style={choiceBtnStyle(normalizeSeverityUI(severityUI) === opt.key, opt.tone)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

            </div>

            <div className="row row--between" style={{ marginTop: 16 }}>
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => setOpenReport(false)}
                disabled={submitting}
              >
                Abbrechen
              </button>

              <button
                className="btn btn--primary"
                type="button"
                onClick={submitReport}
                disabled={submitting}
                style={{
                  background: submitting ? "rgba(255,255,255,0.10)" : undefined,
                  opacity: submitting ? 0.8 : 1,
                }}
              >
                {submitting ? "Sende…" : "Melden"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
