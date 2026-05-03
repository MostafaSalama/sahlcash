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
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  collection,
} from "firebase/firestore";
import { getFirebaseAuth, getDb } from "@/lib/firebase/client";
import { seedDefaultWallets } from "@/lib/firebase/seed-wallets";
import { randomInviteCode } from "@/lib/utils";
import type { StoreDoc, StoreUserDoc } from "@/types/firestore";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  storeId: string | null;
  store: (StoreDoc & { id: string }) | null;
  profile: (StoreUserDoc & { id: string }) | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  registerOwner: (input: {
    email: string;
    password: string;
    storeName: string;
    displayName: string;
  }) => Promise<void>;
  registerCashier: (input: {
    email: string;
    password: string;
    inviteCode: string;
    displayName: string;
  }) => Promise<void>;
  refreshStore: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [store, setStore] = useState<(StoreDoc & { id: string }) | null>(null);
  const [profile, setProfile] = useState<(StoreUserDoc & { id: string }) | null>(
    null
  );

  const loadMembership = useCallback(async (uid: string) => {
    try {
      const db = getDb();
      const mapSnap = await getDoc(doc(db, "userStores", uid));
      if (!mapSnap.exists()) {
        setStoreId((prev) => {
          if (prev) return prev;
          setStore(null);
          setProfile(null);
          return null;
        });
        return;
      }
      const sid = mapSnap.data().storeId as string;
      setStoreId(sid);
    } catch (err) {
      console.error("[SahlCash] loadMembership failed:", err);
    }
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setStoreId(null);
        setStore(null);
        setProfile(null);
        setStatus("unauthenticated");
        return;
      }
      setStatus((prev) => (prev === "authenticated" ? prev : "loading"));
      await loadMembership(u.uid);
      setStatus("authenticated");
    });
    return () => unsub();
  }, [loadMembership]);

  useEffect(() => {
    if (!user || !storeId) {
      setStore(null);
      setProfile(null);
      return;
    }
    const db = getDb();
    const onErr = (err: Error) =>
      console.error("[SahlCash] Firestore snapshot error:", err);

    const unsubStore = onSnapshot(
      doc(db, "stores", storeId),
      (snap) => {
        if (!snap.exists()) {
          setStore(null);
          return;
        }
        setStore({ id: snap.id, ...(snap.data() as StoreDoc) });
      },
      onErr
    );
    const unsubProfile = onSnapshot(
      doc(db, "stores", storeId, "users", user.uid),
      (snap) => {
        if (!snap.exists()) {
          setProfile(null);
          return;
        }
        setProfile({ id: snap.id, ...(snap.data() as StoreUserDoc) });
      },
      onErr
    );
    return () => {
      unsubStore();
      unsubProfile();
    };
  }, [user, storeId]);

  const signIn = useCallback(async (email: string, password: string) => {
    const auth = getFirebaseAuth();
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signOut = useCallback(async () => {
    const auth = getFirebaseAuth();
    await firebaseSignOut(auth);
  }, []);

  const registerOwner = useCallback(
    async (input: {
      email: string;
      password: string;
      storeName: string;
      displayName: string;
    }) => {
      const auth = getFirebaseAuth();
      const db = getDb();
      const cred = await createUserWithEmailAndPassword(
        auth,
        input.email.trim(),
        input.password
      );
      const storeRef = doc(collection(db, "stores"));
      const newStoreId = storeRef.id;
      const inviteCode = randomInviteCode(8);
      const batch = writeBatch(db);
      batch.set(storeRef, {
        name: input.storeName.trim(),
        currency: "EGP",
        timezone:
          typeof Intl !== "undefined"
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : "Africa/Cairo",
        ownerId: cred.user.uid,
        inviteCode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, "publicStoreInvites", inviteCode), {
        storeId: newStoreId,
      });
      batch.set(doc(db, "userStores", cred.user.uid), {
        storeId: newStoreId,
      });
      batch.set(doc(db, "stores", newStoreId, "users", cred.user.uid), {
        email: input.email.trim(),
        displayName: input.displayName.trim(),
        role: "admin",
        active: true,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      await seedDefaultWallets(db, newStoreId);
      setStoreId(newStoreId);
    },
    []
  );

  const registerCashier = useCallback(
    async (input: {
      email: string;
      password: string;
      inviteCode: string;
      displayName: string;
    }) => {
      const db = getDb();
      const code = input.inviteCode.trim().toUpperCase();
      const inv = await getDoc(doc(db, "publicStoreInvites", code));
      if (!inv.exists()) {
        throw new Error("INVALID_INVITE");
      }
      const sid = inv.data().storeId as string;
      const auth = getFirebaseAuth();
      const cred = await createUserWithEmailAndPassword(
        auth,
        input.email.trim(),
        input.password
      );
      const batch = writeBatch(db);
      batch.set(doc(db, "userStores", cred.user.uid), { storeId: sid });
      batch.set(doc(db, "stores", sid, "users", cred.user.uid), {
        email: input.email.trim(),
        displayName: input.displayName.trim(),
        role: "cashier",
        active: true,
        inviteCodeUsed: code,
        createdAt: serverTimestamp(),
      });
      await batch.commit();
      setStoreId(sid);
    },
    []
  );

  const refreshStore = useCallback(async () => {
    if (!user || !storeId) return;
    const db = getDb();
    const snap = await getDoc(doc(db, "stores", storeId));
    if (snap.exists()) {
      setStore({ id: snap.id, ...(snap.data() as StoreDoc) });
    }
  }, [user, storeId]);

  const value = useMemo(
    () => ({
      status,
      user,
      storeId,
      store,
      profile,
      signIn,
      signOut,
      registerOwner,
      registerCashier,
      refreshStore,
    }),
    [
      status,
      user,
      storeId,
      store,
      profile,
      signIn,
      signOut,
      registerOwner,
      registerCashier,
      refreshStore,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
