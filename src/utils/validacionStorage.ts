import {
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  addDoc,
  serverTimestamp
} from "firebase/firestore";
import { getActiveFarmaciaId, tenantCollection, tenantDoc } from "../firebase";
import {
  HistorialOperacionValidacion,
  Movimiento,
  Producto,
  PropuestaAjusteInventario,
  RegistroValidacionDocumento,
  SolicitudVerificacionProducto,
  Usuario
} from "../types";

const isLocalFileMode = () =>
  typeof window !== "undefined" && window.location.protocol === "file:";

export function getNowDateAndTime(): { fecha: string; hora: string; timestamp: number } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return {
    fecha: `${yyyy}-${mm}-${dd}`,
    hora: `${hh}:${min}`,
    timestamp: now.getTime()
  };
}

export function normalizeDepartmentName(dept?: string | null): string {
  const raw = String(dept || "").trim();
  if (!raw) return "Almacén y Suministros";
  const lower = raw.toLowerCase();
  if (lower === "almacén y suministro" || lower === "almacen y suministro" || lower === "almacén y suministros" || lower === "almacen y suministros") {
    return "Almacén y Suministros";
  }
  return raw;
}

export function isSameDepartment(deptA?: string | null, deptB?: string | null): boolean {
  const normA = normalizeDepartmentName(deptA)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const normB = normalizeDepartmentName(deptB)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return normA === normB;
}

