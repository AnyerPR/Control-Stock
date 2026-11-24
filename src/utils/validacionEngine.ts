import * as XLSX from "@keep-lts/xlsx";
import {
  DocumentoValidacionItem,
  MetodoExtraccionValidacion,
  Movimiento,
  Producto,
  RegistroConsumo,
  TipoDocumentoValidacion
} from "../types";
import { extractTableMatrixFromPdf } from "./pdfTableExtractor";

export interface RawExtractedDocItem {
  numeroItem: string;
  nombreProducto: string;
  unidadMedida: string;
  cantidad: number;
  costoUnitario?: number;
  fechaVencimiento?: string;
  lote?: string;
}

export interface DocumentExtractionOutput {
  tipoDocumento: TipoDocumentoValidacion;
  metodoExtraccion: MetodoExtraccionValidacion;
  rawItems: RawExtractedDocItem[];
  textoCrudo?: string;
  previewImageUrl?: string;
}

// Mapa de sinónimos farmacéuticos y unidades de medida para comparación inteligente
const PRESENTATION_SYNONYMS: Record<string, string> = {
  comp: "comprimido",
  compr: "comprimido",
  comprimidos: "comprimido",
  comprimido: "comprimido",
  tab: "comprimido",
  tabs: "comprimido",
  tableta: "comprimido",
  tabletas: "comprimido",
  cap: "capsula",
  caps: "capsula",
  capsula: "capsula",
  capsulas: "capsula",
  amp: "ampolla",
  amps: "ampolla",
  ampolla: "ampolla",
  ampollas: "ampolla",
  ampolleta: "ampolla",
  fco: "frasco",
  fcos: "frasco",
  frasco: "frasco",
  frascos: "frasco",
  vial: "vial",
  viales: "vial",
  jbe: "jarabe",
  jarabe: "jarabe",
  susp: "suspension",
  suspension: "suspension",
  sol: "solucion",
  solucion: "solucion",
  iny: "inyectable",
  inyectable: "inyectable",
  und: "unidad",
  unds: "unidad",
  unid: "unidad",
  unidad: "unidad",
  unidades: "unidad",
  pza: "unidad",
  pieza: "unidad",
  cja: "caja",
  caja: "caja",
  cajas: "caja",
  sob: "sobre",
  sobre: "sobre",
  sobres: "sobre",
  tub: "tubo",
  tubo: "tubo",
  crema: "crema",
  ung: "unguento",
  unguento: "unguento",
  pomada: "unguento",
  blister: "blister"
};

const PRESENTATION_SET = new Set(Object.keys(PRESENTATION_SYNONYMS));

const STOP_WORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "en",
  "con",
  "para",
  "por",
  "uso",
  "medico",
  "hospitalario"
]);

export function normalizeTextBasic(val: string | undefined | null): string {
  return String(val || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.%\/\-+\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extrae y estandariza concentraciones (ej: "500 mg" -> "500mg", "0.5 g" -> "500mg", "100 ml" -> "100ml")
 */
export function extractNormalizedConcentrations(text: string): string[] {
  const norm = normalizeTextBasic(text);
  const regex = /\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|ug|g|gr|ml|l|ui|iu|%|meq)(?:\s*\/\s*(\d+(?:[.,]\d+)?)?\s*(ml|l|g|mg))?\b/gi;
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(norm)) !== null) {
    let val = parseFloat(match[1].replace(",", "."));
    let unit = match[2].toLowerCase();
    if (unit === "gr") unit = "g";
    if (unit === "ug") unit = "mcg";
    if (unit === "iu") unit = "ui";
    // Convertir gramos pequeños a mg para comparar (ej. 0.5g === 500mg)
    if (unit === "g" && val > 0 && val <= 5) {
      val = Math.round(val * 1000);
      unit = "mg";
    }
    const denomVal = match[3] ? match[3].replace(",", ".") : "";
    const denomUnit = match[4] ? match[4].toLowerCase() : "";
    const denom = denomUnit ? `/${denomVal}${denomUnit}` : "";
    results.push(`${val}${unit}${denom}`);
  }
  return results;
}

/**
 * Extrae formas farmacéuticas / unidades de medida normalizadas de un texto
 */
export function extractNormalizedPresentations(text: string): string[] {
  const norm = normalizeTextBasic(text);
  const words = norm.split(/[\s\/\-.,]+/).filter(Boolean);
  const found = new Set<string>();
  for (const w of words) {
    if (PRESENTATION_SYNONYMS[w]) {
      found.add(PRESENTATION_SYNONYMS[w]);
    }
  }
  return Array.from(found);
}

/**
 * Extrae los tokens base del principio activo / nombre del producto (sin concentraciones ni palabras de presentación)
 */
export function extractCoreNameTokens(text: string): string[] {
  const norm = normalizeTextBasic(text)
    // Unificar expresiones de concentración para removerlas del núcleo de palabras
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|g|gr|ml|l|ui|iu|%|meq)(?:\s*\/\s*\d*(?:[.,]\d+)?\s*(?:ml|l|g|mg))?\b/gi, " ");
  const rawWords = norm.split(/[\s\/\-.,]+/).filter(Boolean);
  const tokens: string[] = [];
  for (const w of rawWords) {
    if (w.length <= 1) continue;
    if (STOP_WORDS.has(w)) continue;
    if (PRESENTATION_SET.has(w)) continue;
    tokens.push(w);
  }
  return tokens;
}

function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const maxLen = Math.max(m, n);
  return maxLen === 0 ? 1 : (maxLen - dp[m][n]) / maxLen;
}

export interface ProductMatchResult {
  producto: Producto | null;
  nivelCoincidencia: number; // 0 - 100
  razonCoincidencia: string;
}

/**
 * Compara inteligentemente un ítem extraído de un documento con el catálogo de productos del inventario.
 * Considera nombres, principios activos, concentraciones (ej. 500 mg), presentaciones (ej. comprimido) y unidades de medida.
 */
