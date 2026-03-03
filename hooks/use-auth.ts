"use client";

import { useEffect, useState } from "react";

type AuthState = {
  isAuthenticated: boolean;
  user: { id: string | null; role: "admin" | "agent" | "viewer"; name: string } | null;
  loading: boolean;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    loading: true
  });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        const actor = data.actor;
        if (actor?.userId) {
          setState({
            isAuthenticated: true,
            user: { id: actor.userId, role: actor.role || "viewer", name: actor.name || "User" },
            loading: false
          });
        } else {
          setState({ isAuthenticated: false, user: { id: null, role: "viewer", name: "Viewer" }, loading: false });
        }
      } catch {
        if (!active) return;
        setState({ isAuthenticated: false, user: { id: null, role: "viewer", name: "Viewer" }, loading: false });
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return state;
}