function getLocalList<T>(key: string): T[] {
  try {
    const tenant = getActiveFarmaciaId();
    const raw = localStorage.getItem(`${key}_${tenant}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalList<T>(key: string, list: T[], eventName: string): void {
  try {
    const tenant = getActiveFarmaciaId();
    localStorage.setItem(`${key}_${tenant}`, JSON.stringify(list));
    window.dispatchEvent(new Event(eventName));
  } catch {}
}

/**
 * Registra un evento en el historial auditable de operaciones de validación
 */
export async function recordValidacionAuditLog(
  entry: Omit<HistorialOperacionValidacion, "id" | "sedeId" | "fecha" | "hora" | "timestamp">
): Promise<void> {
  const { fecha, hora, timestamp } = getNowDateAndTime();
  const sedeId = getActiveFarmaciaId();
  const record: HistorialOperacionValidacion = {
    ...entry,
    id: `hval-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
    sedeId,
    fecha,
    hora,
    timestamp
  };

  const localList = getLocalList<HistorialOperacionValidacion>("local_historial_validacion");
  saveLocalList("local_historial_validacion", [record, ...localList].slice(0, 500), "validacion_data_updated");

  if (!isLocalFileMode()) {
    try {
      await setDoc(tenantDoc("historial_validacion", record.id), record);
    } catch (err) {
      console.warn("No se pudo guardar historial_validacion en Firestore:", err);
    }
  }
}

/**
 * Guarda un registro de validación documental (sin modificar el inventario)
 */
export async function saveValidacionDocumentoRecord(
  record: RegistroValidacionDocumento,
  currentUser: Usuario
): Promise<void> {
  const localList = getLocalList<RegistroValidacionDocumento>("local_validaciones_documentos");
  const updated = [record, ...localList.filter((r) => r.id !== record.id)];
  saveLocalList("local_validaciones_documentos", updated, "validacion_data_updated");

  if (!isLocalFileMode()) {
    await setDoc(tenantDoc("validaciones_documentos", record.id), record);
  }

  await recordValidacionAuditLog({
    tipoOperacion: "VALIDACION_DOCUMENTO",
    referenciaCodigo: record.numeroValidacion,
    descripcion: `Validación documental de "${record.nombreArchivo}" (${record.tipoDocumento}): ${record.totalItems} ítems comparados (${record.itemsCoincidentes} sin diferencias, ${record.itemsConDiscrepancia} con discrepancias).`,
    usuarioNombre: currentUser.nombre,
    usuarioRol: currentUser.rol,
    departamento: normalizeDepartmentName(currentUser.departamento),
    detalles: record.observacionesGenerales
  });
}

/**
 * Crea una propuesta de ajuste de inventario (queda en estado PENDIENTE_AUTORIZACION, sin alterar stock)
 */
export async function createPropuestaAjusteInventario(
  propuesta: PropuestaAjusteInventario,
  currentUser: Usuario
): Promise<void> {
  const localList = getLocalList<PropuestaAjusteInventario>("local_propuestas_ajuste");
  const updated = [propuesta, ...localList.filter((p) => p.id !== propuesta.id)];
  saveLocalList("local_propuestas_ajuste", updated, "validacion_data_updated");

  if (!isLocalFileMode()) {
    await setDoc(tenantDoc("propuestas_ajuste_inventario", propuesta.id), propuesta);
  }

  await recordValidacionAuditLog({
    tipoOperacion: "PROPUESTA_AJUSTE_CREADA",
    referenciaCodigo: propuesta.codigoPropuesta,
    productoCodigo: propuesta.productoCodigo,
    productoNombre: propuesta.productoNombreActual,
    descripcion: `Propuesta de ajuste ${propuesta.codigoPropuesta} generada desde ${
      propuesta.origen === "VALIDACION_DOCUMENTAL" ? "Validación Documental" : "Verificación Física"
    } (${propuesta.origenReferenciaCodigo}). Stock Sistema: ${propuesta.existenciaSistemaActual} → ${
      propuesta.existenciaSistemaPropuesta
    } | Stock Físico: ${propuesta.existenciaFisicaActual} → ${propuesta.existenciaFisicaPropuesta}. Motivo: ${
      propuesta.motivoCambio
    }`,
    usuarioNombre: currentUser.nombre,
    usuarioRol: currentUser.rol,
    departamento: normalizeDepartmentName(currentUser.departamento),
    detalles: propuesta.observacionesValidacion
  });
}

/**
 * Autoriza o rechaza una propuesta de ajuste de inventario.
 * - Si se RECHAZA: no modifica ningún dato del inventario y registra quién rechazó, fecha, hora y observaciones.
 * - Si se APRUEBA: aplica el cambio al producto/lote en inventario, genera movimiento en Kardex y registra quién autorizó.
 */
export async function resolvePropuestaAjusteInventario(params: {
  propuesta: PropuestaAjusteInventario;
  decision: "APROBADO" | "RECHAZADO";
  observacionesAutorizacion: string;
  currentUser: Usuario;
  products: Producto[];
  onProductsUpdated?: (updatedProducts: Producto[]) => void;
}): Promise<{ propuestaActualizada: PropuestaAjusteInventario }> {
  const { propuesta, decision, observacionesAutorizacion, currentUser, products, onProductsUpdated } = params;
  const { fecha, hora, timestamp } = getNowDateAndTime();

  let movimientoGeneradoId: string | undefined;

  if (decision === "APROBADO") {
    const targetProd = products.find((p) => p.codigo === propuesta.productoCodigo);
    if (targetProd) {
      const lotes = Array.isArray(targetProd.lotes) ? [...targetProd.lotes] : [];
      let updatedLotes = [...lotes];

      if (updatedLotes.length === 0) {
        // Crear lote inicial con los valores propuestos
        updatedLotes = [
          {
            id: `lot-${timestamp}`,
            numeroLote: propuesta.numeroLotePropuesto || "LOTE-VALIDADO",
            cantidad: Number(propuesta.existenciaSistemaPropuesta || 0),
            cantidadF: Number(propuesta.existenciaFisicaPropuesta || 0),
            fechaVencimiento: propuesta.fechaVencimientoPropuesta || `${new Date().getFullYear() + 1}-12-31`,
            precio: Number(propuesta.costoPropuesto || 0),
            articuloAjustado: true
          }
        ];
      } else {
        // Si hay un loteId objetivo o único lote, o ajustar el lote principal y distribuir diferencia
        const targetIdx = propuesta.loteId
          ? updatedLotes.findIndex((l) => l.id === propuesta.loteId)
          : 0;
        const idxToUpdate = targetIdx >= 0 ? targetIdx : 0;

        // Si el producto tiene varios lotes y la propuesta es sobre el total del producto:
        const otherLotsSysSum = updatedLotes.reduce(
          (acc, l, i) => (i === idxToUpdate ? acc : acc + Number(l.cantidad || 0)),
          0
        );
        const otherLotsPhysSum = updatedLotes.reduce(
          (acc, l, i) => (i === idxToUpdate ? acc : acc + Number(l.cantidadF ?? l.cantidad ?? 0)),
          0
        );

        const newTargetSysQty = Math.max(0, Number(propuesta.existenciaSistemaPropuesta) - otherLotsSysSum);
        const newTargetPhysQty = Math.max(0, Number(propuesta.existenciaFisicaPropuesta) - otherLotsPhysSum);

        updatedLotes[idxToUpdate] = {
          ...updatedLotes[idxToUpdate],
          numeroLote: propuesta.numeroLotePropuesto || updatedLotes[idxToUpdate].numeroLote,
          cantidad: newTargetSysQty,
          cantidadF: newTargetPhysQty,
          precio:
            propuesta.costoPropuesto > 0
              ? Number(propuesta.costoPropuesto)
              : updatedLotes[idxToUpdate].precio,
          fechaVencimiento:
            propuesta.fechaVencimientoPropuesta || updatedLotes[idxToUpdate].fechaVencimiento,
          articuloAjustado: true
        };
      }

      const updatedProduct: Producto = {
        ...targetProd,
        nombre: propuesta.productoNombrePropuesto?.trim() || targetProd.nombre,
        descripcion: propuesta.unidadMedidaPropuesta?.trim() || targetProd.descripcion,
        verificado: true,
        lotes: updatedLotes,
        updatedAt: timestamp
      };

      const nextProducts = products.map((p) => (p.codigo === updatedProduct.codigo ? updatedProduct : p));
      onProductsUpdated?.(nextProducts);

      movimientoGeneradoId = `mov-aju-${timestamp}-${Math.random().toString(36).slice(2, 6)}`;
      const movRecord: Movimiento = {
        id: movimientoGeneradoId,
        productoCodigo: updatedProduct.codigo,
        productoNombre: updatedProduct.nombre,
        descripcion: `Ajuste autorizado (${propuesta.codigoPropuesta}) • Validador: ${propuesta.validadoPorNombre} • Autorizador: ${currentUser.nombre}. Motivo: ${propuesta.motivoCambio}`,
        lote: propuesta.numeroLotePropuesto || propuesta.numeroLoteActual || "GENERAL",
        cantidad: Number(propuesta.existenciaSistemaPropuesta),
        cantidadF: Number(propuesta.existenciaFisicaPropuesta),
        fechaVencimiento: propuesta.fechaVencimientoPropuesta || propuesta.fechaVencimientoActual,
        precio: Number(propuesta.costoPropuesto || propuesta.costoActual || 0),
        tipoMovimiento: "Ajuste",
        usuario: `${currentUser.nombre} (${currentUser.usuario})`,
        fecha: new Date(timestamp).toISOString(),
        timestamp,
        catalogId: propuesta.catalogId || targetProd.catalogId || "default-cat"
      };

      if (!isLocalFileMode()) {
        await setDoc(tenantDoc("productos", updatedProduct.codigo), updatedProduct);
        await setDoc(tenantDoc("movimientos", movRecord.id), movRecord);
      } else {
        try {
          localStorage.setItem("offline_products", JSON.stringify(nextProducts));
          const rawMovs = localStorage.getItem("offline_movimientos");
          const movList: Movimiento[] = rawMovs ? JSON.parse(rawMovs) : [];
          localStorage.setItem("offline_movimientos", JSON.stringify([movRecord, ...movList]));
        } catch {}
      }
    }
  }

  const propuestaActualizada: PropuestaAjusteInventario = {
    ...propuesta,
    estado: decision,
    autorizadoPorNombre: currentUser.nombre,
    autorizadoPorUsuario: currentUser.usuario,
    rolAutorizador: currentUser.rol,
    fechaAutorizacion: fecha,
    horaAutorizacion: hora,
    timestampAutorizacion: timestamp,
    observacionesAutorizacion: observacionesAutorizacion.trim() || (decision === "APROBADO" ? "Ajuste aprobado y aplicado al inventario." : "Propuesta de ajuste rechazada."),
    ...(movimientoGeneradoId ? { movimientoGeneradoId } : {})
  };

  const localList = getLocalList<PropuestaAjusteInventario>("local_propuestas_ajuste");
  const updatedList = localList.some((p) => p.id === propuestaActualizada.id)
    ? localList.map((p) => (p.id === propuestaActualizada.id ? propuestaActualizada : p))
    : [propuestaActualizada, ...localList];
  saveLocalList("local_propuestas_ajuste", updatedList, "validacion_data_updated");

  if (!isLocalFileMode()) {
    await setDoc(tenantDoc("propuestas_ajuste_inventario", propuestaActualizada.id), propuestaActualizada);
  }

  await recordValidacionAuditLog({
    tipoOperacion: decision === "APROBADO" ? "AJUSTE_AUTORIZADO" : "AJUSTE_RECHAZADO",
    referenciaCodigo: propuestaActualizada.codigoPropuesta,
    productoCodigo: propuestaActualizada.productoCodigo,
    productoNombre: propuestaActualizada.productoNombrePropuesto || propuestaActualizada.productoNombreActual,
    descripcion:
      decision === "APROBADO"
        ? `Ajuste ${propuestaActualizada.codigoPropuesta} APROBADO por ${currentUser.nombre}. Existencia Sistema: ${propuesta.existenciaSistemaActual} → ${propuesta.existenciaSistemaPropuesta}, Física: ${propuesta.existenciaFisicaActual} → ${propuesta.existenciaFisicaPropuesta}.`
        : `Ajuste ${propuestaActualizada.codigoPropuesta} RECHAZADO por ${currentUser.nombre}. El inventario NO fue modificado.`,
    usuarioNombre: currentUser.nombre,
    usuarioRol: currentUser.rol,
    departamento: normalizeDepartmentName(currentUser.departamento),
    detalles: propuestaActualizada.observacionesAutorizacion
  });

  return { propuestaActualizada };
}

/**
 * Crea una Solicitud de Verificación de Producto y la publica en el Chat Interno del departamento destinatario
 */
export async function createSolicitudVerificacionProducto(params: {
  producto: Producto;
  departamentoDestino: string;
  mensajePersonalizado?: string;
  ubicacionFisica?: string;
  currentUser: Usuario;
}): Promise<SolicitudVerificacionProducto> {
  const { producto, departamentoDestino, mensajePersonalizado, ubicacionFisica, currentUser } = params;
  const { fecha, hora, timestamp } = getNowDateAndTime();
  const sedeId = getActiveFarmaciaId();

  const lotes = Array.isArray(producto.lotes) ? producto.lotes : [];
  const existenciaSistema = lotes.reduce((acc, l) => acc + Number(l.cantidad || 0), 0);
  const existenciaFisica = lotes.reduce((acc, l) => acc + Number(l.cantidadF ?? l.cantidad ?? 0), 0);
  const sortedLotes = [...lotes].sort((a, b) =>
    String(a.fechaVencimiento || "9999").localeCompare(String(b.fechaVencimiento || "9999"))
  );
  const primaryLot = sortedLotes[0];

  const defaultMessage = `Solicito la verificación física y validación de la información correspondiente al producto ${producto.nombre}, código ${producto.codigo}. Favor comprobar que sus datos y existencias coincidan con la información registrada en el sistema.`;
  const finalMessage = (mensajePersonalizado || defaultMessage).trim();

  const codigoSolicitud = `VER-${String(timestamp).slice(-5)}`;
  const id = `sol-ver-${timestamp}-${Math.random().toString(36).slice(2, 6)}`;
  const targetDept = normalizeDepartmentName(departamentoDestino || "Almacén y Suministros");
  const originDept = normalizeDepartmentName(currentUser.departamento || "Administración");

  const solicitud: SolicitudVerificacionProducto = {
    id,
    codigoSolicitud,
    sedeId,
    tipo: "Solicitud de verificación",
    catalogId: producto.catalogId || "default-cat",
    productoCodigo: producto.codigo,
    productoNombre: producto.nombre,
    unidadMedida: producto.descripcion?.trim() || "Unidad",
    existenciaSistemaAlSolicitar: existenciaSistema,
    existenciaFisicaAlSolicitar: existenciaFisica,
    costoUnitarioAlSolicitar: primaryLot ? Number(primaryLot.precio || 0) : 0,
    proximoVencimientoAlSolicitar: primaryLot?.fechaVencimiento || "S/F",
    ubicacionFisica: ubicacionFisica || primaryLot?.loteFisico || "No asignada",
    lotesSnapshot: lotes.map((l) => ({
      id: l.id,
      numeroLote: l.numeroLote,
      cantidad: Number(l.cantidad || 0),
      cantidadF: Number(l.cantidadF ?? l.cantidad ?? 0),
      fechaVencimiento: l.fechaVencimiento,
      precio: Number(l.precio || 0),
      loteFisico: l.loteFisico
    })),
    mensajeSolicitud: finalMessage,
    departamentoOrigen: originDept,
    usuarioSolicitanteNombre: currentUser.nombre,
    usuarioSolicitanteId: currentUser.id,
    rolSolicitante: currentUser.rol,
    fechaSolicitud: fecha,
    horaSolicitud: hora,
    timestampSolicitud: timestamp,
    departamentoDestino: targetDept,
    estado: "PENDIENTE"
  };

  // Guardar en lista local
  const localList = getLocalList<SolicitudVerificacionProducto>("local_solicitudes_verificacion");
  saveLocalList("local_solicitudes_verificacion", [solicitud, ...localList], "validacion_data_updated");

  // Publicar también como mensaje estructurado en el Chat Interno del departamento
  const chatPayload = {
    texto: `📋 [Solicitud de verificación ${codigoSolicitud}] ${finalMessage}`,
    usuarioNombre: currentUser.nombre,
    usuarioId: currentUser.id,
    departamento: originDept,
    departamentoDestino: targetDept,
    rol: currentUser.rol,
    timestamp: isLocalFileMode() ? timestamp : serverTimestamp(),
    esSistema: false,
    tipoMensaje: "SOLICITUD_VERIFICACION",
    solicitudVerificacionId: solicitud.id,
    solicitudCodigo: solicitud.codigoSolicitud,
    productoCodigo: producto.codigo,
    productoNombre: producto.nombre
  };

  if (isLocalFileMode()) {
    try {
      const storedChat = localStorage.getItem("offline_chat_mensajes");
      const chatList = storedChat ? JSON.parse(storedChat) : [];
      chatList.push({
        ...chatPayload,
        id: `msg-ver-${timestamp}`
      });
      localStorage.setItem("offline_chat_mensajes", JSON.stringify(chatList));
      window.dispatchEvent(new Event("offline_chat_update"));
    } catch {}
  } else {
    try {
      await setDoc(tenantDoc("solicitudes_verificacion", solicitud.id), solicitud);
      await addDoc(tenantCollection("chat_mensajes"), chatPayload);
    } catch (err) {
      console.error("Error guardando solicitud de verificación en Firestore:", err);
    }
  }

  await recordValidacionAuditLog({
    tipoOperacion: "SOLICITUD_VERIFICACION",
    referenciaCodigo: solicitud.codigoSolicitud,
    productoCodigo: producto.codigo,
    productoNombre: producto.nombre,
    descripcion: `Solicitud de verificación ${solicitud.codigoSolicitud} enviada de ${originDept} a ${targetDept} para el producto ${producto.nombre} (${producto.codigo}).`,
    usuarioNombre: currentUser.nombre,
    usuarioRol: currentUser.rol,
    departamento: originDept,
    detalles: finalMessage
  });

  return solicitud;
}

/**
 * Confirma una Solicitud de Verificación Física después de realizar la comprobación.
 * Si se detectan diferencias y el usuario marca generar propuesta de ajuste, crea una PropuestaAjusteInventario en estado PENDIENTE_AUTORIZACION.
 * NUNCA modifica directamente las existencias del inventario.
 */
export async function confirmarSolicitudVerificacionFisica(params: {
  solicitud: SolicitudVerificacionProducto;
  respuestasRapidas: string[];
  observacionesPersonalizadas: string;
  existenciaFisicaComprobada: number;
  detectoDiferencias: boolean;
  generarPropuestaAjuste: boolean;
  datosPropuesta?: {
    existenciaSistemaPropuesta: number;
    existenciaFisicaPropuesta: number;
    costoPropuesto: number;
    fechaVencimientoPropuesta: string;
    productoNombrePropuesto: string;
    unidadMedidaPropuesta: string;
    numeroLotePropuesto: string;
    motivoCambio: string;
  };
  currentUser: Usuario;
}): Promise<{
  solicitudActualizada: SolicitudVerificacionProducto;
  propuestaCreada?: PropuestaAjusteInventario;
}> {
  const {
    solicitud,
    respuestasRapidas,
    observacionesPersonalizadas,
    existenciaFisicaComprobada,
    detectoDiferencias,
    generarPropuestaAjuste,
    datosPropuesta,
    currentUser
  } = params;

  const { fecha, hora, timestamp } = getNowDateAndTime();
  const sedeId = getActiveFarmaciaId();
  const verificadorDept = normalizeDepartmentName(currentUser.departamento || solicitud.departamentoDestino);

  let propuestaCreada: PropuestaAjusteInventario | undefined;

  const resumenObservaciones = [
    ...respuestasRapidas,
    observacionesPersonalizadas.trim()
  ]
    .filter(Boolean)
    .join(" ");

  if (detectoDiferencias && generarPropuestaAjuste && datosPropuesta) {
    const codigoPropuesta = `AJU-${String(timestamp).slice(-5)}`;
    const primaryLot = solicitud.lotesSnapshot?.[0];

    propuestaCreada = {
      id: `prop-aju-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
      codigoPropuesta,
      sedeId,
      origen: "VERIFICACION_FISICA",
      origenReferenciaId: solicitud.id,
      origenReferenciaCodigo: solicitud.codigoSolicitud,
      catalogId: solicitud.catalogId || "default-cat",
      productoCodigo: solicitud.productoCodigo,
      productoNombreActual: solicitud.productoNombre,
      unidadMedidaActual: solicitud.unidadMedida,
      loteId: primaryLot?.id,
      numeroLoteActual: primaryLot?.numeroLote || "GENERAL",
      existenciaSistemaActual: solicitud.existenciaSistemaAlSolicitar,
      existenciaFisicaActual: solicitud.existenciaFisicaAlSolicitar,
      costoActual: solicitud.costoUnitarioAlSolicitar,
      fechaVencimientoActual: solicitud.proximoVencimientoAlSolicitar,
      productoNombrePropuesto: datosPropuesta.productoNombrePropuesto || solicitud.productoNombre,
      unidadMedidaPropuesta: datosPropuesta.unidadMedidaPropuesta || solicitud.unidadMedida,
      numeroLotePropuesto: datosPropuesta.numeroLotePropuesto || primaryLot?.numeroLote || "GENERAL",
      existenciaSistemaPropuesta: Number(datosPropuesta.existenciaSistemaPropuesta),
      existenciaFisicaPropuesta: Number(datosPropuesta.existenciaFisicaPropuesta),
      costoPropuesto: Number(datosPropuesta.costoPropuesto ?? solicitud.costoUnitarioAlSolicitar),
      fechaVencimientoPropuesta:
        datosPropuesta.fechaVencimientoPropuesta || solicitud.proximoVencimientoAlSolicitar,
      diferenciaCantidadSistema:
        Number(datosPropuesta.existenciaSistemaPropuesta) - solicitud.existenciaSistemaAlSolicitar,
      diferenciaCantidadFisica:
        Number(datosPropuesta.existenciaFisicaPropuesta) - solicitud.existenciaFisicaAlSolicitar,
      motivoCambio:
        datosPropuesta.motivoCambio.trim() ||
        "Diferencia detectada durante verificación física solicitada por Chat Interno",
      observacionesValidacion: resumenObservaciones,
      validadoPorNombre: currentUser.nombre,
      validadoPorUsuario: currentUser.usuario,
      validadoPorDepartamento: verificadorDept,
      rolValidador: currentUser.rol,
      fechaValidacion: fecha,
      horaValidacion: hora,
      timestampValidacion: timestamp,
      estado: "PENDIENTE_AUTORIZACION"
    };

    await createPropuestaAjusteInventario(propuestaCreada, currentUser);
  }

  const nuevoEstado = detectoDiferencias ? "CONFIRMADA_CON_DIFERENCIA" : "CONFIRMADA_COINCIDE";

  const solicitudActualizada: SolicitudVerificacionProducto = {
    ...solicitud,
    estado: nuevoEstado,
    respuestasRapidasSeleccionadas: respuestasRapidas,
    observacionesVerificacion: resumenObservaciones || "Verificación física completada.",
    existenciaFisicaComprobada: Number(existenciaFisicaComprobada),
    detectoDiferencias,
    verificadoPorNombre: currentUser.nombre,
    verificadoPorUsuario: currentUser.usuario,
    verificadoPorDepartamento: verificadorDept,
    rolVerificador: currentUser.rol,
    fechaVerificacion: fecha,
    horaVerificacion: hora,
    timestampVerificacion: timestamp,
    ...(propuestaCreada
      ? {
          propuestaAjusteId: propuestaCreada.id,
          propuestaAjusteCodigo: propuestaCreada.codigoPropuesta
        }
      : {})
  };

  const localList = getLocalList<SolicitudVerificacionProducto>("local_solicitudes_verificacion");
  const updatedList = localList.some((s) => s.id === solicitudActualizada.id)
    ? localList.map((s) => (s.id === solicitudActualizada.id ? solicitudActualizada : s))
    : [solicitudActualizada, ...localList];
  saveLocalList("local_solicitudes_verificacion", updatedList, "validacion_data_updated");

  const confirmChatText = `✅ [Validación Confirmada ${solicitud.codigoSolicitud}] Producto: ${solicitud.productoNombre} (${solicitud.productoCodigo}). Resultado: ${
    detectoDiferencias ? "Con diferencias detectadas" : "Datos y existencias coinciden"
  }. Existencia física comprobada: ${existenciaFisicaComprobada}. Observaciones: ${
    resumenObservaciones || "Sin observaciones adicionales"
  }${
    propuestaCreada
      ? ` • Se generó propuesta de ajuste ${propuestaCreada.codigoPropuesta} (Pendiente de Autorización).`
      : ""
  }`;

  const confirmChatPayload = {
    texto: confirmChatText,
    usuarioNombre: currentUser.nombre,
    usuarioId: currentUser.id,
    departamento: verificadorDept,
    departamentoDestino: solicitud.departamentoOrigen,
    rol: currentUser.rol,
    timestamp: isLocalFileMode() ? timestamp : serverTimestamp(),
    esSistema: false,
    tipoMensaje: "CONFIRMACION_VERIFICACION",
    solicitudVerificacionId: solicitud.id,
    solicitudCodigo: solicitud.codigoSolicitud,
    productoCodigo: solicitud.productoCodigo,
    productoNombre: solicitud.productoNombre
  };

  if (isLocalFileMode()) {
    try {
      const storedChat = localStorage.getItem("offline_chat_mensajes");
      const chatList = storedChat ? JSON.parse(storedChat) : [];
      chatList.push({
        ...confirmChatPayload,
        id: `msg-conf-${timestamp}`
      });
      localStorage.setItem("offline_chat_mensajes", JSON.stringify(chatList));
      window.dispatchEvent(new Event("offline_chat_update"));
    } catch {}
  } else {
    try {
      await setDoc(tenantDoc("solicitudes_verificacion", solicitudActualizada.id), solicitudActualizada);
      await addDoc(tenantCollection("chat_mensajes"), confirmChatPayload);
    } catch (err) {
      console.error("Error actualizando solicitud de verificación:", err);
    }
  }

  await recordValidacionAuditLog({
    tipoOperacion: "CONFIRMACION_VERIFICACION",
    referenciaCodigo: solicitud.codigoSolicitud,
    productoCodigo: solicitud.productoCodigo,
    productoNombre: solicitud.productoNombre,
    descripcion: `Verificación física ${solicitud.codigoSolicitud} confirmada por ${currentUser.nombre} (${verificadorDept}). Estado: ${
      detectoDiferencias ? "Con Diferencias" : "Coincide con el Sistema"
    }. Físico comprobado: ${existenciaFisicaComprobada} und.`,
    usuarioNombre: currentUser.nombre,
    usuarioRol: currentUser.rol,
    departamento: verificadorDept,
    detalles: resumenObservaciones
  });

  return { solicitudActualizada, propuestaCreada };
}

/**
 * Suscripción unificada en tiempo real (Firestore + fallback localStorage) a las colecciones de Validación
 */
export function subscribeValidacionCollections(callbacks: {
  onValidaciones?: (list: RegistroValidacionDocumento[]) => void;
  onPropuestas?: (list: PropuestaAjusteInventario[]) => void;
  onSolicitudes?: (list: SolicitudVerificacionProducto[]) => void;
  onHistorial?: (list: HistorialOperacionValidacion[]) => void;
}): () => void {
  const syncFromLocal = () => {
    callbacks.onValidaciones?.(getLocalList<RegistroValidacionDocumento>("local_validaciones_documentos"));
    callbacks.onPropuestas?.(getLocalList<PropuestaAjusteInventario>("local_propuestas_ajuste"));
    callbacks.onSolicitudes?.(getLocalList<SolicitudVerificacionProducto>("local_solicitudes_verificacion"));
    callbacks.onHistorial?.(getLocalList<HistorialOperacionValidacion>("local_historial_validacion"));
  };

  syncFromLocal();
  window.addEventListener("validacion_data_updated", syncFromLocal);

  if (isLocalFileMode()) {
    return () => {
      window.removeEventListener("validacion_data_updated", syncFromLocal);
    };
  }

  const unsubs: Array<() => void> = [];

  if (callbacks.onValidaciones) {
    const q = query(tenantCollection("validaciones_documentos"), orderBy("timestamp", "desc"), limit(150));
    unsubs.push(
      onSnapshot(
        q,
        (snap) => {
          const list: RegistroValidacionDocumento[] = [];
          snap.forEach((d) => list.push({ ...(d.data() as RegistroValidacionDocumento), id: d.id }));
          callbacks.onValidaciones?.(list);
        },
        () => {}
      )
    );
  }

  if (callbacks.onPropuestas) {
    const q = query(
      tenantCollection("propuestas_ajuste_inventario"),
      orderBy("timestampValidacion", "desc"),
      limit(200)
    );
    unsubs.push(
      onSnapshot(
        q,
        (snap) => {
          const list: PropuestaAjusteInventario[] = [];
          snap.forEach((d) => list.push({ ...(d.data() as PropuestaAjusteInventario), id: d.id }));
          callbacks.onPropuestas?.(list);
        },
        () => {}
      )
    );
  }

  if (callbacks.onSolicitudes) {
    const q = query(
      tenantCollection("solicitudes_verificacion"),
      orderBy("timestampSolicitud", "desc"),
      limit(200)
    );
    unsubs.push(
      onSnapshot(
        q,
        (snap) => {
          const list: SolicitudVerificacionProducto[] = [];
          snap.forEach((d) => list.push({ ...(d.data() as SolicitudVerificacionProducto), id: d.id }));
          callbacks.onSolicitudes?.(list);
        },
        () => {}
      )
    );
  }

  if (callbacks.onHistorial) {
    const q = query(tenantCollection("historial_validacion"), orderBy("timestamp", "desc"), limit(250));
    unsubs.push(
      onSnapshot(
        q,
        (snap) => {
          const list: HistorialOperacionValidacion[] = [];
          snap.forEach((d) => list.push({ ...(d.data() as HistorialOperacionValidacion), id: d.id }));
          callbacks.onHistorial?.(list);
        },
        () => {}
      )
    );
  }

  return () => {
    window.removeEventListener("validacion_data_updated", syncFromLocal);
    unsubs.forEach((u) => u());
  };
}