export function findBestInventoryMatch(
  rawItem: { nombreProducto: string; unidadMedida?: string; numeroItem?: string },
  inventoryProducts: Producto[]
): ProductMatchResult {
  if (!inventoryProducts || inventoryProducts.length === 0) {
    return { producto: null, nivelCoincidencia: 0, razonCoincidencia: "Inventario vacío" };
  }

  const docFullText = `${rawItem.nombreProducto || ""} ${rawItem.unidadMedida || ""}`.trim();
  const docNormName = normalizeTextBasic(rawItem.nombreProducto);
  const docCodeCandidate = normalizeTextBasic(rawItem.numeroItem).toUpperCase().replace(/\s+/g, "");

  // 1. Verificar si el número de ítem coincide exactamente con un código de producto
  if (docCodeCandidate && docCodeCandidate.length >= 2) {
    const exactCodeProd = inventoryProducts.find(
      (p) => p.codigo.trim().toUpperCase() === docCodeCandidate
    );
    if (exactCodeProd) {
      return {
        producto: exactCodeProd,
        nivelCoincidencia: 100,
        razonCoincidencia: "Código exacto en inventario"
      };
    }
  }

  const docCoreTokens = extractCoreNameTokens(rawItem.nombreProducto);
  const docConcentrations = extractNormalizedConcentrations(docFullText);
  const docPresentations = extractNormalizedPresentations(docFullText);

  let bestProd: Producto | null = null;
  let bestScore = 0;
  let bestReason = "Sin coincidencia suficiente";

  for (const prod of inventoryProducts) {
    const invFullText = `${prod.nombre || ""} ${prod.descripcion || ""}`.trim();
    const invNormName = normalizeTextBasic(prod.nombre);

    // Coincidencia exacta de texto normalizado
    if (docNormName && docNormName === invNormName) {
      return {
        producto: prod,
        nivelCoincidencia: 100,
        razonCoincidencia: "Nombre exacto"
      };
    }

    const invCoreTokens = extractCoreNameTokens(invFullText);
    const invNameOnlyCoreTokens = extractCoreNameTokens(prod.nombre);
    const invConcentrations = extractNormalizedConcentrations(invFullText);
    const invPresentations = extractNormalizedPresentations(invFullText);

    if (docCoreTokens.length === 0 || invCoreTokens.length === 0) continue;

    // A. Similitud de principio activo / palabras clave del nombre (peso principal)
    let matchedDocTokens = 0;
    for (const dTok of docCoreTokens) {
      let bestTokSim = 0;
      for (const iTok of invCoreTokens) {
        if (dTok === iTok) {
          bestTokSim = 1;
          break;
        }
        if (dTok.length >= 4 && iTok.length >= 4) {
          if (iTok.startsWith(dTok) || dTok.startsWith(iTok)) {
            bestTokSim = Math.max(bestTokSim, 0.9);
          } else {
            const lSim = levenshteinSimilarity(dTok, iTok);
            if (lSim >= 0.8) bestTokSim = Math.max(bestTokSim, lSim);
          }
        }
      }
      matchedDocTokens += bestTokSim;
    }

    const docCoverage = matchedDocTokens / docCoreTokens.length;
    const invNameCoverage =
      invNameOnlyCoreTokens.length > 0
        ? Math.min(1, matchedDocTokens / invNameOnlyCoreTokens.length)
        : docCoverage;

    // Si ni siquiera la primera palabra clave o al menos 50% del principio activo coincide, descartar
    if (docCoverage < 0.48) continue;

    let score = (docCoverage * 0.6 + invNameCoverage * 0.4) * 72; // Base hasta 72 pts por principio activo
    const reasons: string[] = ["Nombre similar"];

    // B. Comparación de Concentración (ej. "500 mg" vs "500 mg comprimido")
    if (docConcentrations.length > 0 && invConcentrations.length > 0) {
      const concMatches = docConcentrations.filter((dc) => invConcentrations.includes(dc));
      if (concMatches.length > 0) {
        score += 20;
        reasons.push(`Concentración (${concMatches[0]})`);
      } else {
        // Tiene otra concentración distinta (ej. Paracetamol 500mg vs Paracetamol 120mg)
        score -= 22;
        reasons.push("Concentración distinta");
      }
    } else if (docConcentrations.length === 0 && invConcentrations.length === 0) {
      score += 12;
    } else {
      // Uno especifica concentración y el otro no: aún muy probable que sea el mismo producto
      score += 8;
    }

    // C. Comparación de Presentación / Unidad de Medida (ej. "Comprimido", "Ampolla", "Frasco")
    if (docPresentations.length > 0 && invPresentations.length > 0) {
      const presMatch = docPresentations.some((dp) => invPresentations.includes(dp));
      if (presMatch) {
        score += 8;
        reasons.push(`Presentación (${docPresentations[0]})`);
      } else {
        score -= 6;
      }
    } else {
      // Como en el ejemplo del usuario: Documento "Paracetamol 500 mg" vs Inventario "Paracetamol 500 mg comprimido"
      // Si el principio activo y la concentración coinciden al 100%, aunque el documento omita "comprimido", es alta coincidencia (92%)
      if (docCoverage >= 0.95) {
        score += 6;
        if (invPresentations.length > 0) {
          reasons.push(`Sugerido (${invPresentations[0]})`);
        }
      }
    }

    const finalScore = Math.max(0, Math.min(99, Math.round(score)));
    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestProd = prod;
      bestReason = reasons.join(" • ");
    }
  }

  if (bestScore < 45) {
    return {
      producto: null,
      nivelCoincidencia: bestScore,
      razonCoincidencia: "Sin coincidencia en inventario"
    };
  }

  return {
    producto: bestProd,
    nivelCoincidencia: bestScore,
    razonCoincidencia: bestReason
  };
}

/**
 * Calcula las métricas de un producto en inventario (stock sistema, stock físico, consumo total, costo, vencimiento)
 */
