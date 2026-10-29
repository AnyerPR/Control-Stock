import React, { useState, useEffect } from "react";
import { getDoc, getDocs, setDoc, doc, collection } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { Usuario, FarmaciaTenant } from "../types";
import {
  db,
  auth,
  DEFAULT_FARMACIA_ID,
  normalizeFarmaciaId,
  getActiveFarmaciaId,
  setActiveFarmaciaId,
  tenantDoc,
  tenantCollection,
  signInOrMigrateFirebaseAuth,
  getDirectoryFirestore,
  FIRESTORE_SECURITY_RULES_TEXT
} from "../firebase";
import {
  ShieldAlert,
  LoaderCircle,
  User,
  Key,
  Hospital,
  Building2,
  ShieldCheck,
  Copy,
  Check,
  X,
  ChevronDown
} from "lucide-react";
import { PWAInstallButton, APP_ICON_PATH } from "./PWAInstallButton";

interface LoginProps {
  users: Usuario[];
  isInitializingUsers: boolean;
  onLoginSuccess: (
    user: Usuario,
    farmaciaId: string,
    farmaciaMeta?: { nombre: string; subtitulo?: string }
  ) => void;
}

const DEFAULT_ADMINS = [
  { nombre: "Anyer", usuario: "Anyer", pass: "303005", rol: "Administrador" as const },
  { nombre: "Francisco", usuario: "Francisco", pass: "14147", rol: "Administrador" as const },
  { nombre: "Ivelyn", usuario: "Ivelyn", pass: "6606", rol: "Administrador" as const }
];

