import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Catalogo,
  ConsumoItem,
  Departamento,
  Lote,
  Producto,
  RegistroConsumo,
  ResponsableDepartamento,
  TipoConsumoConfig,
  Usuario,
  getUserAvailableCatalogos,
  matchesCatalog
} from "../types";
import { DEFAULT_FARMACIA_ID, getActiveFarmaciaId, tenantCollection, tenantDoc } from "../firebase";
import { onSnapshot } from "firebase/firestore";
import {
  agregarNotaCorreccionConsumo,
  calcularResumenPorDepartamento,
  ensureDefaultTiposConsumoPresent,
  ensureLicIrisAybarPresent,
  getPersonalPorDepartamento,
  getResponsablesTitularesPorDepartamento,
  loadLocalConsumos,
  loadLocalResponsables,
  loadLocalTiposConsumo,
  mergeDepartamentosSinDuplicados,
  normalizeTextToken,
  registrarConsumoAtomico,
  registrarNuevoResponsableRapido,
  saveLocalConsumos,
  saveLocalResponsables,
  saveLocalTiposConsumo,
  validarRelacionResponsableDepartamento,
  validateConsumoOperation
} from "../utils/consumosUtils";
import {
  TipoReporteConsumoExport,
  exportConsumoDetalleToPDF,
  exportConsumoDetalleToWord,
  exportConsumosReportToPDF,
  exportConsumosReportToWord
} from "../utils/exportUtils";
import { playSound } from "../utils/audio";
import {
  AlertCircle,
  BarChart3,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Eye,
  FileDown,
  FileText,
  Filter,
  Globe,
  History,
  Layers,
  Package,
  PackageMinus,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X
} from "lucide-react";

interface ConsumosPanelProps {
  currentUser: Usuario;
  products: Producto[];
  departamentos: Departamento[];
  catalogos: Catalogo[];
  activeCatalogId: string;
  activePeriod: string;
  sedeNombre?: string;
  onSelectCatalog?: (catalogId: string) => void;
  onProductsUpdated?: (updatedProducts: Producto[]) => void;
  showToast: (msg: string) => void;
}