export function computeInventoryMetricsForProduct(
  prod: Producto | null | undefined,
  movimientos: Movimiento[],
  consumos: RegistroConsumo[]
) {
  if (!prod) {
    return {
      existenciaSistemaActual: 0,
      existenciaFisicaActual: 0,
      consumoRegistradoTotal: 0,
      consumoMovimientosCount: 0,
      costoInventarioActual: undefined as number | undefined,
      fechaVencimientoInventarioActual: undefined as string | undefined,
      loteIdObjetivo: undefined as string | undefined,
      numeroLoteInventarioActual: undefined as string | undefined,
      unidadMedidaInventario: ""
    };
  }

  const lotes = Array.isArray(prod.lotes) ? prod.lotes : [];
  const existenciaSistemaActual = lotes.reduce((acc, l) => acc + Number(l.cantidad || 0), 0);
  const existenciaFisicaActual = lotes.reduce((acc, l) => acc + Number(l.cantidadF ?? l.cantidad ?? 0), 0);

  // Lote principal (con stock y vencimiento más próximo, o el primero disponible)
  const sortedLotes = [...lotes].sort((a, b) => {
    const aHas = Number(a.cantidad || 0) > 0 ? 1 : 0;
    const bHas = Number(b.cantidad || 0) > 0 ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    return String(a.fechaVencimiento || "9999").localeCompare(String(b.fechaVencimiento || "9999"));
  });

  const primaryLot = sortedLotes[0];
  const costoInventarioActual = primaryLot ? Number(primaryLot.precio || 0) : undefined;
  const fechaVencimientoInventarioActual = primaryLot?.fechaVencimiento || undefined;

  // Calcular consumo del producto seleccionado (salidas en movimientos + registros en módulo Consumos sin duplicar)
  const movIdsFromConsumos = new Set<string>();
  let consumoFromModule = 0;
  let consumoCount = 0;

  for (const reg of consumos || []) {
    if (Array.isArray(reg.movimientoIds)) {
      reg.movimientoIds.forEach((id) => movIdsFromConsumos.add(id));
    }
    for (const it of reg.items || []) {
      if (it.productoCodigo === prod.codigo) {
        consumoFromModule += Number(it.cantidadEntregada || 0);
        consumoCount++;
      }
    }
  }

  let salidasAdicionales = 0;
  for (const mov of movimientos || []) {
    if (
      mov.productoCodigo === prod.codigo &&
      mov.tipoMovimiento === "Salida" &&
      !movIdsFromConsumos.has(mov.id) &&
      !mov.consumoId
    ) {
      salidasAdicionales += Math.abs(Number(mov.cantidad || 0));
      consumoCount++;
    }
  }

  const consumoRegistradoTotal = consumoFromModule + salidasAdicionales;

  const extractedPres = extractNormalizedPresentations(`${prod.descripcion || ""} ${prod.nombre || ""}`);
  const unidadMedidaInventario =
    prod.descripcion?.trim() ||
    (extractedPres.length > 0
      ? extractedPres[0].charAt(0).toUpperCase() + extractedPres[0].slice(1)
      : "Unidad");

  return {
    existenciaSistemaActual,
    existenciaFisicaActual,
    consumoRegistradoTotal,
    consumoMovimientosCount: consumoCount,
    costoInventarioActual,
    fechaVencimientoInventarioActual,
    loteIdObjetivo: primaryLot?.id,
    numeroLoteInventarioActual: primaryLot?.numeroLote,
    unidadMedidaInventario
  };
}

/**
 * Construye la lista comparativa DocumentoValidacionItem[] a partir de los ítems extraídos del documento
 */
export function buildValidationComparisonItems(
  rawItems: RawExtractedDocItem[],
  inventoryProducts: Producto[],
  movimientos: Movimiento[],
  consumos: RegistroConsumo[]
): DocumentoValidacionItem[] {
  return rawItems.map((raw, idx) => {
    const match = findBestInventoryMatch(raw, inventoryProducts);
    const matchedProd = match.producto;
    const metrics = computeInventoryMetricsForProduct(matchedProd, movimientos, consumos);

    const cantidadDoc = Number(raw.cantidad || 0);
    const diferenciaCantidad = matchedProd ? cantidadDoc - metrics.existenciaSistemaActual : cantidadDoc;
    const diferenciaFisica = matchedProd ? cantidadDoc - metrics.existenciaFisicaActual : cantidadDoc;

    const costDiffers =
      raw.costoUnitario !== undefined &&
      raw.costoUnitario > 0 &&
      metrics.costoInventarioActual !== undefined &&
      Math.abs(raw.costoUnitario - metrics.costoInventarioActual) >= 0.01;

    const dateDiffers =
      Boolean(raw.fechaVencimiento) &&
      Boolean(metrics.fechaVencimientoInventarioActual) &&
      raw.fechaVencimiento !== metrics.fechaVencimientoInventarioActual;

    const tieneDiscrepancia =
      !matchedProd || diferenciaCantidad !== 0 || Boolean(costDiffers) || Boolean(dateDiffers);

    return {
      id: `val-item-${Date.now()}-${idx}`,
      numeroItem: String(raw.numeroItem || idx + 1),
      nombreDocumento: String(raw.nombreProducto || "").trim(),
      unidadMedidaDocumento: String(raw.unidadMedida || "Unidad").trim(),
      cantidadDocumento: cantidadDoc,
      costoDocumento: raw.costoUnitario !== undefined && raw.costoUnitario > 0 ? Number(raw.costoUnitario) : undefined,
      fechaVencimientoDocumento: raw.fechaVencimiento || undefined,
      loteDocumento: raw.lote || undefined,
      productoCodigoSugerido: matchedProd?.codigo,
      productoNombreSugerido: matchedProd?.nombre,
      productoCodigoSeleccionado: matchedProd?.codigo || "",
      productoNombreInventario: matchedProd?.nombre,
      unidadMedidaInventario: metrics.unidadMedidaInventario,
      nivelCoincidencia: match.nivelCoincidencia,
      razonCoincidencia: match.razonCoincidencia,
      fueCorregidoManualmente: false,
      existenciaSistemaActual: metrics.existenciaSistemaActual,
      existenciaFisicaActual: metrics.existenciaFisicaActual,
      diferenciaCantidad,
      diferenciaFisica,
      consumoRegistradoTotal: metrics.consumoRegistradoTotal,
      consumoMovimientosCount: metrics.consumoMovimientosCount,
      costoInventarioActual: metrics.costoInventarioActual,
      fechaVencimientoInventarioActual: metrics.fechaVencimientoInventarioActual,
      loteIdObjetivo: metrics.loteIdObjetivo,
      numeroLoteInventarioActual: metrics.numeroLoteInventarioActual,
      tieneDiscrepancia
    };
  });
}