// SHA-256 Fallback in pure JS for unsecure contexts like file:// protocol
function sha256Fallback(ascii: string): string {
  const rightRotate = (value: number, amount: number) => {
    return (value >>> amount) | (value << (32 - amount));
  };

  const lengthProperty = "length";
  let i, j;

  let result = "";

  const words: number[] = [];
  const asciiLength = ascii[lengthProperty];
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  const wordsLength = ((asciiLength + 8) >> 6) + 1;
  for (i = 0; i < wordsLength * 16; i++) {
    words[i] = 0;
  }
  for (i = 0; i < asciiLength; i++) {
    words[i >> 2] |= ascii.charCodeAt(i) << (24 - (i % 4) * 8);
  }
  words[asciiLength >> 2] |= 0x80 << (24 - (asciiLength % 4) * 8);
  words[wordsLength * 16 - 1] = asciiLength * 8;

  for (i = 0; i < wordsLength; i++) {
    const w = [];
    for (j = 0; j < 16; j++) {
      w[j] = words[i * 16 + j];
    }
    for (j = 16; j < 64; j++) {
      const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }

    let a = hash[0],
      b = hash[1],
      c = hash[2],
      d = hash[3],
      e = hash[4],
      f = hash[5],
      g = hash[6],
      h = hash[7];

    for (j = 0; j < 64; j++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[j] + w[j]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  for (i = 0; i < 8; i++) {
    let hex = (hash[i] >>> 0).toString(16);
    while (hex.length < 8) hex = "0" + hex;
    result += hex;
  }

  return result;
}

// SHA-256 Utility Function with local file:// fallback
async function hashPassword(password: string): Promise<string> {
  if (typeof window === "undefined" || !window.crypto || !window.crypto.subtle) {
    console.warn("Subtle Crypto is not available. Using pure-JS SHA-256 fallback.");
    return sha256Fallback(password);
  }
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hash = await window.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch (err) {
    console.error("Native digest failed, falling back to pure JS:", err);
    return sha256Fallback(password);
  }
}

export default function Login({ users, isInitializingUsers, onLoginSuccess }: LoginProps) {
  const [farmaciaId, setFarmaciaId] = useState<string>(() => getActiveFarmaciaId());
  const [availableFarmacias, setAvailableFarmacias] = useState<FarmaciaTenant[]>(() => {
    try {
      const cached = localStorage.getItem("known_farmacias_directory");
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [showCustomCodeInput, setShowCustomCodeInput] = useState<boolean>(false);
  const [farmaciaTitle, setFarmaciaTitle] = useState<string>("Control de Stock");
  const [farmaciaSubtitle, setFarmaciaSubtitle] = useState<string>(
    "Suministros Hospitalarios • Dr. José Manuel Rodríguez"
  );

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsRulesUpdate, setNeedsRulesUpdate] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [copiedRules, setCopiedRules] = useState(false);
  const [loading, setLoading] = useState(false);

  // Cargar el directorio de farmacias registradas para mostrarlas en el selector de inicio de sesión
  useEffect(() => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    if (isLocalFileMode) return;

    let cancelled = false;
    const loadDirectory = async () => {
      try {
        const secDb = await getDirectoryFirestore();
        const snap = await getDocs(collection(secDb, "farmacias"));
        if (cancelled) return;
        const list: FarmaciaTenant[] = [];
        snap.forEach((d) => {
          list.push({ ...(d.data() as FarmaciaTenant), id: d.id });
        });
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setAvailableFarmacias(list);
        localStorage.setItem("known_farmacias_directory", JSON.stringify(list));
      } catch (err) {
        console.warn("No se pudo sincronizar directorio inicial de farmacias:", err);
      }
    };
    loadDirectory();
    return () => {
      cancelled = true;
    };
  }, []);

  // Actualizar nombre de la farmacia seleccionada en la cabecera del Login
  useEffect(() => {
    const cleanTenant = normalizeFarmaciaId(farmaciaId);
    if (cleanTenant === DEFAULT_FARMACIA_ID) {
      setFarmaciaTitle("Control de Stock");
      setFarmaciaSubtitle("Suministros Hospitalarios • Dr. José Manuel Rodríguez");
      return;
    }

    const foundLocal = availableFarmacias.find((f) => f.id === cleanTenant);
    if (foundLocal) {
      setFarmaciaTitle(foundLocal.nombre || "Control de Stock");
      setFarmaciaSubtitle(foundLocal.subtitulo || foundLocal.direccion || `Sede: ${cleanTenant}`);
      return;
    }

    let cancelled = false;
    const fetchTenantMeta = async () => {
      try {
        const snap = await getDoc(doc(db, "farmacias", cleanTenant));
        if (!cancelled && snap.exists()) {
          const data = snap.data() as FarmaciaTenant;
          setFarmaciaTitle(data.nombre || "Control de Stock");
          setFarmaciaSubtitle(data.subtitulo || `Sede: ${cleanTenant}`);
        } else if (!cancelled) {
          setFarmaciaTitle("Control de Stock");
          setFarmaciaSubtitle(`Farmacia / Sede: ${cleanTenant}`);
        }
      } catch {
        if (!cancelled) {
          setFarmaciaTitle("Control de Stock");
          setFarmaciaSubtitle(`Farmacia / Sede: ${cleanTenant}`);
        }
      }
    };
    fetchTenantMeta();
    return () => {
      cancelled = true;
    };
  }, [farmaciaId, availableFarmacias]);

  const handleCopyRules = async () => {
    try {
      await navigator.clipboard.writeText(FIRESTORE_SECURITY_RULES_TEXT);
      setCopiedRules(true);
      setTimeout(() => setCopiedRules(false), 2500);
    } catch {
      // Fallback
    }
  };

  /**
   * Busca un usuario por nombre de usuario dentro de una sede específica (usando el lector de directorio
   * por si aún no se ha iniciado sesión en la instancia principal).
   */
  const findUserInTenant = async (
    targetTenant: string,
    targetUsername: string
  ): Promise<Usuario | null> => {
    const cleanUserLower = targetUsername.trim().toLowerCase();
    const expectedDocId = `user-${cleanUserLower}`;

    // 1. Intento de lectura directa por ID estándar
    try {
      const directSnap = await getDoc(tenantDoc("usuarios", expectedDocId, targetTenant));
      if (directSnap.exists()) {
        return { ...(directSnap.data() as Usuario), id: directSnap.id };
      }
    } catch {
      // Continúa con consulta vía instancia de directorio
    }

    // 2. Búsqueda completa en la colección usuarios de esa sede usando getDirectoryFirestore()
    try {
      const secDb = await getDirectoryFirestore();
      const usersCol =
        targetTenant === DEFAULT_FARMACIA_ID
          ? collection(secDb, "usuarios")
          : collection(secDb, "farmacias", targetTenant, "usuarios");
      const allSnap = await getDocs(usersCol);
      let matched: Usuario | null = null;
      allSnap.forEach((d) => {
        const u = d.data() as Usuario;
        if (u.usuario && u.usuario.trim().toLowerCase() === cleanUserLower) {
          matched = { ...u, id: d.id };
        }
      });
      return matched;
    } catch {
      return null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNeedsRulesUpdate(false);

    const cleanUsername = username.trim();
    let cleanTenant = normalizeFarmaciaId(farmaciaId);

    // Si el usuario escribió el nombre de la farmacia en vez de su código ID, resolver al ID correcto
    const matchedByName = availableFarmacias.find(
      (f) =>
        f.id === cleanTenant ||
        f.nombre.trim().toLowerCase() === farmaciaId.trim().toLowerCase()
    );
    if (matchedByName) {
      cleanTenant = matchedByName.id;
    }

    if (!cleanUsername || !password) {
      setError("Por favor complete todos los campos.");
      return;
    }

    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

    setLoading(true);
    try {
      const inputHash = await hashPassword(password);

      // Modo local sin conexión (file://)
      if (isLocalFileMode) {
        const foundUser = users.find(
          (u) => u.usuario.toLowerCase() === cleanUsername.toLowerCase()
        );
        if (!foundUser) {
          setError("Usuario no encontrado.");
          setLoading(false);
          return;
        }
        if (foundUser.estado === "Inactivo") {
          setError("Este usuario se encuentra inactivo. Contacte a un administrador.");
          setLoading(false);
          return;
        }
        if (inputHash !== foundUser.contrasenaHash) {
          setError("Contraseña incorrecta.");
          setLoading(false);
          return;
        }
        setActiveFarmaciaId(cleanTenant);
        onLoginSuccess(foundUser, cleanTenant, {
          nombre: farmaciaTitle,
          subtitulo: farmaciaSubtitle
        });
        return;
      }

      // 1. Verificar si es uno de los administradores semilla (Anyer, Francisco, Ivelyn)
      const matchedDefaultAdmin = DEFAULT_ADMINS.find(
        (adm) => adm.usuario.toLowerCase() === cleanUsername.toLowerCase()
      );

      let matchesDefaultAdminPass = false;
      if (matchedDefaultAdmin) {
        const expectedDefaultHash = await hashPassword(matchedDefaultAdmin.pass);
        matchesDefaultAdminPass = expectedDefaultHash === inputHash;
      }

      // 2. Buscar el documento de usuario en la sede seleccionada
      let preVerifiedFirestoreUser: Usuario | null = null;
      const foundInSelectedTenant = await findUserInTenant(cleanTenant, cleanUsername);

      if (foundInSelectedTenant) {
        if (
          foundInSelectedTenant.contrasenaHash === inputHash ||
          foundInSelectedTenant.contrasenaHash === password
        ) {
          preVerifiedFirestoreUser = foundInSelectedTenant;
        } else if (!matchesDefaultAdminPass) {
          // Antes de rechazar, verificar en paralelo si existe en otra farmacia con esa contraseña
          let foundInOtherFarmacia: { user: Usuario; tenant: FarmaciaTenant } | null = null;
          try {
            const secDb = await getDirectoryFirestore();
            const farmSnap = await getDocs(collection(secDb, "farmacias"));
            const otherDocs = farmSnap.docs.filter((fDoc) => fDoc.id !== cleanTenant);
            const candidates = await Promise.all(
              otherDocs.map(async (fDoc) => {
                const candidateUser = await findUserInTenant(fDoc.id, cleanUsername);
                return { fDoc, candidateUser };
              })
            );
            for (const { fDoc, candidateUser } of candidates) {
              if (
                candidateUser &&
                (candidateUser.contrasenaHash === inputHash || candidateUser.contrasenaHash === password)
              ) {
                foundInOtherFarmacia = {
                  user: candidateUser,
                  tenant: { ...(fDoc.data() as FarmaciaTenant), id: fDoc.id }
                };
                break;
              }
            }
          } catch {}

          if (foundInOtherFarmacia) {
            cleanTenant = foundInOtherFarmacia.tenant.id;
            setFarmaciaId(cleanTenant);
            preVerifiedFirestoreUser = foundInOtherFarmacia.user;
          } else {
            setError("Contraseña incorrecta.");
            setLoading(false);
            return;
          }
        }
      }

      // 2.B AUTO-DETECCIÓN DE FARMACIA EN PARALELO: Si no se encontró en la sede actual,
      // buscar simultáneamente en todas las farmacias registradas.
      if (!preVerifiedFirestoreUser && !matchesDefaultAdminPass) {
        try {
          const secDb = await getDirectoryFirestore();
          const farmSnap = await getDocs(collection(secDb, "farmacias"));
          const candidates = await Promise.all(
            farmSnap.docs.map(async (fDoc) => {
              const candidateUser = await findUserInTenant(fDoc.id, cleanUsername);
              return { fDoc, candidateUser };
            })
          );
          for (const { fDoc, candidateUser } of candidates) {
            if (candidateUser) {
              if (
                candidateUser.contrasenaHash === inputHash ||
                candidateUser.contrasenaHash === password
              ) {
                cleanTenant = fDoc.id;
                setFarmaciaId(fDoc.id);
                preVerifiedFirestoreUser = candidateUser;
                break;
              } else if (fDoc.id === cleanTenant) {
                setError("Contraseña incorrecta.");
                setLoading(false);
                return;
              }
            }
          }
        } catch (dirErr) {
          console.warn("Error en auto-detección de farmacia:", dirErr);
        }
      }

      const allowAutoCreateAuth = matchesDefaultAdminPass || !!preVerifiedFirestoreUser;

      // 3. Autenticar con Firebase Authentication
      // Si es uno de los Super Admins (Anyer/Francisco/Ivelyn) entrando a cualquier farmacia, autenticar en principal
      const authTargetTenant =
        matchesDefaultAdminPass && !preVerifiedFirestoreUser
          ? DEFAULT_FARMACIA_ID
          : cleanTenant;

      try {
        await signInOrMigrateFirebaseAuth(
          cleanUsername,
          password,
          inputHash,
          authTargetTenant,
          allowAutoCreateAuth
        );
      } catch (authErr: any) {
        const code = authErr?.code || "";
        if (
          code === "auth/invalid-credential" ||
          code === "auth/wrong-password" ||
          code === "auth/user-not-found"
        ) {
          setError("Usuario o contraseña incorrectos. Verifica el usuario, la contraseña o la Sede seleccionada.");
        } else if (code === "auth/too-many-requests") {
          setError("Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.");
        } else {
          setError(`Error de autenticación (${code || "Firebase Auth"}).`);
        }
        setLoading(false);
        return;
      }

      // 4. Validar estado de la farmacia y obtener su membrete
      let tenantMeta = {
        nombre: "Control de Stock",
        subtitulo:
          cleanTenant === DEFAULT_FARMACIA_ID
            ? "Suministros Hospitalarios • Dr. José Manuel Rodríguez"
            : `Sede: ${cleanTenant}`
      };

      if (cleanTenant !== DEFAULT_FARMACIA_ID) {
        try {
          const farmaciaSnap = await getDoc(doc(db, "farmacias", cleanTenant));
          if (farmaciaSnap.exists()) {
            const fData = farmaciaSnap.data() as FarmaciaTenant;
            if (fData.activa === false) {
              await signOut(auth);
              setError("Esta farmacia / sede se encuentra suspendida. Contacte al administrador comercial.");
              setLoading(false);
              return;
            }
            tenantMeta = {
              nombre: "Control de Stock",
              subtitulo: fData.nombre || fData.subtitulo || `Sede: ${cleanTenant}`
            };
          }
        } catch (err: any) {
          if (err?.code === "permission-denied") {
            setNeedsRulesUpdate(true);
            setShowRulesModal(true);
            setError(
              "Autenticación exitosa, pero tus Reglas de Firestore necesitan actualizarse. Haz clic en el botón de abajo para copiarlas."
            );
            setLoading(false);
            return;
          }
        }
      }

      // 5. Obtener (o sembrar si es admin por defecto) el documento del usuario
      let finalUser: Usuario | null = preVerifiedFirestoreUser;

      if (!finalUser) {
        try {
          finalUser = await findUserInTenant(cleanTenant, cleanUsername);

          // Si no existía el documento en esta sede pero es uno de los Super Admins iniciales
          if (!finalUser && matchedDefaultAdmin && matchesDefaultAdminPass) {
            const expectedUserDocId = `user-${cleanUsername.toLowerCase()}`;
            const seededAdmin: Usuario = {
              id: expectedUserDocId,
              nombre: matchedDefaultAdmin.nombre,
              usuario: matchedDefaultAdmin.usuario,
              contrasenaHash: inputHash,
              rol: matchedDefaultAdmin.rol,
              estado: "Activo",
              updatedAt: Date.now(),
              departamento: "Almacén y Suministro",
              modulos: [
                "inventory",
                "carga_masiva",
                "solicitudes",
                "historial",
                "usuarios",
                "configuracion"
              ],
              farmaciaId: cleanTenant,
              authUid: auth.currentUser?.uid
            };
            if (cleanTenant === DEFAULT_FARMACIA_ID) {
              await setDoc(tenantDoc("usuarios", seededAdmin.id, cleanTenant), seededAdmin);
            }
            finalUser = seededAdmin;
          }
        } catch (firestoreErr: any) {
          if (firestoreErr?.code === "permission-denied") {
            setNeedsRulesUpdate(true);
            setShowRulesModal(true);
            setError(
              "¡Tu usuario ya fue autenticado en Firebase Auth! Ahora solo falta pegar las Reglas de Seguridad en tu consola de Firestore."
            );
            setLoading(false);
            return;
          }
          throw firestoreErr;
        }
      }

      if (!finalUser) {
        await signOut(auth);
        setError("El usuario no existe en los registros de esta farmacia.");
        setLoading(false);
        return;
      }

      if (finalUser.estado === "Inactivo") {
        await signOut(auth);
        setError("Este usuario se encuentra inactivo. Contacte a un administrador.");
        setLoading(false);
        return;
      }

      setActiveFarmaciaId(cleanTenant);
      onLoginSuccess(
        { ...finalUser, farmaciaId: cleanTenant, authUid: auth.currentUser?.uid },
        cleanTenant,
        tenantMeta
      );
    } catch (err) {
      console.error(err);
      setError("Ocurrió un error al verificar las credenciales.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200/80 flex flex-col justify-center py-8 sm:py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center px-4">
        <div className="mx-auto h-18 w-18 bg-white rounded-2xl flex items-center justify-center shadow-lg shadow-teal-950/15 mb-3.5 border border-slate-200/90 p-2">
          <img
            src={APP_ICON_PATH}
            alt="Icono de la Aplicación"
            className="w-full h-full object-contain"
          />
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">{farmaciaTitle}</h2>
        <p className="mt-1 text-xs sm:text-sm font-bold text-teal-800">{farmaciaSubtitle}</p>
      </div>

      <div className="mt-5 sm:mt-6 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="bg-white py-6 sm:py-8 px-5 border border-slate-200/90 shadow-xl shadow-slate-900/5 rounded-3xl sm:px-10">
          <div className="flex items-center justify-between border-b border-slate-200/80 pb-3.5 mb-5 gap-2">
            <h3 className="text-base sm:text-lg font-extrabold text-slate-900">Iniciar Sesión</h3>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-teal-800 bg-teal-50 border border-teal-200 px-3 py-1 rounded-xl truncate max-w-[180px]">
              <Building2 className="w-3.5 h-3.5 text-teal-700 shrink-0" />
              <span className="truncate">Sede: {normalizeFarmaciaId(farmaciaId)}</span>
            </span>
          </div>

          {isInitializingUsers ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <LoaderCircle className="w-8 h-8 animate-spin text-teal-600 mb-2.5" />
              <p className="text-xs font-bold text-slate-600">Verificando sesión de seguridad...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 flex flex-col gap-2 text-xs text-rose-800 font-bold anim-card-in">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                  {needsRulesUpdate && (
                    <button
                      type="button"
                      onClick={() => setShowRulesModal(true)}
                      className="self-start mt-1 bg-rose-700 hover:bg-rose-800 text-white font-extrabold px-3.5 py-2 rounded-xl text-[11px] uppercase tracking-wider transition cursor-pointer"
                    >
                      Ver y Copiar Reglas de Firestore
                    </button>
                  )}
                </div>
              )}

              {/* Selector Visible de Farmacia / Sede */}
              <div className="bg-slate-50/90 p-4 rounded-2xl border border-slate-200/90 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-extrabold uppercase text-slate-700 tracking-wider">
                    Farmacia / Sede de Acceso
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowCustomCodeInput((prev) => !prev)}
                    className="text-[11px] font-extrabold text-teal-700 hover:text-teal-900 hover:underline cursor-pointer"
                  >
                    {showCustomCodeInput ? "Elegir de la lista" : "Escribir código manual"}
                  </button>
                </div>

                {!showCustomCodeInput ? (
                  <div className="relative">
                    <Building2 className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-teal-700 pointer-events-none" />
                    <select
                      value={normalizeFarmaciaId(farmaciaId)}
                      onChange={(e) => setFarmaciaId(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-9 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-teal-500/30 text-slate-900 appearance-none cursor-pointer shadow-2xs"
                    >
                      <option value="principal">
                        🏥 Sede Principal (Dr. José Manuel Rodríguez)
                      </option>
                      {availableFarmacias.map((f) => (
                        <option key={f.id} value={f.id}>
                          🏪 {f.nombre} ({f.id}) {!f.activa ? "• [Suspendida]" : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                  </div>
                ) : (
                  <div className="relative">
                    <Building2 className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-teal-700" />
                    <input
                      type="text"
                      value={farmaciaId}
                      onChange={(e) => setFarmaciaId(e.target.value)}
                      placeholder="Ej: principal o código de la farmacia"
                      className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-teal-500/30 text-slate-900 shadow-2xs"
                    />
                  </div>
                )}
                <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                  Selecciona tu farmacia o ingresa directamente tu usuario y contraseña (el sistema detectará tu sede automáticamente).
                </p>
              </div>

              <div>
                <label className="block text-xs font-extrabold uppercase text-slate-700 tracking-wider mb-1.5">
                  Usuario
                </label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Tu nombre de usuario (ej. admin o Anyer)"
                    className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-teal-500/30 text-slate-900 shadow-2xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-extrabold uppercase text-slate-700 tracking-wider mb-1.5">
                  Contraseña
                </label>
                <div className="relative">
                  <Key className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-teal-500/30 text-slate-900 shadow-2xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-teal-800 hover:bg-teal-700 active:scale-[0.99] disabled:bg-slate-300 text-white py-3.5 text-sm font-extrabold tracking-wider uppercase transition shadow-md shadow-teal-900/15 flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <>
                    <LoaderCircle className="w-4 h-4 animate-spin" />
                    <span>Autenticando...</span>
                  </>
                ) : (
                  <span>Entrar al Sistema</span>
                )}
              </button>
            </form>
          )}
        </div>
        <PWAInstallButton variant="login" />
      </div>

      {/* Modal con las Reglas de Seguridad de Firestore listas para copiar */}
      {showRulesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs"
            onClick={() => setShowRulesModal(false)}
          />
          <div className="relative bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 bg-teal-900 text-white">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-300" />
                <h3 className="font-black text-sm uppercase tracking-wider">
                  Reglas de Seguridad para Cloud Firestore (Multi-Farmacia)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowRulesModal(false)}
                className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs text-slate-700">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-1.5 text-amber-900">
                <p className="font-black uppercase text-[11px] tracking-wider">
                  Instrucciones (Solo toma 30 segundos):
                </p>
                <ol className="list-decimal list-inside space-y-1 font-semibold">
                  <li>
                    En tu consola de Firebase (proyecto <strong>control-stock-55201</strong>), entra en{" "}
                    <strong>Firestore Database → pestaña Reglas (Rules)</strong>.
                  </li>
                  <li>
                    Borra las reglas anteriores (las que tenían <code>allow read, write: if false;</code>).
                  </li>
                  <li>
                    Haz clic en <strong>"Copiar Reglas"</strong> aquí abajo, pégalas en Firebase y pulsa{" "}
                    <strong>Publicar (Publish)</strong>.
                  </li>
                </ol>
              </div>

              <div className="flex items-center justify-between">
                <span className="font-black uppercase text-slate-500 tracking-wider text-[11px]">
                  Código de firestore.rules:
                </span>
                <button
                  type="button"
                  onClick={handleCopyRules}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-black text-xs transition cursor-pointer shadow-xs"
                >
                  {copiedRules ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-300" />
                      <span>¡Copiado al portapapeles!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copiar Reglas</span>
                    </>
                  )}
                </button>
              </div>

              <pre className="bg-slate-900 text-emerald-300 p-4 rounded-2xl overflow-x-auto font-mono text-[11px] leading-relaxed select-all border border-slate-800">
                {FIRESTORE_SECURITY_RULES_TEXT}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export { hashPassword };
