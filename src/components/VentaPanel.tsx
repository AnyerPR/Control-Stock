import React, { useState, useEffect, useMemo } from "react";
import { doc, getDoc, setDoc, writeBatch } from "firebase/firestore";
import { db, tenantCollection, tenantDoc } from "../firebase";
import {
  Producto,
  Usuario,
  Catalogo,
  ConceptoFactura,
  DEFAULT_CONCEPTOS_FACTURA,
  VentaItem,
  FacturaVenta,
  InstitucionInfo,
  Movimiento,
  ConfiguracionFiscalDGII,
  TipoComprobanteDGII,
  FormaPagoDGII,
  RegistroAnulacion608,
  getUserAvailableCatalogos,
  getEnabledModules
} from "../types";
import {
  getActiveInstitucionInfo,
  exportSaleInvoiceToPDF,
  exportSaleInvoiceToWord,
  shareSaleInvoiceViaWhatsApp,
  formatPhoneForWhatsApp
} from "../utils/exportUtils";
import {
  CATALOGO_TIPOS_COMPROBANTE,
  CODIGOS_MODIFICACION_NCF,
  FORMAS_PAGO_DGII,
  MOTIVOS_ANULACION_608,
  appendAuditoriaFiscal,
  cleanRncCedula,
  downloadTextFile,
  formatNCFSequence,
  getDefaultConfiguracionDGII,
  getMetadataTipoComprobante,
  loadAnulaciones608,
  loadConfiguracionDGII,
  saveAnulaciones608List,
  saveConfiguracionDGII,
  signAndProcessECF,
  validateNCFFormat,
  validateRncOrCedulaDGII
} from "../utils/dgiiUtils";
import { playSound } from "../utils/audio";
import { logSystemEvent } from "../utils/chatHelper";
import {
  ShoppingBag,
  Plus,
  Trash2,
  FileText,
  FileDown,
  Search,
  User,
  Phone,
  Tag,
  Calendar,
  CheckCircle2,
  Building2,
  Eye,
  X,
  Layers,
  Receipt,
  Percent,
  Send,
  Hash,
  AlertCircle,
  ShieldCheck,
  FileCode2,
  Ban,
  RotateCcw,
  CreditCard
} from "lucide-react";

interface VentaPanelProps {
  products: Producto[];
  catalogos: Catalogo[];
  activeCatalogId: string;
  onSelectCatalog?: (catalogId: string) => void;
  onProductsUpdated?: (updated: Producto[]) => void;
  currentUser: Usuario;
  conceptos: ConceptoFactura[];
  institucion?: InstitucionInfo;
  showToast: (msg: string) => void;
}

const ITBIS_RATE = 0.18;

