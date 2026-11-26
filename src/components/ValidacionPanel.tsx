import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Catalogo,
  Departamento,
  DocumentoValidacionItem,
  HistorialOperacionValidacion,
  MetodoExtraccionValidacion,
  Movimiento,
  Producto,
  PropuestaAjusteInventario,
  RegistroConsumo,
  RegistroValidacionDocumento,
  SolicitudVerificacionProducto,
  TipoDocumentoValidacion,
  Usuario,
  matchesCatalog
} from "../types";
import {
  buildValidationComparisonItems,
  extractItemsFromValidationDocument,
  parseFreeTextLinesToItems,
  recalculateValidationItemWithProduct,
  RawExtractedDocItem
} from "../utils/validacionEngine";
import {
  createPropuestaAjusteInventario,
  getNowDateAndTime,
  normalizeDepartmentName,
  resolvePropuestaAjusteInventario,
  saveValidacionDocumentoRecord,
  subscribeValidacionCollections
} from "../utils/validacionStorage";
import { getActiveFarmaciaId, tenantCollection } from "../firebase";
import { query, orderBy, limit, getDocs } from "firebase/firestore";
import { loadLocalConsumos } from "../utils/consumosUtils";
import { triggerOpenChatForProductValidation } from "./ChatLateral";
import ModalVerificacionProducto from "./ModalVerificacionProducto";
import { playSound } from "../utils/audio";
import {
  exportValidacionToPDF,
  exportValidacionToWord
} from "../utils/exportUtils";
import { loadDraft, saveDraft } from "../utils/draftPersistence";
import {
  FileCheck2,
  Upload,
  FileText,
  FileSpreadsheet,
  FileDown,
  Image as ImageIcon,
  Camera,
  Search,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  FileEdit,
  History,
  ClipboardCheck,
  RefreshCw,
  Plus,
  Trash2,
  Eye,
  X,
  ArrowRight,
  Building2,
  UserCheck,
  Package,
  Sparkles,
  TrendingDown
} from "lucide-react";

interface ValidacionPanelProps {
  products: Producto[];
  movimientos?: Movimiento[];
  consumos?: RegistroConsumo[];
  currentUser: Usuario;
  activeCatalogId: string;
  catalogos: Catalogo[];
  departamentos: Departamento[];
  onProductsUpdated?: (updatedProducts: Producto[]) => void;
  showToast: (msg: string) => void;
}

