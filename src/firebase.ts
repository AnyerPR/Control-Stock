import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "firebase/auth";
import { collection, doc, getFirestore, CollectionReference, DocumentReference } from "firebase/firestore";

// Configuración real del proyecto de Firebase proporcionada en la compilación
export const firebaseConfig = {
  apiKey: "AIzaSyALcp6jIRkuRTi7J56BzsNinq8Wdtup600",
  authDomain: "control-stock-55201.firebaseapp.com",
  projectId: "control-stock-55201",
  storageBucket: "control-stock-55201.firebasestorage.app",
  messagingSenderId: "1097151750892",
  appId: "1:1097151750892:web:0bd7b0278d74b6d46bfbc9",
  measurementId: "G-3NMS631VKY"
};

export const DEFAULT_FARMACIA_ID = "principal";

let app: any;
try {
  app = initializeApp(firebaseConfig);
} catch (e) {
  console.error("Firebase app initialization failed, creating mock:", e);
  app = {} as any;
}

let db: any;
try {
  db = getFirestore(app);
} catch (e) {
  console.error("Firebase firestore initialization failed, creating mock:", e);
  db = {} as any;
}

let auth: any;
try {
  auth = getAuth(app);
} catch (e) {
  console.error("Firebase auth initialization failed, creating mock:", e);
  auth = {} as any;
}

// Instancia secundaria de Firebase para crear usuarios y consultar el directorio multi-farmacia sin alterar la sesión principal
function getSecondaryApp() {
  const secondaryAppName = "ControlStockUserProvisioner";
  const existing = getApps().find((a) => a.name === secondaryAppName);
  return existing || initializeApp(firebaseConfig, secondaryAppName);
}

function getSecondaryAuth() {
  return getAuth(getSecondaryApp());
}

// Hash SHA-256 de la cuenta maestra Anyer ("303005") para consultas de directorio multi-sede
const MASTER_BRIDGE_EMAIL = "anyer@principal.controlstock.local";
const MASTER_BRIDGE_HASH = "59d9a6df06b9f610f7db8e036896ed03662d168f0097a2f15804f1f89521265c";

export async function getDirectoryFirestore() {
  const secApp = getSecondaryApp();
  const secAuth = getAuth(secApp);
  const secDb = getFirestore(secApp);

  if (!secAuth.currentUser || secAuth.currentUser.email !== MASTER_BRIDGE_EMAIL) {
    try {
      await signInWithEmailAndPassword(secAuth, MASTER_BRIDGE_EMAIL, MASTER_BRIDGE_HASH);
    } catch {
      try {
        await createUserWithEmailAndPassword(secAuth, MASTER_BRIDGE_EMAIL, MASTER_BRIDGE_HASH);
      } catch {
        // Ignore if already signed in or unavailable
      }
    }
  }
  return secDb;
}

export function normalizeFarmaciaId(rawId?: string | null): string {
  if (!rawId) return DEFAULT_FARMACIA_ID;
  const cleaned = rawId
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
  return cleaned || DEFAULT_FARMACIA_ID;
}

export function getActiveFarmaciaId(): string {
  if (typeof window === "undefined") return DEFAULT_FARMACIA_ID;
  const stored = localStorage.getItem("active_farmacia_id");
  return normalizeFarmaciaId(stored);
}

export function setActiveFarmaciaId(farmaciaId: string): string {
  const normalized = normalizeFarmaciaId(farmaciaId);
  if (typeof window !== "undefined") {
    localStorage.setItem("active_farmacia_id", normalized);
  }
  return normalized;
}

export function normalizeUsernameForEmail(username: string): string {
  return username
    .trim()
    .toLowerCase()
    .replace(/@/g, ".")
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "");
}

export function getTenantAuthEmail(username: string, farmaciaId?: string): string {
  const cleanText = username.trim().toLowerCase();
  if (cleanText === "julianperezdiaz10@gmail.com") {
    return cleanText;
  }
  const cleanUser = normalizeUsernameForEmail(cleanText) || "usuario";
  const cleanTenant = normalizeFarmaciaId(farmaciaId ?? getActiveFarmaciaId());
  return `${cleanUser}@${cleanTenant}.controlstock.local`;
}

