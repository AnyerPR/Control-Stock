import React, { useState, useEffect } from "react";
import { doc, setDoc, updateDoc, collection, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Usuario, ColoresConfig, Departamento, Catalogo } from "../types";
import { playSound } from "../utils/audio";
import { Settings, RefreshCw, Palette, ShieldAlert, Check, Plus, Edit2, Shield, ToggleLeft, ToggleRight, Trash2, Building, X, Layers } from "lucide-react";

interface ConfiguracionPanelProps {
  currentUser: Usuario;
  activePeriod: string;
  colores: ColoresConfig;
  onUpdatePeriod: (newPeriod: string) => void;
  onUpdateColores: (newColores: ColoresConfig) => void;
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
  onUpdatePeriod,
  onUpdateColores,
  showToast,
  departamentos,
  catalogos
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

  const isAnyer = currentUser.usuario.toLowerCase() === "anyer";

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
      const colRef = collection(db, "departamentos");
      const id = `dept-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now().toString(36)}`;
      await setDoc(doc(colRef, id), {
        id,
        nombre: name,
        activo: true,
        createdAt: Date.now()
      });
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
      const docRef = doc(db, "departamentos", editingDept.id);
      await updateDoc(docRef, { nombre: name });
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
      const docRef = doc(db, "departamentos", dept.id);
      const nextActive = !dept.activo;
      await updateDoc(docRef, { activo: nextActive });
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
      const colRef = collection(db, "catalogos");
      const id = `cat-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now().toString(36)}`;
      await setDoc(doc(colRef, id), {
        id,
        nombre: name,
        descripcion: desc,
        activo: true,
        createdAt: Date.now()
      });
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
      const docRef = doc(db, "catalogos", editingCat.id);
      await updateDoc(docRef, {
        nombre: name,
        descripcion: desc,
        updatedAt: Date.now()
      });
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
      const docRef = doc(db, "catalogos", cat.id);
      const nextActive = !cat.activo;
      await updateDoc(docRef, { activo: nextActive });
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
      const docRef = doc(db, "catalogos", cat.id);
      await deleteDoc(docRef);
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

    const confirmMessage = `¿Estás seguro de que deseas cerrar el período mensual actual ("${activePeriod}")?\n\nEsto abrirá automáticamente el nuevo período, conservará todos los registros históricos de suministros, lotes, movimientos y solicitudes intactos para auditoría futura y garantizará la integridad de la información.`;
    
    if (!confirm(confirmMessage)) return;

    setClosingMonth(true);
    playSound("action");

    try {
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
