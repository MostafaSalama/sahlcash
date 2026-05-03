import type { FirebaseError } from "firebase/app";

/** next-intl keys under `auth.*` */
export type FirebaseAuthIntlKey =
  | "errorWrongPassword"
  | "errorUserNotFound"
  | "errorInvalidEmail"
  | "errorTooManyRequests"
  | "errorEmailInUse";

export function firebaseAuthMessageKey(err: unknown): FirebaseAuthIntlKey | null {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as FirebaseError).code)
      : null;
  if (!code) return null;
  switch (code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "errorWrongPassword";
    case "auth/user-not-found":
      return "errorUserNotFound";
    case "auth/invalid-email":
      return "errorInvalidEmail";
    case "auth/too-many-requests":
      return "errorTooManyRequests";
    case "auth/email-already-in-use":
      return "errorEmailInUse";
    default:
      return null;
  }
}
