import React, { useRef, useState } from "react";
import * as XLSX from "@keep-lts/xlsx";
import { doc, writeBatch } from "firebase/firestore";
import { db, tenantCollection } from "../firebase";
import { Producto, Usuario, Lote, Movimiento, Catalogo, matchesCatalog } from "../types";
import {
  normalizeSupplyName,
  normalizeCompactName,
  getInitialPrefix,
  generateNextCodeConsecutive
} from "../utils/productMatching";
import { playSound } from "../utils/audio";
import { FileSpreadsheet, Upload, AlertCircle, CheckCircle, X, Layers } from "lucide-react";

interface CargaMasivaProps {
  products: Producto[];
  currentUser: Usuario | null;
  onImportComplete: (updatedProducts: Producto[]) => void;
  showToast: (message: string) => void;
  activeCatalogId: string;
  catalogos?: Catalogo[];
  onSelectCatalog?: (catalogId: string) => void;
}

interface DetectedColumnsInfo {
  nameHeader: string;
  descHeader: string;
  lotHeader: string;
  dateHeader: string;
  qtyHeader: string;
  priceHeader: string;
  codeHeader?: string;
}

interface ImportSummary {
  total: number;
  imported: number;
  createdProducts: number;
  updatedProducts: number;
  detectedColumns?: DetectedColumnsInfo;
  notFound: string[];
  duplicates: string[];
  errors: string[];
}

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
    // Excel serial date number
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

  // Numeric string that represents an Excel serial date (e.g. "46350")
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

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const ddmmyyyy = cleanStr.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (ddmmyyyy) {
    const p1 = parseInt(ddmmyyyy[1], 10);
    const p2 = parseInt(ddmmyyyy[2], 10);
    const y = ddmmyyyy[3];
    // Handle MM/DD/YYYY if second part > 12
    const day = p2 > 12 && p1 <= 12 ? p2 : p1;
    const month = p2 > 12 && p1 <= 12 ? p1 : p2;
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // DD/MM/YY or DD-MM-YY
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

  // YYYY/MM/DD or YYYY-MM-DD
  const yyyymmdd = cleanStr.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if (yyyymmdd) {
    return `${yyyymmdd[1]}-${yyyymmdd[2].padStart(2, "0")}-${yyyymmdd[3].padStart(2, "0")}`;
  }

  // MM/YYYY or MM-YYYY
  const mmyyyy = cleanStr.match(/^(\d{1,2})[\/\-\.](\d{4})$/);
  if (mmyyyy) {
    const m = parseInt(mmyyyy[1], 10);
    const y = parseInt(mmyyyy[2], 10);
    if (m >= 1 && m <= 12) {
      return `${y}-${String(m).padStart(2, "0")}-01`;
    }
  }

  // MM/YY or MM-YY
  const mmyy = cleanStr.match(/^(\d{1,2})[\/\-\.](\d{2})$/);
  if (mmyy) {
    const m = parseInt(mmyy[1], 10);
    const yy = parseInt(mmyy[2], 10);
    if (m >= 1 && m <= 12) {
      const y = yy < 70 ? 2000 + yy : 1900 + yy;
      return `${y}-${String(m).padStart(2, "0")}-01`;
    }
  }

  // Spanish month name formats: "15-Ago-2027", "Ago-2027", "Agosto 2027", "Dic/26"
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

  // Strip currency symbols and text units while keeping digits, dots, commas, and minus sign
  str = str.replace(/[^0-9.,\-]/g, "");
  if (!str) return NaN;

  // Handle thousand separators vs decimal commas:
  // Case 1: both comma and dot exist (e.g. "1,250.50" or "1.250,50")
  if (str.includes(",") && str.includes(".")) {
    if (str.lastIndexOf(",") > str.lastIndexOf(".")) {
      // "1.250,50" -> "1250.50"
      str = str.replace(/\./g, "").replace(",", ".");
    } else {
      // "1,250.50" -> "1250.50"
      str = str.replace(/,/g, "");
    }
  } else if (str.includes(",")) {
    // Only comma exists: if 3 digits after comma like "1,500", treat as thousands unless decimal price
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const processFile = (file: File) => {
    setLoading(true);
    setSummary(null);
    playSound("open");

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array", cellDates: true });

        // Locate the best sheet and header row (even if the table doesn't start on row 1)
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

        // Fallback to first non-empty sheet if no multi-column header row scored >= 2
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

        if (selectedMatrix.length === 0 || selectedMatrix.length <= headerRowIdx + 1) {
          setSummary({
            total: 0,
            imported: 0,
            createdProducts: 0,
            updatedProducts: 0,
            notFound: [],
            duplicates: [],
            errors: ["El archivo de Excel está vacío o no contiene filas de datos debajo de los encabezados."]
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
        // Esto ocurre cuando:
        // 1) No existe columna explícita "Suministro" / "Nombre" / "Producto" / "Artículo" (nameColIdx === -1) y sí existe "Descripción".
        // 2) O cuando la columna de nombre está vacía en las filas de datos o contiene solo códigos/unidades mientras "Descripción" contiene el nombre real del suministro.
        let useDescriptionAsProductName = false;
        if (nameColIdx === -1 && descColIdx !== -1) {
          useDescriptionAsProductName = true;
        } else if (nameColIdx !== -1 && descColIdx !== -1) {
          // Muestrear las primeras filas de datos con contenido para comprobar cuál columna tiene el nombre del producto
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

        const detectedColumns: DetectedColumnsInfo = {
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

        const notFound: string[] = [];
        const duplicates: string[] = [];
        const errors: string[] = [];
        let importedCount = 0;
        let createdProductsCount = 0;
        const updatedExistingCodes = new Set<string>();

        // Indexar productos existentes del catálogo activo por código, nombre normalizado y nombre compacto
        const productsMapByNormName = new Map<string, Producto>();
        const productsMapByCompactName = new Map<string, Producto>();
        const productsMapByCode = new Map<string, Producto>();

        products.forEach((p) => {
          if (matchesCatalog(p.catalogId, activeCatalogId, catalogos)) {
            productsMapByNormName.set(normalizeSupplyName(p.nombre), p);
            productsMapByCompactName.set(normalizeCompactName(p.nombre), p);
            productsMapByCode.set(p.codigo.trim().toLowerCase(), p);
          }
        });

        const productsToUpdate = new Map<string, Producto>();
        const workingCatalogList: Producto[] = [...products];
        const movementLogs: Movimiento[] = [];
        let dataRowsCount = 0;

        for (let r = headerRowIdx + 1; r < selectedMatrix.length; r++) {
          const row = selectedMatrix[r] || [];
          const rowNum = r + 1; // 1-based Excel row number

          // Omitir filas completamente vacías
          const hasAnyValue = row.some((cell) => String(cell ?? "").trim() !== "");
          if (!hasAnyValue) continue;

          const rawNameCell =
            effectiveNameColIdx !== -1 ? String(row[effectiveNameColIdx] ?? "").trim() : "";
          const rawFallbackDescCell =
            !useDescriptionAsProductName && descColIdx !== -1 ? String(row[descColIdx] ?? "").trim() : "";
          const rawUnitCell = unitColIdx !== -1 ? String(row[unitColIdx] ?? "").trim() : "";
          const rawCodeCell = codeColIdx !== -1 ? String(row[codeColIdx] ?? "").trim() : "";

          // Si en esta fila específica la columna de nombre está vacía pero "Descripción" trae el nombre del producto
          let supplyName = rawNameCell;
          let supplyDesc = "";

          if (!supplyName && rawFallbackDescCell) {
            supplyName = rawFallbackDescCell;
            supplyDesc = rawUnitCell;
          } else {
            // Construir la descripción a partir de U. de Emisión y/o Descripción (evitando repetir el nombre del producto)
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

          // Ignorar filas de pie de tabla como "TOTAL", "SUBTOTAL" que no tienen lote ni fecha
          const normSupplyName = normalizeSupplyName(supplyName);
          if (
            (normSupplyName === "total" ||
              normSupplyName === "subtotal" ||
              normSupplyName === "totales" ||
              (!supplyName && !lotNum && !expDateRaw)) &&
            !lotNum
          ) {
            continue;
          }

          dataRowsCount++;

          if (!supplyName && !rawCodeCell) {
            errors.push(`Fila ${rowNum}: Nombre del suministro no especificado.`);
            continue;
          }

          if (!lotNum) {
            errors.push(`Fila ${rowNum}: "${supplyName || rawCodeCell}" — Número de lote vacío.`);
            continue;
          }

          if (isNaN(qty) || qty <= 0) {
            errors.push(
              `Fila ${rowNum}: "${supplyName || rawCodeCell}" — Cantidad inválida o menor a 1 (${
                qtyColIdx !== -1 ? row[qtyColIdx] : "columna Cantidad no encontrada"
              }).`
            );
            continue;
          }

          if (priceVal < 0) {
            errors.push(`Fila ${rowNum}: "${supplyName || rawCodeCell}" — Costo/Precio inválido (${priceVal}).`);
            continue;
          }

          const expiration = new Date(expDateRaw + "T00:00:00");
          if (!expDateRaw || isNaN(expiration.getTime())) {
            errors.push(
              `Fila ${rowNum}: "${supplyName || rawCodeCell}" — Fecha de vencimiento vacía o inválida (${
                dateColIdx !== -1 ? String(row[dateColIdx] ?? "") : "columna Fecha Vto no encontrada"
              }).`
            );
            continue;
          }

          // Buscar producto existente en catálogo activo o creado en filas anteriores del mismo Excel
          const normLookup = normalizeSupplyName(supplyName);
          const compactLookup = normalizeCompactName(supplyName);
          const codeLookup = (rawCodeCell || supplyName).trim().toLowerCase();

          let product =
            (rawCodeCell ? productsMapByCode.get(rawCodeCell.trim().toLowerCase()) : undefined) ||
            productsMapByCode.get(codeLookup) ||
            (normLookup ? productsMapByNormName.get(normLookup) : undefined) ||
            (compactLookup ? productsMapByCompactName.get(compactLookup) : undefined);

          // Si el producto no existe aún en el catálogo, crearlo automáticamente con su nombre y descripción
          let isNewlyCreatedProduct = false;
          if (!product) {
            const generatedCode =
              rawCodeCell && !productsMapByCode.has(rawCodeCell.trim().toLowerCase())
                ? rawCodeCell.trim().toUpperCase()
                : generateNextCodeConsecutive(
                    activeCatalogId,
                    getInitialPrefix(supplyName || "S"),
                    workingCatalogList
                  );

            const newProduct: Producto = {
              codigo: generatedCode,
              nombre: supplyName || generatedCode,
              descripcion: supplyDesc || "",
              lotes: [],
              updatedAt: Date.now(),
              catalogId: activeCatalogId,
              verificado: false
            };

            product = newProduct;
            isNewlyCreatedProduct = true;
            createdProductsCount++;

            productsMapByCode.set(newProduct.codigo.toLowerCase(), newProduct);
            if (normLookup) productsMapByNormName.set(normLookup, newProduct);
            if (compactLookup) productsMapByCompactName.set(compactLookup, newProduct);
            workingCatalogList.push(newProduct);
          }

          const activeProduct: Producto =
            productsToUpdate.get(product.codigo) || JSON.parse(JSON.stringify(product));

          // Actualizar la descripción si el producto no tenía descripción o si viene especificada en el Excel
          if (supplyDesc && (!activeProduct.descripcion || activeProduct.descripcion.trim() === "")) {
            activeProduct.descripcion = supplyDesc;
          }

          // Verificar si el lote ya existe para este producto
          if (
            activeProduct.lotes.some(
              (l: Lote) => l.numeroLote.trim().toLowerCase() === lotNum.trim().toLowerCase()
            )
          ) {
            duplicates.push(
              `Fila ${rowNum}: "${activeProduct.nombre}" — El Lote "${lotNum}" ya existe para este producto.`
            );
            continue;
          }

          const newLot: Lote = {
            id: `lote-${activeProduct.codigo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            numeroLote: lotNum,
            cantidad: qty,
            cantidadF: qty,
            fechaVencimiento: expDateRaw,
            precio: priceVal,
            loteFisico: lotNum,
            fechaFisica: expDateRaw
          };

          activeProduct.lotes.push(newLot);
          activeProduct.updatedAt = Date.now();
          productsToUpdate.set(activeProduct.codigo, activeProduct);

          // Mantener sincronizadas las referencias de búsqueda para siguientes filas del mismo archivo
          productsMapByCode.set(activeProduct.codigo.toLowerCase(), activeProduct);
          if (normLookup) productsMapByNormName.set(normLookup, activeProduct);
          if (compactLookup) productsMapByCompactName.set(compactLookup, activeProduct);

          if (!isNewlyCreatedProduct) {
            updatedExistingCodes.add(activeProduct.codigo);
          }

          const movement: Movimiento = {
            id: `mov-${activeProduct.codigo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            productoCodigo: activeProduct.codigo,
            productoNombre: activeProduct.nombre,
            descripcion: activeProduct.descripcion || supplyDesc || "",
            lote: lotNum,
            loteFisico: lotNum,
            cantidad: qty,
            cantidadF: qty,
            fechaVencimiento: expDateRaw,
            fechaFisica: expDateRaw,
            precio: priceVal,
            tipoMovimiento: "Entrada",
            usuario: currentUser ? `${currentUser.nombre} (${currentUser.usuario})` : "Carga Masiva",
            fecha: new Date().toISOString(),
            timestamp: Date.now(),
            catalogId: activeCatalogId
          };

          movementLogs.push(movement);
          importedCount++;
        }

        if (productsToUpdate.size > 0) {
          const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

          // Construir lista final de productos (actualizando los existentes y agregando los nuevos creados)
          const existingCodesSet = new Set(products.map((p) => p.codigo));
          const finalProducts: Producto[] = products.map((p) => {
            const updated = productsToUpdate.get(p.codigo);
            return updated ? { ...updated, verificado: false } : p;
          });

          for (const [code, updatedProd] of productsToUpdate.entries()) {
            if (!existingCodesSet.has(code)) {
              finalProducts.push({ ...updatedProd, verificado: false });
            }
          }

          if (isLocalFileMode) {
            localStorage.setItem("offline_productos", JSON.stringify(finalProducts));
            window.dispatchEvent(new Event("offline_productos_update"));

            const storedMovs = localStorage.getItem("offline_movimientos");
            const existingMovs = storedMovs ? (JSON.parse(storedMovs) as Movimiento[]) : [];
            localStorage.setItem(
              "offline_movimientos",
              JSON.stringify([...movementLogs, ...existingMovs])
            );
            window.dispatchEvent(new Event("offline_movimientos_update"));
          } else {
            // Firestore writeBatch tiene límite de 500 operaciones; dividir en lotes seguros de 400
            const allOps: Array<{ type: "prod" | "mov"; id: string; data: any }> = [];
            for (const [code, updatedProd] of productsToUpdate.entries()) {
              allOps.push({
                type: "prod",
                id: code.replace(/\//g, "_"),
                data: { ...updatedProd, verificado: false }
              });
            }
            for (const mov of movementLogs) {
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

          onImportComplete(finalProducts);
          showToast(
            `Se importaron ${importedCount} lotes (${updatedExistingCodes.size} productos actualizados, ${createdProductsCount} nuevos creados).`
          );
        }

        setSummary({
          total: dataRowsCount,
          imported: importedCount,
          createdProducts: createdProductsCount,
          updatedProducts: updatedExistingCodes.size,
          detectedColumns,
          notFound,
          duplicates,
          errors
        });
        playSound(importedCount > 0 ? "positive" : "negative");
      } catch (err) {
        console.error("Error processing Excel file:", err);
        setSummary({
          total: 0,
          imported: 0,
          createdProducts: 0,
          updatedProducts: 0,
          notFound: [],
          duplicates: [],
          errors: [`Error fatal de lectura: ${err instanceof Error ? err.message : String(err)}`]
        });
        playSound("negative");
      } finally {
        setLoading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const triggerFileBrowser = () => {
    if (loading) return;
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full min-w-0 max-w-full space-y-5 sm:space-y-6">
      <div className="w-full min-w-0 max-w-full bg-white rounded-3xl p-4 sm:p-6 border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">Importar Inventario desde Excel</h3>
            <p className="text-slate-500 text-xs sm:text-sm leading-relaxed">
              Sube tu archivo de Excel (<span className="font-semibold">.xlsx</span> o{" "}
              <span className="font-semibold">.xls</span>). El sistema detecta automáticamente las columnas:
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
          {catalogos.length > 0 && (
            <div className="w-full sm:w-auto bg-teal-50/70 border border-teal-200 rounded-2xl px-4 py-2.5 shrink-0">
              <label className="block text-[10px] font-black uppercase text-teal-800 tracking-wider mb-1 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-teal-600" />
                Catálogo Destino de Importación
              </label>
              <select
                value={activeCatalogId}
                onChange={(e) => {
                  if (onSelectCatalog) onSelectCatalog(e.target.value);
                  playSound("click");
                }}
                className="w-full bg-white border border-teal-300 rounded-xl px-3 py-1.5 text-xs font-extrabold text-teal-950 outline-none focus:ring-2 focus:ring-teal-500 cursor-pointer"
              >
                {catalogos.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <form
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onSubmit={(e) => e.preventDefault()}
          onClick={triggerFileBrowser}
          className={`flex flex-col items-center justify-center p-5 sm:p-8 border-2 border-dashed rounded-2xl transition cursor-pointer text-center ${
            isDragging
              ? "border-teal-500 bg-teal-50"
              : "border-slate-300 hover:border-teal-400 bg-slate-50 hover:bg-slate-50/50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx, .xls"
            onChange={handleFileChange}
            className="hidden"
            disabled={loading}
          />

          {loading ? (
            <div className="space-y-3">
              <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <p className="text-slate-800 font-semibold text-sm">
                Analizando columnas, procesando lotes y guardando inventario...
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-teal-100 text-teal-700 rounded-full w-12 h-12 flex items-center justify-center mx-auto shadow-sm">
                <Upload className="w-6 h-6 animate-pulse" />
              </div>
              <p className="text-slate-800 font-bold text-sm">Arrastra y suelta tu archivo Excel aquí</p>
              <p className="text-xs text-slate-400">o haz clic para explorar tu dispositivo (.xlsx, .xls)</p>
            </div>
          )}
        </form>
      </div>

      {summary && (
        <div className="anim-card-in space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center">
              <span className="block text-2xl font-black text-slate-800">{summary.total}</span>
              <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Filas Procesadas</span>
            </div>

            <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-center">
              <span className="block text-2xl font-black text-emerald-700">{summary.imported}</span>
              <span className="text-xs text-emerald-600 font-bold uppercase tracking-wider">Lotes Importados</span>
            </div>

            <div className="bg-teal-50 border border-teal-100 rounded-2xl p-4 text-center">
              <span className="block text-2xl font-black text-teal-700">{summary.createdProducts}</span>
              <span className="text-xs text-teal-600 font-bold uppercase tracking-wider">Nuevos Productos</span>
            </div>

            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 text-center">
              <span className="block text-2xl font-black text-rose-700">
                {summary.errors.length + summary.duplicates.length}
              </span>
              <span className="text-xs text-rose-600 font-bold uppercase tracking-wider">Errores / Duplicados</span>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-600" />
              <h4 className="font-bold text-slate-900 text-sm">Resumen Detallado del Procesamiento</h4>
            </div>

            {summary.detectedColumns && (
              <div className="px-6 py-4 bg-slate-50/50 border-b border-slate-100">
                <p className="text-[11px] font-extrabold uppercase text-slate-500 tracking-wider mb-2 flex items-center gap-1.5">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-teal-700" />
                  <span>Columnas identificadas en tu archivo Excel:</span>
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                  <div className="bg-white border border-slate-200 rounded-xl px-3 py-2">
                    <span className="text-slate-400 font-bold block text-[10px] uppercase">Producto / Suministro</span>
                    <span className="font-extrabold text-slate-800">{summary.detectedColumns.nameHeader}</span>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl px-3 py-2">
                    <span className="text-slate-400 font-bold block text-[10px] uppercase">Descripción / Emisión</span>
                    <span className="font-extrabold text-slate-800">{summary.detectedColumns.descHeader}</span>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl px-3 py-2">
                    <span className="text-slate-400 font-bold block text-[10px] uppercase">Lote</span>
                    <span className="font-extrabold text-slate-800">{summary.detectedColumns.lotHeader}</span>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl px-3 py-2">
                    <span className="text-slate-400 font-bold block text-[10px] uppercase">Fecha Vencimiento</span>
                    <span className="font-extrabold text-slate-800">{summary.detectedColumns.dateHeader}</span>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl px-3 py-2">
                    <span className="text-slate-400 font-bold block text-[10px] uppercase">Cantidad</span>
                    <span className="font-extrabold text-slate-800">{summary.detectedColumns.qtyHeader}</span>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl px-3 py-2">
                    <span className="text-slate-400 font-bold block text-[10px] uppercase">Costo Unit. / Precio</span>
                    <span className="font-extrabold text-slate-800">{summary.detectedColumns.priceHeader}</span>
                  </div>
                </div>
              </div>
            )}

            {summary.imported > 0 && (
              <div className="p-6 border-b border-slate-100 space-y-2">
                <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  <span>
                    Lotes importados correctamente ({summary.imported} lotes: {summary.updatedProducts} productos
                    existentes actualizados y {summary.createdProducts} nuevos productos registrados)
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Los suministros, descripciones (U. de Emisión / Descripción), lotes, fechas de vencimiento,
                  cantidades y costos unitarios se han guardado exitosamente en el inventario y en el historial de
                  movimientos de entrada.
                </p>
              </div>
            )}

            {summary.duplicates.length > 0 && (
              <div className="p-6 border-b border-slate-100 space-y-3">
                <div className="flex items-center gap-2 text-rose-700 font-bold text-xs uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                  <span>Lotes Duplicados Omitidos ({summary.duplicates.length})</span>
                </div>
                <p className="text-xs text-slate-500">
                  Los siguientes lotes ya se encontraban registrados en la base de datos para estos suministros. Se
                  ignoraron para evitar duplicar existencias:
                </p>
                <div className="max-h-48 overflow-y-auto bg-rose-50/40 rounded-xl p-3 border border-rose-100 divide-y divide-rose-100/50 font-mono text-[11px] text-rose-800 space-y-1">
                  {summary.duplicates.map((item, idx) => (
                    <div key={idx} className="py-1 first:pt-0 last:pb-0 flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary.errors.length > 0 && (
              <div className="p-6 space-y-3">
                <div className="flex items-center gap-2 text-rose-700 font-bold text-xs uppercase tracking-wider">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                  <span>Errores de Validación ({summary.errors.length})</span>
                </div>
                <p className="text-xs text-slate-500">
                  Las siguientes filas contienen datos incompletos o inválidos (ej. lote vacío, cantidad menor a 1 o
                  fecha de vencimiento inválida) y fueron omitidas:
                </p>
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
    </div>
  );
}
