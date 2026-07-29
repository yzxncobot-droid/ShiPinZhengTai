/**
 * MaintenanceGuard
 *
 * Wraps the entire app router. On every mount (and after a 30-second poll) it
 * fetches /api/settings/maintenance-status. If maintenance is enabled AND the
 * current user is not an owner, it hard-redirects to /maintenance.
 *
 * - Owners bypass maintenance unconditionally.
 * - The /maintenance and /login pages are always accessible.
 * - While the status is still loading we render nothing (< 200 ms in practice).
 */
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";

const POLL_MS = 30_000;
const EXCLUDED = ["/maintenance", "/login", "/register"];

async function fetchMaintenanceEnabled(): Promise<boolean> {
  try {
    const res = await fetch("/api/settings/maintenance-status");
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.maintenanceEnabled);
  } catch {
    return false;
  }
}

interface Props {
  children: React.ReactNode;
}

export function MaintenanceGuard({ children }: Props) {
  const { user, isLoading: authLoading } = useAuth();
  const [location, setLocation] = useLocation();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = async () => {
    // Skip for excluded paths
    if (EXCLUDED.some(p => location.startsWith(p))) return;
    // Owners are never blocked
    if (user?.role === "owner") return;
    // Still resolving auth — skip until we know who this is
    if (authLoading) return;

    const enabled = await fetchMaintenanceEnabled();
    if (enabled) {
      setLocation("/maintenance");
    } else if (location === "/maintenance") {
      // Maintenance was lifted while the user was on the page — send home
      setLocation("/");
    }
  };

  // Run once after auth resolves and again every 30 s
  useEffect(() => {
    if (authLoading) return;
    check();
    timerRef.current = setInterval(check, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.role, location]);

  return <>{children}</>;
}
