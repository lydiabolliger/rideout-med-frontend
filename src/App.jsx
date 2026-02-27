import { useEffect, useState } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { supabase } from "./lib/supabase";

import Dashboard from "./pages/Dashboard.jsx";
import AppShell from "./layout/AppShell.jsx";
import Admin from "./pages/Admin.jsx";
import Incidents from "./pages/Incidents.jsx";
import Login from "./pages/Login.jsx";
import Pin from "./pages/Pin.jsx";
import Profile from "./pages/Profile.jsx";

const RIDEOUT_TOKEN_STORAGE_KEY = "rideout_join_token";

function storeRideoutTokenFromUrl() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const token = url.searchParams.get("rideout");
  if (!token) return null;
  localStorage.setItem(RIDEOUT_TOKEN_STORAGE_KEY, token);
  url.searchParams.delete("rideout");
  window.history.replaceState({}, "", url.toString());
  return token;
}

function getStoredRideoutToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(RIDEOUT_TOKEN_STORAGE_KEY);
}

function ProtectedRoute({ session, loading }) {
  if (loading) {
    return (
      <div className="screen center">
        <div>Loading…</div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

function RideoutRoute({ profile, rideoutAccessLoading, hasRideoutAccess }) {
  const isAdmin = profile?.role === "admin";

  if (isAdmin) return <Outlet />;

  if (rideoutAccessLoading) {
    return (
      <div className="screen center">
        <div>Pruefe Rideout-Zugang...</div>
      </div>
    );
  }

  if (!hasRideoutAccess) {
    return (
      <div className="screen center">
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="card__title">Kein aktiver Rideout-Link</div>
          <div className="mutedSmall">
            Der Zugang ist nur mit einem aktiven Rideout-Link moeglich. Bitte den aktuellen Link vom Admin verwenden.
          </div>
        </div>
      </div>
    );
  }

  return <Outlet />;
}

// ✅ AppShell-Wrapper für alle geschützten Routes
function ShellRoute({ profile }) {
  const onLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AppShell profile={profile} onLogout={onLogout}>
      <Outlet />
    </AppShell>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rideoutAccessLoading, setRideoutAccessLoading] = useState(true);
  const [hasRideoutAccess, setHasRideoutAccess] = useState(false);

  useEffect(() => {
    storeRideoutTokenFromUrl();
  }, []);

  useEffect(() => {
    let mounted = true;

    const fetchProfile = async (userId) => {
      try {
        const { data: prof, error } = await supabase
          .from("profiles")
          .select("user_id, full_name, role")
          .eq("user_id", userId)
          .maybeSingle();

        if (error) console.warn("[App] profile error", error);
        if (mounted) setProfile(prof ?? null);
      } catch (e) {
        console.warn("[App] profile catch", e);
        if (mounted) setProfile(null);
      }
    };

    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        console.log("[App] getSession()", { hasSession: !!data?.session, error });

        if (!mounted) return;

        const sess = data?.session ?? null;
        setSession(sess);

        if (sess?.user?.id) {
          await fetchProfile(sess.user.id);
        } else {
          setProfile(null);
        }
      } catch (e) {
        console.warn("[App] init catch", e);
        if (mounted) {
          setSession(null);
          setProfile(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    init();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        console.log("[App] onAuthStateChange", event);

        if (!mounted) return;

        setSession(newSession ?? null);

        try {
          if (newSession?.user?.id) {
            await fetchProfile(newSession.user.id);
          } else {
            setProfile(null);
          }
        } finally {
          if (mounted) setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let timer = null;

    const checkRideoutAccess = async () => {
      if (!session?.user?.id) {
        if (alive) {
          setHasRideoutAccess(false);
          setRideoutAccessLoading(false);
        }
        return;
      }

      if (profile?.role === "admin") {
        if (alive) {
          setHasRideoutAccess(true);
          setRideoutAccessLoading(false);
        }
        return;
      }

      const token = getStoredRideoutToken();
      if (!token) {
        if (alive) {
          setHasRideoutAccess(false);
          setRideoutAccessLoading(false);
        }
        return;
      }

      if (alive) setRideoutAccessLoading(true);
      const { data, error } = await supabase
        .from("rideouts")
        .select("id")
        .eq("join_token", token)
        .is("closed_at", null)
        .maybeSingle();

      if (!alive) return;
      if (error) {
        console.warn("[App] rideout access check failed", error);
        setHasRideoutAccess(false);
      } else {
        setHasRideoutAccess(!!data?.id);
      }
      setRideoutAccessLoading(false);
    };

    checkRideoutAccess();
    timer = window.setInterval(checkRideoutAccess, 20000);
    return () => {
      alive = false;
      if (timer) window.clearInterval(timer);
    };
  }, [session?.user?.id, profile?.role]);

  return (
    <Routes>
      {/* Public route */}
      <Route
        path="/login"
        element={session ? <Navigate to="/" replace /> : <Login />}
      />

      {/* Protected area */}
      <Route element={<ProtectedRoute session={session} loading={loading} />}>
        <Route
          element={
            <RideoutRoute
              profile={profile}
              rideoutAccessLoading={rideoutAccessLoading}
              hasRideoutAccess={hasRideoutAccess}
            />
          }
        >
        {/* ✅ Alles innerhalb der Shell bekommt Header + Tabs */}
        <Route element={<ShellRoute profile={profile} />}>
          <Route path="/" element={<Dashboard profile={profile} />} />
          <Route path="/dashboard" element={<Dashboard profile={profile} />} />

          {/* List view */}
          <Route path="/incidents" element={<Incidents profile={profile} />} />

          {/* Detail view */}
          <Route path="/incidents/:id" element={<Pin profile={profile} />} />

          <Route
            path="/admin"
            element={<Admin profile={profile} onProfileUpdated={setProfile} />}
          />
          <Route
            path="/profile"
            element={<Profile profile={profile} />}
          />

          {/* Backward compatibility */}
          <Route path="/pin" element={<Navigate to="/incidents" replace />} />
        </Route>
        </Route>
      </Route>

      {/* Fallback */}
      <Route
        path="*"
        element={<Navigate to={session ? "/" : "/login"} replace />}
      />
    </Routes>
  );
}
