import {
  CategoriaConsumo,
  ConsumoItem,
  Departamento,
  Movimiento,
  Producto,
  RegistroConsumo,
  ResponsableDepartamento,
  TipoConsumoConfig
} from "../types";
import { db, DEFAULT_FARMACIA_ID, getActiveFarmaciaId, tenantCollection, tenantDoc } from "../firebase";
import { doc, getDocs, runTransaction, setDoc } from "firebase/firestore";

export const DEPARTAMENTOS_BASE_REQUERIDOS = [
  "Farmacia",
  "Laboratorio",
  "Enfermería",
  "Administración",
  "Emergencia"
] as const;

export function normalizeTextToken(value: string | undefined | null): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Combina los departamentos existentes con los departamentos base requeridos
 * sin duplicar los que ya existan (comparación insensible a mayúsculas/acentos).
 */
export function mergeDepartamentosSinDuplicados(
  existing: Departamento[] = [],
  extraNames: string[] = []
): Departamento[] {
  const result: Departamento[] = [...existing];
  const seen = new Set<string>(existing.map((d) => normalizeTextToken(d.nombre)));

  const allCandidates = [...DEPARTAMENTOS_BASE_REQUERIDOS, ...extraNames];
  for (const baseName of allCandidates) {
    const token = normalizeTextToken(baseName);
    if (token && !seen.has(token)) {
      seen.add(token);
      result.push({
        id: `dept-${token.replace(/[^a-z0-9]/g, "-")}`,
        nombre: baseName,
        activo: true,
        createdAt: 1700000000000
      });
    }
  }

  return result.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export function getDefaultTiposConsumo(sedeId: string = DEFAULT_FARMACIA_ID): TipoConsumoConfig[] {
  return [
    {
      id: "tipo-interno",
      codigo: "INTERNO",
      nombre: "Interno",
      categoria: "Interno",
      descripcion: "Consumo realizado para uso dentro de la institución o entre sus departamentos internos.",
      requiereDestinoExterno: false,
      activo: true,
      sedeId,
      createdAt: 1700000000000
    },
    {
      id: "tipo-externo",
      codigo: "EXTERNO",
      nombre: "Externo",
      categoria: "Externo",
      descripcion: "Salida o entrega destinada a uso externo, operativo externo, centro receptor o apoyo interinstitucional.",
      requiereDestinoExterno: true,
      activo: true,
      sedeId,
      createdAt: 1700000001000
    }
  ];
}

export function getDefaultResponsables(sedeId: string = DEFAULT_FARMACIA_ID): ResponsableDepartamento[] {
  return [
    {
      id: "resp-iris-aybar",
      nombre: "Lic. Iris Aybar",
      cargo: "Encargada / Responsable Departamental",
      departamentoId: "dept-enfermeria",
      departamentoNombre: "Enfermería",
      sedeId,
      telefono: "",
      correo: "",
      permitirAsignacionEspecial: false,
      activo: true,
      createdAt: 1700000000000,
      creadoPor: "Sistema (Registro Inicial)"
    }
  ];
}

function getResponsablesStorageKey(sedeId?: string): string {
  const tenant = (sedeId || getActiveFarmaciaId() || DEFAULT_FARMACIA_ID).trim();
  return `consumos_responsables_${tenant}`;
}

function getTiposConsumoStorageKey(sedeId?: string): string {
  const tenant = (sedeId || getActiveFarmaciaId() || DEFAULT_FARMACIA_ID).trim();
  return `consumos_tipos_${tenant}`;
}

function getConsumosHistoryStorageKey(sedeId?: string): string {
  const tenant = (sedeId || getActiveFarmaciaId() || DEFAULT_FARMACIA_ID).trim();
  return `consumos_registros_${tenant}`;
}

/**
 * Garantiza que "Lic. Iris Aybar" siempre exista en la lista de responsables de la sede.
 */
export function ensureLicIrisAybarPresent(
  list: ResponsableDepartamento[],
  sedeId: string = DEFAULT_FARMACIA_ID
): ResponsableDepartamento[] {
  const hasIris = list.some(
    (r) =>
      r.id === "resp-iris-aybar" ||
      normalizeTextToken(r.nombre) === normalizeTextToken("Lic. Iris Aybar")
  );
  if (hasIris) {
    return list;
  }
  return [...getDefaultResponsables(sedeId), ...list];
}

export function ensureDefaultTiposConsumoPresent(
  list: TipoConsumoConfig[],
  sedeId: string = DEFAULT_FARMACIA_ID
): TipoConsumoConfig[] {
  const defaults = getDefaultTiposConsumo(sedeId);
  const result = [...list];
  for (const def of defaults) {
    const exists = result.some(
      (t) =>
        t.id === def.id ||
        normalizeTextToken(t.codigo) === normalizeTextToken(def.codigo) ||
        normalizeTextToken(t.nombre) === normalizeTextToken(def.nombre)
    );
    if (!exists) {
      result.unshift(def);
    }
  }
  return result;
}

export function loadLocalResponsables(sedeId?: string): ResponsableDepartamento[] {
  const tenant = (sedeId || getActiveFarmaciaId() || DEFAULT_FARMACIA_ID).trim();
  if (typeof window === "undefined" || !window.localStorage) {
    return getDefaultResponsables(tenant);
  }
  try {
    const raw = localStorage.getItem(getResponsablesStorageKey(tenant));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return ensureLicIrisAybarPresent(parsed, tenant);
      }
    }
  } catch {}
  const initial = getDefaultResponsables(tenant);
  try {
    localStorage.setItem(getResponsablesStorageKey(tenant), JSON.stringify(initial));
  } catch {}
  return initial;
}

export function saveLocalResponsables(list: ResponsableDepartamento[], sedeId?: string): ResponsableDepartamento[] {
  const tenant = (sedeId || getActiveFarmaciaId() || DEFAULT_FARMACIA_ID).trim();
  const normalized = ensureLicIrisAybarPresent(list, tenant);
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(getResponsablesStorageKey(tenant), JSON.stringify(normalized));
      window.dispatchEvent(new Event("consumos_config_updated"));
    } catch {}
  }
  return normalized;
}

