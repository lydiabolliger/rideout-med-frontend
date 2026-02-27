import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link, useParams } from "react-router-dom";
import { severityLabelDe } from "../lib/severity";

export default function Pin() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState(null);
  const [creator, setCreator] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from("incidents")
        .select("id, created_at, lat, lng, severity, created_by")
        .eq("id", id)
        .maybeSingle();

      if (error) throw error;
      setRow(data ?? null);

      // Creator separat laden (ohne Relationship)
      if (data?.created_by) {
        const { data: prof, error: pErr } = await supabase
          .from("profiles")
          .select("user_id, full_name, role")
          .eq("user_id", data.created_by)
          .maybeSingle();

        if (!pErr) setCreator(prof ?? null);
      } else {
        setCreator(null);
      }
    } catch (e) {
      console.warn("[Pin] load error", e);
      setError(e?.message ?? "Fehler beim Laden");
      setRow(null);
      setCreator(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="page">
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <Link className="btn" to="/incidents" style={{ width: "auto" }}>
          ← Zurück
        </Link>

        <button className="btn" onClick={load} disabled={loading} style={{ width: "auto" }}>
          {loading ? "Lade…" : "Neu laden"}
        </button>
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      {loading && <div className="tile">Lade…</div>}

      {!loading && row && (
        <div className="tile" style={{ padding: 16 }}>
          <div className="tile__title" style={{ fontSize: 22, fontWeight: 700 }}>
            Incident
          </div>
          <div className="muted" style={{ marginTop: 6 }}>
            {row.id}
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="muted">Zeit</div>
            <div>{new Date(row.created_at).toLocaleString()}</div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="muted">Koordinaten</div>
            <div>
              Lat {Number(row.lat).toFixed(4)} · Lng {Number(row.lng).toFixed(4)}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="muted">Schweregrad</div>
            <div>{severityLabelDe(row.severity)}</div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="muted">Gemeldet von</div>
            <div>{creator?.full_name ?? row.created_by ?? "-"}</div>
          </div>
        </div>
      )}
    </div>
  );
}