/**
 * Recalcula una fila de validación cuando el usuario cambia manualmente el código del producto o edita valores del documento
 */
export function recalculateValidationItemWithProduct(
  item: DocumentoValidacionItem,
  selectedProduct: Producto | null,
  movimientos: Movimiento[],
  consumos: RegistroConsumo[],
  isManualSelection = true
): DocumentoValidacionItem {
  const metrics = computeInventoryMetricsForProduct(selectedProduct, movimientos, consumos);
  const cantidadDoc = Number(item.cantidadDocumento || 0);
  const diferenciaCantidad = selectedProduct ? cantidadDoc - metrics.existenciaSistemaActual : cantidadDoc;
  const diferenciaFisica = selectedProduct ? cantidadDoc - metrics.existenciaFisicaActual : cantidadDoc;

  const costDiffers =
    item.costoDocumento !== undefined &&
    item.costoDocumento > 0 &&
    metrics.costoInventarioActual !== undefined &&
    Math.abs(item.costoDocumento - metrics.costoInventarioActual) >= 0.01;

  const dateDiffers =
    Boolean(item.fechaVencimientoDocumento) &&
    Boolean(metrics.fechaVencimientoInventarioActual) &&
    item.fechaVencimientoDocumento !== metrics.fechaVencimientoInventarioActual;

  const tieneDiscrepancia =
    !selectedProduct || diferenciaCantidad !== 0 || Boolean(costDiffers) || Boolean(dateDiffers);

  return {
    ...item,
    productoCodigoSeleccionado: selectedProduct?.codigo || "",
    productoNombreInventario: selectedProduct?.nombre,
    unidadMedidaInventario: metrics.unidadMedidaInventario,
    nivelCoincidencia: isManualSelection ? (selectedProduct ? 100 : 0) : item.nivelCoincidencia,
    razonCoincidencia: isManualSelection
      ? selectedProduct
        ? "Seleccionado manualmente por el usuario"
        : "Desvinculado manualmente"
      : item.razonCoincidencia,
    fueCorregidoManualmente: isManualSelection,
    existenciaSistemaActual: metrics.existenciaSistemaActual,
    existenciaFisicaActual: metrics.existenciaFisicaActual,
    diferenciaCantidad,
    diferenciaFisica,
    consumoRegistradoTotal: metrics.consumoRegistradoTotal,
    consumoMovimientosCount: metrics.consumoMovimientosCount,
    costoInventarioActual: metrics.costoInventarioActual,
    fechaVencimientoInventarioActual: metrics.fechaVencimientoInventarioActual,
    loteIdObjetivo: metrics.loteIdObjetivo,
    numeroLoteInventarioActual: metrics.numeroLoteInventarioActual,
    tieneDiscrepancia
  };
}

// ============================================================================
// PARSERS DE DOCUMENTOS: EXCEL, PDF, WORD (.DOCX/.DOC) E IMÁGENES (OCR + IA)
// ============================================================================

export function classifyValidationHeader(raw: any): string | null {
  const norm = normalizeTextBasic(String(raw ?? ""));
  if (!norm) return null;

  if (
    norm === "item" ||
    norm === "no" ||
    norm === "n" ||
    norm === "num" ||
    norm === "numero" ||
    norm === "no item" ||
    norm === "n de item" ||
    norm === "numero de item" ||
    norm === "renglon" ||
    norm === "codigo" ||
    norm === "cod"
  ) {
    return "item";
  }

  if (
    norm === "suministro" ||
    norm === "suministros" ||
    norm === "nombre" ||
    norm === "nombres" ||
    norm === "producto" ||
    norm === "productos" ||
    norm === "medicamento" ||
    norm === "medicamentos" ||
    norm === "articulo" ||
    norm === "articulos" ||
    norm === "insumo" ||
    norm === "insumos" ||
    norm.includes("nombre del producto") ||
    norm.includes("descripcion del producto")
  ) {
    return "name";
  }

  if (
    norm === "u de emision" ||
    norm === "u. de emision" ||
    norm === "unidad de emision" ||
    norm === "unidad de medida" ||
    norm === "u de medida" ||
    norm === "u.m." ||
    norm === "um" ||
    norm === "unidad" ||
    norm === "presentacion" ||
    norm === "forma farmaceutica"
  ) {
    return "unit";
  }

  if (norm === "descripcion" || norm === "detalle" || norm === "especificacion") {
    return "description";
  }

  if (
    norm === "n de lote" ||
    norm === "no de lote" ||
    norm === "numero de lote" ||
    norm === "lote" ||
    norm === "lote del producto"
  ) {
    return "lot";
  }

  if (
    norm === "fecha vto" ||
    norm === "fecha vto." ||
    norm === "fecha de vencimiento" ||
    norm === "fecha vencimiento" ||
    norm === "vencimiento" ||
    norm === "vence" ||
    norm === "exp" ||
    norm === "expira" ||
    norm === "fecha"
  ) {
    return "date";
  }

  if (
    norm === "cantidad" ||
    norm === "cant" ||
    norm === "cant." ||
    norm === "unidades" ||
    norm === "existencia" ||
    norm === "stock" ||
    norm === "conteo"
  ) {
    return "qty";
  }

  if (
    norm === "costo unit" ||
    norm === "costo unit." ||
    norm === "costo unitario" ||
    norm === "precio unitario" ||
    norm === "precio unit" ||
    norm === "precio" ||
    norm === "costo" ||
    norm === "valor unitario"
  ) {
    return "price";
  }

  return null;
}

