import React, { useState, useEffect } from "react";
import { Usuario, Departamento, Catalogo } from "../types";
import { UserPlus, User, Users, Trash2, Key, Pen, ShieldAlert, X, CheckCircle } from "lucide-react";

export const MODULOS_DISPONIBLES = [
  { id: "inventory", nombre: "Suministros (Inventario)" },
  { id: "carga_masiva", nombre: "Carga Masiva" },
  { id: "solicitudes", nombre: "Órdenes / Solicitudes" },
  { id: "historial", nombre: "Historial Movs" },
  { id: "usuarios", nombre: "Personal (Usuarios)" },
  { id: "configuracion", nombre: "Configurar (Sistema)" },
];

interface UserPanelProps {
  users: Usuario[];
  departamentos: Departamento[];
  currentUser: Usuario | null;
  catalogos: Catalogo[];
  onAddUser: (data: {
    nombre: string;
    usuario: string;
    passwordText: string;
    rol: "Administrador" | "Operador";
    estado: "Activo" | "Inactivo";
    departamento: string;
    modulos?: string[];
    catalogos?: string[];
  }) => Promise<void>;
  onUpdateUser: (id: string, data: Partial<Usuario>) => Promise<void>;
  onChangeUserPassword: (id: string, passwordText: string) => Promise<void>;
  onDeleteUser: (id: string) => Promise<void>;
}