export default function ValidacionPanel({
  products,
  movimientos: propMovimientos,
  consumos: propConsumos,
  currentUser,
  activeCatalogId,
  catalogos,
  departamentos,
  onProductsUpdated,
  showToast
}: ValidacionPanelProps) {
  const activeSedeId = getActiveFarmaciaId() || "default";
  const validacionDraftKey = `validacion_form_draft_${activeSedeId}`;
  const initialValidacionDraft = useMemo(
    () =>
      loadDraft(validacionDraftKey, {
        activeSubTab: "documentos" as "documentos" | "autorizaciones" | "verificaciones" | "historial",
        currentDocName: "",
        currentDocType: "PDF" as TipoDocumentoValidacion,
        currentExtractionMethod: "PARSER_ESTRUCTURADO" as MetodoExtraccionValidacion,
        previewImageUrl: null as string | null,
        rawOcrText: "",
        showRawOcrEditor: false,
        comparisonItems: [] as DocumentoValidacionItem[],
        observacionesGeneralesDoc: "",
        validationSavedCode: null as string | null,
        filterComparisonMode: "TODOS" as "TODOS" | "DISCREPANCIAS" | "COINCIDENTES"
      }),
    [validacionDraftKey]
  );

  const [activeSubTab, setActiveSubTab] = useState<
    "documentos" | "autorizaciones" | "verificaciones" | "historial"
  >(initialValidacionDraft.activeSubTab || "documentos");

  const [fetchedMovimientos, setFetchedMovimientos] = useState<Movimiento[]>([]);
  const [fetchedConsumos, setFetchedConsumos] = useState<RegistroConsumo[]>(() =>
    loadLocalConsumos()
  );

  const movimientos = propMovimientos && propMovimientos.length > 0 ? propMovimientos : fetchedMovimientos;
  const consumos = propConsumos && propConsumos.length > 0 ? propConsumos : fetchedConsumos;

  // Colecciones en tiempo real
  const [validacionesDocs, setValidacionesDocs] = useState<RegistroValidacionDocumento[]>([]);
  const [propuestasAjuste, setPropuestasAjuste] = useState<PropuestaAjusteInventario[]>([]);
  const [solicitudesVerificacion, setSolicitudesVerificacion] = useState<
    SolicitudVerificacionProducto[]
  >([]);
  const [historialOperaciones, setHistorialOperaciones] = useState<
    HistorialOperacionValidacion[]
  >([]);

  // Estado del escáner / cargador de documentos (Pestaña 1)
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionStatus, setExtractionStatus] = useState("");
  const [currentDocName, setCurrentDocName] = useState(initialValidacionDraft.currentDocName || "");
  const [currentDocType, setCurrentDocType] = useState<TipoDocumentoValidacion>(
    initialValidacionDraft.currentDocType || "PDF"
  );
  const [currentExtractionMethod, setCurrentExtractionMethod] =
    useState<MetodoExtraccionValidacion>(
      initialValidacionDraft.currentExtractionMethod || "PARSER_ESTRUCTURADO"
    );
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(
    initialValidacionDraft.previewImageUrl || null
  );
  const [rawOcrText, setRawOcrText] = useState<string>(initialValidacionDraft.rawOcrText || "");
  const [showRawOcrEditor, setShowRawOcrEditor] = useState<boolean>(
    Boolean(initialValidacionDraft.showRawOcrEditor)
  );
  const [comparisonItems, setComparisonItems] = useState<DocumentoValidacionItem[]>(() =>
    Array.isArray(initialValidacionDraft.comparisonItems)
      ? initialValidacionDraft.comparisonItems
      : []
  );
  const [observacionesGeneralesDoc, setObservacionesGeneralesDoc] = useState(
    initialValidacionDraft.observacionesGeneralesDoc || ""
  );
  const [validationSavedCode, setValidationSavedCode] = useState<string | null>(
    initialValidacionDraft.validationSavedCode || null
  );
  const [savingValidation, setSavingValidation] = useState(false);
  const [filterComparisonMode, setFilterComparisonMode] = useState<
    "TODOS" | "DISCREPANCIAS" | "COINCIDENTES"
  >(initialValidacionDraft.filterComparisonMode || "TODOS");

  // Guardar borrador de Validación automáticamente
  useEffect(() => {
    const safePreview =
      previewImageUrl && previewImageUrl.length < 350000 ? previewImageUrl : null;
    const currentDraft = {
      activeSubTab,
      currentDocName,
      currentDocType,
      currentExtractionMethod,
      previewImageUrl: safePreview,
      rawOcrText,
      showRawOcrEditor,
      comparisonItems,
      observacionesGeneralesDoc,
      validationSavedCode,
      filterComparisonMode
    };
    saveDraft(validacionDraftKey, currentDraft);

    const flushDraft = () => saveDraft(validacionDraftKey, currentDraft);
    window.addEventListener("pagehide", flushDraft);
    document.addEventListener("visibilitychange", flushDraft);
    return () => {
      window.removeEventListener("pagehide", flushDraft);
      document.removeEventListener("visibilitychange", flushDraft);
    };
  }, [
    validacionDraftKey,
    activeSubTab,
    currentDocName,
    currentDocType,
    currentExtractionMethod,
    previewImageUrl,
    rawOcrText,
    showRawOcrEditor,
    comparisonItems,
    observacionesGeneralesDoc,
    validationSavedCode,
    filterComparisonMode
  ]);

  // Modal para cambiar / seleccionar manualmente el código de producto de una fila
  const [codePickerRowId, setCodePickerRowId] = useState<string | null>(null);
  const [codePickerSearch, setCodePickerSearch] = useState("");

  // Modal para generar una Propuesta de Ajuste desde una fila con discrepancia
  const [proposalDraftRow, setProposalDraftRow] = useState<DocumentoValidacionItem | null>(null);
  const [propMotivoInput, setPropMotivoInput] = useState(
    "Discrepancia detectada en validación documental contra inventario"
  );
  const [propObservacionesInput, setPropObservacionesInput] = useState("");
  const [propStockSistemaInput, setPropStockSistemaInput] = useState<number>(0);
  const [propStockFisicoInput, setPropStockFisicoInput] = useState<number>(0);
  const [propCostoInput, setPropCostoInput] = useState<number>(0);
  const [propFechaVtoInput, setPropFechaVtoInput] = useState("");
  const [propLoteInput, setPropLoteInput] = useState("");
  const [creatingProposal, setCreatingProposal] = useState(false);

  // Modal de Confirmación Explícita para Aprobar o Rechazar un Ajuste (Pestaña 2)
  const [authDecisionModal, setAuthDecisionModal] = useState<{
    propuesta: PropuestaAjusteInventario;
    decision: "APROBADO" | "RECHAZADO";
  } | null>(null);
  const [authObservacionesInput, setAuthObservacionesInput] = useState("");
  const [processingAuthDecision, setProcessingAuthDecision] = useState(false);
  const [propuestasFilter, setPropuestasFilter] = useState<
    "PENDIENTE_AUTORIZACION" | "APROBADO" | "RECHAZADO" | "TODAS"
  >("PENDIENTE_AUTORIZACION");

  // Modal de Verificación Física (Pestaña 3)
  const [selectedSolicitudModal, setSelectedSolicitudModal] =
    useState<SolicitudVerificacionProducto | null>(null);
  const [verificacionesDeptFilter, setVerificacionesDeptFilter] = useState<string>("TODOS");
  const [verificacionesStatusFilter, setVerificacionesStatusFilter] = useState<
    "TODAS" | "PENDIENTE" | "CONFIRMADAS"
  >("TODAS");

  // Modal para ver el detalle de una Validación Documental guardada (Pestaña 4)
  const [inspectValidacionDoc, setInspectValidacionDoc] =
    useState<RegistroValidacionDocumento | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Productos filtrados al catálogo activo (o todos si corresponde)
  const catalogProducts = useMemo(() => {
    const filtered = products.filter((p) =>
      matchesCatalog(p.catalogId, activeCatalogId, catalogos)
    );
    return filtered.length > 0 ? filtered : products;
  }, [products, activeCatalogId, catalogos]);

  const canAuthorizeAdjustments = currentUser.rol === "Administrador";

  useEffect(() => {
    const unsub = subscribeValidacionCollections({
      onValidaciones: setValidacionesDocs,
      onPropuestas: setPropuestasAjuste,
      onSolicitudes: setSolicitudesVerificacion,
      onHistorial: setHistorialOperaciones
    });

    // Cargar movimientos y consumos para calcular el consumo histórico de los productos comparados
    (async () => {
      try {
        setFetchedConsumos(loadLocalConsumos());
        if (typeof window !== "undefined" && window.location.protocol === "file:") {
          const raw = localStorage.getItem("offline_movimientos");
          if (raw) {
            setFetchedMovimientos(JSON.parse(raw));
          }
          return;
        }
        const q = query(tenantCollection("movimientos"), orderBy("timestamp", "desc"), limit(500));
        const snap = await getDocs(q);
        const list: Movimiento[] = [];
        snap.forEach((d) => list.push({ id: d.id, ...(d.data() as any) } as Movimiento));
        setFetchedMovimientos(list);
      } catch {
        const raw = localStorage.getItem("offline_movimientos");
        if (raw) {
          try {
            setFetchedMovimientos(JSON.parse(raw));
          } catch {
            // ignore
          }
        }
      }
    })();

    return () => unsub();
  }, [currentUser.farmaciaId]);

  const processFileObject = async (file: File) => {
    setIsExtracting(true);
    setExtractionStatus("Iniciando lectura y análisis del documento...");
    setValidationSavedCode(null);
    setPreviewImageUrl(null);
    setRawOcrText("");
    setShowRawOcrEditor(false);
    playSound("action");

    try {
      const output = await extractItemsFromValidationDocument(file, (status) => {
        setExtractionStatus(status);
      });

      setCurrentDocName(file.name);
      setCurrentDocType(output.tipoDocumento);
      setCurrentExtractionMethod(output.metodoExtraccion);
      if (output.previewImageUrl) {
        setPreviewImageUrl(output.previewImageUrl);
      }
      if (output.textoCrudo) {
        setRawOcrText(output.textoCrudo);
      }

      if (output.rawItems.length === 0) {
        const fallbackRow: RawExtractedDocItem = {
          numeroItem: "1",
          nombreProducto: "",
          unidadMedida: "Unidad",
          cantidad: 1
        };
        const built = buildValidationComparisonItems(
          [fallbackRow],
          catalogProducts,
          movimientos,
          consumos
        );
        setComparisonItems(built);
        if (output.textoCrudo) {
          setShowRawOcrEditor(true);
        }
        showToast(
          "Documento leído. Puedes revisar el texto OCR detectado o completar los ítems abajo."
        );
      } else {
        const built = buildValidationComparisonItems(
          output.rawItems,
          catalogProducts,
          movimientos,
          consumos
        );
        setComparisonItems(built);
        playSound("positive");
        showToast(
          `Se extrajeron y compararon ${built.length} ítems desde "${file.name}" (${output.tipoDocumento}).`
        );
      }
    } catch (err) {
      console.error("Error procesando documento para validación:", err);
      playSound("negative");
      showToast("No se pudo leer automáticamente el archivo. Puedes ingresar o pegar el texto manualmente.");
    } finally {
      setIsExtracting(false);
      setExtractionStatus("");
    }
  };

  // Procesar archivo subido (PDF, Word, Excel o Imagen)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFileObject(file);
    if (e.target) e.target.value = "";
  };

  // Re-procesar texto OCR editado o pegado por el usuario
  const handleReparseRawOcrText = () => {
    const lines = rawOcrText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const parsed = parseFreeTextLinesToItems(lines);
    if (parsed.length === 0) {
      playSound("negative");
      showToast("No se detectaron renglones con producto y cantidad en el texto.");
      return;
    }
    const built = buildValidationComparisonItems(
      parsed,
      catalogProducts,
      movimientos,
      consumos
    );
    setComparisonItems(built);
    playSound("positive");
    showToast(`Se actualizaron ${built.length} ítems a partir del texto del documento.`);
  };

  // Cargar documento demostrativo con ejemplos de similitud inteligente (incluyendo Paracetamol 500 mg)
  const handleLoadSmartDemoDocument = () => {
    playSound("open");
    setCurrentDocName("Acta_Recepcion_Suministros_Hospitalarios.pdf");
    setCurrentDocType("PDF");
    setCurrentExtractionMethod("IA_OCR");
    setPreviewImageUrl(null);
    setValidationSavedCode(null);

    // Tomar hasta 4 productos reales del inventario actual para demostrar coincidencias con variaciones de escritura
    const sampleProds = catalogProducts.slice(0, 4);
    const demoRawItems: RawExtractedDocItem[] = [
      {
        numeroItem: "1",
        nombreProducto: "Paracetamol 500 mg",
        unidadMedida: "Comprimido",
        cantidad: 250,
        costoUnitario: 4.5,
        fechaVencimiento: "2027-08-30",
        lote: "LOT-2027A"
      }
    ];

    sampleProds.forEach((p, idx) => {
      const currentSys = p.lotes.reduce((acc, l) => acc + Number(l.cantidad || 0), 0);
      const firstLot = p.lotes[0];
      // Crear una variación realista del nombre para demostrar el emparejamiento inteligente
      const shortName = p.nombre
        .replace(/\b(comprimidos?|tabletas?|capsulas?|ampollas?|frascos?)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();

      demoRawItems.push({
        numeroItem: String(idx + 2),
        nombreProducto: shortName || p.nombre,
        unidadMedida: p.descripcion || "Unidad",
        cantidad: idx % 2 === 0 ? currentSys : Math.max(1, currentSys + 15),
        costoUnitario: firstLot ? Number(firstLot.precio || 0) : 25,
        fechaVencimiento: firstLot?.fechaVencimiento || "2027-12-31",
        lote: firstLot?.numeroLote || `L-${100 + idx}`
      });
    });

    const built = buildValidationComparisonItems(
      demoRawItems,
      catalogProducts,
      movimientos,
      consumos
    );
    setComparisonItems(built);
    showToast(
      "Documento de demostración cargado en Modo de Comparación. Ningún dato del inventario ha sido modificado."
    );
  };

  // Agregar fila manual a la tabla de validación documental
  const handleAddManualValidationRow = () => {
    playSound("click");
    const newRaw: RawExtractedDocItem = {
      numeroItem: String(comparisonItems.length + 1),
      nombreProducto: "",
      unidadMedida: "Unidad",
      cantidad: 1
    };
    const [newItem] = buildValidationComparisonItems(
      [newRaw],
      catalogProducts,
      movimientos,
      consumos
    );
    setComparisonItems((prev) => [...prev, newItem]);
  };

  // Actualizar campos editables de una fila del documento y re-emparejar si cambia el nombre
  const handleUpdateComparisonRowField = (
    rowId: string,
    field:
      | "numeroItem"
      | "nombreDocumento"
      | "unidadMedidaDocumento"
      | "cantidadDocumento"
      | "costoDocumento"
      | "fechaVencimientoDocumento",
    value: any
  ) => {
    setComparisonItems((prev) =>
      prev.map((item) => {
        if (item.id !== rowId) return item;
        const updatedItem = { ...item, [field]: value };

        // Si cambió el nombre o unidad y no fue fijado manualmente, re-buscar coincidencia inteligente
        if (
          (field === "nombreDocumento" || field === "unidadMedidaDocumento") &&
          !item.fueCorregidoManualmente
        ) {
          const [rebuilt] = buildValidationComparisonItems(
            [
              {
                numeroItem: updatedItem.numeroItem,
                nombreProducto: updatedItem.nombreDocumento,
                unidadMedida: updatedItem.unidadMedidaDocumento,
                cantidad: Number(updatedItem.cantidadDocumento || 0),
                costoUnitario: updatedItem.costoDocumento,
                fechaVencimiento: updatedItem.fechaVencimientoDocumento,
                lote: updatedItem.loteDocumento
              }
            ],
            catalogProducts,
            movimientos,
            consumos
          );
          return { ...rebuilt, id: item.id };
        }

        // Recalcular diferencias con el producto actualmente seleccionado
        const selectedProd =
          catalogProducts.find((p) => p.codigo === updatedItem.productoCodigoSeleccionado) ||
          products.find((p) => p.codigo === updatedItem.productoCodigoSeleccionado) ||
          null;
        return recalculateValidationItemWithProduct(
          updatedItem,
          selectedProd,
          movimientos,
          consumos,
          Boolean(updatedItem.fueCorregidoManualmente)
        );
      })
    );
  };

  // Seleccionar manualmente un código de producto del inventario para una fila
  const handleSelectManualProductForRow = (rowId: string, selectedProduct: Producto | null) => {
    playSound("positive");
    setComparisonItems((prev) =>
      prev.map((item) => {
        if (item.id !== rowId) return item;
        return recalculateValidationItemWithProduct(
          item,
          selectedProduct,
          movimientos,
          consumos,
          true
        );
      })
    );
    setCodePickerRowId(null);
    setCodePickerSearch("");
  };

  const handleRemoveComparisonRow = (rowId: string) => {
    playSound("click");
    setComparisonItems((prev) => prev.filter((r) => r.id !== rowId));
  };

  // Guardar la Validación Documental (como auditoría independiente sin tocar inventario)
  const handleSaveDocumentValidation = async () => {
    if (comparisonItems.length === 0 || savingValidation) return;

    setSavingValidation(true);
    try {
      const { fecha, hora, timestamp } = getNowDateAndTime();
      const numeroValidacion =
        validationSavedCode || `VAL-${String(timestamp).slice(-5)}`;
      const itemsCoincidentes = comparisonItems.filter(
        (i) => i.productoCodigoSeleccionado && !i.tieneDiscrepancia
      ).length;
      const itemsConDiscrepancia = comparisonItems.filter(
        (i) => i.tieneDiscrepancia
      ).length;
      const itemsSinVincular = comparisonItems.filter(
        (i) => !i.productoCodigoSeleccionado
      ).length;

      const record: RegistroValidacionDocumento = {
        id: `val-doc-${timestamp}`,
        numeroValidacion,
        sedeId: getActiveFarmaciaId(),
        nombreArchivo: currentDocName || "Validacion_Manual_Documento",
        tipoDocumento: currentDocType,
        metodoExtraccion: currentExtractionMethod,
        fecha,
        hora,
        timestamp,
        catalogId: activeCatalogId,
        catalogNombre:
          catalogos.find((c) => c.id === activeCatalogId)?.nombre ||
          "Catálogo Principal",
        usuarioValidador: currentUser.nombre,
        usuarioValidadorId: currentUser.id,
        departamentoValidador: normalizeDepartmentName(currentUser.departamento),
        rolValidador: currentUser.rol,
        totalItems: comparisonItems.length,
        itemsCoincidentes,
        itemsConDiscrepancia,
        itemsSinVincular,
        items: comparisonItems,
        observacionesGenerales:
          observacionesGeneralesDoc.trim() ||
          "Validación documental comparativa registrada sin modificación directa de inventario."
      };

      await saveValidacionDocumentoRecord(record, currentUser);
      setValidationSavedCode(numeroValidacion);
      playSound("positive");
      showToast(
        `Validación documental ${numeroValidacion} guardada en el historial de auditoría (Inventario intacto).`
      );
    } catch (err) {
      console.error("Error guardando validación documental:", err);
      playSound("negative");
      showToast("No se pudo guardar el registro de validación documental.");
    } finally {
      setSavingValidation(false);
    }
  };

  // Exportar la comparación del sistema o el documento escaneado en PDF o Word
  const handleExportValidacion = (
    modo: "comparacion" | "documento",
    formato: "pdf" | "word",
    customRecord?: RegistroValidacionDocumento
  ) => {
    const itemsToExport = customRecord ? customRecord.items : comparisonItems;
    if (!itemsToExport || itemsToExport.length === 0) {
      playSound("negative");
      showToast("No hay ítems cargados para exportar.");
      return;
    }

    playSound("action");
    const { fecha, hora } = getNowDateAndTime();
    const payload = {
      codigoValidacion: customRecord
        ? customRecord.numeroValidacion
        : validationSavedCode || undefined,
      nombreDocumento: customRecord
        ? customRecord.nombreArchivo
        : currentDocName || "Documento_Escaneado",
      tipoDocumento: customRecord ? customRecord.tipoDocumento : currentDocType,
      metodoExtraccion: customRecord
        ? customRecord.metodoExtraccion
        : currentExtractionMethod,
      items: itemsToExport,
      usuarioNombre: customRecord
        ? customRecord.usuarioValidador
        : currentUser.nombre,
      usuarioDepartamento: customRecord
        ? customRecord.departamentoValidador
        : normalizeDepartmentName(currentUser.departamento),
      fecha: customRecord ? customRecord.fecha : fecha,
      hora: customRecord ? customRecord.hora : hora,
      observaciones: customRecord
        ? customRecord.observacionesGenerales
        : observacionesGeneralesDoc.trim() || undefined,
      previewImageUrl: customRecord ? null : previewImageUrl,
      modo
    };

    try {
      if (formato === "pdf") {
        exportValidacionToPDF(payload);
        showToast(
          modo === "comparacion"
            ? "Comparación del sistema exportada en PDF (.pdf)."
            : "Documento escaneado exportado en PDF (.pdf)."
        );
      } else {
        exportValidacionToWord(payload);
        showToast(
          modo === "comparacion"
            ? "Comparación del sistema exportada en Word (.doc)."
            : "Documento escaneado exportado en Word (.doc)."
        );
      }
    } catch (err) {
      console.error("Error exportando validación:", err);
      playSound("negative");
      showToast("Ocurrió un error al generar el archivo de exportación.");
    }
  };

  // Abrir modal para crear una Propuesta de Ajuste desde un ítem con discrepancias
  const handleOpenCreateProposalModal = (item: DocumentoValidacionItem) => {
    if (!item.productoCodigoSeleccionado) {
      playSound("negative");
      showToast(
        "Primero selecciona el código del producto en inventario al cual aplicar la propuesta de ajuste."
      );
      return;
    }
    playSound("open");
    setProposalDraftRow(item);
    setPropStockSistemaInput(item.cantidadDocumento);
    setPropStockFisicoInput(item.cantidadDocumento);
    setPropCostoInput(
      item.costoDocumento !== undefined && item.costoDocumento > 0
        ? item.costoDocumento
        : Number(item.costoInventarioActual || 0)
    );
    setPropFechaVtoInput(
      item.fechaVencimientoDocumento || item.fechaVencimientoInventarioActual || ""
    );
    setPropLoteInput(
      item.loteDocumento || item.numeroLoteInventarioActual || "GENERAL"
    );
    setPropMotivoInput(
      `Discrepancia detectada en documento "${
        currentDocName || "Validación Documental"
      }" (Ítem #${item.numeroItem}): Documento indica ${
        item.cantidadDocumento
      } und. vs. Sistema ${item.existenciaSistemaActual} und.`
    );
    setPropObservacionesInput(item.observacionItem || "");
  };

  // Confirmar creación de Propuesta de Ajuste (queda PENDIENTE_AUTORIZACION)
  const handleConfirmCreateProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proposalDraftRow || creatingProposal) return;

    setCreatingProposal(true);
    try {
      const { fecha, hora, timestamp } = getNowDateAndTime();
      const codigoPropuesta = `AJU-${String(timestamp).slice(-5)}`;
      const refValCode =
        validationSavedCode || `VAL-${String(timestamp).slice(-5)}`;

      const propuesta: PropuestaAjusteInventario = {
        id: `prop-aju-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
        codigoPropuesta,
        sedeId: getActiveFarmaciaId(),
        origen: "VALIDACION_DOCUMENTAL",
        origenReferenciaId: proposalDraftRow.id,
        origenReferenciaCodigo: refValCode,
        nombreDocumentoOrigen: currentDocName || "Documento validado",
        catalogId: activeCatalogId,
        productoCodigo: proposalDraftRow.productoCodigoSeleccionado,
        productoNombreActual:
          proposalDraftRow.productoNombreInventario ||
          proposalDraftRow.nombreDocumento,
        unidadMedidaActual:
          proposalDraftRow.unidadMedidaInventario ||
          proposalDraftRow.unidadMedidaDocumento,
        loteId: proposalDraftRow.loteIdObjetivo,
        numeroLoteActual:
          proposalDraftRow.numeroLoteInventarioActual || "GENERAL",
        existenciaSistemaActual: proposalDraftRow.existenciaSistemaActual,
        existenciaFisicaActual: proposalDraftRow.existenciaFisicaActual,
        costoActual: Number(proposalDraftRow.costoInventarioActual || 0),
        fechaVencimientoActual:
          proposalDraftRow.fechaVencimientoInventarioActual || "",
        productoNombrePropuesto:
          proposalDraftRow.productoNombreInventario ||
          proposalDraftRow.nombreDocumento,
        unidadMedidaPropuesta:
          proposalDraftRow.unidadMedidaDocumento ||
          proposalDraftRow.unidadMedidaInventario ||
          "Unidad",
        numeroLotePropuesto: propLoteInput.trim() || "GENERAL",
        existenciaSistemaPropuesta: Number(propStockSistemaInput),
        existenciaFisicaPropuesta: Number(propStockFisicoInput),
        costoPropuesto: Number(propCostoInput),
        fechaVencimientoPropuesta: propFechaVtoInput,
        diferenciaCantidadSistema:
          Number(propStockSistemaInput) -
          proposalDraftRow.existenciaSistemaActual,
        diferenciaCantidadFisica:
          Number(propStockFisicoInput) -
          proposalDraftRow.existenciaFisicaActual,
        motivoCambio: propMotivoInput.trim(),
        observacionesValidacion: propObservacionesInput.trim(),
        validadoPorNombre: currentUser.nombre,
        validadoPorUsuario: currentUser.usuario,
        validadoPorDepartamento: normalizeDepartmentName(
          currentUser.departamento
        ),
        rolValidador: currentUser.rol,
        fechaValidacion: fecha,
        horaValidacion: hora,
        timestampValidacion: timestamp,
        estado: "PENDIENTE_AUTORIZACION"
      };

      await createPropuestaAjusteInventario(propuesta, currentUser);

      setComparisonItems((prev) =>
        prev.map((it) =>
          it.id === proposalDraftRow.id
            ? { ...it, propuestaAjusteId: propuesta.codigoPropuesta }
            : it
        )
      );

      setProposalDraftRow(null);
      playSound("positive");
      showToast(
        `Propuesta de ajuste ${propuesta.codigoPropuesta} creada y enviada a Control de Cambios y Autorización.`
      );
    } catch (err) {
      console.error("Error creando propuesta de ajuste:", err);
      playSound("negative");
      showToast("Ocurrió un error al generar la propuesta de ajuste.");
    } finally {
      setCreatingProposal(false);
    }
  };

  // Procesar Aprobación o Rechazo explícito de una propuesta de ajuste (Pestaña 2)
  const handleConfirmAuthDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authDecisionModal || processingAuthDecision) return;

    if (!canAuthorizeAdjustments) {
      playSound("negative");
      showToast("Solo un usuario con rol Administrador puede autorizar o rechazar ajustes de inventario.");
      return;
    }

    setProcessingAuthDecision(true);
    try {
      const { propuestaActualizada } = await resolvePropuestaAjusteInventario({
        propuesta: authDecisionModal.propuesta,
        decision: authDecisionModal.decision,
        observacionesAutorizacion: authObservacionesInput,
        currentUser,
        products,
        onProductsUpdated
      });

      setAuthDecisionModal(null);
      setAuthObservacionesInput("");
      playSound("positive");

      if (propuestaActualizada.estado === "APROBADO") {
        showToast(
          `Ajuste ${propuestaActualizada.codigoPropuesta} APROBADO y aplicado al inventario (${propuestaActualizada.productoCodigo}).`
        );
      } else {
        showToast(
          `Ajuste ${propuestaActualizada.codigoPropuesta} RECHAZADO. Los datos del inventario no fueron modificados.`
        );
      }
    } catch (err) {
      console.error("Error resolviendo propuesta de ajuste:", err);
      playSound("negative");
      showToast("Error al procesar la autorización de la propuesta.");
    } finally {
      setProcessingAuthDecision(false);
    }
  };

  const pendingProposalsCount = useMemo(
    () =>
      propuestasAjuste.filter((p) => p.estado === "PENDIENTE_AUTORIZACION")
        .length,
    [propuestasAjuste]
  );

  const pendingVerificationsCount = useMemo(
    () =>
      solicitudesVerificacion.filter((s) => s.estado === "PENDIENTE").length,
    [solicitudesVerificacion]
  );

  const displayedComparisonItems = useMemo(() => {
    if (filterComparisonMode === "DISCREPANCIAS") {
      return comparisonItems.filter((i) => i.tieneDiscrepancia);
    }
    if (filterComparisonMode === "COINCIDENTES") {
      return comparisonItems.filter(
        (i) => i.productoCodigoSeleccionado && !i.tieneDiscrepancia
      );
    }
    return comparisonItems;
  }, [comparisonItems, filterComparisonMode]);

  return (
    <div className="space-y-6">
      {/* ENCABEZADO DEL MÓDULO DE VALIDACIÓN */}
      <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-600 to-emerald-700 text-white flex items-center justify-center shadow-md shadow-teal-900/15 shrink-0">
              <FileCheck2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
                  Módulo de Validación, Comparación IA y Control de Ajustes
                </h2>
                <span className="text-[10px] font-black uppercase tracking-wider bg-teal-50 text-teal-800 border border-teal-200 px-2.5 py-0.5 rounded-lg">
                  OCR • IA • Trazabilidad
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-1 max-w-3xl leading-relaxed">
                Escanea documentos (PDF, Word, Excel y Fotografías), compara existencias y consumos con identificación inteligente de medicamentos, gestiona solicitudes de verificación física por departamento y autoriza cambios bajo control estricto.
              </p>
            </div>
          </div>

          {/* Aviso de Seguridad de Inventario */}
          <div className="bg-amber-50/90 border border-amber-200/90 rounded-2xl px-4 py-3 flex items-center gap-2.5 max-w-md shrink-0">
            <ShieldCheck className="w-5 h-5 text-amber-700 shrink-0" />
            <p className="text-[11px] font-bold text-amber-950 leading-snug">
              Protección Activa: Ninguna validación modifica el inventario automáticamente. Todo ajuste requiere propuesta y autorización explícita.
            </p>
          </div>
        </div>

        {/* Barra de Navegación Interna del Módulo */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={() => {
              setActiveSubTab("documentos");
              playSound("click");
            }}
            className={`px-4 py-3 rounded-2xl text-xs font-extrabold uppercase tracking-wider flex items-center justify-between gap-2 transition cursor-pointer border ${
              activeSubTab === "documentos"
                ? "bg-teal-700 text-white border-teal-700 shadow-sm"
                : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-teal-50/60 hover:border-teal-300"
            }`}
          >
            <span className="flex items-center gap-2 truncate">
              <Sparkles className="w-4 h-4 shrink-0" />
              <span className="truncate">1. Validación Documental</span>
            </span>
            {comparisonItems.length > 0 && (
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                  activeSubTab === "documentos"
                    ? "bg-white/20 text-white"
                    : "bg-teal-100 text-teal-800"
                }`}
              >
                {comparisonItems.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveSubTab("autorizaciones");
              playSound("click");
            }}
            className={`px-4 py-3 rounded-2xl text-xs font-extrabold uppercase tracking-wider flex items-center justify-between gap-2 transition cursor-pointer border ${
              activeSubTab === "autorizaciones"
                ? "bg-teal-700 text-white border-teal-700 shadow-sm"
                : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-teal-50/60 hover:border-teal-300"
            }`}
          >
            <span className="flex items-center gap-2 truncate">
              <UserCheck className="w-4 h-4 shrink-0" />
              <span className="truncate">2. Autorización Ajustes</span>
            </span>
            {pendingProposalsCount > 0 && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 animate-pulse">
                {pendingProposalsCount} pend.
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveSubTab("verificaciones");
              playSound("click");
            }}
            className={`px-4 py-3 rounded-2xl text-xs font-extrabold uppercase tracking-wider flex items-center justify-between gap-2 transition cursor-pointer border ${
              activeSubTab === "verificaciones"
                ? "bg-teal-700 text-white border-teal-700 shadow-sm"
                : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-teal-50/60 hover:border-teal-300"
            }`}
          >
            <span className="flex items-center gap-2 truncate">
              <ClipboardCheck className="w-4 h-4 shrink-0" />
              <span className="truncate">3. Verificaciones Chat</span>
            </span>
            {pendingVerificationsCount > 0 && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-400 text-slate-950">
                {pendingVerificationsCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveSubTab("historial");
              playSound("click");
            }}
            className={`px-4 py-3 rounded-2xl text-xs font-extrabold uppercase tracking-wider flex items-center justify-between gap-2 transition cursor-pointer border ${
              activeSubTab === "historial"
                ? "bg-teal-700 text-white border-teal-700 shadow-sm"
                : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-teal-50/60 hover:border-teal-300"
            }`}
          >
            <span className="flex items-center gap-2 truncate">
              <History className="w-4 h-4 shrink-0" />
              <span className="truncate">4. Historial y Auditoría</span>
            </span>
            <span
              className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                activeSubTab === "historial"
                  ? "bg-white/20 text-white"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              {historialOperaciones.length}
            </span>
          </button>
        </div>
      </div>

      {/* ==========================================================================
          PESTAÑA 1: VALIDACIÓN DE DOCUMENTOS (PDF, WORD, EXCEL, IMÁGENES OCR/IA)
      ========================================================================== */}
      {activeSubTab === "documentos" && (
        <div className="space-y-6">
          {/* Panel de Carga / Escaneo de Documentos */}
          <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-sm sm:text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <Upload className="w-4.5 h-4.5 text-teal-600" />
                  <span>Escanear y Extraer Documento para Comparación Inteligente</span>
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Formatos soportados: <strong>PDF (.pdf)</strong>, <strong>Microsoft Word (.docx, .doc)</strong>, <strong>Excel (.xlsx, .xls, .csv)</strong> e <strong>Imágenes / Fotografías (.jpg, .png, cámara)</strong> mediante OCR e IA.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleLoadSmartDemoDocument}
                  className="px-3.5 py-2.5 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5"
                >
                  <Sparkles className="w-4 h-4 text-teal-600" />
                  <span>Cargar Ejemplo Inteligente</span>
                </button>
                <button
                  type="button"
                  onClick={handleAddManualValidationRow}
                  className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  <span>Añadir Fila Manual</span>
                </button>
              </div>
            </div>

            {/* Inputs ocultos para archivos y cámara */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc,.rtf,.xlsx,.xls,.csv,image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileUpload}
              className="hidden"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <button
                type="button"
                disabled={isExtracting}
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center p-4 rounded-2xl border-2 border-dashed border-rose-200 bg-rose-50/40 hover:bg-rose-50 hover:border-rose-400 transition cursor-pointer text-center group"
              >
                <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center mb-2 group-hover:scale-105 transition">
                  <FileText className="w-5 h-5" />
                </div>
                <span className="text-xs font-extrabold text-slate-900">
                  Documento PDF (.pdf)
                </span>
                <span className="text-[10px] font-semibold text-slate-500 mt-0.5">
                  Tablas y OCR con IA
                </span>
              </button>

              <button
                type="button"
                disabled={isExtracting}
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center p-4 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/40 hover:bg-blue-50 hover:border-blue-400 transition cursor-pointer text-center group"
              >
                <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center mb-2 group-hover:scale-105 transition">
                  <FileText className="w-5 h-5" />
                </div>
                <span className="text-xs font-extrabold text-slate-900">
                  Microsoft Word (.docx)
                </span>
                <span className="text-[10px] font-semibold text-slate-500 mt-0.5">
                  Actas, tablas y listados
                </span>
              </button>

              <button
                type="button"
                disabled={isExtracting}
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center p-4 rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50 hover:border-emerald-400 transition cursor-pointer text-center group"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-2 group-hover:scale-105 transition">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <span className="text-xs font-extrabold text-slate-900">
                  Hoja de Excel (.xlsx / .csv)
                </span>
                <span className="text-[10px] font-semibold text-slate-500 mt-0.5">
                  Detección inteligente
                </span>
              </button>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={isExtracting}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-2.5 p-3 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/40 hover:bg-amber-50 hover:border-amber-400 transition cursor-pointer"
                >
                  <ImageIcon className="w-5 h-5 text-amber-700 shrink-0" />
                  <div className="text-left">
                    <span className="text-xs font-extrabold text-slate-900 block">
                      Subir Fotografía / Imagen
                    </span>
                    <span className="text-[10px] font-semibold text-slate-500 block">
                      Escaneo OCR + IA (.jpg, .png)
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  disabled={isExtracting}
                  onClick={() => cameraInputRef.current?.click()}
                  className="py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-extrabold uppercase tracking-wider flex items-center justify-center gap-1.5 transition cursor-pointer shadow-2xs"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Tomar Foto con Cámara</span>
                </button>
              </div>
            </div>

            {isExtracting && (
              <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4 flex items-center gap-3">
                <RefreshCw className="w-5 h-5 text-teal-700 animate-spin shrink-0" />
                <div>
                  <p className="text-xs font-extrabold text-teal-950">
                    Procesando documento con OCR e Inteligencia Artificial...
                  </p>
                  <p className="text-[11px] font-semibold text-teal-700">
                    {extractionStatus || "Identificando medicamentos, concentraciones, cantidades y costos..."}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* RESULTADO DE LA EXTRACCIÓN Y TABLA DE COMPARACIÓN INTELIGENTE */}
          {comparisonItems.length > 0 && (
            <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-5">
              {/* Barra de Resumen de Comparación */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-mono font-black uppercase bg-teal-100 text-teal-900 border border-teal-300 px-2.5 py-0.5 rounded-md">
                      Documento: {currentDocName || "Validación en Curso"} ({currentDocType})
                    </span>
                    <span className="text-[10px] font-extrabold uppercase bg-slate-100 text-slate-700 px-2.5 py-0.5 rounded-md border border-slate-200">
                      Motor:{" "}
                      {currentExtractionMethod === "IA_OCR"
                        ? "IA Multimodal & OCR"
                        : currentExtractionMethod === "OCR_LOCAL"
                        ? "OCR Óptico Local"
                        : "Extractor Estructurado"}
                    </span>
                    {validationSavedCode && (
                      <span className="text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-300 px-2.5 py-0.5 rounded-md">
                        ✓ Guardada como {validationSavedCode}
                      </span>
                    )}
                  </div>
                  <h4 className="text-sm sm:text-base font-extrabold text-slate-900">
                    Mesa de Comparación Inteligente con Inventario (Modo Sólo Lectura de Stock)
                  </h4>
                </div>

                {/* Filtros rápidos de comparación */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setFilterComparisonMode("TODOS")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                      filterComparisonMode === "TODOS"
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    Todos ({comparisonItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterComparisonMode("DISCREPANCIAS")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                      filterComparisonMode === "DISCREPANCIAS"
                        ? "bg-amber-600 text-white"
                        : "bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100"
                    }`}
                  >
                    Con Diferencias (
                    {comparisonItems.filter((i) => i.tieneDiscrepancia).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterComparisonMode("COINCIDENTES")}
                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                      filterComparisonMode === "COINCIDENTES"
                        ? "bg-emerald-600 text-white"
                        : "bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100"
                    }`}
                  >
                    Exactos (
                    {
                      comparisonItems.filter(
                        (i) => i.productoCodigoSeleccionado && !i.tieneDiscrepancia
                      ).length
                    }
                    )
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setComparisonItems([]);
                      setPreviewImageUrl(null);
                      setValidationSavedCode(null);
                    }}
                    className="px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-extrabold transition cursor-pointer"
                  >
                    Limpiar Mesa
                  </button>
                </div>
              </div>

              {/* Barra de Exportación: Comparación del Sistema (PDF / Word) y Documento Escaneado (PDF / Word) */}
              <div className="bg-gradient-to-r from-teal-50/90 via-slate-50 to-indigo-50/70 border border-teal-200/80 rounded-2xl p-3.5 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-teal-700 text-white flex items-center justify-center shrink-0 shadow-2xs">
                    <FileDown className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <span className="text-xs font-extrabold text-slate-900 block">
                      Exportar Comparación del Sistema o Documento Escaneado
                    </span>
                    <span className="text-[11px] font-medium text-slate-600 block">
                      Descarga el reporte comparativo frente al inventario o los datos extraídos del documento en formato PDF (.pdf) o Microsoft Word (.doc).
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Grupo 1: Exportar Comparación del Sistema */}
                  <div className="flex items-center gap-1.5 bg-white border border-teal-200 rounded-xl p-1 shadow-2xs">
                    <span className="text-[10px] font-black uppercase tracking-wider text-teal-900 px-2">
                      Comparación:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleExportValidacion("comparacion", "pdf")}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-extrabold transition cursor-pointer flex items-center gap-1"
                      title="Exportar Comparación del Sistema en PDF"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      <span>PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportValidacion("comparacion", "word")}
                      className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-extrabold transition cursor-pointer flex items-center gap-1"
                      title="Exportar Comparación del Sistema en Word (.doc)"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Word</span>
                    </button>
                  </div>

                  {/* Grupo 2: Exportar Documento Escaneado / Extraído */}
                  <div className="flex items-center gap-1.5 bg-white border border-indigo-200 rounded-xl p-1 shadow-2xs">
                    <span className="text-[10px] font-black uppercase tracking-wider text-indigo-950 px-2">
                      Documento:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleExportValidacion("documento", "pdf")}
                      className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 text-[11px] font-extrabold transition cursor-pointer flex items-center gap-1"
                      title="Exportar Documento Escaneado en PDF"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                      <span>PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportValidacion("documento", "word")}
                      className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-[11px] font-extrabold transition cursor-pointer flex items-center gap-1"
                      title="Exportar Documento Escaneado en Word (.doc)"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Word</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Si se subió una fotografía o se extrajo texto OCR, mostrar vista previa y editor opcional de texto OCR */}
              {(previewImageUrl || rawOcrText) && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-3">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                      {previewImageUrl && (
                        <img
                          src={previewImageUrl}
                          alt="Documento escaneado"
                          className="h-28 w-auto rounded-xl border border-slate-300 object-contain bg-white p-1 shrink-0"
                        />
                      )}
                      <div className="space-y-1 text-xs">
                        <span className="font-extrabold text-slate-900 block">
                          Documento Escaneado con OCR ({comparisonItems.length} renglones detectados)
                        </span>
                        <p className="text-slate-600 font-medium">
                          Puedes editar cualquier celda de la tabla inferior directamente, cambiar el código del producto vinculado o revisar el texto crudo leído por el OCR.
                        </p>
                      </div>
                    </div>

                    {rawOcrText && (
                      <button
                        type="button"
                        onClick={() => setShowRawOcrEditor((prev) => !prev)}
                        className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 text-xs font-extrabold transition cursor-pointer shrink-0"
                      >
                        {showRawOcrEditor ? "Ocultar Texto OCR" : "Ver / Editar Texto OCR"}
                      </button>
                    )}
                  </div>

                  {showRawOcrEditor && (
                    <div className="pt-2 border-t border-slate-200 space-y-2">
                      <label className="block text-[11px] font-extrabold uppercase text-slate-600">
                        Texto leído del documento (puedes corregir o pegar líneas y pulsar &laquo;Re-analizar Texto&raquo;):
                      </label>
                      <textarea
                        rows={6}
                        value={rawOcrText}
                        onChange={(e) => setRawOcrText(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-mono text-slate-800 outline-none focus:ring-2 focus:ring-teal-500/30"
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleReparseRawOcrText}
                          className="px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-extrabold transition cursor-pointer flex items-center gap-1.5"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Re-analizar Texto OCR</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tabla Comparativa Completa */}
              <div className="w-full overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="min-w-[1160px] w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-extrabold uppercase text-slate-600 tracking-wider">
                      <th className="px-3 py-3 w-16">Ítem #</th>
                      <th className="px-3 py-3 min-w-[230px]">
                        Producto y U. Medida (Documento)
                      </th>
                      <th className="px-3 py-3 min-w-[250px]">
                        Coincidencia en Inventario (Código Sugerido / Manual)
                      </th>
                      <th className="px-3 py-3 text-right">Cant. Doc</th>
                      <th className="px-3 py-3 text-right">Existencia Inv.</th>
                      <th className="px-3 py-3 text-right">Diferencia</th>
                      <th className="px-3 py-3 text-right">Consumo Reg.</th>
                      <th className="px-3 py-3">Costo y Vencimiento</th>
                      <th className="px-3 py-3 text-center">Control de Ajuste</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {displayedComparisonItems.map((item) => {
                      const hasCode = Boolean(item.productoCodigoSeleccionado);
                      const diff = item.diferenciaCantidad;

                      return (
                        <tr
                          key={item.id}
                          className={`transition ${
                            !hasCode
                              ? "bg-rose-50/30 hover:bg-rose-50/60"
                              : item.tieneDiscrepancia
                              ? "bg-amber-50/30 hover:bg-amber-50/60"
                              : "hover:bg-slate-50"
                          }`}
                        >
                          {/* 1. Número de Ítem */}
                          <td className="px-3 py-3 align-top">
                            <input
                              type="text"
                              value={item.numeroItem}
                              onChange={(e) =>
                                handleUpdateComparisonRowField(
                                  item.id,
                                  "numeroItem",
                                  e.target.value
                                )
                              }
                              className="w-14 rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs font-extrabold text-slate-900 text-center"
                            />
                          </td>

                          {/* 2. Nombre del Producto y Unidad de Medida en el Documento */}
                          <td className="px-3 py-3 align-top space-y-1.5">
                            <input
                              type="text"
                              value={item.nombreDocumento}
                              placeholder="Nombre del medicamento en documento..."
                              onChange={(e) =>
                                handleUpdateComparisonRowField(
                                  item.id,
                                  "nombreDocumento",
                                  e.target.value
                                )
                              }
                              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-extrabold text-slate-900"
                            />
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-slate-500">
                                U. Medida:
                              </span>
                              <input
                                type="text"
                                value={item.unidadMedidaDocumento}
                                onChange={(e) =>
                                  handleUpdateComparisonRowField(
                                    item.id,
                                    "unidadMedidaDocumento",
                                    e.target.value
                                  )
                                }
                                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-700"
                              />
                            </div>
                          </td>

                          {/* 3. Producto Vinculado en Inventario + Nivel de Coincidencia + Selector Manual */}
                          <td className="px-3 py-3 align-top space-y-1.5">
                            {hasCode ? (
                              <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-2.5 space-y-1.5">
                                <div className="flex items-center justify-between gap-1.5 flex-wrap">
                                  <span className="font-mono text-[11px] font-black bg-teal-100 text-teal-900 border border-teal-300 px-2 py-0.5 rounded-md">
                                    {item.productoCodigoSeleccionado}
                                  </span>
                                  <span
                                    className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border ${
                                      item.nivelCoincidencia >= 85
                                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                        : item.nivelCoincidencia >= 65
                                        ? "bg-amber-50 text-amber-800 border-amber-200"
                                        : "bg-rose-50 text-rose-800 border-rose-200"
                                    }`}
                                  >
                                    {item.nivelCoincidencia}% coincidencia
                                  </span>
                                </div>
                                <p className="font-extrabold text-slate-900 text-xs leading-snug">
                                  {item.productoNombreInventario}
                                </p>
                                <p className="text-[10px] font-semibold text-slate-500">
                                  Pres. Inv:{" "}
                                  <strong className="text-slate-700">
                                    {item.unidadMedidaInventario || "Unidad"}
                                  </strong>{" "}
                                  • {item.razonCoincidencia}
                                </p>
                              </div>
                            ) : (
                              <div className="bg-rose-50 border border-rose-200 rounded-xl p-2.5 text-[11px] font-bold text-rose-800">
                                Sin código vinculado en inventario. Selecciona un producto manualmente.
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                playSound("open");
                                setCodePickerRowId(item.id);
                                setCodePickerSearch(item.nombreDocumento);
                              }}
                              className="w-full py-1.5 px-2.5 rounded-lg border border-teal-300 bg-teal-50/70 hover:bg-teal-100 text-teal-900 text-[11px] font-extrabold transition cursor-pointer flex items-center justify-center gap-1"
                            >
                              <Search className="w-3.5 h-3.5 text-teal-700" />
                              <span>
                                {hasCode
                                  ? "Cambiar / Corregir Código"
                                  : "Seleccionar Código del Inventario"}
                              </span>
                            </button>
                          </td>

                          {/* 4. Cantidad Indicada en el Documento */}
                          <td className="px-3 py-3 align-top text-right">
                            <input
                              type="number"
                              min="0"
                              value={item.cantidadDocumento}
                              onChange={(e) =>
                                handleUpdateComparisonRowField(
                                  item.id,
                                  "cantidadDocumento",
                                  Number(e.target.value)
                                )
                              }
                              className="w-20 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-right font-black text-slate-900 text-xs tabular-nums"
                            />
                            <span className="block text-[10px] font-bold text-slate-400 mt-1">
                              Según Doc.
                            </span>
                          </td>

                          {/* 5. Existencia Actual en el Inventario */}
                          <td className="px-3 py-3 align-top text-right">
                            <div className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 inline-block min-w-[78px]">
                              <span className="text-sm font-black text-slate-900 block tabular-nums">
                                {item.existenciaSistemaActual}
                              </span>
                              <span className="text-[9px] font-extrabold uppercase text-slate-500 block">
                                Sistema
                              </span>
                            </div>
                            <span className="block text-[10px] font-bold text-amber-800 mt-1 tabular-nums">
                              Físico: {item.existenciaFisicaActual}
                            </span>
                          </td>

                          {/* 6. Diferencia entre ambas cantidades */}
                          <td className="px-3 py-3 align-top text-right">
                            <span
                              className={`inline-flex items-center justify-center px-2.5 py-1.5 rounded-xl font-black text-xs tabular-nums border ${
                                !hasCode
                                  ? "bg-slate-100 text-slate-600 border-slate-200"
                                  : diff === 0
                                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                  : diff > 0
                                  ? "bg-blue-50 text-blue-800 border-blue-200"
                                  : "bg-rose-50 text-rose-800 border-rose-200"
                              }`}
                            >
                              {diff > 0 ? `+${diff}` : diff} und.
                            </span>
                            <span className="block text-[10px] font-bold text-slate-500 mt-1">
                              {!hasCode
                                ? "Sin vincular"
                                : diff === 0
                                ? "✓ Coincide"
                                : diff > 0
                                ? "Mayor en Doc."
                                : "Menor en Doc."}
                            </span>
                          </td>

                          {/* 7. Consumo del Producto Seleccionado */}
                          <td className="px-3 py-3 align-top text-right">
                            <div className="bg-indigo-50/60 border border-indigo-200/80 rounded-xl px-2.5 py-1.5 inline-block min-w-[82px]">
                              <span className="text-xs font-black text-indigo-950 block tabular-nums">
                                {item.consumoRegistradoTotal} und.
                              </span>
                              <span className="text-[9px] font-extrabold text-indigo-700 block">
                                {item.consumoMovimientosCount}{" "}
                                {item.consumoMovimientosCount === 1
                                  ? "salida"
                                  : "salidas"}
                              </span>
                            </div>
                          </td>

                          {/* 8. Costos y Fechas de Vencimiento */}
                          <td className="px-3 py-3 align-top space-y-1.5">
                            <div className="grid grid-cols-2 gap-1.5">
                              <div>
                                <span className="text-[9px] font-extrabold uppercase text-slate-400 block">
                                  Costo Doc.
                                </span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  placeholder="N/D"
                                  value={item.costoDocumento ?? ""}
                                  onChange={(e) =>
                                    handleUpdateComparisonRowField(
                                      item.id,
                                      "costoDocumento",
                                      e.target.value
                                        ? Number(e.target.value)
                                        : undefined
                                    )
                                  }
                                  className="w-full rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-800 tabular-nums"
                                />
                              </div>
                              <div>
                                <span className="text-[9px] font-extrabold uppercase text-slate-400 block">
                                  Costo Inv.
                                </span>
                                <span className="block px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-bold text-slate-700 tabular-nums">
                                  {item.costoInventarioActual !== undefined
                                    ? `RD$ ${item.costoInventarioActual.toFixed(2)}`
                                    : "—"}
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-1.5">
                              <div>
                                <span className="text-[9px] font-extrabold uppercase text-slate-400 block">
                                  Vto. Doc.
                                </span>
                                <input
                                  type="date"
                                  value={item.fechaVencimientoDocumento || ""}
                                  onChange={(e) =>
                                    handleUpdateComparisonRowField(
                                      item.id,
                                      "fechaVencimientoDocumento",
                                      e.target.value
                                    )
                                  }
                                  className="w-full rounded-lg border border-slate-200 px-1.5 py-1 text-[10px] font-bold text-slate-800"
                                />
                              </div>
                              <div>
                                <span className="text-[9px] font-extrabold uppercase text-slate-400 block">
                                  Vto. Inv.
                                </span>
                                <span className="block px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[10px] font-bold text-slate-700 tabular-nums">
                                  {item.fechaVencimientoInventarioActual || "—"}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* 9. Acción de Propuesta de Ajuste / Eliminación de Fila */}
                          <td className="px-3 py-3 align-top text-center space-y-1.5">
                            {item.propuestaAjusteId ? (
                              <span className="inline-block text-[10px] font-extrabold bg-indigo-100 text-indigo-900 border border-indigo-300 px-2.5 py-1 rounded-lg">
                                Propuesta {item.propuestaAjusteId}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleOpenCreateProposalModal(item)}
                                className={`w-full px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold transition cursor-pointer flex items-center justify-center gap-1 ${
                                  item.tieneDiscrepancia
                                    ? "bg-amber-600 hover:bg-amber-700 text-white shadow-2xs"
                                    : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                                }`}
                              >
                                <FileEdit className="w-3.5 h-3.5" />
                                <span>Proponer Ajuste</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleRemoveComparisonRow(item.id)}
                              className="text-[10px] font-bold text-slate-400 hover:text-rose-600 transition cursor-pointer inline-flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Quitar fila</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Observaciones Generales y Guardado de Validación Documental */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="flex-1 space-y-1.5">
                  <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700">
                    Observaciones de la Validación Documental (Se registrará con tu usuario, fecha y hora)
                  </label>
                  <input
                    type="text"
                    value={observacionesGeneralesDoc}
                    onChange={(e) => setObservacionesGeneralesDoc(e.target.value)}
                    placeholder="Ej. Comparación de factura de proveedor #4582 contra existencias del almacén..."
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-teal-500/30"
                  />
                </div>

                <button
                  type="button"
                  disabled={savingValidation}
                  onClick={handleSaveDocumentValidation}
                  className="px-6 py-3 rounded-xl bg-teal-700 hover:bg-teal-800 active:scale-95 text-white text-xs font-extrabold uppercase tracking-wider shadow-sm transition cursor-pointer flex items-center justify-center gap-2 shrink-0"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {savingValidation
                      ? "Guardando Validación..."
                      : "Registrar Validación Documental (Sin Alterar Stock)"}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==========================================================================
          PESTAÑA 2: CONTROL DE CAMBIOS Y AUTORIZACIÓN DE INVENTARIO
      ========================================================================== */}
      {activeSubTab === "autorizaciones" && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-slate-900 flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-teal-700" />
                <span>Control de Cambios y Autorización de Ajustes de Inventario</span>
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Revisa cada propuesta de ajuste generada desde la validación documental o la verificación física. Los ajustes rechazados no modifican ningún dato.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: "PENDIENTE_AUTORIZACION", label: "Pendientes" },
                  { id: "APROBADO", label: "Aprobados" },
                  { id: "RECHAZADO", label: "Rechazados" },
                  { id: "TODAS", label: "Todos" }
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPropuestasFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                    propuestasFilter === tab.id
                      ? "bg-teal-700 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {propuestasAjuste.filter((p) =>
            propuestasFilter === "TODAS" ? true : p.estado === propuestasFilter
          ).length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center space-y-2">
              <ShieldCheck className="w-10 h-10 text-slate-400 mx-auto stroke-[1.5]" />
              <p className="text-sm font-extrabold text-slate-700">
                No hay propuestas de ajuste en esta categoría
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Las propuestas de ajuste se generan cuando se detecta una discrepancia durante la validación de un documento o durante una verificación física en el Chat Interno.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {propuestasAjuste
                .filter((p) =>
                  propuestasFilter === "TODAS" ? true : p.estado === propuestasFilter
                )
                .map((prop) => (
                  <div
                    key={prop.id}
                    className={`rounded-2xl border p-4 sm:p-5 space-y-4 shadow-2xs ${
                      prop.estado === "PENDIENTE_AUTORIZACION"
                        ? "bg-amber-50/40 border-amber-300"
                        : prop.estado === "APROBADO"
                        ? "bg-emerald-50/30 border-emerald-200"
                        : "bg-slate-50 border-slate-200"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/70 pb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-black bg-slate-900 text-white px-2.5 py-1 rounded-lg">
                          {prop.codigoPropuesta}
                        </span>
                        <span className="text-[11px] font-extrabold bg-teal-50 text-teal-800 border border-teal-200 px-2.5 py-0.5 rounded-lg">
                          Origen:{" "}
                          {prop.origen === "VALIDACION_DOCUMENTAL"
                            ? `Validación Documental (${prop.origenReferenciaCodigo})`
                            : `Verificación Física Chat (${prop.origenReferenciaCodigo})`}
                        </span>
                        <span
                          className={`text-[11px] font-extrabold uppercase px-2.5 py-0.5 rounded-lg border ${
                            prop.estado === "PENDIENTE_AUTORIZACION"
                              ? "bg-amber-100 text-amber-900 border-amber-300"
                              : prop.estado === "APROBADO"
                              ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                              : "bg-rose-100 text-rose-800 border-rose-300"
                          }`}
                        >
                          {prop.estado === "PENDIENTE_AUTORIZACION"
                            ? "Pendiente de Autorización"
                            : prop.estado === "APROBADO"
                            ? "Aprobado y Aplicado"
                            : "Rechazado (Sin Cambios)"}
                        </span>
                      </div>

                      <span className="text-xs font-bold text-slate-500">
                        Validado por: <strong>{prop.validadoPorNombre}</strong> (
                        {prop.validadoPorDepartamento}) • {prop.fechaValidacion}{" "}
                        {prop.horaValidacion}
                      </span>
                    </div>

                    {/* Comparativa: Valor Actual vs. Valor Propuesto */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
                      {/* Tarjeta Valor Actual */}
                      <div className="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2">
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 block">
                          Valor Actual Registrado
                        </span>
                        <p className="text-xs font-extrabold text-slate-900">
                          {prop.productoNombreActual}{" "}
                          <span className="font-mono text-teal-700">
                            ({prop.productoCodigo})
                          </span>
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                          <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                            <span className="text-[10px] text-slate-500 block font-bold">
                              Stock Sistema
                            </span>
                            <span className="font-black text-slate-900 text-sm tabular-nums">
                              {prop.existenciaSistemaActual} und.
                            </span>
                          </div>
                          <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                            <span className="text-[10px] text-slate-500 block font-bold">
                              Stock Físico
                            </span>
                            <span className="font-black text-slate-900 text-sm tabular-nums">
                              {prop.existenciaFisicaActual} und.
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 pt-1">
                          <span>Costo: RD$ {Number(prop.costoActual || 0).toFixed(2)}</span>
                          <span>Vto: {prop.fechaVencimientoActual || "S/F"}</span>
                        </div>
                      </div>

                      {/* Tarjeta Valor Propuesto */}
                      <div className="bg-white rounded-xl border-2 border-teal-500/80 p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase tracking-wider text-teal-800">
                            Valor Propuesto tras Validación
                          </span>
                          <span className="text-[10px] font-black bg-teal-50 text-teal-800 px-2 py-0.5 rounded-md border border-teal-200 tabular-nums">
                            Dif. Sis:{" "}
                            {prop.diferenciaCantidadSistema > 0
                              ? `+${prop.diferenciaCantidadSistema}`
                              : prop.diferenciaCantidadSistema}
                          </span>
                        </div>
                        <p className="text-xs font-extrabold text-slate-900">
                          {prop.productoNombrePropuesto} •{" "}
                          <span className="text-slate-600">
                            {prop.unidadMedidaPropuesta}
                          </span>
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                          <div className="bg-teal-50/70 p-2 rounded-lg border border-teal-200">
                            <span className="text-[10px] text-teal-800 block font-bold">
                              Stock Sistema Prop.
                            </span>
                            <span className="font-black text-teal-950 text-sm tabular-nums">
                              {prop.existenciaSistemaPropuesta} und.
                            </span>
                          </div>
                          <div className="bg-amber-50/70 p-2 rounded-lg border border-amber-200">
                            <span className="text-[10px] text-amber-800 block font-bold">
                              Stock Físico Prop.
                            </span>
                            <span className="font-black text-amber-950 text-sm tabular-nums">
                              {prop.existenciaFisicaPropuesta} und.
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 pt-1">
                          <span>Costo: RD$ {Number(prop.costoPropuesto || 0).toFixed(2)}</span>
                          <span>Vto: {prop.fechaVencimientoPropuesta || "S/F"}</span>
                        </div>
                      </div>

                      {/* Motivo, Observaciones y Botones de Autorización */}
                      <div className="space-y-3">
                        <div className="bg-white rounded-xl border border-slate-200 p-3 text-xs space-y-1.5">
                          <span className="text-[10px] font-extrabold uppercase text-slate-500 block">
                            Motivo del Cambio y Observaciones
                          </span>
                          <p className="font-bold text-slate-900">{prop.motivoCambio}</p>
                          {prop.observacionesValidacion && (
                            <p className="text-[11px] text-slate-600 font-medium">
                              Obs. Validador: {prop.observacionesValidacion}
                            </p>
                          )}
                        </div>

                        {prop.estado === "PENDIENTE_AUTORIZACION" ? (
                          canAuthorizeAdjustments ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  playSound("open");
                                  setAuthDecisionModal({
                                    propuesta: prop,
                                    decision: "APROBADO"
                                  });
                                  setAuthObservacionesInput(
                                    "Verificado y autorizado para actualización de inventario."
                                  );
                                }}
                                className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold uppercase tracking-wider shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                                <span>Aprobar Ajuste</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  playSound("open");
                                  setAuthDecisionModal({
                                    propuesta: prop,
                                    decision: "RECHAZADO"
                                  });
                                  setAuthObservacionesInput(
                                    "Ajuste rechazado tras revisión de auditoría."
                                  );
                                }}
                                className="py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold uppercase tracking-wider shadow-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                              >
                                <X className="w-4 h-4" />
                                <span>Rechazar</span>
                              </button>
                            </div>
                          ) : (
                            <div className="bg-amber-100/80 border border-amber-300 rounded-xl p-2.5 text-[11px] font-bold text-amber-950 text-center">
                              Pendiente de revisión y aprobación por un Administrador autorizado.
                            </div>
                          )
                        ) : (
                          <div className="bg-white rounded-xl border border-slate-200 p-3 text-[11px] space-y-1">
                            <p className="font-extrabold text-slate-800">
                              {prop.estado === "APROBADO"
                                ? "✓ Autorizado por:"
                                : "✕ Rechazado por:"}{" "}
                              {prop.autorizadoPorNombre} ({prop.rolAutorizador})
                            </p>
                            <p className="text-slate-500 font-semibold">
                              Fecha: {prop.fechaAutorizacion} a las{" "}
                              {prop.horaAutorizacion}
                            </p>
                            {prop.observacionesAutorizacion && (
                              <p className="text-slate-700 font-medium">
                                Obs: {prop.observacionesAutorizacion}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ==========================================================================
          PESTAÑA 3: SOLICITUDES DE VERIFICACIÓN FÍSICA (SUMINISTROS ↔ CHAT INTERNO)
      ========================================================================== */}
      {activeSubTab === "verificaciones" && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-sm sm:text-base font-extrabold text-slate-900 flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-teal-700" />
                <span>Solicitudes de Verificación Física por Departamento</span>
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Bandeja sincronizada con el botón «Validar» de Suministros y el Chat Interno Departamental.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={verificacionesDeptFilter}
                onChange={(e) => setVerificacionesDeptFilter(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-extrabold text-slate-800 outline-none"
              >
                <option value="TODOS">Todos los Departamentos</option>
                <option value="Almacén y Suministros">Almacén y Suministros</option>
                {departamentos
                  .filter((d) => d.activo !== false)
                  .map((d) => (
                    <option key={d.id} value={d.nombre}>
                      {d.nombre}
                    </option>
                  ))}
              </select>

              <select
                value={verificacionesStatusFilter}
                onChange={(e) =>
                  setVerificacionesStatusFilter(e.target.value as any)
                }
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-extrabold text-slate-800 outline-none"
              >
                <option value="TODAS">Todos los Estados</option>
                <option value="PENDIENTE">Pendientes de Verificación</option>
                <option value="CONFIRMADAS">Confirmadas / Validadas</option>
              </select>
            </div>
          </div>

          {solicitudesVerificacion.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center space-y-3">
              <ClipboardCheck className="w-10 h-10 text-slate-400 mx-auto stroke-[1.5]" />
              <p className="text-sm font-extrabold text-slate-700">
                Aún no hay solicitudes de verificación física registradas
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                En el módulo de <strong>Suministros</strong>, haz clic en el botón <strong>«Validar»</strong> de cualquier producto para abrir el Chat Interno con la solicitud redactada hacia Almacén y Suministros.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {solicitudesVerificacion
                .filter((s) => {
                  if (
                    verificacionesDeptFilter !== "TODOS" &&
                    s.departamentoDestino.toLowerCase() !==
                      verificacionesDeptFilter.toLowerCase()
                  ) {
                    return false;
                  }
                  if (verificacionesStatusFilter === "PENDIENTE") {
                    return s.estado === "PENDIENTE";
                  }
                  if (verificacionesStatusFilter === "CONFIRMADAS") {
                    return s.estado !== "PENDIENTE";
                  }
                  return true;
                })
                .map((sol) => (
                  <div
                    key={sol.id}
                    className="rounded-2xl border border-slate-200 hover:border-teal-400 bg-white p-4 shadow-2xs flex flex-col justify-between gap-3 transition"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[10px] font-mono font-black uppercase bg-amber-100 text-amber-950 border border-amber-300 px-2.5 py-0.5 rounded-md">
                          {sol.tipo} • {sol.codigoSolicitud}
                        </span>
                        <span
                          className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-md border ${
                            sol.estado === "PENDIENTE"
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : sol.estado === "CONFIRMADA_COINCIDE"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-rose-50 text-rose-700 border-rose-200"
                          }`}
                        >
                          {sol.estado === "PENDIENTE"
                            ? "Pendiente de Comprobación"
                            : sol.estado === "CONFIRMADA_COINCIDE"
                            ? "Confirmada (Coincide)"
                            : "Confirmada con Diferencia"}
                        </span>
                      </div>

                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-extrabold text-slate-900">
                            {sol.productoNombre}
                          </h4>
                          <span className="text-xs font-mono font-bold text-teal-700">
                            Código: {sol.productoCodigo} • {sol.unidadMedida}
                          </span>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-right shrink-0">
                          <span className="text-[9px] font-extrabold uppercase text-slate-500 block">
                            Existencias
                          </span>
                          <span className="text-xs font-black text-slate-900 tabular-nums">
                            Sis: {sol.existenciaSistemaAlSolicitar} | Fís:{" "}
                            {sol.existenciaFisicaAlSolicitar}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200/70 rounded-xl p-2.5 font-medium leading-relaxed">
                        «{sol.mensajeSolicitud}»
                      </p>
                    </div>

                    <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                      <span className="text-[11px] font-bold text-slate-500">
                        {sol.departamentoOrigen} →{" "}
                        <strong className="text-teal-800">
                          {sol.departamentoDestino}
                        </strong>{" "}
                        ({sol.fechaSolicitud})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          playSound("open");
                          setSelectedSolicitudModal(sol);
                        }}
                        className="px-3.5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-extrabold uppercase tracking-wider transition cursor-pointer shrink-0"
                      >
                        {sol.estado === "PENDIENTE"
                          ? "Confirmar Validación"
                          : "Ver Resultado"}
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ==========================================================================
          PESTAÑA 4: HISTORIAL COMPLETO Y TRAZABILIDAD DE VALIDACIONES Y AJUSTES
      ========================================================================== */}
      {activeSubTab === "historial" && (
        <div className="space-y-6">
          {/* Sub-bloque A: Validaciones Documentales Guardadas */}
          <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
            <h3 className="text-sm sm:text-base font-extrabold text-slate-900 flex items-center gap-2">
              <FileCheck2 className="w-5 h-5 text-teal-700" />
              <span>
                Validaciones Documentales Registradas ({validacionesDocs.length})
              </span>
            </h3>

            {validacionesDocs.length === 0 ? (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center font-medium">
                Aún no se han guardado sesiones de validación documental.
              </p>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="min-w-[820px] w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-extrabold uppercase text-slate-600">
                      <th className="px-4 py-3">Código</th>
                      <th className="px-4 py-3">Documento / Tipo</th>
                      <th className="px-4 py-3">Validador / Departamento</th>
                      <th className="px-4 py-3">Fecha y Hora</th>
                      <th className="px-4 py-3 text-center">Ítems Comparados</th>
                      <th className="px-4 py-3 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {validacionesDocs.map((v) => (
                      <tr key={v.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono font-black text-teal-800">
                          {v.numeroValidacion}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-extrabold text-slate-900">
                            {v.nombreArchivo}
                          </p>
                          <span className="text-[10px] font-bold text-slate-500">
                            {v.tipoDocumento} • {v.metodoExtraccion}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-800">
                            {v.usuarioValidador}
                          </p>
                          <span className="text-[10px] font-semibold text-teal-700">
                            {v.departamentoValidador}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-700 tabular-nums">
                          {v.fecha} • {v.hora}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="font-extrabold text-slate-900">
                            {v.totalItems} total
                          </span>{" "}
                          <span className="text-[10px] text-emerald-700 font-bold">
                            ({v.itemsCoincidentes} ok /{" "}
                            <span className="text-amber-700">
                              {v.itemsConDiscrepancia} dif.
                            </span>
                            )
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              playSound("open");
                              setInspectValidacionDoc(v);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-extrabold transition cursor-pointer inline-flex items-center gap-1"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Ver Detalle</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Sub-bloque B: Bitácora General de Operaciones y Trazabilidad */}
          <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-4">
            <h3 className="text-sm sm:text-base font-extrabold text-slate-900 flex items-center gap-2">
              <History className="w-5 h-5 text-teal-700" />
              <span>
                Bitácora de Auditoría y Trazabilidad de Operaciones (
                {historialOperaciones.length})
              </span>
            </h3>

            {historialOperaciones.length === 0 ? (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center font-medium">
                No hay eventos registrados aún en la bitácora de validación.
              </p>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="min-w-[860px] w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-extrabold uppercase text-slate-600">
                      <th className="px-4 py-3">Fecha y Hora</th>
                      <th className="px-4 py-3">Tipo de Operación</th>
                      <th className="px-4 py-3">Referencia / Producto</th>
                      <th className="px-4 py-3">Descripción y Observaciones</th>
                      <th className="px-4 py-3">Responsable / Depto.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {historialOperaciones.map((ev) => (
                      <tr key={ev.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                          {ev.fecha} {ev.hora}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-md border ${
                              ev.tipoOperacion === "AJUSTE_AUTORIZADO"
                                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                : ev.tipoOperacion === "AJUSTE_RECHAZADO"
                                ? "bg-rose-50 text-rose-800 border-rose-200"
                                : ev.tipoOperacion === "PROPUESTA_AJUSTE_CREADA"
                                ? "bg-amber-50 text-amber-900 border-amber-200"
                                : "bg-teal-50 text-teal-800 border-teal-200"
                            }`}
                          >
                            {ev.tipoOperacion.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono font-black text-slate-900 block">
                            {ev.referenciaCodigo}
                          </span>
                          {ev.productoCodigo && (
                            <span className="text-[11px] font-semibold text-teal-700">
                              {ev.productoNombre} ({ev.productoCodigo})
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 max-w-md">
                          <p className="font-semibold text-slate-800 leading-snug">
                            {ev.descripcion}
                          </p>
                          {ev.detalles && (
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              Obs: {ev.detalles}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-extrabold text-slate-900">
                            {ev.usuarioNombre}
                          </p>
                          <span className="text-[10px] font-bold text-slate-500">
                            {ev.usuarioRol} • {ev.departamento}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==========================================================================
          MODAL 1: SELECTOR MANUAL DE CÓDIGO DE PRODUCTO EN INVENTARIO
      ========================================================================== */}
      {codePickerRowId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setCodePickerRowId(null)}
          />
          <div className="relative w-full max-w-xl max-h-[85dvh] bg-white rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden anim-pop-in">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-sm font-extrabold uppercase tracking-wider">
                  Seleccionar o Corregir Código del Producto en Inventario
                </h3>
                <p className="text-[11px] text-slate-300 font-medium mt-0.5">
                  Busca por código, nombre, principio activo, concentración o presentación
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCodePickerRowId(null)}
                className="p-1.5 rounded-xl hover:bg-white/10 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-slate-200 bg-slate-50">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={codePickerSearch}
                  onChange={(e) => setCodePickerSearch(e.target.value)}
                  placeholder="Buscar producto (ej. Paracetamol 500 mg, A100...)"
                  className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-4 py-2.5 text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <button
                type="button"
                onClick={() =>
                  handleSelectManualProductForRow(codePickerRowId, null)
                }
                className="w-full text-left px-3.5 py-2.5 rounded-xl border border-dashed border-rose-300 bg-rose-50/50 hover:bg-rose-100/70 text-xs font-extrabold text-rose-800 transition cursor-pointer"
              >
                ✕ Dejar sin código vinculado (Producto nuevo / No existe en inventario)
              </button>

              {catalogProducts
                .filter((p) => {
                  const q = codePickerSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    p.codigo.toLowerCase().includes(q) ||
                    p.nombre.toLowerCase().includes(q) ||
                    (p.descripcion || "").toLowerCase().includes(q)
                  );
                })
                .slice(0, 60)
                .map((p) => {
                  const sysStock = p.lotes.reduce(
                    (a, l) => a + Number(l.cantidad || 0),
                    0
                  );
                  const physStock = p.lotes.reduce(
                    (a, l) => a + Number(l.cantidadF ?? l.cantidad ?? 0),
                    0
                  );
                  return (
                    <button
                      key={p.codigo}
                      type="button"
                      onClick={() =>
                        handleSelectManualProductForRow(codePickerRowId, p)
                      }
                      className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-teal-500 hover:bg-teal-50/40 transition cursor-pointer flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-black bg-teal-100 text-teal-900 px-2 py-0.5 rounded-md">
                            {p.codigo}
                          </span>
                          <span className="font-extrabold text-slate-900 text-xs truncate">
                            {p.nombre}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
                          Presentación: {p.descripcion || "Unidad"}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-black text-slate-900 block tabular-nums">
                          Sis: {sysStock} | Fís: {physStock}
                        </span>
                        <span className="text-[10px] font-bold text-teal-700">
                          Seleccionar →
                        </span>
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          MODAL 2: GENERAR PROPUESTA DE AJUSTE CONTROLADO DESDE VALIDACIÓN DOCUMENTAL
      ========================================================================== */}
      {proposalDraftRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setProposalDraftRow(null)}
          />
          <form
            onSubmit={handleConfirmCreateProposal}
            className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden anim-pop-in"
          >
            <div className="px-5 py-4 bg-gradient-to-r from-amber-600 to-amber-700 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileEdit className="w-5 h-5" />
                <div>
                  <h3 className="text-sm font-extrabold uppercase tracking-wider">
                    Generar Propuesta de Ajuste de Inventario
                  </h3>
                  <p className="text-[11px] text-amber-100 font-semibold">
                    Producto: {proposalDraftRow.productoNombreInventario} (
                    {proposalDraftRow.productoCodigoSeleccionado})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProposalDraftRow(null)}
                className="p-1.5 rounded-xl hover:bg-white/10 text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-[11px] font-semibold text-amber-950 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>
                  Esta propuesta <strong>no modificará el inventario de inmediato</strong>. Quedará registrada con tu usuario ({currentUser.nombre}) y pasará a revisión para autorización explícita.
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div>
                  <span className="text-[10px] font-extrabold uppercase text-slate-500 block">
                    Valor Actual en Sistema
                  </span>
                  <span className="text-sm font-black text-slate-900">
                    {proposalDraftRow.existenciaSistemaActual} unidades
                  </span>
                  <span className="block text-[10px] text-slate-500">
                    Físico actual: {proposalDraftRow.existenciaFisicaActual} und.
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase text-teal-700 block">
                    Cantidad en Documento
                  </span>
                  <span className="text-sm font-black text-teal-900">
                    {proposalDraftRow.cantidadDocumento} unidades
                  </span>
                  <span className="block text-[10px] text-teal-700">
                    Diferencia: {proposalDraftRow.diferenciaCantidad > 0 ? `+${proposalDraftRow.diferenciaCantidad}` : proposalDraftRow.diferenciaCantidad} und.
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                    Existencia Sistema Propuesta *
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={propStockSistemaInput}
                    onChange={(e) =>
                      setPropStockSistemaInput(Number(e.target.value))
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 font-black text-slate-900 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                    Existencia Física Propuesta *
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={propStockFisicoInput}
                    onChange={(e) =>
                      setPropStockFisicoInput(Number(e.target.value))
                    }
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 font-black text-slate-900 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                    Costo Unitario Propuesto (RD$)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={propCostoInput}
                    onChange={(e) => setPropCostoInput(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold text-slate-900 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                    Fecha Vencimiento Propuesta
                  </label>
                  <input
                    type="date"
                    value={propFechaVtoInput}
                    onChange={(e) => setPropFechaVtoInput(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 font-bold text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                  Motivo del Cambio *
                </label>
                <input
                  type="text"
                  required
                  value={propMotivoInput}
                  onChange={(e) => setPropMotivoInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 font-semibold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                  Observaciones Adicionales
                </label>
                <textarea
                  rows={2}
                  value={propObservacionesInput}
                  onChange={(e) => setPropObservacionesInput(e.target.value)}
                  placeholder="Observaciones del validador..."
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 font-medium text-slate-800"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setProposalDraftRow(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creatingProposal}
                className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold uppercase tracking-wider shadow-xs cursor-pointer"
              >
                {creatingProposal
                  ? "Generando..."
                  : "Enviar Propuesta a Autorización"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==========================================================================
          MODAL 3: CONFIRMACIÓN EXPLÍCITA PARA APROBAR O RECHAZAR AJUSTE
      ========================================================================== */}
      {authDecisionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setAuthDecisionModal(null)}
          />
          <form
            onSubmit={handleConfirmAuthDecision}
            className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden anim-pop-in p-6 space-y-4"
          >
            <div className="flex items-center gap-3">
              <div
                className={`p-2.5 rounded-2xl ${
                  authDecisionModal.decision === "APROBADO"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-rose-50 text-rose-700"
                }`}
              >
                {authDecisionModal.decision === "APROBADO" ? (
                  <CheckCircle2 className="w-6 h-6" />
                ) : (
                  <ShieldAlert className="w-6 h-6" />
                )}
              </div>
              <div>
                <h3 className="font-black text-slate-900 text-base">
                  {authDecisionModal.decision === "APROBADO"
                    ? "Confirmar y Autorizar Ajuste de Inventario"
                    : "Confirmar Rechazo de Propuesta"}
                </h3>
                <span className="text-xs font-mono font-bold text-slate-500">
                  Propuesta {authDecisionModal.propuesta.codigoPropuesta} •{" "}
                  {authDecisionModal.propuesta.productoCodigo}
                </span>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-xs space-y-1.5">
              <p className="font-extrabold text-slate-900">
                {authDecisionModal.propuesta.productoNombreActual}
              </p>
              <p className="text-slate-600 font-semibold">
                Stock Sistema:{" "}
                <strong>
                  {authDecisionModal.propuesta.existenciaSistemaActual}
                </strong>{" "}
                →{" "}
                <strong className="text-teal-800">
                  {authDecisionModal.propuesta.existenciaSistemaPropuesta}
                </strong>{" "}
                | Físico:{" "}
                <strong>
                  {authDecisionModal.propuesta.existenciaFisicaActual}
                </strong>{" "}
                →{" "}
                <strong className="text-amber-800">
                  {authDecisionModal.propuesta.existenciaFisicaPropuesta}
                </strong>
              </p>
              <p className="text-[11px] text-slate-500">
                Validado por: {authDecisionModal.propuesta.validadoPorNombre} (
                {authDecisionModal.propuesta.fechaValidacion}{" "}
                {authDecisionModal.propuesta.horaValidacion})
              </p>
            </div>

            <p className="text-xs font-semibold text-slate-600 leading-relaxed">
              {authDecisionModal.decision === "APROBADO"
                ? "Al confirmar, se actualizarán las existencias del producto en el inventario y se registrará un movimiento de Ajuste auditable con tu nombre, fecha y hora."
                : "Al rechazar esta propuesta, NO se modificará ningún dato del inventario y quedará constancia del rechazo en el historial."}
            </p>

            <div>
              <label className="block text-[11px] font-extrabold uppercase text-slate-700 mb-1">
                Observaciones de Autorización / Revisión *
              </label>
              <textarea
                rows={2}
                required
                value={authObservacionesInput}
                onChange={(e) => setAuthObservacionesInput(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 outline-none"
              />
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setAuthDecisionModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={processingAuthDecision}
                className={`flex-1 py-2.5 rounded-xl text-white text-xs font-extrabold uppercase tracking-wider shadow-sm cursor-pointer ${
                  authDecisionModal.decision === "APROBADO"
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-rose-600 hover:bg-rose-700"
                }`}
              >
                {processingAuthDecision
                  ? "Procesando..."
                  : authDecisionModal.decision === "APROBADO"
                  ? "Sí, Autorizar Cambio"
                  : "Sí, Rechazar Ajuste"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==========================================================================
          MODAL 4: DETALLE DE VALIDACIÓN DOCUMENTAL GUARDADA
      ========================================================================== */}
      {inspectValidacionDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setInspectValidacionDoc(null)}
          />
          <div className="relative w-full max-w-4xl max-h-[88dvh] bg-white rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden anim-pop-in">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
              <div>
                <span className="text-[10px] font-mono font-black uppercase bg-teal-500/20 text-teal-300 border border-teal-400/30 px-2 py-0.5 rounded-md">
                  {inspectValidacionDoc.numeroValidacion} •{" "}
                  {inspectValidacionDoc.tipoDocumento}
                </span>
                <h3 className="text-sm sm:text-base font-extrabold mt-1">
                  {inspectValidacionDoc.nombreArchivo}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectValidacionDoc(null)}
                className="p-1.5 rounded-xl hover:bg-white/10 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200">
                <div>
                  <span className="text-[10px] font-extrabold uppercase text-slate-500 block">
                    Realizado por
                  </span>
                  <span className="font-extrabold text-slate-900">
                    {inspectValidacionDoc.usuarioValidador} (
                    {inspectValidacionDoc.departamentoValidador})
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase text-slate-500 block">
                    Fecha y Hora
                  </span>
                  <span className="font-extrabold text-slate-900">
                    {inspectValidacionDoc.fecha} • {inspectValidacionDoc.hora}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase text-slate-500 block">
                    Resumen
                  </span>
                  <span className="font-extrabold text-slate-900">
                    {inspectValidacionDoc.totalItems} ítems (
                    {inspectValidacionDoc.itemsCoincidentes} coinciden /{" "}
                    {inspectValidacionDoc.itemsConDiscrepancia} con diferencia)
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                <table className="min-w-[760px] w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-extrabold uppercase text-slate-600">
                      <th className="px-3 py-2.5">Ítem</th>
                      <th className="px-3 py-2.5">Producto en Documento</th>
                      <th className="px-3 py-2.5">Código Vinculado</th>
                      <th className="px-3 py-2.5 text-right">Cant. Doc</th>
                      <th className="px-3 py-2.5 text-right">Stock Inv.</th>
                      <th className="px-3 py-2.5 text-right">Diferencia</th>
                      <th className="px-3 py-2.5 text-right">Consumo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inspectValidacionDoc.items.map((it) => (
                      <tr key={it.id}>
                        <td className="px-3 py-2 font-mono font-bold">
                          {it.numeroItem}
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-bold text-slate-900">
                            {it.nombreDocumento}
                          </p>
                          <span className="text-[10px] text-slate-500">
                            {it.unidadMedidaDocumento}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {it.productoCodigoSeleccionado ? (
                            <span className="font-mono font-bold text-teal-800">
                              {it.productoCodigoSeleccionado} —{" "}
                              {it.productoNombreInventario}
                            </span>
                          ) : (
                            <span className="text-rose-600 font-bold">
                              Sin vincular
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums">
                          {it.cantidadDocumento}
                        </td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums">
                          {it.existenciaSistemaActual}
                        </td>
                        <td className="px-3 py-2 text-right font-black tabular-nums">
                          {it.diferenciaCantidad > 0
                            ? `+${it.diferenciaCantidad}`
                            : it.diferenciaCantidad}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-indigo-800 tabular-nums">
                          {it.consumoRegistradoTotal} und.
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    handleExportValidacion("comparacion", "pdf", inspectValidacionDoc)
                  }
                  className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-extrabold transition cursor-pointer inline-flex items-center gap-1.5"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>Comparación PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleExportValidacion("comparacion", "word", inspectValidacionDoc)
                  }
                  className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold transition cursor-pointer inline-flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Comparación Word</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleExportValidacion("documento", "pdf", inspectValidacionDoc)
                  }
                  className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 text-xs font-extrabold transition cursor-pointer inline-flex items-center gap-1.5"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>Documento PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleExportValidacion("documento", "word", inspectValidacionDoc)
                  }
                  className="px-3 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-xs font-extrabold transition cursor-pointer inline-flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Documento Word</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setInspectValidacionDoc(null)}
                className="px-5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-extrabold text-slate-700 cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE VERIFICACIÓN FÍSICA COMPARTIDO */}
      <ModalVerificacionProducto
        solicitud={selectedSolicitudModal}
        currentUser={currentUser}
        liveProduct={
          selectedSolicitudModal
            ? products.find(
                (p) => p.codigo === selectedSolicitudModal.productoCodigo
              ) || null
            : null
        }
        onClose={() => setSelectedSolicitudModal(null)}
        showToast={showToast}
      />
    </div>
  );
}
