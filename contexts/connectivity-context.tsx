"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getDb } from "@/lib/firebase/client";
import { countPendingWrites, flushPendingWrites } from "@/lib/offline/sync";

type ConnectivityContextValue = {
  online: boolean;
  pendingSync: number;
  refreshPending: () => Promise<void>;
  flushSync: () => Promise<void>;
};

const ConnectivityContext = createContext<
  ConnectivityContextValue | undefined
>(undefined);

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const [pendingSync, setPendingSync] = useState(0);

  const refreshPending = useCallback(async () => {
    const n = await countPendingWrites();
    setPendingSync(n);
  }, []);

  const flushSync = useCallback(async () => {
    try {
      await flushPendingWrites(getDb());
    } finally {
      await refreshPending();
    }
  }, [refreshPending]);

  useEffect(() => {
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const on = () => {
      setOnline(true);
      void flushSync();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    void refreshPending();
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [flushSync, refreshPending]);

  const value = useMemo(
    () => ({ online, pendingSync, refreshPending, flushSync }),
    [online, pendingSync, refreshPending, flushSync]
  );

  return (
    <ConnectivityContext.Provider value={value}>
      {children}
    </ConnectivityContext.Provider>
  );
}

export function useConnectivity() {
  const ctx = useContext(ConnectivityContext);
  if (!ctx) {
    throw new Error("useConnectivity must be used within ConnectivityProvider");
  }
  return ctx;
}
