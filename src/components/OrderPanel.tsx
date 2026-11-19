import React, { useEffect, useMemo, useState } from "react";
import {
  Departamento,
  Producto,
  ResponsableDepartamento,
  TipoConsumoConfig,
  Usuario,
  matchesCatalog
} from "../types";
import MarqueeText from "./MarqueeText";
import {
  ShoppingCart,
  Send,
  Trash2,
  Search,
  Plus,
  X,
  FileText,
  FileDown,
  UserPlus,
  Building2,
  AlertCircle,
  Globe
} from "lucide-react";
import { exportOrderToPDF, exportOrderToWord } from "../utils/exportUtils";
import { isLotExpiredWithStock } from "../utils/inventoryStatus";
import {
  loadLocalResponsables,
  loadLocalTiposConsumo,
  mergeDepartamentosSinDuplicados,
  normalizeTextToken,
  registrarNuevoResponsableRapido,
  validarRelacionResponsableDepartamento
} from "../utils/consumosUtils";
import { DEFAULT_FARMACIA_ID, getActiveFarmaciaId } from "../firebase";
import { playSound } from "../utils/audio";

interface OrderItem {
  productCode: string;
  codigo: string;
  nombre: string;
  descripcion?: string;
  loteId: string;
  loteNumero: string;
  fecha: string;
  precio: number;
  cantidadAprobada: number;
}

interface BlockItem {
  id: string;
  productCode: string;
  nivel: number;
}

interface Block {
  id: string;
  items: BlockItem[];
  updatedAt: number;
}

export interface OrderConsumoMetadata {
  departamentoNombre: string;
  responsable: ResponsableDepartamento;
  tipoConsumo: TipoConsumoConfig;
  destinoExternoInstitucion?: string;
  destinoExternoPersona?: string;
  asignacionEspecialAdmin?: boolean;
}

interface OrderPanelProps {
  products: Producto[];
  orderItems: OrderItem[];
  orderSelectedProduct: string | null;
  orderSelectedLot: string | null;
  orderSelectedQuantity: number | null;
  orderProductSearch: string;
  onCloseOrderPanel: () => void;
  onClearOrder: () => void;
  onCompleteOrder: (consumoMeta?: OrderConsumoMetadata) => void;
  onShareOrderByWhatsApp: () => void;
  onUpdateOrderItemQuantity: (index: number, quantity: number) => void;
  onRemoveOrderItem: (index: number) => void;
  onUpdateOrderProductSearch: (search: string) => void;
  onSelectOrderProduct: (productCode: string | null) => void;
  onSetOrderSelectedLot: (lotId: string | null) => void;
  onSetOrderSelectedQuantity: (quantity: number | null) => void;
  onAddOrderItem: () => void;
  blocks: Block[];
  onOpenProductDetail?: (productCode: string) => void;
  availableCatalogos: any[];
  orderCatalogId: string;
  onSetOrderCatalogId: (catalogId: string) => void;
  departamentos?: Departamento[];
  currentUser?: Usuario | null;
  showToast?: (msg: string) => void;
}