export default function VentaPanel({
  products,
  catalogos,
  activeCatalogId,
  onSelectCatalog,
  onProductsUpdated,
  currentUser,
  conceptos,
  institucion,
  showToast
}: VentaPanelProps) {
  const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
  const isAdmin = currentUser?.rol === "Administrador";

  // Internal catalog state synced with global activeCatalogId so dropdown always works
  const [selectedCatalogId, setSelectedCatalogId] = useState<string>(
    activeCatalogId || "default-cat"
  );

  useEffect(() => {
    if (activeCatalogId && activeCatalogId !== selectedCatalogId && selectedCatalogId !== "todos") {
      setSelectedCatalogId(activeCatalogId);
    }
  }, [activeCatalogId]);

  const handleCatalogChange = (newCatId: string) => {
    setSelectedCatalogId(newCatId);
    setSelectedProductCode("");
    setSelectedLoteId("");
    if (newCatId !== "todos" && onSelectCatalog) {
      onSelectCatalog(newCatId);
    }
    playSound("click");
  };

  const activeCatalogosList = useMemo(() => {
    return getUserAvailableCatalogos(currentUser, catalogos);
  }, [currentUser, catalogos]);

  const activeConceptos = useMemo(() => {
    const list = conceptos && conceptos.length > 0 ? conceptos : DEFAULT_CONCEPTOS_FACTURA;
    const filtered = list.filter((c) => c.activo);
    return filtered.length > 0 ? filtered : DEFAULT_CONCEPTOS_FACTURA;
  }, [conceptos]);

  const currentInstitucion = useMemo<InstitucionInfo>(() => {
    if (institucion && institucion.nombre) return institucion;
    return getActiveInstitucionInfo();
  }, [institucion]);

  // Sub-tabs inside Venta module: "nueva" (Emitir Factura) | "historial" (Facturas Emitidas)
  const [subTab, setSubTab] = useState<"nueva" | "historial">("nueva");

  // DGII Fiscal Configuration state
  const [dgiiConfig, setDgiiConfig] = useState<ConfiguracionFiscalDGII>(() =>
    getDefaultConfiguracionDGII(currentInstitucion)
  );
  const [modalidadFiscal, setModalidadFiscal] = useState<"ECF_SERIE_E" | "NCF_SERIE_B" | "INTERNA">(
    "ECF_SERIE_E"
  );
  const [tipoComprobante, setTipoComprobante] = useState<TipoComprobanteDGII>("E32");
  const [ncfInput, setNcfInput] = useState<string>("E320000000001");
  const [rncCliente, setRncCliente] = useState<string>("");
  const [formaPagoDGII, setFormaPagoDGII] = useState<FormaPagoDGII>("01");
  const [ncfModificado, setNcfModificado] = useState<string>("");
  const [fechaNcfModificado, setFechaNcfModificado] = useState<string>("");
  const [codigoModificacion, setCodigoModificacion] = useState<"01" | "02" | "03" | "04">("03");
  const [motivoModificacion, setMotivoModificacion] = useState<string>("");
  const [reintegrarStockEnNotaCredito, setReintegrarStockEnNotaCredito] = useState<boolean>(true);
  const [enviarAutoDGII, setEnviarAutoDGII] = useState<boolean>(false);

  // Invoice Header State
  const [facturasHistorial, setFacturasHistorial] = useState<FacturaVenta[]>([]);
  const [numeroFactura, setNumeroFactura] = useState<string>("FAC-0001");
  const [fechaFactura, setFechaFactura] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [conceptoSeleccionado, setConceptoSeleccionado] = useState<string>(
    () => activeConceptos[0]?.nombre || "Venta"
  );
  const [clienteNombre, setClienteNombre] = useState<string>("");
  const [clienteContacto, setClienteContacto] = useState<string>("");
  const [observaciones, setObservaciones] = useState<string>("");

  // ITBIS State (Product level & Invoice level: 18%, 16%, 0% Exento)
  const [aplicaItbisFactura, setAplicaItbisFactura] = useState<boolean>(false);
  const [aplicaItbisProducto, setAplicaItbisProducto] = useState<boolean>(false);
  const [tasaItbisSeleccionada, setTasaItbisSeleccionada] = useState<18 | 16 | 0>(18);
  const [descuentoPorcentajeInput, setDescuentoPorcentajeInput] = useState<string>("0");

  // Product Selection State
  const [productSearch, setProductSearch] = useState<string>("");
  const [selectedProductCode, setSelectedProductCode] = useState<string>("");
  const [selectedLoteId, setSelectedLoteId] = useState<string>("");
  const [cantidadInput, setCantidadInput] = useState<string>("1");
  const [precioUnitarioInput, setPrecioUnitarioInput] = useState<string>("");

  // Invoice Items State
  const [itemsFactura, setItemsFactura] = useState<VentaItem[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // History Search & Modal Preview / Annulment State
  const [historySearch, setHistorySearch] = useState<string>("");
  const [previewFactura, setPreviewFactura] = useState<FacturaVenta | null>(null);
  const [annullingFactura, setAnnullingFactura] = useState<FacturaVenta | null>(null);
  const [motivoAnulacion608, setMotivoAnulacion608] =
    useState<RegistroAnulacion608["tipoAnulacion"]>("04");
  const [detalleAnulacion608, setDetalleAnulacion608] = useState<string>("");
  const [reintegrarStockAnulacion, setReintegrarStockAnulacion] = useState<boolean>(true);

  // Load DGII Config
  useEffect(() => {
    let active = true;
    const fetchDgii = async () => {
      const cfg = await loadConfiguracionDGII(currentUser?.farmaciaId, currentInstitucion);
      if (!active) return;
      setDgiiConfig(cfg);
      if (cfg.modoContingenciaActivo) {
        setModalidadFiscal("NCF_SERIE_B");
        setTipoComprobante("B02");
      } else if (cfg.modalidadEmisionActiva === "SOLO_NCF_B") {
        setModalidadFiscal("NCF_SERIE_B");
        setTipoComprobante("B02");
      } else {
        setModalidadFiscal("ECF_SERIE_E");
        setTipoComprobante("E32");
      }
    };
    fetchDgii();
    const onUpdated = () => fetchDgii();
    window.addEventListener("dgii_config_updated", onUpdated);
    return () => {
      active = false;
      window.removeEventListener("dgii_config_updated", onUpdated);
    };
  }, [currentUser?.farmaciaId, currentInstitucion]);

  // Synchronize NCF preview whenever tipoComprobante or dgiiConfig.secuencias changes
  const activeSequenceObj = useMemo(() => {
    return dgiiConfig.secuencias.find((s) => s.tipo === tipoComprobante);
  }, [dgiiConfig.secuencias, tipoComprobante]);

  useEffect(() => {
    if (modalidadFiscal === "INTERNA") {
      setNcfInput("");
      return;
    }
    if (activeSequenceObj) {
      setNcfInput(formatNCFSequence(tipoComprobante, activeSequenceObj.secuenciaActual));
    } else {
      setNcfInput(formatNCFSequence(tipoComprobante, 1));
    }
  }, [modalidadFiscal, tipoComprobante, activeSequenceObj]);

  const metaComprobanteActual = useMemo(
    () => getMetadataTipoComprobante(tipoComprobante),
    [tipoComprobante]
  );

  const validacionRncCliente = useMemo(
    () =>
      validateRncOrCedulaDGII(
        rncCliente,
        tipoComprobante === "B16" || tipoComprobante === "E46"
      ),
    [rncCliente, tipoComprobante]
  );

  // Sync default selected concept if activeConceptos changes
  useEffect(() => {
    if (
      activeConceptos.length > 0 &&
      !activeConceptos.some((c) => c.nombre === conceptoSeleccionado)
    ) {
      setConceptoSeleccionado(activeConceptos[0].nombre);
    }
  }, [activeConceptos, conceptoSeleccionado]);

  // Load saved invoices from configuracion/registro_ventas
  useEffect(() => {
    let cancelled = false;
    const loadFacturas = async () => {
      if (isLocalFileMode) {
        const stored = localStorage.getItem("offline_facturas_venta");
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as FacturaVenta[];
            if (!cancelled) {
              setFacturasHistorial(parsed);
              const nextNum = parsed.length + 1;
              setNumeroFactura(`FAC-${String(nextNum).padStart(4, "0")}`);
            }
          } catch {}
        }
        return;
      }

      try {
        const docSnap = await getDoc(tenantDoc("configuracion", "registro_ventas"));
        if (!cancelled && docSnap.exists()) {
          const list = Array.isArray(docSnap.data()?.facturas)
            ? (docSnap.data().facturas as FacturaVenta[])
            : [];
          list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          setFacturasHistorial(list);
          const nextNum = list.length + 1;
          setNumeroFactura(`FAC-${String(nextNum).padStart(4, "0")}`);
        }
      } catch (err) {
        console.warn("Error cargando historial de ventas:", err);
      }
    };

    loadFacturas();
    return () => {
      cancelled = true;
    };
  }, [isLocalFileMode, currentUser?.farmaciaId]);

  const activeCatalogName = useMemo(() => {
    if (selectedCatalogId === "todos") return "Todos los Catálogos";
    return (
      activeCatalogosList.find((c) => c.id === selectedCatalogId)?.nombre ||
      "Medicamentos e Insumos"
    );
  }, [activeCatalogosList, selectedCatalogId]);

  const getLotStock = (l: any): number => {
    const sys = Number(l?.cantidad || 0);
    const phys = Number(l?.cantidadF || 0);
    return Math.max(sys, phys);
  };

  const catalogProducts = useMemo(() => {
    const validCatIds = new Set(activeCatalogosList.map((c) => c.id));
    const selectedCatObj = activeCatalogosList.find((c) => c.id === selectedCatalogId);

    const list = (products || []).filter((p) => {
      if (!p || !p.codigo || !p.nombre) return false;
      if (selectedCatalogId === "todos") return true;

      const rawCat = (p.catalogId || "").trim();
      const normalizedCat = !rawCat || !validCatIds.has(rawCat) ? "default-cat" : rawCat;

      if (normalizedCat === selectedCatalogId) return true;
      if (
        selectedCatObj &&
        rawCat.toLowerCase() === selectedCatObj.nombre.trim().toLowerCase()
      ) {
        return true;
      }
      return false;
    });

    return [...list].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [products, selectedCatalogId, activeCatalogosList]);

  const filteredCatalogProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return catalogProducts;
    return catalogProducts.filter(
      (p) =>
        p.codigo.toLowerCase().includes(q) ||
        p.nombre.toLowerCase().includes(q) ||
        (p.descripcion && p.descripcion.toLowerCase().includes(q)) ||
        (p.lotes || []).some((l) => (l.numeroLote || "").toLowerCase().includes(q))
    );
  }, [catalogProducts, productSearch]);

  const selectedProduct = useMemo(() => {
    if (!selectedProductCode) return null;
    return (
      catalogProducts.find((p) => p.codigo === selectedProductCode) ||
      products.find((p) => p.codigo === selectedProductCode) ||
      null
    );
  }, [catalogProducts, products, selectedProductCode]);

  const productLots = useMemo(() => {
    if (!selectedProduct) return [];
    const lots = selectedProduct.lotes || [];
    return [...lots].sort((a, b) => getLotStock(b) - getLotStock(a));
  }, [selectedProduct]);

  const selectedLot = useMemo(() => {
    return productLots.find((l) => l.id === selectedLoteId) || null;
  }, [productLots, selectedLoteId]);

  useEffect(() => {
    if (!selectedProduct) {
      setSelectedLoteId("");
      setPrecioUnitarioInput("");
      setCantidadInput("1");
      return;
    }

    if (productLots.length > 0) {
      const lotWithStock = productLots.find((l) => getLotStock(l) > 0) || productLots[0];
      setSelectedLoteId(lotWithStock.id);
      setPrecioUnitarioInput(String(Number(lotWithStock.precio || 0)));
      setCantidadInput("1");
    } else {
      setSelectedLoteId("");
      setPrecioUnitarioInput("0");
      setCantidadInput("1");
    }
  }, [selectedProductCode, selectedProduct]);

  const handleSelectLotChange = (lotId: string) => {
    setSelectedLoteId(lotId);
    const found = productLots.find((l) => l.id === lotId);
    if (found) {
      setPrecioUnitarioInput(String(Number(found.precio || 0)));
    }
  };

  // Toggle global ITBIS for the entire invoice
  const handleToggleItbisFactura = (checked: boolean) => {
    setAplicaItbisFactura(checked);
    setAplicaItbisProducto(checked);
    const rate = checked ? (tasaItbisSeleccionada || 18) / 100 : 0;
    const tasaNum: 18 | 16 | 0 = checked ? (tasaItbisSeleccionada === 16 ? 16 : 18) : 0;
    setItemsFactura((prev) =>
      prev.map((item) => {
        const sub = item.subtotal;
        const itbis = checked ? sub * rate : 0;
        return {
          ...item,
          aplicaItbis: checked,
          tasaItbis: tasaNum,
          itbisMonto: itbis,
          totalItem: sub + itbis
        };
      })
    );
    playSound("click");
  };

  // Toggle ITBIS for a specific item in the invoice table
  const handleToggleItemItbis = (itemId: string) => {
    setItemsFactura((prev) => {
      const updated = prev.map((item) => {
        if (item.id !== itemId) return item;
        const nextItbisFlag = !item.aplicaItbis;
        const tasa: 18 | 16 | 0 = nextItbisFlag ? 18 : 0;
        const sub = item.subtotal;
        const itbis = nextItbisFlag ? sub * ITBIS_RATE : 0;
        return {
          ...item,
          aplicaItbis: nextItbisFlag,
          tasaItbis: tasa,
          itbisMonto: itbis,
          totalItem: sub + itbis
        };
      });
      setAplicaItbisFactura(updated.length > 0 && updated.every((i) => !!i.aplicaItbis));
      return updated;
    });
    playSound("click");
  };

  const getCommittedQtyForLot = (prodCode: string, lotId: string): number => {
    return itemsFactura
      .filter((i) => i.productoCodigo === prodCode && i.loteId === lotId)
      .reduce((acc, cur) => acc + cur.cantidad, 0);
  };

  const isNotaCreditoActual = Boolean(
    metaComprobanteActual?.esNotaCredito || tipoComprobante === "B04" || tipoComprobante === "E34"
  );

  const handleAddItemToInvoice = () => {
    if (!selectedProduct) {
      alert("Seleccione un medicamento, insumo o producto de la lista desplegable.");
      return;
    }
    if (!selectedLot) {
      alert("Seleccione un lote para este producto.");
      return;
    }

    const qty = Number(cantidadInput);
    const price = Number(precioUnitarioInput || 0);
    const descPct = Math.min(100, Math.max(0, Number(descuentoPorcentajeInput || 0)));

    if (isNaN(qty) || qty <= 0) {
      alert("Ingrese una cantidad válida mayor que 0.");
      return;
    }
    if (isNaN(price) || price < 0) {
      alert("Ingrese un precio unitario válido.");
      return;
    }

    // Si NO es Nota de Crédito (devolución), validar existencia disponible en el lote
    if (!isNotaCreditoActual) {
      const alreadyInList = getCommittedQtyForLot(selectedProduct.codigo, selectedLot.id);
      const maxLotStock = getLotStock(selectedLot);
      const remainingStock = maxLotStock - alreadyInList;

      if (qty > remainingStock) {
        alert(
          `Stock insuficiente en el lote ${selectedLot.numeroLote}. Disponible: ${remainingStock} unidades.`
        );
        return;
      }
    }

    // Exención automática en Regímenes Especiales (B14/E44) o Exportaciones (B16/E46)
    const isExentoPorComprobante =
      tipoComprobante === "B14" ||
      tipoComprobante === "E44" ||
      tipoComprobante === "B16" ||
      tipoComprobante === "E46";

    const itemAppliesItbis =
      !isExentoPorComprobante && (aplicaItbisProducto || aplicaItbisFactura);
    const activeRateNumber: 18 | 16 | 0 = itemAppliesItbis
      ? tasaItbisSeleccionada === 16
        ? 16
        : 18
      : 0;
    const rateDecimal = activeRateNumber / 100;

    setItemsFactura((prev) => {
      const existingIndex = prev.findIndex(
        (i) => i.productoCodigo === selectedProduct.codigo && i.loteId === selectedLot.id
      );
      if (existingIndex >= 0) {
        return prev.map((item, idx) => {
          if (idx !== existingIndex) return item;
          const nextQty = item.cantidad + qty;
          const bruto = nextQty * price;
          const descMonto = bruto * (descPct / 100);
          const nextSub = bruto - descMonto;
          const nextItbis = itemAppliesItbis ? nextSub * rateDecimal : 0;
          return {
            ...item,
            cantidad: nextQty,
            precioUnitario: price,
            descuentoPorcentaje: descPct,
            descuentoMonto: descMonto,
            subtotal: nextSub,
            aplicaItbis: itemAppliesItbis,
            tasaItbis: activeRateNumber,
            itbisMonto: nextItbis,
            totalItem: nextSub + nextItbis
          };
        });
      }

      const bruto = qty * price;
      const descMonto = bruto * (descPct / 100);
      const sub = bruto - descMonto;
      const itbis = itemAppliesItbis ? sub * rateDecimal : 0;

      const newItem: VentaItem = {
        id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        productoCodigo: selectedProduct.codigo,
        productoNombre: selectedProduct.nombre,
        descripcion: selectedProduct.descripcion || "",
        loteId: selectedLot.id,
        numeroLote: selectedLot.numeroLote,
        fechaVencimiento: selectedLot.fechaVencimiento || "",
        cantidad: qty,
        precioUnitario: price,
        descuentoPorcentaje: descPct,
        descuentoMonto: descMonto,
        subtotal: sub,
        aplicaItbis: itemAppliesItbis,
        tasaItbis: activeRateNumber,
        itbisMonto: itbis,
        totalItem: sub + itbis
      };
      return [...prev, newItem];
    });

    setCantidadInput("1");
    setDescuentoPorcentajeInput("0");
    playSound("positive");
    showToast(`"${selectedProduct.nombre}" agregado al comprobante.`);
  };

  const handleUpdateItemQty = (itemId: string, newQty: number) => {
    if (newQty <= 0) return;
    const targetItem = itemsFactura.find((i) => i.id === itemId);
    if (!targetItem) return;

    const prod = products.find((p) => p.codigo === targetItem.productoCodigo);
    const lot = prod?.lotes.find((l) => l.id === targetItem.loteId);
    const maxStock = lot ? getLotStock(lot) : Infinity;

    if (!isNotaCreditoActual && lot && newQty > maxStock) {
      showToast(`El lote ${lot.numeroLote} solo dispone de ${maxStock} unidades.`);
      return;
    }

    setItemsFactura((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        const bruto = newQty * item.precioUnitario;
        const descPct = Number(item.descuentoPorcentaje || 0);
        const descMonto = bruto * (descPct / 100);
        const nextSub = bruto - descMonto;
        const rate = item.aplicaItbis ? Number(item.tasaItbis || 18) / 100 : 0;
        const nextItbis = item.aplicaItbis ? nextSub * rate : 0;
        return {
          ...item,
          cantidad: newQty,
          descuentoMonto: descMonto,
          subtotal: nextSub,
          itbisMonto: nextItbis,
          totalItem: nextSub + nextItbis
        };
      })
    );
  };

  const handleRemoveItem = (itemId: string) => {
    setItemsFactura((prev) => prev.filter((i) => i.id !== itemId));
    playSound("click");
  };

  // Cargar datos desde una factura previa cuando se emite Nota de Crédito (B04/E34) o Débito (B03/E33)
  const handleSelectFacturaParaModificar = (facId: string) => {
    const found = facturasHistorial.find((f) => f.id === facId || f.ncf === facId);
    if (!found) return;
    setNcfModificado(found.ncf || found.numeroFactura);
    setFechaNcfModificado(found.fecha);
    if (found.clienteNombre) setClienteNombre(found.clienteNombre);
    if (found.rncCliente) setRncCliente(found.rncCliente);
    if (found.clienteContacto) setClienteContacto(found.clienteContacto);
    setItemsFactura(
      found.items.map((it) => ({
        ...it,
        id: `item-nc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      }))
    );
    setConceptoSeleccionado(isNotaCreditoActual ? "Devolución / Nota de Crédito" : "Nota de Débito");
    setMotivoModificacion(
      `Devolución / ajuste correspondiente al comprobante ${found.ncf || found.numeroFactura}`
    );
    playSound("positive");
    showToast(`Datos cargados del comprobante ${found.ncf || found.numeroFactura}.`);
  };

  // Totals calculation
  const totalUnidadesFactura = useMemo(
    () => itemsFactura.reduce((acc, item) => acc + item.cantidad, 0),
    [itemsFactura]
  );

  const subtotalBaseFactura = useMemo(
    () => itemsFactura.reduce((acc, item) => acc + Number(item.subtotal || 0), 0),
    [itemsFactura]
  );

  const totalDescuentoFactura = useMemo(
    () => itemsFactura.reduce((acc, item) => acc + Number(item.descuentoMonto || 0), 0),
    [itemsFactura]
  );

  const totalItbisFactura = useMemo(
    () =>
      itemsFactura.reduce((acc, item) => {
        const itbis =
          item.itbisMonto !== undefined
            ? Number(item.itbisMonto)
            : item.aplicaItbis
            ? Number(item.subtotal || 0) * ITBIS_RATE
            : 0;
        return acc + itbis;
      }, 0),
    [itemsFactura]
  );

  const totalMontoFactura = useMemo(
    () => subtotalBaseFactura + totalItbisFactura,
    [subtotalBaseFactura, totalItbisFactura]
  );

  const previewAddSubtotal = useMemo(() => {
    const q = Math.max(0, Number(cantidadInput || 0));
    const p = Math.max(0, Number(precioUnitarioInput || 0));
    const d = Math.min(100, Math.max(0, Number(descuentoPorcentajeInput || 0)));
    return q * p * (1 - d / 100);
  }, [cantidadInput, precioUnitarioInput, descuentoPorcentajeInput]);

  const previewAddItbis = useMemo(() => {
    const rate = (tasaItbisSeleccionada || 18) / 100;
    return aplicaItbisProducto || aplicaItbisFactura ? previewAddSubtotal * rate : 0;
  }, [previewAddSubtotal, aplicaItbisProducto, aplicaItbisFactura, tasaItbisSeleccionada]);

  const hasValidClientPhone = useMemo(() => {
    return formatPhoneForWhatsApp(clienteContacto).length >= 8;
  }, [clienteContacto]);

  const handleEmitirFactura = async (exportFormat?: "pdf" | "word" | "whatsapp") => {
    if (submitting) return;
    if (!getEnabledModules(currentUser).includes("venta")) {
      showToast("Acceso denegado: No tienes permisos autorizados para el módulo de Ventas.");
      return;
    }
    if (itemsFactura.length === 0) {
      alert("Agregue al menos un medicamento, insumo o producto al comprobante.");
      return;
    }
    if (!numeroFactura.trim()) {
      alert("Ingrese el número de factura interna.");
      return;
    }

    // Validaciones Fiscales DGII cuando no es documento interno
    let cleanNcf = "";
    if (modalidadFiscal !== "INTERNA") {
      const ncfCheck = validateNCFFormat(ncfInput);
      if (!ncfCheck.valid) {
        alert(`Error Fiscal DGII en NCF/e-CF:\n${ncfCheck.message}`);
        return;
      }
      cleanNcf = ncfCheck.clean;

      // Prevención estricta de duplicados de NCF/e-CF
      const duplicateNcf = facturasHistorial.find(
        (f) => f.ncf && f.ncf.toUpperCase() === cleanNcf && !f.anulada
      );
      if (duplicateNcf) {
        alert(
          `El comprobante fiscal ${cleanNcf} ya fue emitido previamente en la factura ${duplicateNcf.numeroFactura}. No se permiten NCF/e-CF duplicados.`
        );
        return;
      }

      // Verificar vigencia y disponibilidad de secuencia
      if (activeSequenceObj) {
        if (!activeSequenceObj.activa) {
          alert(`La secuencia para ${tipoComprobante} se encuentra inactiva en Configuración Fiscal.`);
          return;
        }
        const todayStr = new Date().toISOString().slice(0, 10);
        if (activeSequenceObj.fechaVencimiento && activeSequenceObj.fechaVencimiento < todayStr) {
          alert(
            `La secuencia fiscal para ${tipoComprobante} venció el ${activeSequenceObj.fechaVencimiento}. Actualice la autorización de secuencias DGII.`
          );
          return;
        }
        if (activeSequenceObj.secuenciaActual > activeSequenceObj.secuenciaFinal) {
          alert(
            `Se agotó el rango autorizado de secuencias para ${tipoComprobante} (Máximo autorizado: ${activeSequenceObj.secuenciaFinal}).`
          );
          return;
        }
      }

      // Validar RNC obligatorio en Crédito Fiscal, Regímenes Especiales, Gubernamental o Consumo >= RD$250,000
      const requiresRnc =
        Boolean(metaComprobanteActual?.requiereRncCliente) ||
        ((tipoComprobante === "B02" || tipoComprobante === "E32") && totalMontoFactura >= 250000);

      if (requiresRnc) {
        if (!validacionRncCliente.valid) {
          alert(
            `Regla Tributaria DGII:\nEl comprobante ${tipoComprobante}${
              totalMontoFactura >= 250000 ? " por monto mayor o igual a RD$ 250,000.00" : ""
            } exige un RNC (9 dígitos) o Cédula (11 dígitos) válido del comprador.\nDetalle: ${
              validacionRncCliente.message
            }`
          );
          return;
        }
        if (!clienteNombre.trim()) {
          alert(
            `Regla Tributaria DGII:\nDebe ingresar el Nombre o Razón Social del comprador para emitir un comprobante ${tipoComprobante}.`
          );
          return;
        }
      }

      // Validar NCF Modificado en Notas de Crédito (B04/E34) y Notas de Débito (B03/E33)
      if (metaComprobanteActual?.requiereNcfModificado) {
        if (!ncfModificado.trim()) {
          alert(
            `Regla Tributaria DGII:\nPara emitir una ${metaComprobanteActual.nombre} debe indicar obligatoriamente el NCF o e-CF Modificado que está afectando.`
          );
          return;
        }
        if (isNotaCreditoActual && !isAdmin) {
          alert("Solo un usuario con rol Administrador puede autorizar y emitir Notas de Crédito fiscales.");
          return;
        }
      }
    }

    if (exportFormat === "whatsapp" && !hasValidClientPhone) {
      alert(
        "Para enviar el comprobante por WhatsApp, ingrese primero el número de teléfono del cliente en la sección 1."
      );
      return;
    }

    setSubmitting(true);
    playSound("action");

    const now = new Date();
    const horaStr = now.toTimeString().slice(0, 5);
    const effectiveCatId =
      selectedCatalogId === "todos" ? activeCatalogId || "default-cat" : selectedCatalogId;

    const cleanRncCli = cleanRncCedula(rncCliente);
    const tipoIdCli: "1" | "2" | "3" | undefined = cleanRncCli
      ? validacionRncCliente.tipoId
      : undefined;

    let nuevaFactura: FacturaVenta = {
      id: `venta-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      numeroFactura: numeroFactura.trim() || `FAC-${Date.now().toString().slice(-4)}`,
      fecha: fechaFactura || now.toISOString().slice(0, 10),
      hora: horaStr,
      timestamp: Date.now(),
      concepto: isNotaCreditoActual
        ? "Nota de Crédito / Devolución"
        : metaComprobanteActual?.esNotaDebito
        ? "Nota de Débito"
        : conceptoSeleccionado || "Venta",
      clienteNombre: clienteNombre.trim(),
      clienteContacto: clienteContacto.trim(),
      observaciones: observaciones.trim(),
      catalogId: effectiveCatId,
      catalogNombre: activeCatalogName,
      usuarioResponsable: `${currentUser.nombre} (${currentUser.usuario})`,
      items: itemsFactura,
      totalUnidades: totalUnidadesFactura,
      subtotalMonto: subtotalBaseFactura,
      descuentoTotal: totalDescuentoFactura,
      aplicaItbis: totalItbisFactura > 0,
      itbisMonto: totalItbisFactura,
      totalMonto: totalMontoFactura,
      modalidadFiscal,
      tipoComprobante: modalidadFiscal !== "INTERNA" ? tipoComprobante : undefined,
      ncf: modalidadFiscal !== "INTERNA" ? cleanNcf : undefined,
      ncfModificado: metaComprobanteActual?.requiereNcfModificado
        ? ncfModificado.trim().toUpperCase()
        : undefined,
      fechaNcfModificado: metaComprobanteActual?.requiereNcfModificado
        ? fechaNcfModificado || fechaFactura
        : undefined,
      codigoModificacion: metaComprobanteActual?.requiereNcfModificado
        ? codigoModificacion
        : undefined,
      motivoModificacion: metaComprobanteActual?.requiereNcfModificado
        ? motivoModificacion.trim() || observaciones.trim()
        : undefined,
      rncCliente: cleanRncCli || undefined,
      tipoIdCliente: tipoIdCli,
      sucursalEmision: activeSequenceObj?.sucursalId || "001",
      puntoEmision: activeSequenceObj?.puntoEmision || "001",
      fechaVencimientoSecuencia: activeSequenceObj?.fechaVencimiento || "2027-12-31",
      tipoIngreso607: "01",
      formaPagoDGII,
      ambienteDGII: dgiiConfig.ambienteDGII,
      estadoFiscal:
        modalidadFiscal === "NCF_SERIE_B"
          ? "EMITIDO_NCF"
          : modalidadFiscal === "ECF_SERIE_E"
          ? "GENERADO_LOCAL"
          : undefined,
      reintegroInventarioAplicado: isNotaCreditoActual && reintegrarStockEnNotaCredito
    };

    try {
      // Si es Facturación Electrónica e-CF (Serie E), generar XML oficial, validar XSD y firmar digitalmente
      if (modalidadFiscal === "ECF_SERIE_E") {
        const ecfResult = await signAndProcessECF(nuevaFactura, dgiiConfig, enviarAutoDGII);
        nuevaFactura = {
          ...nuevaFactura,
          xmlGenerado: ecfResult.xmlGenerado,
          xmlFirmado: ecfResult.xmlFirmado,
          codigoSeguridadECF: ecfResult.codigoSeguridad,
          fechaHoraFirmaECF: ecfResult.fechaHoraFirma,
          urlQrDGII: ecfResult.urlQrDGII,
          trackIdDGII: ecfResult.trackId,
          estadoFiscal: ecfResult.estadoFiscal,
          respuestaDGII: ecfResult.respuestaDGII,
          erroresValidacionXSD: ecfResult.erroresValidacionXSD
        };
      }

      // Determinar impacto en inventario:
      // - Venta normal / Nota de Débito: Descuenta stock (Salida)
      // - Nota de Crédito con reintegro activo: Reintegra stock devuelto al lote (Entrada)
      const shouldIncreaseStock = isNotaCreditoActual && reintegrarStockEnNotaCredito;
      const shouldDecreaseStock = !isNotaCreditoActual && !metaComprobanteActual?.esNotaDebito;

      if (isLocalFileMode) {
        if (shouldDecreaseStock || shouldIncreaseStock) {
          const storedProds = localStorage.getItem("offline_productos");
          let listProds: Producto[] = storedProds ? JSON.parse(storedProds) : [...products];

          listProds = listProds.map((p) => {
            const itemsForProd = itemsFactura.filter((i) => i.productoCodigo === p.codigo);
            if (itemsForProd.length === 0) return p;
            const updatedLotes = (p.lotes || []).map((l) => {
              const matchItem = itemsForProd.find((i) => i.loteId === l.id);
              if (!matchItem) return l;
              const delta = shouldIncreaseStock ? matchItem.cantidad : -matchItem.cantidad;
              const nextCant = Math.max(0, Number(l.cantidad || 0) + delta);
              const nextCantF = Math.max(0, Number(l.cantidadF ?? l.cantidad ?? 0) + delta);
              return { ...l, cantidad: nextCant, cantidadF: nextCantF };
            });
            return { ...p, lotes: updatedLotes, updatedAt: Date.now() };
          });

          localStorage.setItem("offline_productos", JSON.stringify(listProds));
          if (onProductsUpdated) onProductsUpdated(listProds);
          window.dispatchEvent(new Event("offline_productos_update"));

          const storedMovs = localStorage.getItem("offline_movimientos");
          const listMovs: Movimiento[] = storedMovs ? JSON.parse(storedMovs) : [];
          itemsFactura.forEach((item) => {
            listMovs.unshift({
              id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              productoCodigo: item.productoCodigo,
              productoNombre: item.productoNombre,
              descripcion: item.descripcion,
              lote: item.numeroLote,
              cantidad: item.cantidad,
              precio: item.precioUnitario,
              tipoMovimiento: shouldIncreaseStock ? "Entrada" : "Salida",
              usuario: nuevaFactura.usuarioResponsable,
              fecha: new Date().toISOString(),
              timestamp: Date.now(),
              catalogId: nuevaFactura.catalogId,
              numeroFactura: nuevaFactura.ncf || nuevaFactura.numeroFactura,
              ncfEmitido: nuevaFactura.ncf,
              comprobanteFiscalId: nuevaFactura.id,
              proveedor: `${nuevaFactura.concepto}${
                nuevaFactura.ncf ? ` (${nuevaFactura.ncf})` : ""
              }${nuevaFactura.clienteNombre ? ` • Cliente: ${nuevaFactura.clienteNombre}` : ""}`
            });
          });
          localStorage.setItem("offline_movimientos", JSON.stringify(listMovs));
        }

        const nextFacturas = [nuevaFactura, ...facturasHistorial];
        setFacturasHistorial(nextFacturas);
        localStorage.setItem("offline_facturas_venta", JSON.stringify(nextFacturas));
      } else {
        if (shouldDecreaseStock || shouldIncreaseStock) {
          const batch = writeBatch(db);
          const prodCol = tenantCollection("productos");
          const movCol = tenantCollection("movimientos");

          const affectedProductCodes = Array.from(
            new Set(itemsFactura.map((i) => i.productoCodigo))
          );

          for (const code of affectedProductCodes) {
            const prod = products.find((p) => p.codigo === code);
            if (!prod) continue;
            const itemsForProd = itemsFactura.filter((i) => i.productoCodigo === code);
            const updatedLotes = (prod.lotes || []).map((l) => {
              const matchItem = itemsForProd.find((i) => i.loteId === l.id);
              if (!matchItem) return l;
              const delta = shouldIncreaseStock ? matchItem.cantidad : -matchItem.cantidad;
              const nextCant = Math.max(0, Number(l.cantidad || 0) + delta);
              const nextCantF = Math.max(0, Number(l.cantidadF ?? l.cantidad ?? 0) + delta);
              return { ...l, cantidad: nextCant, cantidadF: nextCantF };
            });

            const docId = prod.codigo.replace(/\//g, "_");
            batch.update(doc(prodCol, docId), {
              lotes: updatedLotes,
              updatedAt: Date.now()
            });
          }

          itemsFactura.forEach((item) => {
            const movId = `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const movDoc: Movimiento = {
              id: movId,
              productoCodigo: item.productoCodigo,
              productoNombre: item.productoNombre,
              descripcion: item.descripcion || "",
              lote: item.numeroLote,
              cantidad: item.cantidad,
              precio: item.precioUnitario,
              tipoMovimiento: shouldIncreaseStock ? "Entrada" : "Salida",
              usuario: nuevaFactura.usuarioResponsable,
              fecha: new Date().toISOString(),
              timestamp: Date.now(),
              catalogId: nuevaFactura.catalogId,
              numeroFactura: nuevaFactura.ncf || nuevaFactura.numeroFactura,
              ncfEmitido: nuevaFactura.ncf,
              comprobanteFiscalId: nuevaFactura.id,
              proveedor: `${nuevaFactura.concepto}${
                nuevaFactura.ncf ? ` (${nuevaFactura.ncf})` : ""
              }${nuevaFactura.clienteNombre ? ` • Cliente: ${nuevaFactura.clienteNombre}` : ""}`
            };
            batch.set(doc(movCol, movId), movDoc);
          });

          await batch.commit();
        }

        const nextFacturas = [nuevaFactura, ...facturasHistorial].slice(0, 300);
        await setDoc(
          tenantDoc("configuracion", "registro_ventas"),
          {
            facturas: nextFacturas,
            updatedAt: Date.now()
          },
          { merge: true }
        );
        setFacturasHistorial(nextFacturas);

        await logSystemEvent(
          `Comprobante ${nuevaFactura.ncf || nuevaFactura.numeroFactura} emitido (${
            nuevaFactura.concepto
          })${
            nuevaFactura.clienteNombre ? ` a ${nuevaFactura.clienteNombre}` : ""
          } por RD$ ${nuevaFactura.totalMonto.toFixed(2)}.`
        );
      }

      // Avanzar el correlativo de la secuencia NCF / e-CF utilizada y registrar auditoría fiscal
      if (modalidadFiscal !== "INTERNA" && activeSequenceObj) {
        const nextSecuencias = dgiiConfig.secuencias.map((s) =>
          s.tipo === tipoComprobante
            ? { ...s, secuenciaActual: s.secuenciaActual + 1, updatedAt: Date.now() }
            : s
        );
        const nextConfig: ConfiguracionFiscalDGII = {
          ...dgiiConfig,
          secuencias: nextSecuencias,
          updatedAt: Date.now()
        };
        setDgiiConfig(nextConfig);
        await saveConfiguracionDGII(nextConfig, currentUser?.farmaciaId);

        await appendAuditoriaFiscal(
          {
            tipoAccion: isNotaCreditoActual ? "NOTA_CREDITO_DEBITO" : "EMISION_COMPROBANTE",
            comprobanteNcf: nuevaFactura.ncf,
            tipoComprobante,
            documentoReferenciaId: nuevaFactura.id,
            descripcion: `Emisión de ${tipoComprobante} (${nuevaFactura.ncf}) por RD$ ${nuevaFactura.totalMonto.toFixed(
              2
            )}${nuevaFactura.rncCliente ? ` • RNC Cliente: ${nuevaFactura.rncCliente}` : ""}${
              nuevaFactura.ncfModificado ? ` • Modifica: ${nuevaFactura.ncfModificado}` : ""
            }`,
            usuario: nuevaFactura.usuarioResponsable,
            rolUsuario: currentUser.rol,
            ambienteDGII: dgiiConfig.ambienteDGII,
            resultado: "EXITO"
          },
          currentUser?.farmaciaId
        );
      }

      if (exportFormat === "pdf") {
        exportSaleInvoiceToPDF(nuevaFactura, currentInstitucion);
      } else if (exportFormat === "word") {
        exportSaleInvoiceToWord(nuevaFactura, currentInstitucion);
      } else if (exportFormat === "whatsapp") {
        shareSaleInvoiceViaWhatsApp(nuevaFactura, currentInstitucion);
      }

      const nextIndex = facturasHistorial.length + 2;
      setNumeroFactura(`FAC-${String(nextIndex).padStart(4, "0")}`);
      setClienteNombre("");
      setRncCliente("");
      setClienteContacto("");
      setObservaciones("");
      setNcfModificado("");
      setMotivoModificacion("");
      setItemsFactura([]);
      setAplicaItbisFactura(false);
      setAplicaItbisProducto(false);
      playSound("positive");
      showToast(
        exportFormat === "whatsapp"
          ? `Comprobante ${nuevaFactura.ncf || nuevaFactura.numeroFactura} generado en PDF y abierto en WhatsApp.`
          : `Comprobante ${nuevaFactura.ncf || nuevaFactura.numeroFactura} (${nuevaFactura.concepto}) emitido con éxito.`
      );
    } catch (err) {
      console.error("Error al emitir factura:", err);
      alert("Ocurrió un error al registrar el comprobante fiscal.");
    } finally {
      setSubmitting(false);
    }
  };

  // Anular Comprobante Fiscal y registrar automáticamente en Formato 608 (Exclusivo ADMIN)
  const handleConfirmAnulacion608 = async () => {
    if (!annullingFactura) return;
    if (!isAdmin) {
      alert("Solo los usuarios con perfil Administrador (ADMIN) pueden anular comprobantes fiscales.");
      return;
    }
    if (annullingFactura.anulada || annullingFactura.estadoFiscal === "ANULADO") {
      alert("Este comprobante ya fue anulado previamente.");
      return;
    }

    const motivoObj = MOTIVOS_ANULACION_608.find((m) => m.codigo === motivoAnulacion608);
    const descTexto =
      detalleAnulacion608.trim() || motivoObj?.nombre || "Anulación de comprobante fiscal";

    try {
      playSound("action");
      const nowIso = new Date().toISOString();
      const periodoAAAAMM = (annullingFactura.fecha || nowIso.slice(0, 10))
        .replace(/-/g, "")
        .slice(0, 6);

      // 1. Marcar factura como anulada e inmutable
      const updatedFacturas = facturasHistorial.map((f) =>
        f.id === annullingFactura.id
          ? {
              ...f,
              anulada: true,
              estadoFiscal: "ANULADO" as const,
              motivoAnulacion608,
              descripcionAnulacion: descTexto,
              fechaAnulacion: nowIso,
              usuarioAnulacion: `${currentUser.nombre} (${currentUser.usuario})`
            }
          : f
      );

      setFacturasHistorial(updatedFacturas);
      if (isLocalFileMode) {
        localStorage.setItem("offline_facturas_venta", JSON.stringify(updatedFacturas));
      } else {
        await setDoc(
          tenantDoc("configuracion", "registro_ventas"),
          { facturas: updatedFacturas, updatedAt: Date.now() },
          { merge: true }
        );
      }

      // 2. Si tenía NCF/e-CF, registrar en Formato 608 de Comprobantes Anulados
      if (annullingFactura.ncf) {
        const current608 = await loadAnulaciones608(currentUser?.farmaciaId);
        const nuevo608: RegistroAnulacion608 = {
          id: `anul-608-${Date.now()}`,
          periodoMes: periodoAAAAMM,
          ncfAnulado: annullingFactura.ncf,
          tipoComprobante: annullingFactura.tipoComprobante || "B02",
          fechaComprobante: annullingFactura.fecha,
          tipoAnulacion: motivoAnulacion608,
          descripcionMotivo: descTexto,
          facturaIdRelacionada: annullingFactura.id,
          numeroFacturaInterna: annullingFactura.numeroFactura,
          montoOriginal: annullingFactura.totalMonto,
          usuarioAutorizador: `${currentUser.nombre} (${currentUser.usuario})`,
          rolAutorizador: currentUser.rol,
          fechaAnulacion: nowIso,
          timestamp: Date.now()
        };
        await saveAnulaciones608List([nuevo608, ...current608], currentUser?.farmaciaId);
      }

      // 3. Reintegrar existencias al inventario si el administrador lo indicó
      if (reintegrarStockAnulacion && !annullingFactura.reintegroInventarioAplicado) {
        const storedProds = localStorage.getItem("offline_productos");
        let listProds: Producto[] = storedProds ? JSON.parse(storedProds) : [...products];
        listProds = listProds.map((p) => {
          const itemsForProd = annullingFactura.items.filter((i) => i.productoCodigo === p.codigo);
          if (itemsForProd.length === 0) return p;
          const updatedLotes = (p.lotes || []).map((l) => {
            const matchItem = itemsForProd.find((i) => i.loteId === l.id);
            if (!matchItem) return l;
            return {
              ...l,
              cantidad: Number(l.cantidad || 0) + matchItem.cantidad,
              cantidadF: Number(l.cantidadF ?? l.cantidad ?? 0) + matchItem.cantidad
            };
          });
          return { ...p, lotes: updatedLotes, updatedAt: Date.now() };
        });

        if (isLocalFileMode) {
          localStorage.setItem("offline_productos", JSON.stringify(listProds));
        } else {
          const batch = writeBatch(db);
          const prodCol = tenantCollection("productos");
          for (const item of annullingFactura.items) {
            const prod = listProds.find((p) => p.codigo === item.productoCodigo);
            if (prod) {
              batch.update(doc(prodCol, prod.codigo.replace(/\//g, "_")), {
                lotes: prod.lotes,
                updatedAt: Date.now()
              });
            }
          }
          await batch.commit();
        }
        if (onProductsUpdated) onProductsUpdated(listProds);
      }

      // 4. Registrar en Bóveda de Auditoría Fiscal
      await appendAuditoriaFiscal(
        {
          tipoAccion: "ANULACION_608",
          comprobanteNcf: annullingFactura.ncf || annullingFactura.numeroFactura,
          tipoComprobante: annullingFactura.tipoComprobante,
          documentoReferenciaId: annullingFactura.id,
          descripcion: `Comprobante ${
            annullingFactura.ncf || annullingFactura.numeroFactura
          } ANULADO (Motivo 608: ${motivoAnulacion608} - ${descTexto})`,
          usuario: `${currentUser.nombre} (${currentUser.usuario})`,
          rolUsuario: currentUser.rol,
          ambienteDGII: dgiiConfig.ambienteDGII,
          resultado: "ADVERTENCIA"
        },
        currentUser?.farmaciaId
      );

      setAnnullingFactura(null);
      setDetalleAnulacion608("");
      playSound("positive");
      showToast(
        `Comprobante ${
          annullingFactura.ncf || annullingFactura.numeroFactura
        } anulado y registrado en el Formato 608.`
      );
    } catch (err) {
      console.error("Error anulando comprobante:", err);
      alert("No se pudo completar la anulación del comprobante.");
    }
  };

  const handleSendExistingInvoiceWhatsApp = (fac: FacturaVenta) => {
    if (!formatPhoneForWhatsApp(fac.clienteContacto)) {
      alert(
        "Esta factura no tiene un número de teléfono de cliente registrado. Para enviarla por WhatsApp debe contar con el teléfono del cliente."
      );
      return;
    }
    playSound("action");
    shareSaleInvoiceViaWhatsApp(fac, currentInstitucion);
    showToast(`PDF de ${fac.ncf || fac.numeroFactura} descargado y chat de WhatsApp abierto.`);
  };

  const filteredFacturasHistorial = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return facturasHistorial;
    return facturasHistorial.filter(
      (f) =>
        f.numeroFactura.toLowerCase().includes(q) ||
        (f.ncf && f.ncf.toLowerCase().includes(q)) ||
        (f.rncCliente && f.rncCliente.toLowerCase().includes(q)) ||
        (f.clienteNombre && f.clienteNombre.toLowerCase().includes(q)) ||
        (f.clienteContacto && f.clienteContacto.toLowerCase().includes(q)) ||
        f.concepto.toLowerCase().includes(q) ||
        f.items.some(
          (i) =>
            i.productoNombre.toLowerCase().includes(q) ||
            i.productoCodigo.toLowerCase().includes(q)
        )
    );
  }, [facturasHistorial, historySearch]);

  const getFacturaSubtotal = (fac: FacturaVenta) =>
    fac.subtotalMonto !== undefined
      ? Number(fac.subtotalMonto)
      : fac.items.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);

  const getFacturaItbis = (fac: FacturaVenta) =>
    fac.itbisMonto !== undefined
      ? Number(fac.itbisMonto)
      : fac.items.reduce(
          (acc, i) =>
            acc +
            (i.itbisMonto !== undefined
              ? Number(i.itbisMonto)
              : i.aplicaItbis
              ? Number(i.subtotal || 0) * ITBIS_RATE
              : 0),
          0
        );

  const tiposComprobanteDisponibles = useMemo(() => {
    if (modalidadFiscal === "ECF_SERIE_E") {
      return CATALOGO_TIPOS_COMPROBANTE.filter((t) => t.serie === "E" && t.usoEnVentas);
    }
    if (modalidadFiscal === "NCF_SERIE_B") {
      return CATALOGO_TIPOS_COMPROBANTE.filter((t) => t.serie === "B" && t.usoEnVentas);
    }
    return [];
  }, [modalidadFiscal]);

  return (
    <div className="w-full min-w-0 max-w-full space-y-5 sm:space-y-6 anim-card-in">
      {/* Cabecera Principal del Módulo de Venta */}
      <div className="w-full min-w-0 max-w-full bg-white rounded-3xl p-4 sm:p-6 border border-slate-200/90 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-5">
        <div className="flex items-start sm:items-center gap-3.5 sm:gap-4 min-w-0">
          {currentInstitucion.logoUrl ? (
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl border border-slate-200 bg-white p-1.5 flex items-center justify-center shrink-0 shadow-xs">
              <img
                src={currentInstitucion.logoUrl}
                alt="Logo Institucional"
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ) : (
            <div className="w-13 h-13 sm:w-15 sm:h-15 rounded-2xl bg-teal-600 text-white flex items-center justify-center shrink-0 shadow-sm">
              <ShoppingBag className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg sm:text-2xl font-black text-slate-900 tracking-tight">
                Módulo de Ventas y Facturación Fiscal DGII
              </h2>
              <span className="text-xs text-slate-500 font-semibold">
                · {activeCatalogName} · Ambiente {dgiiConfig.ambienteDGII}
              </span>
            </div>
            <p className="text-xs sm:text-sm font-bold text-teal-700 mt-1">
              {currentInstitucion.nombre || "Suministros Hospitalarios • Dr. José Manuel Rodríguez"}
              {dgiiConfig.rncEmisor || currentInstitucion.rnc
                ? ` • RNC: ${dgiiConfig.rncEmisor || currentInstitucion.rnc}`
                : ""}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Emisión en Modo Dual NCF Serie B y Facturación Electrónica e-CF Serie E (Ley 32-23), Notas de Crédito, XML y Representación Impresa PDF con QR.
            </p>
          </div>
        </div>

        {/* Selector de Vista: Nueva Factura vs Facturas Emitidas */}
        <div className="w-full md:w-auto grid grid-cols-2 sm:inline-flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200 self-start md:self-auto shrink-0 gap-1">
          <button
            type="button"
            onClick={() => {
              setSubTab("nueva");
              playSound("click");
            }}
            className={`flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer whitespace-nowrap ${
              subTab === "nueva"
                ? "bg-teal-700 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Receipt className="w-4 h-4 shrink-0" />
            <span>Emitir Comprobante</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSubTab("historial");
              playSound("click");
            }}
            className={`flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer whitespace-nowrap ${
              subTab === "historial"
                ? "bg-teal-700 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span>Comprobantes Emitidos ({facturasHistorial.length})</span>
          </button>
        </div>
      </div>

      {subTab === "nueva" ? (
        <div className="w-full min-w-0 max-w-full grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
          {/* Columna Izquierda (7 cols): Formulario Fiscal DGII + Selección de Productos */}
          <div className="lg:col-span-7 min-w-0 space-y-5 sm:space-y-6">
            {/* SECCIÓN 1: Comprobante Fiscal DGII (NCF / e-CF), Cliente y Forma de Pago */}
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200/90 shadow-sm space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-xl bg-teal-600 text-white font-black text-xs flex items-center justify-center shadow-2xs">
                    1
                  </span>
                  <div>
                    <h3 className="text-sm sm:text-base font-black text-slate-900">
                      Comprobante Fiscal DGII y Datos del Comprador
                    </h3>
                    <p className="text-xs text-slate-500">
                      Seleccione la modalidad fiscal (e-CF Serie E, NCF Serie B o Interno), RNC/Cédula y forma de pago
                    </p>
                  </div>
                </div>

                {/* Selector de Modalidad Fiscal */}
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => {
                      setModalidadFiscal("ECF_SERIE_E");
                      setTipoComprobante("E32");
                      playSound("click");
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold transition cursor-pointer whitespace-nowrap ${
                      modalidadFiscal === "ECF_SERIE_E"
                        ? "bg-indigo-600 text-white shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    e-CF Serie E
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setModalidadFiscal("NCF_SERIE_B");
                      setTipoComprobante("B02");
                      playSound("click");
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold transition cursor-pointer whitespace-nowrap ${
                      modalidadFiscal === "NCF_SERIE_B"
                        ? "bg-teal-700 text-white shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    NCF Serie B
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setModalidadFiscal("INTERNA");
                      playSound("click");
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold transition cursor-pointer whitespace-nowrap ${
                      modalidadFiscal === "INTERNA"
                        ? "bg-slate-800 text-white shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Interno
                  </button>
                </div>
              </div>

              {/* Bloque de Tipo de Comprobante y Secuencia NCF / e-NCF */}
              {modalidadFiscal !== "INTERNA" && (
                <div className="bg-slate-50 rounded-2xl p-3.5 sm:p-4 border border-slate-200 space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
                    <div className="sm:col-span-7">
                      <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700 mb-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Tipo de Comprobante Fiscal DGII *</span>
                      </label>
                      <select
                        value={tipoComprobante}
                        onChange={(e) => {
                          setTipoComprobante(e.target.value as TipoComprobanteDGII);
                          playSound("click");
                        }}
                        className="w-full h-11 bg-white rounded-xl border border-slate-300 px-3 text-xs sm:text-sm font-extrabold text-slate-900 outline-none focus:border-teal-600 cursor-pointer"
                      >
                        {tiposComprobanteDisponibles.map((t) => (
                          <option key={t.codigo} value={t.codigo}>
                            {t.nombre}
                          </option>
                        ))}
                      </select>
                      {metaComprobanteActual && (
                        <p className="text-[11px] text-slate-500 mt-1">
                          {metaComprobanteActual.descripcionCorta}
                        </p>
                      )}
                    </div>

                    <div className="sm:col-span-5">
                      <label className="flex items-center justify-between text-xs font-extrabold text-slate-700 mb-1">
                        <span>{modalidadFiscal === "ECF_SERIE_E" ? "e-NCF Asignado *" : "NCF Asignado *"}</span>
                        {activeSequenceObj && (
                          <span className="text-[10px] font-mono text-slate-500">
                            Disp: {Math.max(0, activeSequenceObj.secuenciaFinal - activeSequenceObj.secuenciaActual + 1)}
                          </span>
                        )}
                      </label>
                      <input
                        type="text"
                        value={ncfInput}
                        onChange={(e) => setNcfInput(e.target.value.toUpperCase())}
                        maxLength={modalidadFiscal === "ECF_SERIE_E" ? 13 : 11}
                        className="w-full h-11 bg-white rounded-xl border border-slate-300 px-3.5 text-sm font-mono tabular-nums font-black text-indigo-950 outline-none focus:border-indigo-600"
                      />
                      {activeSequenceObj && (
                        <p className="text-[10px] text-slate-500 font-mono mt-1">
                          Vence: {activeSequenceObj.fechaVencimiento} · Sucursal {activeSequenceObj.sucursalId}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Si es Nota de Crédito (B04/E34) o Nota de Débito (B03/E33), exigir NCF Modificado */}
                  {metaComprobanteActual?.requiereNcfModificado && (
                    <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-3.5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-black text-amber-950 flex items-center gap-1.5">
                          <RotateCcw className="w-4 h-4 text-amber-700" />
                          <span>Referencia Obligatoria al Comprobante Modificado ({tipoComprobante})</span>
                        </span>
                        <select
                          onChange={(e) => handleSelectFacturaParaModificar(e.target.value)}
                          defaultValue=""
                          className="h-8 bg-white border border-amber-300 rounded-lg px-2.5 text-xs font-bold text-slate-800 cursor-pointer"
                        >
                          <option value="">-- Cargar desde comprobante emitido --</option>
                          {facturasHistorial
                            .filter((f) => !f.anulada && f.ncf)
                            .slice(0, 50)
                            .map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.ncf} • {f.clienteNombre || "Consumidor"} • RD$ {f.totalMonto.toFixed(2)}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[11px] font-extrabold text-amber-900 mb-1">
                            NCF / e-CF Modificado *
                          </label>
                          <input
                            type="text"
                            value={ncfModificado}
                            onChange={(e) => setNcfModificado(e.target.value.toUpperCase())}
                            placeholder="Ej. E310000000001"
                            className="w-full h-10 bg-white border border-amber-300 rounded-xl px-3 text-xs font-mono font-black text-slate-900"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-extrabold text-amber-900 mb-1">
                            Código de Modificación DGII *
                          </label>
                          <select
                            value={codigoModificacion}
                            onChange={(e) => setCodigoModificacion(e.target.value as any)}
                            className="w-full h-10 bg-white border border-amber-300 rounded-xl px-2.5 text-xs font-bold text-slate-900"
                          >
                            {CODIGOS_MODIFICACION_NCF.map((cm) => (
                              <option key={cm.codigo} value={cm.codigo}>
                                {cm.nombre}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-extrabold text-amber-900 mb-1">
                            Fecha NCF Modificado
                          </label>
                          <input
                            type="date"
                            value={fechaNcfModificado}
                            onChange={(e) => setFechaNcfModificado(e.target.value)}
                            className="w-full h-10 bg-white border border-amber-300 rounded-xl px-2.5 text-xs font-bold text-slate-900"
                          />
                        </div>
                      </div>

                      {isNotaCreditoActual && (
                        <label className="flex items-center gap-2 text-xs font-bold text-amber-950 cursor-pointer pt-1">
                          <input
                            type="checkbox"
                            checked={reintegrarStockEnNotaCredito}
                            onChange={(e) => setReintegrarStockEnNotaCredito(e.target.checked)}
                            className="w-4 h-4 accent-teal-700 rounded"
                          />
                          <span>
                            Reintegrar automáticamente las unidades devueltas al stock del lote correspondiente en Inventario
                          </span>
                        </label>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700 mb-1.5">
                    <Hash className="w-3.5 h-3.5 text-teal-600" />
                    <span>N.º Interno Factura *</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={numeroFactura}
                    onChange={(e) => setNumeroFactura(e.target.value.toUpperCase())}
                    placeholder="FAC-0001"
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-mono tabular-nums font-black text-teal-900 outline-none focus:bg-white focus:border-teal-600 transition"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700 mb-1.5">
                    <Tag className="w-3.5 h-3.5 text-teal-600" />
                    <span>Concepto de Operación *</span>
                  </label>
                  <select
                    value={conceptoSeleccionado}
                    onChange={(e) => setConceptoSeleccionado(e.target.value)}
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-bold text-slate-800 outline-none focus:bg-white focus:border-teal-600 cursor-pointer transition"
                  >
                    {activeConceptos.map((c) => (
                      <option key={c.id} value={c.nombre}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700 mb-1.5">
                    <Calendar className="w-3.5 h-3.5 text-teal-600" />
                    <span>Fecha de Emisión *</span>
                  </label>
                  <input
                    type="date"
                    value={fechaFactura}
                    onChange={(e) => setFechaFactura(e.target.value)}
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-bold text-slate-800 outline-none focus:bg-white focus:border-teal-600 transition"
                  />
                </div>
              </div>

              {/* RNC / Cédula, Nombre/Razón Social, Forma de Pago DGII y Teléfono */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center justify-between text-xs font-extrabold text-slate-700 mb-1.5">
                    <span>
                      RNC (9 dígitos) o Cédula (11 dígitos){" "}
                      {metaComprobanteActual?.requiereRncCliente ? "*" : "(Opcional)"}
                    </span>
                    {rncCliente.trim() && (
                      <span
                        className={`text-[10px] font-bold ${
                          validacionRncCliente.valid ? "text-emerald-700" : "text-rose-600"
                        }`}
                      >
                        {validacionRncCliente.valid ? validacionRncCliente.label : "Formato inválido"}
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={rncCliente}
                    onChange={(e) => setRncCliente(e.target.value)}
                    placeholder="Ej. 101000001 o 00100000001"
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-mono tabular-nums font-bold text-slate-900 outline-none focus:bg-white focus:border-teal-600 transition"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700 mb-1.5">
                    <User className="w-3.5 h-3.5 text-teal-600" />
                    <span>
                      Razón Social / Nombre del Comprador{" "}
                      {metaComprobanteActual?.requiereRncCliente ? "*" : "(Opcional)"}
                    </span>
                  </label>
                  <input
                    type="text"
                    value={clienteNombre}
                    onChange={(e) => setClienteNombre(e.target.value)}
                    placeholder="Ej. Clínica / Aseguradora / Paciente"
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-teal-600 transition"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700 mb-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-teal-600" />
                    <span>Forma de Pago Oficial DGII (Formato 607) *</span>
                  </label>
                  <select
                    value={formaPagoDGII}
                    onChange={(e) => setFormaPagoDGII(e.target.value as FormaPagoDGII)}
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-bold text-slate-800 outline-none focus:bg-white focus:border-teal-600 cursor-pointer"
                  >
                    {FORMAS_PAGO_DGII.map((fp) => (
                      <option key={fp.codigo} value={fp.codigo}>
                        {fp.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="flex items-center justify-between text-xs font-extrabold text-slate-700 mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Teléfono / WhatsApp Cliente (Opcional)</span>
                    </span>
                    {hasValidClientPhone && (
                      <span className="text-[10px] font-black text-emerald-700">
                        WhatsApp Listo
                      </span>
                    )}
                  </label>
                  <input
                    type="tel"
                    value={clienteContacto}
                    onChange={(e) => setClienteContacto(e.target.value)}
                    placeholder="Ej. (809) 555-0199"
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-emerald-600 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                  Observaciones o Nota en el Comprobante (Opcional)
                </label>
                <input
                  type="text"
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Ej. Orden de compra / Autorización ARS / Condición de entrega"
                  className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-teal-600 transition"
                />
              </div>
            </div>

            {/* SECCIÓN 2: Seleccionar Producto del Catálogo */}
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200/90 shadow-sm space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-xl bg-teal-600 text-white font-black text-xs flex items-center justify-center shadow-2xs">
                    2
                  </span>
                  <div>
                    <h3 className="text-sm sm:text-base font-black text-slate-900">
                      Seleccionar Producto del Catálogo ({activeCatalogName})
                    </h3>
                    <p className="text-xs text-slate-500">
                      Elija el catálogo, medicamento o insumo, lote, descuento y tasa de ITBIS aplicable
                    </p>
                  </div>
                </div>
                <span className="text-xs font-bold text-slate-500">
                  {filteredCatalogProducts.length} de {catalogProducts.length} productos disponibles
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                <div className="sm:col-span-5">
                  <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700 mb-1.5">
                    <Layers className="w-3.5 h-3.5 text-teal-600" />
                    <span>Catálogo de Productos *</span>
                  </label>
                  <select
                    value={selectedCatalogId}
                    onChange={(e) => handleCatalogChange(e.target.value)}
                    className="w-full h-11 bg-teal-50/60 rounded-xl border border-teal-300 px-3.5 text-sm font-extrabold text-teal-950 outline-none focus:bg-white focus:border-teal-600 cursor-pointer transition"
                  >
                    {activeCatalogosList.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.nombre}
                      </option>
                    ))}
                    {activeCatalogosList.length > 1 && (
                      <option value="todos">-- Ver Todos los Catálogos ({products.length}) --</option>
                    )}
                  </select>
                </div>

                <div className="sm:col-span-7">
                  <label className="flex items-center justify-between text-xs font-extrabold text-slate-700 mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <Search className="w-3.5 h-3.5 text-teal-600" />
                      <span>Filtrar Producto en la Lista</span>
                    </span>
                    {productSearch && (
                      <button
                        type="button"
                        onClick={() => setProductSearch("")}
                        className="text-[11px] font-bold text-rose-600 hover:underline cursor-pointer"
                      >
                        Limpiar filtro
                      </button>
                    )}
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={productSearch}
                      onChange={(e) => {
                        const val = e.target.value;
                        setProductSearch(val);
                        const q = val.trim().toLowerCase();
                        if (q) {
                          const matches = catalogProducts.filter(
                            (p) =>
                              p.codigo.toLowerCase().includes(q) ||
                              p.nombre.toLowerCase().includes(q) ||
                              (p.descripcion && p.descripcion.toLowerCase().includes(q))
                          );
                          if (matches.length === 1) {
                            setSelectedProductCode(matches[0].codigo);
                          }
                        }
                      }}
                      placeholder="Escriba nombre, código o presentación para filtrar..."
                      className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 pl-10 pr-9 text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-teal-600 transition"
                    />
                    {productSearch && (
                      <button
                        type="button"
                        onClick={() => setProductSearch("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center justify-between text-xs font-extrabold text-slate-700 mb-1.5">
                    <span>Medicamento / Insumo / Artículo *</span>
                    <span className="text-[11px] font-bold text-teal-700">
                      {filteredCatalogProducts.length} opciones
                    </span>
                  </label>
                  <select
                    value={selectedProductCode}
                    onChange={(e) => {
                      setSelectedProductCode(e.target.value);
                      playSound("click");
                    }}
                    className="w-full h-11 bg-white rounded-xl border-2 border-slate-300 hover:border-teal-500 px-3.5 text-sm font-bold text-slate-900 outline-none focus:border-teal-600 cursor-pointer transition"
                  >
                    <option value="">
                      {filteredCatalogProducts.length === 0
                        ? "-- No se encontraron productos en este catálogo --"
                        : `-- Seleccione un producto (${filteredCatalogProducts.length} disponibles) --`}
                    </option>
                    {filteredCatalogProducts.map((p) => {
                      const totalStock = (p.lotes || []).reduce(
                        (acc, l) => acc + getLotStock(l),
                        0
                      );
                      return (
                        <option key={p.codigo} value={p.codigo}>
                          {p.nombre} [{p.codigo}] — Stock: {totalStock} u.
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="flex items-center justify-between text-xs font-extrabold text-slate-700 mb-1.5">
                    <span>Lote y Vencimiento *</span>
                    {selectedLot && (
                      <span className="text-[11px] font-extrabold text-emerald-700">
                        Disp:{" "}
                        {Math.max(
                          0,
                          getLotStock(selectedLot) -
                            getCommittedQtyForLot(selectedProduct?.codigo || "", selectedLot.id)
                        )}{" "}
                        u.
                      </span>
                    )}
                  </label>
                  <select
                    value={selectedLoteId}
                    onChange={(e) => handleSelectLotChange(e.target.value)}
                    disabled={!selectedProduct || productLots.length === 0}
                    className="w-full h-11 bg-white disabled:bg-slate-100 rounded-xl border-2 border-slate-300 hover:border-teal-500 px-3.5 text-sm font-bold text-slate-900 disabled:text-slate-400 outline-none focus:border-teal-600 cursor-pointer transition"
                  >
                    {!selectedProduct ? (
                      <option value="">-- Primero seleccione un producto --</option>
                    ) : productLots.length === 0 ? (
                      <option value="">-- Producto sin lotes registrados --</option>
                    ) : (
                      productLots.map((l) => {
                        const committed = getCommittedQtyForLot(selectedProduct.codigo, l.id);
                        const disp = Math.max(0, getLotStock(l) - committed);
                        return (
                          <option key={l.id} value={l.id}>
                            Lote: {l.numeroLote} • Disp: {disp} u. • Vence: {l.fechaVencimiento || "N/A"} • RD${" "}
                            {Number(l.precio || 0).toFixed(2)}
                          </option>
                        );
                      })
                    )}
                  </select>
                </div>
              </div>

              {selectedProduct && (
                <div className="bg-teal-50/70 border border-teal-200 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-teal-700 text-white font-mono font-black text-xs">
                        {selectedProduct.codigo}
                      </span>
                      <span className="font-black text-sm text-slate-900">
                        {selectedProduct.nombre}
                      </span>
                    </div>
                    {selectedProduct.descripcion && (
                      <p className="text-xs text-slate-600 mt-0.5">
                        {selectedProduct.descripcion}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] font-bold text-slate-500 block">
                      Subtotal Línea{" "}
                      {aplicaItbisProducto || aplicaItbisFactura
                        ? `(+${tasaItbisSeleccionada}% ITBIS)`
                        : "(Exento 0%)"}
                    </span>
                    <span className="text-base font-black font-mono tabular-nums text-teal-900">
                      RD$ {(previewAddSubtotal + previewAddItbis).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {/* Cantidad, Precio Unitario, Descuento % y Tasa ITBIS */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-end">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                    Cant. *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={cantidadInput}
                    onChange={(e) => setCantidadInput(e.target.value)}
                    placeholder="1"
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3 text-sm font-mono tabular-nums font-black text-slate-900 outline-none focus:bg-white focus:border-teal-600"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                    Precio Unit. (RD$) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={precioUnitarioInput}
                    onChange={(e) => setPrecioUnitarioInput(e.target.value)}
                    placeholder="0.00"
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3 text-sm font-mono tabular-nums font-black text-slate-900 outline-none focus:bg-white focus:border-teal-600"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                    Desc. %
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={descuentoPorcentajeInput}
                    onChange={(e) => setDescuentoPorcentajeInput(e.target.value)}
                    placeholder="0"
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3 text-sm font-mono tabular-nums font-bold text-slate-800 outline-none focus:bg-white focus:border-teal-600"
                  />
                </div>

                <div className="sm:col-span-5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-extrabold text-slate-700">Impuesto ITBIS DGII</span>
                    <select
                      value={tasaItbisSeleccionada}
                      onChange={(e) => setTasaItbisSeleccionada(Number(e.target.value) as 18 | 16)}
                      className="text-[11px] font-bold text-teal-800 bg-teal-50 border border-teal-200 rounded-md px-1.5 py-0.5 cursor-pointer"
                    >
                      <option value={18}>Tasa 18% (General)</option>
                      <option value={16}>Tasa 16% (Reducida)</option>
                    </select>
                  </div>
                  <label
                    className={`flex items-center justify-between gap-2 h-11 px-3 rounded-xl border-2 cursor-pointer transition select-none ${
                      aplicaItbisProducto || aplicaItbisFactura
                        ? "bg-amber-50 border-amber-400 text-amber-950"
                        : "bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={aplicaItbisProducto || aplicaItbisFactura}
                        onChange={(e) => {
                          setAplicaItbisProducto(e.target.checked);
                          playSound("click");
                        }}
                        className="w-4 h-4 accent-teal-700 rounded cursor-pointer"
                      />
                      <span className="text-xs font-extrabold flex items-center gap-1">
                        <Percent className="w-3.5 h-3.5 text-amber-600" />
                        <span>Gravado ({tasaItbisSeleccionada}%)</span>
                      </span>
                    </div>
                    <span className="text-xs font-black font-mono tabular-nums text-amber-800">
                      +RD$ {previewAddItbis.toFixed(2)}
                    </span>
                  </label>
                </div>
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleAddItemToInvoice}
                  disabled={!selectedProduct || !selectedLot}
                  className="w-full h-12 px-5 bg-teal-700 hover:bg-teal-800 disabled:bg-slate-200 disabled:text-slate-400 text-white font-black text-xs sm:text-sm uppercase tracking-wider rounded-2xl transition active:scale-98 shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Plus className="w-5 h-5" />
                  <span>Agregar Producto al Detalle del Comprobante</span>
                </button>
              </div>
            </div>
          </div>

          {/* Columna Derecha (5 cols): Vista Previa Fiscal, Totales y Emisión */}
          <div className="lg:col-span-5 min-w-0 bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden flex flex-col">
            {/* Membrete Institucional y Fiscal */}
            <div className="p-4 sm:p-5 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-3 sm:gap-4">
              <div className="flex items-start gap-3.5 min-w-0">
                {currentInstitucion.logoUrl ? (
                  <div className="w-16 h-16 rounded-2xl border border-slate-200 bg-white p-1.5 flex items-center justify-center shrink-0 shadow-2xs">
                    <img
                      src={currentInstitucion.logoUrl}
                      alt="Logotipo Institucional"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-white border border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 shrink-0 text-[9px] font-bold text-center p-1">
                    <Building2 className="w-5 h-5 text-teal-600 mb-0.5" />
                    <span>Logo Sede</span>
                  </div>
                )}
                <div className="min-w-0">
                  <h4 className="text-sm font-black text-teal-950 leading-snug">
                    {dgiiConfig.razonSocial || currentInstitucion.nombre || "Suministros Hospitalarios"}
                  </h4>
                  <p className="text-xs font-mono tabular-nums font-bold text-slate-600">
                    RNC: {dgiiConfig.rncEmisor || currentInstitucion.rnc || "Sin configurar"}
                  </p>
                  {currentInstitucion.telefono && (
                    <p className="text-xs text-slate-500">Tel: {currentInstitucion.telefono}</p>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0">
                {modalidadFiscal !== "INTERNA" ? (
                  <span className="inline-block px-3 py-1 rounded-xl bg-indigo-900 text-white font-mono tabular-nums font-black text-xs shadow-2xs">
                    {ncfInput || tipoComprobante}
                  </span>
                ) : (
                  <span className="inline-block px-3 py-1 rounded-xl bg-teal-800 text-white font-mono tabular-nums font-black text-xs shadow-2xs">
                    {numeroFactura || "FAC-0001"}
                  </span>
                )}
                <p className="text-[11px] font-black uppercase text-teal-700 mt-1">
                  {modalidadFiscal !== "INTERNA" ? tipoComprobante : conceptoSeleccionado}
                </p>
                <p className="text-[11px] text-slate-500 font-mono tabular-nums">{fechaFactura}</p>
              </div>
            </div>

            {/* Datos del Comprador en la Vista Previa */}
            <div className="px-5 py-3.5 bg-white border-b border-slate-200 grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200/70">
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Comprador / RNC
                </span>
                <span className="font-extrabold text-slate-800 block truncate mt-0.5">
                  {clienteNombre.trim() || "CONSUMIDOR FINAL"}
                </span>
                {rncCliente.trim() && (
                  <span className="font-mono tabular-nums text-[11px] text-indigo-700 font-bold block">
                    RNC/Céd: {cleanRncCedula(rncCliente)}
                  </span>
                )}
              </div>
              <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200/70">
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Forma de Pago / Contacto
                </span>
                <span className="font-extrabold text-slate-800 block truncate mt-0.5">
                  {FORMAS_PAGO_DGII.find((f) => f.codigo === formaPagoDGII)?.nombre || "01 - Efectivo"}
                </span>
                <span className="text-[11px] text-slate-500 block truncate">
                  {clienteContacto.trim() || "Sin teléfono"}
                </span>
              </div>
            </div>

            {/* Casilla Global para aplicar ITBIS a toda la factura */}
            <div className="px-5 pt-4 space-y-2">
              <label
                className={`flex items-center justify-between gap-3 p-3 rounded-2xl border-2 cursor-pointer transition select-none ${
                  aplicaItbisFactura
                    ? "bg-amber-50/90 border-amber-400 text-amber-950"
                    : "bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={aplicaItbisFactura}
                    onChange={(e) => handleToggleItbisFactura(e.target.checked)}
                    className="w-4.5 h-4.5 accent-teal-700 rounded cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-black block">
                      Aplicar ITBIS ({tasaItbisSeleccionada}%) a todo el comprobante
                    </span>
                    <span className="text-[11px] text-slate-500 block">
                      Puede marcar o exonerar cada línea individualmente en la tabla
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 font-mono font-black text-xs shrink-0">
                  {tasaItbisSeleccionada}% ITBIS
                </span>
              </label>

              {modalidadFiscal === "ECF_SERIE_E" && (
                <label className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-indigo-50/70 border border-indigo-200 text-xs cursor-pointer">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enviarAutoDGII}
                      onChange={(e) => setEnviarAutoDGII(e.target.checked)}
                      className="w-4 h-4 accent-indigo-600 rounded"
                    />
                    <span className="font-bold text-indigo-950">
                      Transmitir automáticamente al Web Service DGII ({dgiiConfig.ambienteDGII})
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-indigo-700">XMLDSig</span>
                </label>
              )}
            </div>

            {/* Tabla Detalle de Productos Agregados */}
            <div className="p-5 flex-1 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-slate-700 tracking-wider">
                  3. Detalle de Ítems ({itemsFactura.length})
                </span>
                {itemsFactura.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setItemsFactura([])}
                    className="text-xs font-extrabold text-rose-600 hover:underline cursor-pointer"
                  >
                    Vaciar detalle
                  </button>
                )}
              </div>

              {itemsFactura.length === 0 ? (
                <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center space-y-2 bg-slate-50/50">
                  <ShoppingBag className="w-9 h-9 text-slate-300 mx-auto" />
                  <p className="text-sm font-extrabold text-slate-600">
                    El comprobante aún no tiene ítems
                  </p>
                  <p className="text-xs text-slate-400 max-w-xs mx-auto">
                    Elija un producto en la sección 2 y presione «Agregar Producto al Detalle del Comprobante».
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-black text-slate-600 uppercase">
                        <th className="px-3 py-2.5 sticky left-0 bg-slate-100 z-10">Producto / Lote</th>
                        <th className="px-2 py-2.5 text-center">Cant.</th>
                        <th className="px-2 py-2.5 text-center">ITBIS</th>
                        <th className="px-2.5 py-2.5 text-right">Total</th>
                        <th className="px-2 py-2.5 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {itemsFactura.map((item) => {
                        const itemItbis =
                          item.itbisMonto !== undefined
                            ? Number(item.itbisMonto)
                            : item.aplicaItbis
                            ? Number(item.subtotal || 0) * ITBIS_RATE
                            : 0;
                        return (
                          <tr key={item.id} className="hover:bg-slate-50/70">
                            <td className="px-3 py-2.5 sticky left-0 bg-white">
                              <p className="font-extrabold text-slate-900 leading-snug">
                                {item.productoNombre}
                              </p>
                              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                                {item.productoCodigo} • Lote: {item.numeroLote} • RD${" "}
                                {item.precioUnitario.toFixed(2)}
                              </p>
                            </td>
                            <td className="px-2 py-2.5 text-center">
                              <input
                                type="number"
                                min="1"
                                value={item.cantidad}
                                onChange={(e) =>
                                  handleUpdateItemQty(item.id, parseInt(e.target.value, 10) || 1)
                                }
                                className="w-14 text-center bg-slate-50 border border-slate-300 rounded-lg py-1 text-xs font-mono tabular-nums font-black text-slate-900"
                              />
                            </td>
                            <td className="px-2 py-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => handleToggleItemItbis(item.id)}
                                className={`px-2 py-1 rounded-lg text-[10px] font-mono tabular-nums font-black border transition cursor-pointer ${
                                  item.aplicaItbis
                                    ? "bg-amber-100 text-amber-900 border-amber-300"
                                    : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200"
                                }`}
                              >
                                {item.aplicaItbis ? `+RD$ ${itemItbis.toFixed(2)}` : "Exento"}
                              </button>
                            </td>
                            <td className="px-2.5 py-2.5 text-right font-mono tabular-nums font-black text-teal-900 whitespace-nowrap">
                              RD$ {(item.subtotal + itemItbis).toFixed(2)}
                            </td>
                            <td className="px-2 py-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveItem(item.id)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 transition cursor-pointer"
                                title="Quitar ítem"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Desglose de Totales */}
              <div className="bg-teal-950 text-white rounded-2xl p-4 space-y-2 shadow-sm">
                <div className="flex items-center justify-between text-xs text-teal-200 border-b border-teal-800/80 pb-1.5">
                  <span>Subtotal Neto ({totalUnidadesFactura} unid.):</span>
                  <span className="font-mono tabular-nums font-bold text-white">
                    RD$ {subtotalBaseFactura.toFixed(2)}
                  </span>
                </div>
                {totalDescuentoFactura > 0 && (
                  <div className="flex items-center justify-between text-xs text-emerald-300 border-b border-teal-800/80 pb-1.5">
                    <span>Descuento Aplicado:</span>
                    <span className="font-mono tabular-nums font-bold">
                      - RD$ {totalDescuentoFactura.toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs text-amber-300 border-b border-teal-800/80 pb-1.5">
                  <span>Total ITBIS Facturado:</span>
                  <span className="font-mono tabular-nums font-bold">
                    + RD$ {totalItbisFactura.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-0.5">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-teal-300 block">
                      Total Comprobante ({modalidadFiscal !== "INTERNA" ? tipoComprobante : conceptoSeleccionado})
                    </span>
                    <span className="text-xs font-semibold text-teal-100">
                      {modalidadFiscal === "ECF_SERIE_E"
                        ? `Genera XML e-CF + RI PDF QR (${ncfInput})`
                        : modalidadFiscal === "NCF_SERIE_B"
                        ? `Comprobante NCF ${ncfInput}`
                        : "Documento de Control Interno"}
                    </span>
                  </div>
                  <span className="text-xl font-black font-mono tabular-nums text-emerald-300">
                    RD$ {totalMontoFactura.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Botones de Acción */}
              <div className="space-y-2.5 pt-1">
                <button
                  type="button"
                  disabled={submitting || itemsFactura.length === 0}
                  onClick={() => handleEmitirFactura("pdf")}
                  className="w-full h-12 px-4 bg-teal-700 hover:bg-teal-800 disabled:bg-slate-200 disabled:text-slate-400 text-white font-black text-xs sm:text-sm uppercase tracking-wider rounded-2xl transition active:scale-98 shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <FileDown className="w-4.5 h-4.5" />
                  <span>
                    {submitting
                      ? "Procesando Comprobante..."
                      : modalidadFiscal === "ECF_SERIE_E"
                      ? "Emitir e-CF + Descargar Representación Impresa PDF"
                      : "Emitir Comprobante y Descargar PDF"}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={submitting || itemsFactura.length === 0 || !hasValidClientPhone}
                  onClick={() => handleEmitirFactura("whatsapp")}
                  className={`w-full h-12 px-4 font-black text-xs sm:text-sm uppercase tracking-wider rounded-2xl transition active:scale-98 shadow-sm flex items-center justify-center gap-2 cursor-pointer ${
                    hasValidClientPhone && itemsFactura.length > 0
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : "bg-emerald-50 text-emerald-800/60 border border-emerald-200 disabled:cursor-not-allowed"
                  }`}
                >
                  <Send className="w-4 h-4" />
                  <span>Emitir PDF y Enviar por WhatsApp al Cliente</span>
                </button>

                {!hasValidClientPhone && (
                  <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5 text-center">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>
                      Ingrese el teléfono del cliente en la sección 1 para activar el envío por WhatsApp.
                    </span>
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    disabled={submitting || itemsFactura.length === 0}
                    onClick={() => handleEmitirFactura("word")}
                    className="h-10 px-3 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 text-blue-800 border border-blue-200 font-extrabold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <FileText className="w-4 h-4" />
                    <span>Emitir + Word</span>
                  </button>

                  <button
                    type="button"
                    disabled={submitting || itemsFactura.length === 0}
                    onClick={() => handleEmitirFactura()}
                    className="h-10 px-3 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 border border-slate-200 font-extrabold text-xs uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Solo Registrar</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Pestaña 2: Historial de Comprobantes y Facturas Emitidas */
        <div className="w-full min-w-0 max-w-full bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Comprobantes y Facturas Emitidas ({filteredFacturasHistorial.length})
              </h3>
              <p className="text-xs text-slate-500">
                Documentos inmutables con NCF / e-CF, descarga de XML firmado, Representación Impresa PDF con QR y anulación 608 (ADMIN).
              </p>
            </div>
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Buscar por NCF, e-CF, RNC, cliente, factura..."
                className="w-full h-10 bg-slate-50 rounded-xl border border-slate-300 pl-10 pr-4 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-teal-600"
              />
            </div>
          </div>

          {filteredFacturasHistorial.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <FileText className="w-10 h-10 mx-auto text-slate-300" />
              <p className="text-sm font-bold text-slate-600">No hay comprobantes registrados</p>
              <p className="text-xs text-slate-400">
                Los comprobantes que emitas en la pestaña «Emitir Comprobante» aparecerán aquí.
              </p>
            </div>
          ) : (
            <div className="w-full max-w-full overflow-x-auto overscroll-x-contain touch-pan-x [-webkit-overflow-scrolling:touch] border border-slate-200 rounded-2xl">
              <table className="min-w-[960px] w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-extrabold text-slate-600 uppercase tracking-wider">
                    <th className="px-4 py-3 sticky left-0 bg-slate-100 z-10">NCF / Factura</th>
                    <th className="px-3 py-3">Fecha</th>
                    <th className="px-3 py-3">Tipo / Estado DGII</th>
                    <th className="px-3 py-3">Cliente / RNC</th>
                    <th className="px-3 py-3 text-right">Subtotal</th>
                    <th className="px-3 py-3 text-right">ITBIS</th>
                    <th className="px-3 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredFacturasHistorial.map((fac) => {
                    const sub = getFacturaSubtotal(fac);
                    const itbis = getFacturaItbis(fac);
                    const hasPhone = formatPhoneForWhatsApp(fac.clienteContacto).length >= 8;
                    const isAnulada = Boolean(fac.anulada || fac.estadoFiscal === "ANULADO");

                    return (
                      <tr
                        key={fac.id}
                        className={`hover:bg-slate-50/70 transition ${
                          isAnulada ? "opacity-60 bg-rose-50/30" : ""
                        }`}
                      >
                        <td className="px-4 py-3 sticky left-0 bg-white font-mono tabular-nums">
                          <span className="font-black text-indigo-900 block">
                            {fac.ncf || fac.numeroFactura}
                          </span>
                          {fac.ncf && (
                            <span className="text-[10px] text-slate-500">
                              Ref: {fac.numeroFactura}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 font-mono tabular-nums text-slate-600">
                          {fac.fecha}{" "}
                          <span className="text-[10px] text-slate-400">{fac.hora}</span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="text-xs font-bold text-slate-800">
                            {fac.tipoComprobante ? `${fac.tipoComprobante} · ${fac.concepto}` : fac.concepto}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {isAnulada
                              ? `ANULADO (608: Motivo ${fac.motivoAnulacion608 || "04"})`
                              : fac.estadoFiscal || "EMITIDO"}
                            {fac.codigoSeguridadECF ? ` · Cód.Seg: ${fac.codigoSeguridadECF}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-bold text-slate-800">
                            {fac.clienteNombre || "CONSUMIDOR FINAL"}
                          </p>
                          {fac.rncCliente && (
                            <p className="text-[11px] font-mono tabular-nums text-indigo-700 font-semibold">
                              RNC/Céd: {fac.rncCliente}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums font-semibold text-slate-700">
                          RD$ {sub.toFixed(2)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums font-semibold text-amber-800">
                          {itbis > 0 ? `RD$ ${itbis.toFixed(2)}` : "Exento"}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums font-black text-teal-900">
                          RD$ {Number(fac.totalMonto || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setPreviewFactura(fac)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] transition cursor-pointer"
                              title="Ver Comprobante"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Ver</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => exportSaleInvoiceToPDF(fac, currentInstitucion)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-[11px] transition cursor-pointer"
                              title="Descargar Representación Impresa PDF"
                            >
                              <FileDown className="w-3.5 h-3.5" />
                              <span>RI PDF</span>
                            </button>
                            {(fac.xmlFirmado || fac.xmlGenerado) && (
                              <button
                                type="button"
                                onClick={() =>
                                  downloadTextFile(
                                    fac.xmlFirmado || fac.xmlGenerado || "",
                                    `${fac.ncf || fac.numeroFactura}.xml`,
                                    "application/xml;charset=utf-8"
                                  )
                                }
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 font-bold text-[11px] transition cursor-pointer"
                                title="Descargar XML e-CF Oficial"
                              >
                                <FileCode2 className="w-3.5 h-3.5" />
                                <span>XML</span>
                              </button>
                            )}
                            {hasPhone && (
                              <button
                                type="button"
                                onClick={() => handleSendExistingInvoiceWhatsApp(fac)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-[11px] transition cursor-pointer"
                                title="Enviar por WhatsApp"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>WA</span>
                              </button>
                            )}
                            {isAdmin && !isAnulada && (
                              <button
                                type="button"
                                onClick={() => {
                                  setAnnullingFactura(fac);
                                  setMotivoAnulacion608("04");
                                  setDetalleAnulacion608("");
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 font-bold text-[11px] transition cursor-pointer"
                                title="Anular Comprobante (Formato 608 DGII)"
                              >
                                <Ban className="w-3.5 h-3.5" />
                                <span>608</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal de Anulación Fiscal Formato 608 (Exclusivo Administradores) */}
      {annullingFactura && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs"
            onClick={() => setAnnullingFactura(null)}
          />
          <div className="relative bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4 anim-card-in">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
                  <Ban className="w-5 h-5 text-rose-600" />
                  <span>Anular Comprobante Fiscal (Formato 608 DGII)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Comprobante:{" "}
                  <strong className="font-mono text-slate-800">
                    {annullingFactura.ncf || annullingFactura.numeroFactura}
                  </strong>{" "}
                  • Monto: RD$ {annullingFactura.totalMonto.toFixed(2)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAnnullingFactura(null)}
                className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Motivo de Anulación Oficial DGII (Norma 07-2018) *
                </label>
                <select
                  value={motivoAnulacion608}
                  onChange={(e) => setMotivoAnulacion608(e.target.value as any)}
                  className="w-full h-11 bg-slate-50 border border-slate-300 rounded-xl px-3 font-bold text-slate-900"
                >
                  {MOTIVOS_ANULACION_608.map((m) => (
                    <option key={m.codigo} value={m.codigo}>
                      {m.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-extrabold text-slate-700 mb-1">
                  Justificación para Auditoría Fiscal
                </label>
                <input
                  type="text"
                  value={detalleAnulacion608}
                  onChange={(e) => setDetalleAnulacion608(e.target.value)}
                  placeholder="Detalle adicional del motivo de anulación..."
                  className="w-full h-11 bg-slate-50 border border-slate-300 rounded-xl px-3 font-semibold text-slate-800"
                />
              </div>

              <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 font-bold text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={reintegrarStockAnulacion}
                  onChange={(e) => setReintegrarStockAnulacion(e.target.checked)}
                  className="w-4 h-4 accent-teal-700 rounded"
                />
                <span>Reintegrar existencias de los lotes de esta factura al inventario</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAnnullingFactura(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmAnulacion608}
                className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs cursor-pointer"
              >
                Confirmar Anulación (608)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Vista Previa del Comprobante Fiscal */}
      {previewFactura && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs"
            onClick={() => setPreviewFactura(null)}
          />
          <div className="relative bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[92dvh] anim-card-in">
            <div className="p-4 sm:p-6 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-3 sm:gap-4">
              <div className="flex items-center gap-4">
                {currentInstitucion.logoUrl ? (
                  <div className="w-16 h-16 rounded-2xl border border-slate-200 bg-white p-1.5 flex items-center justify-center shrink-0">
                    <img
                      src={currentInstitucion.logoUrl}
                      alt="Logo"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-2xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
                    <Building2 className="w-7 h-7" />
                  </div>
                )}
                <div>
                  <h3 className="text-base font-black text-teal-900">
                    {currentInstitucion.nombre}
                  </h3>
                  <p className="text-xs font-mono tabular-nums font-bold text-slate-600">
                    {previewFactura.ncf
                      ? `Comprobante Fiscal: ${previewFactura.ncf}`
                      : `Factura Interna: ${previewFactura.numeroFactura}`}
                  </p>
                  {previewFactura.codigoSeguridadECF && (
                    <p className="text-[11px] font-mono tabular-nums text-indigo-700 font-bold">
                      Código Seguridad e-CF: {previewFactura.codigoSeguridadECF} · Estado:{" "}
                      {previewFactura.estadoFiscal}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewFactura(null)}
                className="p-1.5 rounded-xl bg-slate-200/70 hover:bg-slate-300 text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block">
                    NCF / N.º
                  </span>
                  <span className="font-mono tabular-nums font-black text-teal-800">
                    {previewFactura.ncf || previewFactura.numeroFactura}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block">
                    Concepto / Tipo
                  </span>
                  <span className="font-bold text-slate-800">
                    {previewFactura.tipoComprobante || previewFactura.concepto}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block">
                    Comprador
                  </span>
                  <span className="font-bold text-slate-800">
                    {previewFactura.clienteNombre || "CONSUMIDOR FINAL"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block">
                    RNC / Contacto
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-slate-700">
                    {previewFactura.rncCliente || previewFactura.clienteContacto || "—"}
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-teal-800 text-white text-[10px] font-black uppercase">
                      <th className="px-3 py-2.5">Código</th>
                      <th className="px-3 py-2.5">Producto / Insumo</th>
                      <th className="px-3 py-2.5 text-center">Lote</th>
                      <th className="px-3 py-2.5 text-right">Cant.</th>
                      <th className="px-3 py-2.5 text-right">Precio Unit.</th>
                      <th className="px-3 py-2.5 text-right">ITBIS</th>
                      <th className="px-3 py-2.5 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {previewFactura.items.map((item) => {
                      const itemItbis =
                        item.itbisMonto !== undefined
                          ? Number(item.itbisMonto)
                          : item.aplicaItbis
                          ? Number(item.subtotal || 0) * ITBIS_RATE
                          : 0;
                      return (
                        <tr key={item.id}>
                          <td className="px-3 py-2.5 font-mono tabular-nums font-bold text-teal-700">
                            {item.productoCodigo}
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="font-bold text-slate-800">{item.productoNombre}</p>
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono tabular-nums">
                            {item.numeroLote}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold">
                            {item.cantidad}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                            RD$ {Number(item.precioUnitario || 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-amber-800 font-semibold">
                            {item.aplicaItbis || itemItbis > 0
                              ? `RD$ ${itemItbis.toFixed(2)}`
                              : "Exento"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums font-black text-teal-800">
                            RD$ {Number(item.subtotal || 0).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-100 p-4 rounded-2xl space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600 font-bold">
                  <span>Subtotal Base ({previewFactura.totalUnidades} unid.):</span>
                  <span className="font-mono tabular-nums">
                    RD$ {getFacturaSubtotal(previewFactura).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-amber-800 font-bold">
                  <span>ITBIS Facturado:</span>
                  <span className="font-mono tabular-nums">
                    RD$ {getFacturaItbis(previewFactura).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-black text-teal-900 border-t border-slate-200 pt-2">
                  <span>Total Comprobante:</span>
                  <span className="font-mono tabular-nums">
                    RD$ {Number(previewFactura.totalMonto || 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2.5">
              {(previewFactura.xmlFirmado || previewFactura.xmlGenerado) && (
                <button
                  type="button"
                  onClick={() =>
                    downloadTextFile(
                      previewFactura.xmlFirmado || previewFactura.xmlGenerado || "",
                      `${previewFactura.ncf || previewFactura.numeroFactura}.xml`,
                      "application/xml;charset=utf-8"
                    )
                  }
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <FileCode2 className="w-4 h-4" />
                  <span>Descargar XML e-CF</span>
                </button>
              )}
              {formatPhoneForWhatsApp(previewFactura.clienteContacto).length >= 8 && (
                <button
                  type="button"
                  onClick={() => handleSendExistingInvoiceWhatsApp(previewFactura)}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>Enviar PDF por WhatsApp</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => exportSaleInvoiceToPDF(previewFactura, currentInstitucion)}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <FileDown className="w-4 h-4" />
                <span>Descargar RI PDF</span>
              </button>
              <button
                type="button"
                onClick={() => exportSaleInvoiceToWord(previewFactura, currentInstitucion)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <FileText className="w-4 h-4" />
                <span>Descargar Word</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
