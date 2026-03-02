import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link, useLocation } from "react-router-dom";
import { severityBadgeClass, severityLabelDe } from "../lib/severity";

export default function Incidents({ profile, activeRideoutId }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);

  const location = useLocation();
  const reqIdRef = useRef(0);

  const load = async () => {
    const reqId = ++reqIdRef.current;
    setError(null);
    setLoading(true);

    try {
      const role = profile?.role;
      if (!role) return;
      if (!activeRideoutId) {
        setRows([]);
        return;
      }

      let q = supabase
        .from("incidents")
        .select("id, created_at, lat, lng, severity, created_by, rideout_id")
        .eq("rideout_id", activeRideoutId)
        .order("created_at", { ascending: false })
        .limit(200);

      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Zeitüberschreitung beim Laden der Pins.")), 12000)
      );
      const { data, error } = await Promise.race([q, timeout]);
      if (error) throw error;

      if (reqId === reqIdRef.current) setRows(data ?? []);
    } catch (e) {
      console.warn("[Incidents] load error", e);
      if (reqId === reqIdRef.current) {
        setError(e?.message ?? "Fehler beim Laden");
        setRows([]);
      }
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!profile?.role) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.role, activeRideoutId, location.key]);

  return (
    <div className="page">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div className="h2">Pins</div>

        <button
          className="btn"
          onClick={load}
          disabled={loading}
          style={{ width: "auto", padding: "10px 14px" }}
        >
          {loading ? "Lade…" : "Neu laden"}
        </button>
      </div>

      {error && (
        <div className="error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="list" style={{ display: "grid", gap: 12 }}>
        {loading && <div className="tile">Lade…</div>}

        {!loading && rows.length === 0 && !error && (
          <div className="tile muted">
            {activeRideoutId ? "Keine Pins im aktiven Rideout gefunden." : "Kein aktiver Rideout."}
          </div>
        )}

        {!loading &&
          rows.map((r, index) => {
            const incidentNumber = rows.length - index;

            return (
              <Link
                key={r.id}
                className="tile"
                to={`/incidents/${r.id}`}
                style={{
                  display: "block",
                  padding: 16,
                  borderRadius: 18,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.05)",
                  textDecoration: "none",
                }}
              >
                <div
                  className="tile__row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div className="tile__title" style={{ fontSize: 22, fontWeight: 700 }}>
                    Incident {incidentNumber}
                  </div>

                  <span className={severityBadgeClass(r.severity)}>{severityLabelDe(r.severity)}</span>
                </div>

                <div className="tile__desc" style={{ marginTop: 6 }}>
                  {new Date(r.created_at).toLocaleString()} · Lat{" "}
                  {Number(r.lat).toFixed(4)} · Lng {Number(r.lng).toFixed(4)}
                </div>
              </Link>
            );
          })}
      </div>
    </div>
  );
}