export function loadLocalTiposConsumo(sedeId?: string): TipoConsumoConfig[] {
  const tenant = (sedeId || getActiveFarmaciaId() || DEFAULT_FARMACIA_ID).trim();
  if (typeof window === "undefined" || !window.localStorage) {
    return getDefaultTiposConsumo(tenant);
  }
  try {
    const raw = localStorage.getItem(getTiposConsumoStorageKey(tenant));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return ensureDefaultTiposConsumoPresent(parsed, tenant);
      }
    }
  } catch {}
  const initial = getDefaultTiposConsumo(tenant);
  try {
    localStorage.setItem(getTiposConsumoStorageKey(tenant), JSON.stringify(initial));
  } catch {}
  return initial;
}

export function saveLocalTiposConsumo(list: TipoConsumoConfig[], sedeId?: string): TipoConsumoConfig[] {
  const tenant = (sedeId || getActiveFarmaciaId() || DEFAULT_FARMACIA_ID).trim();
  const normalized = ensureDefaultTiposConsumoPresent(list, tenant);
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(getTiposConsumoStorageKey(tenant), JSON.stringify(normalized));
      window.dispatchEvent(new Event("consumos_config_updated"));
    } catch {}
  }
  return normalized;
}

export function loadLocalConsumos(sedeId?: string): RegistroConsumo[] {
  const tenant = (sedeId || getActiveFarmaciaId() || DEFAULT_FARMACIA_ID).trim();
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  try {
    const raw = localStorage.getItem(getConsumosHistoryStorageKey(tenant));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      }
    }
  } catch {}
  return [];
}

export function saveLocalConsumos(list: RegistroConsumo[], sedeId?: string): RegistroConsumo[] {
  const tenant = (sedeId || getActiveFarmaciaId() || DEFAULT_FARMACIA_ID).trim();
  const sorted = [...list].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      localStorage.setItem(getConsumosHistoryStorageKey(tenant), JSON.stringify(sorted));
      window.dispatchEvent(new Event("consumos_registros_updated"));
    } catch {}
  }
  return sorted;
}

/**
 * Sincroniza configuración de responsables y tipos de consumo con Firestore y localStorage
 */
export async function persistConsumosConfig(
  responsables: ResponsableDepartamento[],
  tiposConsumo: TipoConsumoConfig[],
  sedeId?: string
): Promise<void> {
  const tenant = (sedeId || getActiveFarmaciaId() || DEFAULT_FARMACIA_ID).trim();
  const cleanResp = saveLocalResponsables(responsables, tenant);
  const cleanTipos = saveLocalTiposConsumo(tiposConsumo, tenant);

  const canSyncFirestore = typeof window !== "undefined" && window.location.protocol !== "file:";
  if (canSyncFirestore) {
    try {
      await setDoc(
        tenantDoc("configuracion", "consumos_config", tenant),
        {
          responsables: cleanResp,
          tiposConsumo: cleanTipos,
          updatedAt: Date.now()
        },
        { merge: true }
      );
    } catch (err) {
      console.warn("Aviso al sincronizar configuración de consumos en Firestore:", err);
    }
  }
}

/**
 * Registra un nuevo responsable rápidamente desde el botón "Nuevo" en Consumos o Pedidos
 */
export async function registrarNuevoResponsableRapido(params: {
  nombre: string;
  departamentoNombre: string;
  departamentoId?: string;
  cargo?: string;
  telefono?: string;
  correo?: string;
  sedeId?: string;
  creadoPor?: string;
  existingResponsables?: ResponsableDepartamento[];
}): Promise<{ exito: boolean; responsable?: ResponsableDepartamento; listaActualizada: ResponsableDepartamento[]; error?: string }> {
  const tenant = (params.sedeId || getActiveFarmaciaId() || DEFAULT_FARMACIA_ID).trim();
  const cleanName = String(params.nombre || "").trim();
  const cleanDept = String(params.departamentoNombre || "").trim();

  if (!cleanName) {
    return {
      exito: false,
      listaActualizada: params.existingResponsables || loadLocalResponsables(tenant),
      error: "El nombre del responsable es obligatorio."
    };
  }

  if (!cleanDept) {
    return {
      exito: false,
      listaActualizada: params.existingResponsables || loadLocalResponsables(tenant),
      error: "Debe seleccionar un departamento para asociar al responsable."
    };
  }

  const currentList = params.existingResponsables
    ? ensureLicIrisAybarPresent(params.existingResponsables, tenant)
    : loadLocalResponsables(tenant);

  const duplicate = currentList.find(
    (r) =>
      normalizeTextToken(r.nombre) === normalizeTextToken(cleanName) &&
      normalizeTextToken(r.departamentoNombre) === normalizeTextToken(cleanDept)
  );

  if (duplicate) {
    if (!duplicate.activo) {
      const reactivated = currentList.map((r) =>
        r.id === duplicate.id ? { ...r, activo: true, updatedAt: Date.now() } : r
      );
      await persistConsumosConfig(reactivated, loadLocalTiposConsumo(tenant), tenant);
      return {
        exito: true,
        responsable: { ...duplicate, activo: true },
        listaActualizada: reactivated
      };
    }
    return {
      exito: false,
      responsable: duplicate,
      listaActualizada: currentList,
      error: `El responsable "${cleanName}" ya está registrado en el departamento "${cleanDept}".`
    };
  }

  const newResp: ResponsableDepartamento = {
    id: `resp-${normalizeTextToken(cleanName).replace(/[^a-z0-9]/g, "-")}-${Date.now().toString(36)}`,
    nombre: cleanName,
    cargo: (params.cargo || "Responsable de Recepción").trim(),
    departamentoId: params.departamentoId || `dept-${normalizeTextToken(cleanDept).replace(/[^a-z0-9]/g, "-")}`,
    departamentoNombre: cleanDept,
    sedeId: tenant,
    telefono: (params.telefono || "").trim(),
    correo: (params.correo || "").trim(),
    permitirAsignacionEspecial: false,
    activo: true,
    createdAt: Date.now(),
    creadoPor: params.creadoPor || "Sistema"
  };

  const nextList = [...currentList, newResp];
  await persistConsumosConfig(nextList, loadLocalTiposConsumo(tenant), tenant);

  return {
    exito: true,
    responsable: newResp,
    listaActualizada: nextList
  };
}