export default function UserPanel({
  users,
  departamentos,
  currentUser,
  catalogos,
  onAddUser,
  onUpdateUser,
  onChangeUserPassword,
  onDeleteUser
}: UserPanelProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<Usuario | null>(null);
  const [changingPasswordUser, setChangingPasswordUser] = useState<Usuario | null>(null);

  const [newName, setNewName] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"Administrador" | "Operador">("Operador");
  const [newState, setNewState] = useState<"Activo" | "Inactivo">("Activo");
  const [newDepartment, setNewDepartment] = useState("");
  const [newModulos, setNewModulos] = useState<string[]>(["solicitudes", "historial"]);
  const [newCatalogos, setNewCatalogos] = useState<string[]>([]);

  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<"Administrador" | "Operador">("Operador");
  const [editState, setEditState] = useState<"Activo" | "Inactivo">("Activo");
  const [editDepartment, setEditDepartment] = useState("");
  const [editModulos, setEditModulos] = useState<string[]>([]);
  const [editCatalogos, setEditCatalogos] = useState<string[]>([]);

  const [newPasswordText, setNewPasswordText] = useState("");

  const isAnyer = currentUser?.usuario.toLowerCase() === "anyer";

  // Auto-fill modules defaults based on selected role for new user
  useEffect(() => {
    if (newRole === "Administrador") {
      setNewModulos(["inventory", "carga_masiva", "solicitudes", "historial", "usuarios", "configuracion"]);
    } else {
      setNewModulos(["solicitudes", "historial"]);
    }
  }, [newRole]);

  const handleOpenEditModal = (user: Usuario) => {
    if (!isAnyer) {
      alert("Solo el Usuario Anyer tiene permisos para editar usuarios.");
      return;
    }
    setEditingUser(user);
    setEditName(user.nombre);
    setEditRole(user.rol);
    setEditState(user.estado);
    setEditDepartment(user.departamento || "Almacén y Suministro");
    
    // Set modules or default them
    if (user.modulos && Array.isArray(user.modulos)) {
      setEditModulos(user.modulos);
    } else if (user.rol === "Administrador") {
      setEditModulos(["inventory", "carga_masiva", "solicitudes", "historial", "usuarios", "configuracion"]);
    } else {
      setEditModulos(["solicitudes", "historial"]);
    }

    // Set catalogos
    if (user.catalogos && Array.isArray(user.catalogos)) {
      setEditCatalogos(user.catalogos);
    } else {
      setEditCatalogos([]);
    }
  };

  const handleOpenAddModal = () => {
    if (!isAnyer) {
      alert("Solo el Usuario Anyer tiene permisos para registrar nuevos usuarios.");
      return;
    }
    setShowAddModal(true);
    // Auto-select first active department
    const activeDepts = departamentos.filter((d) => d.activo);
    if (activeDepts.length > 0) {
      setNewDepartment(activeDepts[0].nombre);
    } else {
      setNewDepartment("");
    }
    // Default modules
    if (newRole === "Administrador") {
      setNewModulos(["inventory", "carga_masiva", "solicitudes", "historial", "usuarios", "configuracion"]);
    } else {
      setNewModulos(["solicitudes", "historial"]);
    }
  };

  const handleAddUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAnyer) return;

    const uName = newName.trim();
    const uUser = newUsername.trim();
    const uPass = newPassword;
    const uDept = newDepartment || departamentos.filter((d) => d.activo)[0]?.nombre;

    if (!uName || !uUser || !uPass) {
      alert("Por favor complete todos los campos obligatorios.");
      return;
    }

    if (!uDept) {
      alert("No hay ningún departamento activo disponible en el sistema para asignar.");
      return;
    }

    if (users.some((u) => u.usuario.toLowerCase() === uUser.toLowerCase())) {
      alert("El nombre de usuario ya existe en el sistema.");
      return;
    }

    await onAddUser({
      nombre: uName,
      usuario: uUser,
      passwordText: uPass,
      rol: newRole,
      estado: newState,
      departamento: uDept,
      modulos: newModulos,
      catalogos: newCatalogos
    });

    setNewName("");
    setNewUsername("");
    setNewPassword("");
    setNewRole("Operador");
    setNewState("Activo");
    setNewDepartment("");
    setNewModulos(["solicitudes", "historial"]);
    setNewCatalogos([]);
    setShowAddModal(false);
  };

  const handleUpdateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAnyer || !editingUser) return;

    const uDept = editDepartment;
    if (!uDept) {
      alert("Por favor asigne un departamento al usuario.");
      return;
    }

    await onUpdateUser(editingUser.id, {
      nombre: editName.trim(),
      rol: editRole,
      estado: editState,
      departamento: uDept,
      modulos: editModulos,
      catalogos: editCatalogos
    });

    setEditingUser(null);
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAnyer || !changingPasswordUser || !newPasswordText) return;

    await onChangeUserPassword(changingPasswordUser.id, newPasswordText);
    setNewPasswordText("");
    setChangingPasswordUser(null);
  };

  const handleDeleteUserClick = async (id: string, username: string) => {
    if (!isAnyer) {
      alert("Solo el Usuario Anyer tiene permisos para eliminar usuarios.");
      return;
    }
    if (currentUser?.id === id) {
      alert("No puedes eliminar tu propio usuario mientras tienes la sesión iniciada.");
      return;
    }
    if (confirm(`¿Estás seguro de que deseas eliminar permanentemente al usuario "${username}"?`)) {
      await onDeleteUser(id);
    }
  };

  const handleToggleState = async (user: Usuario) => {
    if (!isAnyer) {
      alert("Solo el Usuario Anyer tiene permisos para modificar el estado de usuarios.");
      return;
    }
    if (currentUser?.id === user.id) {
      alert("No puedes desactivar tu propio usuario mientras tienes la sesión iniciada.");
      return;
    }
    const nextState = user.estado === "Activo" ? "Inactivo" : "Activo";
    await onUpdateUser(user.id, { estado: nextState });
  };

  return (
    <div className="anim-card-in mb-6 rounded-3xl bg-white border border-slate-200 shadow-sm overflow-hidden">
      {!isAnyer && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-4 flex items-center gap-3 text-xs sm:text-sm text-amber-800 font-bold">
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
          <span>
            Atención: Solo el Administrador Principal (Anyer) tiene permisos para registrar, editar, desactivar o eliminar usuarios en el sistema.
          </span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 border-b border-slate-200">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-400 font-bold">Configuración de Seguridad</p>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-teal-600" />
            Administración de Usuarios
          </h2>
        </div>
        <button
          onClick={handleOpenAddModal}
          disabled={!isAnyer}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider shadow-sm transition cursor-pointer ${
            isAnyer ? "bg-teal-600 hover:bg-teal-700 text-white active:scale-95" : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}
          title={isAnyer ? "Registrar Nuevo Usuario" : "Solo Anyer puede registrar nuevos usuarios"}
        >
          <UserPlus className="w-4 h-4" />
          <span>Crear Usuario</span>
        </button>
      </div>

      <div className="p-6">
        <div className="overflow-x-auto border border-slate-200 rounded-2xl bg-slate-50">
          <table className="min-w-[650px] w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Usuario</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Departamento</th>
                <th className="px-4 py-3">Módulos</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {users.map((u) => {
                const isSelf = currentUser?.id === u.id;
                return (
                  <tr key={u.id} className="hover:bg-slate-50/50 bg-white transition">
                    <td className="px-4 py-3 font-semibold text-slate-800 flex items-center gap-1.5">
                      {u.nombre}
                      {isSelf && (
                        <span className="text-[9px] bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-2 py-0.5 font-bold uppercase">
                          Tú
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">{u.usuario}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${
                          u.rol === "Administrador"
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-blue-50 text-blue-700 border border-blue-200"
                        }`}
                      >
                        {u.rol}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700">
                      {u.departamento || "Almacén y Suministro"}
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      <div className="flex flex-wrap gap-1">
                        {(() => {
                          const mods = u.modulos && Array.isArray(u.modulos) ? u.modulos : (u.rol === "Administrador" ? ["inventory", "carga_masiva", "solicitudes", "historial", "usuarios", "configuracion"] : ["solicitudes", "historial"]);
                          const mapModNames: Record<string, string> = {
                            inventory: "Suministros",
                            carga_masiva: "Carga Masiva",
                            solicitudes: u.rol === "Administrador" ? "Órdenes" : "Solicitudes",
                            historial: "Historial",
                            usuarios: "Personal",
                            configuracion: "Configurar"
                          };
                          return mods.map((m) => (
                            <span key={m} className="text-[10px] bg-teal-50 border border-teal-100 text-teal-800 px-2 py-0.5 rounded-full font-extrabold whitespace-nowrap">
                              {mapModNames[m] || m}
                            </span>
                          ));
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleState(u)}
                        disabled={isSelf || !isAnyer}
                        className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full transition cursor-pointer ${
                          u.estado === "Activo"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-rose-50 text-rose-700 border border-rose-200"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                        title={
                          isAnyer
                            ? isSelf
                              ? "No puedes desactivar tu propio usuario"
                              : `Cambiar estado a ${u.estado === "Activo" ? "Inactivo" : "Activo"}`
                            : "Solo Anyer puede cambiar el estado de usuarios"
                        }
                      >
                        {u.estado === "Activo" ? (
                          <>
                            <CheckCircle className="w-3.5 h-3.5" />
                            Activo
                          </>
                        ) : (
                          <>
                            <X className="w-3.5 h-3.5 text-rose-500" />
                            Inactivo
                          </>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => handleOpenEditModal(u)}
                          disabled={!isAnyer}
                          title={isAnyer ? "Editar" : "Solo Anyer puede editar"}
                          className={`p-1.5 rounded-lg border text-slate-600 transition ${
                            isAnyer
                              ? "border-slate-200 hover:bg-slate-50 active:scale-95 cursor-pointer"
                              : "border-slate-100 opacity-40 cursor-not-allowed"
                          }`}
                        >
                          <Pen className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setChangingPasswordUser(u)}
                          disabled={!isAnyer}
                          title={isAnyer ? "Cambiar Contraseña" : "Solo Anyer puede cambiar la contraseña"}
                          className={`p-1.5 rounded-lg border text-slate-600 transition ${
                            isAnyer
                              ? "border-slate-200 hover:bg-slate-50 active:scale-95 cursor-pointer"
                              : "border-slate-100 opacity-40 cursor-not-allowed"
                          }`}
                        >
                          <Key className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteUserClick(u.id, u.usuario)}
                          disabled={isSelf || !isAnyer}
                          title={isAnyer ? (isSelf ? "No puedes eliminar tu propio usuario" : "Eliminar") : "Solo Anyer puede eliminar"}
                          className={`p-1.5 rounded-lg border text-rose-600 transition ${
                            isAnyer && !isSelf
                              ? "border-rose-200 hover:bg-rose-50 active:scale-95 cursor-pointer"
                              : "border-slate-100 opacity-40 cursor-not-allowed"
                          }`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setShowAddModal(false)}></div>
          <div className="relative bg-white rounded-3xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden anim-pop-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="font-black text-slate-900 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-teal-600" />
                Registrar Nuevo Usuario
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-xl border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddUserSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1">
                  Nombre Completo *
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ej. Juan Pérez"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1">
                  Usuario / Username *
                </label>
                <input
                  type="text"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="Ej. juanperez"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1">
                  Contraseña Inicial *
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Contraseña del usuario"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1">
                  Departamento *
                </label>
                <select
                  required
                  value={newDepartment}
                  onChange={(e) => setNewDepartment(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                >
                  <option value="" disabled>Seleccione un departamento</option>
                  {departamentos.filter((d) => d.activo).map((d) => (
                    <option key={d.id} value={d.nombre}>{d.nombre}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1">
                    Rol *
                  </label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as any)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                  >
                    <option value="Operador">Operador</option>
                    <option value="Administrador">Administrador</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1">
                    Estado *
                  </label>
                  <select
                    value={newState}
                    onChange={(e) => setNewState(e.target.value as any)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                  >
                    <option value="Activo">Activo</option>
                    <option value="Inactivo">Inactivo</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-2">
                  Módulos Habilitados *
                </label>
                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                  {MODULOS_DISPONIBLES.map((mod) => {
                    const isChecked = newModulos.includes(mod.id);
                    return (
                      <label key={mod.id} className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              setNewModulos(newModulos.filter((id) => id !== mod.id));
                            } else {
                              setNewModulos([...newModulos, mod.id]);
                            }
                          }}
                          className="rounded text-teal-600 focus:ring-teal-400 border-slate-300 w-4 h-4 cursor-pointer"
                        />
                        <span>{mod.id === "solicitudes" && newRole === "Administrador" ? "Órdenes" : mod.nombre}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-2">
                  Catálogos Autorizados *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-100 max-h-36 overflow-y-auto">
                  {catalogos.map((cat) => {
                    const isChecked = newCatalogos.includes(cat.id);
                    return (
                      <label key={cat.id} className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              setNewCatalogos(newCatalogos.filter((id) => id !== cat.id));
                            } else {
                              setNewCatalogos([...newCatalogos, cat.id]);
                            }
                          }}
                          className="rounded text-teal-600 focus:ring-teal-400 border-slate-300 w-4 h-4 cursor-pointer"
                        />
                        <span className="truncate" title={cat.nombre}>{cat.nombre}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-400 mt-1 font-semibold leading-relaxed">
                  * Si no se marca ninguno, el usuario tendrá acceso a TODOS los catálogos de forma predeterminada.
                </p>
              </div>
              <div className="pt-4 flex gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 rounded-xl border border-slate-200 text-slate-600 py-2.5 text-xs font-bold hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-teal-600 hover:bg-teal-700 text-white py-2.5 text-xs font-bold shadow-sm transition cursor-pointer"
                >
                  Crear Usuario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setEditingUser(null)}></div>
          <div className="relative bg-white rounded-3xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden anim-pop-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="font-black text-slate-900 flex items-center gap-2">
                <Pen className="w-5 h-5 text-teal-600" />
                Editar Usuario ({editingUser.usuario})
              </h3>
              <button
                onClick={() => setEditingUser(null)}
                className="rounded-xl border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUpdateUserSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1">
                  Nombre Completo *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1">
                  Departamento *
                </label>
                <select
                  required
                  value={editDepartment}
                  onChange={(e) => setEditDepartment(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                >
                  <option value="" disabled>Seleccione un departamento</option>
                  {editingUser.departamento && !departamentos.find((d) => d.nombre === editingUser.departamento)?.activo && (
                    <option value={editingUser.departamento}>{editingUser.departamento} (Inactivo)</option>
                  )}
                  {departamentos.filter((d) => d.activo).map((d) => (
                    <option key={d.id} value={d.nombre}>{d.nombre}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1">
                    Rol *
                  </label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as any)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-teal-400 bg-white"
                  >
                    <option value="Operador">Operador</option>
                    <option value="Administrador">Administrador</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1">
                    Estado *
                  </label>
                  <select
                    value={editState}
                    onChange={(e) => setEditState(e.target.value as any)}
                    disabled={currentUser?.id === editingUser.id}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-teal-400 bg-white disabled:opacity-50"
                  >
                    <option value="Activo">Activo</option>
                    <option value="Inactivo">Inactivo</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-2">
                  Módulos Habilitados *
                </label>
                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                  {MODULOS_DISPONIBLES.map((mod) => {
                    const isChecked = editModulos.includes(mod.id);
                    return (
                      <label key={mod.id} className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              setEditModulos(editModulos.filter((id) => id !== mod.id));
                            } else {
                              setEditModulos([...editModulos, mod.id]);
                            }
                          }}
                          className="rounded text-teal-600 focus:ring-teal-400 border-slate-300 w-4 h-4 cursor-pointer"
                        />
                        <span>{mod.id === "solicitudes" && editRole === "Administrador" ? "Órdenes" : mod.nombre}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-2">
                  Catálogos Autorizados *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-100 max-h-36 overflow-y-auto">
                  {catalogos.map((cat) => {
                    const isChecked = editCatalogos.includes(cat.id);
                    return (
                      <label key={cat.id} className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              setEditCatalogos(editCatalogos.filter((id) => id !== cat.id));
                            } else {
                              setEditCatalogos([...editCatalogos, cat.id]);
                            }
                          }}
                          className="rounded text-teal-600 focus:ring-teal-400 border-slate-300 w-4 h-4 cursor-pointer"
                        />
                        <span className="truncate" title={cat.nombre}>{cat.nombre}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-400 mt-1 font-semibold leading-relaxed">
                  * Si no se marca ninguno, el usuario tendrá acceso a TODOS los catálogos de forma predeterminada.
                </p>
              </div>
              <div className="pt-4 flex gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="flex-1 rounded-xl border border-slate-200 text-slate-600 py-2.5 text-xs font-bold hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-teal-600 hover:bg-teal-700 text-white py-2.5 text-xs font-bold shadow-sm transition cursor-pointer"
                >
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {changingPasswordUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setChangingPasswordUser(null)}></div>
          <div className="relative bg-white rounded-3xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden anim-pop-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="font-black text-slate-900 flex items-center gap-2">
                <Key className="w-5 h-5 text-teal-600" />
                Cambiar Contraseña
              </h3>
              <button
                onClick={() => setChangingPasswordUser(null)}
                className="rounded-xl border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleChangePasswordSubmit} className="p-6 space-y-4">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <p className="text-xs text-slate-500 font-semibold">Usuario:</p>
                <p className="text-sm font-bold text-slate-800">
                  {changingPasswordUser.usuario} ({changingPasswordUser.nombre})
                </p>
              </div>
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 tracking-wider mb-1">
                  Nueva Contraseña *
                </label>
                <input
                  type="password"
                  required
                  value={newPasswordText}
                  onChange={(e) => setNewPasswordText(e.target.value)}
                  placeholder="Introduce la nueva contraseña"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>
              <div className="pt-4 flex gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setChangingPasswordUser(null)}
                  className="flex-1 rounded-xl border border-slate-200 text-slate-600 py-2.5 text-xs font-bold hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-teal-600 hover:bg-teal-700 text-white py-2.5 text-xs font-bold shadow-sm transition cursor-pointer"
                >
                  Actualizar Contraseña
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
