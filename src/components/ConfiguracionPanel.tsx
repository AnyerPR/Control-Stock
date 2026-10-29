import React, { useState, useEffect, useRef } from "react";
import { doc, setDoc, updateDoc, collection, deleteDoc, getDocs, getDoc, writeBatch, onSnapshot } from "firebase/firestore";
import {
  db,
  tenantCollection,
  tenantDoc,
  getActiveFarmaciaId,
  DEFAULT_FARMACIA_ID,
  normalizeFarmaciaId,
  provisionUserInFirebaseAuth,
  FIRESTORE_SECURITY_RULES_TEXT
} from "../firebase";
import {
  Usuario,
  ColoresConfig,
  Departamento,
  Catalogo,
  Producto,
  FarmaciaTenant,
  InstitucionInfo,
  CampoVariableCliente,
  ConceptoFactura,
  DEFAULT_CONCEPTOS_FACTURA
} from "../types";
import { hashPassword } from "./Login";
import PhotoCaptureField from "./PhotoCaptureField";
import { playSound } from "../utils/audio";
import {
  RefreshCw,
  Palette,
  Check,
  Plus,
  Edit2,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Building,
  X,
  Layers,
  Building2,
  Copy,
  ShieldCheck,
  CreditCard,
  Phone,
  Mail,
  Globe,
  MapPin,
  FileText,
  Image as ImageIcon,
  Upload,
  Save,
  UserCheck,
  SlidersHorizontal,
  Tag
} from "lucide-react";

interface ConfiguracionPanelProps {
  currentUser: Usuario;
  activePeriod: string;
  colores: ColoresConfig;
  onUpdatePeriod: (newPeriod: string) => void;
  onUpdateColores: (newColores: ColoresConfig) => void;
  showToast: (message: string) => void;
  departamentos: Departamento[];
  catalogos: Catalogo[];
  conceptos?: ConceptoFactura[];
  onUpdateConceptos?: (list: ConceptoFactura[]) => void;
  onUpdateInstitucion?: (info: InstitucionInfo) => void;
  onSwitchFarmacia?: (farmaciaId: string, nombre?: string) => void;
}

const PRESETS = [
  {
    name: "Verde Esmeralda (Original)",
    colors: {
      primary: "#0d9488",
      sidebar: "#115e59",
      buttons: "#0f766e",
      headers: "#115e59",
      cards: "#ffffff",
      tables: "#f8fafc",
      elements: "#0d9488"
    }
  },
  {
    name: "Azul Hospitalario",
    colors: {
      primary: "#0284c7",
      sidebar: "#1e3a8a",
      buttons: "#0369a1",
      headers: "#1e3a8a",
      cards: "#ffffff",
      tables: "#f0f9ff",
      elements: "#0284c7"
    }
  },
  {
    name: "Gris Quirúrgico & Carbón",
    colors: {
      primary: "#4f46e5",
      sidebar: "#1e293b",
      buttons: "#4338ca",
      headers: "#1e293b",
      cards: "#ffffff",
      tables: "#f1f5f9",
      elements: "#4f46e5"
    }
  },
  {
    name: "Violeta Clínico",
    colors: {
      primary: "#7c3aed",
      sidebar: "#4c1d95",
      buttons: "#6d28d9",
      headers: "#4c1d95",
      cards: "#ffffff",
      tables: "#faf5ff",
      elements: "#7c3aed"
    }
  }
];

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre"
];

