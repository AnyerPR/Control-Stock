import React, { useState, useEffect, useRef } from "react";
import { doc, setDoc, updateDoc, collection, deleteDoc, getDocs, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { Usuario, ColoresConfig, Departamento, Catalogo, Producto, InstitucionConfig } from "../types";
import { playSound } from "../utils/audio";
import {
  Settings,
  RefreshCw,
  Palette,
  ShieldAlert,
  Check,
  Plus,
  Edit2,
  Shield,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Building,
  X,
  Layers,
  Building2,
  Upload,
  Image as ImageIcon,
  FileText,
  Globe,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  AlertCircle,
  Save
} from "lucide-react";

interface ConfiguracionPanelProps {
  currentUser: Usuario;
  activePeriod: string;
  colores: ColoresConfig;
  institucion: InstitucionConfig;
  onUpdatePeriod: (newPeriod: string) => void;
  onUpdateColores: (newColores: ColoresConfig) => void;
  onUpdateInstitucion: (newInst: InstitucionConfig) => void;
  showToast: (message: string) => void;
  departamentos: Departamento[];
  catalogos: Catalogo[];
}

// Predefined Themes for Quick Selection
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
  institucion,
  onUpdatePeriod,
  onUpdateColores,
  onUpdateInstitucion,
  showToast,
  departamentos,
  catalogos
}: ConfiguracionPanelProps) {
  const [localColores, setLocalColores] = useState<ColoresConfig>({ ...colores });
  const [savingColores, setSavingColores] = useState(false);
  const [closingMonth, setClosingMonth] = useState(false);

  // Institucion / Empresa State
  const [localInstitucion, setLocalInstitucion] = useState<InstitucionConfig>({
    nombre: institucion?.nombre || "Suministros Hospitalarios • Dr. José Manuel Rodríguez",
    logo: institucion?.logo || "",
    direccion: institucion?.direccion || "",
    telefono: institucion?.telefono || "",
    correo: institucion?.correo || "",
    identificadorFiscal: institucion?.identificadorFiscal || "",
    paginaWeb: institucion?.paginaWeb || "",
    informacionAdicional: institucion?.informacionAdicional || ""
  });
  const [savingInstitucion, setSavingInstitucion] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync when prop updates
  useEffect(() => {
    if (institucion) {
      setLocalInstitucion({
        nombre: institucion.nombre || "Suministros Hospitalarios • Dr. José Manuel Rodríguez",
        logo: institucion.logo || "",
        direccion: institucion.direccion || "",
        telefono: institucion.telefono || "",
        correo: institucion.correo || "",
        identificadorFiscal: institucion.identificadorFiscal || "",
        paginaWeb: institucion.paginaWeb || "",
        informacionAdicional: institucion.informacionAdicional || ""
      });
    }
  }, [institucion]);

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

  const isAnyer = currentUser.usuario.toLowerCase() === "anyer";
  const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

  // Handle Logo Upload and Image Resizing/Validation
  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
    if (!validTypes.includes(file.type)) {
      setLogoError("El archivo debe ser una imagen válida (PNG, JPG, WEBP o SVG).");
      return;
    }

    // Max 2.5 MB
    if (file.size > 2.5 * 1024 * 1024) {
      setLogoError("La imagen no debe superar los 2.5 MB.");
      return;
    }

    setLogoError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        // Optimize dimensions if large to avoid overflowing document or storage limits
        const img = new Image();
        img.onload = () => {
          const maxDim = 450;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const optimized = canvas.toDataURL("image/png", 0.92);
            setLocalInstitucion((prev) => ({ ...prev, logo: optimized }));
          } else {
            setLocalInstitucion((prev) => ({ ...prev, logo: result }));
          }
          playSound("action");
        };
        img.onerror = () => {
          setLogoError("No se pudo procesar la imagen seleccionada.");
        };
        img.src = result;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = () => {
    setLocalInstitucion((prev) => ({ ...prev, logo: "" }));
    setLogoError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    playSound("click");
  };

  // Save Institución data persistently
  const handleSaveInstitucion = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSavingInstitucion(true);
    playSound("action");

    try {
      const dataToSave: InstitucionConfig = {
        nombre: localInstitucion.nombre.trim() || "Suministros Hospitalarios",
        logo: localInstitucion.logo || "",
        direccion: localInstitucion.direccion?.trim() || "",
        telefono: localInstitucion.telefono?.trim() || "",
        correo: localInstitucion.correo?.trim() || "",
        identificadorFiscal: localInstitucion.identificadorFiscal?.trim() || "",
        paginaWeb: localInstitucion.paginaWeb?.trim() || "",
        informacionAdicional: localInstitucion.informacionAdicional?.trim() || "",
        updatedAt: Date.now()
      };

      if (isLocalFileMode) {
        localStorage.setItem("offline_institucion", JSON.stringify(dataToSave));
        localStorage.setItem("institucion_config", JSON.stringify(dataToSave));
        window.dispatchEvent(new Event("offline_institucion_update"));
      } else {
        const docRef = doc(db, "configuracion", "institucion");
        await setDoc(docRef, dataToSave, { merge: true });
        localStorage.setItem("institucion_config", JSON.stringify(dataToSave));
      }

      onUpdateInstitucion(dataToSave);
      playSound("positive");
      showToast("Datos institucionales guardados correctamente.");
    } catch (err) {
      console.error("Error al guardar institución:", err);
      alert("Error al guardar la información institucional.");
    } finally {
      setSavingInstitucion(false);
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
        let stored = localStorage.getItem("offline_departamentos");
        let list: Departamento[] = [];
        if (stored) {
          try { list = JSON.parse(stored); } catch (e) {}
        }
        list.push(newDept);
        localStorage.setItem("offline_departamentos", JSON.stringify(list));
        window.dispatchEvent(new Event("offline_departamentos_update"));
      } else {
        const colRef = collection(db, "departamentos");
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
        let stored = localStorage.getItem("offline_departamentos");
        let list: Departamento[] = [];
        if (stored) {
          try { list = JSON.parse(stored); } catch (e) {}
        }
        list = list.map(d => d.id === editingDept.id ? { ...d, nombre: name } : d);
        localStorage.setItem("offline_departamentos", JSON.stringify(list));
        window.dispatchEvent(new Event("offline_departamentos_update"));
      } else {
        const docRef = doc(db, "departamentos", editingDept.id);
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
        let stored = localStorage.getItem("offline_departamentos");
        let list: Departamento[] = [];
        if (stored) {
          try { list = JSON.parse(stored); } catch (e) {}
        }
        list = list.map(d => d.id === dept.id ? { ...d, activo: nextActive } : d);
        localStorage.setItem("offline_departamentos", JSON.stringify(list));
        window.dispatchEvent(new Event("offline_departamentos_update"));
      } else {
        const docRef = doc(db, "departamentos", dept.id);
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
        let stored = localStorage.getItem("offline_catalogos");
        let list: Catalogo[] = [];
        if (stored) {
          try { list = JSON.parse(stored); } catch (e) {}
        }
        list.push(newCat);
        localStorage.setItem("offline_catalogos", JSON.stringify(list));
        window.dispatchEvent(new Event("offline_catalogos_update"));
      } else {
        const colRef = collection(db, "catalogos");
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
        let stored = localStorage.getItem("offline_catalogos");
        let list: Catalogo[] = [];
        if (stored) {
          try { list = JSON.parse(stored); } catch (e) {}
        }
        list = list.map(c => c.id === editingCat.id ? { ...c, nombre: name, descripcion: desc, updatedAt: Date.now() } : c);
        localStorage.setItem("offline_catalogos", JSON.stringify(list));
        window.dispatchEvent(new Event("offline_catalogos_update"));
      } else {
        const docRef = doc(db, "catalogos", editingCat.id);
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
        let stored = localStorage.getItem("offline_catalogos");
        let list: Catalogo[] = [];
        if (stored) {
          try { list = JSON.parse(stored); } catch (e) {}
        }
        list = list.map(c => c.id === cat.id ? { ...c, activo: nextActive } : c);
        localStorage.setItem("offline_catalogos", JSON.stringify(list));
        window.dispatchEvent(new Event("offline_catalogos_update"));
      } else {
        const docRef = doc(db, "catalogos", cat.id);
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
        let stored = localStorage.getItem("offline_catalogos");
        let list: Catalogo[] = [];
        if (stored) {
          try { list = JSON.parse(stored); } catch (e) {}
        }
        list = list.filter(c => c.id !== cat.id);
        localStorage.setItem("offline_catalogos", JSON.stringify(list));
        window.dispatchEvent(new Event("offline_catalogos_update"));
      } else {
        const docRef = doc(db, "catalogos", cat.id);
        await deleteDoc(docRef);
      }

      playSound("positive");
      showToast(`Catálogo "${cat.nombre}" eliminado permanentemente.`);
    } catch (err) {
      console.error("Error deleting catalog:", err);
      alert("Error al eliminar el catálogo.");
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
      alert("Solo el Usuario Anyer tiene permisos para modificar la configuración de colores.");
      return;
    }

    setSavingColores(true);
    playSound("action");

    try {
      // Save in Firestore
      const docRef = doc(db, "configuracion", "colores");
      await setDoc(docRef, { colores: localColores });

      // Save in localStorage for instant retrieval on refresh
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
      alert("Solo el Usuario Anyer tiene permisos para efectuar el cierre del mes.");
      return;
    }

    const confirmMessage = `¿Estás seguro de que deseas cerrar el período mensual actual ("${activePeriod}")?\n\nEsto abrirá automáticamente el nuevo período, desmarcará los checks de Ajustado y Verificado en los productos, y conservará todos los registros históricos de suministros, lotes, movimientos y solicitudes intactos para auditoría futura.`;
    
    if (!confirm(confirmMessage)) return;

    setClosingMonth(true);
    playSound("action");

    try {
      // Fetch all products to uncheck 'verificado' and 'articuloAjustado'
      const querySnapshot = await getDocs(collection(db, "productos"));
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

      // Parse current period (e.g., "Julio 2026")
      const parts = activePeriod.split(" ");
      let monthIndex = MESES.indexOf(parts[0]);
      let year = parseInt(parts[1], 10);

      if (monthIndex === -1 || isNaN(year)) {
        // Fallback to current calendar date if format is invalid
        const now = new Date();
        monthIndex = now.getMonth();
        year = now.getFullYear();
      }

      // Increment period by 1 month
      monthIndex++;
      if (monthIndex > 11) {
        monthIndex = 0;
        year++;
      }

      const nextPeriod = `${MESES[monthIndex]} ${year}`;

      // Update in Firestore
      const docRef = doc(db, "configuracion", "periodo");
      await setDoc(docRef, { periodoActual: nextPeriod });

      // Save in localStorage
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
      {/* Tarjeta de Datos de Institución / Empresa */}
      <div className="bg-white rounded-3xl p-6 sm:p-7 border border-slate-200 shadow-sm space-y-6 anim-card-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-teal-600" />
              Institución / Empresa
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Administre la información institucional y el logotipo oficial que se incluirá en las facturas y comprobantes exportados en PDF y Word.
            </p>
          </div>
          <span className="text-[10px] uppercase font-black tracking-wider bg-teal-50 text-teal-700 px-3 py-1 rounded-full border border-teal-200 self-start sm:self-auto">
            Encabezados y Facturas
          </span>
        </div>

        <form onSubmit={handleSaveInstitucion} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Form Fields (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              <div>
                <label className="block text-xs font-black uppercase text-slate-600 tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-teal-600" />
                  Nombre de la Institución / Empresa <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={localInstitucion.nombre}
                  onChange={(e) => setLocalInstitucion((prev) => ({ ...prev, nombre: e.target.value }))}
                  placeholder="Ej: Suministros Hospitalarios • Dr. José Manuel Rodríguez"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition shadow-2xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 tracking-wider mb-1.5 flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-teal-600" />
                    RNC / NIT / ID Fiscal
                  </label>
                  <input
                    type="text"
                    value={localInstitucion.identificadorFiscal || ""}
                    onChange={(e) => setLocalInstitucion((prev) => ({ ...prev, identificadorFiscal: e.target.value }))}
                    placeholder="Ej: 1-01-00000-0 o NIT"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition shadow-2xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-teal-600" />
                    Teléfono
                  </label>
                  <input
                    type="text"
                    value={localInstitucion.telefono || ""}
                    onChange={(e) => setLocalInstitucion((prev) => ({ ...prev, telefono: e.target.value }))}
                    placeholder="Ej: (809) 555-0199"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition shadow-2xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-teal-600" />
                    Correo Electrónico
                  </label>
                  <input
                    type="email"
                    value={localInstitucion.correo || ""}
                    onChange={(e) => setLocalInstitucion((prev) => ({ ...prev, correo: e.target.value }))}
                    placeholder="Ej: suministros@hospital.gob.do"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition shadow-2xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase text-slate-600 tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-teal-600" />
                    Página Web
                  </label>
                  <input
                    type="text"
                    value={localInstitucion.paginaWeb || ""}
                    onChange={(e) => setLocalInstitucion((prev) => ({ ...prev, paginaWeb: e.target.value }))}
                    placeholder="Ej: www.hospital.gob.do"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition shadow-2xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-600 tracking-wider mb-1.5 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-teal-600" />
                  Dirección Física / Sede
                </label>
                <input
                  type="text"
                  value={localInstitucion.direccion || ""}
                  onChange={(e) => setLocalInstitucion((prev) => ({ ...prev, direccion: e.target.value }))}
                  placeholder="Ej: Av. Principal Esq. Calle Central #10, Santo Domingo"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition shadow-2xs"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-600 tracking-wider mb-1.5 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-teal-600" />
                  Información Adicional (Pie de página de facturas)
                </label>
                <textarea
                  rows={2}
                  value={localInstitucion.informacionAdicional || ""}
                  onChange={(e) => setLocalInstitucion((prev) => ({ ...prev, informacionAdicional: e.target.value }))}
                  placeholder="Ej: Documento de control interno de abastecimiento médico. Válido sin tachaduras ni enmiendas."
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition shadow-2xs resize-none"
                />
              </div>
            </div>

            {/* Right Column: Logo Upload & Visual Preview (5 cols) */}
            <div className="lg:col-span-5 flex flex-col justify-between p-5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-4">
              <div>
                <span className="block text-xs font-black uppercase text-slate-600 tracking-wider mb-1.5 flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-teal-600" />
                  Logotipo Institucional
                </span>
                <p className="text-[11px] text-slate-500 mb-3">
                  Se integrará en la cabecera superior de cada factura exportada en PDF y Word sin deformaciones.
                </p>

                {/* Logo Preview Area */}
                <div className="relative min-h-[140px] max-h-[160px] w-full rounded-xl border-2 border-dashed border-slate-200 bg-white flex items-center justify-center p-3 overflow-hidden">
                  {localInstitucion.logo ? (
                    <img
                      src={localInstitucion.logo}
                      alt="Logo de la Institución"
                      className="max-h-[130px] max-w-full object-contain rounded drop-shadow-2xs transition hover:scale-105"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center p-3 text-slate-400">
                      <ImageIcon className="w-10 h-10 mb-1 stroke-1 text-slate-300" />
                      <span className="text-xs font-bold text-slate-600">Sin logotipo asignado</span>
                      <span className="text-[10px] text-slate-400">Haga clic abajo para cargar el logo</span>
                    </div>
                  )}
                </div>

                {logoError && (
                  <div className="mt-2 text-xs font-bold text-rose-600 flex items-center gap-1.5 bg-rose-50 p-2 rounded-lg border border-rose-200">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{logoError}</span>
                  </div>
                )}
              </div>

              {/* Upload & Remove buttons */}
              <div className="space-y-2 pt-2 border-t border-slate-200/60">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleLogoChange}
                  accept="image/png, image/jpeg, image/webp, image/svg+xml"
                  className="hidden"
                  id="institucion-logo-upload"
                />

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="institucion-logo-upload"
                    className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-teal-700 hover:border-teal-300 text-xs font-bold rounded-xl transition cursor-pointer active:scale-95 shadow-2xs"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{localInstitucion.logo ? "Reemplazar Logo" : "Subir Logotipo"}</span>
                  </label>

                  {localInstitucion.logo && (
                    <button
                      type="button"
                      onClick={handleRemoveLogo}
                      className="px-3 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 text-xs font-bold rounded-xl transition cursor-pointer active:scale-95 shadow-2xs"
                      title="Quitar logotipo"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <span className="block text-[10px] text-slate-400 text-center">
                  Formatos recomendados: PNG o SVG con fondo transparente (máx. 2.5 MB).
                </span>
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="submit"
              disabled={savingInstitucion}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider rounded-xl transition shadow-md shadow-teal-700/20 active:scale-95 cursor-pointer"
            >
              {savingInstitucion ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>{savingInstitucion ? "Guardando..." : "Guardar Datos de la Institución"}</span>
            </button>
          </div>
        </form>
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

        {/* Formulario para Crear Departamento */}
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

        {/* Listado de Departamentos */}
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

        {/* Formulario para Crear Catálogo */}
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

        {/* Listado de Catálogos */}
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

            {/* Presets de Temas */}
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

            {/* Configuración Manual */}
            <div className="space-y-3 border-t border-slate-100 pt-5">
              <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">Ajuste de Colores Detallado</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {/* Color Principal */}
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

                {/* Color Menú Lateral */}
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

                {/* Color Botones */}
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

                {/* Color Encabezados */}
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

                {/* Color Tarjetas */}
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

                {/* Color Tablas */}
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
        </div>
      )}
    </div>
  );
}
