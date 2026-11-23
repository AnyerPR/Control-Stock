import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "@keep-lts/xlsx";
import { doc, onSnapshot, setDoc, writeBatch } from "firebase/firestore";
import { db, tenantCollection, tenantDoc } from "../firebase";
import {
  Producto,
  Usuario,
  Lote,
  Movimiento,
  Catalogo,
  CargaMasivaRecord,
  matchesCatalog
} from "../types";
import {
  normalizeSupplyName,
  normalizeCompactName,
  getInitialPrefix,
  generateNextCodeConsecutive,
  analyzeItemMatch,
  MatchAnalysisResult
} from "../utils/productMatching";
import { extractTableMatrixFromPdf } from "../utils/pdfTableExtractor";
import { playSound } from "../utils/audio";
import {
  FileSpreadsheet,
  FileText,
  Upload,
  AlertCircle,
  CheckCircle,
  X,
  RotateCcw,
  History,
  Search,
  CheckCircle2,
  PlusCircle,
  Layers,
  ArrowRight,
  Sparkles,
  Check,
  AlertTriangle,
  Edit3,
  Undo2,
  Package
} from "lucide-react";

interface CargaMasivaProps {
  products: Producto[];
  currentUser: Usuario | null;
  onImportComplete: (updatedProducts: Producto[]) => void;
  showToast: (message: string) => void;
  activeCatalogId: string;
  catalogos?: Catalogo[];
  onSelectCatalog?: (catalogId: string) => void;
}

export interface DetectedColumnsInfo {
  nameHeader: string;
  descHeader: string;
  lotHeader: string;
  dateHeader: string;
  qtyHeader: string;
  priceHeader: string;
  codeHeader?: string;
}

export interface PreviewItem {
  row: number;
  selected: boolean;
  codigoOriginal?: string;
  nombre: string;
  descripcion: string;
  lote: string;
  fechaVto: string;
  cantidad: number;
  precio: number;
  analysis: MatchAnalysisResult;
}

interface ImportSummary {
  total: number;
  imported: number;
  createdProducts: number;
  updatedProducts: number;
  fileType: "Excel" | "PDF";
  fileName: string;
  detectedColumns?: DetectedColumnsInfo;
  notFound: string[];
  duplicates: string[];
  errors: string[];
  lastCargaRecordId?: string;
}

const CARGAS_STORAGE_KEY = "control_stock_cargas_masivas_v1";

const SPANISH_MONTHS: Record<string, string> = {
  ene: "01",
  enero: "01",
  jan: "01",
  feb: "02",
  febrero: "02",
  mar: "03",
  marzo: "03",
  abr: "04",
  abril: "04",
  apr: "04",
  may: "05",
  mayo: "05",
  jun: "06",
  junio: "06",
  jul: "07",
  julio: "07",
  ago: "08",
  agosto: "08",
  aug: "08",
  sep: "09",
  sept: "09",
  septiembre: "09",
  setiembre: "09",
  oct: "10",
  octubre: "10",
  nov: "11",
  noviembre: "11",
  dic: "12",
  diciembre: "12",
  dec: "12"
};

const UNIT_ONLY_TOKENS = new Set([
  "unidad",
  "unidades",
  "und",
  "unds",
  "caja",
  "cajas",
  "frasco",
  "frascos",
  "ampolla",
  "ampollas",
  "tableta",
  "tabletas",
  "capsula",
  "capsulas",
  "sobre",
  "sobres",
  "rollo",
  "rollos",
  "galon",
  "galones",
  "litro",
  "litros",
  "paquete",
  "paquetes",
  "par",
  "pares",
  "pieza",
  "piezas",
  "tubo",
  "tubos",
  "vial",
  "viales",
  "blister",
  "fundas",
  "funda",
  "kit",
  "set"
]);