/**
 * Verifica si un responsable pertenece al departamento seleccionado o si tiene autorización especial.
 */
export function validarRelacionResponsableDepartamento(params: {
  responsable: ResponsableDepartamento | null | undefined;
  departamentoNombre: string;
  esAdmin?: boolean;
  asignacionEspecialAdmin?: boolean;
}): { valido: boolean; requiereConfirmacionEspecial?: boolean; mensaje?: string } {
  const { responsable, departamentoNombre, esAdmin, asignacionEspecialAdmin } = params;

  if (!responsable) {
    return { valido: false, mensaje: "Debe seleccionar un responsable del departamento." };
  }

  if (!responsable.activo) {
    return {
      valido: false,
      mensaje: `El responsable "${responsable.nombre}" se encuentra inactivo en Configuración.`
    };
  }

  const cleanTargetDept = normalizeTextToken(departamentoNombre);
  const cleanRespDept = normalizeTextToken(responsable.departamentoNombre);

  if (!cleanTargetDept) {
    return { valido: false, mensaje: "Debe seleccionar un departamento destinatario." };
  }

  // Coincidencia directa o parcial entre "Farmacia" y "Farmacia Clínica"
  const sameDept =
    cleanRespDept === cleanTargetDept ||
    (cleanRespDept.includes("farmacia") && cleanTargetDept.includes("farmacia")) ||
    (cleanRespDept.includes("emergencia") && cleanTargetDept.includes("urgencia")) ||
    (cleanRespDept.includes("urgencia") && cleanTargetDept.includes("emergencia"));

  if (sameDept) {
    return { valido: true };
  }

  if (responsable.permitirAsignacionEspecial || (esAdmin && asignacionEspecialAdmin)) {
    return { valido: true };
  }

  return {
    valido: false,
    requiereConfirmacionEspecial: Boolean(esAdmin),
    mensaje: `El responsable "${responsable.nombre}" está asignado al departamento "${responsable.departamentoNombre}" y no a "${departamentoNombre}".${
      esAdmin
        ? " Como Administrador, puede activar la casilla de asignación especial o cambiar el responsable."
        : " Seleccione un responsable de este departamento o registre uno con el botón «Nuevo»."
    }`
  };
}

export interface ValidacionConsumoInput {
  sedeId: string;
  departamentoNombre: string;
  responsable: ResponsableDepartamento | null | undefined;
  tipoConsumo: TipoConsumoConfig | null | undefined;
  destinoExternoInstitucion?: string;
  destinoExternoPersona?: string;
  items: ConsumoItem[];
  productosInventario: Producto[];
  esAdmin?: boolean;
  asignacionEspecialAdmin?: boolean;
  validarExistenciasInventario?: boolean;
}

export interface ValidacionConsumoResult {
  valido: boolean;
  errores: string[];
}

/**
 * Valida integralmente una operación de consumo antes de su confirmación.
 * Comprueba: sede, departamento, relación responsable-departamento, tipo de consumo
 * (incluyendo campos de destino externo si es Externo) y disponibilidad real de stock por lote.
 */
export function validateConsumoOperation(input: ValidacionConsumoInput): ValidacionConsumoResult {
  const errores: string[] = [];

  if (!String(input.sedeId || "").trim()) {
    errores.push("La sede de la operación es obligatoria.");
  }

  if (!String(input.departamentoNombre || "").trim()) {
    errores.push("Debe seleccionar el departamento destinatario del consumo.");
  }

  const relCheck = validarRelacionResponsableDepartamento({
    responsable: input.responsable,
    departamentoNombre: input.departamentoNombre,
    esAdmin: input.esAdmin,
    asignacionEspecialAdmin: input.asignacionEspecialAdmin
  });

  if (!relCheck.valido && relCheck.mensaje) {
    errores.push(relCheck.mensaje);
  }

  if (!input.tipoConsumo) {
    errores.push("Debe seleccionar el tipo de consumo (Interno o Externo).");
  } else if (!input.tipoConsumo.activo) {
    errores.push(`El tipo de consumo "${input.tipoConsumo.nombre}" se encuentra inactivo.`);
  } else if (
    input.tipoConsumo.categoria === "Externo" ||
    input.tipoConsumo.requiereDestinoExterno
  ) {
    const destInst = String(input.destinoExternoInstitucion || "").trim();
    const destPers = String(input.destinoExternoPersona || "").trim();
    if (!destInst && !destPers) {
      errores.push(
        "Para un Consumo Externo debe especificar la institución/destino externo o la persona receptora externa."
      );
    }
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    errores.push("Debe agregar al menos un producto o insumo al consumo.");
  } else {
    // Acumular cantidades por producto + lote para evitar que dos filas del mismo lote superen el stock
    const lotAccumulator = new Map<
      string,
      {
        productoCodigo: string;
        productoNombre: string;
        loteId: string;
        numeroLote: string;
        totalCantidad: number;
      }
    >();

    for (const item of input.items) {
      const qty = Number(item.cantidadEntregada || 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        errores.push(`La cantidad entregada para "${item.productoNombre}" debe ser mayor que cero.`);
        continue;
      }
      if (!item.productoCodigo) {
        errores.push("Se encontró un ítem sin código de producto válido.");
        continue;
      }
      if (!item.loteId) {
        errores.push(`Debe seleccionar un lote válido para "${item.productoNombre}".`);
        continue;
      }

      const key = `${item.productoCodigo}::${item.loteId}`;
      const prev = lotAccumulator.get(key);
      if (prev) {
        prev.totalCantidad += qty;
      } else {
        lotAccumulator.set(key, {
          productoCodigo: item.productoCodigo,
          productoNombre: item.productoNombre,
          loteId: item.loteId,
          numeroLote: item.numeroLote,
          totalCantidad: qty
        });
      }
    }

    if (input.validarExistenciasInventario !== false) {
      for (const entry of lotAccumulator.values()) {
        const prod = input.productosInventario.find((p) => p.codigo === entry.productoCodigo);
        if (!prod) {
          errores.push(`El producto "${entry.productoNombre}" (${entry.productoCodigo}) no existe en el inventario.`);
          continue;
        }
        const lot = (prod.lotes || []).find((l) => l.id === entry.loteId);
        if (!lot) {
          errores.push(
            `El lote "${entry.numeroLote}" del producto "${entry.productoNombre}" no existe en el inventario.`
          );
          continue;
        }
        const stockSistema = Number(lot.cantidad || 0);
        const stockFisico = lot.cantidadF !== undefined ? Number(lot.cantidadF) : stockSistema;
        const disponibleReal = Math.min(stockSistema, stockFisico);

        if (entry.totalCantidad > stockSistema || entry.totalCantidad > stockFisico) {
          errores.push(
            `Stock insuficiente para "${entry.productoNombre}" (Lote ${lot.numeroLote}). Solicitado: ${entry.totalCantidad} und. | Disponible: ${disponibleReal} und. (Sistema: ${stockSistema} / Físico: ${stockFisico}).`
          );
        }
      }
    }
  }

  return {
    valido: errores.length === 0,
    errores
  };
}