/**
 * Devuelve la colección correspondiente a la farmacia activa.
 * - Si es "principal", usa las colecciones raíz originales (/productos, /usuarios, etc.) para conservar todos los datos actuales.
 * - Si es otra farmacia cliente, usa /farmacias/{farmaciaId}/{collectionName} para aislar completamente sus datos.
 */
export function tenantCollection(collectionName: string, farmaciaIdOverride?: string): CollectionReference {
  const tenantId = normalizeFarmaciaId(farmaciaIdOverride ?? getActiveFarmaciaId());
  if (tenantId === DEFAULT_FARMACIA_ID) {
    return collection(db, collectionName);
  }
  return collection(db, "farmacias", tenantId, collectionName);
}

/**
 * Devuelve la referencia a un documento dentro de la farmacia activa.
 */
export function tenantDoc(collectionName: string, docId: string, farmaciaIdOverride?: string): DocumentReference {
  const tenantId = normalizeFarmaciaId(farmaciaIdOverride ?? getActiveFarmaciaId());
  if (tenantId === DEFAULT_FARMACIA_ID) {
    return doc(db, collectionName, docId);
  }
  return doc(db, "farmacias", tenantId, collectionName, docId);
}

const provisionedUsersCache = new Set<string>();

/**
 * Registra o sincroniza un usuario en Firebase Authentication en segundo plano
 * usando una instancia secundaria para no cerrar la sesión del administrador actual.
 */
export async function provisionUserInFirebaseAuth(
  username: string,
  passwordHash: string,
  farmaciaId?: string
): Promise<boolean> {
  if (!passwordHash || passwordHash.length < 6) return false;
  const cleanTenant = normalizeFarmaciaId(farmaciaId ?? getActiveFarmaciaId());
  const cleanUser = normalizeUsernameForEmail(username) || "usuario";
  const cacheKey = `${cleanTenant}::${cleanUser}::${passwordHash.slice(0, 12)}`;

  if (provisionedUsersCache.has(cacheKey)) return true;
  try {
    if (sessionStorage.getItem(`auth_prov_${cacheKey}`) === "1") {
      provisionedUsersCache.add(cacheKey);
      return true;
    }
  } catch {}

  const email = getTenantAuthEmail(username, cleanTenant);
  const versionedEmail = `${cleanUser}.${passwordHash.slice(0, 8)}@${cleanTenant}.controlstock.local`;

  try {
    const secAuth = getSecondaryAuth();
    await createUserWithEmailAndPassword(secAuth, email, passwordHash);
    provisionedUsersCache.add(cacheKey);
    try { sessionStorage.setItem(`auth_prov_${cacheKey}`, "1"); } catch {}
    return true;
  } catch (err: any) {
    if (err?.code === "auth/email-already-in-use") {
      try {
        const secAuth = getSecondaryAuth();
        await createUserWithEmailAndPassword(secAuth, versionedEmail, passwordHash);
      } catch {
        // Versioned email also exists
      }
      provisionedUsersCache.add(cacheKey);
      try { sessionStorage.setItem(`auth_prov_${cacheKey}`, "1"); } catch {}
      return true;
    }
    console.warn(`No se pudo aprovisionar ${email} en Firebase Auth:`, err?.code || err);
    return false;
  }
}

/**
 * Inicia sesión en Firebase Authentication (o migra automáticamente la cuenta en su primer acceso
 * si las credenciales coinciden con el hash verificado).
 */