export default function OrderPanel({
  products,
  orderItems,
  orderSelectedProduct,
  orderSelectedLot,
  orderSelectedQuantity,
  orderProductSearch,
  onCloseOrderPanel,
  onClearOrder,
  onCompleteOrder,
  onShareOrderByWhatsApp,
  onUpdateOrderItemQuantity,
  onRemoveOrderItem,
  onUpdateOrderProductSearch,
  onSelectOrderProduct,
  onSetOrderSelectedLot,
  onSetOrderSelectedQuantity,
  onAddOrderItem,
  blocks,
  onOpenProductDetail,
  availableCatalogos,
  orderCatalogId,
  onSetOrderCatalogId,
  departamentos = [],
  currentUser,
  showToast
}: OrderPanelProps) {
  const activeSedeId = getActiveFarmaciaId() || DEFAULT_FARMACIA_ID;
  const isAdmin = currentUser?.rol === "Administrador";

  const departamentosDisponibles = useMemo(
    () => mergeDepartamentosSinDuplicados(departamentos).filter((d) => d.activo !== false),
    [departamentos]
  );

  const [responsables, setResponsables] = useState<ResponsableDepartamento[]>(() =>
    loadLocalResponsables(activeSedeId)
  );
  const [tiposConsumo, setTiposConsumo] = useState<TipoConsumoConfig[]>(() =>
    loadLocalTiposConsumo(activeSedeId)
  );

  useEffect(() => {
    const syncConfig = () => {
      setResponsables(loadLocalResponsables(activeSedeId));
      setTiposConsumo(loadLocalTiposConsumo(activeSedeId));
    };
    window.addEventListener("consumos_config_updated", syncConfig);
    return () => window.removeEventListener("consumos_config_updated", syncConfig);
  }, [activeSedeId]);

  const [selectedDepartamento, setSelectedDepartamento] = useState<string>(() => {
    const enf = mergeDepartamentosSinDuplicados(departamentos).find(
      (d) => normalizeTextToken(d.nombre) === normalizeTextToken("Enfermería")
    );
    return enf?.nombre || departamentosDisponibles[0]?.nombre || "Enfermería";
  });
  const [selectedResponsableId, setSelectedResponsableId] = useState<string>("resp-iris-aybar");
  const [asignacionEspecialAdmin, setAsignacionEspecialAdmin] = useState<boolean>(false);
  const [selectedTipoConsumoId, setSelectedTipoConsumoId] = useState<string>("tipo-interno");
  const [destinoExternoInstitucion, setDestinoExternoInstitucion] = useState<string>("");
  const [destinoExternoPersona, setDestinoExternoPersona] = useState<string>("");

  // Estado para el botón "Nuevo" debajo de Responsable del departamento
  const [showNuevoRespForm, setShowNuevoRespForm] = useState<boolean>(false);
  const [nuevoRespNombre, setNuevoRespNombre] = useState<string>("");
  const [nuevoRespCargo, setNuevoRespCargo] = useState<string>("");
  const [nuevoRespDept, setNuevoRespDept] = useState<string>(selectedDepartamento);
  const [savingNuevoResp, setSavingNuevoResp] = useState<boolean>(false);

  useEffect(() => {
    setNuevoRespDept(selectedDepartamento);
  }, [selectedDepartamento]);

  const activeResponsables = useMemo(() => {
    const active = responsables.filter((r) => r.activo !== false);
    const deptNorm = normalizeTextToken(selectedDepartamento);
    return [...active].sort((a, b) => {
      const aMatch = normalizeTextToken(a.departamentoNombre) === deptNorm ? 1 : 0;
      const bMatch = normalizeTextToken(b.departamentoNombre) === deptNorm ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return a.nombre.localeCompare(b.nombre, "es");
    });
  }, [responsables, selectedDepartamento]);

  useEffect(() => {
    const currentResp = activeResponsables.find((r) => r.id === selectedResponsableId);
    const deptNorm = normalizeTextToken(selectedDepartamento);
    if (!currentResp || normalizeTextToken(currentResp.departamentoNombre) !== deptNorm) {
      const matchingResp = activeResponsables.find(
        (r) => normalizeTextToken(r.departamentoNombre) === deptNorm
      );
      if (matchingResp) {
        setSelectedResponsableId(matchingResp.id);
        setAsignacionEspecialAdmin(false);
      } else if (activeResponsables.length > 0 && !currentResp) {
        setSelectedResponsableId(activeResponsables[0].id);
      }
    }
  }, [selectedDepartamento, activeResponsables, selectedResponsableId]);

  const selectedResponsableObj = useMemo(
    () => activeResponsables.find((r) => r.id === selectedResponsableId) || activeResponsables[0] || null,
    [activeResponsables, selectedResponsableId]
  );

  const activeTiposConsumo = useMemo(
    () => tiposConsumo.filter((t) => t.activo !== false),
    [tiposConsumo]
  );

  const selectedTipoConsumoObj = useMemo(
    () =>
      activeTiposConsumo.find((t) => t.id === selectedTipoConsumoId) ||
      activeTiposConsumo[0] ||
      null,
    [activeTiposConsumo, selectedTipoConsumoId]
  );

  const isConsumoExterno =
    selectedTipoConsumoObj?.categoria === "Externo" ||
    Boolean(selectedTipoConsumoObj?.requiereDestinoExterno);

  const relacionCheck = useMemo(
    () =>
      validarRelacionResponsableDepartamento({
        responsable: selectedResponsableObj,
        departamentoNombre: selectedDepartamento,
        esAdmin: isAdmin,
        asignacionEspecialAdmin
      }),
    [selectedResponsableObj, selectedDepartamento, isAdmin, asignacionEspecialAdmin]
  );

  const handleCreateNuevoResp = async () => {
    if (savingNuevoResp || !nuevoRespNombre.trim()) return;
    setSavingNuevoResp(true);
    try {
      const res = await registrarNuevoResponsableRapido({
        nombre: nuevoRespNombre,
        departamentoNombre: nuevoRespDept || selectedDepartamento,
        cargo: nuevoRespCargo,
        sedeId: activeSedeId,
        creadoPor: currentUser ? `${currentUser.nombre} (${currentUser.usuario})` : "Sistema",
        existingResponsables: responsables
      });

      if (!res.exito || !res.responsable) {
        playSound("negative");
        showToast?.(res.error || "No se pudo registrar el responsable.");
        return;
      }

      setResponsables(res.listaActualizada);
      if (
        nuevoRespDept &&
        normalizeTextToken(nuevoRespDept) !== normalizeTextToken(selectedDepartamento)
      ) {
        setSelectedDepartamento(nuevoRespDept);
      }
      setSelectedResponsableId(res.responsable.id);
      setNuevoRespNombre("");
      setNuevoRespCargo("");
      setShowNuevoRespForm(false);
      playSound("positive");
      showToast?.(
        `Responsable "${res.responsable.nombre}" registrado en ${res.responsable.departamentoNombre}.`
      );
    } finally {
      setSavingNuevoResp(false);
    }
  };

  const handleClickCompleteOrder = () => {
    if (!relacionCheck.valido) {
      playSound("negative");
      showToast?.(relacionCheck.mensaje || "Verifique el responsable del departamento.");
      return;
    }
    if (
      isConsumoExterno &&
      !destinoExternoInstitucion.trim() &&
      !destinoExternoPersona.trim()
    ) {
      playSound("negative");
      showToast?.(
        "Para un Consumo Externo debe especificar la institución externa o persona receptora."
      );
      return;
    }
    if (!selectedResponsableObj || !selectedTipoConsumoObj) {
      playSound("negative");
      showToast?.("Seleccione el departamento, responsable y tipo de consumo del pedido.");
      return;
    }

    onCompleteOrder({
      departamentoNombre: selectedDepartamento,
      responsable: selectedResponsableObj,
      tipoConsumo: selectedTipoConsumoObj,
      destinoExternoInstitucion: isConsumoExterno ? destinoExternoInstitucion.trim() : undefined,
      destinoExternoPersona: isConsumoExterno ? destinoExternoPersona.trim() : undefined,
      asignacionEspecialAdmin
    });
  };

  const searchLower = orderProductSearch.trim().toLowerCase();
  const matchedProducts = products
    .filter(
      (p) =>
        orderCatalogId &&
        matchesCatalog(p.catalogId, orderCatalogId, availableCatalogos) &&
        (!searchLower ||
          p.nombre.toLowerCase().includes(searchLower) ||
          (p.descripcion || "").toLowerCase().includes(searchLower) ||
          p.codigo.toLowerCase().includes(searchLower))
    )
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const targetProduct = products.find((p) => p.codigo === orderSelectedProduct);

  const getProductCoordinates = (productCode: string) => {
    return blocks
      .flatMap((b) =>
        (b.items || [])
          .filter((item) => item.productCode === productCode)
          .map((item) => `Bl. ${b.id} • N. ${item.nivel}`)
      )
      .join(", ") || "No asignado";
  };

  const getDaysToExpiration = (dateStr: string) => {
    if (!dateStr) return Infinity;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expDate = new Date(dateStr + "T00:00:00");
    return Math.ceil((expDate.getTime() - today.getTime()) / 86400000);
  };

  const getNearestExpirationDate = (prod: Producto) => {
    if (!prod.lotes || prod.lotes.length === 0) return "—";
    const sortedDates = prod.lotes
      .filter((lot) => Number(lot.cantidad || 0) > 0)
      .map((l) => l.fechaVencimiento)
      .filter(Boolean)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    return sortedDates.length === 0 ? "—" : new Date(sortedDates[0]).toLocaleDateString("es-DO");
  };

  const selectedLotObj = targetProduct?.lotes.find((l) => l.id === orderSelectedLot);
  const activeCatalogName = availableCatalogos.find((c) => c.id === orderCatalogId)?.nombre || "Medicamentos e Insumos";

  return (
    <div className="anim-card-in mb-6 w-full min-w-0 max-w-full rounded-3xl bg-white border border-slate-200/90 shadow-xs overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-200 bg-slate-50/50">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-teal-700 font-extrabold">
            Salida de Medicamentos • Integrado con Consumos
          </p>
          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 flex items-center gap-2.5 mt-0.5">
            <ShoppingCart className="w-6 h-6 text-teal-600" />
            <span>Pedido Activo</span>
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {orderItems.length > 0 && (
            <>
              <button
                onClick={handleClickCompleteOrder}
                className="rounded-xl bg-teal-700 hover:bg-teal-600 text-white px-4 py-2.5 text-xs font-extrabold transition shadow-xs cursor-pointer"
              >
                Completar Pedido y Registrar Consumo
              </button>
              <button
                onClick={() => exportOrderToPDF(orderItems, activeCatalogName)}
                className="rounded-xl border border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 px-3.5 py-2.5 text-xs font-extrabold transition flex items-center gap-1.5 cursor-pointer"
                title="Exportar Pedido a PDF"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Exportar PDF</span>
              </button>
              <button
                onClick={() => exportOrderToWord(orderItems, activeCatalogName)}
                className="rounded-xl border border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 px-3.5 py-2.5 text-xs font-extrabold transition flex items-center gap-1.5 cursor-pointer"
                title="Exportar Pedido a Word"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>Exportar Word</span>
              </button>
              <button
                onClick={onShareOrderByWhatsApp}
                className="rounded-xl border border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100 px-3.5 py-2.5 text-xs font-extrabold transition flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>WhatsApp</span>
              </button>
              <button
                onClick={onClearOrder}
                className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 px-3.5 py-2.5 text-xs font-extrabold transition flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Limpiar</span>
              </button>
            </>
          )}
          <button
            onClick={onCloseOrderPanel}
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-extrabold text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
        {/* Bloque de Destino del Pedido (Departamento, Responsable + botón Nuevo, y Tipo de Consumo) */}
        <div className="bg-teal-50/40 border border-teal-200/80 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase text-teal-900 tracking-wider flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-teal-600" />
              <span>Datos de Consumo Departamental del Pedido</span>
            </h3>
            <span className="text-[10px] font-bold text-teal-700 bg-teal-100/70 px-2.5 py-0.5 rounded-full self-start sm:self-auto">
              Se registrará automáticamente en «Consumos» al entregar
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 sm:gap-4 items-start">
            {/* 1. Departamento Destinatario */}
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1">
                Departamento Destinatario *
              </label>
              <select
                value={selectedDepartamento}
                onChange={(e) => setSelectedDepartamento(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-extrabold text-slate-800 outline-none focus:ring-2 focus:ring-teal-500/30 cursor-pointer"
              >
                {departamentosDisponibles.map((dept) => (
                  <option key={dept.id} value={dept.nombre}>
                    {dept.nombre}
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Responsable del Departamento + Botón Nuevo */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider">
                Responsable del Departamento *
              </label>
              <select
                value={selectedResponsableId}
                onChange={(e) => setSelectedResponsableId(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-extrabold text-slate-800 outline-none focus:ring-2 focus:ring-teal-500/30 cursor-pointer"
              >
                {activeResponsables.map((resp) => (
                  <option key={resp.id} value={resp.id}>
                    {resp.nombre} ({resp.departamentoNombre})
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setNuevoRespDept(selectedDepartamento);
                    setShowNuevoRespForm((prev) => !prev);
                  }}
                  className="inline-flex items-center gap-1 min-h-[34px] px-3 py-1.5 rounded-lg bg-white hover:bg-teal-50 text-teal-800 border border-teal-300 text-[11px] font-extrabold transition cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5 text-teal-600" />
                  <span>Nuevo</span>
                </button>
                {selectedResponsableObj && (
                  <span className="text-[10px] font-semibold text-slate-500">
                    Dpto: {selectedResponsableObj.departamentoNombre}
                  </span>
                )}
              </div>
            </div>

            {/* 3. Tipo de Consumo (Interno / Externo) */}
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-600 tracking-wider mb-1">
                Tipo de Consumo *
              </label>
              <select
                value={selectedTipoConsumoId}
                onChange={(e) => setSelectedTipoConsumoId(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-extrabold text-slate-800 outline-none focus:ring-2 focus:ring-teal-500/30 cursor-pointer"
              >
                {activeTiposConsumo.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre} ({t.categoria})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Formulario rápido de Nuevo Responsable */}
          {showNuevoRespForm && (
            <div className="bg-white border border-teal-200 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase text-teal-900">
                  Registrar Nuevo Responsable del Departamento
                </span>
                <button
                  type="button"
                  onClick={() => setShowNuevoRespForm(false)}
                  className="text-slate-400 hover:text-slate-700 cursor-pointer p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  type="text"
                  value={nuevoRespNombre}
                  onChange={(e) => setNuevoRespNombre(e.target.value)}
                  placeholder="Nombre del responsable *"
                  className="w-full min-h-[40px] bg-slate-50 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800"
                />
                <select
                  value={nuevoRespDept}
                  onChange={(e) => setNuevoRespDept(e.target.value)}
                  className="w-full min-h-[40px] bg-slate-50 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800"
                >
                  {departamentosDisponibles.map((d) => (
                    <option key={d.id} value={d.nombre}>
                      {d.nombre}
                    </option>
                  ))}
                </select>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={nuevoRespCargo}
                    onChange={(e) => setNuevoRespCargo(e.target.value)}
                    placeholder="Cargo (opcional)"
                    className="w-full flex-1 min-h-[40px] bg-slate-50 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800"
                  />
                  <button
                    type="button"
                    onClick={handleCreateNuevoResp}
                    disabled={savingNuevoResp || !nuevoRespNombre.trim()}
                    className="w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 text-white text-xs font-extrabold cursor-pointer shrink-0"
                  >
                    Guardar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Campos adicionales si el consumo es Externo */}
          {isConsumoExterno && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-amber-50/80 border border-amber-200 rounded-xl p-3">
              <div>
                <label className="block text-[10px] font-black uppercase text-amber-900 mb-1">
                  Institución / Destino Externo *
                </label>
                <input
                  type="text"
                  value={destinoExternoInstitucion}
                  onChange={(e) => setDestinoExternoInstitucion(e.target.value)}
                  placeholder="Ej: Centro de Salud / Operativo Externo"
                  className="w-full min-h-[40px] bg-white rounded-lg border border-amber-200 px-3 py-2 text-xs font-bold text-slate-800"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-amber-900 mb-1">
                  Persona Receptora Externa
                </label>
                <input
                  type="text"
                  value={destinoExternoPersona}
                  onChange={(e) => setDestinoExternoPersona(e.target.value)}
                  placeholder="Nombre de quien recibe"
                  className="w-full min-h-[40px] bg-white rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-slate-800"
                />
              </div>
            </div>
          )}

          {/* Validación relación departamento ↔ responsable */}
          {!relacionCheck.valido && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span className="font-semibold">{relacionCheck.mensaje}</span>
              </div>
              {isAdmin && (
                <label className="inline-flex items-center gap-1.5 font-extrabold text-amber-950 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={asignacionEspecialAdmin}
                    onChange={(e) => setAsignacionEspecialAdmin(e.target.checked)}
                  />
                  <span>Autorizar asignación especial</span>
                </label>
              )}
            </div>
          )}
        </div>

        {/* Selector de Catálogo */}
        <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-xs font-extrabold uppercase text-slate-700 tracking-wider">Catálogo de Trabajo *</h3>
            <p className="text-xs text-slate-500 font-medium">Seleccione el catálogo de origen para seleccionar insumos</p>
          </div>
          <select
            value={orderCatalogId}
            onChange={(e) => onSetOrderCatalogId(e.target.value)}
            className="w-full sm:max-w-xs rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-teal-500/30 cursor-pointer"
          >
            <option value="">-- Seleccione un catálogo --</option>
            {availableCatalogos.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="w-full max-w-full overflow-x-auto overscroll-x-contain touch-pan-x [-webkit-overflow-scrolling:touch] border border-slate-200/90 rounded-2xl bg-slate-50">
          <table className="min-w-[650px] w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-extrabold text-slate-600 uppercase tracking-wider">
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Lote</th>
                <th className="px-4 py-3">Vencimiento</th>
                <th className="px-4 py-3 text-right">Cantidad Solicitada</th>
                <th className="px-4 py-3 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {orderItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400 font-medium bg-white">
                    No hay productos en el pedido. Selecciona un medicamento e introduce un lote abajo.
                  </td>
                </tr>
              ) : (
                orderItems.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50 bg-white transition">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => onOpenProductDetail?.(item.productCode)}
                        className="text-teal-800 font-extrabold hover:underline cursor-pointer text-left focus:outline-none"
                        title="Ver detalles del insumo"
                      >
                        {item.codigo}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800 max-w-[200px]">
                      <button
                        onClick={() => onOpenProductDetail?.(item.productCode)}
                        className="font-semibold text-slate-800 text-sm hover:underline cursor-pointer text-left w-full focus:outline-none"
                        title="Ver detalles del insumo"
                      >
                        <MarqueeText text={item.nombre} className="w-full" textClassName="font-semibold text-slate-800 text-sm" />
                      </button>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-600">{item.loteNumero}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {new Date(item.fecha + "T00:00:00").toLocaleDateString("es-DO")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        min="1"
                        value={item.cantidadAprobada}
                        onChange={(e) => onUpdateOrderItemQuantity(idx, Number(e.target.value))}
                        className="w-20 text-right rounded-lg border border-slate-200 px-2 py-1.5 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-teal-400 bg-slate-50 font-sans"
                      />
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        onClick={() => onOpenProductDetail?.(item.productCode)}
                        className="text-xs font-bold text-teal-600 hover:text-teal-800 hover:underline cursor-pointer"
                      >
                        Ver Detalle
                      </button>
                      <span className="text-slate-300">|</span>
                      <button
                        onClick={() => onRemoveOrderItem(idx)}
                        className="text-xs font-bold text-rose-600 hover:text-rose-800 hover:underline cursor-pointer"
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <h3 className="text-xs font-black uppercase text-slate-500 tracking-wider">1. Buscar Medicamento</h3>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Filtrar por nombre, descripción..."
                value={orderProductSearch}
                onChange={(e) => onUpdateOrderProductSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {!orderCatalogId ? (
                <div className="text-center text-xs text-amber-600 bg-amber-50/50 border border-amber-200/60 rounded-2xl p-4 py-8">
                  <span className="text-2xl block mb-2">⚠️</span>
                  <span className="font-bold uppercase tracking-wider text-[10px]">No se muestran productos</span>
                  <p className="text-slate-500 mt-1.5 font-medium">Por favor seleccione un catálogo arriba primero.</p>
                </div>
              ) : matchedProducts.length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-6">No se encontraron medicamentos</p>
              ) : (
                matchedProducts.map((p) => {
                  const coords = getProductCoordinates(p.codigo);
                  const totalStockSis = p.lotes.reduce((sum, l) => sum + Number(l.cantidad || 0), 0);
                  const totalStockFis = p.lotes.reduce((sum, l) => sum + Number(l.cantidadF || 0), 0);
                  const isSelected = orderSelectedProduct === p.codigo;

                  return (
                    <div
                      key={p.codigo}
                      onClick={() => onSelectOrderProduct(p.codigo)}
                      className={`w-full text-left rounded-xl border p-3 flex justify-between items-start transition cursor-pointer ${
                        isSelected
                          ? "border-teal-500 bg-white shadow-sm ring-1 ring-teal-200"
                          : "border-slate-200 bg-white hover:bg-slate-100/50"
                      }`}
                    >
                      <div className="min-w-0 pr-2 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="block text-[9px] font-black text-teal-700">{p.codigo}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenProductDetail?.(p.codigo);
                            }}
                            className="text-[9px] text-teal-600 hover:text-teal-800 hover:underline font-bold cursor-pointer"
                          >
                            (Ver Detalle)
                          </button>
                        </div>
                        <MarqueeText text={p.nombre} className="w-full" textClassName="font-bold text-slate-800 text-xs" />
                        <p className="text-[10px] text-slate-500 line-clamp-1">{coords}</p>
                        {p.descripcion && (
                          <p className="text-[10px] text-slate-500 mt-1 italic line-clamp-2 border-t border-slate-100 pt-1" title={p.descripcion}>
                            {p.descripcion}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <span className={`block font-black text-[11px] ${totalStockSis > 0 ? "text-teal-800" : "text-rose-600"}`}>
                          Sis: {totalStockSis} und
                        </span>
                        <span className={`block font-black text-[11px] ${totalStockFis > 0 ? "text-blue-800" : "text-rose-600"}`}>
                          Fís: {totalStockFis} und
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4">
            <h3 className="text-xs font-black uppercase text-slate-500 tracking-wider">2. Seleccionar Lote & Cantidad</h3>
            {targetProduct ? (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border border-slate-200 p-3">
                  <span className="block text-[9px] font-black text-teal-700">{targetProduct.codigo}</span>
                  <MarqueeText text={targetProduct.nombre} className="w-full" textClassName="font-bold text-slate-800 text-sm" />
                  {targetProduct.descripcion && (
                    <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg p-2.5 mt-2 font-medium italic">
                      Descripción: {targetProduct.descripcion}
                    </p>
                  )}
                  <p className="text-xs text-slate-500 mt-2">
                    Vencimiento más próximo: {getNearestExpirationDate(targetProduct)}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    Selecciona Lote
                  </label>
                  <select
                    value={orderSelectedLot || ""}
                    onChange={(e) => onSetOrderSelectedLot(e.target.value || null)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 outline-none focus:ring-2 focus:ring-teal-400"
                  >
                    <option value="">-- Elige lote disponible --</option>
                    {targetProduct.lotes
                      .filter((l) => Math.max(Number(l.cantidad || 0), Number(l.cantidadF || 0)) > 0)
                      .map((l) => {
                        const sisQty = Number(l.cantidad || 0);
                        const fisQty = Number(l.cantidadF || 0);
                        const daysTo = getDaysToExpiration(l.fechaVencimiento);
                        let prefix = "🟢";
                        let suffix = "";
                        if (sisQty <= 0 || fisQty <= 0) {
                          prefix = "⛔ [STOCK INCOMPLETO]";
                        } else if (daysTo < 0 && isLotExpiredWithStock(l)) {
                          prefix = "🔴 [VENCIDO]";
                          suffix = ` (HACE ${Math.abs(daysTo)} DÍAS)`;
                        } else if (daysTo <= 30) {
                          prefix = "⚠️ [POR VENCER]";
                          suffix = ` (EN ${daysTo} DÍAS)`;
                        } else if (daysTo <= 90) {
                          prefix = "🟡 [PRÓXIMO]";
                          suffix = ` (EN ${daysTo} DÍAS)`;
                        }
                        return (
                          <option key={l.id} value={l.id}>
                            {prefix} Lote: {l.numeroLote} • {new Date(l.fechaVencimiento + "T00:00:00").toLocaleDateString("es-DO")} • (Sis: {sisQty} | Fís: {fisQty} und.){suffix}
                          </option>
                        );
                      })}
                  </select>
                </div>

                {selectedLotObj && (() => {
                  const alreadyInOrderQty = orderItems
                    .filter((it) => it.productCode === targetProduct.codigo && it.loteId === selectedLotObj.id)
                    .reduce((sum, it) => sum + Number(it.cantidadAprobada || 0), 0);
                  const rawSistema = Number(selectedLotObj.cantidad || 0);
                  const rawFisico = Number(selectedLotObj.cantidadF || 0);
                  const availSistema = Math.max(0, rawSistema - alreadyInOrderQty);
                  const availFisico = Math.max(0, rawFisico - alreadyInOrderQty);
                  const maxAvailable = Math.min(availSistema, availFisico);
                  const reqQty = Number(orderSelectedQuantity || 0);
                  const exceedsSistema = reqQty > availSistema;
                  const exceedsFisico = reqQty > availFisico;
                  const hasInsufficientStock = availSistema <= 0 || availFisico <= 0 || (reqQty > 0 && (exceedsSistema || exceedsFisico));

                  return (
                    <div className="anim-card-in space-y-3">
                      <div className={`border p-3 rounded-xl ${(() => {
                        const dTo = getDaysToExpiration(selectedLotObj.fechaVencimiento);
                        if (Number(selectedLotObj.cantidad || 0) <= 0) return "bg-white border-slate-200";
                        if (dTo < 0 && isLotExpiredWithStock(selectedLotObj)) return "bg-rose-50 border-rose-200 shadow-sm";
                        if (dTo <= 30) return "bg-amber-50 border-amber-200 shadow-sm animate-pulse";
                        if (dTo <= 90) return "bg-yellow-50 border-yellow-200 shadow-sm";
                        return "bg-white border-slate-200";
                      })()}`}>
                        <div className="flex justify-between items-center text-xs mb-1.5 pb-1.5 border-b border-slate-100 font-semibold">
                          <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Expiración:</span>
                          <span className={(() => {
                            const dTo = getDaysToExpiration(selectedLotObj.fechaVencimiento);
                            if (Number(selectedLotObj.cantidad || 0) <= 0) return "text-slate-600 font-semibold";
                            if (dTo < 0 && isLotExpiredWithStock(selectedLotObj)) return "text-rose-700 font-extrabold";
                            if (dTo <= 30) return "text-amber-700 font-extrabold";
                            if (dTo <= 90) return "text-yellow-700 font-bold";
                            return "text-emerald-700 font-bold";
                          })()}>
                            {(() => {
                              const dTo = getDaysToExpiration(selectedLotObj.fechaVencimiento);
                              if (Number(selectedLotObj.cantidad || 0) <= 0) return "Sin existencias";
                              if (dTo < 0 && isLotExpiredWithStock(selectedLotObj)) return `¡VENCIDO! (${Math.abs(dTo)}d atrás)`;
                              if (dTo <= 30) return `¡POR VENCER! (en ${dTo}d)`;
                              if (dTo <= 90) return `Vence pronto (en ${dTo}d)`;
                              return `Vigente (en ${dTo}d)`;
                            })()}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-slate-500 font-semibold">Ubicación Física:</span>
                          <span className="font-bold text-slate-800">{selectedLotObj.loteFisico || "No especificado"}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs mt-1.5">
                          <span className="text-slate-500 font-semibold">Precio de Adquisición:</span>
                          <span className="font-bold text-slate-800">RD$ {selectedLotObj.precio.toFixed(2)}</span>
                        </div>
                        <div className={`flex justify-between items-center text-xs mt-1.5 border-t border-slate-100 pt-1.5 font-bold ${availSistema > 0 ? "text-teal-800" : "text-rose-600"}`}>
                          <span>Stock Sistema Disponible:</span>
                          <span>{availSistema} und.{alreadyInOrderQty > 0 ? ` (Total: ${rawSistema})` : ""}</span>
                        </div>
                        <div className={`flex justify-between items-center text-xs font-bold ${availFisico > 0 ? "text-blue-800" : "text-rose-600"}`}>
                          <span>Stock Físico Disponible:</span>
                          <span>{availFisico} und.{alreadyInOrderQty > 0 ? ` (Total: ${rawFisico})` : ""}</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          Cantidad a Despachar (Máx. permitido: {maxAvailable} und.)
                        </label>
                        <input
                          type="number"
                          min="1"
                          max={maxAvailable > 0 ? maxAvailable : 1}
                          value={orderSelectedQuantity || ""}
                          onChange={(e) =>
                            onSetOrderSelectedQuantity(e.target.value ? Number(e.target.value) : null)
                          }
                          placeholder={maxAvailable > 0 ? `1 - ${maxAvailable} unidades` : "Sin stock disponible en ambos inventarios"}
                          className={`w-full rounded-xl border bg-white px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 ${
                            hasInsufficientStock
                              ? "border-rose-400 text-rose-800 focus:ring-rose-300 bg-rose-50/40"
                              : "border-slate-200 text-slate-800 focus:ring-teal-400"
                          }`}
                        />
                      </div>

                      {hasInsufficientStock && (
                        <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 font-semibold space-y-1">
                          <p className="font-extrabold uppercase tracking-wider text-[10px] text-rose-700">
                            ⚠️ Existencia insuficiente para agregar al pedido
                          </p>
                          {availSistema <= 0 || availFisico <= 0 ? (
                            <p>
                              Este lote no cuenta con unidades disponibles en{" "}
                              <span className="font-extrabold">
                                {availSistema <= 0 && availFisico <= 0
                                  ? "ninguno de los dos inventarios"
                                  : availSistema <= 0
                                  ? "el Inventario del Sistema"
                                  : "el Inventario Físico"}
                              </span>
                              .
                            </p>
                          ) : (
                            <p>
                              La cantidad solicitada (<span className="font-extrabold">{reqQty} und.</span>) supera la existencia disponible en{" "}
                              <span className="font-extrabold">
                                {exceedsSistema && exceedsFisico
                                  ? "ambos inventarios (Sistema y Físico)"
                                  : exceedsSistema
                                  ? "el Inventario del Sistema"
                                  : "el Inventario Físico"}
                              </span>
                              .
                            </p>
                          )}
                          <p className="text-[11px] font-bold text-rose-900 pt-0.5">
                            Disponible en Sistema: {availSistema} und. | Disponible en Físico: {availFisico} und. (Máx. permitido: {maxAvailable} und.)
                          </p>
                        </div>
                      )}

                      <button
                        onClick={onAddOrderItem}
                        disabled={!orderSelectedLot || !orderSelectedQuantity || orderSelectedQuantity <= 0}
                        className={`w-full rounded-xl text-white py-3 text-xs font-bold transition shadow-sm disabled:bg-slate-300 disabled:cursor-not-allowed uppercase tracking-wider cursor-pointer ${
                          hasInsufficientStock
                            ? "bg-rose-600 hover:bg-rose-700"
                            : "bg-teal-600 hover:bg-teal-700"
                        }`}
                      >
                        {hasInsufficientStock ? "Stock Insuficiente (Verificar Disponibilidad)" : "Añadir al pedido"}
                      </button>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <p className="text-center text-xs text-slate-400 py-12">
                {!orderCatalogId
                  ? "Por favor, seleccione un catálogo de trabajo primero."
                  : "Por favor, selecciona un suministro a la izquierda."}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