export default function ConfiguracionPanel({
  currentUser,
  activePeriod,
  colores,
  onUpdatePeriod,
  onUpdateColores,
  showToast,
  departamentos,
  catalogos,
  conceptos = DEFAULT_CONCEPTOS_FACTURA,
  onUpdateConceptos,
  onUpdateInstitucion,
  onSwitchFarmacia
}: ConfiguracionPanelProps) {
  const [localColores, setLocalColores] = useState<ColoresConfig>({ ...colores });
  const [savingColores, setSavingColores] = useState(false);
  const [closingMonth, setClosingMonth] = useState(false);

  // Departments management state
  const [newDeptName, setNewDeptName] = useState("");
  const [editingDept, setEditingDept] = useState<Departamento | null>(null);
  const [editDeptName, setEditDeptName] = useState("");
  const [creatingDept, setCreatingDept] = useState(false);
  const [updatingDept, setUpdatingDept] = useState(false);

  // Catalogs management state
  const [newCatName, setNewCatName] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");
  const [editingCat, setEditingCat] = useState<Catalogo | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [editCatDesc, setEditCatDesc] = useState("");
  const [creatingCat, setCreatingCat] = useState(false);
  const [updatingCat, setUpdatingCat] = useState(false);

  // Conceptos de Facturación management state
  const [newConceptoName, setNewConceptoName] = useState("");
  const [newConceptoDesc, setNewConceptoDesc] = useState("");
  const [editingConcepto, setEditingConcepto] = useState<ConceptoFactura | null>(null);
  const [editConceptoName, setEditConceptoName] = useState("");
  const [editConceptoDesc, setEditConceptoDesc] = useState("");
  const [creatingConcepto, setCreatingConcepto] = useState(false);
  const [updatingConcepto, setUpdatingConcepto] = useState(false);

  const activeFarmaciaId = getActiveFarmaciaId();
  const isSuperAdmin =
    currentUser.usuario.toLowerCase() === "anyer" &&
    activeFarmaciaId === DEFAULT_FARMACIA_ID;
  const isAnyer =
    currentUser.usuario.toLowerCase() === "anyer" ||
    (activeFarmaciaId !== DEFAULT_FARMACIA_ID && currentUser.rol === "Administrador");
  const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

  // Multi-Pharmacy (Comercialización) & Institución / Empresa (Imagen 1) state
  const [farmaciasList, setFarmaciasList] = useState<FarmaciaTenant[]>([]);
  const [selectedClientMode, setSelectedClientMode] = useState<string>(activeFarmaciaId); // "principal", existing tenant id, or "__nuevo__"
  const [instNombre, setInstNombre] = useState("Suministros Hospitalarios • Dr. José Manuel Rodríguez");
  const [instRnc, setInstRnc] = useState("");
  const [instTelefono, setInstTelefono] = useState("");
  const [instCorreo, setInstCorreo] = useState("");
  const [instWeb, setInstWeb] = useState("");
  const [instDireccion, setInstDireccion] = useState("");
  const [instPiePagina, setInstPiePagina] = useState("");
  const [instLogoUrl, setInstLogoUrl] = useState("");
  const [instCamposExtra, setInstCamposExtra] = useState<CampoVariableCliente[]>([]);
  const [savingInstitucion, setSavingInstitucion] = useState(false);

  // Fields only used when selectedClientMode === "__nuevo__"
  const [newFarmaciaCode, setNewFarmaciaCode] = useState("");
  const [newFarmaciaAdminUser, setNewFarmaciaAdminUser] = useState("admin");
  const [newFarmaciaAdminPass, setNewFarmaciaAdminPass] = useState("");

  const [copiedRules, setCopiedRules] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Load farmacias directory for Super Admin
  useEffect(() => {
    if (isLocalFileMode || !isSuperAdmin) return;
    const unsub = onSnapshot(
      collection(db, "farmacias"),
      (snap) => {
        const list: FarmaciaTenant[] = [];
        snap.forEach((d) => {
          list.push({ ...(d.data() as FarmaciaTenant), id: d.id });
        });
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setFarmaciasList(list);
        localStorage.setItem("known_farmacias_directory", JSON.stringify(list));
      },
      (err) => {
        console.warn("No se pudo escuchar colección farmacias:", err?.code);
      }
    );
    return () => unsub();
  }, [isLocalFileMode, isSuperAdmin]);

  // Load Institutional Data for the currently selected client/sede
  useEffect(() => {
    if (selectedClientMode === "__nuevo__") {
      setInstNombre("");
      setInstRnc("");
      setInstTelefono("");
      setInstCorreo("");
      setInstWeb("");
      setInstDireccion("");
      setInstPiePagina("Documento de control interno de abastecimiento médico. Válido sin tachaduras ni enmiendas.");
      setInstLogoUrl("");
      setInstCamposExtra([]);
      setNewFarmaciaCode("");
      setNewFarmaciaAdminUser("admin");
      setNewFarmaciaAdminPass("");
      return;
    }

    const loadTargetInstitucion = async () => {
      if (isLocalFileMode) {
        const saved = localStorage.getItem("active_institucion_info");
        if (saved) {
          try {
            const data = JSON.parse(saved) as InstitucionInfo;
            populateInstFields(data);
            return;
          } catch {}
        }
        populateInstFields({
          nombre: "Suministros Hospitalarios • Dr. José Manuel Rodríguez"
        });
        return;
      }

      try {
        if (selectedClientMode !== DEFAULT_FARMACIA_ID) {
          setNewFarmaciaCode(selectedClientMode);
          const tenantMatch = farmaciasList.find((f) => f.id === selectedClientMode);
          if (tenantMatch?.adminUsuario) {
            setNewFarmaciaAdminUser(tenantMatch.adminUsuario);
          } else {
            const farmSnap = await getDoc(doc(db, "farmacias", selectedClientMode));
            if (farmSnap.exists()) {
              const fData = farmSnap.data() as FarmaciaTenant;
              setNewFarmaciaAdminUser(fData.adminUsuario || "admin");
            }
          }
          setNewFarmaciaAdminPass("");
        }

        const instSnap = await getDoc(tenantDoc("configuracion", "institucion", selectedClientMode));
        if (instSnap.exists()) {
          populateInstFields(instSnap.data() as InstitucionInfo);
          return;
        }
        if (selectedClientMode !== DEFAULT_FARMACIA_ID) {
          const tenantMatch = farmaciasList.find((f) => f.id === selectedClientMode);
          if (tenantMatch) {
            populateInstFields(tenantMatch);
            return;
          }
          const farmSnap = await getDoc(doc(db, "farmacias", selectedClientMode));
          if (farmSnap.exists()) {
            populateInstFields(farmSnap.data() as InstitucionInfo);
            return;
          }
        }
        populateInstFields({
          nombre:
            selectedClientMode === DEFAULT_FARMACIA_ID
              ? "Suministros Hospitalarios • Dr. José Manuel Rodríguez"
              : selectedClientMode
        });
      } catch (err) {
        console.warn("Error cargando datos de la institución:", err);
      }
    };

    loadTargetInstitucion();
  }, [selectedClientMode, isLocalFileMode]);

  const populateInstFields = (data: InstitucionInfo) => {
    setInstNombre(data.nombre || "");
    setInstRnc(data.rnc || "");
    setInstTelefono(data.telefono || "");
    setInstCorreo(data.correo || "");
    setInstWeb(data.paginaWeb || "");
    setInstDireccion(data.direccion || "");
    setInstPiePagina(data.piePagina || "");
    setInstLogoUrl(data.logoUrl || "");
    setInstCamposExtra(Array.isArray(data.camposExtra) ? data.camposExtra : []);
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2.5 * 1024 * 1024) {
      alert("El logotipo supera el tamaño máximo recomendado de 2.5 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      if (file.type === "image/svg+xml") {
        setInstLogoUrl(result);
        playSound("positive");
        return;
      }
      // Resize raster image cleanly so it fits comfortably in Firestore and PDF/Word headers
      const img = new Image();
      img.onload = () => {
        const maxDim = 360;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/png");
          setInstLogoUrl(dataUrl);
          playSound("positive");
        } else {
          setInstLogoUrl(result);
        }
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  };

  const handleAddCampoExtra = () => {
    setInstCamposExtra((prev) => [...prev, { etiqueta: "", valor: "" }]);
    playSound("click");
  };

  const handleUpdateCampoExtra = (idx: number, field: "etiqueta" | "valor", val: string) => {
    setInstCamposExtra((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: val } : item))
    );
  };

  const handleRemoveCampoExtra = (idx: number) => {
    setInstCamposExtra((prev) => prev.filter((_, i) => i !== idx));
    playSound("click");
  };

  const handleSaveInstitucionOrCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingInstitucion) return;

    const cleanNombre = instNombre.trim();
    if (!cleanNombre) {
      alert("El Nombre de la Institución / Empresa (Razón Social) es obligatorio.");
      return;
    }

    const cleanedExtras = instCamposExtra
      .map((c) => ({ etiqueta: c.etiqueta.trim(), valor: c.valor.trim() }))
      .filter((c) => c.etiqueta || c.valor);

    const instPayload: InstitucionInfo = {
      nombre: cleanNombre,
      subtitulo: instDireccion.trim() ? `${cleanNombre} • ${instDireccion.trim()}` : cleanNombre,
      rnc: instRnc.trim(),
      telefono: instTelefono.trim(),
      correo: instCorreo.trim(),
      paginaWeb: instWeb.trim(),
      direccion: instDireccion.trim(),
      piePagina: instPiePagina.trim(),
      logoUrl: instLogoUrl,
      camposExtra: cleanedExtras,
      updatedAt: Date.now()
    };

    // Case A: Creating a brand-new commercial pharmacy client
    if (selectedClientMode === "__nuevo__") {
      if (!isSuperAdmin) return;
      const cleanCode = normalizeFarmaciaId(newFarmaciaCode);
      const cleanAdmin = newFarmaciaAdminUser.trim() || "admin";
      const cleanPass = newFarmaciaAdminPass;

      if (!cleanCode || cleanCode === DEFAULT_FARMACIA_ID) {
        alert("Ingrese un Código de Farmacia (ID) único válido y distinto de 'principal'.");
        return;
      }
      if (!cleanPass) {
        alert("Ingrese la contraseña inicial para el Administrador de esta farmacia cliente.");
        return;
      }
      if (farmaciasList.some((f) => f.id === cleanCode)) {
        alert(`Ya existe una farmacia registrada con el código "${cleanCode}".`);
        return;
      }

      setSavingInstitucion(true);
      playSound("action");
      try {
        const passHash = await hashPassword(cleanPass);

        // 1. Provision user in Firebase Authentication
        await provisionUserInFirebaseAuth(cleanAdmin, passHash, cleanCode);

        // 2. Save master tenant document with full institutional profile
        const tenantData: FarmaciaTenant = {
          ...instPayload,
          id: cleanCode,
          activa: true,
          adminUsuario: cleanAdmin,
          createdAt: Date.now()
        };
        await setDoc(doc(db, "farmacias", cleanCode), tenantData);

        // 3. Save institutional config inside tenant's own configuracion/institucion
        await setDoc(tenantDoc("configuracion", "institucion", cleanCode), instPayload);

        // 4. Create initial admin user inside /farmacias/{cleanCode}/usuarios
        const adminDocId = `user-${cleanAdmin.toLowerCase()}`;
        const adminUserDoc: Usuario = {
          id: adminDocId,
          nombre: `Admin ${cleanNombre}`,
          usuario: cleanAdmin,
          contrasenaHash: passHash,
          rol: "Administrador",
          estado: "Activo",
          updatedAt: Date.now(),
          departamento: "Almacén y Suministro",
          modulos: ["inventory", "carga_masiva", "solicitudes", "historial", "usuarios", "configuracion"],
          farmaciaId: cleanCode
        };
        await setDoc(tenantDoc("usuarios", adminDocId, cleanCode), adminUserDoc);

        // 5. Create default catalog for the new client pharmacy
        await setDoc(tenantDoc("catalogos", "default-cat", cleanCode), {
          id: "default-cat",
          nombre: "Medicamentos e Insumos",
          descripcion: `Catálogo principal de ${cleanNombre}`,
          activo: true,
          createdAt: Date.now()
        });

        setSelectedClientMode(cleanCode);
        playSound("positive");
        showToast(`Cliente "${cleanNombre}" (código: ${cleanCode}) registrado con todos sus datos institucionales.`);
      } catch (err) {
        console.error("Error registrando cliente:", err);
        alert("Error al registrar la farmacia cliente. Verifica tu conexión y las reglas de Firestore.");
      } finally {
        setSavingInstitucion(false);
      }
      return;
    }

    // Case B: Updating existing institution (either current sede or a selected client pharmacy)
    setSavingInstitucion(true);
    playSound("action");
    try {
      const targetTenant = isSuperAdmin ? selectedClientMode : activeFarmaciaId;

      if (isLocalFileMode) {
        localStorage.setItem("active_institucion_info", JSON.stringify(instPayload));
        onUpdateInstitucion?.(instPayload);
      } else {
        await setDoc(tenantDoc("configuracion", "institucion", targetTenant), instPayload, { merge: true });

        if (targetTenant !== DEFAULT_FARMACIA_ID) {
          const cleanAdmin = newFarmaciaAdminUser.trim() || "admin";
          await setDoc(
            doc(db, "farmacias", targetTenant),
            {
              ...instPayload,
              id: targetTenant,
              adminUsuario: cleanAdmin
            },
            { merge: true }
          );

          // Si el SuperAdmin escribió una nueva contraseña para el administrador de esta farmacia, actualizarla
          if (isSuperAdmin && newFarmaciaAdminPass.trim()) {
            const passHash = await hashPassword(newFarmaciaAdminPass.trim());
            await provisionUserInFirebaseAuth(cleanAdmin, passHash, targetTenant);
            const adminDocId = `user-${cleanAdmin.toLowerCase()}`;
            const adminUserDoc: Usuario = {
              id: adminDocId,
              nombre: `Admin ${cleanNombre}`,
              usuario: cleanAdmin,
              contrasenaHash: passHash,
              rol: "Administrador",
              estado: "Activo",
              updatedAt: Date.now(),
              departamento: "Almacén y Suministro",
              modulos: ["inventory", "carga_masiva", "solicitudes", "historial", "usuarios", "configuracion"],
              farmaciaId: targetTenant
            };
            await setDoc(tenantDoc("usuarios", adminDocId, targetTenant), adminUserDoc, { merge: true });
            setNewFarmaciaAdminPass("");
          }
        }

        if (targetTenant === activeFarmaciaId) {
          localStorage.setItem("active_institucion_info", JSON.stringify(instPayload));
          onUpdateInstitucion?.(instPayload);
        }
      }

      playSound("positive");
      showToast(`Datos institucionales de "${cleanNombre}" guardados correctamente.`);
    } catch (err) {
      console.error("Error guardando datos de la institución:", err);
      alert("Error al guardar los datos de la institución.");
    } finally {
      setSavingInstitucion(false);
    }
  };

  const handleToggleFarmaciaActiva = async (f: FarmaciaTenant) => {
    if (!isSuperAdmin) return;
    playSound("click");
    try {
      const nextActiva = !f.activa;
      await updateDoc(doc(db, "farmacias", f.id), {
        activa: nextActiva,
        updatedAt: Date.now()
      });
      showToast(
        `Farmacia "${f.nombre}" ${nextActiva ? "reactivada" : "suspendida temporalmente"}.`
      );
    } catch (err) {
      console.error(err);
      alert("No se pudo cambiar el estado de la farmacia.");
    }
  };

  const handleCopyRules = async () => {
    try {
      await navigator.clipboard.writeText(FIRESTORE_SECURITY_RULES_TEXT);
      setCopiedRules(true);
      showToast("Reglas de Firestore copiadas al portapapeles.");
      setTimeout(() => setCopiedRules(false), 2500);
    } catch {
      alert("No se pudo copiar automáticamente.");
    }
  };

  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newDeptName.trim();
    if (!name) return;

    if (departamentos.some(d => d.nombre.toLowerCase() === name.toLowerCase())) {
      alert("Ya existe un departamento con ese nombre.");
      return;
    }

    setCreatingDept(true);
    playSound("action");

    try {
      const id = `dept-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now().toString(36)}`;
      const newDept: Departamento = {
        id,
        nombre: name,
        activo: true,
        createdAt: Date.now()
      };

      if (isLocalFileMode) {
        const stored = localStorage.getItem("offline_departamentos");
        let list: Departamento[] = [];
        if (stored) {
          try { list = JSON.parse(stored); } catch (e) {}
        }
        list.push(newDept);
        localStorage.setItem("offline_departamentos", JSON.stringify(list));
        window.dispatchEvent(new Event("offline_departamentos_update"));
      } else {
        const colRef = tenantCollection("departamentos");
        await setDoc(doc(colRef, id), newDept);
      }

      setNewDeptName("");
      playSound("positive");
      showToast(`Departamento "${name}" creado con éxito.`);
    } catch (err) {
      console.error("Error creating department:", err);
      alert("Error al crear el departamento.");
    } finally {
      setCreatingDept(false);
    }
  };

  const handleEditDeptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDept) return;
    const name = editDeptName.trim();
    if (!name) return;

    if (departamentos.some(d => d.id !== editingDept.id && d.nombre.toLowerCase() === name.toLowerCase())) {
      alert("Ya existe otro departamento con ese nombre.");
      return;
    }

    setUpdatingDept(true);
    playSound("action");

    try {
      if (isLocalFileMode) {
        const stored = localStorage.getItem("offline_departamentos");
        let list: Departamento[] = [];
        if (stored) {
          try { list = JSON.parse(stored); } catch (e) {}
        }
        list = list.map(d => d.id === editingDept.id ? { ...d, nombre: name } : d);
        localStorage.setItem("offline_departamentos", JSON.stringify(list));
        window.dispatchEvent(new Event("offline_departamentos_update"));
      } else {
        const docRef = tenantDoc("departamentos", editingDept.id);
        await updateDoc(docRef, { nombre: name });
      }

      setEditingDept(null);
      playSound("positive");
      showToast("Nombre del departamento actualizado.");
    } catch (err) {
      console.error("Error editing department:", err);
      alert("Error al actualizar el departamento.");
    } finally {
      setUpdatingDept(false);
    }
  };

  const handleToggleDeptActive = async (dept: Departamento) => {
    playSound("click");
    try {
      const nextActive = !dept.activo;
      if (isLocalFileMode) {
        const stored = localStorage.getItem("offline_departamentos");
        let list: Departamento[] = [];
        if (stored) {
          try { list = JSON.parse(stored); } catch (e) {}
        }
        list = list.map(d => d.id === dept.id ? { ...d, activo: nextActive } : d);
        localStorage.setItem("offline_departamentos", JSON.stringify(list));
        window.dispatchEvent(new Event("offline_departamentos_update"));
      } else {
        const docRef = tenantDoc("departamentos", dept.id);
        await updateDoc(docRef, { activo: nextActive });
      }
      showToast(`Departamento "${dept.nombre}" ${nextActive ? "activado" : "desactivado"}.`);
    } catch (err) {
      console.error("Error toggling department state:", err);
      alert("Error al cambiar el estado del departamento.");
    }
  };

  const handleCreateCatalog = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCatName.trim();
    const desc = newCatDesc.trim();
    if (!name) return;

    if (catalogos.some(c => c.nombre.toLowerCase() === name.toLowerCase())) {
      alert("Ya existe un catálogo con ese nombre.");
      return;
    }

    setCreatingCat(true);
    playSound("action");

    try {
      const id = `cat-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now().toString(36)}`;
      const newCat: Catalogo = {
        id,
        nombre: name,
        descripcion: desc,
        activo: true,
        createdAt: Date.now()
      };

      if (isLocalFileMode) {
        const stored = localStorage.getItem("offline_catalogos");
        let list: Catalogo[] = [];
        if (stored) {
          try { list = JSON.parse(stored); } catch (e) {}
        }
        list.push(newCat);
        localStorage.setItem("offline_catalogos", JSON.stringify(list));
        window.dispatchEvent(new Event("offline_catalogos_update"));
      } else {
        const colRef = tenantCollection("catalogos");
        await setDoc(doc(colRef, id), newCat);
      }

      setNewCatName("");
      setNewCatDesc("");
      playSound("positive");
      showToast(`Catálogo "${name}" creado con éxito.`);
    } catch (err) {
      console.error("Error creating catalog:", err);
      alert("Error al crear el catálogo.");
    } finally {
      setCreatingCat(false);
    }
  };

  const handleEditCatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCat) return;
    const name = editCatName.trim();
    const desc = editCatDesc.trim();
    if (!name) return;

    if (catalogos.some(c => c.id !== editingCat.id && c.nombre.toLowerCase() === name.toLowerCase())) {
      alert("Ya existe otro catálogo con ese nombre.");
      return;
    }

    setUpdatingCat(true);
    playSound("action");

    try {
      if (isLocalFileMode) {
        const stored = localStorage.getItem("offline_catalogos");
        let list: Catalogo[] = [];
        if (stored) {
          try { list = JSON.parse(stored); } catch (e) {}
        }
        list = list.map(c => c.id === editingCat.id ? { ...c, nombre: name, descripcion: desc, updatedAt: Date.now() } : c);
        localStorage.setItem("offline_catalogos", JSON.stringify(list));
        window.dispatchEvent(new Event("offline_catalogos_update"));
      } else {
        const docRef = tenantDoc("catalogos", editingCat.id);
        await updateDoc(docRef, {
          nombre: name,
          descripcion: desc,
          updatedAt: Date.now()
        });
      }

      setEditingCat(null);
      playSound("positive");
      showToast("Catálogo actualizado.");
    } catch (err) {
      console.error("Error updating catalog:", err);
      alert("Error al actualizar el catálogo.");
    } finally {
      setUpdatingCat(false);
    }
  };

  const handleToggleCatActive = async (cat: Catalogo) => {
    if (cat.id === "default-cat") {
      alert("No se puede desactivar el catálogo predeterminado.");
      return;
    }
    playSound("click");
    try {
      const nextActive = !cat.activo;
      if (isLocalFileMode) {
        const stored = localStorage.getItem("offline_catalogos");
        let list: Catalogo[] = [];
        if (stored) {
          try { list = JSON.parse(stored); } catch (e) {}
        }
        list = list.map(c => c.id === cat.id ? { ...c, activo: nextActive } : c);
        localStorage.setItem("offline_catalogos", JSON.stringify(list));
        window.dispatchEvent(new Event("offline_catalogos_update"));
      } else {
        const docRef = tenantDoc("catalogos", cat.id);
        await updateDoc(docRef, { activo: nextActive });
      }

      playSound("positive");
      showToast(`Catálogo "${cat.nombre}" ${nextActive ? "activado" : "desactivado"}.`);
    } catch (err) {
      console.error("Error toggling catalog active status:", err);
      alert("Error al cambiar estado del catálogo.");
    }
  };

  const handleDeleteCat = async (cat: Catalogo) => {
    if (cat.id === "default-cat") {
      alert("No se puede eliminar el catálogo predeterminado.");
      return;
    }
    const confirmed = window.confirm(`¿Está seguro de que desea eliminar permanentemente el catálogo "${cat.nombre}"? Todos los productos de este catálogo dejarán de estar accesibles. Esta acción es irreversible.`);
    if (!confirmed) return;

    playSound("action");
    try {
      if (isLocalFileMode) {
        const stored = localStorage.getItem("offline_catalogos");
        let list: Catalogo[] = [];
        if (stored) {
          try { list = JSON.parse(stored); } catch (e) {}
        }
        list = list.filter(c => c.id !== cat.id);
        localStorage.setItem("offline_catalogos", JSON.stringify(list));
        window.dispatchEvent(new Event("offline_catalogos_update"));
      } else {
        const docRef = tenantDoc("catalogos", cat.id);
        await deleteDoc(docRef);
      }

      playSound("positive");
      showToast(`Catálogo "${cat.nombre}" eliminado permanentemente.`);
    } catch (err) {
      console.error("Error deleting catalog:", err);
      alert("Error al eliminar el catálogo.");
    }
  };

  // --- Conceptos de Facturación Handlers ---
  const persistConceptosList = async (nextList: ConceptoFactura[]) => {
    if (onUpdateConceptos) {
      onUpdateConceptos(nextList);
    }
    if (isLocalFileMode) {
      localStorage.setItem("offline_conceptos_venta", JSON.stringify(nextList));
      window.dispatchEvent(new Event("offline_conceptos_update"));
    } else {
      const docRef = tenantDoc("configuracion", "conceptos_venta");
      await setDoc(docRef, { items: nextList, updatedAt: Date.now() }, { merge: true });
    }
  };

  const handleCreateConcepto = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newConceptoName.trim();
    const desc = newConceptoDesc.trim();
    if (!name) return;

    const currentList = conceptos.length > 0 ? conceptos : DEFAULT_CONCEPTOS_FACTURA;
    if (currentList.some((c) => c.nombre.toLowerCase() === name.toLowerCase())) {
      alert("Ya existe un concepto de facturación con ese nombre.");
      return;
    }

    setCreatingConcepto(true);
    playSound("action");

    try {
      const id = `concepto-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now().toString(36)}`;
      const newConcepto: ConceptoFactura = {
        id,
        nombre: name,
        descripcion: desc,
        activo: true,
        createdAt: Date.now()
      };

      const nextList = [...currentList, newConcepto];
      await persistConceptosList(nextList);

      setNewConceptoName("");
      setNewConceptoDesc("");
      playSound("positive");
      showToast(`Concepto "${name}" creado exitosamente.`);
    } catch (err) {
      console.error("Error creating concepto:", err);
      alert("Error al crear el concepto de facturación.");
    } finally {
      setCreatingConcepto(false);
    }
  };

  const handleEditConceptoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingConcepto) return;
    const name = editConceptoName.trim();
    const desc = editConceptoDesc.trim();
    if (!name) return;

    const currentList = conceptos.length > 0 ? conceptos : DEFAULT_CONCEPTOS_FACTURA;
    if (currentList.some((c) => c.id !== editingConcepto.id && c.nombre.toLowerCase() === name.toLowerCase())) {
      alert("Ya existe otro concepto con ese nombre.");
      return;
    }

    setUpdatingConcepto(true);
    playSound("action");

    try {
      const nextList = currentList.map((c) =>
        c.id === editingConcepto.id
          ? { ...c, nombre: name, descripcion: desc, updatedAt: Date.now() }
          : c
      );
      await persistConceptosList(nextList);

      setEditingConcepto(null);
      playSound("positive");
      showToast("Concepto de facturación actualizado.");
    } catch (err) {
      console.error("Error updating concepto:", err);
      alert("Error al actualizar el concepto.");
    } finally {
      setUpdatingConcepto(false);
    }
  };

  const handleToggleConceptoActive = async (item: ConceptoFactura) => {
    playSound("click");
    try {
      const currentList = conceptos.length > 0 ? conceptos : DEFAULT_CONCEPTOS_FACTURA;
      const nextActive = !item.activo;
      const activeRemaining = currentList.filter((c) => (c.id === item.id ? nextActive : c.activo));
      if (activeRemaining.length === 0) {
        alert("Debe mantener al menos un concepto de facturación activo.");
        return;
      }

      const nextList = currentList.map((c) =>
        c.id === item.id ? { ...c, activo: nextActive, updatedAt: Date.now() } : c
      );
      await persistConceptosList(nextList);

      playSound("positive");
      showToast(`Concepto "${item.nombre}" ${nextActive ? "activado" : "desactivado"}.`);
    } catch (err) {
      console.error("Error toggling concepto active status:", err);
      alert("Error al cambiar el estado del concepto.");
    }
  };

  const handleDeleteConcepto = async (item: ConceptoFactura) => {
    const currentList = conceptos.length > 0 ? conceptos : DEFAULT_CONCEPTOS_FACTURA;
    if (currentList.length <= 1) {
      alert("Debe existir al menos un concepto de facturación en el sistema.");
      return;
    }

    const confirmed = window.confirm(
      `¿Está seguro de que desea eliminar el concepto "${item.nombre}"? Las facturas ya emitidas conservarán su concepto histórico.`
    );
    if (!confirmed) return;

    playSound("action");
    try {
      const nextList = currentList.filter((c) => c.id !== item.id);
      await persistConceptosList(nextList);

      playSound("positive");
      showToast(`Concepto "${item.nombre}" eliminado.`);
    } catch (err) {
      console.error("Error deleting concepto:", err);
      alert("Error al eliminar el concepto.");
    }
  };

  useEffect(() => {
    setLocalColores({ ...colores });
  }, [colores]);

  const handleColorChange = (key: keyof ColoresConfig, value: string) => {
    setLocalColores((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const handleApplyPreset = (presetColors: ColoresConfig) => {
    playSound("click");
    setLocalColores({ ...presetColors });
  };

  const handleSaveColores = async () => {
    if (!isAnyer) {
      alert("Solo el Administrador tiene permisos para modificar la configuración de colores.");
      return;
    }

    setSavingColores(true);
    playSound("action");

    try {
      const docRef = tenantDoc("configuracion", "colores");
      await setDoc(docRef, { colores: localColores });

      localStorage.setItem("colores_config", JSON.stringify(localColores));

      onUpdateColores(localColores);
      playSound("positive");
      showToast("La configuración de colores ha sido guardada y aplicada.");
    } catch (err) {
      console.error("Error saving colors:", err);
      alert("Error al guardar la configuración de colores.");
    } finally {
      setSavingColores(false);
    }
  };

  const handleCerrarMes = async () => {
    if (!isAnyer) {
      alert("Solo el Administrador tiene permisos para efectuar el cierre del mes.");
      return;
    }

    const confirmMessage = `¿Estás seguro de que deseas cerrar el período mensual actual ("${activePeriod}")?\n\nEsto abrirá automáticamente el nuevo período, desmarcará los checks de Ajustado y Verificado en los productos, y conservará todos los registros históricos de suministros, lotes, movimientos y solicitudes intactos para auditoría futura.`;
    
    if (!confirm(confirmMessage)) return;

    setClosingMonth(true);
    playSound("action");

    try {
      const querySnapshot = await getDocs(tenantCollection("productos"));
      const batch = writeBatch(db);
      let updatedCount = 0;

      querySnapshot.forEach((productDoc) => {
        const prod = productDoc.data() as Producto;
        let modified = false;
        let newVerificado = prod.verificado;

        if (prod.verificado) {
          newVerificado = false;
          modified = true;
        }

        const newLotes = (prod.lotes || []).map((l) => {
          if (l.articuloAjustado) {
            modified = true;
            return { ...l, articuloAjustado: false };
          }
          return l;
        });

        if (modified) {
          batch.update(productDoc.ref, {
            verificado: newVerificado,
            lotes: newLotes,
            updatedAt: Date.now()
          });
          updatedCount++;
        }
      });

      if (updatedCount > 0) {
        await batch.commit();
      }

      const parts = activePeriod.split(" ");
      let monthIndex = MESES.indexOf(parts[0]);
      let year = parseInt(parts[1], 10);

      if (monthIndex === -1 || isNaN(year)) {
        const now = new Date();
        monthIndex = now.getMonth();
        year = now.getFullYear();
      }

      monthIndex++;
      if (monthIndex > 11) {
        monthIndex = 0;
        year++;
      }

      const nextPeriod = `${MESES[monthIndex]} ${year}`;

      const docRef = tenantDoc("configuracion", "periodo");
      await setDoc(docRef, { periodoActual: nextPeriod });

      localStorage.setItem("periodo_actual", nextPeriod);

      onUpdatePeriod(nextPeriod);
      playSound("positive");
      showToast(`¡Cierre de mes completado! El nuevo período activo es "${nextPeriod}".`);
    } catch (err) {
      console.error("Error during closing:", err);
      alert("Error al efectuar el cierre del período mensual.");
    } finally {
      setClosingMonth(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* =====================================================================
          TARJETA IMAGEN 1: INSTITUCIÓN / EMPRESA & COMERCIALIZACIÓN POR CLIENTE
         ===================================================================== */}
      <div className="bg-white rounded-3xl p-6 sm:p-7 border border-slate-200 shadow-sm space-y-6 anim-card-in">
        {/* Cabecera Exacta de Imagen 1 */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2.5">
              <Building2 className="w-5 h-5 text-teal-600 shrink-0" />
              <span>Institución / Empresa</span>
            </h3>
            <p className="text-slate-500 text-xs mt-1 font-medium">
              Administre la información institucional y el logotipo oficial que se incluirá en las facturas y comprobantes exportados en PDF y Word.
            </p>
          </div>
          <span className="text-[10px] uppercase font-black tracking-wider bg-teal-50/80 text-teal-700 px-3.5 py-1.5 rounded-full border border-teal-200 self-start shrink-0">
            ENCABEZADOS Y FACTURAS
          </span>
        </div>

        {/* Barra de Comercialización (Solo visible para SuperAdmin en sede principal) */}
        {isSuperAdmin && (
          <div className="bg-slate-50/90 border border-slate-200/80 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-teal-700 block">
                Comercialización • Selector de Farmacia / Cliente
              </span>
              <p className="text-xs text-slate-500 font-medium">
                Selecciona una farmacia para editar sus datos fiscales o registra un nuevo cliente comercial aislado.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedClientMode}
                onChange={(e) => {
                  setSelectedClientMode(e.target.value);
                  playSound("click");
                }}
                className="bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-teal-400 cursor-pointer"
              >
                <option value="principal">🏥 Sede Principal (Dr. José Manuel Rodríguez)</option>
                {farmaciasList.map((f) => (
                  <option key={f.id} value={f.id}>
                    🏪 {f.nombre} ({f.id}) {!f.activa ? "• [Suspendida]" : ""}
                  </option>
                ))}
                <option value="__nuevo__">➕ Registrar Nueva Farmacia / Cliente...</option>
              </select>

              <button
                type="button"
                onClick={() => {
                  setSelectedClientMode("__nuevo__");
                  playSound("open");
                }}
                className={`px-3.5 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer ${
                  selectedClientMode === "__nuevo__"
                    ? "bg-teal-700 text-white shadow-xs"
                    : "bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100"
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nuevo Cliente</span>
              </button>

              {selectedClientMode !== "principal" && selectedClientMode !== "__nuevo__" && onSwitchFarmacia && (
                <button
                  type="button"
                  onClick={() => onSwitchFarmacia(selectedClientMode, instNombre || selectedClientMode)}
                  className="px-3.5 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white shadow-xs transition cursor-pointer"
                >
                  <Building2 className="w-3.5 h-3.5" />
                  <span>Entrar a esta Farmacia</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Formulario Imagen 1 */}
        <form onSubmit={handleSaveInstitucionOrCreateClient} className="space-y-6">
          {/* Si se está creando o editando un cliente comercial, mostrar Código de Sede y Credenciales de su Admin */}
          {isSuperAdmin && selectedClientMode !== "principal" && (
            <div className="bg-teal-50/50 border border-teal-200/80 rounded-2xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-teal-800">
                  <UserCheck className="w-4 h-4 text-teal-600" />
                  <span>
                    {selectedClientMode === "__nuevo__"
                      ? "Credenciales de Acceso Aislado para el Nuevo Cliente"
                      : `Credenciales del Usuario de Inicio • Sede: ${selectedClientMode}`}
                  </span>
                </div>
                {selectedClientMode !== "__nuevo__" && (
                  <span className="text-[11px] font-semibold text-teal-700">
                    Para cambiar la clave del usuario administrador de esta farmacia, escribe una nueva abajo y pulsa Guardar.
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1">
                    CÓDIGO DE FARMACIA / SEDE (ID) *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={selectedClientMode !== "__nuevo__"}
                    value={selectedClientMode === "__nuevo__" ? newFarmaciaCode : selectedClientMode}
                    onChange={(e) => setNewFarmaciaCode(e.target.value)}
                    placeholder="Ej: farmacia-san-juan"
                    className="w-full bg-white disabled:bg-slate-100 rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-mono font-bold text-slate-800 outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1">
                    USUARIO ADMINISTRADOR INICIAL *
                  </label>
                  <input
                    type="text"
                    required
                    value={newFarmaciaAdminUser}
                    onChange={(e) => setNewFarmaciaAdminUser(e.target.value)}
                    placeholder="Ej: admin"
                    className="w-full bg-white rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1">
                    {selectedClientMode === "__nuevo__"
                      ? "CONTRASEÑA INICIAL DEL CLIENTE *"
                      : "NUEVA CONTRASEÑA (OPCIONAL)"}
                  </label>
                  <input
                    type="password"
                    required={selectedClientMode === "__nuevo__"}
                    value={newFarmaciaAdminPass}
                    onChange={(e) => setNewFarmaciaAdminPass(e.target.value)}
                    placeholder={
                      selectedClientMode === "__nuevo__"
                        ? "Contraseña de entrega"
                        : "Dejar vacío para conservar actual"
                    }
                    className="w-full bg-white rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Grid Principal de 2 Columnas (Diseño Exacto Imagen 1) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Columna Izquierda (7 cols): Campos Institucionales */}
            <div className="lg:col-span-7 space-y-4">
              {/* NOMBRE DE LA INSTITUCIÓN / EMPRESA * */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-600 tracking-wider mb-1.5">
                  <Building2 className="w-3.5 h-3.5 text-teal-600" />
                  <span>NOMBRE DE LA INSTITUCIÓN / EMPRESA</span>
                  <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={instNombre}
                  onChange={(e) => setInstNombre(e.target.value)}
                  placeholder="Ej: Suministros Hospitalarios • Dr. José Manuel Rodríguez"
                  className="w-full bg-slate-50/70 rounded-xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-400 transition"
                />
              </div>

              {/* Fila: RNC / NIT / ID FISCAL + TELÉFONO */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-600 tracking-wider mb-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-teal-600" />
                    <span>RNC / NIT / ID FISCAL</span>
                  </label>
                  <input
                    type="text"
                    value={instRnc}
                    onChange={(e) => setInstRnc(e.target.value)}
                    placeholder="Ej: 1-01-00000-0 o NIT"
                    className="w-full bg-slate-50/70 rounded-xl border border-slate-200 px-4 py-3 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-400 transition"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-600 tracking-wider mb-1.5">
                    <Phone className="w-3.5 h-3.5 text-teal-600" />
                    <span>TELÉFONO</span>
                  </label>
                  <input
                    type="text"
                    value={instTelefono}
                    onChange={(e) => setInstTelefono(e.target.value)}
                    placeholder="Ej: (809) 555-0199"
                    className="w-full bg-slate-50/70 rounded-xl border border-slate-200 px-4 py-3 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-400 transition"
                  />
                </div>
              </div>

              {/* Fila: CORREO ELECTRÓNICO + PÁGINA WEB */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-600 tracking-wider mb-1.5">
                    <Mail className="w-3.5 h-3.5 text-teal-600" />
                    <span>CORREO ELECTRÓNICO</span>
                  </label>
                  <input
                    type="email"
                    value={instCorreo}
                    onChange={(e) => setInstCorreo(e.target.value)}
                    placeholder="Ej: suministros@hospital.gob.do"
                    className="w-full bg-slate-50/70 rounded-xl border border-slate-200 px-4 py-3 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-400 transition"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-600 tracking-wider mb-1.5">
                    <Globe className="w-3.5 h-3.5 text-teal-600" />
                    <span>PÁGINA WEB</span>
                  </label>
                  <input
                    type="text"
                    value={instWeb}
                    onChange={(e) => setInstWeb(e.target.value)}
                    placeholder="Ej: www.hospital.gob.do"
                    className="w-full bg-slate-50/70 rounded-xl border border-slate-200 px-4 py-3 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-400 transition"
                  />
                </div>
              </div>

              {/* DIRECCIÓN FÍSICA / SEDE */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-600 tracking-wider mb-1.5">
                  <MapPin className="w-3.5 h-3.5 text-teal-600" />
                  <span>DIRECCIÓN FÍSICA / SEDE</span>
                </label>
                <input
                  type="text"
                  value={instDireccion}
                  onChange={(e) => setInstDireccion(e.target.value)}
                  placeholder="Ej: Av. Principal Esq. Calle Central #10, Santo Domingo"
                  className="w-full bg-slate-50/70 rounded-xl border border-slate-200 px-4 py-3 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-400 transition"
                />
              </div>

              {/* INFORMACIÓN ADICIONAL (PIE DE PÁGINA DE FACTURAS) */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-600 tracking-wider mb-1.5">
                  <FileText className="w-3.5 h-3.5 text-teal-600" />
                  <span>INFORMACIÓN ADICIONAL (PIE DE PÁGINA DE FACTURAS)</span>
                </label>
                <textarea
                  rows={2}
                  value={instPiePagina}
                  onChange={(e) => setInstPiePagina(e.target.value)}
                  placeholder="Ej: Documento de control interno de abastecimiento médico. Válido sin tachaduras ni enmiendas."
                  className="w-full bg-slate-50/70 rounded-xl border border-slate-200 px-4 py-3 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-400 transition resize-none"
                />
              </div>

              {/* DATOS VARIABLES PERSONALIZADOS POR CLIENTE */}
              <div className="pt-2 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11px] font-black uppercase text-slate-500 tracking-wider">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-teal-600" />
                    <span>Datos Variables Adicionales por Cliente (Opcional)</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleAddCampoExtra}
                    className="text-[11px] font-extrabold text-teal-700 hover:text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-200 px-2.5 py-1 rounded-lg flex items-center gap-1 transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Añadir Campo</span>
                  </button>
                </div>

                {instCamposExtra.map((campo, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={campo.etiqueta}
                      onChange={(e) => handleUpdateCampoExtra(idx, "etiqueta", e.target.value)}
                      placeholder="Etiqueta (Ej: Reg. Sanitario, Sucursal)"
                      className="w-2/5 bg-slate-50 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:ring-2 focus:ring-teal-400"
                    />
                    <input
                      type="text"
                      value={campo.valor}
                      onChange={(e) => handleUpdateCampoExtra(idx, "valor", e.target.value)}
                      placeholder="Valor del cliente"
                      className="flex-1 bg-slate-50 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-400"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveCampoExtra(idx)}
                      className="p-2 text-slate-400 hover:text-rose-600 rounded-lg transition cursor-pointer"
                      title="Eliminar campo"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Columna Derecha (5 cols): Tarjeta LOGOTIPO INSTITUCIONAL (Imagen 1) */}
            <div className="lg:col-span-5 bg-slate-50/70 rounded-2xl p-5 border border-slate-200/80 space-y-4">
              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-black uppercase text-slate-700 tracking-wider">
                  <ImageIcon className="w-4 h-4 text-teal-600" />
                  <span>LOGOTIPO INSTITUCIONAL</span>
                </h4>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Se integrará en la cabecera superior de cada factura exportada en PDF y Word sin deformaciones.
                </p>
              </div>

              <PhotoCaptureField
                currentImageUrl={instLogoUrl || undefined}
                onConfirmImage={(dataUrl) => {
                  setInstLogoUrl(dataUrl);
                  showToast("Logotipo confirmado. Pulsa Guardar Datos de la Institución para aplicar.");
                  playSound("positive");
                }}
                onDeleteImage={() => {
                  setInstLogoUrl("");
                  playSound("negative");
                }}
                onPendingChange={(pendingUrl) => {
                  if (pendingUrl) {
                    setInstLogoUrl(pendingUrl);
                  }
                }}
                placeholderText="Sin logotipo asignado. Toma una foto o selecciona una imagen desde tu dispositivo"
                helperText="Formatos recomendados: PNG, SVG o foto nítida (máx. 2.5 MB)."
                heightClass="h-44"
                objectFit="contain"
                preserveSvg={true}
                maxDimension={360}
              />
            </div>
          </div>

          {/* Botón Inferior Derecho (Exacto a Imagen 1) */}
          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button
              type="submit"
              disabled={savingInstitucion}
              className="w-full sm:w-auto px-6 py-3.5 bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition active:scale-95 shadow-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>
                {savingInstitucion
                  ? "Guardando..."
                  : selectedClientMode === "__nuevo__"
                  ? "REGISTRAR CLIENTE Y GUARDAR INSTITUCIÓN"
                  : "GUARDAR DATOS DE LA INSTITUCIÓN"}
              </span>
            </button>
          </div>
        </form>

        {/* Listado Resumen de Farmacias Comercializadas (Solo para SuperAdmin) */}
        {isSuperAdmin && farmaciasList.length > 0 && (
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">
              Clientes / Farmacias Registradas ({farmaciasList.length})
            </h4>
            <div className="overflow-x-auto border border-slate-200 rounded-2xl bg-slate-50">
              <table className="min-w-[680px] w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Código Sede</th>
                    <th className="px-4 py-3">Institución / Razón Social</th>
                    <th className="px-4 py-3">RNC / Teléfono</th>
                    <th className="px-4 py-3">Admin</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs bg-white">
                  {farmaciasList.map((f) => (
                    <tr key={f.id} className="hover:bg-slate-50/70 transition">
                      <td className="px-4 py-3 font-mono font-bold text-teal-700">{f.id}</td>
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-800">{f.nombre}</p>
                        {f.direccion && <p className="text-[10px] text-slate-400">{f.direccion}</p>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {f.rnc && <span className="block font-mono text-[11px]">RNC: {f.rnc}</span>}
                        {f.telefono && <span className="block text-[11px] text-slate-500">{f.telefono}</span>}
                        {!f.rnc && !f.telefono && <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600">{f.adminUsuario}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleToggleFarmaciaActiva(f)}
                          className={`inline-flex items-center gap-1.5 text-xs font-black px-3 py-1 rounded-full transition cursor-pointer ${
                            f.activa
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-rose-50 text-rose-700 border border-rose-200"
                          }`}
                        >
                          {f.activa ? (
                            <>
                              <ToggleRight className="w-4 h-4 text-emerald-600" />
                              Activa
                            </>
                          ) : (
                            <>
                              <ToggleLeft className="w-4 h-4 text-rose-500" />
                              Suspendida
                            </>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {onSwitchFarmacia && (
                            <button
                              type="button"
                              onClick={() => onSwitchFarmacia(f.id, f.nombre)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 transition cursor-pointer shadow-2xs"
                            >
                              <Building2 className="w-3.5 h-3.5" />
                              <span>Entrar a Sede</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedClientMode(f.id);
                              playSound("click");
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 transition cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Editar Ficha</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(
                                `Acceso Control de Stock\nInstitución: ${f.nombre}\nCódigo de Farmacia: ${f.id}\nUsuario: ${f.adminUsuario}`
                              );
                              showToast(`Datos de acceso de "${f.nombre}" copiados.`);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 hover:bg-slate-50 transition cursor-pointer text-slate-700"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copiar</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Tarjeta de Gestión de Departamentos */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6 anim-card-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-3">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Building className="w-5 h-5 text-teal-600" />
            Gestión de Departamentos
          </h3>
          <span className="text-[10px] uppercase font-black tracking-wider bg-teal-50 text-teal-700 px-3 py-1 rounded-full border border-teal-200 self-start sm:self-auto">
            Configuración del Sistema
          </span>
        </div>

        <form onSubmit={handleCreateDept} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end bg-slate-50 p-4 rounded-2xl border border-slate-200/60">
          <div className="sm:col-span-2 space-y-1.5">
            <label className="block text-xs font-black uppercase text-slate-500 tracking-wider">
              Nuevo Departamento
            </label>
            <input
              type="text"
              required
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
              placeholder="Ej. Cardiología, Recursos Humanos"
              className="w-full bg-white rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 font-semibold"
            />
          </div>
          <button
            type="submit"
            disabled={creatingDept}
            className="w-full px-5 py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition active:scale-95 shadow-sm flex items-center justify-center gap-2 cursor-pointer h-[44px]"
          >
            <Plus className="w-4 h-4" />
            Crear Departamento
          </button>
        </form>

        <div className="space-y-3">
          <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">
            Listado de Departamentos Registrados
          </h4>
          
          <div className="overflow-x-auto border border-slate-200 rounded-2xl bg-slate-50">
            <table className="min-w-[500px] w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {departamentos.map((dept) => {
                  const isEditing = editingDept?.id === dept.id;
                  return (
                    <tr key={dept.id} className="hover:bg-slate-50/50 bg-white transition">
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {isEditing ? (
                          <form onSubmit={handleEditDeptSubmit} className="flex gap-2 max-w-sm" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              required
                              value={editDeptName}
                              onChange={(e) => setEditDeptName(e.target.value)}
                              className="bg-white rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-teal-400 w-full"
                            />
                            <button
                              type="submit"
                              disabled={updatingDept}
                              className="px-3 py-1.5 bg-teal-600 text-white font-bold text-xs rounded-lg hover:bg-teal-700 transition"
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingDept(null)}
                              className="px-3 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 font-bold text-xs rounded-lg hover:bg-slate-200 transition"
                            >
                              Cancelar
                            </button>
                          </form>
                        ) : (
                          <span>{dept.nombre}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleDeptActive(dept)}
                          className={`inline-flex items-center gap-1.5 text-xs font-black px-3 py-1 rounded-full transition cursor-pointer ${
                            dept.activo
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-rose-50 text-rose-700 border border-rose-200"
                          }`}
                        >
                          {dept.activo ? (
                            <>
                              <ToggleRight className="w-4 h-4 text-emerald-600" />
                              Activo
                            </>
                          ) : (
                            <>
                              <ToggleLeft className="w-4 h-4 text-rose-500" />
                              Inactivo
                            </>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => {
                            setEditingDept(dept);
                            setEditDeptName(dept.nombre);
                            playSound("click");
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 hover:bg-slate-50 transition active:scale-95 cursor-pointer text-slate-700"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Editar</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {departamentos.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-slate-400 font-medium">
                      No hay departamentos registrados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Tarjeta de Gestión de Multi-Catálogos */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6 anim-card-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-3">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Layers className="w-5 h-5 text-teal-600" />
            Gestión de Multi-Catálogos (Inventarios Independientes)
          </h3>
          <span className="text-[10px] uppercase font-black tracking-wider bg-teal-50 text-teal-700 px-3 py-1 rounded-full border border-teal-200 self-start sm:self-auto">
            Módulos de Negocio
          </span>
        </div>

        <form onSubmit={handleCreateCatalog} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end bg-slate-50 p-4 rounded-2xl border border-slate-200/60">
          <div className="space-y-1.5 md:col-span-1">
            <label className="block text-xs font-black uppercase text-slate-500 tracking-wider">
              Nombre del Catálogo *
            </label>
            <input
              type="text"
              required
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Ej. Odontología, Laboratorio"
              className="w-full bg-white rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 font-semibold"
            />
          </div>
          <div className="space-y-1.5 md:col-span-1">
            <label className="block text-xs font-black uppercase text-slate-500 tracking-wider">
              Descripción corta
            </label>
            <input
              type="text"
              value={newCatDesc}
              onChange={(e) => setNewCatDesc(e.target.value)}
              placeholder="Ej. Insumos y equipos de salud dental"
              className="w-full bg-white rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 font-semibold"
            />
          </div>
          <button
            type="submit"
            disabled={creatingCat}
            className="w-full px-5 py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-300 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition active:scale-95 shadow-sm flex items-center justify-center gap-2 cursor-pointer h-[44px]"
          >
            <Plus className="w-4 h-4" />
            Crear Catálogo
          </button>
        </form>

        <div className="space-y-3">
          <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">
            Listado de Catálogos del Sistema
          </h4>
          
          <div className="overflow-x-auto border border-slate-200 rounded-2xl bg-slate-50">
            <table className="min-w-[600px] w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">Descripción</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {catalogos.map((cat) => {
                  const isEditing = editingCat?.id === cat.id;
                  return (
                    <tr key={cat.id} className="hover:bg-slate-50/50 bg-white transition">
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {isEditing ? (
                          <input
                            type="text"
                            required
                            value={editCatName}
                            onChange={(e) => setEditCatName(e.target.value)}
                            className="bg-white rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-teal-400 w-full"
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            <span>{cat.nombre}</span>
                            {cat.id === "default-cat" && (
                              <span className="text-[9px] uppercase font-black px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                                Por defecto
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editCatDesc}
                            onChange={(e) => setEditCatDesc(e.target.value)}
                            className="bg-white rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-teal-400 w-full"
                          />
                        ) : (
                          <span>{cat.descripcion || <span className="text-slate-400 italic">Sin descripción</span>}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleCatActive(cat)}
                          disabled={cat.id === "default-cat"}
                          className={`inline-flex items-center gap-1.5 text-xs font-black px-3 py-1 rounded-full transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                            cat.activo
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-rose-50 text-rose-700 border border-rose-200"
                          }`}
                        >
                          {cat.activo ? (
                            <>
                              <ToggleRight className="w-4 h-4 text-emerald-600" />
                              Activo
                            </>
                          ) : (
                            <>
                              <ToggleLeft className="w-4 h-4 text-rose-500" />
                              Inactivo
                            </>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <div className="flex gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={handleEditCatSubmit}
                              disabled={updatingCat}
                              className="px-3 py-1.5 bg-teal-600 text-white font-bold text-xs rounded-lg hover:bg-teal-700 transition"
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingCat(null)}
                              className="px-3 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 font-bold text-xs rounded-lg hover:bg-slate-200 transition"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => {
                                setEditingCat(cat);
                                setEditCatName(cat.nombre);
                                setEditCatDesc(cat.descripcion || "");
                                playSound("click");
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 hover:bg-slate-50 transition active:scale-95 cursor-pointer text-slate-700"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span>Editar</span>
                            </button>
                            {cat.id !== "default-cat" && (
                              <button
                                onClick={() => handleDeleteCat(cat)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition active:scale-95 cursor-pointer animate-fade-in"
                                title="Eliminar Catálogo"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Gestión de Conceptos de Facturación (Módulo de Venta) */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Tag className="w-5 h-5 text-teal-600" />
              Conceptos de Facturación (Módulo de Venta)
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Administre, agregue, edite o elimine los conceptos de operación disponibles en la lista desplegable de facturación (ej. Venta, Compra, Transferencia, Donación).
            </p>
          </div>
        </div>

        {/* Formulario para agregar nuevo concepto */}
        <form onSubmit={handleCreateConcepto} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-4">
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">
              Nombre del Concepto *
            </label>
            <input
              type="text"
              required
              placeholder="Ej: Venta, Compra, Transferencia, Donación..."
              value={newConceptoName}
              onChange={(e) => setNewConceptoName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-teal-500 transition"
            />
          </div>
          <div className="sm:col-span-5">
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">
              Descripción (Opcional)
            </label>
            <input
              type="text"
              placeholder="Ej: Despacho por donación o transferencia entre sedes"
              value={newConceptoDesc}
              onChange={(e) => setNewConceptoDesc(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-teal-500 transition"
            />
          </div>
          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={creatingConcepto || !newConceptoName.trim()}
              className="w-full px-5 py-2.5 bg-teal-700 hover:bg-teal-600 disabled:bg-slate-300 text-white font-black text-xs uppercase tracking-wider rounded-xl transition active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer bg-custom-buttons"
            >
              <Plus className="w-4 h-4" />
              Agregar Concepto
            </button>
          </div>
        </form>

        {/* Lista de Conceptos */}
        <div className="border border-slate-200 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500 tracking-wider">
                  <th className="px-4 py-3">Concepto</th>
                  <th className="px-4 py-3">Descripción</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {(conceptos.length > 0 ? conceptos : DEFAULT_CONCEPTOS_FACTURA).map((conc) => {
                  const isEditing = editingConcepto?.id === conc.id;

                  return (
                    <tr key={conc.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-4 py-3 font-bold text-slate-800">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editConceptoName}
                            onChange={(e) => setEditConceptoName(e.target.value)}
                            className="w-full rounded-lg border border-teal-500 bg-white px-3 py-1.5 text-sm font-bold text-slate-900 outline-none"
                            autoFocus
                          />
                        ) : (
                          <span>{conc.nombre}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editConceptoDesc}
                            onChange={(e) => setEditConceptoDesc(e.target.value)}
                            placeholder="Descripción..."
                            className="w-full rounded-lg border border-teal-500 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 outline-none"
                          />
                        ) : (
                          conc.descripcion || <span className="italic text-slate-400">Sin descripción</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleToggleConceptoActive(conc)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition cursor-pointer ${
                            conc.activo
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                              : "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100"
                          }`}
                        >
                          {conc.activo ? (
                            <>
                              <ToggleRight className="w-4 h-4 text-emerald-600" />
                              Activo
                            </>
                          ) : (
                            <>
                              <ToggleLeft className="w-4 h-4 text-rose-500" />
                              Inactivo
                            </>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <div className="flex gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={handleEditConceptoSubmit}
                              disabled={updatingConcepto}
                              className="px-3 py-1.5 bg-teal-600 text-white font-bold text-xs rounded-lg hover:bg-teal-700 transition cursor-pointer"
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingConcepto(null)}
                              className="px-3 py-1.5 bg-slate-100 text-slate-600 border border-slate-200 font-bold text-xs rounded-lg hover:bg-slate-200 transition cursor-pointer"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => {
                                setEditingConcepto(conc);
                                setEditConceptoName(conc.nombre);
                                setEditConceptoDesc(conc.descripcion || "");
                                playSound("click");
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 hover:bg-slate-50 transition active:scale-95 cursor-pointer text-slate-700"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span>Editar</span>
                            </button>
                            <button
                              onClick={() => handleDeleteConcepto(conc)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition active:scale-95 cursor-pointer"
                              title="Eliminar Concepto"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {isAnyer && (
        <div className="anim-card-in space-y-6">
          {/* Tarjeta de Cierre de Mes */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
              <RefreshCw className="w-5 h-5 text-rose-600" />
              Cierre de Período Mensual
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-center">
              <div className="sm:col-span-2 space-y-1.5">
                <p className="text-xs text-slate-400 font-black uppercase tracking-wider">Período Activo Actualmente</p>
                <p className="text-2xl font-black text-teal-800">{activePeriod}</p>
                <p className="text-slate-500 text-xs">
                  El cierre de mes bloquea el período actual, abriendo el siguiente de forma consecutiva. Conserva todos los registros históricos, lotes, movimientos y solicitudes sin eliminar datos para resguardar la trazabilidad.
                </p>
              </div>
              <div className="text-right">
                <button
                  onClick={handleCerrarMes}
                  disabled={closingMonth}
                  className="w-full sm:w-auto px-6 py-3 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition active:scale-95 shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${closingMonth ? "animate-spin" : ""}`} />
                  Cerrar Mes Activo
                </button>
              </div>
            </div>
          </div>

          {/* Tarjeta de Personalización de Colores */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-6">
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
              <Palette className="w-5 h-5 text-teal-600" />
              Personalización de la Identidad Visual
            </h3>

            <div className="space-y-3">
              <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Temas Prediseñados</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                {PRESETS.map((preset) => {
                  const isMatch =
                    localColores.primary === preset.colors.primary &&
                    localColores.sidebar === preset.colors.sidebar;
                  return (
                    <button
                      key={preset.name}
                      onClick={() => handleApplyPreset(preset.colors)}
                      className={`text-left rounded-2xl border p-4 transition active:scale-95 flex flex-col justify-between h-28 cursor-pointer ${
                        isMatch ? "border-teal-500 bg-teal-50/20 ring-1 ring-teal-200 shadow-sm" : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <span className="text-xs font-bold text-slate-800 leading-tight">{preset.name}</span>
                      <div className="flex gap-1.5 mt-2">
                        <span
                          className="w-5 h-5 rounded-full border border-black/10 inline-block shadow-inner"
                          style={{ backgroundColor: preset.colors.primary }}
                        ></span>
                        <span
                          className="w-5 h-5 rounded-full border border-black/10 inline-block shadow-inner"
                          style={{ backgroundColor: preset.colors.sidebar }}
                        ></span>
                        <span
                          className="w-5 h-5 rounded-full border border-black/10 inline-block shadow-inner"
                          style={{ backgroundColor: preset.colors.buttons }}
                        ></span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3 border-t border-slate-100 pt-5">
              <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Ajuste de Colores Detallado</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3 border border-slate-200/50">
                  <input
                    type="color"
                    value={localColores.primary}
                    onChange={(e) => handleColorChange("primary", e.target.value)}
                    className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0"
                  />
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Color Principal</label>
                    <p className="text-xs font-mono font-semibold text-slate-600">{localColores.primary.toUpperCase()}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3 border border-slate-200/50">
                  <input
                    type="color"
                    value={localColores.sidebar}
                    onChange={(e) => handleColorChange("sidebar", e.target.value)}
                    className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0"
                  />
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Panel Lateral</label>
                    <p className="text-xs font-mono font-semibold text-slate-600">{localColores.sidebar.toUpperCase()}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3 border border-slate-200/50">
                  <input
                    type="color"
                    value={localColores.buttons}
                    onChange={(e) => handleColorChange("buttons", e.target.value)}
                    className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0"
                  />
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Botones</label>
                    <p className="text-xs font-mono font-semibold text-slate-600">{localColores.buttons.toUpperCase()}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3 border border-slate-200/50">
                  <input
                    type="color"
                    value={localColores.headers}
                    onChange={(e) => handleColorChange("headers", e.target.value)}
                    className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0"
                  />
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Encabezados</label>
                    <p className="text-xs font-mono font-semibold text-slate-600">{localColores.headers.toUpperCase()}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3 border border-slate-200/50">
                  <input
                    type="color"
                    value={localColores.cards}
                    onChange={(e) => handleColorChange("cards", e.target.value)}
                    className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0"
                  />
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Fondo Tarjetas</label>
                    <p className="text-xs font-mono font-semibold text-slate-600">{localColores.cards.toUpperCase()}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3 border border-slate-200/50">
                  <input
                    type="color"
                    value={localColores.tables}
                    onChange={(e) => handleColorChange("tables", e.target.value)}
                    className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0"
                  />
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Encabezado Tabla</label>
                    <p className="text-xs font-mono font-semibold text-slate-600">{localColores.tables.toUpperCase()}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={handleSaveColores}
                disabled={savingColores}
                className="w-full sm:w-auto px-6 py-3.5 bg-teal-600 hover:bg-teal-700 text-white font-extrabold text-xs uppercase tracking-wider rounded-xl transition active:scale-95 shadow-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                {savingColores ? "Guardando..." : "Guardar y Aplicar Colores"}
              </button>
            </div>
          </div>

          {isSuperAdmin && (
            <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-teal-600" />
                    Reglas de Seguridad de Cloud Firestore (Producción)
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Copia estas reglas y pégalas en Firebase Console → Firestore Database → Reglas para proteger tus datos y aislar cada farmacia cliente.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyRules}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-black text-xs uppercase tracking-wider transition cursor-pointer shrink-0 shadow-xs"
                >
                  {copiedRules ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-300" />
                      <span>¡Reglas Copiadas!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copiar Reglas</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="bg-slate-900 text-emerald-300 p-4 rounded-2xl overflow-x-auto font-mono text-[11px] leading-relaxed max-h-64 select-all">
                {FIRESTORE_SECURITY_RULES_TEXT}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