/**
 * Genera el próximo número correlativo de operación de consumo (ej. CON-00001)
 */
export function generarSiguienteNumeroConsumo(existentes: RegistroConsumo[]): string {
  const maxNum = (existentes || []).reduce((maxAcc, c) => {
    const match = String(c.numeroOperacion || "").match(/(\d+)/);
    const num = match ? parseInt(match[1], 10) : 0;
    return num > maxAcc ? num : maxAcc;
  }, 0);
  return `CON-${String(maxNum + 1).padStart(5, "0")}`;
}

/**
 * Construye una huella única (fingerprint) de la operación para prevenir registros duplicados
 * por doble clic o envíos simultáneos idénticos.
 */
export function buildConsumoFingerprint(params: {
  sedeId: string;
  departamentoNombre: string;
  responsableId: string;
  tipoConsumoId: string;
  origenOperacion: string;
  pedidoReferenciaId?: string;
  items: ConsumoItem[];
}): string {
  const itemsSig = [...params.items]
    .map((it) => `${it.productoCodigo}:${it.loteId}:${it.cantidadEntregada}`)
    .sort()
    .join("|");
  return [
    normalizeTextToken(params.sedeId),
    normalizeTextToken(params.departamentoNombre),
    normalizeTextToken(params.responsableId),
    normalizeTextToken(params.tipoConsumoId),
    params.origenOperacion,
    params.pedidoReferenciaId || "directo",
    itemsSig
  ].join("::");
}

// Candado en memoria contra ejecuciones simultáneas de la misma huella
const activeConsumoLocks = new Set<string>();

/**
 * Procesador atómico en memoria (utilizado en modo local/offline y en la batería de pruebas automatizadas).
 * Verifica bloqueo de concurrencia, duplicados por pedido o huella reciente, valida stock,
 * descuenta inventario cuando `descontarInventario !== false`, genera movimientos de salida y registra el consumo.
 */
