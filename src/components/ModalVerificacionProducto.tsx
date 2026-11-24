import React, { useState, useEffect } from "react";
import {
  Producto,
  RESPUESTAS_RAPIDAS_VERIFICACION,
  SolicitudVerificacionProducto,
  Usuario
} from "../types";
import {
  confirmarSolicitudVerificacionFisica,
  isSameDepartment,
  normalizeDepartmentName
} from "../utils/validacionStorage";
import { playSound } from "../utils/audio";
import {
  CheckCircle2,
  ClipboardCheck,
  AlertTriangle,
  Package,
  Layers,
  MapPin,
  Clock,
  Building2,
  User,
  FileEdit,
  ShieldAlert,
  X
} from "lucide-react";

interface ModalVerificacionProductoProps {
  solicitud: SolicitudVerificacionProducto | null;
  currentUser: Usuario;
  liveProduct?: Producto | null;
  onClose: () => void;
  onConfirmed?: (
    solicitudActualizada: SolicitudVerificacionProducto,
    propuestaCodigo?: string
  ) => void;
  showToast?: (msg: string) => void;
}

export default function ModalVerificacionProducto({
  solicitud,
  currentUser,
  liveProduct,
  onClose,
  onConfirmed,
  showToast
}: ModalVerificacionProductoProps) {
  const [showConfirmForm, setShowConfirmForm] = useState(false);
  const [selectedQuickResponses, setSelectedQuickResponses] = useState<string[]>([
    "Código de producto verificado.",
    "Existencias físicas coinciden con el sistema."
  ]);
  const [customObservaciones, setCustomObservaciones] = useState("");
  const [existenciaFisicaComprobada, setExistenciaFisicaComprobada] = useState<number>(0);
  const [detectoDiferencias, setDetectoDiferencias] = useState(false);
  const [generarPropuesta, setGenerarPropuesta] = useState(false);

  // Campos de la propuesta de ajuste
  const [propNombre, setPropNombre] = useState("");
  const [propUnidad, setPropUnidad] = useState("");
  const [propLote, setPropLote] = useState("");
  const [propStockSistema, setPropStockSistema] = useState<number>(0);
  const [propStockFisico, setPropStockFisico] = useState<number>(0);
  const [propCosto, setPropCosto] = useState<number>(0);
  const [propVencimiento, setPropVencimiento] = useState("");
  const [propMotivo, setPropMotivo] = useState(
    "Diferencia detectada durante comprobación física de solicitud de verificación"
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!solicitud) return;
    const lotes =
      liveProduct && Array.isArray(liveProduct.lotes) && liveProduct.lotes.length > 0
        ? liveProduct.lotes
        : solicitud.lotesSnapshot || [];
    const currentSys = liveProduct
      ? lotes.reduce((acc, l) => acc + Number(l.cantidad || 0), 0)
      : solicitud.existenciaSistemaAlSolicitar;
    const currentPhys = liveProduct
      ? lotes.reduce((acc, l) => acc + Number(l.cantidadF ?? l.cantidad ?? 0), 0)
      : solicitud.existenciaFisicaAlSolicitar;
    const primaryLot = lotes[0];

    setShowConfirmForm(false);
    setSelectedQuickResponses([
      "Código de producto verificado.",
      "Existencias físicas coinciden con el sistema."
    ]);
    setCustomObservaciones("");
    setExistenciaFisicaComprobada(currentPhys);
    setDetectoDiferencias(false);
    setGenerarPropuesta(false);

    setPropNombre(liveProduct?.nombre || solicitud.productoNombre);
    setPropUnidad(liveProduct?.descripcion || solicitud.unidadMedida || "Unidad");
    setPropLote(primaryLot?.numeroLote || "GENERAL");
    setPropStockSistema(currentSys);
    setPropStockFisico(currentPhys);
    setPropCosto(primaryLot ? Number(primaryLot.precio || 0) : solicitud.costoUnitarioAlSolicitar);
    setPropVencimiento(primaryLot?.fechaVencimiento || solicitud.proximoVencimientoAlSolicitar || "");
    setPropMotivo("Diferencia detectada durante comprobación física de solicitud de verificación");
  }, [solicitud, liveProduct]);

  if (!solicitud) return null;

  const lotesToDisplay =
    liveProduct && Array.isArray(liveProduct.lotes) && liveProduct.lotes.length > 0
      ? liveProduct.lotes
      : solicitud.lotesSnapshot || [];

  const currentStockSistema = liveProduct
    ? lotesToDisplay.reduce((acc, l) => acc + Number(l.cantidad || 0), 0)
    : solicitud.existenciaSistemaAlSolicitar;

  const currentStockFisico = liveProduct
    ? lotesToDisplay.reduce((acc, l) => acc + Number(l.cantidadF ?? l.cantidad ?? 0), 0)
    : solicitud.existenciaFisicaAlSolicitar;

  const canVerify =
    currentUser.rol === "Administrador" ||
    isSameDepartment(currentUser.departamento, solicitud.departamentoDestino) ||
    isSameDepartment(currentUser.departamento, "Almacén y Suministros");

  const toggleQuickResponse = (resp: string) => {
    playSound("click");
    setSelectedQuickResponses((prev) => {
      const exists = prev.includes(resp);
      const next = exists ? prev.filter((r) => r !== resp) : [...prev, resp];

      // Ajustar flag de diferencias automáticamente si selecciona una respuesta de discrepancia
      const hasDiffChip = next.some(
        (r) =>
          r.includes("Diferencia") ||
          r.includes("incorrecta") ||
          r.includes("Requiere actualización")
      );
      if (hasDiffChip) {
        setDetectoDiferencias(true);
        setGenerarPropuesta(true);
      }
      return next;
    });
  };

  const handleConfirmSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      const { solicitudActualizada, propuestaCreada } = await confirmarSolicitudVerificacionFisica({
        solicitud,
        respuestasRapidas: selectedQuickResponses,
        observacionesPersonalizadas: customObservaciones,
        existenciaFisicaComprobada,
        detectoDiferencias,
        generarPropuestaAjuste: detectoDiferencias && generarPropuesta,
        datosPropuesta:
          detectoDiferencias && generarPropuesta
            ? {
                existenciaSistemaPropuesta: propStockSistema,
                existenciaFisicaPropuesta: propStockFisico,
                costoPropuesto: propCosto,
                fechaVencimientoPropuesta: propVencimiento,
                productoNombrePropuesto: propNombre,
                unidadMedidaPropuesta: propUnidad,
                numeroLotePropuesto: propLote,
                motivoCambio: propMotivo
              }
            : undefined,
        currentUser
      });

      playSound("positive");
      if (propuestaCreada) {
        showToast?.(
          `Validación confirmada. Se generó la propuesta de ajuste ${propuestaCreada.codigoPropuesta} pendiente de autorización.`
        );
      } else {
        showToast?.(`Validación física ${solicitud.codigoSolicitud} confirmada correctamente.`);
      }
      onConfirmed?.(solicitudActualizada, propuestaCreada?.codigoPropuesta);
      onClose();
    } catch (err) {
      console.error("Error al confirmar validación:", err);
      playSound("negative");
      showToast?.("Ocurrió un error al guardar la confirmación de validación.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-2xl max-h-[92dvh] bg-slate-50 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden anim-slide-up sm:anim-pop-in">
        {/* Cabecera */}
        <div className="px-5 py-4 bg-gradient-to-r from-teal-800 to-teal-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
              <ClipboardCheck className="w-5 h-5 text-teal-200" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono font-black uppercase tracking-wider bg-amber-400 text-slate-950 px-2 py-0.5 rounded-md">
                  {solicitud.tipo} • {solicitud.codigoSolicitud}
                </span>
                <span
                  className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-md border ${
                    solicitud.estado === "PENDIENTE"
                      ? "bg-amber-500/20 text-amber-200 border-amber-400/40"
                      : solicitud.estado === "CONFIRMADA_COINCIDE"
                      ? "bg-emerald-500/20 text-emerald-200 border-emerald-400/40"
                      : "bg-rose-500/20 text-rose-200 border-rose-400/40"
                  }`}
                >
                  {solicitud.estado === "PENDIENTE"
                    ? "Pendiente de Comprobación"
                    : solicitud.estado === "CONFIRMADA_COINCIDE"
                    ? "Validada (Coincide)"
                    : "Validada con Diferencias"}
                </span>
              </div>
              <h3 className="text-sm sm:text-base font-extrabold truncate mt-1">
                {liveProduct?.nombre || solicitud.productoNombre}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/10 text-teal-100 hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido scrollable */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* 1. Mensaje y metadatos de la solicitud */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 text-xs">
              <div className="flex items-center gap-2 font-bold text-slate-700">
                <User className="w-4 h-4 text-teal-600" />
                <span>Solicitado por: {solicitud.usuarioSolicitanteNombre}</span>
                <span className="text-[10px] font-extrabold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                  {solicitud.departamentoOrigen}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  {solicitud.fechaSolicitud} • {solicitud.horaSolicitud}
                </span>
              </div>
            </div>

            <div className="bg-teal-50/70 border border-teal-200/80 rounded-xl p-3 text-xs text-teal-950 font-semibold leading-relaxed">
              «{solicitud.mensajeSolicitud}»
            </div>

            <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 pt-1">
              <span className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-teal-700" />
                Departamento Destinatario:{" "}
                <strong className="text-teal-800">{solicitud.departamentoDestino}</strong>
              </span>
              {solicitud.ubicacionFisica && (
                <span className="flex items-center gap-1 text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                  <MapPin className="w-3 h-3" />
                  Ubicación: {solicitud.ubicacionFisica}
                </span>
              )}
            </div>
          </div>

          {/* 2. Ficha Técnica del Producto a Verificar */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                <Package className="w-4 h-4 text-teal-600" />
                <span>Detalle del Producto en el Sistema</span>
              </h4>
              <span className="font-mono text-xs font-black bg-teal-50 text-teal-800 border border-teal-200 px-2.5 py-0.5 rounded-lg">
                Código: {solicitud.productoCodigo}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                <span className="text-[10px] font-extrabold uppercase text-slate-500 block">
                  Unidad / Presentación
                </span>
                <p className="text-xs sm:text-sm font-extrabold text-slate-900 mt-1 truncate">
                  {liveProduct?.descripcion || solicitud.unidadMedida || "Unidad"}
                </p>
              </div>
              <div className="bg-teal-50/60 border border-teal-200 rounded-xl p-3">
                <span className="text-[10px] font-extrabold uppercase text-teal-700 block">
                  Existencia Sistema
                </span>
                <p className="text-base sm:text-lg font-black text-teal-950 mt-0.5 tabular-nums">
                  {currentStockSistema} und.
                </p>
              </div>
              <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3">
                <span className="text-[10px] font-extrabold uppercase text-amber-800 block">
                  Existencia Física Reg.
                </span>
                <p className="text-base sm:text-lg font-black text-amber-950 mt-0.5 tabular-nums">
                  {currentStockFisico} und.
                </p>
              </div>
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3">
                <span className="text-[10px] font-extrabold uppercase text-slate-500 block">
                  Costo / Vencimiento
                </span>
                <p className="text-xs font-extrabold text-slate-900 mt-1 tabular-nums">
                  RD$ {Number(solicitud.costoUnitarioAlSolicitar || 0).toFixed(2)}
                </p>
                <span className="text-[10px] font-semibold text-slate-500 block">
                  Vto: {solicitud.proximoVencimientoAlSolicitar || "S/F"}
                </span>
              </div>
            </div>

            {/* Desglose de Lotes */}
            <div className="space-y-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-500" />
                Lotes Registrados ({lotesToDisplay.length})
              </span>
              {lotesToDisplay.length === 0 ? (
                <p className="text-xs text-slate-500 italic bg-slate-50 p-3 rounded-xl border border-slate-200">
                  Este producto no tiene lotes activos registrados.
                </p>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-[10px] font-extrabold uppercase text-slate-600">
                        <th className="px-3 py-2">N.º de Lote</th>
                        <th className="px-3 py-2">Ubicación Física</th>
                        <th className="px-3 py-2 text-right">Stock Sistema</th>
                        <th className="px-3 py-2 text-right">Stock Físico</th>
                        <th className="px-3 py-2">Vencimiento</th>
                        <th className="px-3 py-2 text-right">Costo Unit.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {lotesToDisplay.map((l) => (
                        <tr key={l.id}>
                          <td className="px-3 py-2 font-mono font-bold text-slate-900">{l.numeroLote}</td>
                          <td className="px-3 py-2 text-amber-800 font-semibold">
                            {l.loteFisico || "No especificada"}
                          </td>
                          <td className="px-3 py-2 text-right font-extrabold text-slate-900 tabular-nums">
                            {l.cantidad}
                          </td>
                          <td className="px-3 py-2 text-right font-extrabold text-amber-900 tabular-nums">
                            {l.cantidadF ?? l.cantidad}
                          </td>
                          <td className="px-3 py-2 font-semibold text-slate-700 tabular-nums">
                            {l.fechaVencimiento || "S/F"}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-700 tabular-nums">
                            RD$ {Number(l.precio || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* 3. Si ya fue verificada, mostrar resultado histórico */}
          {solicitud.estado !== "PENDIENTE" && (
            <div
              className={`rounded-2xl border p-4 sm:p-5 space-y-3 ${
                solicitud.estado === "CONFIRMADA_COINCIDE"
                  ? "bg-emerald-50/70 border-emerald-200"
                  : "bg-amber-50/80 border-amber-300"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Resultado de la Verificación Física</span>
                </h4>
                <span className="text-[11px] font-bold text-slate-600">
                  {solicitud.fechaVerificacion} • {solicitud.horaVerificacion}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="bg-white/90 rounded-xl p-3 border border-slate-200/80">
                  <span className="text-[10px] font-extrabold uppercase text-slate-500 block">
                    Responsable de Verificación
                  </span>
                  <p className="font-extrabold text-slate-900 mt-0.5">
                    {solicitud.verificadoPorNombre} ({solicitud.verificadoPorDepartamento})
                  </p>
                </div>
                <div className="bg-white/90 rounded-xl p-3 border border-slate-200/80">
                  <span className="text-[10px] font-extrabold uppercase text-slate-500 block">
                    Existencia Física Comprobada
                  </span>
                  <p className="font-black text-slate-900 text-sm mt-0.5 tabular-nums">
                    {solicitud.existenciaFisicaComprobada ?? currentStockFisico} unidades
                  </p>
                </div>
              </div>

              {solicitud.respuestasRapidasSeleccionadas &&
                solicitud.respuestasRapidasSeleccionadas.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {solicitud.respuestasRapidasSeleccionadas.map((r, i) => (
                      <span
                        key={i}
                        className="text-[11px] font-bold bg-white border border-slate-300 text-slate-800 px-2.5 py-1 rounded-lg"
                      >
                        ✓ {r}
                      </span>
                    ))}
                  </div>
                )}

              <div className="bg-white/90 rounded-xl p-3 border border-slate-200/80 text-xs">
                <span className="text-[10px] font-extrabold uppercase text-slate-500 block mb-1">
                  Observaciones Registradas
                </span>
                <p className="font-semibold text-slate-800">
                  {solicitud.observacionesVerificacion || "Sin observaciones adicionales."}
                </p>
              </div>

              {solicitud.propuestaAjusteCodigo && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex items-center justify-between text-xs">
                  <span className="font-bold text-indigo-950">
                    Propuesta de Ajuste Generada: <strong>{solicitud.propuestaAjusteCodigo}</strong>
                  </span>
                  <span className="text-[10px] font-extrabold uppercase bg-indigo-100 text-indigo-800 px-2.5 py-1 rounded-md">
                    Sujeta a Autorización en Módulo Validación
                  </span>
                </div>
              )}
            </div>
          )}

          {/* 4. Formulario de Confirmación de Validación */}
          {solicitud.estado === "PENDIENTE" && !showConfirmForm && (
            <div className="bg-teal-50/70 border border-teal-200 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="space-y-0.5 text-center sm:text-left">
                <p className="text-xs font-extrabold text-teal-950">
                  ¿Ya realizaste la comprobación física del suministro?
                </p>
                <p className="text-[11px] text-teal-800 font-medium">
                  Presiona «Confirmar validación» para registrar tus observaciones o proponer un ajuste controlado.
                </p>
              </div>
              {canVerify ? (
                <button
                  type="button"
                  onClick={() => {
                    playSound("open");
                    setShowConfirmForm(true);
                  }}
                  className="w-full sm:w-auto px-5 py-3 rounded-xl bg-teal-700 hover:bg-teal-800 active:scale-95 text-white text-xs font-extrabold uppercase tracking-wider shadow-sm transition cursor-pointer shrink-0 flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Confirmar validación</span>
                </button>
              ) : (
                <span className="text-[11px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-3 py-1.5 rounded-xl">
                  Esperando confirmación de {solicitud.departamentoDestino}
                </span>
              )}
            </div>
          )}

          {showConfirmForm && (
            <form
              onSubmit={handleConfirmSubmit}
              className="bg-white rounded-2xl border-2 border-teal-600/80 p-4 sm:p-5 shadow-md space-y-4 anim-pop-in"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h4 className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-teal-900 flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4 text-teal-700" />
                  <span>Confirmación de Validación Física y Observaciones</span>
                </h4>
                <span className="text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200 px-2.5 py-0.5 rounded-md">
                  Responsable: {currentUser.nombre}
                </span>
              </div>

              {/* Respuestas Rápidas Requeridas */}
              <div className="space-y-2">
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700">
                  Respuestas Rápidas de Verificación (Selecciona las que apliquen)
                </label>
                <div className="flex flex-wrap gap-2">
                  {RESPUESTAS_RAPIDAS_VERIFICACION.map((resp) => {
                    const isSelected = selectedQuickResponses.includes(resp);
                    return (
                      <button
                        key={resp}
                        type="button"
                        onClick={() => toggleQuickResponse(resp)}
                        className={`text-xs font-bold px-3 py-2 rounded-xl border transition cursor-pointer flex items-center gap-1.5 ${
                          isSelected
                            ? "bg-teal-700 text-white border-teal-700 shadow-2xs"
                            : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-teal-50 hover:border-teal-300"
                        }`}
                      >
                        <span>{isSelected ? "✓" : "+"}</span>
                        <span>{resp}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Conteo Físico y Estado de Coincidencia */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div>
                  <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 mb-1.5">
                    Existencia Física Comprobada (Unidades)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={existenciaFisicaComprobada}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setExistenciaFisicaComprobada(val);
                      setPropStockFisico(val);
                      if (val !== currentStockSistema) {
                        setDetectoDiferencias(true);
                      }
                    }}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-black text-slate-900 outline-none focus:ring-2 focus:ring-teal-500/30 tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 mb-1.5">
                    Resultado de la Comprobación
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDetectoDiferencias(false);
                        setGenerarPropuesta(false);
                      }}
                      className={`py-2.5 px-3 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                        !detectoDiferencias
                          ? "bg-emerald-600 text-white border-emerald-600 shadow-2xs"
                          : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      ✓ Todo Coincide
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDetectoDiferencias(true);
                        setGenerarPropuesta(true);
                      }}
                      className={`py-2.5 px-3 rounded-xl text-xs font-extrabold border transition cursor-pointer ${
                        detectoDiferencias
                          ? "bg-amber-600 text-white border-amber-600 shadow-2xs"
                          : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                      }`}
                    >
                      ⚠ Hay Diferencias
                    </button>
                  </div>
                </div>
              </div>

              {/* Observaciones personalizadas */}
              <div>
                <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-700 mb-1.5">
                  Observaciones Personalizadas
                </label>
                <textarea
                  rows={2}
                  value={customObservaciones}
                  onChange={(e) => setCustomObservaciones(e.target.value)}
                  placeholder="Escriba detalles adicionales de la verificación física..."
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-teal-500/30"
                />
              </div>

              {/* Propuesta de Corrección o Ajuste cuando se detectan diferencias */}
              {detectoDiferencias && (
                <div className="bg-amber-50/70 border border-amber-300 rounded-2xl p-4 space-y-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <label className="inline-flex items-center gap-2 text-xs font-extrabold text-amber-950 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={generarPropuesta}
                        onChange={(e) => setGenerarPropuesta(e.target.checked)}
                        className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500"
                      />
                      <span className="flex items-center gap-1.5">
                        <FileEdit className="w-4 h-4 text-amber-700" />
                        Generar Propuesta de Corrección o Ajuste de Inventario
                      </span>
                    </label>
                    <span className="text-[10px] font-extrabold uppercase bg-amber-200/80 text-amber-950 px-2 py-0.5 rounded-md">
                      Requiere Autorización
                    </span>
                  </div>

                  <div className="flex items-start gap-2 text-[11px] text-amber-900 bg-white/80 border border-amber-200 rounded-xl p-2.5">
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="font-semibold leading-relaxed">
                      <strong>Control de Cambios:</strong> Confirmar esta validación NO modificará automáticamente el inventario. La propuesta quedará pendiente hasta que un usuario autorizado la revise y apruebe explícitamente.
                    </p>
                  </div>

                  {generarPropuesta && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                          Stock Sistema Propuesto (Actual: {currentStockSistema})
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={propStockSistema}
                          onChange={(e) => setPropStockSistema(Number(e.target.value))}
                          className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-black text-slate-900 tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                          Stock Físico Propuesto (Actual: {currentStockFisico})
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={propStockFisico}
                          onChange={(e) => setPropStockFisico(Number(e.target.value))}
                          className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-black text-slate-900 tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                          Costo Unit. Propuesto (RD$)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={propCosto}
                          onChange={(e) => setPropCosto(Number(e.target.value))}
                          className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                          Nombre del Producto Propuesto
                        </label>
                        <input
                          type="text"
                          value={propNombre}
                          onChange={(e) => setPropNombre(e.target.value)}
                          className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                          Unidad de Medida / Presentación
                        </label>
                        <input
                          type="text"
                          value={propUnidad}
                          onChange={(e) => setPropUnidad(e.target.value)}
                          className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                          Vencimiento Propuesto
                        </label>
                        <input
                          type="date"
                          value={propVencimiento}
                          onChange={(e) => setPropVencimiento(e.target.value)}
                          className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-slate-900"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                          Motivo del Ajuste Propuesto *
                        </label>
                        <input
                          type="text"
                          required
                          value={propMotivo}
                          onChange={(e) => setPropMotivo(e.target.value)}
                          placeholder="Explique la causa de la discrepancia detectada..."
                          className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowConfirmForm(false)}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 text-white text-xs font-extrabold uppercase tracking-wider shadow-sm transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {submitting
                      ? "Guardando..."
                      : detectoDiferencias && generarPropuesta
                      ? "Confirmar Validación y Enviar Propuesta"
                      : "Guardar y Confirmar Validación"}
                  </span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Pie del Modal */}
        <div className="px-5 py-3.5 bg-white border-t border-slate-200 flex items-center justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-extrabold text-slate-700 transition cursor-pointer"
          >
            Cerrar Ventana
          </button>
        </div>
      </div>
    </div>
  );
}