export default function ConsumosPanel({
  currentUser,
  products,
  departamentos,
  catalogos,
  activeCatalogId,
  activePeriod,
  sedeNombre = "Sede Principal",
  onSelectCatalog,
  onProductsUpdated,
  showToast
}: ConsumosPanelProps) {
  const activeSedeId = getActiveFarmaciaId() || DEFAULT_FARMACIA_ID;
  const isAdmin = currentUser?.rol === "Administrador";

  // Sub-pestañas principales del módulo Consumos
  const [activeSubTab, setActiveSubTab] = useState<"registro" | "historial" | "resumen">("registro");

  // Departamentos combinados sin duplicar
  const departamentosDisponibles = useMemo(() => {
    const merged = mergeDepartamentosSinDuplicados(departamentos);
    return merged.filter((d) => d.activo !== false);
  }, [departamentos]);

  // Catálogos permitidos para el usuario actual
  const availableCatalogos = useMemo(
    () => getUserAvailableCatalogos(currentUser, catalogos),
    [currentUser, catalogos]
  );

  // Estado sincronizado de Responsables, Tipos de Consumo y Registros de Consumo
  const [responsables, setResponsables] = useState<ResponsableDepartamento[]>(() =>
    loadLocalResponsables(activeSedeId)
  );
  const [tiposConsumo, setTiposConsumo] = useState<TipoConsumoConfig[]>(() =>
    loadLocalTiposConsumo(activeSedeId)
  );
  const [consumos, setConsumos] = useState<RegistroConsumo[]>(() =>
    loadLocalConsumos(activeSedeId)
  );

  // Sincronización con Firestore y eventos locales
  useEffect(() => {
    const refreshLocal = () => {
      setResponsables(loadLocalResponsables(activeSedeId));
      setTiposConsumo(loadLocalTiposConsumo(activeSedeId));
      setConsumos(loadLocalConsumos(activeSedeId));
    };

    refreshLocal();
    window.addEventListener("consumos_config_updated", refreshLocal);
    window.addEventListener("consumos_registros_updated", refreshLocal);

    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    let unsubConfig: (() => void) | undefined;
    let unsubConsumos: (() => void) | undefined;

    if (!isLocalFileMode) {
      unsubConfig = onSnapshot(
        tenantDoc("configuracion", "consumos_config", activeSedeId),
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (Array.isArray(data.responsables)) {
              const normResp = ensureLicIrisAybarPresent(data.responsables, activeSedeId);
              setResponsables(normResp);
              saveLocalResponsables(normResp, activeSedeId);
            }
            if (Array.isArray(data.tiposConsumo)) {
              const normTipos = ensureDefaultTiposConsumoPresent(data.tiposConsumo, activeSedeId);
              setTiposConsumo(normTipos);
              saveLocalTiposConsumo(normTipos, activeSedeId);
            }
          }
        },
        (err) => console.warn("Aviso escuchando consumos_config:", err)
      );

      unsubConsumos = onSnapshot(
        tenantDoc("configuracion", "registro_consumos", activeSedeId),
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (Array.isArray(data.consumos)) {
              const list = [...(data.consumos as RegistroConsumo[])].sort(
                (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
              );
              setConsumos(list);
              saveLocalConsumos(list, activeSedeId);
            }
          }
        },
        (err) => console.warn("Aviso escuchando registro_consumos:", err)
      );
    }

    return () => {
      window.removeEventListener("consumos_config_updated", refreshLocal);
      window.removeEventListener("consumos_registros_updated", refreshLocal);
      if (unsubConfig) unsubConfig();
      if (unsubConsumos) unsubConsumos();
    };
  }, [activeSedeId]);

  // ============================================================================
  // ESTADOS DEL FORMULARIO DE REGISTRO DE NUEVO CONSUMO
  // ============================================================================
  const canChooseAnyDepartment =
    isAdmin ||
    normalizeTextToken(currentUser.departamento).includes("farmacia") ||
    normalizeTextToken(currentUser.departamento).includes("almacen");

  const defaultDeptName = useMemo(() => {
    if (!canChooseAnyDepartment && currentUser.departamento) {
      return currentUser.departamento;
    }
    const enf = departamentosDisponibles.find(
      (d) => normalizeTextToken(d.nombre) === normalizeTextToken("Enfermería")
    );
    return enf?.nombre || departamentosDisponibles[0]?.nombre || "Enfermería";
  }, [canChooseAnyDepartment, currentUser.departamento, departamentosDisponibles]);

  const [selectedDepartamento, setSelectedDepartamento] = useState<string>(defaultDeptName);
  const [selectedResponsableId, setSelectedResponsableId] = useState<string>("resp-iris-aybar");
  const [asignacionEspecialAdmin, setAsignacionEspecialAdmin] = useState<boolean>(false);
  const [selectedTipoConsumoId, setSelectedTipoConsumoId] = useState<string>("tipo-interno");
  const [destinoExternoInstitucion, setDestinoExternoInstitucion] = useState<string>("");
  const [destinoExternoPersona, setDestinoExternoPersona] = useState<string>("");
  const [fechaConsumo, setFechaConsumo] = useState<string>(() =>
    new Date().toLocaleDateString("en-CA")
  );
  const [observaciones, setObservaciones] = useState<string>("");
  const [selectedCatalogId, setSelectedCatalogId] = useState<string>(
    activeCatalogId || availableCatalogos[0]?.id || "default-cat"
  );

  // Sincronizar catálogo activo cuando cambia externamente
  useEffect(() => {
    if (activeCatalogId && availableCatalogos.some((c) => c.id === activeCatalogId)) {
      setSelectedCatalogId(activeCatalogId);
    }
  }, [activeCatalogId, availableCatalogos]);

  // Modal / Panel rápido para botón "Nuevo" debajo de Responsable del departamento
  const [showNuevoResponsableModal, setShowNuevoResponsableModal] = useState<boolean>(false);
  const [nuevoRespNombre, setNuevoRespNombre] = useState<string>("");
  const [nuevoRespCargo, setNuevoRespCargo] = useState<string>("");
  const [nuevoRespDept, setNuevoRespDept] = useState<string>(selectedDepartamento);
  const [nuevoRespTelefono, setNuevoRespTelefono] = useState<string>("");
  const [nuevoRespEsSubalterno, setNuevoRespEsSubalterno] = useState<boolean>(false);
  const [nuevoRespSuperiorId, setNuevoRespSuperiorId] = useState<string>("");
  const [savingNuevoResp, setSavingNuevoResp] = useState<boolean>(false);

  useEffect(() => {
    setNuevoRespDept(selectedDepartamento);
  }, [selectedDepartamento]);

  // Responsables titulares del departamento seleccionado en el formulario "Nuevo"
  const titularesParaNuevoSubalterno = useMemo(
    () => getResponsablesTitularesPorDepartamento(responsables, nuevoRespDept || selectedDepartamento),
    [responsables, nuevoRespDept, selectedDepartamento]
  );

  useEffect(() => {
    if (nuevoRespEsSubalterno) {
      if (
        !nuevoRespSuperiorId ||
        !titularesParaNuevoSubalterno.some((t) => t.id === nuevoRespSuperiorId)
      ) {
        setNuevoRespSuperiorId(titularesParaNuevoSubalterno[0]?.id || "");
      }
    } else {
      setNuevoRespSuperiorId("");
    }
  }, [nuevoRespEsSubalterno, titularesParaNuevoSubalterno, nuevoRespSuperiorId]);

  // Selección de productos e insumos
  const [productSearch, setProductSearch] = useState<string>("");
  const [selectedProductCode, setSelectedProductCode] = useState<string>("");
  const [selectedLotId, setSelectedLotId] = useState<string>("");
  const [cantidadInput, setCantidadInput] = useState<number>(1);
  const [draftItems, setDraftItems] = useState<ConsumoItem[]>([]);

  // Modal de vista previa y confirmación atómica
  const [showConfirmPreview, setShowConfirmPreview] = useState<boolean>(false);
  const [submittingConsumo, setSubmittingConsumo] = useState<boolean>(false);
  const submitLockRef = useRef<boolean>(false);
  const [lastConfirmedConsumo, setLastConfirmedConsumo] = useState<RegistroConsumo | null>(null);

  // Personal activo del departamento seleccionado: únicamente el responsable asignado a ese departamento y sus subalternos
  const activeResponsables = useMemo(
    () => getPersonalPorDepartamento(responsables, selectedDepartamento),
    [responsables, selectedDepartamento]
  );

  // Auto-seleccionar al responsable (o primer subalterno) del departamento cuando cambia el departamento
  useEffect(() => {
    const currentResp = activeResponsables.find((r) => r.id === selectedResponsableId);
    if (!currentResp) {
      if (activeResponsables.length > 0) {
        setSelectedResponsableId(activeResponsables[0].id);
        setAsignacionEspecialAdmin(false);
      } else {
        setSelectedResponsableId("");
      }
    }
  }, [selectedDepartamento, activeResponsables, selectedResponsableId]);

  const selectedResponsableObj = useMemo(
    () => activeResponsables.find((r) => r.id === selectedResponsableId) || null,
    [activeResponsables, selectedResponsableId]
  );

  const relacionResponsableCheck = useMemo(
    () =>
      validarRelacionResponsableDepartamento({
        responsable: selectedResponsableObj,
        departamentoNombre: selectedDepartamento,
        esAdmin: isAdmin,
        asignacionEspecialAdmin
      }),
    [selectedResponsableObj, selectedDepartamento, isAdmin, asignacionEspecialAdmin]
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

  // Filtrar productos por catálogo seleccionado y búsqueda
  const catalogProducts = useMemo(() => {
    return (products || []).filter((p) =>
      matchesCatalog(p.catalogId || "default-cat", selectedCatalogId, catalogos)
    );
  }, [products, selectedCatalogId, catalogos]);

  const filteredProductsSearch = useMemo(() => {
    const q = normalizeTextToken(productSearch);
    return catalogProducts
      .filter((p) => {
        if (!q) return true;
        return (
          normalizeTextToken(p.nombre).includes(q) ||
          normalizeTextToken(p.codigo).includes(q) ||
          normalizeTextToken(p.descripcion).includes(q)
        );
      })
      .slice(0, 40);
  }, [catalogProducts, productSearch]);

  const selectedProductObj = useMemo(
    () => catalogProducts.find((p) => p.codigo === selectedProductCode) || null,
    [catalogProducts, selectedProductCode]
  );

  // Calcular cuánto stock ya está reservado en draftItems para cada producto+lote
  const getDraftReservedForLot = (productoCodigo: string, loteId: string): number => {
    return draftItems
      .filter((it) => it.productoCodigo === productoCodigo && it.loteId === loteId)
      .reduce((acc, it) => acc + Number(it.cantidadEntregada || 0), 0);
  };

  const getLotAvailableStock = (productoCodigo: string, lot: Lote): number => {
    const sis = Number(lot.cantidad || 0);
    const fis = lot.cantidadF !== undefined ? Number(lot.cantidadF) : sis;
    const baseAvail = Math.min(sis, fis);
    const reserved = getDraftReservedForLot(productoCodigo, lot.id);
    return Math.max(0, baseAvail - reserved);
  };

  const selectedLotObj = useMemo(() => {
    if (!selectedProductObj) return null;
    return (selectedProductObj.lotes || []).find((l) => l.id === selectedLotId) || null;
  }, [selectedProductObj, selectedLotId]);

  const handleSelectProduct = (prod: Producto) => {
    setSelectedProductCode(prod.codigo);
    // Seleccionar automáticamente el primer lote con existencia disponible
    const firstWithStock =
      (prod.lotes || []).find((l) => getLotAvailableStock(prod.codigo, l) > 0) ||
      prod.lotes?.[0] ||
      null;
    setSelectedLotId(firstWithStock ? firstWithStock.id : "");
    setCantidadInput(1);
    playSound("click");
  };

  const handleAddItemToDraft = () => {
    if (!selectedProductObj) {
      playSound("negative");
      showToast("Seleccione un producto o insumo del catálogo.");
      return;
    }
    if (!selectedLotObj) {
      playSound("negative");
      showToast(`Seleccione un lote válido para "${selectedProductObj.nombre}".`);
      return;
    }
    const qty = Number(cantidadInput || 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      playSound("negative");
      showToast("La cantidad a entregar debe ser mayor que cero.");
      return;
    }

    const available = getLotAvailableStock(selectedProductObj.codigo, selectedLotObj);
    if (qty > available) {
      playSound("negative");
      showToast(
        `Cantidad superior al stock disponible en el lote ${selectedLotObj.numeroLote}. Disponible real: ${available} und.`
      );
      return;
    }

    const catObj = catalogos.find((c) => c.id === selectedCatalogId);
    const existingIndex = draftItems.findIndex(
      (it) => it.productoCodigo === selectedProductObj.codigo && it.loteId === selectedLotObj.id
    );

    if (existingIndex >= 0) {
      const updated = [...draftItems];
      const nextQty = updated[existingIndex].cantidadEntregada + qty;
      const price = Number(selectedLotObj.precio || 0);
      updated[existingIndex] = {
        ...updated[existingIndex],
        cantidadEntregada: nextQty,
        subtotal: Number((nextQty * price).toFixed(2))
      };
      setDraftItems(updated);
    } else {
      const price = Number(selectedLotObj.precio || 0);
      const newItem: ConsumoItem = {
        id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        productoCodigo: selectedProductObj.codigo,
        productoNombre: selectedProductObj.nombre,
        descripcion: selectedProductObj.descripcion,
        catalogId: selectedCatalogId,
        catalogNombre: catObj?.nombre || "Medicamentos e Insumos",
        loteId: selectedLotObj.id,
        numeroLote: selectedLotObj.numeroLote,
        loteFisico: selectedLotObj.loteFisico,
        fechaVencimiento: selectedLotObj.fechaVencimiento,
        cantidadEntregada: qty,
        precioUnitario: price,
        subtotal: Number((qty * price).toFixed(2))
      };
      setDraftItems((prev) => [...prev, newItem]);
    }

    setCantidadInput(1);
    playSound("action");
    showToast(`"${selectedProductObj.nombre}" agregado a la lista de consumo.`);
  };

  const handleUpdateDraftItemQuantity = (itemId: string, newQty: number) => {
    const target = draftItems.find((i) => i.id === itemId);
    if (!target) return;
    if (newQty <= 0) {
      playSound("negative");
      showToast("La cantidad debe ser mayor que cero.");
      return;
    }

    const prod = products.find((p) => p.codigo === target.productoCodigo);
    const lot = prod?.lotes.find((l) => l.id === target.loteId);
    if (!prod || !lot) return;

    const otherRowsReserved = draftItems
      .filter(
        (it) =>
          it.id !== itemId &&
          it.productoCodigo === target.productoCodigo &&
          it.loteId === target.loteId
      )
      .reduce((acc, it) => acc + Number(it.cantidadEntregada || 0), 0);

    const maxLotAvail = Math.min(
      Number(lot.cantidad || 0),
      lot.cantidadF !== undefined ? Number(lot.cantidadF) : Number(lot.cantidad || 0)
    );
    const maxForThisRow = Math.max(0, maxLotAvail - otherRowsReserved);

    if (newQty > maxForThisRow) {
      playSound("negative");
      showToast(
        `No puede entregar más de lo disponible en el lote ${lot.numeroLote} (Máx: ${maxForThisRow} und.).`
      );
      return;
    }

    setDraftItems((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? {
              ...it,
              cantidadEntregada: newQty,
              subtotal: Number((newQty * Number(it.precioUnitario || 0)).toFixed(2))
            }
          : it
      )
    );
  };

  const handleRemoveDraftItem = (itemId: string) => {
    setDraftItems((prev) => prev.filter((it) => it.id !== itemId));
    playSound("click");
  };

  // Crear nuevo responsable o subalterno rápidamente desde el botón "Nuevo" debajo del selector
  const handleCreateNuevoResponsable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingNuevoResp) return;

    setSavingNuevoResp(true);
    try {
      const targetDeptName = nuevoRespDept || selectedDepartamento;
      const deptObj = departamentosDisponibles.find(
        (d) => normalizeTextToken(d.nombre) === normalizeTextToken(targetDeptName)
      );
      const superiorObj = titularesParaNuevoSubalterno.find(
        (t) => t.id === nuevoRespSuperiorId
      ) || titularesParaNuevoSubalterno[0];

      const res = await registrarNuevoResponsableRapido({
        nombre: nuevoRespNombre,
        departamentoNombre: targetDeptName,
        departamentoId: deptObj?.id,
        cargo: nuevoRespCargo,
        telefono: nuevoRespTelefono,
        esSubalterno: nuevoRespEsSubalterno,
        responsableSuperiorId: nuevoRespEsSubalterno ? superiorObj?.id : undefined,
        responsableSuperiorNombre: nuevoRespEsSubalterno ? superiorObj?.nombre : undefined,
        sedeId: activeSedeId,
        creadoPor: `${currentUser.nombre} (${currentUser.usuario})`,
        existingResponsables: responsables
      });

      if (!res.exito || !res.responsable) {
        playSound("negative");
        showToast(res.error || "No se pudo registrar el personal.");
        return;
      }

      setResponsables(res.listaActualizada);
      if (
        targetDeptName &&
        normalizeTextToken(targetDeptName) !== normalizeTextToken(selectedDepartamento)
      ) {
        setSelectedDepartamento(targetDeptName);
      }
      setSelectedResponsableId(res.responsable.id);
      setNuevoRespNombre("");
      setNuevoRespCargo("");
      setNuevoRespTelefono("");
      setNuevoRespEsSubalterno(false);
      setNuevoRespSuperiorId("");
      setShowNuevoResponsableModal(false);
      playSound("positive");
      showToast(
        `${res.responsable.esSubalterno ? "Subalterno" : "Responsable"} "${res.responsable.nombre}" registrado y asociado a ${res.responsable.departamentoNombre}.`
      );
    } finally {
      setSavingNuevoResp(false);
    }
  };

  // Pre-validación para abrir el resumen previo a confirmar
  const handleOpenConfirmPreview = () => {
    const val = validateConsumoOperation({
      sedeId: activeSedeId,
      departamentoNombre: selectedDepartamento,
      responsable: selectedResponsableObj,
      tipoConsumo: selectedTipoConsumoObj,
      destinoExternoInstitucion,
      destinoExternoPersona,
      items: draftItems,
      productosInventario: products,
      esAdmin: isAdmin,
      asignacionEspecialAdmin,
      validarExistenciasInventario: true
    });

    if (!val.valido) {
      playSound("negative");
      showToast(val.errores[0]);
      return;
    }

    setShowConfirmPreview(true);
    playSound("open");
  };

  // Ejecución atómica de "Confirmar consumo"
  const handleConfirmarConsumo = async () => {
    if (submittingConsumo || submitLockRef.current) return;
    if (!selectedResponsableObj || !selectedTipoConsumoObj) return;

    submitLockRef.current = true;
    setSubmittingConsumo(true);
    playSound("action");

    try {
      const catObj = catalogos.find((c) => c.id === selectedCatalogId);
      const deptObj = departamentosDisponibles.find(
        (d) => normalizeTextToken(d.nombre) === normalizeTextToken(selectedDepartamento)
      );

      const res = await registrarConsumoAtomico({
        sedeId: activeSedeId,
        sedeNombre,
        fecha: fechaConsumo,
        periodo: activePeriod,
        departamentoId: deptObj?.id,
        departamentoNombre: selectedDepartamento,
        responsable: selectedResponsableObj,
        asignacionEspecialAdmin,
        tipoConsumo: selectedTipoConsumoObj,
        destinoExternoInstitucion: isConsumoExterno ? destinoExternoInstitucion : undefined,
        destinoExternoPersona: isConsumoExterno ? destinoExternoPersona : undefined,
        catalogId: selectedCatalogId,
        catalogNombre: catObj?.nombre || "Medicamentos e Insumos",
        items: draftItems,
        observaciones,
        usuarioRegistro: `${currentUser.nombre} (${currentUser.usuario})`,
        usuarioRegistroId: currentUser.id,
        rolUsuarioRegistro: currentUser.rol,
        esAdmin: isAdmin,
        origenOperacion: "DIRECTO",
        descontarInventario: true,
        productosActuales: products,
        consumosActuales: consumos
      });

      if (!res.exito || !res.consumo) {
        playSound("negative");
        showToast(res.error || "Error al confirmar el consumo.");
        return;
      }

      if (res.productosActualizados && onProductsUpdated) {
        onProductsUpdated(res.productosActualizados);
      }

      setConsumos(loadLocalConsumos(activeSedeId));
      setLastConfirmedConsumo(res.consumo);
      setDraftItems([]);
      setObservaciones("");
      setDestinoExternoInstitucion("");
      setDestinoExternoPersona("");
      setShowConfirmPreview(false);
      playSound("positive");
      showToast(
        `Consumo ${res.consumo.numeroOperacion} confirmado para ${res.consumo.departamentoNombre}. Stock actualizado.`
      );
    } finally {
      submitLockRef.current = false;
      setSubmittingConsumo(false);
    }
  };

  // ============================================================================
  // ESTADOS DE FILTROS DEL HISTORIAL Y RESUMEN POR DEPARTAMENTO
  // ============================================================================
  const [filterDepartamento, setFilterDepartamento] = useState<string>("TODOS");
  const [filterResponsable, setFilterResponsable] = useState<string>("TODOS");
  const [filterTipoConsumo, setFilterTipoConsumo] = useState<string>("TODOS");
  const [filterProductoCodigo, setFilterProductoCodigo] = useState<string>("TODOS");
  const [filterProducto, setFilterProducto] = useState<string>("");
  const [filterCatalogId, setFilterCatalogId] = useState<string>("TODOS");
  const [filterSede, setFilterSede] = useState<string>("TODAS");
  const [filterUsuario, setFilterUsuario] = useState<string>("");
  const [filterFechaDesde, setFilterFechaDesde] = useState<string>("");
  const [filterFechaHasta, setFilterFechaHasta] = useState<string>("");
  const [groupByDeptInHistory, setGroupByDeptInHistory] = useState<boolean>(true);

  // Detalle individual y nota de corrección auditada
  const [selectedConsumoDetail, setSelectedConsumoDetail] = useState<RegistroConsumo | null>(null);
  const [motivoCorreccion, setMotivoCorreccion] = useState<string>("");
  const [savingCorreccion, setSavingCorreccion] = useState<boolean>(false);

  const hasActiveFilters =
    filterDepartamento !== "TODOS" ||
    filterResponsable !== "TODOS" ||
    filterTipoConsumo !== "TODOS" ||
    filterProductoCodigo !== "TODOS" ||
    filterProducto.trim() !== "" ||
    filterCatalogId !== "TODOS" ||
    filterSede !== "TODAS" ||
    filterUsuario.trim() !== "" ||
    filterFechaDesde !== "" ||
    filterFechaHasta !== "";

  const handleClearAllFilters = () => {
    setFilterDepartamento("TODOS");
    setFilterResponsable("TODOS");
    setFilterTipoConsumo("TODOS");
    setFilterProductoCodigo("TODOS");
    setFilterProducto("");
    setFilterCatalogId("TODOS");
    setFilterSede("TODAS");
    setFilterUsuario("");
    setFilterFechaDesde("");
    setFilterFechaHasta("");
    playSound("click");
  };

  // Lista única de productos presentes en el historial de consumos y en el inventario para el selector de filtro por producto
  const uniqueProductosInHistory = useMemo(() => {
    const map = new Map<string, { codigo: string; nombre: string; consumedCount: number }>();
    consumos.forEach((c) => {
      (c.items || []).forEach((it) => {
        if (!it.productoCodigo) return;
        const prev = map.get(it.productoCodigo);
        if (prev) {
          prev.consumedCount += Number(it.cantidadEntregada || 0);
        } else {
          map.set(it.productoCodigo, {
            codigo: it.productoCodigo,
            nombre: it.productoNombre || it.productoCodigo,
            consumedCount: Number(it.cantidadEntregada || 0)
          });
        }
      });
    });
    products.forEach((p) => {
      if (!map.has(p.codigo)) {
        map.set(p.codigo, {
          codigo: p.codigo,
          nombre: p.nombre,
          consumedCount: 0
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      if (a.consumedCount > 0 && b.consumedCount === 0) return -1;
      if (a.consumedCount === 0 && b.consumedCount > 0) return 1;
      return a.nombre.localeCompare(b.nombre, "es");
    });
  }, [consumos, products]);

  // Verifica si un ítem de consumo coincide con el filtro de producto activo (selector o texto)
  const itemMatchesProductFilter = (it: ConsumoItem): boolean => {
    if (
      filterProductoCodigo !== "TODOS" &&
      normalizeTextToken(it.productoCodigo) !== normalizeTextToken(filterProductoCodigo)
    ) {
      return false;
    }
    if (filterProducto.trim()) {
      const pQuery = normalizeTextToken(filterProducto);
      const matchesItem =
        normalizeTextToken(it.productoNombre).includes(pQuery) ||
        normalizeTextToken(it.productoCodigo).includes(pQuery) ||
        normalizeTextToken(it.numeroLote).includes(pQuery);
      if (!matchesItem) return false;
    }
    return true;
  };

  // Filtrar consumos respetando permisos de usuario y todos los criterios de filtrado (incluyendo producto)
  const filteredConsumos = useMemo(() => {
    const isFilteringByProduct =
      filterProductoCodigo !== "TODOS" || filterProducto.trim().length > 0;

    return consumos
      .filter((c) => {
        // Si el usuario no es administrador ni de Farmacia/Almacén, limitar a su propio departamento si aplica
        if (
          !canChooseAnyDepartment &&
          currentUser.departamento &&
          normalizeTextToken(c.departamentoNombre) !== normalizeTextToken(currentUser.departamento)
        ) {
          return false;
        }

        if (
          filterDepartamento !== "TODOS" &&
          normalizeTextToken(c.departamentoNombre) !== normalizeTextToken(filterDepartamento)
        ) {
          return false;
        }

        if (
          filterResponsable !== "TODOS" &&
          normalizeTextToken(c.responsableNombre) !== normalizeTextToken(filterResponsable)
        ) {
          return false;
        }

        if (filterTipoConsumo !== "TODOS") {
          if (filterTipoConsumo === "CAT_INTERNO" && c.categoriaConsumo !== "Interno") return false;
          if (filterTipoConsumo === "CAT_EXTERNO" && c.categoriaConsumo !== "Externo") return false;
          if (
            filterTipoConsumo !== "CAT_INTERNO" &&
            filterTipoConsumo !== "CAT_EXTERNO" &&
            c.tipoConsumoId !== filterTipoConsumo &&
            normalizeTextToken(c.tipoConsumoNombre) !== normalizeTextToken(filterTipoConsumo)
          ) {
            return false;
          }
        }

        if (filterCatalogId !== "TODOS" && !matchesCatalog(c.catalogId, filterCatalogId, catalogos)) {
          return false;
        }

        if (
          filterSede !== "TODAS" &&
          normalizeTextToken(c.sedeId) !== normalizeTextToken(filterSede) &&
          normalizeTextToken(c.sedeNombre) !== normalizeTextToken(filterSede)
        ) {
          return false;
        }

        if (filterUsuario.trim()) {
          const uQuery = normalizeTextToken(filterUsuario);
          if (!normalizeTextToken(c.usuarioRegistro).includes(uQuery)) {
            return false;
          }
        }

        if (filterProductoCodigo !== "TODOS") {
          const hasSelectedCode = (c.items || []).some(
            (it) => normalizeTextToken(it.productoCodigo) === normalizeTextToken(filterProductoCodigo)
          );
          if (!hasSelectedCode) return false;
        }

        if (filterProducto.trim()) {
          const pQuery = normalizeTextToken(filterProducto);
          const matchesAnyItem = (c.items || []).some(
            (it) =>
              normalizeTextToken(it.productoNombre).includes(pQuery) ||
              normalizeTextToken(it.productoCodigo).includes(pQuery) ||
              normalizeTextToken(it.numeroLote).includes(pQuery)
          );
          const matchesOp = normalizeTextToken(c.numeroOperacion).includes(pQuery);
          if (!matchesAnyItem && !matchesOp) {
            return false;
          }
        }

        if (filterFechaDesde && c.fecha < filterFechaDesde) {
          return false;
        }
        if (filterFechaHasta && c.fecha > filterFechaHasta) {
          return false;
        }

        return true;
      })
      .map((c) => {
        if (!isFilteringByProduct) return c;
        const pQuery = normalizeTextToken(filterProducto);
        const matchesOpCodeDirectly =
          pQuery.length > 0 && normalizeTextToken(c.numeroOperacion).includes(pQuery);
        if (matchesOpCodeDirectly && filterProductoCodigo === "TODOS") {
          return c;
        }
        // Recortar los ítems y totales al producto filtrado para que tanto el Historial como el Resumen por Departamento muestren las cantidades exactas del producto buscado
        const matchedItems = (c.items || []).filter((it) => itemMatchesProductFilter(it));
        if (matchedItems.length === 0) return c;
        const totalUnidades = matchedItems.reduce(
          (acc, it) => acc + Number(it.cantidadEntregada || 0),
          0
        );
        const costoTotalEstimado = Number(
          matchedItems
            .reduce(
              (acc, it) =>
                acc + Number(it.subtotal ?? Number(it.cantidadEntregada || 0) * Number(it.precioUnitario || 0)),
              0
            )
            .toFixed(2)
        );
        return {
          ...c,
          items: matchedItems,
          totalProductos: new Set(matchedItems.map((i) => i.productoCodigo)).size,
          totalUnidades,
          costoTotalEstimado
        };
      });
  }, [
    consumos,
    canChooseAnyDepartment,
    currentUser.departamento,
    filterDepartamento,
    filterResponsable,
    filterTipoConsumo,
    filterCatalogId,
    filterSede,
    filterUsuario,
    filterProductoCodigo,
    filterProducto,
    filterFechaDesde,
    filterFechaHasta,
    catalogos
  ]);

  const resumenAnalytics = useMemo(
    () => calcularResumenPorDepartamento(filteredConsumos),
    [filteredConsumos]
  );

  const uniqueResponsablesInHistory = useMemo(() => {
    const names = new Set<string>();
    responsables.forEach((r) => names.add(r.nombre));
    consumos.forEach((c) => {
      if (c.responsableNombre) names.add(c.responsableNombre);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b, "es"));
  }, [responsables, consumos]);

  const uniqueSedesInHistory = useMemo(() => {
    const sedes = new Set<string>([sedeNombre]);
    consumos.forEach((c) => {
      if (c.sedeNombre) sedes.add(c.sedeNombre);
    });
    return Array.from(sedes);
  }, [consumos, sedeNombre]);

  const periodoConsultadoLabel = useMemo(() => {
    if (filterFechaDesde && filterFechaHasta) return `Del ${filterFechaDesde} al ${filterFechaHasta}`;
    if (filterFechaDesde) return `Desde ${filterFechaDesde}`;
    if (filterFechaHasta) return `Hasta ${filterFechaHasta}`;
    return activePeriod || "Historial Completo";
  }, [filterFechaDesde, filterFechaHasta, activePeriod]);

  const handleExportReport = (tipoReporte: TipoReporteConsumoExport, format: "PDF" | "WORD") => {
    if (filteredConsumos.length === 0) {
      playSound("negative");
      showToast("No hay registros de consumo con los filtros actuales para exportar.");
      return;
    }
    const opts = {
      tipoReporte,
      sedeNombre,
      departamentoFiltro: filterDepartamento !== "TODOS" ? filterDepartamento : undefined,
      responsableFiltro: filterResponsable !== "TODOS" ? filterResponsable : undefined,
      tipoConsumoFiltro: filterTipoConsumo !== "TODOS" ? filterTipoConsumo : undefined,
      periodoConsultado: periodoConsultadoLabel,
      usuarioGenerador: `${currentUser.nombre} (${currentUser.usuario})`
    };

    if (format === "PDF") {
      exportConsumosReportToPDF(filteredConsumos, opts);
      showToast("Reporte de consumos exportado a PDF correctamente.");
    } else {
      exportConsumosReportToWord(filteredConsumos, opts);
      showToast("Reporte de consumos exportado a Word (.doc) correctamente.");
    }
    playSound("positive");
  };

  const handleGuardarNotaCorreccion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConsumoDetail || savingCorreccion) return;

    setSavingCorreccion(true);
    try {
      const res = await agregarNotaCorreccionConsumo({
        consumoId: selectedConsumoDetail.id,
        motivo: motivoCorreccion,
        usuario: `${currentUser.nombre} (${currentUser.usuario})`,
        sedeId: activeSedeId,
        consumosActuales: consumos
      });

      if (!res.exito || !res.consumoActualizado) {
        playSound("negative");
        showToast(res.error || "No se pudo registrar la nota de corrección.");
        return;
      }

      setConsumos(loadLocalConsumos(activeSedeId));
      setSelectedConsumoDetail(res.consumoActualizado);
      setMotivoCorreccion("");
      playSound("positive");
      showToast("Nota de corrección documentada en el historial de la operación.");
    } finally {
      setSavingCorreccion(false);
    }
  };

  const totalDraftUnidades = draftItems.reduce(
    (acc, it) => acc + Number(it.cantidadEntregada || 0),
    0
  );
  const totalDraftCosto = draftItems.reduce((acc, it) => acc + Number(it.subtotal || 0), 0);

  return (
    <div className="w-full min-w-0 max-w-full space-y-5 sm:space-y-6">
      {/* Cabecera y Navegación del Módulo Consumos */}
      <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-teal-50 text-teal-800 border border-teal-200">
              <PackageMinus className="w-3.5 h-3.5 text-teal-600" />
              Módulo de Consumos Departamentales
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
              <Building2 className="w-3 h-3 text-teal-600" />
              Sede: {sedeNombre}
            </span>
          </div>
          <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
            Control de Consumos y Salidas por Departamento
          </h2>
          <p className="text-xs text-slate-500 font-medium">
            Registre entregas de materiales, suministros e insumos por departamento y responsable receptor con descuento real de inventario y trazabilidad completa.
          </p>
        </div>

        {/* Selector de Sub-pestañas optimizado para teléfonos móviles */}
        <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-1.5 sm:gap-2 bg-slate-100/90 p-1.5 rounded-2xl border border-slate-200/80 self-stretch lg:self-auto w-full lg:w-auto">
          <button
            type="button"
            onClick={() => {
              setActiveSubTab("registro");
              playSound("click");
            }}
            className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-4 py-2.5 rounded-xl text-[11px] sm:text-xs font-extrabold transition cursor-pointer min-h-[42px] ${
              activeSubTab === "registro"
                ? "bg-teal-700 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
            }`}
          >
            <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">Registrar</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveSubTab("historial");
              playSound("click");
            }}
            className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-4 py-2.5 rounded-xl text-[11px] sm:text-xs font-extrabold transition cursor-pointer min-h-[42px] ${
              activeSubTab === "historial"
                ? "bg-teal-700 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
            }`}
          >
            <History className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">Historial ({filteredConsumos.length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveSubTab("resumen");
              playSound("click");
            }}
            className={`inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-4 py-2.5 rounded-xl text-[11px] sm:text-xs font-extrabold transition cursor-pointer min-h-[42px] ${
              activeSubTab === "resumen"
                ? "bg-teal-700 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-white/60"
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">Resumen Dpto.</span>
          </button>
        </div>
      </div>

      {/* Banner de última operación confirmada con descarga directa PDF / Word */}
      {lastConfirmedConsumo && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
            <div>
              <p className="text-xs font-black text-emerald-900 uppercase tracking-wider">
                Consumo Confirmado Exitosamente • {lastConfirmedConsumo.numeroOperacion}
              </p>
              <p className="text-xs text-emerald-800 font-medium mt-0.5">
                Departamento: <strong>{lastConfirmedConsumo.departamentoNombre}</strong> • Responsable:{" "}
                <strong>{lastConfirmedConsumo.responsableNombre}</strong> • Tipo:{" "}
                <strong>
                  {lastConfirmedConsumo.tipoConsumoNombre} ({lastConfirmedConsumo.categoriaConsumo})
                </strong>{" "}
                • Total: <strong>{lastConfirmedConsumo.totalUnidades} und.</strong>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                exportConsumoDetalleToPDF(
                  lastConfirmedConsumo,
                  `${currentUser.nombre} (${currentUser.usuario})`
                )
              }
              className="px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>Comprobante PDF</span>
            </button>
            <button
              type="button"
              onClick={() =>
                exportConsumoDetalleToWord(
                  lastConfirmedConsumo,
                  `${currentUser.nombre} (${currentUser.usuario})`
                )
              }
              className="px-3 py-1.5 rounded-xl bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Comprobante Word</span>
            </button>
            <button
              type="button"
              onClick={() => setLastConfirmedConsumo(null)}
              className="p-1.5 text-emerald-700 hover:text-emerald-950 rounded-lg cursor-pointer"
              title="Cerrar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-PESTAÑA 1: REGISTRO DE NUEVOS CONSUMOS
         ===================================================================== */}
      {activeSubTab === "registro" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Columna Izquierda (5 cols): Datos del Consumo y Responsable */}
          <div className="lg:col-span-5 bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-sm space-y-5">
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <ClipboardCheck className="w-5 h-5 text-teal-600" />
                  <span>1. Datos del Consumo y Destino</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Seleccione el departamento receptor, la persona responsable y el tipo de consumo.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Sede y Fecha */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">
                    Sede Institucional
                  </label>
                  <div className="w-full bg-slate-100 rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-extrabold text-slate-700 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-teal-600 shrink-0" />
                    <span className="truncate">{sedeNombre}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">
                    Fecha del Consumo *
                  </label>
                  <input
                    type="date"
                    value={fechaConsumo}
                    onChange={(e) => setFechaConsumo(e.target.value)}
                    className="w-full bg-slate-50 rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-400"
                  />
                </div>
              </div>

              {/* Departamento Destinatario */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">
                  Departamento Destinatario *
                </label>
                <select
                  value={selectedDepartamento}
                  disabled={!canChooseAnyDepartment}
                  onChange={(e) => {
                    setSelectedDepartamento(e.target.value);
                    playSound("click");
                  }}
                  className="w-full bg-slate-50 disabled:bg-slate-100 rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-extrabold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-400 cursor-pointer"
                >
                  {departamentosDisponibles.map((dept) => (
                    <option key={dept.id} value={dept.nombre}>
                      {dept.nombre}
                    </option>
                  ))}
                </select>
              </div>

              {/* Responsable del Departamento + Botón "Nuevo" debajo */}
              <div className="space-y-2">
                <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider">
                  Responsable / Subalterno Receptor *
                </label>
                <select
                  value={selectedResponsableId}
                  onChange={(e) => {
                    setSelectedResponsableId(e.target.value);
                    playSound("click");
                  }}
                  className="w-full min-h-[42px] bg-slate-50 rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-extrabold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-400 cursor-pointer"
                >
                  {activeResponsables.length === 0 ? (
                    <option value="">
                      -- Sin responsable ni subalternos en {selectedDepartamento} (Use «Nuevo») --
                    </option>
                  ) : (
                    activeResponsables.map((resp) => {
                      const titularDept = activeResponsables.find((r) => !r.esSubalterno);
                      const supNombre =
                        resp.responsableSuperiorNombre || titularDept?.nombre || "";
                      return (
                        <option key={resp.id} value={resp.id}>
                          {resp.nombre} —{" "}
                          {resp.esSubalterno
                            ? `Subalterno${supNombre ? ` (Resp: ${supNombre})` : ""}`
                            : "Responsable del Departamento"}
                        </option>
                      );
                    })
                  )}
                </select>

                {/* Botón "Nuevo" debajo del selector según requerimiento */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setNuevoRespDept(selectedDepartamento);
                      setShowNuevoResponsableModal((prev) => !prev);
                      playSound("open");
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-extrabold transition cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5 text-teal-600" />
                    <span>Nuevo</span>
                  </button>

                  {selectedResponsableObj && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                          selectedResponsableObj.esSubalterno
                            ? "bg-indigo-50 text-indigo-800 border border-indigo-200"
                            : "bg-teal-50 text-teal-800 border border-teal-200"
                        }`}
                      >
                        {selectedResponsableObj.esSubalterno ? "Subalterno" : "Responsable Titular"}
                      </span>
                      <span>
                        Dpto:{" "}
                        <strong className="text-slate-700">
                          {selectedResponsableObj.departamentoNombre}
                        </strong>
                      </span>
                    </div>
                  )}
                </div>

                {/* Formulario rápido in-place cuando se pulsa el botón "Nuevo" */}
                {showNuevoResponsableModal && (
                  <div className="bg-teal-50/70 border border-teal-200 rounded-2xl p-3.5 space-y-3 mt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black uppercase tracking-wider text-teal-900 flex items-center gap-1.5">
                        <UserPlus className="w-3.5 h-3.5 text-teal-700" />
                        Registrar Nuevo Responsable o Subalterno
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowNuevoResponsableModal(false)}
                        className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                          Nombre Completo *
                        </label>
                        <input
                          type="text"
                          value={nuevoRespNombre}
                          onChange={(e) => setNuevoRespNombre(e.target.value)}
                          placeholder="Ej: Lic. Iris Aybar / Aux. Pedro Santana"
                          className="w-full min-h-[40px] bg-white rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-teal-400"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                          Departamento Asociado *
                        </label>
                        <select
                          value={nuevoRespDept}
                          onChange={(e) => setNuevoRespDept(e.target.value)}
                          className="w-full min-h-[40px] bg-white rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-teal-400"
                        >
                          {departamentosDisponibles.map((d) => (
                            <option key={d.id} value={d.nombre}>
                              {d.nombre}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                          Cargo / Función (Opcional)
                        </label>
                        <input
                          type="text"
                          value={nuevoRespCargo}
                          onChange={(e) => setNuevoRespCargo(e.target.value)}
                          placeholder={
                            nuevoRespEsSubalterno
                              ? "Ej: Auxiliar / Subalterno"
                              : "Ej: Coordinador(a) / Encargado(a)"
                          }
                          className="w-full min-h-[40px] bg-white rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-teal-400"
                        />
                      </div>

                      {/* Checkbox "Es subalterno" */}
                      <div className="sm:col-span-2 bg-white border border-teal-200/80 rounded-xl p-2.5 space-y-2">
                        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={nuevoRespEsSubalterno}
                            onChange={(e) => setNuevoRespEsSubalterno(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500 cursor-pointer"
                          />
                          <div>
                            <span className="text-xs font-black text-slate-800 block">
                              Es subalterno
                            </span>
                            <span className="text-[10px] text-slate-500 font-medium block">
                              {nuevoRespEsSubalterno
                                ? "Se registrará como subalterno asociado al departamento y a su responsable titular."
                                : "Sin marcar: se registrará como responsable titular del departamento."}
                            </span>
                          </div>
                        </label>

                        {nuevoRespEsSubalterno && (
                          <div className="pt-1.5 border-t border-slate-100">
                            <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                              Responsable Titular de {nuevoRespDept || selectedDepartamento}
                            </label>
                            {titularesParaNuevoSubalterno.length > 0 ? (
                              <select
                                value={nuevoRespSuperiorId}
                                onChange={(e) => setNuevoRespSuperiorId(e.target.value)}
                                className="w-full min-h-[38px] bg-slate-50 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-teal-900 outline-none focus:ring-2 focus:ring-teal-400"
                              >
                                {titularesParaNuevoSubalterno.map((tit) => (
                                  <option key={tit.id} value={tit.id}>
                                    {tit.nombre} ({tit.departamentoNombre})
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <p className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                                Este departamento aún no tiene un responsable titular registrado. Se asociará automáticamente al departamento{" "}
                                <strong>{nuevoRespDept || selectedDepartamento}</strong> y a su responsable cuando se asigne.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowNuevoResponsableModal(false)}
                        className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-100 cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={handleCreateNuevoResponsable}
                        disabled={savingNuevoResp || !nuevoRespNombre.trim()}
                        className="px-4 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 text-white text-xs font-extrabold cursor-pointer"
                      >
                        {savingNuevoResp ? "Guardando..." : "Guardar y Seleccionar"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Alerta cuando un departamento aún no tiene responsable ni subalternos */}
                {activeResponsables.length === 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="font-semibold leading-relaxed">
                      El departamento <strong>{selectedDepartamento}</strong> aún no tiene un responsable o subalterno asignado. Pulse el botón <strong>«Nuevo»</strong> para registrarlo.
                    </p>
                  </div>
                )}
              </div>

              {/* Tipo de Consumo (Interno / Externo + personalizados) */}
              <div className="space-y-3 pt-1">
                <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider">
                  Tipo de Consumo *
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  {activeTiposConsumo.map((tipo) => {
                    const isSelected = selectedTipoConsumoObj?.id === tipo.id;
                    const isExt = tipo.categoria === "Externo";
                    return (
                      <button
                        key={tipo.id}
                        type="button"
                        onClick={() => {
                          setSelectedTipoConsumoId(tipo.id);
                          playSound("click");
                        }}
                        className={`p-3 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? isExt
                              ? "bg-amber-50 border-amber-400 ring-2 ring-amber-200 text-amber-950"
                              : "bg-teal-50 border-teal-500 ring-2 ring-teal-200 text-teal-950"
                            : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-extrabold">{tipo.nombre}</span>
                          <span
                            className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                              isExt
                                ? "bg-amber-100 text-amber-800 border border-amber-300"
                                : "bg-teal-100 text-teal-800 border border-teal-300"
                            }`}
                          >
                            {tipo.categoria}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">
                          {tipo.descripcion ||
                            (isExt
                              ? "Salida destinada a uso externo"
                              : "Uso interno de la institución")}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {/* Campos adicionales obligatorios cuando se selecciona Consumo Externo */}
                {isConsumoExterno && (
                  <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-3.5 space-y-3">
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-amber-700" />
                      Datos de Destino / Recepción Externa
                    </span>
                    <div>
                      <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                        Institución / Centro / Destino Externo *
                      </label>
                      <input
                        type="text"
                        value={destinoExternoInstitucion}
                        onChange={(e) => setDestinoExternoInstitucion(e.target.value)}
                        placeholder="Ej: Hospital Regional / Jornada Médica Comunitaria"
                        className="w-full bg-white rounded-xl border border-amber-200 px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                        Persona o Responsable Externo que Recibe
                      </label>
                      <input
                        type="text"
                        value={destinoExternoPersona}
                        onChange={(e) => setDestinoExternoPersona(e.target.value)}
                        placeholder="Ej: Dra. María Gómez (Cédula / Cargo)"
                        className="w-full bg-white rounded-xl border border-amber-200 px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Observaciones y Usuario Registrador */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 tracking-wider mb-1">
                  Observaciones / Nota de Entrega
                </label>
                <textarea
                  rows={2}
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Detalle o justificación adicional del consumo..."
                  className="w-full bg-slate-50 rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-400 resize-none"
                />
              </div>

              <div className="bg-slate-50 rounded-2xl p-3 border border-slate-200/80 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-bold">Usuario que registra:</span>
                <span className="font-extrabold text-slate-800">
                  {currentUser.nombre} ({currentUser.usuario})
                </span>
              </div>
            </div>
          </div>

          {/* Columna Derecha (7 cols): Selección de Materiales e Insumos + Resumen y Confirmación */}
          <div className="lg:col-span-7 space-y-5">
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-sm space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                    <Package className="w-5 h-5 text-teal-600" />
                    <span>2. Selección de Materiales, Suministros e Insumos</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Consulte la existencia disponible por lote y agregue los productos a entregar.
                  </p>
                </div>

                {/* Selector de Catálogo */}
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-teal-600 shrink-0" />
                  <select
                    value={selectedCatalogId}
                    onChange={(e) => {
                      const nextCat = e.target.value;
                      setSelectedCatalogId(nextCat);
                      setSelectedProductCode("");
                      setSelectedLotId("");
                      if (onSelectCatalog) onSelectCatalog(nextCat);
                      playSound("click");
                    }}
                    className="bg-teal-50 border border-teal-200 text-teal-900 rounded-xl px-3 py-2 text-xs font-extrabold outline-none focus:ring-2 focus:ring-teal-400 cursor-pointer"
                  >
                    {availableCatalogos.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        Catálogo: {cat.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Buscador de Productos */}
              <div className="space-y-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Buscar producto por nombre, código o descripción..."
                    className="w-full bg-slate-50 rounded-xl border border-slate-200 pl-10 pr-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-400"
                  />
                </div>

                {/* Lista rápida de productos del catálogo */}
                <div className="max-h-52 overflow-y-auto border border-slate-200 rounded-2xl divide-y divide-slate-100 bg-slate-50/50">
                  {filteredProductsSearch.map((prod) => {
                    const totalAvail = (prod.lotes || []).reduce(
                      (acc, l) => acc + getLotAvailableStock(prod.codigo, l),
                      0
                    );
                    const isSelected = selectedProductCode === prod.codigo;

                    return (
                      <button
                        key={prod.codigo}
                        type="button"
                        onClick={() => handleSelectProduct(prod)}
                        className={`w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-3 transition cursor-pointer ${
                          isSelected
                            ? "bg-teal-600 text-white"
                            : "hover:bg-white text-slate-800"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-mono font-black px-2 py-0.5 rounded-md ${
                                isSelected
                                  ? "bg-white/20 text-white"
                                  : "bg-teal-50 text-teal-800 border border-teal-200"
                              }`}
                            >
                              {prod.codigo}
                            </span>
                            <span className="text-xs font-extrabold truncate">
                              {prod.nombre}
                            </span>
                          </div>
                          {prod.descripcion && (
                            <p
                              className={`text-[10px] truncate mt-0.5 ${
                                isSelected ? "text-teal-100" : "text-slate-400"
                              }`}
                            >
                              {prod.descripcion}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span
                            className={`text-xs font-black px-2.5 py-1 rounded-full ${
                              totalAvail > 0
                                ? isSelected
                                  ? "bg-white text-teal-800"
                                  : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : "bg-rose-50 text-rose-700 border border-rose-200"
                            }`}
                          >
                            Disp: {totalAvail} und.
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  {filteredProductsSearch.length === 0 && (
                    <div className="p-6 text-center text-xs text-slate-400 font-semibold">
                      No se encontraron productos en este catálogo con el criterio buscado.
                    </div>
                  )}
                </div>
              </div>

              {/* Panel de Selección de Lote y Cantidad para el Producto Elegido */}
              {selectedProductObj && (
                <div className="bg-teal-50/60 border border-teal-200 rounded-2xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-black uppercase text-teal-800 tracking-wider">
                        Producto Seleccionado
                      </span>
                      <h4 className="text-sm font-black text-slate-900">
                        {selectedProductObj.nombre}{" "}
                        <span className="text-xs font-mono text-teal-700">
                          ({selectedProductObj.codigo})
                        </span>
                      </h4>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                    <div className="sm:col-span-7">
                      <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                        Seleccionar Lote *
                      </label>
                      <select
                        value={selectedLotId}
                        onChange={(e) => setSelectedLotId(e.target.value)}
                        className="w-full bg-white rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-teal-400"
                      >
                        {(selectedProductObj.lotes || []).map((l) => {
                          const avail = getLotAvailableStock(selectedProductObj.codigo, l);
                          return (
                            <option key={l.id} value={l.id}>
                              Lote: {l.numeroLote} | Disp: {avail} und. (Sis: {l.cantidad} / Fís:{" "}
                              {l.cantidadF ?? l.cantidad}) | Vence: {l.fechaVencimiento}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                        Cantidad *
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={
                          selectedLotObj
                            ? Math.max(1, getLotAvailableStock(selectedProductObj.codigo, selectedLotObj))
                            : 1
                        }
                        value={cantidadInput}
                        onChange={(e) => setCantidadInput(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-full bg-white rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-black text-slate-900 text-center outline-none focus:ring-2 focus:ring-teal-400"
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <button
                        type="button"
                        onClick={handleAddItemToDraft}
                        className="w-full py-2.5 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer shadow-xs"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Agregar</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabla de Materiales Agregados al Consumo */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase text-slate-500 tracking-wider">
                    Productos e Insumos a Entregar ({draftItems.length})
                  </h4>
                  {draftItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setDraftItems([])}
                      className="text-[11px] font-bold text-rose-600 hover:text-rose-700 cursor-pointer"
                    >
                      Vaciar lista
                    </button>
                  )}
                </div>

                <p className="sm:hidden text-[10px] font-bold text-slate-400 flex items-center justify-between px-1">
                  <span>Medicamento / Insumo fijo a la izquierda</span>
                  <span>Desliza a los lados ↔</span>
                </p>

                <div className="w-full max-w-full overflow-x-auto overscroll-x-contain touch-pan-x [-webkit-overflow-scrolling:touch] border border-slate-200 rounded-2xl">
                  <table className="min-w-[580px] w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500 tracking-wider">
                        <th className="sticky left-0 z-10 bg-slate-50 px-3.5 py-2.5 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                          Medicamento / Insumo (Fijo)
                        </th>
                        <th className="px-3.5 py-2.5 text-center">Lote / Vence</th>
                        <th className="px-3.5 py-2.5 text-center">Cantidad</th>
                        <th className="px-3.5 py-2.5 text-right">Subtotal Est.</th>
                        <th className="px-3.5 py-2.5 text-right">Quitar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs bg-white">
                      {draftItems.map((it) => (
                        <tr key={it.id} className="hover:bg-slate-50/80 group">
                          <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 px-3.5 py-2.5 max-w-[190px] sm:max-w-[260px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                            <span className="font-mono font-black text-teal-700 text-[11px] block">
                              {it.productoCodigo}
                            </span>
                            <span className="font-bold text-slate-800 block truncate">
                              {it.productoNombre}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                            <span className="font-mono font-bold text-slate-700 block">
                              {it.numeroLote}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {it.fechaVencimiento}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-center">
                            <input
                              type="number"
                              min={1}
                              value={it.cantidadEntregada}
                              onChange={(e) =>
                                handleUpdateDraftItemQuantity(
                                  it.id,
                                  parseInt(e.target.value, 10) || 1
                                )
                              }
                              className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-center font-black text-slate-900"
                            />
                          </td>
                          <td className="px-3.5 py-2.5 text-right font-bold text-slate-700 whitespace-nowrap">
                            RD$ {Number(it.subtotal || 0).toFixed(2)}
                          </td>
                          <td className="px-3.5 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveDraftItem(it.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition cursor-pointer"
                              title="Eliminar producto"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {draftItems.length === 0 && (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-8 text-center text-slate-400 font-medium"
                          >
                            Aún no ha agregado materiales ni insumos a este consumo.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pie de Resumen y Botón Confirmar Consumo */}
                <div className="bg-slate-900 text-white rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-6">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">
                        Total Productos
                      </span>
                      <span className="text-base font-black text-white">
                        {draftItems.length} ítem(s)
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">
                        Total Unidades
                      </span>
                      <span className="text-base font-black text-teal-300">
                        {totalDraftUnidades} und.
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block">
                        Valor Estimado
                      </span>
                      <span className="text-base font-black text-emerald-300">
                        RD$ {totalDraftCosto.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={draftItems.length === 0 || submittingConsumo}
                    onClick={handleOpenConfirmPreview}
                    className="w-full sm:w-auto px-6 py-3 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer shadow-md"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Confirmar consumo</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-PESTAÑA 2: HISTORIAL DE CONSUMOS (ORGANIZADO POR DEPARTAMENTO)
         ===================================================================== */}
      {activeSubTab === "historial" && (
        <div className="space-y-5">
          {/* Panel Completo de Filtros (Incluyendo Filtro Desplegable + Buscador por Producto) */}
          <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-teal-600 shrink-0" />
                <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 uppercase tracking-wider">
                  Filtros de Búsqueda y Exportación de Consumos
                </h3>
              </div>

              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setGroupByDeptInHistory((prev) => !prev)}
                  className={`col-span-2 sm:col-span-1 px-3 py-2 rounded-xl text-xs font-extrabold border transition cursor-pointer text-center ${
                    groupByDeptInHistory
                      ? "bg-teal-50 text-teal-800 border-teal-200"
                      : "bg-slate-50 text-slate-600 border-slate-200"
                  }`}
                >
                  {groupByDeptInHistory ? "Agrupado por Departamento" : "Vista Cronológica"}
                </button>

                <button
                  type="button"
                  onClick={() => handleExportReport("GENERAL", "PDF")}
                  className="px-3.5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5 shrink-0" />
                  <span>Exportar PDF</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExportReport("GENERAL", "WORD")}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5 shrink-0" />
                  <span>Exportar Word</span>
                </button>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={handleClearAllFilters}
                    className="col-span-2 sm:col-span-1 px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-extrabold transition cursor-pointer"
                  >
                    Limpiar filtros
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
              {/* 1. Departamento */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                  1. Departamento
                </label>
                <select
                  value={filterDepartamento}
                  onChange={(e) => setFilterDepartamento(e.target.value)}
                  className="w-full min-h-[40px] bg-slate-50 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800"
                >
                  <option value="TODOS">Todos los departamentos</option>
                  {departamentosDisponibles.map((d) => (
                    <option key={d.id} value={d.nombre}>
                      {d.nombre}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Responsable */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                  2. Responsable
                </label>
                <select
                  value={filterResponsable}
                  onChange={(e) => setFilterResponsable(e.target.value)}
                  className="w-full min-h-[40px] bg-slate-50 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800"
                >
                  <option value="TODOS">Todos los responsables</option>
                  {uniqueResponsablesInHistory.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Producto (Selector Desplegable) */}
              <div>
                <label className="block text-[10px] font-black uppercase text-teal-700 mb-1">
                  3. Filtrar por Producto (Lista)
                </label>
                <select
                  value={filterProductoCodigo}
                  onChange={(e) => setFilterProductoCodigo(e.target.value)}
                  className="w-full min-h-[40px] bg-teal-50/60 rounded-xl border border-teal-200 px-3 py-2 text-xs font-extrabold text-slate-800"
                >
                  <option value="TODOS">Todos los productos / insumos</option>
                  {uniqueProductosInHistory.map((p) => (
                    <option key={p.codigo} value={p.codigo}>
                      {p.codigo} — {p.nombre}
                      {p.consumedCount > 0 ? ` (${p.consumedCount} und.)` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* 4. Buscar Producto / Código / Lote / Operación */}
              <div>
                <label className="block text-[10px] font-black uppercase text-teal-700 mb-1">
                  4. Buscar Producto / Lote / CON-
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={filterProducto}
                    onChange={(e) => setFilterProducto(e.target.value)}
                    placeholder="Nombre, código, lote o CON-..."
                    className="w-full min-h-[40px] bg-slate-50 rounded-xl border border-slate-200 pl-8.5 pr-3 py-2 text-xs font-bold text-slate-800"
                  />
                </div>
              </div>

              {/* 5. Tipo de consumo */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                  5. Tipo de Consumo
                </label>
                <select
                  value={filterTipoConsumo}
                  onChange={(e) => setFilterTipoConsumo(e.target.value)}
                  className="w-full min-h-[40px] bg-slate-50 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800"
                >
                  <option value="TODOS">Todos (Interno y Externo)</option>
                  <option value="CAT_INTERNO">Solo Internos</option>
                  <option value="CAT_EXTERNO">Solo Externos</option>
                  {tiposConsumo.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre} ({t.categoria})
                    </option>
                  ))}
                </select>
              </div>

              {/* 6. Catálogo */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                  6. Catálogo
                </label>
                <select
                  value={filterCatalogId}
                  onChange={(e) => setFilterCatalogId(e.target.value)}
                  className="w-full min-h-[40px] bg-slate-50 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800"
                >
                  <option value="TODOS">Todos los catálogos</option>
                  {availableCatalogos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>

              {/* 7. Sede */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                  7. Sede
                </label>
                <select
                  value={filterSede}
                  onChange={(e) => setFilterSede(e.target.value)}
                  className="w-full min-h-[40px] bg-slate-50 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800"
                >
                  <option value="TODAS">Todas las sedes</option>
                  {uniqueSedesInHistory.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              {/* 8. Usuario */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                  8. Usuario que registró
                </label>
                <input
                  type="text"
                  value={filterUsuario}
                  onChange={(e) => setFilterUsuario(e.target.value)}
                  placeholder="Filtrar por usuario..."
                  className="w-full min-h-[40px] bg-slate-50 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800"
                />
              </div>

              {/* 9. Rango de Fechas */}
              <div className="sm:col-span-2 grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                    Fecha Desde
                  </label>
                  <input
                    type="date"
                    value={filterFechaDesde}
                    onChange={(e) => setFilterFechaDesde(e.target.value)}
                    className="w-full min-h-[40px] bg-slate-50 rounded-xl border border-slate-200 px-2.5 py-2 text-[11px] font-bold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                    Fecha Hasta
                  </label>
                  <input
                    type="date"
                    value={filterFechaHasta}
                    onChange={(e) => setFilterFechaHasta(e.target.value)}
                    className="w-full min-h-[40px] bg-slate-50 rounded-xl border border-slate-200 px-2.5 py-2 text-[11px] font-bold text-slate-800"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Listado de Consumos (Agrupado por Departamento o Tabla General) */}
          {filteredConsumos.length === 0 ? (
            <div className="bg-white rounded-3xl p-8 sm:p-10 border border-slate-200 text-center space-y-2">
              <PackageMinus className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-extrabold text-slate-700">
                No se encontraron consumos registrados con los filtros seleccionados.
              </p>
              <p className="text-xs text-slate-400">
                Registre un nuevo consumo en la pestaña «Registrar» o ajuste los filtros de producto/departamento.
              </p>
            </div>
          ) : groupByDeptInHistory ? (
            <div className="space-y-5">
              {resumenAnalytics.resumenDepartamentos.map((deptGroup) => (
                <div
                  key={deptGroup.departamentoNombre}
                  className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden"
                >
                  <div className="bg-slate-50 px-4 sm:px-6 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Building2 className="w-5 h-5 text-teal-600 shrink-0" />
                      <div>
                        <h4 className="text-sm font-black text-slate-900 uppercase">
                          Departamento: {deptGroup.departamentoNombre}
                        </h4>
                        <p className="text-[11px] text-slate-500 font-semibold">
                          {deptGroup.totalOperaciones} operación(es) • {deptGroup.totalUnidades} unidades entregadas •{" "}
                          RD$ {deptGroup.costoTotalEstimado.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-teal-50 text-teal-800 border border-teal-200">
                        Internos: {deptGroup.operacionesInternas}
                      </span>
                      <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                        Externos: {deptGroup.operacionesExternas}
                      </span>
                    </div>
                  </div>

                  <p className="sm:hidden text-[10px] font-bold text-slate-400 flex items-center justify-between px-4 py-1.5 bg-slate-50/50 border-b border-slate-100">
                    <span>Operación / Producto fijo</span>
                    <span>Desliza a los lados ↔</span>
                  </p>

                  <div className="w-full max-w-full overflow-x-auto overscroll-x-contain touch-pan-x [-webkit-overflow-scrolling:touch]">
                    <table className="min-w-[860px] w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100/70 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500 tracking-wider">
                          <th className="sticky left-0 z-10 bg-slate-100 px-3.5 sm:px-4 py-3 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                            Operación / Insumo (Fijo)
                          </th>
                          <th className="px-4 py-3">Responsable</th>
                          <th className="px-4 py-3">Tipo Consumo</th>
                          <th className="px-4 py-3">Productos y Cantidades</th>
                          <th className="px-4 py-3 text-center">Total Und.</th>
                          <th className="px-4 py-3">Fecha y Hora</th>
                          <th className="px-4 py-3">Sede / Usuario</th>
                          <th className="px-4 py-3 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs bg-white">
                        {deptGroup.historialCronologico.map((con) => (
                          <tr
                            key={con.id}
                            onClick={() => setSelectedConsumoDetail(con)}
                            className="hover:bg-teal-50/40 transition cursor-pointer group"
                          >
                            <td className="sticky left-0 z-10 bg-white group-hover:bg-teal-50/40 px-3.5 sm:px-4 py-3 max-w-[180px] sm:max-w-[220px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                              <span className="font-mono font-black text-teal-700 block">
                                {con.numeroOperacion}
                              </span>
                              {con.items?.[0] && (
                                <span className="text-[10px] font-bold text-slate-600 block truncate">
                                  {con.items[0].productoNombre}
                                  {(con.items?.length || 0) > 1 ? ` (+${con.items.length - 1})` : ""}
                                </span>
                              )}
                              {con.numeroPedidoReferencia && (
                                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 inline-block mt-0.5">
                                  Pedido: {con.numeroPedidoReferencia}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="font-extrabold text-slate-800 block">
                                {con.responsableNombre}
                              </span>
                              {con.responsableCargo && (
                                <span className="text-[10px] text-slate-400">
                                  {con.responsableCargo}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase whitespace-nowrap ${
                                  con.categoriaConsumo === "Externo"
                                    ? "bg-amber-50 text-amber-800 border border-amber-200"
                                    : "bg-teal-50 text-teal-800 border border-teal-200"
                                }`}
                              >
                                {con.tipoConsumoNombre} ({con.categoriaConsumo})
                              </span>
                              {con.categoriaConsumo === "Externo" &&
                                (con.destinoExternoInstitucion || con.destinoExternoPersona) && (
                                  <span className="block text-[10px] text-amber-700 font-semibold mt-0.5">
                                    Dest:{" "}
                                    {[con.destinoExternoInstitucion, con.destinoExternoPersona]
                                      .filter(Boolean)
                                      .join(" / ")}
                                  </span>
                                )}
                            </td>
                            <td className="px-4 py-3 max-w-xs">
                              <div className="space-y-0.5">
                                {(con.items || []).slice(0, 3).map((it) => (
                                  <div key={it.id} className="text-[11px] text-slate-700 truncate">
                                    • <strong>{it.productoNombre}</strong> ({it.cantidadEntregada}{" "}
                                    und. • Lote {it.numeroLote})
                                  </div>
                                ))}
                                {(con.items || []).length > 3 && (
                                  <span className="text-[10px] text-teal-700 font-bold">
                                    +{(con.items || []).length - 3} producto(s) más...
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center font-black text-slate-900">
                              {con.totalUnidades}
                            </td>
                            <td className="px-4 py-3 text-slate-600 font-semibold whitespace-nowrap">
                              {con.fecha}
                              <span className="block text-[10px] text-slate-400">{con.hora}</span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="font-bold text-slate-700 block">
                                {con.sedeNombre || con.sedeId}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {con.usuarioRegistro}
                              </span>
                            </td>
                            <td
                              className="px-4 py-3 text-right whitespace-nowrap"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setSelectedConsumoDetail(con)}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Ver</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    exportConsumoDetalleToPDF(
                                      con,
                                      `${currentUser.nombre} (${currentUser.usuario})`
                                    )
                                  }
                                  className="p-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 cursor-pointer"
                                  title="Descargar PDF"
                                >
                                  <FileDown className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    exportConsumoDetalleToWord(
                                      con,
                                      `${currentUser.nombre} (${currentUser.usuario})`
                                    )
                                  }
                                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 cursor-pointer"
                                  title="Descargar Word"
                                >
                                  <FileText className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
              <p className="sm:hidden text-[10px] font-bold text-slate-400 flex items-center justify-between px-4 py-1.5 bg-slate-50 border-b border-slate-100">
                <span>Operación / Insumo fijo</span>
                <span>Desliza a los lados ↔</span>
              </p>
              <div className="w-full max-w-full overflow-x-auto overscroll-x-contain touch-pan-x [-webkit-overflow-scrolling:touch]">
                <table className="min-w-[900px] w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500 tracking-wider">
                      <th className="sticky left-0 z-10 bg-slate-100 px-3.5 sm:px-4 py-3 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                        Operación / Insumo (Fijo)
                      </th>
                      <th className="px-4 py-3">Departamento</th>
                      <th className="px-4 py-3">Responsable</th>
                      <th className="px-4 py-3">Tipo Consumo</th>
                      <th className="px-4 py-3">Productos y Cantidades</th>
                      <th className="px-4 py-3 text-center">Total Und.</th>
                      <th className="px-4 py-3">Fecha y Hora</th>
                      <th className="px-4 py-3">Sede / Usuario</th>
                      <th className="px-4 py-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs bg-white">
                    {filteredConsumos.map((con) => (
                      <tr
                        key={con.id}
                        onClick={() => setSelectedConsumoDetail(con)}
                        className="hover:bg-teal-50/40 transition cursor-pointer group"
                      >
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-teal-50/40 px-3.5 sm:px-4 py-3 max-w-[180px] sm:max-w-[220px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                          <span className="font-mono font-black text-teal-700 block">
                            {con.numeroOperacion}
                          </span>
                          {con.items?.[0] && (
                            <span className="text-[10px] font-bold text-slate-600 block truncate">
                              {con.items[0].productoNombre}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-extrabold text-slate-900 whitespace-nowrap">
                          {con.departamentoNombre}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-700 whitespace-nowrap">
                          {con.responsableNombre}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase ${
                              con.categoriaConsumo === "Externo"
                                ? "bg-amber-50 text-amber-800 border border-amber-200"
                                : "bg-teal-50 text-teal-800 border border-teal-200"
                            }`}
                          >
                            {con.tipoConsumoNombre}
                          </span>
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          {(con.items || []).map((it) => (
                            <div key={it.id} className="text-[11px] truncate">
                              • <strong>{it.productoNombre}</strong> ({it.cantidadEntregada} und.)
                            </div>
                          ))}
                        </td>
                        <td className="px-4 py-3 text-center font-black">{con.totalUnidades}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {con.fecha} {con.hora}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="block font-bold">{con.sedeNombre}</span>
                          <span className="text-[10px] text-slate-400">{con.usuarioRegistro}</span>
                        </td>
                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => setSelectedConsumoDetail(con)}
                            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-xs cursor-pointer"
                          >
                            Detalle
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          SUB-PESTAÑA 3: RESUMEN DE CONSUMO POR DEPARTAMENTO
         ===================================================================== */}
      {activeSubTab === "resumen" && (
        <div className="space-y-5 sm:space-y-6">
          {/* Tarjetas KPI Globales */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                Operaciones
              </span>
              <p className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
                {resumenAnalytics.totalOperacionesGlobal}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                En {resumenAnalytics.resumenDepartamentos.length} dpto(s)
              </p>
            </div>

            <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                Unidades Entregadas
              </span>
              <p className="text-xl sm:text-2xl font-black text-teal-700 mt-1">
                {resumenAnalytics.totalUnidadesGlobal} und.
              </p>
              <p className="text-[11px] text-slate-500 mt-1 truncate">
                RD$ {resumenAnalytics.costoTotalGlobal.toFixed(2)}
              </p>
            </div>

            <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-wider text-teal-700 block">
                Consumo Interno
              </span>
              <p className="text-xl sm:text-2xl font-black text-teal-800 mt-1">
                {resumenAnalytics.totalInternoUnidades} und.
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {resumenAnalytics.totalInternoOperaciones} op. internas
              </p>
            </div>

            <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 block">
                Consumo Externo
              </span>
              <p className="text-xl sm:text-2xl font-black text-amber-800 mt-1">
                {resumenAnalytics.totalExternoUnidades} und.
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {resumenAnalytics.totalExternoOperaciones} op. externas
              </p>
            </div>
          </div>

          {/* Barra Completa de Filtros del Resumen por Departamento (Incluyendo Producto) y Centro de Exportación */}
          <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm sm:text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <Filter className="w-4 h-4 text-teal-600 shrink-0" />
                  <span>Filtros del Resumen e Historial por Departamento</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Filtre por departamento, responsable, producto específico, tipo de consumo o rango de fechas.
                </p>
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleClearAllFilters}
                  className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-extrabold transition cursor-pointer"
                >
                  Limpiar filtros activos
                </button>
              )}
            </div>

            {/* Cuadrícula de Filtros en Resumen por Departamento (con filtro de Producto desplegable + buscador) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* 1. Departamento */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                  Departamento
                </label>
                <select
                  value={filterDepartamento}
                  onChange={(e) => setFilterDepartamento(e.target.value)}
                  className="w-full min-h-[40px] bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-extrabold text-slate-800"
                >
                  <option value="TODOS">Comparar todos los departamentos</option>
                  {departamentosDisponibles.map((d) => (
                    <option key={d.id} value={d.nombre}>
                      Solo departamento: {d.nombre}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Responsable */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                  Responsable del Departamento
                </label>
                <select
                  value={filterResponsable}
                  onChange={(e) => setFilterResponsable(e.target.value)}
                  className="w-full min-h-[40px] bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800"
                >
                  <option value="TODOS">Todos los responsables</option>
                  {uniqueResponsablesInHistory.map((r) => (
                    <option key={r} value={r}>
                      Responsable: {r}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Filtrar por Producto (Lista Desplegable) */}
              <div>
                <label className="block text-[10px] font-black uppercase text-teal-700 mb-1">
                  Filtrar por Producto / Insumo (Lista)
                </label>
                <select
                  value={filterProductoCodigo}
                  onChange={(e) => setFilterProductoCodigo(e.target.value)}
                  className="w-full min-h-[40px] bg-teal-50/70 border border-teal-200 rounded-xl px-3 py-2 text-xs font-extrabold text-slate-800"
                >
                  <option value="TODOS">Todos los productos entregados</option>
                  {uniqueProductosInHistory.map((p) => (
                    <option key={p.codigo} value={p.codigo}>
                      {p.codigo} — {p.nombre}
                      {p.consumedCount > 0 ? ` (${p.consumedCount} und.)` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* 4. Buscador rápido de Producto / Código / Lote */}
              <div>
                <label className="block text-[10px] font-black uppercase text-teal-700 mb-1">
                  Buscar Producto por Nombre, Código o Lote
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={filterProducto}
                    onChange={(e) => setFilterProducto(e.target.value)}
                    placeholder="Escriba medicamento, código o lote..."
                    className="w-full min-h-[40px] bg-slate-50 border border-slate-200 rounded-xl pl-8.5 pr-3 py-2 text-xs font-bold text-slate-800"
                  />
                </div>
              </div>

              {/* 5. Tipo de Consumo */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                  Tipo de Consumo
                </label>
                <select
                  value={filterTipoConsumo}
                  onChange={(e) => setFilterTipoConsumo(e.target.value)}
                  className="w-full min-h-[40px] bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800"
                >
                  <option value="TODOS">Todos (Interno y Externo)</option>
                  <option value="CAT_INTERNO">Solo Internos</option>
                  <option value="CAT_EXTERNO">Solo Externos</option>
                  {tiposConsumo.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre} ({t.categoria})
                    </option>
                  ))}
                </select>
              </div>

              {/* 6. Rango de Fechas */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                    Desde
                  </label>
                  <input
                    type="date"
                    value={filterFechaDesde}
                    onChange={(e) => setFilterFechaDesde(e.target.value)}
                    className="w-full min-h-[40px] bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-[11px] font-bold text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                    Hasta
                  </label>
                  <input
                    type="date"
                    value={filterFechaHasta}
                    onChange={(e) => setFilterFechaHasta(e.target.value)}
                    className="w-full min-h-[40px] bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-2 text-[11px] font-bold text-slate-800"
                  />
                </div>
              </div>
            </div>

            {/* Botonera de los tipos de reporte exigidos en PDF y Word */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 pt-2 border-t border-slate-100">
              {(
                [
                  { id: "GENERAL", label: "Reporte General" },
                  { id: "POR_DEPARTAMENTO", label: "Por Departamento" },
                  { id: "POR_RESPONSABLE", label: "Por Responsable" },
                  { id: "POR_PERIODO", label: "Por Período / Fechas" },
                  { id: "INTERNO_EXTERNO", label: "Internos vs. Externos" }
                ] as Array<{ id: TipoReporteConsumoExport; label: string }>
              ).map((rep) => (
                <div
                  key={rep.id}
                  className="bg-slate-50 rounded-2xl p-3 border border-slate-200/80 flex flex-col justify-between gap-2"
                >
                  <span className="text-[11px] font-extrabold text-slate-800">{rep.label}</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleExportReport(rep.id, "PDF")}
                      className="flex-1 py-2 px-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-[10px] font-black uppercase flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <FileDown className="w-3 h-3 shrink-0" />
                      <span>PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportReport(rep.id, "WORD")}
                      className="flex-1 py-2 px-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-[10px] font-black uppercase flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <FileText className="w-3 h-3 shrink-0" />
                      <span>Word</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tarjetas detalladas de cada Departamento */}
          {resumenAnalytics.resumenDepartamentos.length === 0 ? (
            <div className="bg-white rounded-3xl p-8 sm:p-10 border border-slate-200 text-center space-y-2">
              <PackageMinus className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-extrabold text-slate-700">
                No hay consumos que coincidan con el producto o departamento filtrado.
              </p>
              <p className="text-xs text-slate-400">
                Cambie o limpie el filtro de producto para visualizar todos los registros del departamento.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {resumenAnalytics.resumenDepartamentos.map((dept) => (
                <div
                  key={dept.departamentoNombre}
                  className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-sm space-y-5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                    <div>
                      <h4 className="text-base font-black text-slate-900 flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-teal-600 shrink-0" />
                        <span>{dept.departamentoNombre}</span>
                      </h4>
                      <p className="text-xs text-slate-500 font-semibold mt-0.5">
                        {dept.totalOperaciones} operaciones • {dept.totalUnidades} unidades totales • Costo estimado: RD${" "}
                        {dept.costoTotalEstimado.toFixed(2)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-teal-50 text-teal-800 border border-teal-200">
                        Interno: {dept.unidadesInternas} und. ({dept.operacionesInternas} op.)
                      </span>
                      <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-amber-50 text-amber-800 border border-amber-200">
                        Externo: {dept.unidadesExternas} und. ({dept.operacionesExternas} op.)
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {/* Tabla 1: Productos entregados y cantidades totales por producto */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <h5 className="text-xs font-black uppercase text-slate-500 tracking-wider">
                          Productos Entregados y Cantidades Totales
                        </h5>
                        <span className="text-[10px] font-bold text-teal-700">
                          Toque un producto para filtrar
                        </span>
                      </div>
                      <p className="sm:hidden text-[10px] font-bold text-slate-400 flex items-center justify-between px-1">
                        <span>Medicamento / Insumo fijo</span>
                        <span>Desliza a los lados ↔</span>
                      </p>
                      <div className="w-full max-w-full overflow-x-auto overscroll-x-contain touch-pan-x [-webkit-overflow-scrolling:touch] border border-slate-200 rounded-2xl">
                        <table className="min-w-[460px] w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500">
                              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                                Medicamento / Insumo (Fijo)
                              </th>
                              <th className="px-3 py-2.5 text-center">Entregas</th>
                              <th className="px-3 py-2.5 text-right">Cant. Total</th>
                              <th className="px-3 py-2.5 text-right">Costo Est.</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {dept.productosEntregados.map((p) => {
                              const isFilteredProd =
                                normalizeTextToken(filterProductoCodigo) ===
                                normalizeTextToken(p.productoCodigo);
                              return (
                                <tr
                                  key={p.productoCodigo}
                                  onClick={() => {
                                    setFilterProductoCodigo(isFilteredProd ? "TODOS" : p.productoCodigo);
                                    playSound("click");
                                  }}
                                  className={`cursor-pointer transition group ${
                                    isFilteredProd
                                      ? "bg-teal-50/90 hover:bg-teal-100/70"
                                      : "hover:bg-slate-50"
                                  }`}
                                  title="Toque para filtrar el resumen e historial por este producto"
                                >
                                  <td
                                    className={`sticky left-0 z-10 px-3 py-2.5 max-w-[190px] sm:max-w-[240px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)] ${
                                      isFilteredProd
                                        ? "bg-teal-50 group-hover:bg-teal-100/70"
                                        : "bg-white group-hover:bg-slate-50"
                                    }`}
                                  >
                                    <span className="font-mono font-bold text-teal-700 text-[11px] block">
                                      {p.productoCodigo}
                                    </span>
                                    <span className="font-bold text-slate-800 block truncate">
                                      {p.productoNombre}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2.5 text-center text-slate-500 font-semibold">
                                    {p.operacionesCount}
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-black text-slate-900">
                                    {p.cantidadTotal}
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-semibold text-slate-600 whitespace-nowrap">
                                    RD$ {p.costoTotal.toFixed(2)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Tabla 2: Consumo por Responsable */}
                    <div className="space-y-2">
                      <h5 className="text-xs font-black uppercase text-slate-500 tracking-wider">
                        Consumo por Responsable del Departamento
                      </h5>
                      <p className="sm:hidden text-[10px] font-bold text-slate-400 flex items-center justify-between px-1">
                        <span>Responsable fijo</span>
                        <span>Desliza a los lados ↔</span>
                      </p>
                      <div className="w-full max-w-full overflow-x-auto overscroll-x-contain touch-pan-x [-webkit-overflow-scrolling:touch] border border-slate-200 rounded-2xl">
                        <table className="min-w-[440px] w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500">
                              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                                Responsable
                              </th>
                              <th className="px-3 py-2.5 text-center">Operaciones</th>
                              <th className="px-3 py-2.5 text-right">Unidades</th>
                              <th className="px-3 py-2.5 text-right">Última Entrega</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {dept.consumoPorResponsable.map((r) => (
                              <tr key={r.responsableNombre} className="hover:bg-slate-50 group">
                                <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 px-3 py-2.5 font-extrabold text-slate-800 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                                  {r.responsableNombre}
                                </td>
                                <td className="px-3 py-2.5 text-center font-semibold text-slate-600">
                                  {r.totalOperaciones}
                                </td>
                                <td className="px-3 py-2.5 text-right font-black text-teal-700">
                                  {r.totalUnidades}
                                </td>
                                <td className="px-3 py-2.5 text-right text-[11px] text-slate-500 whitespace-nowrap">
                                  {r.ultimaEntrega}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Tabla 3: Historial Cronológico del Departamento (Filtrado por Producto, Responsable y Fechas) */}
                  <div className="space-y-2.5 pt-2 border-t border-slate-100">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <h5 className="text-xs font-black uppercase text-slate-600 tracking-wider flex items-center gap-1.5">
                        <History className="w-3.5 h-3.5 text-teal-600" />
                        <span>
                          Historial de Consumos de {dept.departamentoNombre} ({dept.historialCronologico.length})
                        </span>
                      </h5>
                      {(filterProductoCodigo !== "TODOS" || filterProducto.trim() !== "") && (
                        <span className="text-[10px] font-black text-teal-800 bg-teal-50 px-2.5 py-1 rounded-full border border-teal-200 self-start sm:self-auto">
                          Filtrado por producto activo
                        </span>
                      )}
                    </div>

                    <p className="sm:hidden text-[10px] font-bold text-slate-400 flex items-center justify-between px-1">
                      <span>Medicamento / Operación fijo</span>
                      <span>Desliza a los lados ↔</span>
                    </p>

                    <div className="w-full max-w-full overflow-x-auto overscroll-x-contain touch-pan-x [-webkit-overflow-scrolling:touch] border border-slate-200 rounded-2xl">
                      <table className="min-w-[740px] w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500">
                            <th className="sticky left-0 z-10 bg-slate-50 px-3.5 py-2.5 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                              Productos / Operación (Fijo)
                            </th>
                            <th className="px-3.5 py-2.5">Responsable</th>
                            <th className="px-3.5 py-2.5">Tipo</th>
                            <th className="px-3.5 py-2.5 text-center">Cant. Total</th>
                            <th className="px-3.5 py-2.5">Fecha y Hora</th>
                            <th className="px-3.5 py-2.5 text-right">Detalle</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {dept.historialCronologico.map((con) => (
                            <tr
                              key={con.id}
                              onClick={() => setSelectedConsumoDetail(con)}
                              className="hover:bg-teal-50/40 transition cursor-pointer group"
                            >
                              <td className="sticky left-0 z-10 bg-white group-hover:bg-teal-50/40 px-3.5 py-2.5 max-w-[210px] sm:max-w-[280px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                                <span className="font-mono text-[10px] font-black text-teal-700 block">
                                  {con.numeroOperacion}
                                </span>
                                <div className="space-y-0.5 mt-0.5">
                                  {(con.items || []).map((it) => (
                                    <div key={it.id} className="text-[11px] font-bold text-slate-800 truncate">
                                      • {it.productoNombre} ({it.cantidadEntregada} und.)
                                    </div>
                                  ))}
                                </div>
                              </td>
                              <td className="px-3.5 py-2.5 font-bold text-slate-700 whitespace-nowrap">
                                {con.responsableNombre}
                              </td>
                              <td className="px-3.5 py-2.5 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                    con.categoriaConsumo === "Externo"
                                      ? "bg-amber-50 text-amber-800 border border-amber-200"
                                      : "bg-teal-50 text-teal-800 border border-teal-200"
                                  }`}
                                >
                                  {con.tipoConsumoNombre}
                                </span>
                              </td>
                              <td className="px-3.5 py-2.5 text-center font-black text-slate-900">
                                {con.totalUnidades}
                              </td>
                              <td className="px-3.5 py-2.5 text-slate-600 whitespace-nowrap">
                                {con.fecha} {con.hora}
                              </td>
                              <td
                                className="px-3.5 py-2.5 text-right whitespace-nowrap"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => setSelectedConsumoDetail(con)}
                                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] cursor-pointer"
                                >
                                  Ver
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          MODAL 1: VISTA PREVIA ANTES DE CONFIRMAR CONSUMO
         ===================================================================== */}
      {showConfirmPreview && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-5 sm:p-6 border border-slate-200 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-teal-700">
                  Verificación Previa de Salida de Inventario
                </span>
                <h3 className="text-lg font-black text-slate-900">
                  Resumen del Consumo a Confirmar
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowConfirmPreview(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200 text-xs">
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Sede / Fecha
                </span>
                <span className="font-extrabold text-slate-800">
                  {sedeNombre} • {fechaConsumo}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Departamento Destinatario
                </span>
                <span className="font-extrabold text-teal-800">{selectedDepartamento}</span>
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Responsable Receptor
                </span>
                <span className="font-extrabold text-slate-800">
                  {selectedResponsableObj?.nombre}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Tipo de Consumo
                </span>
                <span className="font-extrabold text-slate-800">
                  {selectedTipoConsumoObj?.nombre} ({selectedTipoConsumoObj?.categoria})
                </span>
              </div>
              {isConsumoExterno && (
                <div className="sm:col-span-2 border-t border-slate-200 pt-2">
                  <span className="text-[10px] font-black uppercase text-amber-700 block">
                    Destino Externo
                  </span>
                  <span className="font-bold text-slate-800">
                    {[destinoExternoInstitucion, destinoExternoPersona].filter(Boolean).join(" • ")}
                  </span>
                </div>
              )}
              <div className="sm:col-span-2 border-t border-slate-200 pt-2">
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Usuario que Registra
                </span>
                <span className="font-bold text-slate-700">
                  {currentUser.nombre} ({currentUser.usuario})
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="sm:hidden text-[10px] font-bold text-slate-400 flex items-center justify-between px-1">
                <span>Medicamento / Insumo fijo</span>
                <span>Desliza a los lados ↔</span>
              </p>
              <div className="w-full max-w-full overflow-x-auto overscroll-x-contain touch-pan-x [-webkit-overflow-scrolling:touch] border border-slate-200 rounded-2xl">
                <table className="min-w-[460px] w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500">
                      <th className="sticky left-0 z-10 bg-slate-100 px-3.5 py-2.5 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                        Medicamento / Insumo (Fijo)
                      </th>
                      <th className="px-3.5 py-2.5 text-center">Lote</th>
                      <th className="px-3.5 py-2.5 text-right">Cantidad</th>
                      <th className="px-3.5 py-2.5 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {draftItems.map((it) => (
                      <tr key={it.id} className="hover:bg-slate-50 group">
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 px-3.5 py-2.5 font-bold text-slate-800 max-w-[200px] sm:max-w-[260px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                          <span className="font-mono text-[11px] text-teal-700 block">
                            {it.productoCodigo}
                          </span>
                          <span className="block truncate">{it.productoNombre}</span>
                        </td>
                        <td className="px-3.5 py-2.5 text-center font-mono whitespace-nowrap">
                          {it.numeroLote}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-black">
                          {it.cantidadEntregada}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-semibold whitespace-nowrap">
                          RD$ {it.subtotal.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
              <div className="text-xs font-bold text-slate-600">
                Total a descontar del inventario:{" "}
                <strong className="text-teal-800">{totalDraftUnidades} unidades</strong> (RD${" "}
                {totalDraftCosto.toFixed(2)})
              </div>
              <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmPreview(false)}
                  className="w-full sm:w-auto min-h-[42px] px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Volver a editar
                </button>
                <button
                  type="button"
                  disabled={submittingConsumo}
                  onClick={handleConfirmarConsumo}
                  className="w-full sm:w-auto min-h-[42px] px-6 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-md"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{submittingConsumo ? "Procesando..." : "Confirmar consumo"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: DETALLE COMPLETO DE UNA OPERACIÓN DE CONSUMO
         ===================================================================== */}
      {selectedConsumoDetail && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full p-4 sm:p-6 border border-slate-200 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs sm:text-sm font-black text-teal-700 bg-teal-50 px-3 py-1 rounded-full border border-teal-200">
                    {selectedConsumoDetail.numeroOperacion}
                  </span>
                  <span
                    className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full ${
                      selectedConsumoDetail.categoriaConsumo === "Externo"
                        ? "bg-amber-50 text-amber-800 border border-amber-200"
                        : "bg-teal-50 text-teal-800 border border-teal-200"
                    }`}
                  >
                    {selectedConsumoDetail.tipoConsumoNombre} ({selectedConsumoDetail.categoriaConsumo})
                  </span>
                </div>
                <h3 className="text-base sm:text-lg font-black text-slate-900 mt-1.5">
                  Detalle de Consumo • {selectedConsumoDetail.departamentoNombre}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setSelectedConsumoDetail(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3.5 sm:p-4 rounded-2xl border border-slate-200 text-xs">
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Departamento
                </span>
                <span className="font-extrabold text-slate-900">
                  {selectedConsumoDetail.departamentoNombre}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Responsable Receptor
                </span>
                <span className="font-extrabold text-slate-900">
                  {selectedConsumoDetail.responsableNombre}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Fecha y Hora
                </span>
                <span className="font-bold text-slate-800">
                  {selectedConsumoDetail.fecha} a las {selectedConsumoDetail.hora}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Sede Institucional
                </span>
                <span className="font-bold text-slate-800">
                  {selectedConsumoDetail.sedeNombre || selectedConsumoDetail.sedeId}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Registrado por
                </span>
                <span className="font-bold text-slate-800">
                  {selectedConsumoDetail.usuarioRegistro}
                </span>
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Origen de Operación
                </span>
                <span className="font-bold text-teal-800">
                  {selectedConsumoDetail.origenOperacion}
                  {selectedConsumoDetail.numeroPedidoReferencia
                    ? ` (${selectedConsumoDetail.numeroPedidoReferencia})`
                    : ""}
                </span>
              </div>
              {selectedConsumoDetail.categoriaConsumo === "Externo" && (
                <div className="sm:col-span-3 border-t border-slate-200 pt-2">
                  <span className="text-[10px] font-black uppercase text-amber-700 block">
                    Destino Externo / Persona Receptora
                  </span>
                  <span className="font-bold text-slate-800">
                    {[
                      selectedConsumoDetail.destinoExternoInstitucion,
                      selectedConsumoDetail.destinoExternoPersona
                    ]
                      .filter(Boolean)
                      .join(" • ") || "Especificado como externo"}
                  </span>
                </div>
              )}
              {selectedConsumoDetail.observaciones && (
                <div className="sm:col-span-3 border-t border-slate-200 pt-2">
                  <span className="text-[10px] font-black uppercase text-slate-400 block">
                    Observaciones
                  </span>
                  <span className="font-medium text-slate-700">
                    {selectedConsumoDetail.observaciones}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="sm:hidden text-[10px] font-bold text-slate-400 flex items-center justify-between px-1">
                <span>Medicamento / Insumo fijo</span>
                <span>Desliza a los lados ↔</span>
              </p>
              <div className="w-full max-w-full overflow-x-auto overscroll-x-contain touch-pan-x [-webkit-overflow-scrolling:touch] border border-slate-200 rounded-2xl">
                <table className="min-w-[540px] w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500">
                      <th className="sticky left-0 z-10 bg-slate-100 px-3.5 py-2.5 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                        Medicamento / Insumo (Fijo)
                      </th>
                      <th className="px-3.5 py-2.5 text-center">Lote</th>
                      <th className="px-3.5 py-2.5 text-center">Vencimiento</th>
                      <th className="px-3.5 py-2.5 text-right">Cantidad</th>
                      <th className="px-3.5 py-2.5 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {(selectedConsumoDetail.items || []).map((it) => (
                      <tr key={it.id} className="hover:bg-slate-50 group">
                        <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 px-3.5 py-2.5 max-w-[200px] sm:max-w-[260px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                          <span className="font-mono font-bold text-teal-700 text-[11px] block">
                            {it.productoCodigo}
                          </span>
                          <span className="font-bold text-slate-800 block truncate">
                            {it.productoNombre}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 text-center font-mono whitespace-nowrap">
                          {it.numeroLote}
                        </td>
                        <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                          {it.fechaVencimiento}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-black">
                          {it.cantidadEntregada}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-semibold whitespace-nowrap">
                          RD$ {Number(it.subtotal || 0).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Historial de notas de corrección auditadas (si existen) */}
            {selectedConsumoDetail.historialCorrecciones &&
              selectedConsumoDetail.historialCorrecciones.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-900 block">
                    Historial de Correcciones / Aclaraciones Documentadas
                  </span>
                  {selectedConsumoDetail.historialCorrecciones.map((corr, idx) => (
                    <div key={idx} className="text-xs text-amber-950 border-t border-amber-200/60 pt-1.5">
                      <strong>
                        {corr.fecha} {corr.hora} — {corr.usuario}:
                      </strong>{" "}
                      {corr.motivo}
                    </div>
                  ))}
                </div>
              )}

            {/* Formulario para agregar aclaración/corrección auditada (Solo Administrador) */}
            {isAdmin && (
              <form
                onSubmit={handleGuardarNotaCorreccion}
                className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2"
              >
                <label className="block text-[10px] font-black uppercase text-slate-500">
                  Registrar Nota de Corrección / Auditoría Documentada (Sin eliminación silenciosa)
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={motivoCorreccion}
                    onChange={(e) => setMotivoCorreccion(e.target.value)}
                    placeholder="Describa la aclaración o corrección autorizada..."
                    className="flex-1 min-h-[40px] bg-white rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800"
                  />
                  <button
                    type="submit"
                    disabled={savingCorreccion || !motivoCorreccion.trim()}
                    className="w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 disabled:bg-slate-300 text-white text-xs font-extrabold cursor-pointer"
                  >
                    Anexar Nota
                  </button>
                </div>
              </form>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-slate-100">
              <div className="grid grid-cols-1 sm:flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    exportConsumoDetalleToPDF(
                      selectedConsumoDetail,
                      `${currentUser.nombre} (${currentUser.usuario})`
                    )
                  }
                  className="w-full sm:w-auto min-h-[42px] px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FileDown className="w-4 h-4 shrink-0" />
                  <span>Exportar Comprobante PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    exportConsumoDetalleToWord(
                      selectedConsumoDetail,
                      `${currentUser.nombre} (${currentUser.usuario})`
                    )
                  }
                  className="w-full sm:w-auto min-h-[42px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <FileText className="w-4 h-4 shrink-0" />
                  <span>Exportar Comprobante Word</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setSelectedConsumoDetail(null)}
                className="w-full sm:w-auto min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