export function normalizeValidationDate(rawVal: any): string {
  if (rawVal === undefined || rawVal === null || rawVal === "") return "";
  if (typeof rawVal === "number" && rawVal > 20000 && rawVal < 90000) {
    const utcDays = Math.floor(rawVal - 25569);
    const date = new Date(utcDays * 86400 * 1000);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split("T")[0];
    }
  }
  const str = String(rawVal).trim();
  if (!str) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const d = dmy[1].padStart(2, "0");
    const m = dmy[2].padStart(2, "0");
    let y = dmy[3];
    if (y.length === 2) y = `20${y}`;
    const mNum = parseInt(m, 10);
    const dNum = parseInt(d, 10);
    if (mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
      return `${y}-${m}-${d}`;
    }
    if (dNum >= 1 && dNum <= 12 && mNum >= 1 && mNum <= 31) {
      return `${y}-${d}-${m}`;
    }
  }

  const ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }

  const monthMap: Record<string, string> = {
    ene: "01",
    jan: "01",
    feb: "02",
    mar: "03",
    abr: "04",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    ago: "08",
    aug: "08",
    sep: "09",
    set: "09",
    oct: "10",
    nov: "11",
    dic: "12",
    dec: "12"
  };
  const mY = str.toLowerCase().match(/([a-z]{3})[a-z]*[\s\/\-]+(\d{2,4})/);
  if (mY && monthMap[mY[1]]) {
    let year = mY[2];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${monthMap[mY[1]]}-28`;
  }

  return "";
}

export function parseNumericValue(rawVal: any): number {
  if (typeof rawVal === "number") return isNaN(rawVal) ? 0 : rawVal;
  const str = String(rawVal ?? "")
    .replace(/RD\$|US\$|\$/gi, "")
    .trim();
  if (!str) return 0;

  let clean = str.replace(/\s+/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(clean)) {
    clean = clean.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(clean)) {
    clean = clean.replace(/,/g, "");
  } else if (clean.includes(",") && !clean.includes(".")) {
    clean = clean.replace(",", ".");
  }
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

/**
 * Convierte una matriz 2D (de Excel, PDF o tabla de Word) en RawExtractedDocItem[]
 */
export function parseMatrixToValidationItems(matrix: any[][]): RawExtractedDocItem[] {
  if (!matrix || matrix.length === 0) return [];

  let headerRowIdx = -1;
  let bestScore = 0;
  let colMap: Record<string, number> = {};

  for (let r = 0; r < Math.min(matrix.length, 35); r++) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;
    const candidateMap: Record<string, number> = {};
    let score = 0;

    row.forEach((cell, cIdx) => {
      const cat = classifyValidationHeader(cell);
      if (cat && candidateMap[cat] === undefined) {
        candidateMap[cat] = cIdx;
        score += cat === "name" || cat === "qty" || cat === "description" ? 2 : 1;
      }
    });

    if (score > bestScore && (candidateMap.name !== undefined || candidateMap.description !== undefined)) {
      bestScore = score;
      headerRowIdx = r;
      colMap = candidateMap;
    }
  }

  const items: RawExtractedDocItem[] = [];

  if (headerRowIdx !== -1) {
    // Verificar si el nombre del producto está bajo la columna llamada "Descripción"
    let nameCol = colMap.name;
    let unitCol = colMap.unit;
    const descCol = colMap.description;

    if (nameCol === undefined && descCol !== undefined) {
      nameCol = descCol;
    } else if (nameCol !== undefined && descCol !== undefined) {
      // Inspeccionar primeras filas de datos por si "Suministro/Código" trae códigos cortos y "Descripción" trae el nombre del medicamento
      let nameLooksLikeCode = 0;
      let descLooksLikeProductName = 0;
      for (let r = headerRowIdx + 1; r < Math.min(matrix.length, headerRowIdx + 12); r++) {
        const row = matrix[r] || [];
        const vName = String(row[nameCol] ?? "").trim();
        const vDesc = String(row[descCol] ?? "").trim();
        if (vName && /^[A-Z0-9\-]{1,8}$/i.test(vName) && !/\s/.test(vName)) nameLooksLikeCode++;
        if (vDesc && vDesc.length >= 6 && /[a-zA-Z]{3,}/.test(vDesc)) descLooksLikeProductName++;
      }
      if (nameLooksLikeCode >= 2 && descLooksLikeProductName >= 2) {
        if (colMap.item === undefined) colMap.item = nameCol;
        nameCol = descCol;
      } else if (unitCol === undefined) {
        unitCol = descCol;
      }
    }

    for (let r = headerRowIdx + 1; r < matrix.length; r++) {
      const row = matrix[r];
      if (!Array.isArray(row) || row.every((c) => String(c ?? "").trim() === "")) continue;

      const rawName = nameCol !== undefined ? String(row[nameCol] ?? "").trim() : "";
      if (!rawName || rawName.length < 2) continue;
      if (/^(total|subtotal|pagina|página|firma|observaciones)\b/i.test(rawName)) continue;

      const rawItemNum =
        colMap.item !== undefined ? String(row[colMap.item] ?? "").trim() : String(items.length + 1);
      let rawUnit = unitCol !== undefined ? String(row[unitCol] ?? "").trim() : "";
      if (!rawUnit) {
        const detectedPres = extractNormalizedPresentations(rawName);
        rawUnit =
          detectedPres.length > 0
            ? detectedPres[0].charAt(0).toUpperCase() + detectedPres[0].slice(1)
            : "Unidad";
      }

      const qty = colMap.qty !== undefined ? parseNumericValue(row[colMap.qty]) : 0;
      const price = colMap.price !== undefined ? parseNumericValue(row[colMap.price]) : undefined;
      const dateStr = colMap.date !== undefined ? normalizeValidationDate(row[colMap.date]) : "";
      const lotStr = colMap.lot !== undefined ? String(row[colMap.lot] ?? "").trim() : "";

      items.push({
        numeroItem: rawItemNum || String(items.length + 1),
        nombreProducto: rawName,
        unidadMedida: rawUnit || "Unidad",
        cantidad: qty,
        costoUnitario: price && price > 0 ? price : undefined,
        fechaVencimiento: dateStr || undefined,
        lote: lotStr || undefined
      });
    }
  }

  // Fallback si la matriz no tenía encabezados estándar: analizar fila por fila
  if (items.length === 0) {
    const lines = matrix
      .map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? "").trim()).filter(Boolean).join(" | ") : ""))
      .filter(Boolean);
    return parseFreeTextLinesToItems(lines);
  }

  return items;
}

/**
 * Extrae ítems de líneas de texto libre (provenientes de OCR de fotografías, párrafos de Word o PDF sin bordes de tabla)
 */
export function parseFreeTextLinesToItems(lines: string[]): RawExtractedDocItem[] {
  const items: RawExtractedDocItem[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line.length < 4) continue;
    if (/^(item|n[°ºo]|codigo|suministro|producto|medicamento|factura|fecha|rnc|telefono|direccion|total|subtotal)\b/i.test(line)) {
      // Si la línea es solo un encabezado con múltiples columnas, omitirla
      const tokens = line.split(/[\s|;,\t]+/);
      const headerHits = tokens.filter((t) => classifyValidationHeader(t) !== null).length;
      if (headerHits >= 2) continue;
    }

    // Buscar fecha si existe en la línea
    let fechaVencimiento = "";
    let working = line;
    const dateMatch = working.match(
      /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/
    );
    if (dateMatch) {
      fechaVencimiento = normalizeValidationDate(dateMatch[1]);
      working = working.replace(dateMatch[0], " ").trim();
    }

    // Buscar número de ítem inicial (ej: "1.", "01 -", "A102 |")
    let numeroItem = String(items.length + 1);
    const leadingItemMatch = working.match(/^(\d{1,4}|[A-Z]{1,3}-?\d{1,5})(?:[.\-)|:]|\s+\|\s+|\s+)/i);
    if (leadingItemMatch) {
      numeroItem = leadingItemMatch[1].trim();
      working = working.slice(leadingItemMatch[0].length).trim();
    }

    // Buscar costo explícito con RD$ / $ o decimal al final
    let costoUnitario: number | undefined;
    const priceMatch = working.match(/(?:RD\$|US\$|\$)\s*(\d+(?:[.,]\d+)*)/i);
    if (priceMatch) {
      costoUnitario = parseNumericValue(priceMatch[1]);
      working = working.replace(priceMatch[0], " ").trim();
    }

    // Separar por delimitadores si existen ("|", "\t", ";") o analizar números al final
    const segments = working
      .split(/\s*\|\s*|\t+|\s*;\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (segments.length >= 2) {
      const nameSeg = segments[0];
      if (!/[a-zA-Z]{3,}/.test(nameSeg)) continue;
      let unidadMedida = "";
      let cantidad = 0;

      for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];
        const pres = extractNormalizedPresentations(seg);
        if (!unidadMedida && pres.length > 0 && !/^\d+$/.test(seg)) {
          unidadMedida = seg;
          continue;
        }
        const num = parseNumericValue(seg);
        if (num > 0 && cantidad === 0) {
          cantidad = num;
        } else if (num > 0 && costoUnitario === undefined) {
          costoUnitario = num;
        }
      }

      if (!unidadMedida) {
        const presFromName = extractNormalizedPresentations(nameSeg);
        unidadMedida =
          presFromName.length > 0
            ? presFromName[0].charAt(0).toUpperCase() + presFromName[0].slice(1)
            : "Unidad";
      }

      if (cantidad > 0 || extractNormalizedConcentrations(nameSeg).length > 0) {
        items.push({
          numeroItem,
          nombreProducto: nameSeg,
          unidadMedida,
          cantidad: cantidad || 1,
          costoUnitario,
          fechaVencimiento: fechaVencimiento || undefined
        });
      }
      continue;
    }

    // Línea sin separadores "|": buscar cantidad al final (ej. "Paracetamol 500 mg Comprimido 150 12.50")
    if (!/[a-zA-Z]{3,}/.test(working)) continue;
    const trailingNums = Array.from(
      working.matchAll(/(?:Cant(?:idad)?[:.]?\s*)?(\d+(?:[.,]\d+)?)\s*(?:unds?|unidades|cajas?|fcos?|amp|comp|tab)?$/i)
    );
    let cantidad = 0;
    if (trailingNums.length > 0) {
      const lastMatch = trailingNums[trailingNums.length - 1];
      cantidad = parseNumericValue(lastMatch[1]);
      working = working.slice(0, lastMatch.index).trim();
    }

    // Verificar si quedó otro número al final (ej. Cantidad + Costo)
    const secondTrailing = working.match(/\s+(\d+(?:[.,]\d+)?)$/);
    if (secondTrailing && cantidad > 0 && costoUnitario === undefined) {
      const firstNum = parseNumericValue(secondTrailing[1]);
      // Si el primero es entero y el último tenía decimales, el primero es cantidad y el último es costo
      if (Number.isInteger(firstNum) && firstNum > 0) {
        costoUnitario = cantidad;
        cantidad = firstNum;
        working = working.slice(0, secondTrailing.index).trim();
      }
    }

    const cleanName = working.replace(/[|;,\-]+$/, "").trim();
    if (cleanName.length >= 3 && (cantidad > 0 || extractNormalizedConcentrations(cleanName).length > 0)) {
      const pres = extractNormalizedPresentations(cleanName);
      items.push({
        numeroItem,
        nombreProducto: cleanName,
        unidadMedida:
          pres.length > 0 ? pres[0].charAt(0).toUpperCase() + pres[0].slice(1) : "Unidad",
        cantidad: cantidad || 1,
        costoUnitario,
        fechaVencimiento: fechaVencimiento || undefined
      });
    }
  }

  return items;
}

/**
 * Descomprime y extrae tablas (<w:tbl>) y párrafos (<w:p>) desde un archivo Microsoft Word (.docx)
 * 100% en el navegador usando DecompressionStream("deflate-raw").
 */
export async function extractWordDocxContent(
  arrayBuffer: ArrayBuffer
): Promise<{ matrices: string[][][]; lines: string[] }> {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);

  // Verificar firma PKZIP (0x04034b50)
  if (bytes.length >= 4 && view.getUint32(0, true) === 0x04034b50) {
    let offset = 0;
    let documentXmlText = "";

    while (offset + 30 <= bytes.length) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;

      const compressionMethod = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const fileNameLength = view.getUint16(offset + 26, true);
      const extraFieldLength = view.getUint16(offset + 28, true);

      const nameStart = offset + 30;
      const nameBytes = bytes.subarray(nameStart, nameStart + fileNameLength);
      const entryName = new TextDecoder("utf-8").decode(nameBytes);

      const dataStart = nameStart + fileNameLength + extraFieldLength;
      const dataEnd = dataStart + compressedSize;

      if (entryName === "word/document.xml" && dataEnd <= bytes.length) {
        const entrySlice = bytes.subarray(dataStart, dataEnd);
        if (compressionMethod === 0) {
          documentXmlText = new TextDecoder("utf-8").decode(entrySlice);
        } else if (compressionMethod === 8 && typeof DecompressionStream !== "undefined") {
          try {
            const ds = new DecompressionStream("deflate-raw");
            const writer = ds.writable.getWriter();
            writer.write(entrySlice).catch(() => {});
            writer.close().catch(() => {});
            const reader = ds.readable.getReader();
            const chunks: Uint8Array[] = [];
            let total = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                chunks.push(value);
                total += value.length;
              }
            }
            const out = new Uint8Array(total);
            let pos = 0;
            for (const c of chunks) {
              out.set(c, pos);
              pos += c.length;
            }
            documentXmlText = new TextDecoder("utf-8").decode(out);
          } catch {}
        }
        break;
      }

      if (compressedSize === 0) break;
      offset = dataEnd;
    }

    if (documentXmlText) {
      const extractTextFromXmlFragment = (xmlFrag: string): string => {
        const texts: string[] = [];
        const tRegex = /<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g;
        let m: RegExpExecArray | null;
        while ((m = tRegex.exec(xmlFrag)) !== null) {
          texts.push(
            m[1]
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&apos;/g, "'")
          );
        }
        return texts.join("").replace(/\s+/g, " ").trim();
      };

      const matrices: string[][][] = [];
      const tblRegex = /<w:tbl\b[\s\S]*?<\/w:tbl>/g;
      let tblMatch: RegExpExecArray | null;
      while ((tblMatch = tblRegex.exec(documentXmlText)) !== null) {
        const tblXml = tblMatch[0];
        const rows: string[][] = [];
        const trRegex = /<w:tr\b[\s\S]*?<\/w:tr>/g;
        let trMatch: RegExpExecArray | null;
        while ((trMatch = trRegex.exec(tblXml)) !== null) {
          const cells: string[] = [];
          const tcRegex = /<w:tc\b[\s\S]*?<\/w:tc>/g;
          let tcMatch: RegExpExecArray | null;
          while ((tcMatch = tcRegex.exec(trMatch[0])) !== null) {
            cells.push(extractTextFromXmlFragment(tcMatch[0]));
          }
          if (cells.some((c) => c !== "")) {
            rows.push(cells);
          }
        }
        if (rows.length > 0) {
          matrices.push(rows);
        }
      }

      const lines: string[] = [];
      const pRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = pRegex.exec(documentXmlText)) !== null) {
        const line = extractTextFromXmlFragment(pMatch[0]);
        if (line) lines.push(line);
      }

      return { matrices, lines };
    }
  }

  // Fallback para archivos .doc basados en HTML / XML / texto plano
  const rawText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (rawText.includes("<table") || rawText.includes("<tr")) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawText, "text/html");
    const matrices: string[][][] = [];
    doc.querySelectorAll("table").forEach((tbl) => {
      const rows: string[][] = [];
      tbl.querySelectorAll("tr").forEach((tr) => {
        const cells: string[] = [];
        tr.querySelectorAll("th, td").forEach((td) => {
          cells.push((td.textContent || "").replace(/\s+/g, " ").trim());
        });
        if (cells.some(Boolean)) rows.push(cells);
      });
      if (rows.length > 0) matrices.push(rows);
    });
    const lines = (doc.body?.innerText || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return { matrices, lines };
  }

  const cleanLines = rawText
    .replace(/[^\x20-\x7E\xA0-\xFF\r\n\t]/g, " ")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 4);

  return { matrices: [], lines: cleanLines };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(sub));
  }
  return btoa(binary);
}

/**
 * Intenta extraer ítems mediante el endpoint de IA y OCR del servidor (/api/validacion/ocr-ai)
 */
async function tryServerGeminiOcrAi(payload: {
  base64Data?: string;
  mimeType?: string;
  extractedText?: string;
  fileName: string;
}): Promise<RawExtractedDocItem[] | null> {
  if (typeof window !== "undefined" && window.location.protocol === "file:") {
    return null;
  }
  try {
    const resp = await fetch("/api/validacion/ocr-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data?.ok && Array.isArray(data.items) && data.items.length > 0) {
      return data.items.map((it: any, idx: number) => ({
        numeroItem: String(it.numeroItem || idx + 1),
        nombreProducto: String(it.nombreProducto || "").trim(),
        unidadMedida: String(it.unidadMedida || "Unidad").trim(),
        cantidad: Number(it.cantidad || 0),
        costoUnitario: it.costoUnitario && Number(it.costoUnitario) > 0 ? Number(it.costoUnitario) : undefined,
        fechaVencimiento: normalizeValidationDate(it.fechaVencimiento) || undefined,
        lote: it.lote ? String(it.lote).trim() : undefined
      }));
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ejecuta OCR local en el navegador con Tesseract.js sobre una imagen (cuando el servidor IA no está disponible)
 */
async function runBrowserTesseractOcr(
  imageDataUrl: string,
  onProgress?: (statusText: string) => void
): Promise<string> {
  try {
    onProgress?.("Iniciando motor OCR óptico en español...");
    const Tesseract = await import("tesseract.js");
    const recognizeFn = Tesseract.recognize || (Tesseract as any).default?.recognize;
    if (!recognizeFn) return "";

    const result = await recognizeFn(imageDataUrl, "spa", {
      logger: (m: any) => {
        if (m?.status === "recognizing text" && typeof m.progress === "number") {
          onProgress?.(`Escaneando texto con OCR (${Math.round(m.progress * 100)}%)...`);
        }
      }
    });
    return result?.data?.text || "";
  } catch (err) {
    console.warn("Error en OCR local Tesseract:", err);
    return "";
  }
}

/**
 * Función principal para procesar cualquier archivo (PDF, Word, Excel o Imagen) y extraer sus ítems para validación
 */
export async function extractItemsFromValidationDocument(
  file: File,
  onProgress?: (statusText: string) => void
): Promise<DocumentExtractionOutput> {
  const fileName = file.name || "documento";
  const lower = fileName.toLowerCase();
  const mime = file.type || "";

  // 1. EXCEL / CSV (.xlsx, .xls, .csv)
  if (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    lower.endsWith(".csv") ||
    mime.includes("spreadsheet") ||
    mime.includes("excel")
  ) {
    onProgress?.("Leyendo libro de Excel y analizando columnas...");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    let allItems: RawExtractedDocItem[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
      const parsed = parseMatrixToValidationItems(matrix);
      if (parsed.length > 0) {
        allItems = [...allItems, ...parsed];
      }
    }

    return {
      tipoDocumento: "Excel",
      metodoExtraccion: "PARSER_ESTRUCTURADO",
      rawItems: allItems
    };
  }

  // 2. WORD (.docx, .doc, .rtf)
  if (
    lower.endsWith(".docx") ||
    lower.endsWith(".doc") ||
    lower.endsWith(".rtf") ||
    mime.includes("word") ||
    mime.includes("officedocument.wordprocessingml")
  ) {
    onProgress?.("Extrayendo tablas y contenido del documento Word...");
    const buffer = await file.arrayBuffer();
    const { matrices, lines } = await extractWordDocxContent(buffer);

    let items: RawExtractedDocItem[] = [];
    for (const mat of matrices) {
      const parsed = parseMatrixToValidationItems(mat);
      if (parsed.length > 0) {
        items = [...items, ...parsed];
      }
    }

    const joinedText = lines.join("\n");
    if (items.length === 0 && joinedText.trim().length > 0) {
      onProgress?.("Analizando estructura del documento Word con IA...");
      const aiItems = await tryServerGeminiOcrAi({
        extractedText: joinedText,
        fileName
      });
      if (aiItems && aiItems.length > 0) {
        return {
          tipoDocumento: "Word",
          metodoExtraccion: "IA_OCR",
          rawItems: aiItems,
          textoCrudo: joinedText
        };
      }
      items = parseFreeTextLinesToItems(lines);
    }

    return {
      tipoDocumento: "Word",
      metodoExtraccion: "PARSER_ESTRUCTURADO",
      rawItems: items,
      textoCrudo: joinedText
    };
  }

  // 3. PDF (.pdf)
  if (lower.endsWith(".pdf") || mime === "application/pdf") {
    onProgress?.("Escaneando páginas y tablas del documento PDF...");
    const buffer = await file.arrayBuffer();
    const pdfResult = await extractTableMatrixFromPdf(buffer, classifyValidationHeader);
    let items = parseMatrixToValidationItems(pdfResult.matrix);

    const flatText = pdfResult.matrix.map((r) => r.join(" | ")).join("\n");

    // Si el PDF es escaneado o tiene estructura compleja, usar Gemini IA multimodal
    if (items.length === 0) {
      onProgress?.("Analizando documento PDF mediante OCR e Inteligencia Artificial...");
      const base64Data = arrayBufferToBase64(buffer);
      const aiItems = await tryServerGeminiOcrAi({
        base64Data,
        mimeType: "application/pdf",
        extractedText: flatText || undefined,
        fileName
      });
      if (aiItems && aiItems.length > 0) {
        return {
          tipoDocumento: "PDF",
          metodoExtraccion: "IA_OCR",
          rawItems: aiItems,
          textoCrudo: flatText
        };
      }
    }

    return {
      tipoDocumento: "PDF",
      metodoExtraccion: "PARSER_ESTRUCTURADO",
      rawItems: items,
      textoCrudo: flatText
    };
  }

  // 4. IMÁGENES / FOTOGRAFÍAS (.jpg, .jpeg, .png, .webp)
  onProgress?.("Procesando fotografía mediante OCR e Inteligencia Artificial...");
  const buffer = await file.arrayBuffer();
  const base64Data = arrayBufferToBase64(buffer);
  const effectiveMime = mime || "image/jpeg";
  const previewImageUrl = `data:${effectiveMime};base64,${base64Data}`;

  // 4a. Intentar primero con Gemini Vision OCR en el servidor
  const aiItems = await tryServerGeminiOcrAi({
    base64Data,
    mimeType: effectiveMime,
    fileName
  });

  if (aiItems && aiItems.length > 0) {
    return {
      tipoDocumento: "Imagen",
      metodoExtraccion: "IA_OCR",
      rawItems: aiItems,
      previewImageUrl
    };
  }

  // 4b. Fallback OCR local en navegador con Tesseract.js
  const ocrText = await runBrowserTesseractOcr(previewImageUrl, onProgress);
  const ocrLines = ocrText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const localOcrItems = parseFreeTextLinesToItems(ocrLines);

  return {
    tipoDocumento: "Imagen",
    metodoExtraccion: "OCR_LOCAL",
    rawItems: localOcrItems,
    textoCrudo: ocrText,
    previewImageUrl
  };
}