export function cleanExcelHeader(raw: any): string {
  return String(raw ?? "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[°ºª#№]/g, "o")
    .replace(/[^a-z0-9]+/g, "");
}

export function classifyExcelHeader(
  rawHeader: any
): "name" | "description" | "unit" | "lot" | "date" | "qty" | "price" | "code" | null {
  const clean = cleanExcelHeader(rawHeader);
  if (!clean) return null;

  // 1. Nombre explícito del producto: Suministro, Nombre, Producto, Artículo
  if (
    [
      "suministro",
      "suministros",
      "nombredelsuministro",
      "nombresuministro",
      "nombre",
      "nombredelproducto",
      "nombreproducto",
      "nombredelarticulo",
      "nombrearticulo",
      "producto",
      "productos",
      "articulo",
      "articulos",
      "medicamento",
      "medicamentos",
      "insumo",
      "insumos"
    ].includes(clean) ||
    clean.startsWith("suministro") ||
    clean.startsWith("nombreprod") ||
    clean.startsWith("nombresum") ||
    clean.startsWith("nombreart")
  ) {
    return "name";
  }

  // 2. Unidad de emisión / presentación: U. de Emisión
  if (
    [
      "udeemision",
      "unidaddeemision",
      "uemision",
      "unidademision",
      "udee",
      "emision",
      "unidaddemedida",
      "umedida",
      "unidadmedida",
      "presentacion",
      "udeentrega",
      "unidaddespacho"
    ].includes(clean) ||
    clean.includes("udeemision") ||
    clean.includes("unidaddeemision") ||
    clean.includes("uemision")
  ) {
    return "unit";
  }

  // 3. Descripción (ojo: puede contener la descripción o el nombre del producto si no hay columna Suministro/Nombre)
  if (
    [
      "descripcion",
      "descripciondelproducto",
      "descripcionproducto",
      "descripciondelsuministro",
      "descripcionsuministro",
      "descripciondelarticulo",
      "descripcionarticulo",
      "detalle",
      "especificacion"
    ].includes(clean) ||
    clean.startsWith("descripcion")
  ) {
    return "description";
  }

  // 4. Lote: N° de lote, Lote, Lote del producto
  if (
    [
      "lote",
      "lotes",
      "nodelote",
      "ndelote",
      "nrodelote",
      "numerodelote",
      "numdelote",
      "numlote",
      "numerolote",
      "nolote",
      "nlote",
      "nrolote",
      "lotedelproducto",
      "loteproducto",
      "lotedelsuministro",
      "lotesuministro",
      "codlote",
      "codigolote",
      "codigodelote"
    ].includes(clean) ||
    clean.includes("delote") ||
    clean.startsWith("lote")
  ) {
    return "lot";
  }

  // 5. Fecha de vencimiento: Fecha Vto, Fecha, Fecha de vencimiento
  if (
    [
      "fechavto",
      "fechadevto",
      "fvto",
      "vto",
      "fecha",
      "fechadevencimiento",
      "fechavencimiento",
      "fechavenc",
      "fechadevenc",
      "fvencimiento",
      "fvenc",
      "vencimiento",
      "vence",
      "fechacaducidad",
      "fechadecaducidad",
      "caducidad",
      "fechaexp",
      "fechaexpiracion",
      "expiracion"
    ].includes(clean) ||
    clean.includes("fechavto") ||
    clean.includes("fechadevto") ||
    clean.includes("vencimiento") ||
    clean.includes("caducidad")
  ) {
    return "date";
  }

  // 6. Cantidad: Cantidad, Cant
  if (
    [
      "cantidad",
      "cant",
      "cantidades",
      "unidades",
      "existencia",
      "existencias",
      "cantidadfisica",
      "cantfisica",
      "cantidadentregada",
      "cantidadrecibida",
      "stock"
    ].includes(clean) ||
    clean === "und" ||
    clean === "uds"
  ) {
    return "qty";
  }

  // 7. Precio / Costo: Costo Unit., Costo Unitario, Precio, Costo
  if (
    [
      "costounit",
      "costounitario",
      "costou",
      "cunit",
      "cunitario",
      "costoporunidad",
      "precio",
      "preciounit",
      "preciounitario",
      "punit",
      "punitario",
      "costo",
      "costos",
      "valor",
      "valorunit",
      "valorunitario"
    ].includes(clean) ||
    clean.startsWith("costounit") ||
    clean.startsWith("preciounit")
  ) {
    return "price";
  }

  // 8. Código (opcional)
  if (
    ["codigo", "cod", "codigoproducto", "codigodelproducto", "codigosuministro", "codigodelsuministro"].includes(
      clean
    )
  ) {
    return "code";
  }

  return null;
}

export function normalizeExcelDate(val: any): string {
  if (val === null || val === undefined || val === "") return "";

  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, "0");
    const d = String(val.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  if (typeof val === "number") {
    const utcDays = Math.floor(val - 25569);
    const date = new Date(utcDays * 86400 * 1000);
    if (!isNaN(date.getTime())) {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, "0");
      const d = String(date.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }

  const cleanStr = String(val).trim();
  if (!cleanStr) return "";

  if (/^\d{5}(\.\d+)?$/.test(cleanStr)) {
    const serial = parseFloat(cleanStr);
    if (serial > 20000 && serial < 90000) {
      const utcDays = Math.floor(serial - 25569);
      const date = new Date(utcDays * 86400 * 1000);
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, "0");
      const d = String(date.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }

  const ddmmyyyy = cleanStr.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (ddmmyyyy) {
    const p1 = parseInt(ddmmyyyy[1], 10);
    const p2 = parseInt(ddmmyyyy[2], 10);
    const y = ddmmyyyy[3];
    const day = p2 > 12 && p1 <= 12 ? p2 : p1;
    const month = p2 > 12 && p1 <= 12 ? p1 : p2;
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const ddmmyy = cleanStr.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/);
  if (ddmmyy) {
    const p1 = parseInt(ddmmyy[1], 10);
    const p2 = parseInt(ddmmyy[2], 10);
    const yy = parseInt(ddmmyy[3], 10);
    const fullYear = yy < 70 ? 2000 + yy : 1900 + yy;
    const day = p2 > 12 && p1 <= 12 ? p2 : p1;
    const month = p2 > 12 && p1 <= 12 ? p1 : p2;
    return `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const yyyymmdd = cleanStr.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if (yyyymmdd) {
    return `${yyyymmdd[1]}-${yyyymmdd[2].padStart(2, "0")}-${yyyymmdd[3].padStart(2, "0")}`;
  }

  const mmyyyy = cleanStr.match(/^(\d{1,2})[\/\-\.](\d{4})$/);
  if (mmyyyy) {
    const m = parseInt(mmyyyy[1], 10);
    const y = parseInt(mmyyyy[2], 10);
    if (m >= 1 && m <= 12) {
      return `${y}-${String(m).padStart(2, "0")}-01`;
    }
  }

  const mmyy = cleanStr.match(/^(\d{1,2})[\/\-\.](\d{2})$/);
  if (mmyy) {
    const m = parseInt(mmyy[1], 10);
    const yy = parseInt(mmyy[2], 10);
    if (m >= 1 && m <= 12) {
      const y = yy < 70 ? 2000 + yy : 1900 + yy;
      return `${y}-${String(m).padStart(2, "0")}-01`;
    }
  }

  const normMonthStr = cleanStr
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const dMonthY = normMonthStr.match(/^(\d{1,2})[\s\/\-\.]+([a-z]+)[\s\/\-\.]+(\d{2,4})$/);
  if (dMonthY && SPANISH_MONTHS[dMonthY[2]]) {
    const d = dMonthY[1].padStart(2, "0");
    const m = SPANISH_MONTHS[dMonthY[2]];
    const rawY = dMonthY[3];
    const y = rawY.length === 2 ? (parseInt(rawY, 10) < 70 ? `20${rawY}` : `19${rawY}`) : rawY;
    return `${y}-${m}-${d}`;
  }

  const monthY = normMonthStr.match(/^([a-z]+)[\s\/\-\.]+(\d{2,4})$/);
  if (monthY && SPANISH_MONTHS[monthY[1]]) {
    const m = SPANISH_MONTHS[monthY[1]];
    const rawY = monthY[2];
    const y = rawY.length === 2 ? (parseInt(rawY, 10) < 70 ? `20${rawY}` : `19${rawY}`) : rawY;
    return `${y}-${m}-01`;
  }

  const parsedDate = new Date(cleanStr);
  if (!isNaN(parsedDate.getTime())) {
    const y = parsedDate.getFullYear();
    const m = String(parsedDate.getMonth() + 1).padStart(2, "0");
    const d = String(parsedDate.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  return cleanStr;
}

export function parseExcelNumber(val: any): number {
  if (val === null || val === undefined || val === "") return NaN;
  if (typeof val === "number") return val;
  let str = String(val).trim();
  if (!str) return NaN;

  str = str.replace(/[^0-9.,\-]/g, "");
  if (!str) return NaN;

  if (str.includes(",") && str.includes(".")) {
    if (str.lastIndexOf(",") > str.lastIndexOf(".")) {
      str = str.replace(/\./g, "").replace(",", ".");
    } else {
      str = str.replace(/,/g, "");
    }
  } else if (str.includes(",")) {
    const parts = str.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      str = str.replace(",", ".");
    } else {
      str = str.replace(/,/g, "");
    }
  }

  const num = Number(str);
  return isNaN(num) ? NaN : num;
}

export default function CargaMasiva({
  products,
  currentUser,
  onImportComplete,
  showToast,
  activeCatalogId,
  catalogos = [],
  onSelectCatalog
}: CargaMasivaProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>("");
  const [selectedFileType, setSelectedFileType] = useState<"Excel" | "PDF">("Excel");
  const [detectedColumns, setDetectedColumns] = useState<DetectedColumnsInfo | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pre-Import Preview & Audit States
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [ignoredCount, setIgnoredCount] = useState<number>(0);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // Filter & Search states inside preview
  const [previewFilter, setPreviewFilter] = useState<
    "todos" | "coincidencias" | "manuales" | "nuevos" | "agrupados"
  >("todos");
  const [previewSearch, setPreviewSearch] = useState<string>("");

  // Modal State for Manual Code Selection / Specific Product Assignment
  const [editingItemRow, setEditingItemRow] = useState<number | null>(null);
  const [assignSearchQuery, setAssignSearchQuery] = useState<string>("");
  const [applyToAllSameName, setApplyToAllSameName] = useState<boolean>(true);
  const [customNewCodeInput, setCustomNewCodeInput] = useState<string>("");

  // Inline Edit Modal for Row Fields (Nombre, Descripción, Lote, Fecha Vto, Cantidad, Costo)
  const [inlineEditRow, setInlineEditRow] = useState<PreviewItem | null>(null);

  // History of Bulk Uploads & Revert Confirmation Modal State
  const [cargasMasivasList, setCargasMasivasList] = useState<CargaMasivaRecord[]>(() => {
    try {
      const saved =
        localStorage.getItem(CARGAS_STORAGE_KEY) || localStorage.getItem("offline_cargas_masivas");
      return saved ? (JSON.parse(saved) as CargaMasivaRecord[]) : [];
    } catch {
      return [];
    }
  });
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [confirmRevertRecord, setConfirmRevertRecord] = useState<CargaMasivaRecord | null>(null);

  // Subscribe to bulk import history stored in configuracion/cargas_masivas_historial
  useEffect(() => {
    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    if (isLocalFileMode) return;

    try {
      const historyDocRef = tenantDoc("configuracion", "cargas_masivas_historial");
      const unsub = onSnapshot(
        historyDocRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (Array.isArray(data?.registros)) {
              const remoteRecords = data.registros as CargaMasivaRecord[];
              setCargasMasivasList((prev) => {
                // Combinar con snapshots locales si existen
                const localMap = new Map<string, CargaMasivaRecord>(prev.map((r) => [r.id, r]));
                const merged = remoteRecords.map((r) => ({
                  ...r,
                  snapshotProductos: r.snapshotProductos || localMap.get(r.id)?.snapshotProductos
                }));
                try {
                  localStorage.setItem(CARGAS_STORAGE_KEY, JSON.stringify(merged));
                } catch {}
                return merged;
              });
            }
          }
        },
        () => {
          // Silently fallback to localStorage if offline
        }
      );
      return () => unsub();
    } catch {
      return;
    }
  }, []);

  const persistCargasHistory = async (updatedList: CargaMasivaRecord[]) => {
    setCargasMasivasList(updatedList);
    try {
      localStorage.setItem(CARGAS_STORAGE_KEY, JSON.stringify(updatedList));
      localStorage.setItem("offline_cargas_masivas", JSON.stringify(updatedList));
    } catch {}

    const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
    if (!isLocalFileMode) {
      try {
        // Guardar en Firestore bajo configuracion/cargas_masivas_historial (autorizado por reglas existentes)
        const compactForFirestore = updatedList.slice(0, 25).map((r) => ({
          id: r.id,
          fecha: r.fecha,
          timestamp: r.timestamp,
          usuario: r.usuario,
          activeCatalogId: r.activeCatalogId,
          totalItems: r.totalItems,
          importedItems: r.importedItems,
          nombreArchivo: r.nombreArchivo || "Carga_Masiva",
          tipoArchivo: r.tipoArchivo || "Excel",
          lotesCreados: r.lotesCreados || [],
          lotesModificados: r.lotesModificados || [],
          descripcionesPrevias: r.descripcionesPrevias || [],
          productosCreados: r.productosCreados || [],
          movimientosCreados: r.movimientosCreados || [],
          revertida: Boolean(r.revertida),
          ...(r.fechaReversion ? { fechaReversion: r.fechaReversion } : {}),
          ...(r.usuarioReversion ? { usuarioReversion: r.usuarioReversion } : {})
        }));
        await setDoc(
          tenantDoc("configuracion", "cargas_masivas_historial"),
          {
            registros: compactForFirestore,
            updatedAt: Date.now()
          },
          { merge: true }
        );
      } catch (err) {
        console.warn("Saved cargas history locally:", err);
      }
    }
  };

  const activeCatalogProducts = useMemo(() => {
    return products.filter((p) => matchesCatalog(p.catalogId, activeCatalogId, catalogos));
  }, [products, activeCatalogId, catalogos]);

  const catalogCargas = useMemo(() => {
    return cargasMasivasList
      .filter((c) => matchesCatalog(c.activeCatalogId, activeCatalogId, catalogos))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }, [cargasMasivasList, activeCatalogId, catalogos]);

  const editingItem = useMemo(() => {
    if (editingItemRow === null || !preview) return null;
    return preview.find((item) => item.row === editingItemRow) || null;
  }, [editingItemRow, preview]);

  const sameNameCount = useMemo(() => {
    if (!editingItem || !preview) return 1;
    const clean = normalizeSupplyName(editingItem.nombre);
    return preview.filter((p) => normalizeSupplyName(p.nombre) === clean).length;
  }, [editingItem, preview]);

  const filteredCatalogForAssign = useMemo(() => {
    if (!assignSearchQuery.trim()) {
      return activeCatalogProducts.slice(0, 50);
    }
    const q = normalizeSupplyName(assignSearchQuery);
    const qRaw = assignSearchQuery.toLowerCase().trim();
    return activeCatalogProducts
      .filter((p) => {
        const nameMatch = normalizeSupplyName(p.nombre).includes(q);
        const codeMatch = p.codigo.toLowerCase().includes(qRaw);
        const descMatch = normalizeSupplyName(p.descripcion).includes(q);
        return nameMatch || codeMatch || descMatch;
      })
      .slice(0, 60);
  }, [activeCatalogProducts, assignSearchQuery]);

  const previewStats = useMemo(() => {
    if (!preview) {
      return { total: 0, selectedCount: 0, coincidencias: 0, manuales: 0, nuevos: 0, agrupados: 0 };
    }
    let selectedCount = 0;
    let coincidencias = 0;
    let manuales = 0;
    let nuevos = 0;
    let agrupados = 0;

    for (const item of preview) {
      if (item.selected) selectedCount++;
      if (item.analysis.isManualOverride || item.analysis.matchType === "manual_assigned") {
        manuales++;
      } else if (item.analysis.matchType === "existing_catalog") {
        coincidencias++;
      } else if (item.analysis.matchType === "same_file_batch") {
        agrupados++;
      } else {
        nuevos++;
      }
    }

    return {
      total: preview.length,
      selectedCount,
      coincidencias,
      manuales,
      nuevos,
      agrupados
    };
  }, [preview]);

  const filteredPreview = useMemo(() => {
    if (!preview) return [];
    return preview.filter((item) => {
      const isManual = item.analysis.isManualOverride || item.analysis.matchType === "manual_assigned";
      if (previewFilter === "coincidencias" && (item.analysis.matchType !== "existing_catalog" || isManual)) {
        return false;
      }
      if (previewFilter === "manuales" && !isManual) {
        return false;
      }
      if (previewFilter === "nuevos" && (item.analysis.matchType !== "new_product" || isManual)) {
        return false;
      }
      if (previewFilter === "agrupados" && (item.analysis.matchType !== "same_file_batch" || isManual)) {
        return false;
      }
      if (previewSearch.trim()) {
        const q = normalizeSupplyName(previewSearch);
        const qRaw = previewSearch.toLowerCase().trim();
        const matchName = normalizeSupplyName(item.nombre).includes(q);
        const matchDesc = normalizeSupplyName(item.descripcion).includes(q);
        const matchLot = item.lote.toLowerCase().includes(qRaw);
        const matchCode = item.analysis.projectedCode.toLowerCase().includes(qRaw);
        const matchCatName = normalizeSupplyName(item.analysis.matchedCatalogName || "").includes(q);
        return matchName || matchDesc || matchLot || matchCode || matchCatName;
      }
      return true;
    });
  }, [preview, previewFilter, previewSearch]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragging(true);
    } else if (e.type === "dragleave") {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  /**
   * Analiza una matriz 2D (extraída tanto de Excel como de PDF) bajo los mismos criterios de columnas
   * y genera la Vista Previa interactiva sin importar todavía a la base de datos.
   */
  const buildPreviewFromMatrix = (
    selectedMatrix: any[][],
    headerRowIdx: number,
    fileName: string,
    fileType: "Excel" | "PDF"
  ) => {
    if (selectedMatrix.length === 0 || selectedMatrix.length <= headerRowIdx + 1) {
      setSummary({
        total: 0,
        imported: 0,
        createdProducts: 0,
        updatedProducts: 0,
        fileType,
        fileName,
        notFound: [],
        duplicates: [],
        errors: [
          `El archivo ${fileType} está vacío o no se detectaron filas de suministros debajo de los encabezados.`
        ]
      });
      setLoading(false);
      playSound("negative");
      return;
    }

    const headerRow = selectedMatrix[headerRowIdx] || [];
    let nameColIdx = -1;
    let descColIdx = -1;
    let unitColIdx = -1;
    let lotColIdx = -1;
    let dateColIdx = -1;
    let qtyColIdx = -1;
    let priceColIdx = -1;
    let codeColIdx = -1;

    headerRow.forEach((cellValue, colIdx) => {
      const cat = classifyExcelHeader(cellValue);
      if (cat === "name" && nameColIdx === -1) nameColIdx = colIdx;
      else if (cat === "description" && descColIdx === -1) descColIdx = colIdx;
      else if (cat === "unit" && unitColIdx === -1) unitColIdx = colIdx;
      else if (cat === "lot" && lotColIdx === -1) lotColIdx = colIdx;
      else if (cat === "date" && dateColIdx === -1) dateColIdx = colIdx;
      else if (cat === "qty" && qtyColIdx === -1) qtyColIdx = colIdx;
      else if (cat === "price" && priceColIdx === -1) priceColIdx = colIdx;
      else if (cat === "code" && codeColIdx === -1) codeColIdx = colIdx;
    });

    // REGLA CRÍTICA: Verificar si el nombre del producto está bajo la columna llamada "Descripción"
    let useDescriptionAsProductName = false;
    if (nameColIdx === -1 && descColIdx !== -1) {
      useDescriptionAsProductName = true;
    } else if (nameColIdx !== -1 && descColIdx !== -1) {
      let nameEmptyOrUnitCount = 0;
      let descLooksLikeNameCount = 0;
      let sampled = 0;
      for (let r = headerRowIdx + 1; r < selectedMatrix.length && sampled < 10; r++) {
        const row = selectedMatrix[r] || [];
        const rawName = String(row[nameColIdx] ?? "").trim();
        const rawDesc = String(row[descColIdx] ?? "").trim();
        if (!rawName && !rawDesc) continue;
        sampled++;
        const normName = normalizeSupplyName(rawName);
        if (!rawName || UNIT_ONLY_TOKENS.has(normName) || /^\d+$/.test(rawName)) {
          nameEmptyOrUnitCount++;
        }
        if (rawDesc && !UNIT_ONLY_TOKENS.has(normalizeSupplyName(rawDesc)) && rawDesc.length > 2) {
          descLooksLikeNameCount++;
        }
      }
      if (sampled > 0 && nameEmptyOrUnitCount === sampled && descLooksLikeNameCount > 0) {
        useDescriptionAsProductName = true;
      }
    }

    const effectiveNameColIdx = useDescriptionAsProductName ? descColIdx : nameColIdx;
    const effectiveDescColIdx = useDescriptionAsProductName
      ? unitColIdx
      : unitColIdx !== -1
      ? unitColIdx
      : descColIdx;

    const detectedCols: DetectedColumnsInfo = {
      nameHeader:
        effectiveNameColIdx !== -1
          ? `${String(headerRow[effectiveNameColIdx]).trim()}${
              useDescriptionAsProductName ? " (Nombre detectado en Descripción)" : ""
            }`
          : "No detectada",
      descHeader:
        effectiveDescColIdx !== -1
          ? !useDescriptionAsProductName && unitColIdx !== -1 && descColIdx !== -1
            ? `${String(headerRow[unitColIdx]).trim()} / ${String(headerRow[descColIdx]).trim()}`
            : String(headerRow[effectiveDescColIdx]).trim()
          : "No detectada",
      lotHeader: lotColIdx !== -1 ? String(headerRow[lotColIdx]).trim() : "No detectada",
      dateHeader: dateColIdx !== -1 ? String(headerRow[dateColIdx]).trim() : "No detectada",
      qtyHeader: qtyColIdx !== -1 ? String(headerRow[qtyColIdx]).trim() : "No detectada",
      priceHeader: priceColIdx !== -1 ? String(headerRow[priceColIdx]).trim() : "No detectada",
      ...(codeColIdx !== -1 ? { codeHeader: String(headerRow[codeColIdx]).trim() } : {})
    };

    setDetectedColumns(detectedCols);

    const catalogProducts = activeCatalogProducts.map((p) => ({
      ...p,
      catalogId: activeCatalogId
    }));
    const simulatedWorkingProducts: Producto[] = JSON.parse(JSON.stringify(catalogProducts));
    const catalogByCode = new Map<string, Producto>();
    catalogProducts.forEach((p) => catalogByCode.set(p.codigo.trim().toLowerCase(), p));

    const previewItems: PreviewItem[] = [];
    const rowErrors: string[] = [];
    let emptyOrIgnored = 0;

    for (let r = headerRowIdx + 1; r < selectedMatrix.length; r++) {
      const row = selectedMatrix[r] || [];
      const rowNum = r + 1;

      const hasAnyValue = row.some((cell) => String(cell ?? "").trim() !== "");
      if (!hasAnyValue) {
        emptyOrIgnored++;
        continue;
      }

      const rawNameCell =
        effectiveNameColIdx !== -1 ? String(row[effectiveNameColIdx] ?? "").trim() : "";
      const rawFallbackDescCell =
        !useDescriptionAsProductName && descColIdx !== -1 ? String(row[descColIdx] ?? "").trim() : "";
      const rawUnitCell = unitColIdx !== -1 ? String(row[unitColIdx] ?? "").trim() : "";
      const rawCodeCell = codeColIdx !== -1 ? String(row[codeColIdx] ?? "").trim() : "";

      let supplyName = rawNameCell;
      let supplyDesc = "";

      if (!supplyName && rawFallbackDescCell) {
        supplyName = rawFallbackDescCell;
        supplyDesc = rawUnitCell;
      } else {
        const descParts: string[] = [];
        if (
          rawFallbackDescCell &&
          normalizeSupplyName(rawFallbackDescCell) !== normalizeSupplyName(supplyName)
        ) {
          descParts.push(rawFallbackDescCell);
        }
        if (
          rawUnitCell &&
          normalizeSupplyName(rawUnitCell) !== normalizeSupplyName(supplyName) &&
          normalizeSupplyName(rawUnitCell) !== normalizeSupplyName(rawFallbackDescCell)
        ) {
          descParts.push(rawUnitCell);
        }
        supplyDesc = descParts.join(" — ");
      }

      const lotNum = lotColIdx !== -1 ? String(row[lotColIdx] ?? "").trim() : "";
      const expDateRaw = dateColIdx !== -1 ? normalizeExcelDate(row[dateColIdx]) : "";
      const qty = qtyColIdx !== -1 ? parseExcelNumber(row[qtyColIdx]) : NaN;
      const rawPriceVal = priceColIdx !== -1 ? row[priceColIdx] : 0;
      const parsedPrice =
        rawPriceVal === "" || rawPriceVal === null || rawPriceVal === undefined
          ? 0
          : parseExcelNumber(rawPriceVal);
      const priceVal = isNaN(parsedPrice) ? 0 : parsedPrice;

      // Omitir filas de totales o subtítulos vacíos
      const normSupplyName = normalizeSupplyName(supplyName);
      if (
        (normSupplyName === "total" ||
          normSupplyName === "subtotal" ||
          normSupplyName === "totales" ||
          (!supplyName && !lotNum && !expDateRaw)) &&
        !lotNum
      ) {
        emptyOrIgnored++;
        continue;
      }

      if (!supplyName && !rawCodeCell) {
        rowErrors.push(`Fila ${rowNum}: Nombre del suministro no especificado.`);
        continue;
      }

      if (!lotNum) {
        rowErrors.push(`Fila ${rowNum}: "${supplyName || rawCodeCell}" — Número de lote vacío.`);
        continue;
      }

      if (isNaN(qty) || qty <= 0) {
        rowErrors.push(
          `Fila ${rowNum}: "${supplyName || rawCodeCell}" — Cantidad inválida o menor a 1 (${
            qtyColIdx !== -1 ? row[qtyColIdx] : "columna Cantidad no encontrada"
          }).`
        );
        continue;
      }

      if (priceVal < 0) {
        rowErrors.push(`Fila ${rowNum}: "${supplyName || rawCodeCell}" — Costo/Precio inválido (${priceVal}).`);
        continue;
      }

      const expiration = new Date(expDateRaw + "T00:00:00");
      if (!expDateRaw || isNaN(expiration.getTime())) {
        rowErrors.push(
          `Fila ${rowNum}: "${supplyName || rawCodeCell}" — Fecha de vencimiento vacía o inválida (${
            dateColIdx !== -1 ? String(row[dateColIdx] ?? "") : "columna Fecha Vto no encontrada"
          }).`
        );
        continue;
      }

      // Analizar coincidencia contra el catálogo activo (por nombre o por código si viene en el archivo)
      let analysis: MatchAnalysisResult;
      const directCodeProd = rawCodeCell ? catalogByCode.get(rawCodeCell.trim().toLowerCase()) : undefined;

      if (directCodeProd) {
        analysis = {
          matchType: "existing_catalog",
          matchedProduct: directCodeProd,
          matchedCatalogName: directCodeProd.nombre,
          matchedCatalogCode: directCodeProd.codigo,
          projectedCode: directCodeProd.codigo,
          prefix: getInitialPrefix(directCodeProd.nombre),
          confidence: "exact",
          reason: `Coincide por código "${directCodeProd.codigo}" con "${directCodeProd.nombre}" en el catálogo.`
        };
      } else {
        analysis = analyzeItemMatch(
          supplyName || rawCodeCell,
          supplyDesc,
          catalogProducts,
          simulatedWorkingProducts,
          activeCatalogId
        );
      }

      if (analysis.matchType === "new_product") {
        const dummyNewProd: Producto = {
          codigo: analysis.projectedCode,
          nombre: supplyName || analysis.projectedCode,
          descripcion: supplyDesc,
          lotes: [],
          updatedAt: Date.now(),
          catalogId: activeCatalogId
        };
        simulatedWorkingProducts.push(dummyNewProd);
      }

      previewItems.push({
        row: rowNum,
        selected: true,
        codigoOriginal: rawCodeCell || undefined,
        nombre: supplyName || rawCodeCell,
        descripcion: supplyDesc,
        lote: lotNum,
        fechaVto: expDateRaw,
        cantidad: qty,
        precio: priceVal,
        analysis
      });
    }

    if (previewItems.length === 0) {
      setSummary({
        total: selectedMatrix.length - (headerRowIdx + 1),
        imported: 0,
        createdProducts: 0,
        updatedProducts: 0,
        fileType,
        fileName,
        detectedColumns: detectedCols,
        notFound: [],
        duplicates: [],
        errors:
          rowErrors.length > 0
            ? rowErrors
            : [
                `No se encontraron filas válidas en el archivo ${fileType}. Verifica que las columnas Suministro/Descripción, Lote, Fecha Vto y Cantidad contengan datos.`
              ]
      });
      setLoading(false);
      playSound("negative");
      return;
    }

    setPreview(previewItems);
    setPreviewErrors(rowErrors);
    setIgnoredCount(emptyOrIgnored);
    setLoading(false);
    playSound("positive");
    showToast(
      `Vista previa lista (${previewItems.length} renglones detectados en ${fileType}). Revisa y confirma para procesar.`
    );
  };

  const processFile = (file: File) => {
    const isPdf =
      file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
    const fileType: "Excel" | "PDF" = isPdf ? "PDF" : "Excel";

    setSelectedFileName(file.name);
    setSelectedFileType(fileType);
    setLoading(true);
    setSummary(null);
    setPreview(null);
    setPreviewFilter("todos");
    setPreviewSearch("");
    setEditingItemRow(null);
    playSound("open");

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;

        if (isPdf) {
          // Procesar archivo PDF bajo los mismos criterios de encabezados y columnas que Excel
          const { matrix } = await extractTableMatrixFromPdf(arrayBuffer, classifyExcelHeader);
          let headerRowIdx = 0;
          let bestScore = -1;
          const maxScanRows = Math.min(matrix.length, 35);

          for (let r = 0; r < maxScanRows; r++) {
            const rowCells = matrix[r] || [];
            let score = 0;
            const foundCategories = new Set<string>();
            for (let c = 0; c < rowCells.length; c++) {
              const cat = classifyExcelHeader(rowCells[c]);
              if (cat) {
                foundCategories.add(cat);
                score += cat === "name" || cat === "description" || cat === "lot" || cat === "qty" ? 2 : 1;
              }
            }
            if (foundCategories.size >= 2 && score > bestScore) {
              bestScore = score;
              headerRowIdx = r;
            }
          }

          buildPreviewFromMatrix(matrix, headerRowIdx, file.name, "PDF");
          return;
        }

        // Procesar archivo Excel (.xlsx / .xls)
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, { type: "array", cellDates: true });

        let selectedMatrix: any[][] = [];
        let headerRowIdx = 0;
        let bestScore = -1;

        for (const sheetName of workbook.SheetNames) {
          const ws = workbook.Sheets[sheetName];
          const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
          if (!matrix || matrix.length === 0) continue;

          const maxScanRows = Math.min(matrix.length, 35);
          for (let r = 0; r < maxScanRows; r++) {
            const rowCells = matrix[r] || [];
            let score = 0;
            const foundCategories = new Set<string>();
            for (let c = 0; c < rowCells.length; c++) {
              const cat = classifyExcelHeader(rowCells[c]);
              if (cat) {
                foundCategories.add(cat);
                score += cat === "name" || cat === "description" || cat === "lot" || cat === "qty" ? 2 : 1;
              }
            }
            if (foundCategories.size >= 2 && score > bestScore) {
              bestScore = score;
              selectedMatrix = matrix;
              headerRowIdx = r;
            }
          }
        }

        if (selectedMatrix.length === 0) {
          for (const sheetName of workbook.SheetNames) {
            const ws = workbook.Sheets[sheetName];
            const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
            if (matrix && matrix.length > 0) {
              selectedMatrix = matrix;
              headerRowIdx = 0;
              break;
            }
          }
        }

        buildPreviewFromMatrix(selectedMatrix, headerRowIdx, file.name, "Excel");
      } catch (err) {
        console.error(`Error processing ${fileType} file:`, err);
        setSummary({
          total: 0,
          imported: 0,
          createdProducts: 0,
          updatedProducts: 0,
          fileType,
          fileName: file.name,
          notFound: [],
          duplicates: [],
          errors: [`Error al analizar el archivo ${fileType}: ${err instanceof Error ? err.message : String(err)}`]
        });
        setLoading(false);
        playSound("negative");
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const handleCancelPreview = () => {
    setPreview(null);
    setPreviewErrors([]);
    setIgnoredCount(0);
    setEditingItemRow(null);
    setInlineEditRow(null);
    playSound("click");
  };

  const toggleSelectRow = (rowNum: number) => {
    setPreview((prev) => {
      if (!prev) return prev;
      return prev.map((it) => (it.row === rowNum ? { ...it, selected: !it.selected } : it));
    });
    playSound("click");
  };

  const toggleSelectAllFiltered = () => {
    if (!preview) return;
    const filteredRowsSet = new Set(filteredPreview.map((it) => it.row));
    const allFilteredSelected = filteredPreview.every((it) => it.selected);
    setPreview((prev) => {
      if (!prev) return prev;
      return prev.map((it) =>
        filteredRowsSet.has(it.row) ? { ...it, selected: !allFilteredSelected } : it
      );
    });
    playSound("click");
  };

  const handleAssignToExistingProduct = (targetProd: Producto) => {
    if (!editingItem || !preview) return;
    const targetRow = editingItem.row;
    const cleanTargetName = normalizeSupplyName(editingItem.nombre);

    setPreview((prev) => {
      if (!prev) return prev;
      return prev.map((it) => {
        const matchesRow = it.row === targetRow;
        const matchesSameName =
          applyToAllSameName && normalizeSupplyName(it.nombre) === cleanTargetName;

        if (matchesRow || matchesSameName) {
          const newAnalysis: MatchAnalysisResult = {
            matchType: "manual_assigned",
            matchedProduct: targetProd,
            matchedCatalogName: targetProd.nombre,
            matchedCatalogCode: targetProd.codigo,
            projectedCode: targetProd.codigo,
            prefix: getInitialPrefix(targetProd.nombre),
            confidence: "manual",
            isManualOverride: true,
            reason: `Código seleccionado manualmente: [${targetProd.codigo}] "${targetProd.nombre}".`
          };
          return {
            ...it,
            analysis: newAnalysis
          };
        }
        return it;
      });
    });

    setEditingItemRow(null);
    setAssignSearchQuery("");
    setCustomNewCodeInput("");
    showToast(`Código asignado: [${targetProd.codigo}] ${targetProd.nombre}`);
    playSound("click");
  };

  const handleAssignAsNewProduct = (customCode?: string) => {
    if (!editingItem || !preview) return;
    const targetRow = editingItem.row;
    const cleanTargetName = normalizeSupplyName(editingItem.nombre);
    const prefix = getInitialPrefix(editingItem.nombre);
    const cleanCustom = (customCode || "").trim().toUpperCase();
    const projectedCode =
      cleanCustom || generateNextCodeConsecutive(activeCatalogId, prefix, activeCatalogProducts);

    setPreview((prev) => {
      if (!prev) return prev;
      return prev.map((it) => {
        const matchesRow = it.row === targetRow;
        const matchesSameName =
          applyToAllSameName && normalizeSupplyName(it.nombre) === cleanTargetName;

        if (matchesRow || matchesSameName) {
          const newAnalysis: MatchAnalysisResult = {
            matchType: "new_product",
            matchedProduct: null,
            projectedCode,
            prefix,
            confidence: "manual",
            isManualOverride: true,
            reason: cleanCustom
              ? `Código nuevo personalizado asignado manualmente: ${projectedCode}.`
              : `Configurado manualmente como Nuevo Producto con código ${projectedCode}.`
          };
          return {
            ...it,
            analysis: newAnalysis
          };
        }
        return it;
      });
    });

    setEditingItemRow(null);
    setAssignSearchQuery("");
    setCustomNewCodeInput("");
    showToast(`Se creará como Nuevo Producto con código: ${projectedCode}`);
    playSound("click");
  };

  const handleResetToAuto = () => {
    if (!editingItem || !preview) return;
    const targetRow = editingItem.row;
    const cleanTargetName = normalizeSupplyName(editingItem.nombre);
    const catalogProducts = activeCatalogProducts.map((p) => ({
      ...p,
      catalogId: activeCatalogId
    }));

    setPreview((prev) => {
      if (!prev) return prev;
      return prev.map((it) => {
        const matchesRow = it.row === targetRow;
        const matchesSameName =
          applyToAllSameName && normalizeSupplyName(it.nombre) === cleanTargetName;

        if (matchesRow || matchesSameName) {
          const freshAnalysis = analyzeItemMatch(
            it.nombre,
            it.descripcion,
            catalogProducts,
            catalogProducts,
            activeCatalogId
          );
          return {
            ...it,
            analysis: freshAnalysis
          };
        }
        return it;
      });
    });

    setEditingItemRow(null);
    setAssignSearchQuery("");
    setCustomNewCodeInput("");
    showToast("Restablecido a detección automática.");
    playSound("click");
  };

  const handleSaveInlineEdit = () => {
    if (!inlineEditRow || !preview) return;
    setPreview((prev) => {
      if (!prev) return prev;
      return prev.map((it) => (it.row === inlineEditRow.row ? { ...inlineEditRow } : it));
    });
    setInlineEditRow(null);
    showToast(`Fila #${inlineEditRow.row} actualizada en la vista previa.`);
    playSound("click");
  };

  /**
   * Procesa y guarda únicamente los ítems confirmados por el usuario,
   * generando un registro completo de reversión (CargaMasivaRecord).
   */
  const handleConfirmImport = async () => {
    if (!preview) return;
    const selectedItems = preview.filter((it) => it.selected);
    if (selectedItems.length === 0) {
      showToast("Selecciona al menos una fila en la vista previa para procesar la importación.");
      playSound("negative");
      return;
    }

    setImporting(true);
    setProgress({ done: 0, total: selectedItems.length });
    playSound("click");

    try {
      const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
      const usuarioStr = currentUser
        ? `${currentUser.nombre} (${currentUser.usuario})`
        : "Carga Masiva";

      // Snapshot previo de los productos para reversión exacta
      const snapshotBeforeCarga: Producto[] = JSON.parse(JSON.stringify(products));
      const workingProducts: Producto[] = JSON.parse(JSON.stringify(products));
      const productosToSaveMap = new Map<string, Producto>();

      const lotesCreados: Array<{
        productoCodigo: string;
        loteId: string;
        numeroLote?: string;
        cantidad: number;
      }> = [];
      const lotesModificados: Array<{
        productoCodigo: string;
        loteId: string;
        numeroLote?: string;
        cantidadAgregada: number;
        cantidadPrevia?: number;
      }> = [];
      const descripcionesPrevias: Array<{ productoCodigo: string; descripcionPrevia: string }> = [];
      const descripcionesRecordedSet = new Set<string>();
      const productosCreados: string[] = [];
      const updatedExistingCodes = new Set<string>();
      const movimientosToSave: Movimiento[] = [];
      const movimientosCreados: string[] = [];

      for (let i = 0; i < selectedItems.length; i++) {
        const item = selectedItems[i];
        const targetCode = (
          item.analysis.matchedProduct?.codigo ||
          item.analysis.projectedCode ||
          ""
        ).trim();
        const itemNombre = item.nombre.trim();
        const itemDesc = (item.descripcion || "").trim();
        const loteNum = item.lote.trim();
        const itemFechaVto = item.fechaVto.trim();
        const itemQty = Number(item.cantidad) || 0;
        const itemPrice = Number(item.precio) || 0;

        // Buscar si el producto ya existe en workingProducts
        const existingProd = workingProducts.find(
          (p) =>
            p.codigo.trim().toLowerCase() === targetCode.toLowerCase() &&
            matchesCatalog(p.catalogId, activeCatalogId, catalogos)
        );

        if (existingProd) {
          const wasOriginallyInCatalog = snapshotBeforeCarga.some(
            (sp) => sp.codigo.trim().toLowerCase() === existingProd.codigo.trim().toLowerCase()
          );
          if (wasOriginallyInCatalog) {
            updatedExistingCodes.add(existingProd.codigo);
          }

          // Si no tenía descripción y el archivo trae U. de Emisión / Descripción, actualizarla y guardar respaldo
          if (itemDesc && (!existingProd.descripcion || existingProd.descripcion.trim() === "")) {
            if (!descripcionesRecordedSet.has(existingProd.codigo)) {
              descripcionesPrevias.push({
                productoCodigo: existingProd.codigo,
                descripcionPrevia: existingProd.descripcion || ""
              });
              descripcionesRecordedSet.add(existingProd.codigo);
            }
            existingProd.descripcion = itemDesc;
          }

          // Verificar si el número de lote ya existe en este producto
          const existingLot = (existingProd.lotes || []).find(
            (l) => l.numeroLote.trim().toLowerCase() === loteNum.toLowerCase()
          );

          if (existingLot) {
            const prevQty = Number(existingLot.cantidad) || 0;
            existingLot.cantidad = prevQty + itemQty;
            existingLot.cantidadF =
              existingLot.cantidadF !== undefined
                ? (Number(existingLot.cantidadF) || 0) + itemQty
                : existingLot.cantidad;
            if (itemPrice > 0) existingLot.precio = itemPrice;
            if (itemFechaVto) {
              existingLot.fechaVencimiento = itemFechaVto;
              existingLot.fechaFisica = itemFechaVto;
            }
            lotesModificados.push({
              productoCodigo: existingProd.codigo,
              loteId: existingLot.id,
              numeroLote: existingLot.numeroLote,
              cantidadAgregada: itemQty,
              cantidadPrevia: prevQty
            });
          } else {
            const loteId = `lote-${existingProd.codigo}-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 6)}`;
            const newLot: Lote = {
              id: loteId,
              numeroLote: loteNum,
              cantidad: itemQty,
              cantidadF: itemQty,
              fechaVencimiento: itemFechaVto,
              precio: itemPrice,
              loteFisico: loteNum,
              fechaFisica: itemFechaVto
            };
            existingProd.lotes = [...(existingProd.lotes || []), newLot];
            lotesCreados.push({
              productoCodigo: existingProd.codigo,
              loteId,
              numeroLote: loteNum,
              cantidad: itemQty
            });
          }

          existingProd.updatedAt = Date.now();
          existingProd.verificado = false;
          productosToSaveMap.set(existingProd.codigo, existingProd);
        } else {
          // Crear Producto Nuevo con el código asignado o proyectado
          const finalNewCode =
            targetCode ||
            generateNextCodeConsecutive(
              activeCatalogId,
              getInitialPrefix(itemNombre || "S"),
              workingProducts
            );
          const loteId = `lote-${finalNewCode}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 6)}`;
          const newLot: Lote = {
            id: loteId,
            numeroLote: loteNum,
            cantidad: itemQty,
            cantidadF: itemQty,
            fechaVencimiento: itemFechaVto,
            precio: itemPrice,
            loteFisico: loteNum,
            fechaFisica: itemFechaVto
          };

          const newProd: Producto = {
            codigo: finalNewCode,
            nombre: itemNombre || finalNewCode,
            descripcion: itemDesc,
            lotes: [newLot],
            updatedAt: Date.now(),
            catalogId: activeCatalogId,
            verificado: false
          };

          workingProducts.push(newProd);
          productosToSaveMap.set(finalNewCode, newProd);
          if (!productosCreados.includes(finalNewCode)) {
            productosCreados.push(finalNewCode);
          }
          lotesCreados.push({
            productoCodigo: finalNewCode,
            loteId,
            numeroLote: loteNum,
            cantidad: itemQty
          });
        }

        const effectiveCode = existingProd ? existingProd.codigo : targetCode;
        const effectiveProdName = existingProd ? existingProd.nombre : itemNombre;
        const movId = `mov-${effectiveCode}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const movRecord: Movimiento = {
          id: movId,
          productoCodigo: effectiveCode,
          productoNombre: effectiveProdName,
          descripcion: itemDesc,
          lote: loteNum,
          loteFisico: loteNum,
          cantidad: itemQty,
          cantidadF: itemQty,
          fechaVencimiento: itemFechaVto,
          fechaFisica: itemFechaVto,
          precio: itemPrice,
          tipoMovimiento: "Entrada",
          usuario: usuarioStr,
          fecha: new Date().toISOString(),
          timestamp: Date.now(),
          catalogId: activeCatalogId
        };

        movimientosToSave.push(movRecord);
        movimientosCreados.push(movId);
        setProgress({ done: i + 1, total: selectedItems.length });
      }

      const cargaRecord: CargaMasivaRecord = {
        id: `cm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fecha: new Date().toLocaleString("es-ES"),
        timestamp: Date.now(),
        usuario: usuarioStr,
        activeCatalogId,
        totalItems: preview.length,
        importedItems: selectedItems.length,
        nombreArchivo: selectedFileName || `Carga_Masiva.${selectedFileType === "PDF" ? "pdf" : "xlsx"}`,
        tipoArchivo: selectedFileType,
        lotesCreados,
        lotesModificados,
        descripcionesPrevias,
        productosCreados,
        movimientosCreados,
        snapshotProductos: snapshotBeforeCarga,
        revertida: false
      };

      if (isLocalFileMode) {
        localStorage.setItem("offline_productos", JSON.stringify(workingProducts));
        window.dispatchEvent(new Event("offline_productos_update"));

        const storedMovs = localStorage.getItem("offline_movimientos");
        const existingMovs = storedMovs ? (JSON.parse(storedMovs) as Movimiento[]) : [];
        localStorage.setItem(
          "offline_movimientos",
          JSON.stringify([...movimientosToSave, ...existingMovs])
        );
        window.dispatchEvent(new Event("offline_movimientos_update"));
      } else {
        const allOps: Array<{ type: "prod" | "mov"; id: string; data: any }> = [];
        for (const [code, updatedProd] of productosToSaveMap.entries()) {
          allOps.push({
            type: "prod",
            id: code.replace(/\//g, "_"),
            data: { ...updatedProd, verificado: false }
          });
        }
        for (const mov of movimientosToSave) {
          allOps.push({
            type: "mov",
            id: mov.id,
            data: mov
          });
        }

        const productsCol = tenantCollection("productos");
        const movementsCol = tenantCollection("movimientos");

        for (let idx = 0; idx < allOps.length; idx += 400) {
          const chunk = allOps.slice(idx, idx + 400);
          const batch = writeBatch(db);
          for (const op of chunk) {
            if (op.type === "prod") {
              batch.set(doc(productsCol, op.id), op.data);
            } else {
              batch.set(doc(movementsCol, op.id), op.data);
            }
          }
          await batch.commit();
        }
      }

      const updatedCargasList = [cargaRecord, ...cargasMasivasList];
      await persistCargasHistory(updatedCargasList);

      onImportComplete(workingProducts);
      setSummary({
        total: preview.length + ignoredCount,
        imported: selectedItems.length,
        createdProducts: productosCreados.length,
        updatedProducts: updatedExistingCodes.size,
        fileType: selectedFileType,
        fileName: selectedFileName,
        detectedColumns,
        notFound: [],
        duplicates: [],
        errors: previewErrors,
        lastCargaRecordId: cargaRecord.id
      });

      setPreview(null);
      setPreviewErrors([]);
      playSound("positive");
      showToast(
        `Importación completada: ${selectedItems.length} lotes procesados (${updatedExistingCodes.size} vinculados, ${productosCreados.length} productos nuevos).`
      );
    } catch (err) {
      console.error("Error confirming import:", err);
      showToast(`Error al guardar la importación: ${err instanceof Error ? err.message : String(err)}`);
      playSound("negative");
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  /**
   * Revierte por completo una Carga Masiva confirmada, eliminando los lotes agregados,
   * borrando los productos nuevos creados en esa tanda y eliminando sus movimientos de entrada.
   */
  const executeRevertCarga = async (record: CargaMasivaRecord) => {
    if (record.revertida) {
      showToast("Esta carga masiva ya fue revertida anteriormente.");
      setConfirmRevertRecord(null);
      return;
    }

    setRevertingId(record.id);
    setConfirmRevertRecord(null);
    playSound("click");

    try {
      const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";
      const lotesToRemove = new Set<string>((record.lotesCreados || []).map((l) => l.loteId));
      const lotesModificadosMap = new Map<string, number>();
      (record.lotesModificados || []).forEach((lm) => {
        lotesModificadosMap.set(
          lm.loteId,
          (lotesModificadosMap.get(lm.loteId) || 0) + (Number(lm.cantidadAgregada) || 0)
        );
      });

      const descPreviaMap = new Map<string, string>();
      (record.descripcionesPrevias || []).forEach((dp) => {
        descPreviaMap.set(dp.productoCodigo, dp.descripcionPrevia);
      });

      const newProdsCreated = new Set<string>(record.productosCreados || []);
      const movsToRemove = new Set<string>(record.movimientosCreados || []);

      const currentProductsList = JSON.parse(JSON.stringify(products)) as Producto[];
      const productsToSave: Producto[] = [];
      const productsToDelete: string[] = [];

      const affectedCodes = new Set<string>([
        ...(record.productosCreados || []),
        ...(record.lotesCreados || []).map((l) => l.productoCodigo),
        ...(record.lotesModificados || []).map((l) => l.productoCodigo)
      ]);

      for (const code of affectedCodes) {
        const prod = currentProductsList.find((p) => p.codigo === code);
        if (!prod) continue;

        // 1. Eliminar lotes creados en esta carga masiva
        let remainingLotes = (prod.lotes || []).filter((l) => !lotesToRemove.has(l.id));

        // 2. Restar cantidades sumadas a lotes preexistentes
        remainingLotes = remainingLotes.map((l) => {
          if (lotesModificadosMap.has(l.id)) {
            const addedQty = lotesModificadosMap.get(l.id) || 0;
            const newQty = Math.max(0, (Number(l.cantidad) || 0) - addedQty);
            const newQtyF =
              l.cantidadF !== undefined
                ? Math.max(0, (Number(l.cantidadF) || 0) - addedQty)
                : newQty;
            return {
              ...l,
              cantidad: newQty,
              cantidadF: newQtyF
            };
          }
          return l;
        });

        // Restaurar descripción previa si fue modificada durante la carga
        const restoredDesc = descPreviaMap.has(code)
          ? descPreviaMap.get(code)!
          : prod.descripcion;

        // Si el producto fue creado como nuevo en esta carga y ya no le quedan lotes, eliminarlo del catálogo
        if (newProdsCreated.has(code) && remainingLotes.length === 0) {
          productsToDelete.push(code);
        } else {
          productsToSave.push({
            ...prod,
            descripcion: restoredDesc,
            lotes: remainingLotes,
            updatedAt: Date.now()
          });
        }
      }

      const deleteSet = new Set(productsToDelete);
      const saveMap = new Map(productsToSave.map((p) => [p.codigo, p]));
      const restoredProducts = currentProductsList
        .filter((p) => !deleteSet.has(p.codigo))
        .map((p) => saveMap.get(p.codigo) || p);

      if (isLocalFileMode) {
        localStorage.setItem("offline_productos", JSON.stringify(restoredProducts));
        window.dispatchEvent(new Event("offline_productos_update"));

        const storedMovs = localStorage.getItem("offline_movimientos");
        const existingMovs = storedMovs ? (JSON.parse(storedMovs) as Movimiento[]) : [];
        const filteredMovs = existingMovs.filter((m) => !movsToRemove.has(m.id));
        localStorage.setItem("offline_movimientos", JSON.stringify(filteredMovs));
        window.dispatchEvent(new Event("offline_movimientos_update"));
      } else {
        const allRevertOps: Array<{ type: "delProd" | "saveProd" | "delMov"; id: string; data?: any }> = [];
        for (const code of productsToDelete) {
          allRevertOps.push({ type: "delProd", id: code.replace(/\//g, "_") });
        }
        for (const prod of productsToSave) {
          allRevertOps.push({
            type: "saveProd",
            id: prod.codigo.replace(/\//g, "_"),
            data: prod
          });
        }
        for (const movId of movsToRemove) {
          allRevertOps.push({ type: "delMov", id: movId });
        }

        const productsCol = tenantCollection("productos");
        const movementsCol = tenantCollection("movimientos");

        for (let idx = 0; idx < allRevertOps.length; idx += 400) {
          const chunk = allRevertOps.slice(idx, idx + 400);
          const batch = writeBatch(db);
          for (const op of chunk) {
            if (op.type === "delProd") {
              batch.delete(doc(productsCol, op.id));
            } else if (op.type === "saveProd") {
              batch.set(doc(productsCol, op.id), op.data);
            } else if (op.type === "delMov") {
              batch.delete(doc(movementsCol, op.id));
            }
          }
          await batch.commit();
        }
      }

      const usuarioRevStr = currentUser
        ? `${currentUser.nombre} (${currentUser.usuario})`
        : "Administrador";
      const updatedRecord: CargaMasivaRecord = {
        ...record,
        revertida: true,
        fechaReversion: new Date().toISOString(),
        usuarioReversion: usuarioRevStr
      };

      const updatedCargasList = cargasMasivasList.map((c) =>
        c.id === record.id ? updatedRecord : c
      );
      await persistCargasHistory(updatedCargasList);

      onImportComplete(restoredProducts);
      if (summary?.lastCargaRecordId === record.id) {
        setSummary(null);
      }

      playSound("positive");
      showToast(
        `Carga masiva "${record.nombreArchivo || record.fecha}" revertida correctamente. El inventario volvió a su estado anterior.`
      );
    } catch (err) {
      console.error("Error reverting bulk import:", err);
      showToast(`Error al revertir la carga masiva: ${err instanceof Error ? err.message : String(err)}`);
      playSound("negative");
    } finally {
      setRevertingId(null);
    }
  };

  const triggerFileBrowser = () => {
    if (loading || importing) return;
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full min-w-0 max-w-full space-y-5 sm:space-y-6">
      {/* Banner Explicativo del Flujo de Auditoría Previa, Selección de Código y Reversión */}
      <div className="bg-gradient-to-r from-teal-900 via-teal-800 to-slate-900 text-white rounded-3xl p-4 sm:p-5 shadow-md border border-teal-700/40 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="p-3 bg-teal-500/20 border border-teal-400/30 rounded-2xl text-teal-300 shrink-0">
          <Sparkles className="w-6 h-6" />
        </div>
        <div className="space-y-1 text-xs sm:text-sm">
          <h4 className="font-extrabold text-white tracking-tight flex items-center gap-2 flex-wrap">
            <span>Carga Masiva Inteligente con Vista Previa (Excel y PDF)</span>
            <span className="text-[10px] font-black uppercase tracking-wider bg-teal-400/20 text-teal-200 border border-teal-400/30 px-2.5 py-0.5 rounded-lg">
              Auditoría + Selección de Código + Reversión
            </span>
          </h4>
          <p className="text-teal-100/90 text-xs leading-relaxed">
            1. <strong>Vista previa antes de importar:</strong> Al subir tu archivo <strong>Excel (.xlsx / .xls)</strong> o <strong>PDF (.pdf)</strong>, el sistema primero te muestra exactamente qué hará con cada fila.{" "}
            2. <strong>Corrección de código:</strong> Si el sistema se equivoca, puedes pulsar <strong>«Cambiar Código»</strong> para elegir el producto específico de tu catálogo.{" "}
            3. <strong>Reversión segura:</strong> Una vez confirmado, puedes <strong>revertir la carga</strong> en cualquier momento si hubo algún error.
          </p>
        </div>
      </div>

      {/* Tarjeta Principal de Subida y Vista Previa */}
      <div className="w-full min-w-0 max-w-full bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">
              Importar Inventario desde Excel o PDF
            </h3>
            <p className="text-slate-500 text-xs sm:text-sm leading-relaxed">
              Sube tu archivo <span className="font-semibold text-teal-800">Excel (.xlsx, .xls)</span> o{" "}
              <span className="font-semibold text-rose-700">PDF (.pdf)</span>. El sistema busca automáticamente bajo los mismos criterios:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="bg-teal-50 text-teal-900 border border-teal-200 px-2.5 py-1 rounded-lg font-bold">
                Producto: Suministro / Nombre / Producto / Artículo / Descripción
              </span>
              <span className="bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1 rounded-lg font-semibold">
                Descripción: U. de Emisión / Descripción
              </span>
              <span className="bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1 rounded-lg font-semibold">
                Lote: N° de lote / Lote / Lote del producto
              </span>
              <span className="bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1 rounded-lg font-semibold">
                Vencimiento: Fecha Vto / Fecha / Fecha de vencimiento
              </span>
              <span className="bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1 rounded-lg font-semibold">
                Cantidad: Cantidad / Cant
              </span>
              <span className="bg-slate-100 text-slate-700 border border-slate-200 px-2.5 py-1 rounded-lg font-semibold">
                Precio: Costo Unit. / Costo Unitario / Precio / Costo
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
            {catalogos.length > 0 && (
              <div className="w-full sm:w-auto bg-teal-50/70 border border-teal-200 rounded-2xl px-4 py-2.5">
                <label className="block text-[10px] font-black uppercase text-teal-800 tracking-wider mb-1 flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-teal-600" />
                  Catálogo Destino
                </label>
                <select
                  value={activeCatalogId}
                  disabled={Boolean(preview) || importing}
                  onChange={(e) => {
                    if (onSelectCatalog) onSelectCatalog(e.target.value);
                    playSound("click");
                  }}
                  className="w-full bg-white border border-teal-300 rounded-xl px-3 py-1.5 text-xs font-extrabold text-teal-950 outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer disabled:opacity-60"
                >
                  {catalogos.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {preview && (
              <button
                type="button"
                onClick={handleCancelPreview}
                disabled={importing}
                className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-slate-700 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 px-3.5 py-2.5 rounded-2xl transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Cargar Otro Archivo</span>
              </button>
            )}
          </div>
        </div>

        {/* Área Drag & Drop cuando no hay vista previa activa */}
        {!preview && (
          <form
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onSubmit={(e) => e.preventDefault()}
            onClick={triggerFileBrowser}
            className={`flex flex-col items-center justify-center p-6 sm:p-8 border-2 border-dashed rounded-2xl transition cursor-pointer text-center ${
              isDragging
                ? "border-teal-500 bg-teal-50"
                : "border-slate-300 hover:border-teal-400 bg-slate-50 hover:bg-slate-50/50"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx, .xls, .pdf, application/pdf"
              onChange={handleFileChange}
              className="hidden"
              disabled={loading}
            />

            {loading ? (
              <div className="space-y-3 py-4">
                <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-slate-800 font-bold text-sm">
                  Analizando archivo {selectedFileType} y preparando vista previa...
                </p>
                <p className="text-xs text-slate-500">
                  El sistema NO importará nada todavía: primero te mostrará lo que hará para que lo confirmes.
                </p>
              </div>
            ) : (
              <div className="space-y-3 py-3">
                <div className="flex items-center justify-center gap-3">
                  <div className="p-3 bg-teal-100 text-teal-700 rounded-2xl w-12 h-12 flex items-center justify-center shadow-xs">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                  <div className="p-3 bg-rose-100 text-rose-700 rounded-2xl w-12 h-12 flex items-center justify-center shadow-xs">
                    <FileText className="w-6 h-6" />
                  </div>
                </div>
                <div>
                  <p className="text-slate-800 font-extrabold text-sm sm:text-base">
                    Arrastra y suelta tu archivo Excel (.xlsx, .xls) o PDF (.pdf) aquí
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    o haz clic para seleccionarlo desde tu computadora o teléfono móvil
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-xl text-[11px] font-bold text-teal-900">
                  <Upload className="w-3.5 h-3.5 text-teal-700" />
                  <span>Primero verás la vista previa completa y podrás ajustar códigos antes de confirmar</span>
                </div>
              </div>
            )}
          </form>
        )}

        {/* ========================================================================= */}
        {/* PANEL DE AUDITORÍA PREVIA ("LO QUE HARÁ EL SISTEMA" ANTES DE IMPORTAR)    */}
        {/* ========================================================================= */}
        {preview && (
          <div className="space-y-5 pt-2">
            {/* Cabecera oscura con nombre de archivo y botón Confirmar e Importar */}
            <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 shadow-sm space-y-3">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <div
                    className={`p-2.5 rounded-xl border shrink-0 ${
                      selectedFileType === "PDF"
                        ? "bg-rose-500/20 border-rose-400/40 text-rose-300"
                        : "bg-teal-500/20 border-teal-400/40 text-teal-300"
                    }`}
                  >
                    {selectedFileType === "PDF" ? (
                      <FileText className="w-6 h-6" />
                    ) : (
                      <FileSpreadsheet className="w-6 h-6" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] uppercase font-mono tracking-widest text-teal-400 font-black">
                        Vista Previa: Lo que hará el sistema
                      </span>
                      <span
                        className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                          selectedFileType === "PDF"
                            ? "bg-rose-500/30 text-rose-200"
                            : "bg-teal-500/30 text-teal-200"
                        }`}
                      >
                        Archivo {selectedFileType}
                      </span>
                    </div>
                    <h4 className="font-extrabold text-sm sm:text-base text-white tracking-tight truncate">
                      {selectedFileName}
                    </h4>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Revisa los códigos asignados. Si algún producto no corresponde, haz clic en{" "}
                      <strong className="text-teal-300">«Cambiar Código»</strong> antes de confirmar.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleCancelPreview}
                    disabled={importing}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer flex items-center gap-1.5"
                  >
                    <X className="w-4 h-4" />
                    <span>Cancelar</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmImport}
                    disabled={importing || previewStats.selectedCount === 0}
                    className="px-5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 active:scale-95 text-slate-950 text-xs font-black uppercase tracking-wider transition shadow-md cursor-pointer inline-flex items-center gap-2 disabled:opacity-50"
                  >
                    {importing ? (
                      <>
                        <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                        <span>Procesando...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 text-slate-950 stroke-[3]" />
                        <span>Confirmar y Procesar ({previewStats.selectedCount})</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Columnas detectadas en el archivo */}
              {detectedColumns && (
                <div className="pt-3 border-t border-slate-800">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold mb-2">
                    Columnas identificadas en el documento ({selectedFileType}):
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[11px]">
                    <div className="bg-slate-800/90 border border-slate-700 rounded-xl px-2.5 py-1.5">
                      <span className="text-slate-400 block text-[9px] uppercase font-bold">
                        Nombre Producto
                      </span>
                      <span className="font-extrabold text-teal-300 truncate block">
                        {detectedColumns.nameHeader}
                      </span>
                    </div>
                    <div className="bg-slate-800/90 border border-slate-700 rounded-xl px-2.5 py-1.5">
                      <span className="text-slate-400 block text-[9px] uppercase font-bold">
                        Descripción / Emisión
                      </span>
                      <span className="font-extrabold text-white truncate block">
                        {detectedColumns.descHeader}
                      </span>
                    </div>
                    <div className="bg-slate-800/90 border border-slate-700 rounded-xl px-2.5 py-1.5">
                      <span className="text-slate-400 block text-[9px] uppercase font-bold">
                        Lote
                      </span>
                      <span className="font-extrabold text-white truncate block">
                        {detectedColumns.lotHeader}
                      </span>
                    </div>
                    <div className="bg-slate-800/90 border border-slate-700 rounded-xl px-2.5 py-1.5">
                      <span className="text-slate-400 block text-[9px] uppercase font-bold">
                        Fecha Vto
                      </span>
                      <span className="font-extrabold text-white truncate block">
                        {detectedColumns.dateHeader}
                      </span>
                    </div>
                    <div className="bg-slate-800/90 border border-slate-700 rounded-xl px-2.5 py-1.5">
                      <span className="text-slate-400 block text-[9px] uppercase font-bold">
                        Cantidad
                      </span>
                      <span className="font-extrabold text-white truncate block">
                        {detectedColumns.qtyHeader}
                      </span>
                    </div>
                    <div className="bg-slate-800/90 border border-slate-700 rounded-xl px-2.5 py-1.5">
                      <span className="text-slate-400 block text-[9px] uppercase font-bold">
                        Costo Unit. / Precio
                      </span>
                      <span className="font-extrabold text-white truncate block">
                        {detectedColumns.priceHeader}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Barra de progreso al confirmar */}
              {importing && progress && (
                <div className="space-y-1.5 pt-2 border-t border-slate-800">
                  <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-teal-400 h-2.5 rounded-full transition-all duration-200"
                      style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
                    ></div>
                  </div>
                  <div className="text-xs text-teal-300 flex justify-between font-mono">
                    <span>Guardando suministros y lotes en el inventario...</span>
                    <span>
                      {progress.done} de {progress.total} procesados
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Tarjetas KPI de Filtro Rápido de lo que hará el sistema */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <div
                onClick={() => setPreviewFilter("todos")}
                className={`border rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition ${
                  previewFilter === "todos"
                    ? "bg-slate-200/80 border-slate-400 ring-2 ring-slate-400/20"
                    : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                }`}
              >
                <div>
                  <span className="block text-2xl font-black text-slate-900">{previewStats.total}</span>
                  <span className="text-[11px] text-slate-600 font-bold uppercase tracking-wider">
                    Total Filas
                  </span>
                  <span className="block text-[10px] text-slate-500 font-medium">
                    {previewStats.selectedCount} seleccionadas
                  </span>
                </div>
                <div className="p-2 bg-slate-200 text-slate-700 rounded-xl">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
              </div>

              <div
                onClick={() => setPreviewFilter("coincidencias")}
                className={`border rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition ${
                  previewFilter === "coincidencias"
                    ? "bg-emerald-100/80 border-emerald-400 ring-2 ring-emerald-400/20"
                    : "bg-emerald-50/70 border-emerald-200 hover:bg-emerald-100/50"
                }`}
              >
                <div>
                  <span className="block text-2xl font-black text-emerald-800">
                    {previewStats.coincidencias}
                  </span>
                  <span className="text-[11px] text-emerald-700 font-bold uppercase tracking-wider">
                    En Catálogo
                  </span>
                  <span className="block text-[10px] text-emerald-600 font-medium">
                    Vinculará lote
                  </span>
                </div>
                <div className="p-2 bg-emerald-200 text-emerald-800 rounded-xl">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              </div>

              <div
                onClick={() => setPreviewFilter("manuales")}
                className={`border rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition ${
                  previewFilter === "manuales"
                    ? "bg-indigo-100/80 border-indigo-400 ring-2 ring-indigo-400/20"
                    : "bg-indigo-50/70 border-indigo-200 hover:bg-indigo-100/50"
                }`}
              >
                <div>
                  <span className="block text-2xl font-black text-indigo-800">
                    {previewStats.manuales}
                  </span>
                  <span className="text-[11px] text-indigo-700 font-bold uppercase tracking-wider">
                    Código Manual
                  </span>
                  <span className="block text-[10px] text-indigo-600 font-medium">
                    Elegidos por ti
                  </span>
                </div>
                <div className="p-2 bg-indigo-200 text-indigo-800 rounded-xl">
                  <Edit3 className="w-4 h-4" />
                </div>
              </div>

              <div
                onClick={() => setPreviewFilter("nuevos")}
                className={`border rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition ${
                  previewFilter === "nuevos"
                    ? "bg-sky-100/80 border-sky-400 ring-2 ring-sky-400/20"
                    : "bg-sky-50/70 border-sky-200 hover:bg-sky-100/50"
                }`}
              >
                <div>
                  <span className="block text-2xl font-black text-sky-800">{previewStats.nuevos}</span>
                  <span className="text-[11px] text-sky-700 font-bold uppercase tracking-wider">
                    Crear Nuevos
                  </span>
                  <span className="block text-[10px] text-sky-600 font-medium">
                    Código nuevo
                  </span>
                </div>
                <div className="p-2 bg-sky-200 text-sky-800 rounded-xl">
                  <PlusCircle className="w-4 h-4" />
                </div>
              </div>

              <div
                onClick={() => setPreviewFilter("agrupados")}
                className={`border rounded-2xl p-3.5 flex items-center justify-between cursor-pointer transition ${
                  previewFilter === "agrupados"
                    ? "bg-purple-100/80 border-purple-400 ring-2 ring-purple-400/20"
                    : "bg-purple-50/70 border-purple-200 hover:bg-purple-100/50"
                }`}
              >
                <div>
                  <span className="block text-2xl font-black text-purple-800">
                    {previewStats.agrupados}
                  </span>
                  <span className="text-[11px] text-purple-700 font-bold uppercase tracking-wider">
                    Agrupados
                  </span>
                  <span className="block text-[10px] text-purple-600 font-medium">
                    Mismo archivo
                  </span>
                </div>
                <div className="p-2 bg-purple-200 text-purple-800 rounded-xl">
                  <Layers className="w-4 h-4" />
                </div>
              </div>
            </div>

            {/* Barra de búsqueda y filtro dentro de la vista previa */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-200">
              <div className="flex items-center gap-1.5 flex-wrap">
                {(
                  [
                    { id: "todos", label: `Todos (${previewStats.total})` },
                    { id: "coincidencias", label: `En Catálogo (${previewStats.coincidencias})` },
                    { id: "nuevos", label: `Nuevos (${previewStats.nuevos})` },
                    { id: "agrupados", label: `Agrupados (${previewStats.agrupados})` },
                    { id: "manuales", label: `Manuales (${previewStats.manuales})` }
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setPreviewFilter(tab.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      previewFilter === tab.id
                        ? "bg-teal-700 text-white shadow-xs"
                        : "bg-white hover:bg-slate-100 text-slate-600 border border-slate-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="relative min-w-[240px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={previewSearch}
                  onChange={(e) => setPreviewSearch(e.target.value)}
                  placeholder="Buscar suministro, lote o código..."
                  className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-teal-500"
                />
                {previewSearch && (
                  <button
                    type="button"
                    onClick={() => setPreviewSearch("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Tabla Interactiva de Vista Previa y Selección de Código */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
              <div className="overflow-x-auto max-h-[560px]">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="sticky top-0 z-20 bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200 shadow-xs">
                    <tr>
                      <th className="py-3.5 px-2.5 text-center w-10 bg-slate-100 border-r border-slate-200">
                        <input
                          type="checkbox"
                          checked={
                            filteredPreview.length > 0 && filteredPreview.every((it) => it.selected)
                          }
                          onChange={toggleSelectAllFiltered}
                          className="w-4 h-4 rounded accent-teal-600 cursor-pointer"
                          title="Seleccionar / Deseleccionar todas las filas visibles"
                        />
                      </th>
                      <th className="py-3.5 px-2.5 text-center w-12 bg-slate-100 border-r border-slate-200">
                        Fila
                      </th>
                      <th className="py-3.5 px-3 min-w-[210px] bg-slate-100 border-r border-slate-200">
                        Suministro / Producto ({selectedFileType})
                      </th>
                      <th className="py-3.5 px-3 min-w-[140px] bg-slate-100">
                        U. de Emisión / Descripción
                      </th>
                      <th className="py-3.5 px-3 min-w-[110px] bg-slate-100">N° de Lote</th>
                      <th className="py-3.5 px-3 min-w-[100px] bg-slate-100">Fecha Vto.</th>
                      <th className="py-3.5 px-3 text-right min-w-[85px] bg-slate-100">Cantidad</th>
                      <th className="py-3.5 px-3 text-right min-w-[90px] bg-slate-100">
                        Costo Unit.
                      </th>
                      <th className="py-3.5 px-3.5 min-w-[175px] bg-emerald-50 text-emerald-950 border-x border-emerald-100">
                        <div className="flex items-center gap-1.5 font-black">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                          <span>Qué Hará el Sistema</span>
                        </div>
                      </th>
                      <th className="py-3.5 px-3.5 min-w-[210px] bg-slate-100/90 text-slate-900">
                        Producto Destino en Catálogo
                      </th>
                      <th className="py-3.5 px-3.5 text-center min-w-[130px] bg-teal-50 text-teal-950 border-x border-teal-100">
                        <div className="flex items-center justify-center gap-1.5 font-black">
                          <Sparkles className="w-3.5 h-3.5 text-teal-700" />
                          <span>Código Asignado</span>
                        </div>
                      </th>
                      <th className="py-3.5 px-3 text-center min-w-[155px] bg-slate-100">
                        Elegir Código / Editar
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPreview.length === 0 ? (
                      <tr>
                        <td
                          colSpan={12}
                          className="py-12 text-center text-slate-400 text-xs font-medium"
                        >
                          No se encontraron filas con el filtro o búsqueda seleccionada.
                        </td>
                      </tr>
                    ) : (
                      filteredPreview.map((item) => {
                        const isManual =
                          item.analysis.matchType === "manual_assigned" ||
                          item.analysis.isManualOverride;
                        const isExisting = item.analysis.matchType === "existing_catalog";
                        const isSameBatch = item.analysis.matchType === "same_file_batch";
                        const matchedProd = item.analysis.matchedProduct;
                        const matchedTotalStock =
                          matchedProd?.lotes?.reduce(
                            (sum, l) => sum + Number(l.cantidad || 0),
                            0
                          ) || 0;
                        const lotAlreadyExistsInProd = Boolean(
                          matchedProd?.lotes?.some(
                            (l) =>
                              l.numeroLote.trim().toLowerCase() === item.lote.trim().toLowerCase()
                          )
                        );

                        return (
                          <tr
                            key={item.row}
                            className={`transition ${
                              !item.selected
                                ? "opacity-45 bg-slate-50"
                                : isManual
                                ? "bg-indigo-50/25 hover:bg-indigo-50/70"
                                : isExisting
                                ? "bg-emerald-50/20 hover:bg-emerald-50/70"
                                : isSameBatch
                                ? "bg-purple-50/20 hover:bg-purple-50/70"
                                : "bg-sky-50/20 hover:bg-sky-50/70"
                            }`}
                          >
                            {/* Checkbox */}
                            <td className="py-3 px-2.5 text-center border-r border-slate-100">
                              <input
                                type="checkbox"
                                checked={item.selected}
                                onChange={() => toggleSelectRow(item.row)}
                                className="w-4 h-4 rounded accent-teal-600 cursor-pointer"
                              />
                            </td>

                            {/* # Fila */}
                            <td className="py-3 px-2.5 text-center font-mono font-bold text-slate-400 text-[11px] border-r border-slate-100">
                              {item.row}
                            </td>

                            {/* Suministro / Nombre */}
                            <td className="py-3 px-3 border-r border-slate-100">
                              <span className="font-extrabold text-slate-900 block text-xs">
                                {item.nombre}
                              </span>
                              {item.codigoOriginal && (
                                <span className="inline-block mt-0.5 text-[10px] font-mono text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                                  Cód. Archivo: {item.codigoOriginal}
                                </span>
                              )}
                            </td>

                            {/* U. de Emisión / Descripción */}
                            <td className="py-3 px-3 text-xs text-slate-600">
                              {item.descripcion || (
                                <span className="text-slate-300 italic">—</span>
                              )}
                            </td>

                            {/* N° de Lote */}
                            <td className="py-3 px-3">
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md">
                                  {item.lote}
                                </span>
                                {lotAlreadyExistsInProd && (
                                  <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded">
                                    Lote existente (sumará cant.)
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Fecha Vto */}
                            <td className="py-3 px-3 font-mono text-xs font-semibold text-slate-800">
                              {item.fechaVto}
                            </td>

                            {/* Cantidad */}
                            <td className="py-3 px-3 text-right font-mono font-black text-slate-900 text-xs">
                              {item.cantidad.toLocaleString("es-ES")}{" "}
                              <span className="text-[10px] font-normal text-slate-500">u.</span>
                            </td>

                            {/* Costo Unitario */}
                            <td className="py-3 px-3 text-right font-mono text-xs text-slate-700">
                              $
                              {item.precio.toLocaleString("es-ES", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                              })}
                            </td>

                            {/* Qué Hará el Sistema */}
                            <td className="py-3 px-3.5 border-x border-slate-100">
                              {isManual ? (
                                <div className="space-y-0.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-indigo-100 text-indigo-800 border border-indigo-200">
                                    <Edit3 className="w-3 h-3" />
                                    Código Elegido Manual
                                  </span>
                                  <p className="text-[10px] text-slate-500 leading-tight">
                                    {matchedProd
                                      ? "Se agregará el lote al producto seleccionado"
                                      : "Se creará como nuevo con código asignado"}
                                  </p>
                                </div>
                              ) : isExisting ? (
                                <div className="space-y-0.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Vincular a Existente
                                  </span>
                                  <p className="text-[10px] text-slate-500 leading-tight">
                                    Agregará lote al producto del catálogo
                                  </p>
                                </div>
                              ) : isSameBatch ? (
                                <div className="space-y-0.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-purple-100 text-purple-800 border border-purple-200">
                                    <Layers className="w-3 h-3" />
                                    Agrupar en Mismo Código
                                  </span>
                                  <p className="text-[10px] text-slate-500 leading-tight">
                                    Mismo suministro en fila previa del archivo
                                  </p>
                                </div>
                              ) : (
                                <div className="space-y-0.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-sky-100 text-sky-800 border border-sky-200">
                                    <PlusCircle className="w-3 h-3" />
                                    Crear Nuevo Producto
                                  </span>
                                  <p className="text-[10px] text-slate-500 leading-tight">
                                    No existe en catálogo; se creará nuevo
                                  </p>
                                </div>
                              )}
                            </td>

                            {/* Producto Destino en Catálogo */}
                            <td className="py-3 px-3.5">
                              {matchedProd ? (
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-black text-[11px] text-emerald-900 bg-emerald-100 px-1.5 py-0.5 rounded">
                                      {matchedProd.codigo}
                                    </span>
                                    <span className="font-bold text-slate-900 text-xs">
                                      {matchedProd.nombre}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-slate-500">
                                    Stock actual:{" "}
                                    <strong className="text-slate-700">
                                      {matchedTotalStock} u.
                                    </strong>{" "}
                                    ({matchedProd.lotes?.length || 0} lotes)
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-0.5">
                                  <span className="text-xs font-bold text-sky-800 block">
                                    {item.nombre}
                                  </span>
                                  <span className="text-[10px] text-sky-600 font-medium block">
                                    Se registrará como nuevo en el catálogo
                                  </span>
                                </div>
                              )}
                            </td>

                            {/* Código Final que Recibirá */}
                            <td className="py-3 px-3.5 text-center border-x border-slate-100">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingItemRow(item.row);
                                  setAssignSearchQuery("");
                                  setApplyToAllSameName(true);
                                  setCustomNewCodeInput(item.analysis.projectedCode);
                                  playSound("click");
                                }}
                                title="Haz clic para cambiar el código específico del producto"
                                className="inline-flex flex-col items-center cursor-pointer group/code"
                              >
                                <span
                                  className={`font-mono font-black text-xs px-3 py-1 rounded-lg border shadow-2xs tracking-wide group-hover/code:scale-105 transition ${
                                    isManual
                                      ? "bg-indigo-700 text-white border-indigo-800"
                                      : isExisting
                                      ? "bg-emerald-700 text-white border-emerald-800"
                                      : isSameBatch
                                      ? "bg-purple-700 text-white border-purple-800"
                                      : "bg-sky-700 text-white border-sky-800"
                                  }`}
                                >
                                  {item.analysis.projectedCode}
                                </span>
                                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mt-1">
                                  {isManual
                                    ? "Manual"
                                    : isExisting
                                    ? "Existente"
                                    : isSameBatch
                                    ? "Agrupado"
                                    : "Nuevo"}
                                </span>
                              </button>
                            </td>

                            {/* Botones de Acción: Cambiar Código Específico / Editar Datos */}
                            <td className="py-3 px-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingItemRow(item.row);
                                    setAssignSearchQuery("");
                                    setApplyToAllSameName(true);
                                    setCustomNewCodeInput(item.analysis.projectedCode);
                                    playSound("click");
                                  }}
                                  className="inline-flex items-center gap-1 text-[11px] font-extrabold px-2.5 py-1.5 rounded-xl border border-teal-300 bg-teal-50 hover:bg-teal-100 text-teal-900 transition cursor-pointer shadow-2xs active:scale-95 whitespace-nowrap"
                                  title="Seleccionar el código de un producto específico del catálogo"
                                >
                                  <Edit3 className="w-3.5 h-3.5 text-teal-700" />
                                  <span>Cambiar Código</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setInlineEditRow({ ...item });
                                    playSound("click");
                                  }}
                                  className="px-2 py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 text-[11px] font-bold transition cursor-pointer"
                                  title="Editar nombre, lote, fecha o cantidad de esta fila"
                                >
                                  Editar
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Guía rápida sobre selección de código específico */}
            <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-4 text-xs text-amber-900 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-amber-950">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>¿El sistema asignó un código nuevo a un producto que ya existe, o se equivocó de producto?</span>
              </div>
              <p className="leading-relaxed text-amber-900/90">
                Haz clic en <strong>«Cambiar Código»</strong> en esa fila para buscar y seleccionar el <strong>código específico del producto</strong> dentro de tu catálogo (o escribir un código nuevo personalizado). Al confirmar, el lote se guardará exactamente en el código que hayas seleccionado.
              </p>
            </div>

            {/* Observaciones o filas omitidas durante la lectura */}
            {previewErrors.length > 0 && (
              <div className="bg-rose-50 p-4 rounded-2xl border border-rose-200 text-xs text-rose-800 space-y-1.5">
                <span className="font-bold flex items-center gap-1.5 text-rose-900">
                  <AlertCircle className="w-4 h-4 text-rose-700" />
                  <span>
                    Filas omitidas por datos incompletos en el archivo ({previewErrors.length}):
                  </span>
                </span>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] max-h-36 overflow-y-auto font-mono">
                  {previewErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Pie de Confirmación Final */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-slate-200">
              <div className="text-xs text-slate-600 flex flex-wrap gap-3">
                <span>
                  Filas válidas: <strong>{preview.length}</strong>
                </span>
                <span>
                  Seleccionadas para procesar: <strong className="text-teal-700">{previewStats.selectedCount}</strong>
                </span>
                {ignoredCount > 0 && (
                  <span>
                    Filas vacías/totales ignoradas: <strong>{ignoredCount}</strong>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCancelPreview}
                  disabled={importing}
                  className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
                >
                  Descartar Vista Previa
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={importing || previewStats.selectedCount === 0}
                  className="px-6 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 active:scale-95 text-white text-xs font-black uppercase tracking-wider transition shadow-md cursor-pointer inline-flex items-center gap-2 disabled:opacity-50"
                >
                  {importing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Procesando Importación...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 stroke-[3]" />
                      <span>
                        Confirmar y Procesar Importación ({previewStats.selectedCount})
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* RESUMEN DE IMPORTACIÓN PROCESADA + BOTÓN INMEDIATO DE REVERTIR            */}
      {/* ========================================================================= */}
      {summary && (
        <div className="anim-card-in space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center">
              <span className="block text-2xl font-black text-slate-800">{summary.total}</span>
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                Filas Analizadas
              </span>
            </div>

            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-center">
              <span className="block text-2xl font-black text-emerald-700">
                {summary.imported}
              </span>
              <span className="text-xs text-emerald-600 font-bold uppercase tracking-wider">
                Lotes Importados
              </span>
            </div>

            <div className="bg-teal-50 border border-teal-100 rounded-2xl p-4 text-center">
              <span className="block text-2xl font-black text-teal-700">
                {summary.createdProducts}
              </span>
              <span className="text-xs text-teal-600 font-bold uppercase tracking-wider">
                Nuevos Productos
              </span>
            </div>

            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 text-center">
              <span className="block text-2xl font-black text-rose-700">
                {summary.errors.length + summary.duplicates.length}
              </span>
              <span className="text-xs text-rose-600 font-bold uppercase tracking-wider">
                Omitidos / Errores
              </span>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                <h4 className="font-bold text-slate-900 text-sm">
                  Resultado de la Importación ({summary.fileType}: {summary.fileName})
                </h4>
              </div>

              {summary.lastCargaRecordId && (
                <button
                  type="button"
                  disabled={revertingId === summary.lastCargaRecordId}
                  onClick={() => {
                    const rec = cargasMasivasList.find(
                      (c) => c.id === summary.lastCargaRecordId
                    );
                    if (rec) setConfirmRevertRecord(rec);
                  }}
                  className="inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white active:scale-95 transition px-4 py-2 rounded-xl font-extrabold text-xs cursor-pointer shadow-xs self-start sm:self-auto"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Revertir Esta Carga Masiva</span>
                </button>
              )}
            </div>

            {summary.imported > 0 && (
              <div className="p-6 border-b border-slate-100 space-y-2">
                <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  <span>
                    Se procesaron {summary.imported} lotes exitosamente ({summary.updatedProducts}{" "}
                    productos existentes actualizados y {summary.createdProducts} nuevos productos
                    creados)
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Si detectas algún error en los datos importados, puedes revertir esta operación con un solo clic usando el botón{" "}
                  <strong>«Revertir Esta Carga Masiva»</strong> o desde el historial inferior.
                </p>
              </div>
            )}

            {summary.errors.length > 0 && (
              <div className="p-6 space-y-3">
                <div className="flex items-center gap-2 text-rose-700 font-bold text-xs uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                  <span>Observaciones / Errores de Lectura ({summary.errors.length})</span>
                </div>
                <div className="max-h-48 overflow-y-auto bg-red-50/40 rounded-xl p-3 border border-red-100 divide-y divide-red-100/50 font-mono text-[11px] text-rose-900 space-y-1">
                  {summary.errors.map((item, idx) => (
                    <div key={idx} className="py-1 first:pt-0 last:pb-0 flex items-start gap-1.5">
                      <X className="w-3.5 h-3.5 mt-0.5 text-rose-600 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* HISTORIAL Y REVERSIÓN DE CARGAS MASIVAS                                   */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-amber-100 text-amber-800 rounded-2xl shadow-xs">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-extrabold text-slate-900 text-sm sm:text-base">
                Historial y Reversión de Cargas Masivas
              </h4>
              <p className="text-xs text-slate-500">
                Puedes revertir cualquier carga masiva realizada desde Excel o PDF para restaurar el inventario en caso de error.
              </p>
            </div>
          </div>
          <span className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-xl self-start sm:self-auto">
            {catalogCargas.length} Carga(s) registrada(s)
          </span>
        </div>

        {catalogCargas.length === 0 ? (
          <div className="text-center py-8 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 text-xs font-medium space-y-1">
            <History className="w-8 h-8 mx-auto text-slate-300" />
            <p className="font-bold text-slate-600">
              No hay cargas masivas registradas en este catálogo
            </p>
            <p className="text-[11px] text-slate-400">
              Cuando confirmes una importación desde Excel o PDF, aparecerá aquí con su botón de reversión.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {catalogCargas.map((cm) => (
              <div
                key={cm.id}
                className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition ${
                  cm.revertida
                    ? "bg-slate-50 border-slate-200 opacity-65"
                    : "bg-amber-50/35 border-amber-200/80 shadow-xs hover:border-amber-300"
                }`}
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold text-slate-900 text-sm truncate">
                      {cm.tipoArchivo === "PDF" ? "📕" : "📗"}{" "}
                      {cm.nombreArchivo || "Carga_Masiva.xlsx"}
                    </span>
                    <span
                      className={`text-[10px] font-black px-2 py-0.5 rounded-md uppercase ${
                        cm.tipoArchivo === "PDF"
                          ? "bg-rose-100 text-rose-800"
                          : "bg-teal-100 text-teal-800"
                      }`}
                    >
                      {cm.tipoArchivo || "Excel"}
                    </span>
                    {cm.revertida ? (
                      <span className="text-[10px] font-black bg-slate-200 text-slate-700 px-2.5 py-0.5 rounded-lg uppercase tracking-wider">
                        Revertida
                      </span>
                    ) : (
                      <span className="text-[10px] font-black bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-lg uppercase tracking-wider">
                        Activa
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                    <span>📅 {cm.fecha}</span>
                    <span>👤 {cm.usuario}</span>
                    <span>📦 {cm.importedItems || cm.totalItems} lotes procesados</span>
                    <span className="text-teal-700 font-bold">
                      ✨ {cm.productosCreados?.length || 0} nuevos productos
                    </span>
                    <span className="text-emerald-700 font-bold">
                      🏷️ {(cm.lotesCreados?.length || 0) + (cm.lotesModificados?.length || 0)} lotes afectados
                    </span>
                  </div>
                  {cm.revertida && (
                    <p className="text-[11px] text-rose-700 font-semibold italic pt-0.5">
                      Revertida el{" "}
                      {cm.fechaReversion
                        ? new Date(cm.fechaReversion).toLocaleString("es-ES")
                        : "recientemente"}{" "}
                      por {cm.usuarioReversion || "Usuario"}.
                    </p>
                  )}
                </div>

                {!cm.revertida && (
                  <button
                    type="button"
                    disabled={revertingId === cm.id}
                    onClick={() => setConfirmRevertRecord(cm)}
                    className="inline-flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-700 active:scale-95 transition text-white px-4 py-2.5 rounded-xl font-extrabold text-xs shadow-sm cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    {revertingId === cm.id ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Revirtiendo...</span>
                      </>
                    ) : (
                      <>
                        <RotateCcw className="w-4 h-4" />
                        <span>Revertir Carga</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL: SELECCIONAR CÓDIGO DE PRODUCTO ESPECÍFICO DEL CATÁLOGO             */}
      {/* ========================================================================= */}
      {editingItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
            {/* Cabecera del Modal */}
            <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-teal-500/20 text-teal-400 rounded-xl border border-teal-500/30">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-white">
                    Seleccionar Código de Producto Específico
                  </h3>
                  <p className="text-xs text-slate-400">
                    Elige a qué código de producto de tu catálogo corresponde esta fila del{" "}
                    {selectedFileType}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingItemRow(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Cuerpo del Modal */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
              {/* Resumen de la fila seleccionada */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-1.5">
                <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold flex items-center justify-between">
                  <span>
                    Fila #{editingItem.row} del archivo {selectedFileType}
                  </span>
                  <span className="font-mono font-black text-teal-800 bg-teal-100 px-2 py-0.5 rounded">
                    Código actual: {editingItem.analysis.projectedCode}
                  </span>
                </div>
                <div className="text-sm font-extrabold text-slate-900">{editingItem.nombre}</div>
                {editingItem.descripcion && (
                  <div className="text-xs text-slate-600">
                    Descripción / Emisión: <strong>{editingItem.descripcion}</strong>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500 pt-1 font-mono">
                  <span>
                    Lote: <strong className="text-slate-800">{editingItem.lote}</strong>
                  </span>
                  <span>
                    Fecha Vto: <strong className="text-slate-800">{editingItem.fechaVto}</strong>
                  </span>
                  <span>
                    Cantidad: <strong className="text-slate-800">{editingItem.cantidad}</strong>
                  </span>
                  <span>
                    Costo Unit.:{" "}
                    <strong className="text-slate-800">${editingItem.precio.toFixed(2)}</strong>
                  </span>
                </div>
              </div>

              {/* Aplicar a todas las filas con el mismo nombre */}
              {sameNameCount > 1 && (
                <label className="bg-indigo-50/80 border border-indigo-200 rounded-2xl p-3 flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyToAllSameName}
                    onChange={(e) => setApplyToAllSameName(e.target.checked)}
                    className="w-4 h-4 rounded accent-indigo-600 cursor-pointer"
                  />
                  <span className="text-xs font-bold text-indigo-950">
                    Aplicar este mismo código a las <strong>{sameNameCount} filas</strong> del archivo que tienen el suministro &ldquo;{editingItem.nombre}&rdquo;
                  </span>
                </label>
              )}

              {/* Buscador de Productos Existentes en el Catálogo */}
              <div className="space-y-2">
                <label className="block text-xs font-extrabold text-slate-800">
                  1. Seleccionar un producto existente de tu catálogo ({activeCatalogProducts.length} disponibles):
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={assignSearchQuery}
                    onChange={(e) => setAssignSearchQuery(e.target.value)}
                    placeholder="Buscar por código (ej. P001), nombre del producto o descripción..."
                    autoFocus
                    className="w-full pl-10 pr-9 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  {assignSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setAssignSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-2xl divide-y divide-slate-100 bg-slate-50/40 p-1.5 space-y-1">
                  {filteredCatalogForAssign.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">
                      No se encontraron productos en el catálogo con &ldquo;{assignSearchQuery}&rdquo;.
                    </div>
                  ) : (
                    filteredCatalogForAssign.map((p) => {
                      const isCurrentlySelected =
                        editingItem.analysis.projectedCode.toLowerCase() ===
                        p.codigo.toLowerCase();
                      const totalStock = (p.lotes || []).reduce(
                        (acc, l) => acc + (Number(l.cantidad) || 0),
                        0
                      );

                      return (
                        <div
                          key={p.codigo}
                          onClick={() => handleAssignToExistingProduct(p)}
                          className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition ${
                            isCurrentlySelected
                              ? "bg-teal-50 border-teal-400 shadow-xs ring-1 ring-teal-400/30"
                              : "bg-white border-slate-200 hover:border-teal-300 hover:bg-teal-50/40"
                          }`}
                        >
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-black text-teal-800 bg-teal-100 px-2 py-0.5 rounded text-xs">
                                {p.codigo}
                              </span>
                              <span className="font-extrabold text-slate-900 text-xs truncate">
                                {p.nombre}
                              </span>
                            </div>
                            {p.descripcion && (
                              <p className="text-[11px] text-slate-500 truncate pl-0.5">
                                {p.descripcion}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right text-[11px]">
                              <span className="font-bold text-slate-700 block font-mono">
                                {totalStock} u.
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {p.lotes?.length || 0} lotes
                              </span>
                            </div>
                            <button
                              type="button"
                              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer flex items-center gap-1 ${
                                isCurrentlySelected
                                  ? "bg-teal-600 text-white"
                                  : "bg-slate-100 hover:bg-teal-600 hover:text-white text-slate-700"
                              }`}
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>{isCurrentlySelected ? "Asignado" : "Elegir Código"}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Opción 2: Crear como producto nuevo con código correlativo o código específico escrito manualmente */}
              <div className="pt-2 border-t border-slate-200 space-y-2.5">
                <label className="block text-xs font-extrabold text-slate-800">
                  2. O registrar como Producto Nuevo (con código automático o específico):
                </label>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    value={customNewCodeInput}
                    onChange={(e) => setCustomNewCodeInput(e.target.value.toUpperCase())}
                    placeholder={`Código nuevo (ej. ${generateNextCodeConsecutive(
                      activeCatalogId,
                      getInitialPrefix(editingItem.nombre),
                      activeCatalogProducts
                    )})`}
                    className="flex-1 px-3.5 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-900 outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleAssignAsNewProduct(customNewCodeInput)}
                    className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-extrabold transition cursor-pointer inline-flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>Usar como Nuevo Código</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleResetToAuto}
                    className="px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer inline-flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span>Auto</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Pie del Modal */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setEditingItemRow(null)}
                className="px-5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold transition cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDITAR DATOS DE LA FILA EN LA VISTA PREVIA                         */}
      {/* ========================================================================= */}
      {inlineEditRow && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 sm:p-5 bg-slate-900 text-white flex items-center justify-between">
              <h3 className="text-sm sm:text-base font-extrabold">
                Editar Datos de la Fila #{inlineEditRow.row}
              </h3>
              <button
                type="button"
                onClick={() => setInlineEditRow(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Nombre del Producto / Suministro
                </label>
                <input
                  type="text"
                  value={inlineEditRow.nombre}
                  onChange={(e) =>
                    setInlineEditRow({ ...inlineEditRow, nombre: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl font-semibold text-slate-900"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  U. de Emisión / Descripción
                </label>
                <input
                  type="text"
                  value={inlineEditRow.descripcion}
                  onChange={(e) =>
                    setInlineEditRow({ ...inlineEditRow, descripcion: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-slate-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">N° de Lote</label>
                  <input
                    type="text"
                    value={inlineEditRow.lote}
                    onChange={(e) =>
                      setInlineEditRow({ ...inlineEditRow, lote: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Fecha de Vencimiento
                  </label>
                  <input
                    type="date"
                    value={inlineEditRow.fechaVto}
                    onChange={(e) =>
                      setInlineEditRow({ ...inlineEditRow, fechaVto: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-slate-900"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Cantidad</label>
                  <input
                    type="number"
                    min={1}
                    value={inlineEditRow.cantidad}
                    onChange={(e) =>
                      setInlineEditRow({
                        ...inlineEditRow,
                        cantidad: Math.max(1, Number(e.target.value) || 1)
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Costo Unit. / Precio
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={inlineEditRow.precio}
                    onChange={(e) =>
                      setInlineEditRow({
                        ...inlineEditRow,
                        precio: Math.max(0, Number(e.target.value) || 0)
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono text-slate-900"
                  />
                </div>
              </div>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setInlineEditRow(null)}
                className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveInlineEdit}
                className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-extrabold cursor-pointer"
              >
                Guardar Cambios en Fila
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL DE CONFIRMACIÓN PARA REVERTIR CARGA MASIVA                          */}
      {/* ========================================================================= */}
      {confirmRevertRecord && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 bg-rose-600 text-white flex items-center gap-3">
              <div className="p-2.5 bg-white/15 rounded-2xl">
                <RotateCcw className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-extrabold">¿Revertir esta Carga Masiva?</h3>
                <p className="text-xs text-rose-100">
                  El inventario regresará al estado previo a esta importación
                </p>
              </div>
            </div>
            <div className="p-5 space-y-3 text-xs text-slate-700">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-1">
                <p className="font-extrabold text-slate-900 text-sm">
                  {confirmRevertRecord.nombreArchivo || "Carga_Masiva"}
                </p>
                <p className="text-slate-500">Fecha: {confirmRevertRecord.fecha}</p>
                <p className="text-slate-500">Usuario: {confirmRevertRecord.usuario}</p>
              </div>
              <ul className="space-y-1.5 text-slate-600 list-disc list-inside">
                <li>
                  Se eliminarán los{" "}
                  <strong>{confirmRevertRecord.lotesCreados?.length || 0} lotes nuevos</strong>{" "}
                  agregados en esta carga.
                </li>
                {(confirmRevertRecord.lotesModificados?.length || 0) > 0 && (
                  <li>
                    Se descontarán las cantidades sumadas en{" "}
                    <strong>{confirmRevertRecord.lotesModificados?.length} lotes existentes</strong>.
                  </li>
                )}
                <li>
                  Se eliminarán los{" "}
                  <strong>
                    {confirmRevertRecord.productosCreados?.length || 0} productos nuevos
                  </strong>{" "}
                  creados exclusivamente en esta tanda.
                </li>
                <li>
                  Se borrarán del historial los movimientos de entrada generados por esta carga.
                </li>
              </ul>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmRevertRecord(null)}
                className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => executeRevertCarga(confirmRevertRecord)}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black uppercase tracking-wider transition cursor-pointer shadow-sm inline-flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Sí, Revertir Ahora</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