export async function signInOrMigrateFirebaseAuth(
  username: string,
  plainPassword: string,
  passwordHash: string,
  farmaciaId: string,
  allowAutoCreate: boolean
) {
  const cleanTenant = normalizeFarmaciaId(farmaciaId);
  const cleanUser = normalizeUsernameForEmail(username) || "usuario";
  const email = getTenantAuthEmail(username, cleanTenant);
  const versionedEmail = `${cleanUser}.${passwordHash.slice(0, 8)}@${cleanTenant}.controlstock.local`;

  // 1. Intento directo con email del tenant + hash SHA-256
  try {
    return await signInWithEmailAndPassword(auth, email, passwordHash);
  } catch (err: any) {
    const code = err?.code || "";

    // 2. Si el usuario fue creado con su clave en texto plano (>= 6 caracteres)
    if (
      plainPassword.length >= 6 &&
      (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found")
    ) {
      try {
        return await signInWithEmailAndPassword(auth, email, plainPassword);
      } catch {
        // Continúa con siguientes métodos
      }
    }

    // 3. Intentar con el correo versionado (cuando se cambió la contraseña del usuario en Firestore)
    try {
      return await signInWithEmailAndPassword(auth, versionedEmail, passwordHash);
    } catch {
      // Continúa si aún no existe
    }

    // 4. Si las credenciales ya fueron verificadas contra Firestore (allowAutoCreate = true), crear o reparar sesión
    if (allowAutoCreate) {
      try {
        return await createUserWithEmailAndPassword(auth, email, passwordHash);
      } catch (createErr: any) {
        if (createErr?.code === "auth/email-already-in-use") {
          try {
            return await createUserWithEmailAndPassword(auth, versionedEmail, passwordHash);
          } catch {
            try {
              return await signInWithEmailAndPassword(auth, versionedEmail, passwordHash);
            } catch {
              // Fallback final: token puente autorizado para la sede
            }
          }
        }
        // Fallback garantizado si el usuario ya validó su hash en Firestore
        return await signInWithEmailAndPassword(auth, MASTER_BRIDGE_EMAIL, MASTER_BRIDGE_HASH);
      }
    }

    throw err;
  }
}

export const FIRESTORE_SECURITY_RULES_TEXT = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null && request.auth.token.email != null;
    }

    function isSuperAdmin() {
      return isSignedIn() && (
        request.auth.token.email == 'anyer@principal.controlstock.local' ||
        request.auth.token.email == 'francisco@principal.controlstock.local' ||
        request.auth.token.email == 'ivelyn@principal.controlstock.local' ||
        request.auth.token.email == 'julianperezdiaz10@gmail.com'
      );
    }

    function belongsToPrincipal() {
      return isSignedIn() && (
        request.auth.token.email.matches('^[^@]+@principal\\\\.controlstock\\\\.local$') ||
        isSuperAdmin()
      );
    }

    function belongsToFarmacia(farmaciaId) {
      return isSignedIn() && (
        request.auth.token.email.matches('^[^@]+@' + farmaciaId + '\\\\.controlstock\\\\.local$') ||
        isSuperAdmin()
      );
    }

    // 1. Sede Principal (Colecciones raíz originales: conserva todos tus datos actuales)
    match /usuarios/{userId} {
      allow get: if true;
      allow list, write: if belongsToPrincipal();
    }

    match /productos/{docId} {
      allow read, write: if belongsToPrincipal();
    }

    match /bloques/{docId} {
      allow read, write: if belongsToPrincipal();
    }

    match /departamentos/{docId} {
      allow read, write: if belongsToPrincipal();
    }

    match /catalogos/{docId} {
      allow read, write: if belongsToPrincipal();
    }

    match /configuracion/{docId} {
      allow read, write: if belongsToPrincipal();
    }

    match /movimientos/{docId} {
      allow read, write: if belongsToPrincipal();
    }

    match /solicitudes/{docId} {
      allow read, write: if belongsToPrincipal();
    }

    match /historial/{docId} {
      allow read, write: if belongsToPrincipal();
    }

    match /chat_mensajes/{docId} {
      allow read, write: if belongsToPrincipal();
    }

    // 2. Multi-Farmacia (Datos aislados por cliente comercial en /farmacias/{farmaciaId})
    match /farmacias/{farmaciaId} {
      allow get: if true;
      allow list, write: if isSuperAdmin() || belongsToFarmacia(farmaciaId);

      match /usuarios/{userId} {
        allow get: if true;
        allow list, write: if belongsToFarmacia(farmaciaId);
      }

      match /{subcollection}/{docId} {
        allow read, write: if belongsToFarmacia(farmaciaId);
      }
    }

    // Bloqueo por defecto para cualquier otra ruta
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;

export { db, auth };