export function procesarConsumoEnMemoria(params: {
  sedeId: string;
  sedeNombre: string;
  fecha?: string;
  hora?: string;
  periodo?: string;
  departamentoId?: string;
  departamentoNombre: string;
  responsable: ResponsableDepartamento;
  asignacionEspecialAdmin?: boolean;
  tipoConsumo: TipoConsumoConfig;
  destinoExternoInstitucion?: string;
  destinoExternoPersona?: string;
  destinoExternoDocumento?: string;
  catalogId: string;
  catalogNombre?: string;
  items: ConsumoItem[];
  observaciones?: string;
  usuarioRegistro: string;
  usuarioRegistroId?: string;
  rolUsuarioRegistro?: string;
  esAdmin?: boolean;
  origenOperacion?: "DIRECTO" | "PEDIDO_ALMACEN" | "SOLICITUD_ORDEN";
  pedidoReferenciaId?: string;
  numeroPedidoReferencia?: string;
  descontarInventario?: boolean;
  productosActuales: Producto[];
  consumosActuales: RegistroConsumo[];
  movimientosActuales?: Movimiento[];
}): {
  exito: boolean;
  error?: string;
  errores?: string[];
  consumo?: RegistroConsumo;
  productosActualizados: Producto[];
  consumosActualizados: RegistroConsumo[];
  movimientosGenerados: Movimiento[];
} {
  const origen = params.origenOperacion || "DIRECTO";
  const descontar = params.descontarInventario !== false;

  const fingerprint = buildConsumoFingerprint({
    sedeId: params.sedeId,
    departamentoNombre: params.departamentoNombre,
    responsableId: params.responsable?.id || "",
    tipoConsumoId: params.tipoConsumo?.id || "",
    origenOperacion: origen,
    pedidoReferenciaId: params.pedidoReferenciaId,
    items: params.items || []
  });

  if (activeConsumoLocks.has(fingerprint)) {
    return {
      exito: false,
      error: "Operación en curso: ya se está procesando este mismo consumo.",
      errores: ["Operación en curso: ya se está procesando este mismo consumo."],
      productosActualizados: params.productosActuales,
      consumosActualizados: params.consumosActuales,
      movimientosGenerados: []
    };
  }

  activeConsumoLocks.add(fingerprint);
  try {
    // 1. Si proviene de un pedido/solicitud con ID de referencia, verificar que no se haya registrado ya
    if (params.pedidoReferenciaId) {
      const existingFromOrder = params.consumosActuales.find(
        (c) => c.pedidoReferenciaId === params.pedidoReferenciaId
      );
      if (existingFromOrder) {
        return {
          exito: false,
          error: `El pedido ${params.numeroPedidoReferencia || params.pedidoReferenciaId} ya generó el consumo ${existingFromOrder.numeroOperacion}.`,
          errores: [
            `El pedido ${params.numeroPedidoReferencia || params.pedidoReferenciaId} ya generó el consumo ${existingFromOrder.numeroOperacion}.`
          ],
          consumo: existingFromOrder,
          productosActualizados: params.productosActuales,
          consumosActualizados: params.consumosActuales,
          movimientosGenerados: []
        };
      }
    }

    // 1b. Prevenir doble clic / envío simultáneo con la misma huella en los últimos 8 segundos
    const nowCheckTs = Date.now();
    const recentDuplicate = params.consumosActuales.find(
      (c) => c.fingerprint === fingerprint && Math.abs(nowCheckTs - Number(c.timestamp || 0)) < 8000
    );
    if (recentDuplicate) {
      return {
        exito: false,
        error: `Operación duplicada detectada (${recentDuplicate.numeroOperacion}). Este consumo ya fue registrado hace unos instantes.`,
        errores: [
          `Operación duplicada detectada (${recentDuplicate.numeroOperacion}). Este consumo ya fue registrado hace unos instantes.`
        ],
        consumo: recentDuplicate,
        productosActualizados: params.productosActuales,
        consumosActualizados: params.consumosActuales,
        movimientosGenerados: []
      };
    }

    // 2. Validar reglas de negocio y stock
    const validation = validateConsumoOperation({
      sedeId: params.sedeId,
      departamentoNombre: params.departamentoNombre,
      responsable: params.responsable,
      tipoConsumo: params.tipoConsumo,
      destinoExternoInstitucion: params.destinoExternoInstitucion,
      destinoExternoPersona: params.destinoExternoPersona,
      items: params.items,
      productosInventario: params.productosActuales,
      esAdmin: params.esAdmin,
      asignacionEspecialAdmin: params.asignacionEspecialAdmin,
      validarExistenciasInventario: descontar
    });

    if (!validation.valido) {
      return {
        exito: false,
        error: validation.errores[0],
        errores: validation.errores,
        productosActualizados: params.productosActuales,
        consumosActualizados: params.consumosActuales,
        movimientosGenerados: []
      };
    }

    const now = new Date();
    const nowTs = now.getTime();
    const fecha = params.fecha || now.toLocaleDateString("en-CA");
    const hora = params.hora || now.toLocaleTimeString("es-DO", { hour12: false }).slice(0, 5);
    const numeroOperacion = generarSiguienteNumeroConsumo(params.consumosActuales);
    const consumoId = `con-${nowTs}-${Math.random().toString(36).slice(2, 7)}`;

    // 3. Clonar y descontar inventario si corresponde
    const movimientosGenerados: Movimiento[] = [];
    const productosActualizados: Producto[] = params.productosActuales.map((prod) => ({
      ...prod,
      lotes: (prod.lotes || []).map((l) => ({ ...l }))
    }));

    const itemsNormalizados: ConsumoItem[] = params.items.map((it, idx) => {
      const qty = Number(it.cantidadEntregada || 0);
      const price = Number(it.precioUnitario || 0);
      return {
        ...it,
        id: it.id || `citem-${nowTs}-${idx}`,
        cantidadEntregada: qty,
        precioUnitario: price,
        subtotal: Number((qty * price).toFixed(2))
      };
    });

    if (descontar) {
      for (const item of itemsNormalizados) {
        const targetProd = productosActualizados.find((p) => p.codigo === item.productoCodigo);
        if (!targetProd) {
          throw new Error(`Producto ${item.productoCodigo} no encontrado al descontar stock.`);
        }
        const targetLot = targetProd.lotes.find((l) => l.id === item.loteId);
        if (!targetLot) {
          throw new Error(`Lote ${item.numeroLote} no encontrado al descontar stock.`);
        }
        const sis = Number(targetLot.cantidad || 0);
        const fis = targetLot.cantidadF !== undefined ? Number(targetLot.cantidadF) : sis;
        if (item.cantidadEntregada > sis || item.cantidadEntregada > fis) {
          throw new Error(`Stock insuficiente en lote ${targetLot.numeroLote} de ${targetProd.nombre}.`);
        }
        targetLot.cantidad = sis - item.cantidadEntregada;
        targetLot.cantidadF = fis - item.cantidadEntregada;
        targetProd.verificado = false;
        targetProd.updatedAt = nowTs;

        const movId = `mov-con-${item.productoCodigo}-${nowTs}-${Math.random().toString(36).slice(2, 6)}`;
        movimientosGenerados.push({
          id: movId,
          productoCodigo: item.productoCodigo,
          productoNombre: item.productoNombre,
          descripcion: item.descripcion || targetProd.descripcion,
          lote: item.numeroLote,
          loteFisico: item.loteFisico || targetLot.loteFisico,
          cantidad: item.cantidadEntregada,
          cantidadF: item.cantidadEntregada,
          fechaVencimiento: item.fechaVencimiento || targetLot.fechaVencimiento,
          precio: item.precioUnitario,
          tipoMovimiento: "Salida",
          usuario: params.usuarioRegistro,
          fecha: now.toISOString(),
          timestamp: nowTs,
          catalogId: item.catalogId || params.catalogId,
          consumoId,
          numeroOperacionConsumo: numeroOperacion,
          departamentoDestino: params.departamentoNombre,
          responsableDestino: params.responsable.nombre,
          tipoConsumo: params.tipoConsumo.nombre
        });
      }
    }

    const uniqueProds = new Set(itemsNormalizados.map((i) => i.productoCodigo)).size;
    const totalUnidades = itemsNormalizados.reduce((acc, i) => acc + Number(i.cantidadEntregada || 0), 0);
    const costoTotalEstimado = Number(
      itemsNormalizados.reduce((acc, i) => acc + Number(i.subtotal || 0), 0).toFixed(2)
    );

    const nuevoConsumo: RegistroConsumo = {
      id: consumoId,
      numeroOperacion,
      sedeId: params.sedeId,
      sedeNombre: params.sedeNombre,
      fecha,
      hora,
      timestamp: nowTs,
      periodo: params.periodo,
      departamentoId: params.departamentoId,
      departamentoNombre: params.departamentoNombre,
      responsableId: params.responsable.id,
      responsableNombre: params.responsable.nombre,
      responsableCargo: params.responsable.cargo,
      asignacionEspecialAdmin: Boolean(params.asignacionEspecialAdmin),
      tipoConsumoId: params.tipoConsumo.id,
      tipoConsumoNombre: params.tipoConsumo.nombre,
      categoriaConsumo: params.tipoConsumo.categoria,
      destinoExternoInstitucion: params.destinoExternoInstitucion?.trim() || undefined,
      destinoExternoPersona: params.destinoExternoPersona?.trim() || undefined,
      destinoExternoDocumento: params.destinoExternoDocumento?.trim() || undefined,
      catalogId: params.catalogId,
      catalogNombre: params.catalogNombre,
      items: itemsNormalizados,
      totalProductos: uniqueProds,
      totalUnidades,
      costoTotalEstimado,
      observaciones: params.observaciones?.trim() || undefined,
      usuarioRegistro: params.usuarioRegistro,
      usuarioRegistroId: params.usuarioRegistroId,
      rolUsuarioRegistro: params.rolUsuarioRegistro,
      origenOperacion: origen,
      pedidoReferenciaId: params.pedidoReferenciaId,
      numeroPedidoReferencia: params.numeroPedidoReferencia,
      movimientoIds: movimientosGenerados.map((m) => m.id),
      fingerprint,
      estado: "CONFIRMADO"
    };

    const consumosActualizados = [nuevoConsumo, ...params.consumosActuales];

    return {
      exito: true,
      consumo: nuevoConsumo,
      productosActualizados,
      consumosActualizados,
      movimientosGenerados
    };
  } finally {
    activeConsumoLocks.delete(fingerprint);
  }
}

