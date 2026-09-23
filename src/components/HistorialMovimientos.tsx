import { useState, useEffect, useMemo } from "react";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { Movimiento, Usuario, InstitucionConfig } from "../types";
import { playSound } from "../utils/audio";
import {
  Calendar,
  Search,
  History,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  User,
  FileText,
  ChevronDown,
  ChevronUp,
  Package,
  Layers,
  List,
  CheckCircle2,
  DollarSign,
  FileDown
} from "lucide-react";
import MarqueeText from "./MarqueeText";
import { exportFacturaToPDF, exportFacturaToWord, FacturaExportData } from "../utils/exportUtils";

interface HistorialMovimientosProps {
  activeCatalogId: string;
  currentUser: Usuario | null;
  institucionConfig?: InstitucionConfig | null;
}

export interface FacturaGroup {
  facturaId: string; // Clave única de agrupación
  facturaDisplay: string; // Nombre visible de la factura
  isHistoricalLegacy: boolean;
  entradaId?: string;
  fecha: string;
  timestamp: number;
  usuario: string;
  items: Movimiento[];
  totalCantidad: number;
  totalCosto: number;
  estado: string;
  proveedor?: string;
  institucionSnapshot?: InstitucionConfig;
}

export default function HistorialMovimientos({
  activeCatalogId,
  currentUser,
  institucionConfig
}: HistorialMovimientosProps) {
  const [allMovements, setAllMovements] = useState<Movimiento[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"facturas" | "detallado">("facturas");
  const [filterType, setFilterType] = useState<string>("todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedFacturas, setExpandedFacturas] = useState<Record<string, boolean>>({});
  const [selectedFacturaModal, setSelectedFacturaModal] = useState<FacturaGroup | null>(null);
  const pageSize = 10;

  const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

  const fetchMovements = async () => {
    setLoading(true);
    if (isLocalFileMode) {
      let stored = localStorage.getItem("offline_movimientos");
      let list: Movimiento[] = [];
      if (stored) {
        try {
          list = JSON.parse(stored);
        } catch (e) {
          console.error(e);
        }
      }
      setAllMovements(list);
      setLoading(false);
      return;
    }

    try {
      const colRef = collection(db, "movimientos");
      const q = query(colRef, orderBy("timestamp", "desc"), limit(2000));
      const snapshot = await getDocs(q);
      const list: Movimiento[] = [];
      snapshot.forEach((docSnap) => {
        list.push({ id: docSnap.id, ...docSnap.data() } as Movimiento);
      });
      setAllMovements(list);
    } catch (err) {
      console.error("Error fetching movements:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMovements();

    if (isLocalFileMode) {
      window.addEventListener("offline_movimientos_update", fetchMovements);
      return () => {
        window.removeEventListener("offline_movimientos_update", fetchMovements);
      };
    }
  }, [isLocalFileMode]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterType, searchTerm, viewMode]);

  const handleRefresh = () => {
    playSound("action");
    fetchMovements();
    setCurrentPage(1);
  };

  // Toggle invoice accordion
  const toggleFacturaExpand = (facturaId: string) => {
    playSound("click");
    setExpandedFacturas((prev) => ({
      ...prev,
      [facturaId]: !prev[facturaId]
    }));
  };

  // Base permission filtering
  const allowedMovements = useMemo(() => {
    return allMovements.filter((mov) => {
      // 0. Filter by catalog ID
      const movCatalogId = mov.catalogId || "default-cat";
      if (movCatalogId !== activeCatalogId) {
        return false;
      }

      // 0b. Strict access control by department permissions for movement history
      if (currentUser) {
        const canSeeAll =
          currentUser.rol === "Administrador" ||
          currentUser.departamento === "Almacén y Suministro" ||
          currentUser.departamento === "Farmacia";
        if (!canSeeAll) {
          const userCats = currentUser.catalogos || [];
          if (userCats.length > 0) {
            if (!userCats.includes(movCatalogId)) {
              return false;
            }
          } else {
            const departmentCatalogIdMap: Record<string, string> = {
              Laboratorio: "laboratorio",
              Odontología: "odontologia"
            };
            const expectedCatalogId = departmentCatalogIdMap[currentUser.departamento];
            if (expectedCatalogId && movCatalogId !== expectedCatalogId) {
              return false;
            }
          }
        }
      }
      return true;
    });
  }, [allMovements, activeCatalogId, currentUser]);

  // Grouped invoices for entries
  const facturaGroups = useMemo(() => {
    const entryMovements = allowedMovements.filter((m) => m.tipoMovimiento === "Entrada");
    const map = new Map<string, FacturaGroup>();

    entryMovements.forEach((mov) => {
      const hasFactura = Boolean(mov.factura && mov.factura.trim());
      // Clave de agrupación
      let groupKey = "";
      let displayName = "";

      if (hasFactura) {
        const facClean = mov.factura!.trim().toUpperCase();
        groupKey = `FAC_${facClean}`;
        displayName = facClean;
      } else if (mov.entradaId && mov.entradaId.trim()) {
        groupKey = `ENT_${mov.entradaId.trim()}`;
        displayName = `Entrada ${mov.entradaId.trim()}`;
      } else {
        // Registro histórico previo sin factura: agrupar por fecha y usuario
        const dateKey = mov.fecha ? mov.fecha.split("T")[0] : "Historico";
        groupKey = `LEGACY_${dateKey}_${mov.usuario || "sistema"}`;
        const dateFormatted = mov.fecha ? new Date(mov.fecha).toLocaleDateString("es-DO") : "Fecha no disp.";
        displayName = `Entrada Histórica (${dateFormatted})`;
      }

      if (!map.has(groupKey)) {
        map.set(groupKey, {
          facturaId: groupKey,
          facturaDisplay: displayName,
          isHistoricalLegacy: !hasFactura,
          entradaId: mov.entradaId,
          fecha: mov.fecha,
          timestamp: mov.timestamp || 0,
          usuario: mov.usuario || "Sistema",
          items: [],
          totalCantidad: 0,
          totalCosto: 0,
          estado: mov.estado || "Completada",
          proveedor: mov.proveedor,
          institucionSnapshot: mov.institucionSnapshot
        });
      }

      const grp = map.get(groupKey)!;
      grp.items.push(mov);
      grp.totalCantidad += Number(mov.cantidad || 0);
      grp.totalCosto += Number(mov.cantidad || 0) * Number(mov.precio || 0);
      if (mov.proveedor && !grp.proveedor) {
        grp.proveedor = mov.proveedor;
      }
      if (mov.institucionSnapshot && !grp.institucionSnapshot) {
        grp.institucionSnapshot = mov.institucionSnapshot;
      }
      if (mov.timestamp && mov.timestamp > grp.timestamp) {
        grp.timestamp = mov.timestamp;
        grp.fecha = mov.fecha;
      }
    });

    return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
  }, [allowedMovements]);

  // Filtered invoices by search term
  const filteredFacturas = useMemo(() => {
    if (!searchTerm.trim()) return facturaGroups;
    const term = searchTerm.toLowerCase();
    return facturaGroups.filter((g) => {
      const matchHeader =
        g.facturaDisplay.toLowerCase().includes(term) ||
        g.usuario.toLowerCase().includes(term) ||
        (g.proveedor && g.proveedor.toLowerCase().includes(term)) ||
        (g.entradaId && g.entradaId.toLowerCase().includes(term));
      if (matchHeader) return true;
      // Search inside items
      return g.items.some(
        (it) =>
          it.productoCodigo.toLowerCase().includes(term) ||
          it.productoNombre.toLowerCase().includes(term) ||
          it.lote.toLowerCase().includes(term)
      );
    });
  }, [facturaGroups, searchTerm]);

  // Handle Export of Invoice to PDF or Word
  const handleExportFactura = (group: FacturaGroup, format: "pdf" | "word") => {
    playSound("action");
    // Priority: snapshot saved with invoice, or current institutional config
    const inst = group.institucionSnapshot || institucionConfig || null;

    const exportData: FacturaExportData = {
      facturaId: group.facturaId,
      facturaDisplay: group.facturaDisplay,
      isHistoricalLegacy: group.isHistoricalLegacy,
      fecha: group.fecha,
      usuario: group.usuario,
      proveedor: group.proveedor,
      estado: group.estado,
      items: group.items.map((it) => ({
        productoCodigo: it.productoCodigo,
        productoNombre: it.productoNombre,
        lote: it.lote,
        cantidad: Number(it.cantidad || 0),
        precio: Number(it.precio || 0)
      })),
      totalCantidad: group.totalCantidad,
      totalCosto: group.totalCosto,
      institucion: inst
    };

    if (format === "pdf") {
      exportFacturaToPDF(exportData);
    } else {
      exportFacturaToWord(exportData);
    }
  };

  // Filtered detailed movements
  const filteredDetailedMovements = useMemo(() => {
    return allowedMovements.filter((mov) => {
      // Filter by type
      if (filterType !== "todos" && mov.tipoMovimiento !== filterType) {
        return false;
      }
      // Filter by search query
      if (!searchTerm.trim()) return true;
      const search = searchTerm.toLowerCase();
      return (
        mov.productoCodigo.toLowerCase().includes(search) ||
        mov.productoNombre.toLowerCase().includes(search) ||
        mov.lote.toLowerCase().includes(search) ||
        mov.usuario.toLowerCase().includes(search) ||
        (mov.factura && mov.factura.toLowerCase().includes(search))
      );
    });
  }, [allowedMovements, filterType, searchTerm]);

  // Pagination
  const displayedFacturas = filteredFacturas.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const displayedDetailed = filteredDetailedMovements.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const totalPages =
    viewMode === "facturas"
      ? Math.ceil(filteredFacturas.length / pageSize) || 1
      : Math.ceil(filteredDetailedMovements.length / pageSize) || 1;

  const handleNextPage = () => {
    if (currentPage >= totalPages) return;
    playSound("click");
    setCurrentPage((prev) => prev + 1);
  };

  const handlePrevPage = () => {
    if (currentPage <= 1) return;
    playSound("click");
    setCurrentPage((prev) => prev - 1);
  };

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return "—";
    const date = new Date(dateStr);
    return isNaN(date.getTime())
      ? "—"
      : date.toLocaleString("es-DO", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
  };

  const getMovementBadgeClass = (type: string) => {
    switch (type) {
      case "Entrada":
        return "bg-emerald-500 text-white";
      case "Salida":
        return "bg-rose-500 text-white";
      case "Ajuste":
        return "bg-amber-500 text-slate-900";
      default:
        return "bg-slate-500 text-white";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Controls Card */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <History className="w-5 h-5 text-teal-600" />
              Historial de Movimientos y Facturas de Entrada
            </h3>
            <p className="text-slate-500 text-xs mt-1">
              Consulta las entradas agrupadas por número de factura o el registro detallado de salidas y ajustes
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="p-2.5 border border-slate-200 hover:border-teal-400 bg-slate-50 hover:bg-slate-100 rounded-xl transition text-slate-600 hover:text-teal-600 active:scale-95 flex items-center justify-center shadow-sm cursor-pointer"
              title="Actualizar historial"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-100">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
            <button
              type="button"
              onClick={() => {
                setViewMode("facturas");
                playSound("click");
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black transition cursor-pointer ${
                viewMode === "facturas"
                  ? "bg-white text-teal-800 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <FileText className="w-4 h-4 text-teal-600" />
              <span>Entradas Agrupadas por Factura</span>
              <span className="bg-teal-100 text-teal-800 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold">
                {facturaGroups.length}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("detallado");
                playSound("click");
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black transition cursor-pointer ${
                viewMode === "detallado"
                  ? "bg-white text-teal-800 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <List className="w-4 h-4 text-slate-500" />
              <span>Todos los Movimientos (Detalle)</span>
              <span className="bg-slate-200 text-slate-700 text-[10px] font-mono px-2 py-0.5 rounded-full font-bold">
                {allowedMovements.length}
              </span>
            </button>
          </div>

          <div className="text-xs text-slate-500 font-semibold">
            {viewMode === "facturas" ? (
              <span>Visualizando compras y entradas agrupadas por comprobante</span>
            ) : (
              <span>Auditoría línea por línea (Entradas, Salidas y Ajustes)</span>
            )}
          </div>
        </div>

        {/* Search & Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className={`relative ${viewMode === "facturas" ? "col-span-3" : "col-span-2"}`}>
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={
                viewMode === "facturas"
                  ? "Buscar por número de factura (ej. F100094), producto, lote o responsable..."
                  : "Buscar por código, nombre, lote, factura o responsable..."
              }
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>

          {viewMode === "detallado" && (
            <div>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-teal-400 font-semibold text-slate-700"
              >
                <option value="todos">Todos los movimientos</option>
                <option value="Entrada">Solo Entradas</option>
                <option value="Salida">Solo Salidas</option>
                <option value="Ajuste">Solo Ajustes</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === "facturas" ? (
        /* VISTA DE ENTRADAS AGRUPADAS POR FACTURA */
        <div className="space-y-4">
          {loading ? (
            <div className="bg-white rounded-3xl p-12 border border-slate-200 text-center shadow-sm">
              <div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
              <span className="text-xs text-slate-500 font-medium">Cargando facturas de entrada...</span>
            </div>
          ) : filteredFacturas.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 border border-slate-200 text-center text-slate-400 shadow-sm">
              <FileText className="w-10 h-10 mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-bold text-slate-600">No se encontraron facturas ni entradas registradas</p>
              <p className="text-xs text-slate-400 mt-1">
                Utiliza el botón &quot;Registrar Producto&quot; para crear una nueva entrada con número de factura.
              </p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {displayedFacturas.map((group) => {
                const isExpanded = !!expandedFacturas[group.facturaId];
                return (
                  <div
                    key={group.facturaId}
                    className="bg-white rounded-2xl border border-slate-200 shadow-xs hover:border-slate-300 transition-all overflow-hidden"
                  >
                    {/* Invoice Card Header */}
                    <div
                      onClick={() => toggleFacturaExpand(group.facturaId)}
                      className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/70 transition"
                    >
                      <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                        <div className="w-11 h-11 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center shrink-0 text-teal-700">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-base font-black text-slate-900 tracking-tight">
                              {group.isHistoricalLegacy ? group.facturaDisplay : `Factura ${group.facturaDisplay}`}
                            </h4>
                            <span className="text-slate-400 font-normal text-xs">•</span>
                            <span className="text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200/60 px-2 py-0.5 rounded-md">
                              Entrada de productos
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 rounded-full">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              {group.estado || "Completada"}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-slate-500 mt-1.5 font-medium">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>{formatDateTime(group.fecha)}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="font-semibold text-slate-700">{group.usuario}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Package className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>
                                <strong className="text-slate-800 font-bold">{group.items.length}</strong> {group.items.length === 1 ? "producto" : "productos"} ({group.totalCantidad} unds.)
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right summary & expand action */}
                      <div className="flex flex-wrap items-center justify-between md:justify-end gap-3 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100">
                        <div className="text-left md:text-right mr-1">
                          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Total Factura
                          </span>
                          <span className="text-sm font-black text-slate-900">
                            {group.totalCosto > 0 ? `RD$ ${group.totalCosto.toLocaleString("es-DO", { minimumFractionDigits: 2 })}` : "—"}
                          </span>
                        </div>

                        {/* Quick export actions */}
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleExportFactura(group, "pdf");
                            }}
                            className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200/80 transition active:scale-95 cursor-pointer"
                            title="Descargar factura en PDF"
                          >
                            <FileDown className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleExportFactura(group, "word");
                            }}
                            className="p-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200/80 transition active:scale-95 cursor-pointer"
                            title="Descargar factura en Microsoft Word (.docx)"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFacturaExpand(group.facturaId);
                          }}
                          className="px-3 py-1.5 rounded-xl border border-slate-200 hover:border-teal-400 hover:bg-teal-50/50 text-xs font-bold text-teal-700 flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
                        >
                          <span>{isExpanded ? "Ocultar Detalle" : "Ver Detalle"}</span>
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Expandable Invoice Details Accordion */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50/70 p-4 sm:p-6 anim-slide-down space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <h5 className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                              <Layers className="w-3.5 h-3.5 text-teal-600" />
                              Productos incluidos en esta factura ({group.items.length})
                            </h5>
                            {group.proveedor && (
                              <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
                                Proveedor: <strong className="text-slate-700">{group.proveedor}</strong>
                              </p>
                            )}
                          </div>

                          {/* Detail Export Buttons */}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExportFactura(group, "pdf");
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition active:scale-95 shadow-2xs cursor-pointer"
                              title="Exportar esta factura completa a documento PDF"
                            >
                              <FileDown className="w-3.5 h-3.5 text-rose-600" />
                              <span>Exportar PDF</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleExportFactura(group, "word");
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-bold transition active:scale-95 shadow-2xs cursor-pointer"
                              title="Exportar esta factura completa a Microsoft Word (.docx)"
                            >
                              <FileText className="w-3.5 h-3.5 text-blue-600" />
                              <span>Exportar Word</span>
                            </button>
                          </div>
                        </div>

                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs border-collapse">
                              <thead>
                                <tr className="bg-slate-100/80 text-[11px] font-bold text-slate-600 uppercase tracking-wider border-b border-slate-200">
                                  <th className="py-2.5 px-4 text-center w-12">#</th>
                                  <th className="py-2.5 px-4">Código</th>
                                  <th className="py-2.5 px-4 min-w-[200px]">Medicamento / Insumo</th>
                                  <th className="py-2.5 px-4">Lote</th>
                                  <th className="py-2.5 px-4 text-right">Cantidad Ingresada</th>
                                  <th className="py-2.5 px-4 text-right">Costo Unit. (RD$)</th>
                                  <th className="py-2.5 px-4 text-right">Subtotal (RD$)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {group.items.map((it, idx) => {
                                  const subtotal = Number(it.cantidad || 0) * Number(it.precio || 0);
                                  return (
                                    <tr key={it.id || idx} className="hover:bg-slate-50/80 transition">
                                      <td className="py-2.5 px-4 text-center font-mono font-bold text-slate-400">
                                        {idx + 1}
                                      </td>
                                      <td className="py-2.5 px-4 font-mono font-bold text-teal-700">
                                        {it.productoCodigo}
                                      </td>
                                      <td className="py-2.5 px-4 font-semibold text-slate-800">
                                        {it.productoNombre}
                                      </td>
                                      <td className="py-2.5 px-4 font-mono font-bold text-slate-700">
                                        {it.lote}
                                      </td>
                                      <td className="py-2.5 px-4 text-right font-black text-slate-900">
                                        +{it.cantidad}
                                      </td>
                                      <td className="py-2.5 px-4 text-right font-medium text-slate-600">
                                        {it.precio != null && it.precio > 0 ? `RD$ ${it.precio.toFixed(2)}` : "—"}
                                      </td>
                                      <td className="py-2.5 px-4 text-right font-bold text-slate-800">
                                        {subtotal > 0 ? `RD$ ${subtotal.toFixed(2)}` : "—"}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* VISTA DETALLADA DE TODOS LOS MOVIMIENTOS (ENTRADAS, SALIDAS Y AJUSTES) */
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[850px] w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-5 py-4">Tipo</th>
                  <th className="px-5 py-4">Factura</th>
                  <th className="px-5 py-4">Suministro</th>
                  <th className="px-5 py-4">Lote</th>
                  <th className="px-5 py-4 text-right">Cantidad</th>
                  <th className="px-5 py-4 text-right">Costo / Precio</th>
                  <th className="px-5 py-4">Responsable</th>
                  <th className="px-5 py-4">Fecha y Hora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12">
                      <div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                      <span className="text-xs text-slate-500 font-medium">Cargando registros...</span>
                    </td>
                  </tr>
                ) : filteredDetailedMovements.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-slate-400">
                      <History className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      <p className="text-xs font-semibold">No se encontraron movimientos registrados</p>
                    </td>
                  </tr>
                ) : (
                  displayedDetailed.map((mov) => (
                    <tr key={mov.id} className="hover:bg-slate-50/50 transition">
                      <td className="px-5 py-4">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${getMovementBadgeClass(
                            mov.tipoMovimiento
                          )}`}
                        >
                          {mov.tipoMovimiento}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {mov.factura ? (
                          <span className="inline-flex items-center gap-1 font-mono font-bold text-xs bg-slate-100 text-slate-800 px-2.5 py-1 rounded-md border border-slate-200">
                            <FileText className="w-3 h-3 text-teal-600" />
                            {mov.factura}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="min-w-0">
                          <span className="block text-[10px] font-black text-teal-700">{mov.productoCodigo}</span>
                          <MarqueeText
                            text={mov.productoNombre}
                            className="w-full"
                            textClassName="font-semibold text-slate-800 text-sm"
                          />
                        </div>
                      </td>
                      <td className="px-5 py-4 font-mono font-bold text-slate-700">{mov.lote}</td>
                      <td className="px-5 py-4 text-right font-bold text-slate-800">
                        {mov.tipoMovimiento === "Salida" ? "-" : "+"}
                        {mov.cantidad}
                      </td>
                      <td className="px-5 py-4 text-right font-semibold text-slate-500">
                        {mov.precio != null && mov.precio > 0 ? `RD$ ${mov.precio.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="truncate max-w-[140px]" title={mov.usuario}>
                            {mov.usuario}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span>{formatDateTime(mov.fecha)}</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination Footer */}
      <div className="bg-white rounded-2xl border border-slate-200 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs">
        <span className="text-xs text-slate-500 font-semibold">
          {viewMode === "facturas" ? (
            <>
              Mostrando {displayedFacturas.length} de {filteredFacturas.length} facturas • Página {currentPage} de {totalPages}
            </>
          ) : (
            <>
              Mostrando {displayedDetailed.length} de {filteredDetailedMovements.length} movimientos • Página {currentPage} de {totalPages}
            </>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrevPage}
            disabled={currentPage <= 1 || loading}
            className="p-2 border border-slate-200 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition active:scale-95 text-slate-600 shrink-0 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleNextPage}
            disabled={currentPage >= totalPages || loading}
            className="p-2 border border-slate-200 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition active:scale-95 text-slate-600 shrink-0 cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
