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
  Package,
  CheckCircle2,
  Building2,
  Eye,
  X,
  Layers,
  Receipt,
  Percent,
  Send,
  Hash,
  AlertCircle
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

  // ITBIS 18% State (Product level & Invoice level)
  const [aplicaItbisFactura, setAplicaItbisFactura] = useState<boolean>(false);
  const [aplicaItbisProducto, setAplicaItbisProducto] = useState<boolean>(false);

  // Product Selection State
  const [productSearch, setProductSearch] = useState<string>("");
  const [selectedProductCode, setSelectedProductCode] = useState<string>("");
  const [selectedLoteId, setSelectedLoteId] = useState<string>("");
  const [cantidadInput, setCantidadInput] = useState<string>("1");
  const [precioUnitarioInput, setPrecioUnitarioInput] = useState<string>("");

  // Invoice Items State
  const [itemsFactura, setItemsFactura] = useState<VentaItem[]>([]);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // History Search & Modal Preview State
  const [historySearch, setHistorySearch] = useState<string>("");
  const [previewFactura, setPreviewFactura] = useState<FacturaVenta | null>(null);

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

  // Helper to get available stock in a lot (system or physical, matching OrderPanel)
  const getLotStock = (l: any): number => {
    const sys = Number(l?.cantidad || 0);
    const phys = Number(l?.cantidadF || 0);
    return Math.max(sys, phys);
  };

  // Filter products belonging to the selected catalog reliably
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

  // Products filtered by the search bar
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

  // Currently selected product (searched across all products so selection is never lost)
  const selectedProduct = useMemo(() => {
    if (!selectedProductCode) return null;
    return (
      catalogProducts.find((p) => p.codigo === selectedProductCode) ||
      products.find((p) => p.codigo === selectedProductCode) ||
      null
    );
  }, [catalogProducts, products, selectedProductCode]);

  // Lots for the selected product (prioritizing lots with stock > 0, but keeping all lots visible)
  const productLots = useMemo(() => {
    if (!selectedProduct) return [];
    const lots = selectedProduct.lotes || [];
    return [...lots].sort((a, b) => getLotStock(b) - getLotStock(a));
  }, [selectedProduct]);

  const selectedLot = useMemo(() => {
    return productLots.find((l) => l.id === selectedLoteId) || null;
  }, [productLots, selectedLoteId]);

  // Auto-select first available lot when product changes
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

  // Update price when lot changes
  const handleSelectLotChange = (lotId: string) => {
    setSelectedLoteId(lotId);
    const found = productLots.find((l) => l.id === lotId);
    if (found) {
      setPrecioUnitarioInput(String(Number(found.precio || 0)));
    }
  };

  // Toggle global ITBIS 18% for the entire invoice
  const handleToggleItbisFactura = (checked: boolean) => {
    setAplicaItbisFactura(checked);
    setAplicaItbisProducto(checked);
    setItemsFactura((prev) =>
      prev.map((item) => {
        const sub = item.cantidad * item.precioUnitario;
        const itbis = checked ? sub * ITBIS_RATE : 0;
        return {
          ...item,
          aplicaItbis: checked,
          itbisMonto: itbis,
          totalItem: sub + itbis
        };
      })
    );
    playSound("click");
  };

  // Toggle ITBIS 18% for a specific item already in the invoice table
  const handleToggleItemItbis = (itemId: string) => {
    setItemsFactura((prev) => {
      const updated = prev.map((item) => {
        if (item.id !== itemId) return item;
        const nextItbisFlag = !item.aplicaItbis;
        const sub = item.cantidad * item.precioUnitario;
        const itbis = nextItbisFlag ? sub * ITBIS_RATE : 0;
        return {
          ...item,
          aplicaItbis: nextItbisFlag,
          itbisMonto: itbis,
          totalItem: sub + itbis
        };
      });
      setAplicaItbisFactura(updated.length > 0 && updated.every((i) => !!i.aplicaItbis));
      return updated;
    });
    playSound("click");
  };

  // Calculate how many units of a lot are already in itemsFactura
  const getCommittedQtyForLot = (prodCode: string, lotId: string): number => {
    return itemsFactura
      .filter((i) => i.productoCodigo === prodCode && i.loteId === lotId)
      .reduce((acc, cur) => acc + cur.cantidad, 0);
  };

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

    if (isNaN(qty) || qty <= 0) {
      alert("Ingrese una cantidad válida mayor que 0.");
      return;
    }
    if (isNaN(price) || price < 0) {
      alert("Ingrese un precio unitario válido.");
      return;
    }

    const alreadyInList = getCommittedQtyForLot(selectedProduct.codigo, selectedLot.id);
    const maxLotStock = getLotStock(selectedLot);
    const remainingStock = maxLotStock - alreadyInList;

    if (qty > remainingStock) {
      alert(
        `Stock insuficiente en el lote ${selectedLot.numeroLote}. Disponible: ${remainingStock} unidades.`
      );
      return;
    }

    const itemAppliesItbis = aplicaItbisProducto || aplicaItbisFactura;

    setItemsFactura((prev) => {
      const existingIndex = prev.findIndex(
        (i) => i.productoCodigo === selectedProduct.codigo && i.loteId === selectedLot.id
      );
      if (existingIndex >= 0) {
        return prev.map((item, idx) => {
          if (idx !== existingIndex) return item;
          const nextQty = item.cantidad + qty;
          const nextSub = nextQty * price;
          const nextItbis = itemAppliesItbis ? nextSub * ITBIS_RATE : 0;
          return {
            ...item,
            cantidad: nextQty,
            precioUnitario: price,
            subtotal: nextSub,
            aplicaItbis: itemAppliesItbis,
            itbisMonto: nextItbis,
            totalItem: nextSub + nextItbis
          };
        });
      }

      const sub = qty * price;
      const itbis = itemAppliesItbis ? sub * ITBIS_RATE : 0;

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
        subtotal: sub,
        aplicaItbis: itemAppliesItbis,
        itbisMonto: itbis,
        totalItem: sub + itbis
      };
      return [...prev, newItem];
    });

    setCantidadInput("1");
    playSound("positive");
    showToast(`"${selectedProduct.nombre}" agregado a la factura.`);
  };

  const handleUpdateItemQty = (itemId: string, newQty: number) => {
    if (newQty <= 0) return;
    const targetItem = itemsFactura.find((i) => i.id === itemId);
    if (!targetItem) return;

    const prod = products.find((p) => p.codigo === targetItem.productoCodigo);
    const lot = prod?.lotes.find((l) => l.id === targetItem.loteId);
    const maxStock = lot ? getLotStock(lot) : Infinity;

    if (lot && newQty > maxStock) {
      showToast(`El lote ${lot.numeroLote} solo dispone de ${maxStock} unidades.`);
      return;
    }

    setItemsFactura((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        const nextSub = newQty * item.precioUnitario;
        const nextItbis = item.aplicaItbis ? nextSub * ITBIS_RATE : 0;
        return {
          ...item,
          cantidad: newQty,
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

  // Totals calculation with 18% ITBIS support
  const totalUnidadesFactura = useMemo(
    () => itemsFactura.reduce((acc, item) => acc + item.cantidad, 0),
    [itemsFactura]
  );

  const subtotalBaseFactura = useMemo(
    () => itemsFactura.reduce((acc, item) => acc + Number(item.subtotal || 0), 0),
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

  // Preview calculations for the currently selected product before adding
  const previewAddSubtotal = useMemo(() => {
    const q = Math.max(0, Number(cantidadInput || 0));
    const p = Math.max(0, Number(precioUnitarioInput || 0));
    return q * p;
  }, [cantidadInput, precioUnitarioInput]);

  const previewAddItbis = useMemo(() => {
    return aplicaItbisProducto || aplicaItbisFactura ? previewAddSubtotal * ITBIS_RATE : 0;
  }, [previewAddSubtotal, aplicaItbisProducto, aplicaItbisFactura]);

  const hasValidClientPhone = useMemo(() => {
    return formatPhoneForWhatsApp(clienteContacto).length >= 8;
  }, [clienteContacto]);

  const buildCurrentFacturaObject = (): FacturaVenta => {
    const now = new Date();
    const horaStr = now.toTimeString().slice(0, 5);
    const effectiveCatId =
      selectedCatalogId === "todos" ? activeCatalogId || "default-cat" : selectedCatalogId;
    return {
      id: `venta-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      numeroFactura: numeroFactura.trim() || `FAC-${Date.now().toString().slice(-4)}`,
      fecha: fechaFactura || now.toISOString().slice(0, 10),
      hora: horaStr,
      timestamp: Date.now(),
      concepto: conceptoSeleccionado || "Venta",
      clienteNombre: clienteNombre.trim(),
      clienteContacto: clienteContacto.trim(),
      observaciones: observaciones.trim(),
      catalogId: effectiveCatId,
      catalogNombre: activeCatalogName,
      usuarioResponsable: `${currentUser.nombre} (${currentUser.usuario})`,
      items: itemsFactura,
      totalUnidades: totalUnidadesFactura,
      subtotalMonto: subtotalBaseFactura,
      aplicaItbis: totalItbisFactura > 0,
      itbisMonto: totalItbisFactura,
      totalMonto: totalMontoFactura
    };
  };

  const handleEmitirFactura = async (exportFormat?: "pdf" | "word" | "whatsapp") => {
    if (submitting) return;
    if (!getEnabledModules(currentUser).includes("venta")) {
      showToast("Acceso denegado: No tienes permisos autorizados para el módulo de Ventas.");
      return;
    }
    if (itemsFactura.length === 0) {
      alert("Agregue al menos un medicamento, insumo o producto a la factura.");
      return;
    }
    if (!numeroFactura.trim()) {
      alert("Ingrese el número de factura.");
      return;
    }
    if (exportFormat === "whatsapp" && !hasValidClientPhone) {
      alert(
        "Para enviar la factura por WhatsApp, ingrese primero el número de teléfono del cliente en la sección 1."
      );
      return;
    }

    setSubmitting(true);
    playSound("action");

    const nuevaFactura = buildCurrentFacturaObject();

    try {
      if (isLocalFileMode) {
        const storedProds = localStorage.getItem("offline_productos");
        let listProds: Producto[] = storedProds ? JSON.parse(storedProds) : [...products];

        listProds = listProds.map((p) => {
          const itemsForProd = itemsFactura.filter((i) => i.productoCodigo === p.codigo);
          if (itemsForProd.length === 0) return p;
          const updatedLotes = (p.lotes || []).map((l) => {
            const matchItem = itemsForProd.find((i) => i.loteId === l.id);
            if (!matchItem) return l;
            const nextCant = Math.max(0, Number(l.cantidad || 0) - matchItem.cantidad);
            const nextCantF = Math.max(
              0,
              Number(l.cantidadF ?? l.cantidad ?? 0) - matchItem.cantidad
            );
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
            tipoMovimiento: "Salida",
            usuario: nuevaFactura.usuarioResponsable,
            fecha: new Date().toISOString(),
            timestamp: Date.now(),
            catalogId: nuevaFactura.catalogId,
            numeroFactura: nuevaFactura.numeroFactura,
            proveedor: `${nuevaFactura.concepto}${
              nuevaFactura.clienteNombre ? ` • Cliente: ${nuevaFactura.clienteNombre}` : ""
            }`
          });
        });
        localStorage.setItem("offline_movimientos", JSON.stringify(listMovs));

        const nextFacturas = [nuevaFactura, ...facturasHistorial];
        setFacturasHistorial(nextFacturas);
        localStorage.setItem("offline_facturas_venta", JSON.stringify(nextFacturas));
      } else {
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
            const nextCant = Math.max(0, Number(l.cantidad || 0) - matchItem.cantidad);
            const nextCantF = Math.max(
              0,
              Number(l.cantidadF ?? l.cantidad ?? 0) - matchItem.cantidad
            );
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
            tipoMovimiento: "Salida",
            usuario: nuevaFactura.usuarioResponsable,
            fecha: new Date().toISOString(),
            timestamp: Date.now(),
            catalogId: nuevaFactura.catalogId,
            numeroFactura: nuevaFactura.numeroFactura,
            proveedor: `${nuevaFactura.concepto}${
              nuevaFactura.clienteNombre ? ` • Cliente: ${nuevaFactura.clienteNombre}` : ""
            }`
          };
          batch.set(doc(movCol, movId), movDoc);
        });

        await batch.commit();

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
          `Factura ${nuevaFactura.numeroFactura} emitida (${nuevaFactura.concepto})${
            nuevaFactura.clienteNombre ? ` a ${nuevaFactura.clienteNombre}` : ""
          } por RD$ ${nuevaFactura.totalMonto.toFixed(2)}.`
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
      setClienteContacto("");
      setObservaciones("");
      setItemsFactura([]);
      setAplicaItbisFactura(false);
      setAplicaItbisProducto(false);
      playSound("positive");
      showToast(
        exportFormat === "whatsapp"
          ? `Factura ${nuevaFactura.numeroFactura} generada en PDF y abierta en WhatsApp.`
          : `Factura ${nuevaFactura.numeroFactura} (${nuevaFactura.concepto}) registrada con éxito.`
      );
    } catch (err) {
      console.error("Error al emitir factura:", err);
      alert("Ocurrió un error al registrar la factura.");
    } finally {
      setSubmitting(false);
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
    showToast(`PDF de ${fac.numeroFactura} descargado y chat de WhatsApp abierto.`);
  };

  const filteredFacturasHistorial = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return facturasHistorial;
    return facturasHistorial.filter(
      (f) =>
        f.numeroFactura.toLowerCase().includes(q) ||
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

  return (
    <div className="space-y-6 anim-card-in">
      {/* Cabecera Principal del Módulo de Venta */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          {currentInstitucion.logoUrl ? (
            <div className="w-16 h-16 rounded-2xl border border-slate-200 bg-white p-1.5 flex items-center justify-center shrink-0 shadow-xs">
              <img
                src={currentInstitucion.logoUrl}
                alt="Logo Institucional"
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ) : (
            <div className="w-15 h-15 rounded-2xl bg-teal-600 text-white flex items-center justify-center shrink-0 shadow-sm">
              <ShoppingBag className="w-7 h-7" />
            </div>
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                Módulo de Ventas y Facturación
              </h2>
              <span className="text-xs font-extrabold uppercase tracking-wider bg-teal-50 text-teal-800 border border-teal-200 px-3 py-1 rounded-full">
                {activeCatalogName}
              </span>
            </div>
            <p className="text-sm font-bold text-teal-700 mt-1">
              {currentInstitucion.nombre || "Suministros Hospitalarios • Dr. José Manuel Rodríguez"}
              {currentInstitucion.rnc ? ` • RNC: ${currentInstitucion.rnc}` : ""}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Facturación de medicamentos, insumos y artículos con cálculo de ITBIS (18%), PDF institucional y envío por WhatsApp.
            </p>
          </div>
        </div>

        {/* Selector de Vista: Nueva Factura vs Facturas Emitidas */}
        <div className="inline-flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200 self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={() => {
              setSubTab("nueva");
              playSound("click");
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
              subTab === "nueva"
                ? "bg-teal-700 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>Nueva Factura</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSubTab("historial");
              playSound("click");
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
              subTab === "historial"
                ? "bg-teal-700 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Facturas Emitidas</span>
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-black ${
                subTab === "historial"
                  ? "bg-white/20 text-white"
                  : "bg-teal-100 text-teal-800"
              }`}
            >
              {facturasHistorial.length}
            </span>
          </button>
        </div>
      </div>

      {subTab === "nueva" ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Columna Izquierda (7 cols): Formulario de Factura y Selección de Productos */}
          <div className="lg:col-span-7 space-y-6">
            {/* SECCIÓN 1: Datos de la Factura, Concepto y Cliente */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-sm space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-xl bg-teal-600 text-white font-black text-xs flex items-center justify-center shadow-2xs">
                    1
                  </span>
                  <div>
                    <h3 className="text-sm sm:text-base font-black text-slate-900">
                      Datos de la Factura y del Cliente
                    </h3>
                    <p className="text-xs text-slate-500">
                      Complete el concepto de operación y los datos opcionales del cliente
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-bold bg-slate-100 text-slate-600 px-3 py-1 rounded-full">
                  Cliente y Teléfono opcionales
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700 mb-1.5">
                    <Hash className="w-3.5 h-3.5 text-teal-600" />
                    <span>N.º de Factura *</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={numeroFactura}
                    onChange={(e) => setNumeroFactura(e.target.value.toUpperCase())}
                    placeholder="FAC-0001"
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-mono font-black text-teal-900 outline-none focus:bg-white focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 transition"
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
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-bold text-slate-800 outline-none focus:bg-white focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 cursor-pointer transition"
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
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-bold text-slate-800 outline-none focus:bg-white focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 transition"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700 mb-1.5">
                    <User className="w-3.5 h-3.5 text-teal-600" />
                    <span>Nombre del Cliente / Paciente (Opcional)</span>
                  </label>
                  <input
                    type="text"
                    value={clienteNombre}
                    onChange={(e) => setClienteNombre(e.target.value)}
                    placeholder="Ej. Juan Pérez / Aseguradora / Centro"
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 transition"
                  />
                </div>

                <div>
                  <label className="flex items-center justify-between text-xs font-extrabold text-slate-700 mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Teléfono / WhatsApp Cliente (Opcional)</span>
                    </span>
                    {hasValidClientPhone && (
                      <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                        WhatsApp Listo
                      </span>
                    )}
                  </label>
                  <input
                    type="tel"
                    value={clienteContacto}
                    onChange={(e) => setClienteContacto(e.target.value)}
                    placeholder="Ej. (809) 555-0199"
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                  Observaciones o Nota en la Factura (Opcional)
                </label>
                <input
                  type="text"
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Ej. Entrega en mostrador / Orden médica adjunta / Condición de pago"
                  className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 transition"
                />
              </div>
            </div>

            {/* SECCIÓN 2: Seleccionar Producto del Catálogo */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/90 shadow-sm space-y-5">
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
                      Elija el catálogo, seleccione el medicamento o insumo, su lote y defina si aplica ITBIS (18%)
                    </p>
                  </div>
                </div>
                <span className="text-xs font-extrabold bg-teal-50 text-teal-800 border border-teal-200 px-3 py-1 rounded-full">
                  {filteredCatalogProducts.length} de {catalogProducts.length} productos disponibles
                </span>
              </div>

              {/* Fila 1: Selector de Catálogo + Buscador Rápido */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4">
                <div className="sm:col-span-5">
                  <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700 mb-1.5">
                    <Layers className="w-3.5 h-3.5 text-teal-600" />
                    <span>Catálogo de Productos *</span>
                  </label>
                  <select
                    value={selectedCatalogId}
                    onChange={(e) => handleCatalogChange(e.target.value)}
                    className="w-full h-11 bg-teal-50/60 rounded-xl border border-teal-300 px-3.5 text-sm font-extrabold text-teal-950 outline-none focus:bg-white focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 cursor-pointer transition"
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
                        // Si hay coincidencia exacta o única al filtrar, facilitar selección
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
                      className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 pl-10 pr-9 text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 transition"
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

              {/* Fila 2: Lista Desplegable de Producto + Lista Desplegable de Lote */}
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
                    className="w-full h-11 bg-white rounded-xl border-2 border-slate-300 hover:border-teal-500 px-3.5 text-sm font-bold text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 cursor-pointer transition shadow-2xs"
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
                        Disp: {Math.max(0, getLotStock(selectedLot) - getCommittedQtyForLot(selectedProduct?.codigo || "", selectedLot.id))} u.
                      </span>
                    )}
                  </label>
                  <select
                    value={selectedLoteId}
                    onChange={(e) => handleSelectLotChange(e.target.value)}
                    disabled={!selectedProduct || productLots.length === 0}
                    className="w-full h-11 bg-white disabled:bg-slate-100 rounded-xl border-2 border-slate-300 hover:border-teal-500 disabled:hover:border-slate-300 px-3.5 text-sm font-bold text-slate-900 disabled:text-slate-400 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 cursor-pointer transition shadow-2xs"
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
                            Lote: {l.numeroLote} • Disp: {disp} u. • Vence: {l.fechaVencimiento || "N/A"} • RD$ {Number(l.precio || 0).toFixed(2)}
                          </option>
                        );
                      })
                    )}
                  </select>
                </div>
              </div>

              {/* Resumen del producto seleccionado (si hay uno activo) */}
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
                      Subtotal Línea {aplicaItbisProducto || aplicaItbisFactura ? "(+18% ITBIS)" : "(Exento)"}
                    </span>
                    <span className="text-base font-black text-teal-900">
                      RD$ {(previewAddSubtotal + previewAddItbis).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {/* Fila 3: Cantidad, Precio Unitario y Casilla ITBIS 18% */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
                <div className="sm:col-span-3">
                  <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                    Cantidad *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={cantidadInput}
                    onChange={(e) => setCantidadInput(e.target.value)}
                    placeholder="1"
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-black text-slate-900 outline-none focus:bg-white focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 transition"
                  />
                </div>

                <div className="sm:col-span-4">
                  <label className="block text-xs font-extrabold text-slate-700 mb-1.5">
                    Precio Unitario (RD$) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={precioUnitarioInput}
                    onChange={(e) => setPrecioUnitarioInput(e.target.value)}
                    placeholder="0.00"
                    className="w-full h-11 bg-slate-50 rounded-xl border border-slate-300 px-3.5 text-sm font-black text-slate-900 outline-none focus:bg-white focus:border-teal-600 focus:ring-2 focus:ring-teal-500/20 transition"
                  />
                </div>

                {/* Casilla de Impuesto ITBIS 18% para el producto */}
                <div className="sm:col-span-5">
                  <label
                    className={`flex items-center justify-between gap-2.5 h-11 px-3.5 rounded-xl border-2 cursor-pointer transition select-none ${
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
                        <span>Lleva ITBIS (18%)</span>
                      </span>
                    </div>
                    <span className="text-xs font-black font-mono text-amber-800">
                      +RD$ {previewAddItbis.toFixed(2)}
                    </span>
                  </label>
                </div>
              </div>

              {/* Botón de Agregar a la Factura */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleAddItemToInvoice}
                  disabled={!selectedProduct || !selectedLot}
                  className="w-full h-12 px-5 bg-teal-700 hover:bg-teal-800 disabled:bg-slate-200 disabled:text-slate-400 text-white font-black text-xs sm:text-sm uppercase tracking-wider rounded-2xl transition active:scale-98 shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Plus className="w-5 h-5" />
                  <span>Agregar Producto al Detalle de la Factura</span>
                </button>
              </div>
            </div>
          </div>

          {/* Columna Derecha (5 cols): Vista Previa de la Factura, Totales con ITBIS 18% y Envío por WhatsApp */}
          <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden flex flex-col">
            {/* Membrete Institucional con Logo */}
            <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-4">
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
                    {currentInstitucion.nombre || "Suministros Hospitalarios"}
                  </h4>
                  {currentInstitucion.rnc && (
                    <p className="text-xs font-mono font-bold text-slate-600">
                      RNC: {currentInstitucion.rnc}
                    </p>
                  )}
                  {currentInstitucion.telefono && (
                    <p className="text-xs text-slate-500">Tel: {currentInstitucion.telefono}</p>
                  )}
                  {currentInstitucion.direccion && (
                    <p className="text-[11px] text-slate-500 truncate">
                      {currentInstitucion.direccion}
                    </p>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="inline-block px-3 py-1 rounded-xl bg-teal-800 text-white font-mono font-black text-xs shadow-2xs">
                  {numeroFactura || "FAC-0001"}
                </span>
                <p className="text-xs font-black uppercase text-teal-700 mt-1">
                  {conceptoSeleccionado}
                </p>
                <p className="text-[11px] text-slate-500 font-semibold">{fechaFactura}</p>
              </div>
            </div>

            {/* Datos del Cliente en la Vista Previa */}
            <div className="px-5 py-3.5 bg-white border-b border-slate-200 grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200/70">
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Cliente / Destinatario
                </span>
                <span className="font-extrabold text-slate-800 block truncate mt-0.5">
                  {clienteNombre.trim() || "Consumidor Final / General"}
                </span>
              </div>
              <div className="bg-slate-50 rounded-xl p-2.5 border border-slate-200/70">
                <span className="text-[10px] font-black uppercase text-slate-400 block">
                  Teléfono / WhatsApp
                </span>
                <span className="font-extrabold text-slate-800 block truncate mt-0.5">
                  {clienteContacto.trim() || "No especificado"}
                </span>
              </div>
            </div>

            {/* Casilla Global para aplicar ITBIS 18% a toda la factura */}
            <div className="px-5 pt-4">
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
                      Aplicar ITBIS (18%) a toda la factura
                    </span>
                    <span className="text-[11px] text-slate-500 block">
                      También puede marcar o desmarcar el 18% por cada producto en la tabla
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 font-mono font-black text-xs shrink-0">
                  18% ITBIS
                </span>
              </label>
            </div>

            {/* Tabla Detalle de Productos Agregados */}
            <div className="p-5 flex-1 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-slate-700 tracking-wider">
                  3. Detalle de Productos ({itemsFactura.length})
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
                    La factura aún no tiene productos
                  </p>
                  <p className="text-xs text-slate-400 max-w-xs mx-auto">
                    Elija un producto en la sección 2 y presione «Agregar Producto al Detalle de la Factura».
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-black text-slate-600 uppercase">
                        <th className="px-3 py-2.5">Producto / Lote</th>
                        <th className="px-2 py-2.5 text-center">Cant.</th>
                        <th className="px-2 py-2.5 text-center" title="Aplicar ITBIS 18%">
                          ITBIS 18%
                        </th>
                        <th className="px-2.5 py-2.5 text-right">Subtotal</th>
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
                            <td className="px-3 py-2.5">
                              <p className="font-extrabold text-slate-900 leading-snug">
                                {item.productoNombre}
                              </p>
                              <p className="text-[11px] text-slate-500 font-mono">
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
                                className="w-14 text-center bg-slate-50 border border-slate-300 rounded-lg py-1 text-xs font-black text-slate-900"
                              />
                            </td>
                            <td className="px-2 py-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => handleToggleItemItbis(item.id)}
                                className={`px-2 py-1 rounded-lg text-[10px] font-black border transition cursor-pointer ${
                                  item.aplicaItbis
                                    ? "bg-amber-100 text-amber-900 border-amber-300"
                                    : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200"
                                }`}
                                title="Haga clic para activar/desactivar el 18% de ITBIS en este producto"
                              >
                                {item.aplicaItbis ? `+RD$ ${itemItbis.toFixed(2)}` : "Exento"}
                              </button>
                            </td>
                            <td className="px-2.5 py-2.5 text-right font-black text-teal-900 whitespace-nowrap">
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

              {/* Desglose de Totales (Subtotal, ITBIS 18% y Total Factura) */}
              <div className="bg-teal-950 text-white rounded-2xl p-4 space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between text-xs text-teal-200 border-b border-teal-800/80 pb-2">
                  <span>Subtotal Base ({totalUnidadesFactura} unid.):</span>
                  <span className="font-mono font-bold text-white">
                    RD$ {subtotalBaseFactura.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-amber-300 border-b border-teal-800/80 pb-2">
                  <span>Impuesto ITBIS (18%):</span>
                  <span className="font-mono font-bold">
                    + RD$ {totalItbisFactura.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-0.5">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-teal-300 block">
                      Total General ({conceptoSeleccionado})
                    </span>
                    <span className="text-xs font-semibold text-teal-100">
                      {totalItbisFactura > 0 ? "Incluye ITBIS 18%" : "Exento de ITBIS"}
                    </span>
                  </div>
                  <span className="text-xl font-black font-mono text-emerald-300">
                    RD$ {totalMontoFactura.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Botones de Acción: PDF, WhatsApp, Word y Registro */}
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
                      ? "Procesando Factura..."
                      : "Emitir Factura y Descargar PDF"}
                  </span>
                </button>

                {/* Botón de Envío de Factura en PDF por WhatsApp al Cliente */}
                <button
                  type="button"
                  disabled={submitting || itemsFactura.length === 0 || !hasValidClientPhone}
                  onClick={() => handleEmitirFactura("whatsapp")}
                  className={`w-full h-12 px-4 font-black text-xs sm:text-sm uppercase tracking-wider rounded-2xl transition active:scale-98 shadow-sm flex items-center justify-center gap-2 cursor-pointer ${
                    hasValidClientPhone && itemsFactura.length > 0
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : "bg-emerald-50 text-emerald-800/60 border border-emerald-200 disabled:cursor-not-allowed"
                  }`}
                  title={
                    hasValidClientPhone
                      ? "Genera el PDF de la factura y abre el chat de WhatsApp del cliente"
                      : "Ingrese el número de teléfono del cliente en la sección 1 para enviar por WhatsApp"
                  }
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
        /* Pestaña 2: Historial de Facturas Emitidas */
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-extrabold text-slate-900">
                Facturas Emitidas ({filteredFacturasHistorial.length})
              </h3>
              <p className="text-xs text-slate-500">
                Consulta, visualiza con el logo institucional, descarga en PDF/Word o envía por WhatsApp al cliente.
              </p>
            </div>
            <div className="relative sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Buscar por factura, cliente, teléfono, concepto..."
                className="w-full h-10 bg-slate-50 rounded-xl border border-slate-300 pl-10 pr-4 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-teal-600"
              />
            </div>
          </div>

          {filteredFacturasHistorial.length === 0 ? (
            <div className="py-12 text-center text-slate-400 space-y-2">
              <FileText className="w-10 h-10 mx-auto text-slate-300" />
              <p className="text-sm font-bold text-slate-600">No hay facturas registradas</p>
              <p className="text-xs text-slate-400">
                Las facturas que emitas en la pestaña «Nueva Factura» aparecerán aquí.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-2xl">
              <table className="min-w-[820px] w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-extrabold text-slate-600 uppercase tracking-wider">
                    <th className="px-4 py-3">N.º Factura</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Concepto</th>
                    <th className="px-4 py-3">Cliente / Teléfono</th>
                    <th className="px-4 py-3 text-right">Subtotal</th>
                    <th className="px-4 py-3 text-right">ITBIS 18%</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredFacturasHistorial.map((fac) => {
                    const sub = getFacturaSubtotal(fac);
                    const itbis = getFacturaItbis(fac);
                    const hasPhone = formatPhoneForWhatsApp(fac.clienteContacto).length >= 8;

                    return (
                      <tr key={fac.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-4 py-3 font-mono font-black text-teal-800">
                          {fac.numeroFactura}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {fac.fecha}{" "}
                          <span className="text-[10px] text-slate-400">{fac.hora}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-teal-50 text-teal-800 border border-teal-200">
                            {fac.concepto}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-800">
                            {fac.clienteNombre || "Consumidor Final"}
                          </p>
                          {fac.clienteContacto && (
                            <p className="text-[11px] text-emerald-700 font-semibold">
                              Tel: {fac.clienteContacto}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-700">
                          RD$ {sub.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-amber-800">
                          {itbis > 0 ? `RD$ ${itbis.toFixed(2)}` : "Exento"}
                        </td>
                        <td className="px-4 py-3 text-right font-black text-teal-900">
                          RD$ {Number(fac.totalMonto || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setPreviewFactura(fac)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] transition cursor-pointer"
                              title="Ver Factura"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Ver</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => exportSaleInvoiceToPDF(fac, currentInstitucion)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-[11px] transition cursor-pointer"
                              title="Descargar PDF"
                            >
                              <FileDown className="w-3.5 h-3.5" />
                              <span>PDF</span>
                            </button>
                            {hasPhone && (
                              <button
                                type="button"
                                onClick={() => handleSendExistingInvoiceWhatsApp(fac)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-[11px] transition cursor-pointer"
                                title="Descargar PDF y Enviar por WhatsApp al Cliente"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>WhatsApp</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => exportSaleInvoiceToWord(fac, currentInstitucion)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold text-[11px] transition cursor-pointer"
                              title="Descargar Word"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>Word</span>
                            </button>
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

      {/* Modal de Vista Previa de Factura con Logotipo Institucional, ITBIS y WhatsApp */}
      {previewFactura && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs"
            onClick={() => setPreviewFactura(null)}
          />
          <div className="relative bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh] anim-card-in">
            <div className="p-6 bg-slate-50 border-b border-slate-200 flex items-start justify-between gap-4">
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
                  {currentInstitucion.rnc && (
                    <p className="text-xs font-mono font-bold text-slate-600">
                      RNC: {currentInstitucion.rnc}
                    </p>
                  )}
                  {currentInstitucion.direccion && (
                    <p className="text-xs text-slate-500">{currentInstitucion.direccion}</p>
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
                    Factura
                  </span>
                  <span className="font-mono font-black text-teal-800">
                    {previewFactura.numeroFactura}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block">
                    Concepto
                  </span>
                  <span className="font-bold text-slate-800">{previewFactura.concepto}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block">
                    Cliente
                  </span>
                  <span className="font-bold text-slate-800">
                    {previewFactura.clienteNombre || "Consumidor Final"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block">
                    Contacto
                  </span>
                  <span className="font-semibold text-slate-700">
                    {previewFactura.clienteContacto || "—"}
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
                      <th className="px-3 py-2.5 text-right">ITBIS 18%</th>
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
                          <td className="px-3 py-2.5 font-mono font-bold text-teal-700">
                            {item.productoCodigo}
                          </td>
                          <td className="px-3 py-2.5">
                            <p className="font-bold text-slate-800">{item.productoNombre}</p>
                            {item.descripcion && (
                              <p className="text-[10px] text-slate-500">{item.descripcion}</p>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center font-mono">{item.numeroLote}</td>
                          <td className="px-3 py-2.5 text-right font-bold">{item.cantidad}</td>
                          <td className="px-3 py-2.5 text-right">
                            RD$ {Number(item.precioUnitario || 0).toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5 text-right text-amber-800 font-semibold">
                            {item.aplicaItbis || itemItbis > 0
                              ? `RD$ ${itemItbis.toFixed(2)}`
                              : "Exento"}
                          </td>
                          <td className="px-3 py-2.5 text-right font-black text-teal-800">
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
                  <span>RD$ {getFacturaSubtotal(previewFactura).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-amber-800 font-bold">
                  <span>ITBIS (18%):</span>
                  <span>RD$ {getFacturaItbis(previewFactura).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-black text-teal-900 border-t border-slate-200 pt-2">
                  <span>Total Factura:</span>
                  <span>RD$ {Number(previewFactura.totalMonto || 0).toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2.5">
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
                <span>Descargar PDF</span>
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