/**
 * Registra un consumo de manera atómica en Firestore y/o localStorage.
 * Cuando `descontarInventario === true` (registro directo desde el módulo Consumos),
 * realiza una transacción Firestore verificando el stock real en el servidor, descontando los lotes,
 * guardando los movimientos de salida y creando el documento en `consumos`.
 * Cuando `descontarInventario === false` (integración desde Pedidos/Solicitudes que ya descontaron stock
 * en su propia transacción), registra el consumo vinculado sin descontar dos veces.
 */
export async function registrarConsumoAtomico(params: {
  sedeId?: string;
  sedeNombre: string;
  fecha?: string;
  hora?: string;
  periodo?: string;
  departamentoId?: string;
  departamentoNombre: string;
  responsable: ResponsableDepartamento;
  asignacionEspecialAdmin?: boolean;
  tipoConsumo: TipoConsumoConfig;
  destinoExternoInstitucion?: string;
  destinoExternoPersona?: string;
  destinoExternoDocumento?: string;
  catalogId: string;
  catalogNombre?: string;
  items: ConsumoItem[];
  observaciones?: string;
  usuarioRegistro: string;
  usuarioRegistroId?: string;
  rolUsuarioRegistro?: string;
  esAdmin?: boolean;
  origenOperacion?: "DIRECTO" | "PEDIDO_ALMACEN" | "SOLICITUD_ORDEN";
  pedidoReferenciaId?: string;
  numeroPedidoReferencia?: string;
  descontarInventario?: boolean;
  productosActuales: Producto[];
  consumosActuales?: RegistroConsumo[];
}): Promise<{
  exito: boolean;
  error?: string;
  errores?: string[];
  consumo?: RegistroConsumo;
  productosActualizados?: Producto[];
}> {
  const tenant = (params.sedeId || getActiveFarmaciaId() || DEFAULT_FARMACIA_ID).trim();
  const existingConsumos = params.consumosActuales || loadLocalConsumos(tenant);
  const descontar = params.descontarInventario !== false;

  // 1. Validación previa y procesamiento en memoria
  const memResult = procesarConsumoEnMemoria({
    ...params,
    sedeId: tenant,
    consumosActuales: existingConsumos,
    descontarInventario: descontar
  });

  if (!memResult.exito || !memResult.consumo) {
    return {
      exito: false,
      error: memResult.error,
      errores: memResult.errores
    };
  }

  const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

  if (isLocalFileMode) {
    saveLocalConsumos(memResult.consumosActualizados, tenant);
    if (descontar && typeof window !== "undefined" && window.localStorage) {
      try {
        localStorage.setItem("offline_productos", JSON.stringify(memResult.productosActualizados));
        const rawMovs = localStorage.getItem("offline_movimientos");
        const movList: Movimiento[] = rawMovs ? JSON.parse(rawMovs) : [];
        localStorage.setItem(
          "offline_movimientos",
          JSON.stringify([...memResult.movimientosGenerados, ...movList])
        );
        window.dispatchEvent(new Event("offline_productos_update"));
        window.dispatchEvent(new Event("offline_movimientos_update"));
      } catch {}
    }
    return {
      exito: true,
      consumo: memResult.consumo,
      productosActualizados: memResult.productosActualizados
    };
  }

  // 2. Transacción en Firestore para garantizar atomicidad frente a solicitudes concurrentes
  const consumoDoc = memResult.consumo;
  const movimientos = memResult.movimientosGenerados;

  try {
    if (descontar) {
      const uniqueCodes = Array.from(new Set<string>(consumoDoc.items.map((it) => it.productoCodigo)));

      await runTransaction(db, async (transaction) => {
        const prodSnaps = await Promise.all(
          uniqueCodes.map((code) =>
            transaction.get(tenantDoc("productos", code.replace(/\//g, "_"), tenant))
          )
        );

        const serverProdsMap = new Map<string, Producto>();
        prodSnaps.forEach((snap, idx) => {
          const code = uniqueCodes[idx];
          if (!snap.exists()) {
            throw new Error(`El producto "${code}" no existe en el servidor.`);
          }
          serverProdsMap.set(code, snap.data() as Producto);
        });

        // Verificar y descontar por cada ítem del consumo
        for (const item of consumoDoc.items) {
          const serverProd = serverProdsMap.get(item.productoCodigo);
          if (!serverProd) {
            throw new Error(`Producto "${item.productoNombre}" no encontrado en el servidor.`);
          }
          const targetLot = (serverProd.lotes || []).find((l) => l.id === item.loteId);
          if (!targetLot) {
            throw new Error(`Lote "${item.numeroLote}" de "${item.productoNombre}" no encontrado en el servidor.`);
          }
          const serverSis = Number(targetLot.cantidad || 0);
          const serverFis = targetLot.cantidadF !== undefined ? Number(targetLot.cantidadF) : serverSis;
          const reqQty = Number(item.cantidadEntregada || 0);

          if (reqQty <= 0 || reqQty > serverSis || reqQty > serverFis) {
            throw new Error(
              `Stock insuficiente en el servidor para "${item.productoNombre}" (Lote ${item.numeroLote}). Solicitado: ${reqQty} und. | Disponible Sistema: ${serverSis} und. | Físico: ${serverFis} und.`
            );
          }

          targetLot.cantidad = serverSis - reqQty;
          targetLot.cantidadF = serverFis - reqQty;
        }

        // Persistir productos actualizados
        for (const [code, updatedProd] of serverProdsMap.entries()) {
          const prodRef = tenantDoc("productos", code.replace(/\//g, "_"), tenant);
          transaction.set(prodRef, {
            ...updatedProd,
            verificado: false,
            updatedAt: consumoDoc.timestamp
          });
        }

        // Persistir movimientos de salida vinculados al consumo
        for (const mov of movimientos) {
          const movRef = tenantDoc("movimientos", mov.id, tenant);
          const cleanMov = JSON.parse(JSON.stringify(mov));
          transaction.set(movRef, cleanMov);
        }

        // Persistir registro de consumos dentro de la colección autorizada /configuracion/registro_consumos
        const regRef = tenantDoc("configuracion", "registro_consumos", tenant);
        const cleanConsumosList = JSON.parse(
          JSON.stringify(memResult.consumosActualizados.slice(0, 500))
        );
        transaction.set(
          regRef,
          {
            consumos: cleanConsumosList,
            updatedAt: consumoDoc.timestamp
          },
          { merge: true }
        );
      });
    } else {
      // El inventario ya fue descontado por la transacción del Pedido/Solicitud; solo guardamos el registro de consumo
      const regRef = tenantDoc("configuracion", "registro_consumos", tenant);
      const cleanConsumosList = JSON.parse(
        JSON.stringify(memResult.consumosActualizados.slice(0, 500))
      );
      await setDoc(
        regRef,
        {
          consumos: cleanConsumosList,
          updatedAt: consumoDoc.timestamp
        },
        { merge: true }
      );
    }

    // Sincronizar copia local para respuesta inmediata en UI y reportes
    saveLocalConsumos(memResult.consumosActualizados, tenant);

    return {
      exito: true,
      consumo: consumoDoc,
      productosActualizados: memResult.productosActualizados
    };
  } catch (err: any) {
    const errMsg = String(err?.message || "");
    const isPermissionError =
      err?.code === "permission-denied" ||
      errMsg.includes("Missing or insufficient permissions");

    if (isPermissionError) {
      // Respaldo seguro en almacenamiento local si las reglas de Firestore de la sede aún no incluyen la ruta o sesión actual
      console.warn(
        "Permiso restringido en Firestore al registrar consumo; aplicando respaldo local sincronizado:",
        errMsg
      );
      saveLocalConsumos(memResult.consumosActualizados, tenant);
      if (descontar && typeof window !== "undefined" && window.localStorage) {
        try {
          localStorage.setItem("offline_productos", JSON.stringify(memResult.productosActualizados));
          const rawMovs = localStorage.getItem("offline_movimientos");
          const movList: Movimiento[] = rawMovs ? JSON.parse(rawMovs) : [];
          localStorage.setItem(
            "offline_movimientos",
            JSON.stringify([...memResult.movimientosGenerados, ...movList])
          );
          window.dispatchEvent(new Event("offline_productos_update"));
          window.dispatchEvent(new Event("offline_movimientos_update"));
        } catch {}
      }
      return {
        exito: true,
        consumo: consumoDoc,
        productosActualizados: memResult.productosActualizados
      };
    }

    console.error("Error en registrarConsumoAtomico:", err);
    return {
      exito: false,
      error: err?.message || "Error al confirmar el consumo en el servidor.",
      errores: [err?.message || "Error al confirmar el consumo en el servidor."]
    };
  }
}

/**
 * Registra una nota de corrección auditada sobre un consumo confirmado,
 * sin eliminar ni sobrescribir silenciosamente la operación original.
 */
export async function agregarNotaCorreccionConsumo(params: {
  consumoId: string;
  motivo: string;
  usuario: string;
  sedeId?: string;
  consumosActuales?: RegistroConsumo[];
}): Promise<{ exito: boolean; consumoActualizado?: RegistroConsumo; error?: string }> {
  const tenant = (params.sedeId || getActiveFarmaciaId() || DEFAULT_FARMACIA_ID).trim();
  const cleanMotivo = String(params.motivo || "").trim();
  if (!cleanMotivo) {
    return { exito: false, error: "Debe indicar el motivo documentado de la corrección o aclaración." };
  }

  const list = params.consumosActuales || loadLocalConsumos(tenant);
  const target = list.find((c) => c.id === params.consumoId);
  if (!target) {
    return { exito: false, error: "No se encontró el registro de consumo especificado." };
  }

  const now = new Date();
  const nuevaNota = {
    fecha: now.toLocaleDateString("en-CA"),
    hora: now.toLocaleTimeString("es-DO", { hour12: false }).slice(0, 5),
    usuario: params.usuario,
    motivo: cleanMotivo
  };

  const actualizado: RegistroConsumo = {
    ...target,
    estado: "CORREGIDO",
    historialCorrecciones: [...(target.historialCorrecciones || []), nuevaNota]
  };

  const nextList = list.map((c) => (c.id === params.consumoId ? actualizado : c));
  saveLocalConsumos(nextList, tenant);

  const canSyncFirestore = typeof window !== "undefined" && window.location.protocol !== "file:";
  if (canSyncFirestore) {
    try {
      const cleanConsumosList = JSON.parse(JSON.stringify(nextList.slice(0, 500)));
      await setDoc(
        tenantDoc("configuracion", "registro_consumos", tenant),
        {
          consumos: cleanConsumosList,
          updatedAt: Date.now()
        },
        { merge: true }
      );
    } catch (err) {
      console.warn("Aviso al guardar nota de corrección en Firestore:", err);
    }
  }

  return { exito: true, consumoActualizado: actualizado };
}

export interface ResumenDepartamentoStats {
  departamentoNombre: string;
  totalOperaciones: number;
  totalUnidades: number;
  costoTotalEstimado: number;
  operacionesInternas: number;
  unidadesInternas: number;
  operacionesExternas: number;
  unidadesExternas: number;
  productosEntregados: Array<{
    productoCodigo: string;
    productoNombre: string;
    cantidadTotal: number;
    costoTotal: number;
    operacionesCount: number;
  }>;
  consumoPorResponsable: Array<{
    responsableId: string;
    responsableNombre: string;
    totalOperaciones: number;
    totalUnidades: number;
    costoTotal: number;
    ultimaEntrega: string;
  }>;
  historialCronologico: RegistroConsumo[];
}

/**
 * Calcula el resumen analítico de consumo por cada departamento y consolidado general
 * a partir de una lista filtrada de registros de consumo.
 */
export function calcularResumenPorDepartamento(
  consumos: RegistroConsumo[]
): {
  resumenDepartamentos: ResumenDepartamentoStats[];
  totalOperacionesGlobal: number;
  totalUnidadesGlobal: number;
  costoTotalGlobal: number;
  totalInternoUnidades: number;
  totalExternoUnidades: number;
  totalInternoOperaciones: number;
  totalExternoOperaciones: number;
} {
  const byDept = new Map<string, RegistroConsumo[]>();

  let totalOperacionesGlobal = 0;
  let totalUnidadesGlobal = 0;
  let costoTotalGlobal = 0;
  let totalInternoUnidades = 0;
  let totalExternoUnidades = 0;
  let totalInternoOperaciones = 0;
  let totalExternoOperaciones = 0;

  for (const con of consumos) {
    const deptName = (con.departamentoNombre || "Sin Departamento").trim();
    if (!byDept.has(deptName)) {
      byDept.set(deptName, []);
    }
    byDept.get(deptName)!.push(con);

    totalOperacionesGlobal += 1;
    totalUnidadesGlobal += Number(con.totalUnidades || 0);
    costoTotalGlobal += Number(con.costoTotalEstimado || 0);

    if (con.categoriaConsumo === "Externo") {
      totalExternoOperaciones += 1;
      totalExternoUnidades += Number(con.totalUnidades || 0);
    } else {
      totalInternoOperaciones += 1;
      totalInternoUnidades += Number(con.totalUnidades || 0);
    }
  }

  const resumenDepartamentos: ResumenDepartamentoStats[] = [];

  for (const [departamentoNombre, registros] of byDept.entries()) {
    let totalUnidades = 0;
    let costoTotalEstimado = 0;
    let operacionesInternas = 0;
    let unidadesInternas = 0;
    let operacionesExternas = 0;
    let unidadesExternas = 0;

    const prodMap = new Map<
      string,
      {
        productoCodigo: string;
        productoNombre: string;
        cantidadTotal: number;
        costoTotal: number;
        operacionesSet: Set<string>;
      }
    >();

    const respMap = new Map<
      string,
      {
        responsableId: string;
        responsableNombre: string;
        totalOperaciones: number;
        totalUnidades: number;
        costoTotal: number;
        ultimaEntrega: string;
      }
    >();

    const sortedCronologico = [...registros].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    for (const reg of sortedCronologico) {
      const regUnits = Number(reg.totalUnidades || 0);
      const regCost = Number(reg.costoTotalEstimado || 0);
      totalUnidades += regUnits;
      costoTotalEstimado += regCost;

      if (reg.categoriaConsumo === "Externo") {
        operacionesExternas += 1;
        unidadesExternas += regUnits;
      } else {
        operacionesInternas += 1;
        unidadesInternas += regUnits;
      }

      // Agrupar por responsable
      const respKey = normalizeTextToken(reg.responsableNombre || reg.responsableId || "Sin Responsable");
      const prevResp = respMap.get(respKey);
      if (prevResp) {
        prevResp.totalOperaciones += 1;
        prevResp.totalUnidades += regUnits;
        prevResp.costoTotal = Number((prevResp.costoTotal + regCost).toFixed(2));
        if (`${reg.fecha} ${reg.hora}` > prevResp.ultimaEntrega) {
          prevResp.ultimaEntrega = `${reg.fecha} ${reg.hora}`;
        }
      } else {
        respMap.set(respKey, {
          responsableId: reg.responsableId,
          responsableNombre: reg.responsableNombre || "Sin Responsable",
          totalOperaciones: 1,
          totalUnidades: regUnits,
          costoTotal: Number(regCost.toFixed(2)),
          ultimaEntrega: `${reg.fecha} ${reg.hora}`
        });
      }

      // Agrupar por producto
      for (const item of reg.items || []) {
        const prodKey = item.productoCodigo;
        const prevProd = prodMap.get(prodKey);
        const itemQty = Number(item.cantidadEntregada || 0);
        const itemSub = Number(item.subtotal || itemQty * Number(item.precioUnitario || 0));
        if (prevProd) {
          prevProd.cantidadTotal += itemQty;
          prevProd.costoTotal = Number((prevProd.costoTotal + itemSub).toFixed(2));
          prevProd.operacionesSet.add(reg.id);
        } else {
          prodMap.set(prodKey, {
            productoCodigo: item.productoCodigo,
            productoNombre: item.productoNombre,
            cantidadTotal: itemQty,
            costoTotal: Number(itemSub.toFixed(2)),
            operacionesSet: new Set([reg.id])
          });
        }
      }
    }

    resumenDepartamentos.push({
      departamentoNombre,
      totalOperaciones: registros.length,
      totalUnidades,
      costoTotalEstimado: Number(costoTotalEstimado.toFixed(2)),
      operacionesInternas,
      unidadesInternas,
      operacionesExternas,
      unidadesExternas,
      productosEntregados: Array.from(prodMap.values())
        .map((p) => ({
          productoCodigo: p.productoCodigo,
          productoNombre: p.productoNombre,
          cantidadTotal: p.cantidadTotal,
          costoTotal: p.costoTotal,
          operacionesCount: p.operacionesSet.size
        }))
        .sort((a, b) => b.cantidadTotal - a.cantidadTotal),
      consumoPorResponsable: Array.from(respMap.values()).sort(
        (a, b) => b.totalUnidades - a.totalUnidades
      ),
      historialCronologico: sortedCronologico
    });
  }

  resumenDepartamentos.sort((a, b) => b.totalUnidades - a.totalUnidades);

  return {
    resumenDepartamentos,
    totalOperacionesGlobal,
    totalUnidadesGlobal,
    costoTotalGlobal: Number(costoTotalGlobal.toFixed(2)),
    totalInternoUnidades,
    totalExternoUnidades,
    totalInternoOperaciones,
    totalExternoOperaciones
  };
}
