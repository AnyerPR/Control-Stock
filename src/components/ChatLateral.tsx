import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  deleteDoc
} from "firebase/firestore";
import { tenantCollection, tenantDoc } from "../firebase";
import {
  Departamento,
  Producto,
  SolicitudVerificacionProducto,
  Usuario
} from "../types";
import {
  createSolicitudVerificacionProducto,
  isSameDepartment,
  normalizeDepartmentName,
  subscribeValidacionCollections
} from "../utils/validacionStorage";
import ModalVerificacionProducto from "./ModalVerificacionProducto";
import { playSound } from "../utils/audio";
import {
  MessageSquare,
  Send,
  X,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Clock,
  Trash2,
  Building2,
  ClipboardCheck,
  Package,
  Bell
} from "lucide-react";

interface ChatLateralProps {
  currentUser: Usuario;
  departamentos?: Departamento[];
  products?: Producto[];
  showToast?: (msg: string) => void;
}

export interface ChatMensaje {
  id: string;
  texto: string;
  usuarioNombre: string;
  usuarioId: string;
  departamento: string;
  departamentoDestino?: string;
  rol: string;
  timestamp: any;
  esSistema?: boolean;
  tipoMensaje?: "TEXTO" | "SOLICITUD_VERIFICACION" | "CONFIRMACION_VERIFICACION";
  solicitudVerificacionId?: string;
  solicitudCodigo?: string;
  productoCodigo?: string;
  productoNombre?: string;
}

export interface OpenValidationChatEventDetail {
  producto: Producto;
  ubicacionFisica?: string;
}

export function triggerOpenChatForProductValidation(
  producto: Producto,
  ubicacionFisica?: string
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenValidationChatEventDetail>("open_chat_validacion_producto", {
      detail: { producto, ubicacionFisica }
    })
  );
}

const DEFAULT_DEPARTMENTS_LIST = [
  "Almacén y Suministros",
  "Administración",
  "Farmacia",
  "Laboratorio",
  "Odontología",
  "Enfermería",
  "Urgencias",
  "Quirófano"
];

const TEMPLATED_MESSAGES = [
  { text: "🚨 Stock Crítico", desc: "Reportar escasez de insumo urgente" },
  { text: "📦 Lote Recibido", desc: "Confirmar entrada de nuevo lote" },
  { text: "🩺 Suministro Listo", desc: "Notificar material listo para retirar" },
  { text: "💬 Consulta Solicitud", desc: "Preguntar sobre estado de orden" },
  { text: "🔄 Ajuste de Físico", desc: "Notificar discrepancia de inventario" }
];

export default function ChatLateral({
  currentUser,
  departamentos = [],
  products = [],
  showToast
}: ChatLateralProps) {
  const userDept = normalizeDepartmentName(currentUser.departamento || "Administración");

  const [isOpen, setIsOpen] = useState(false);
  const [activeViewTab, setActiveViewTab] = useState<"chat" | "verificaciones">("chat");
  const [selectedTargetDept, setSelectedTargetDept] = useState<string>("MI_DEPARTAMENTO");
  const [messages, setMessages] = useState<ChatMensaje[]>([]);
  const [solicitudesVerificacion, setSolicitudesVerificacion] = useState<
    SolicitudVerificacionProducto[]
  >([]);
  const [verificacionFilter, setVerificacionFilter] = useState<"PENDIENTES" | "TODAS">(
    "PENDIENTES"
  );

  // Estado para modal de Solicitud de Verificación iniciada desde el botón «Validar» en Suministros
  const [draftProductValidation, setDraftProductValidation] = useState<{
    producto: Producto;
    ubicacionFisica?: string;
    departamentoDestino: string;
    mensaje: string;
  } | null>(null);
  const [sendingValidationDraft, setSendingValidationDraft] = useState(false);

  // Estado para abrir el detalle de una Solicitud de Verificación y confirmarla
  const [selectedSolicitudModal, setSelectedSolicitudModal] =
    useState<SolicitudVerificacionProducto | null>(null);

  const [inputText, setInputText] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [sending, setSending] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [limitAmount, setLimitAmount] = useState(35);
  const [hasMore, setHasMore] = useState(false);
  const [msgToDelete, setMsgToDelete] = useState<string | null>(null);

  const lastOpenedRef = useRef<number>(Date.now());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const firstLoadRef = useRef(true);
  const isLoadingMoreRef = useRef(false);
  const isOpenRef = useRef(isOpen);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const isAnyer =
    currentUser?.usuario?.trim().toLowerCase() === "anyer" ||
    currentUser?.nombre?.trim().toLowerCase() === "anyer" ||
    currentUser?.rol === "Administrador";

  const isLocalFileMode =
    typeof window !== "undefined" && window.location.protocol === "file:";

  // Construir lista única de departamentos disponibles asegurando que "Almacén y Suministros" esté siempre presente
  const availableDepartments = useMemo(() => {
    const map = new Map<string, string>();
    map.set("almacen y suministros", "Almacén y Suministros");
    for (const d of DEFAULT_DEPARTMENTS_LIST) {
      const clean = normalizeDepartmentName(d);
      map.set(clean.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""), clean);
    }
    for (const d of departamentos) {
      if (d && d.activo !== false && d.nombre) {
        const clean = normalizeDepartmentName(d.nombre);
        map.set(clean.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""), clean);
      }
    }
    if (userDept) {
      map.set(userDept.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""), userDept);
    }
    return Array.from(map.values());
  }, [departamentos, userDept]);

  // Escuchar evento global disparado por el botón «Validar» en cada producto de Suministros
  useEffect(() => {
    const handleOpenValidationRequest = (e: Event) => {
      const custom = e as CustomEvent<OpenValidationChatEventDetail>;
      const prod = custom.detail?.producto;
      if (!prod) return;

      const prefilledMsg = `Solicito la verificación física y validación de la información correspondiente al producto ${prod.nombre}, código ${prod.codigo}. Favor comprobar que sus datos y existencias coincidan con la información registrada en el sistema.`;

      setDraftProductValidation({
        producto: prod,
        ubicacionFisica: custom.detail?.ubicacionFisica,
        departamentoDestino: "Almacén y Suministros",
        mensaje: prefilledMsg
      });
      setSelectedTargetDept("Almacén y Suministros");
      setActiveViewTab("chat");
      setIsOpen(true);
      setUnreadCount(0);
      playSound("open");
    };

    window.addEventListener("open_chat_validacion_producto", handleOpenValidationRequest);
    return () => {
      window.removeEventListener("open_chat_validacion_producto", handleOpenValidationRequest);
    };
  }, []);

  // Suscripción a Solicitudes de Verificación
  useEffect(() => {
    const unsub = subscribeValidacionCollections({
      onSolicitudes: (list) => {
        setSolicitudesVerificacion(list);
      }
    });
    return () => unsub();
  }, [currentUser.farmaciaId]);

  const handleDeleteMessage = (msgId: string) => {
    if (!isAnyer) return;
    setMsgToDelete(msgId);
  };

  const confirmDeleteMessage = async () => {
    if (!msgToDelete) return;
    if (isLocalFileMode) {
      const stored = localStorage.getItem("offline_chat_mensajes");
      let list: ChatMensaje[] = [];
      if (stored) {
        try {
          list = JSON.parse(stored);
        } catch {}
      }
      list = list.filter((m) => m.id !== msgToDelete);
      localStorage.setItem("offline_chat_mensajes", JSON.stringify(list));
      window.dispatchEvent(new Event("offline_chat_update"));
      playSound("negative");
      setMsgToDelete(null);
      return;
    }

    try {
      await deleteDoc(tenantDoc("chat_mensajes", msgToDelete));
      playSound("negative");
    } catch (err) {
      console.error("Error deleting message:", err);
    } finally {
      setMsgToDelete(null);
    }
  };

  // Cargar mensajes en tiempo real
  useEffect(() => {
    if (isLocalFileMode) {
      const loadOfflineMessages = () => {
        const stored = localStorage.getItem("offline_chat_mensajes");
        let list: ChatMensaje[] = [];
        if (stored) {
          try {
            list = JSON.parse(stored);
          } catch {}
        }
        if (list.length === 0) {
          list = [
            {
              id: "welcome-1",
              texto:
                "¡Bienvenido al Chat Interno Departamental! Selecciona un departamento en el menú superior para comunicarte o gestionar Solicitudes de Verificación.",
              usuarioNombre: "Sistema",
              usuarioId: "system-bot",
              departamento: "Sistema 🤖",
              rol: "Sistema",
              timestamp: Date.now(),
              esSistema: true
            }
          ];
          localStorage.setItem("offline_chat_mensajes", JSON.stringify(list));
        }
        setMessages(list);
        setHasMore(false);
      };

      loadOfflineMessages();
      window.addEventListener("offline_chat_update", loadOfflineMessages);
      return () => {
        window.removeEventListener("offline_chat_update", loadOfflineMessages);
      };
    }

    const messagesCol = tenantCollection("chat_mensajes");
    const q = query(messagesCol, orderBy("timestamp", "desc"), limit(limitAmount));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: ChatMensaje[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          list.push({
            id: docSnap.id,
            texto: data.texto || "",
            usuarioNombre: data.usuarioNombre || "Usuario",
            usuarioId: data.usuarioId || "",
            departamento: normalizeDepartmentName(data.departamento || "Administración"),
            departamentoDestino: data.departamentoDestino
              ? normalizeDepartmentName(data.departamentoDestino)
              : undefined,
            rol: data.rol || "Operador",
            timestamp: data.timestamp
              ? data.timestamp.seconds
                ? data.timestamp.seconds * 1000
                : data.timestamp
              : Date.now(),
            esSistema: !!data.esSistema,
            tipoMensaje: data.tipoMensaje,
            solicitudVerificacionId: data.solicitudVerificacionId,
            solicitudCodigo: data.solicitudCodigo,
            productoCodigo: data.productoCodigo,
            productoNombre: data.productoNombre
          });
        });

        const chronologicalList = [...list].reverse();
        setMessages(chronologicalList);
        setHasMore(list.length >= limitAmount);

        if (!firstLoadRef.current && list.length > 0) {
          const lastMsg = list[0];
          const isRecent = Date.now() - lastMsg.timestamp < 10000;
          const isRelevantToUser =
            isAnyer ||
            !lastMsg.departamentoDestino ||
            isSameDepartment(lastMsg.departamento, userDept) ||
            isSameDepartment(lastMsg.departamentoDestino, userDept);

          if (isRecent && lastMsg.usuarioId !== currentUser.id && isRelevantToUser) {
            playSound("notify");
            if (!isOpenRef.current) {
              setUnreadCount((prev) => prev + 1);
            }
          }
        } else {
          firstLoadRef.current = false;
        }
      },
      (error) => {
        console.error("Error listening to chat messages:", error);
      }
    );

    return () => unsubscribe();
  }, [currentUser.id, currentUser.farmaciaId, limitAmount, isLocalFileMode, isAnyer, userDept]);

  // Filtrar mensajes según el departamento del usuario y el canal departamental seleccionado
  const filteredMessages = useMemo(() => {
    return messages.filter((msg) => {
      if (msg.esSistema) return true;
      const msgOrigin = normalizeDepartmentName(msg.departamento);
      const msgDest = msg.departamentoDestino
        ? normalizeDepartmentName(msg.departamentoDestino)
        : "";

      // Si el usuario seleccionó "MI_DEPARTAMENTO": mostrar todas las conversaciones donde participa su departamento
      if (selectedTargetDept === "MI_DEPARTAMENTO") {
        if (isAnyer && !msgDest) return true;
        return (
          isSameDepartment(msgOrigin, userDept) ||
          (msgDest !== "" && isSameDepartment(msgDest, userDept)) ||
          !msgDest
        );
      }

      // Si seleccionó "CANAL_GENERAL": mostrar mensajes generales o interdepartamentales abiertos
      if (selectedTargetDept === "CANAL_GENERAL") {
        return !msgDest || isSameDepartment(msgOrigin, userDept) || isSameDepartment(msgDest, userDept) || isAnyer;
      }

      // Si seleccionó un departamento específico del menú:
      // Mostrar las conversaciones entre el departamento del usuario y el departamento seleccionado (o internas de ese departamento si es del mismo o Admin)
      const involvesSelected =
        isSameDepartment(msgOrigin, selectedTargetDept) ||
        (msgDest !== "" && isSameDepartment(msgDest, selectedTargetDept));
      const involvesUserOrAdmin =
        isAnyer ||
        isSameDepartment(userDept, selectedTargetDept) ||
        isSameDepartment(msgOrigin, userDept) ||
        (msgDest !== "" && isSameDepartment(msgDest, userDept));

      return involvesSelected && involvesUserOrAdmin;
    });
  }, [messages, selectedTargetDept, userDept, isAnyer]);

  // Solicitudes de verificación correspondientes al departamento del usuario (o al departamento seleccionado)
  const departmentSolicitudes = useMemo(() => {
    return solicitudesVerificacion.filter((sol) => {
      if (selectedTargetDept !== "MI_DEPARTAMENTO" && selectedTargetDept !== "CANAL_GENERAL") {
        return (
          isSameDepartment(sol.departamentoDestino, selectedTargetDept) ||
          isSameDepartment(sol.departamentoOrigen, selectedTargetDept)
        );
      }
      if (isAnyer) return true;
      return (
        isSameDepartment(sol.departamentoDestino, userDept) ||
        isSameDepartment(sol.departamentoOrigen, userDept)
      );
    });
  }, [solicitudesVerificacion, selectedTargetDept, userDept, isAnyer]);

  const pendingVerificationCountForMyDept = useMemo(() => {
    return solicitudesVerificacion.filter(
      (sol) =>
        sol.estado === "PENDIENTE" &&
        (isSameDepartment(sol.departamentoDestino, userDept) || isAnyer)
    ).length;
  }, [solicitudesVerificacion, userDept, isAnyer]);

  const scrollToBottom = () => {
    if (isLoadingMoreRef.current) {
      isLoadingMoreRef.current = false;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen && activeViewTab === "chat") {
      scrollToBottom();
    }
  }, [filteredMessages.length, isOpen, activeViewTab]);

  const handleLoadMore = () => {
    isLoadingMoreRef.current = true;
    playSound("click");
    setLimitAmount((prev) => prev + 20);
  };

  const handleToggleOpen = () => {
    if (!isOpen) {
      playSound("open");
      setIsOpen(true);
      setUnreadCount(0);
      lastOpenedRef.current = Date.now();
    } else {
      playSound("close");
      setIsOpen(false);
    }
  };

  const effectiveRecipientDept =
    selectedTargetDept === "MI_DEPARTAMENTO"
      ? userDept
      : selectedTargetDept === "CANAL_GENERAL"
      ? ""
      : selectedTargetDept;

  const handleSendMessage = async (textToSend?: string) => {
    const text = textToSend !== undefined ? textToSend.trim() : inputText.trim();
    if (!text) return;

    setSending(true);
    if (isLocalFileMode) {
      const newMsg: ChatMensaje = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        texto: text,
        usuarioNombre: currentUser.nombre,
        usuarioId: currentUser.id,
        departamento: userDept,
        ...(effectiveRecipientDept ? { departamentoDestino: effectiveRecipientDept } : {}),
        rol: currentUser.rol,
        timestamp: Date.now(),
        esSistema: false,
        tipoMensaje: "TEXTO"
      };

      const stored = localStorage.getItem("offline_chat_mensajes");
      let list: ChatMensaje[] = [];
      if (stored) {
        try {
          list = JSON.parse(stored);
        } catch {}
      }
      list.push(newMsg);
      localStorage.setItem("offline_chat_mensajes", JSON.stringify(list));
      window.dispatchEvent(new Event("offline_chat_update"));

      if (textToSend === undefined) {
        setInputText("");
      }
      playSound("click");
      setSending(false);
      return;
    }

    try {
      await addDoc(tenantCollection("chat_mensajes"), {
        texto: text,
        usuarioNombre: currentUser.nombre,
        usuarioId: currentUser.id,
        departamento: userDept,
        ...(effectiveRecipientDept ? { departamentoDestino: effectiveRecipientDept } : {}),
        rol: currentUser.rol,
        timestamp: serverTimestamp(),
        esSistema: false,
        tipoMensaje: "TEXTO"
      });
      if (textToSend === undefined) {
        setInputText("");
      }
      playSound("click");
    } catch (err) {
      console.error("Error sending chat message:", err);
    } finally {
      setSending(false);
    }
  };

  const handleSendDraftValidationRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftProductValidation || sendingValidationDraft) return;

    setSendingValidationDraft(true);
    try {
      const created = await createSolicitudVerificacionProducto({
        producto: draftProductValidation.producto,
        departamentoDestino: draftProductValidation.departamentoDestino,
        mensajePersonalizado: draftProductValidation.mensaje,
        ubicacionFisica: draftProductValidation.ubicacionFisica,
        currentUser
      });
      setSelectedTargetDept(draftProductValidation.departamentoDestino);
      setDraftProductValidation(null);
      playSound("positive");
      showToast?.(
        `Solicitud de verificación ${created.codigoSolicitud} enviada a ${created.departamentoDestino}.`
      );
    } catch (err) {
      console.error("Error enviando solicitud de verificación:", err);
      playSound("negative");
      showToast?.("No se pudo enviar la solicitud de verificación.");
    } finally {
      setSendingValidationDraft(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSendMessage();
    }
  };

  const getDeptColor = (dept: string, esSistema?: boolean) => {
    if (esSistema) return "bg-slate-100 text-slate-700 border-slate-200";
    const norm = normalizeDepartmentName(dept);
    switch (norm) {
      case "Almacén y Suministros":
        return "bg-emerald-50 text-emerald-800 border-emerald-200";
      case "Administración":
        return "bg-purple-50 text-purple-700 border-purple-200";
      case "Odontología":
        return "bg-teal-50 text-teal-700 border-teal-200";
      case "Laboratorio":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "Quirófano":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "Urgencias":
        return "bg-amber-50 text-amber-700 border-amber-200";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  const formatMessageTime = (timestampMs: number) => {
    if (!timestampMs) return "";
    const date = new Date(timestampMs);
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${minutes} ${ampm}`;
  };

  const totalBadgeCount = unreadCount + pendingVerificationCountForMyDept;

  return (
    <>
      {/* BOTÓN FLOTANTE DE CHAT INTERNO Y NOTIFICACIONES DE VERIFICACIÓN */}
      {!isOpen && (
        <div className="fixed bottom-28 right-6 z-50">
          <button
            id="btn-toggle-chat-lateral"
            onClick={handleToggleOpen}
            className="relative group flex items-center justify-center w-14 h-14 rounded-full bg-teal-600 hover:bg-teal-700 text-white shadow-xl transition-all duration-300 transform hover:scale-105 active:scale-95 cursor-pointer border border-teal-500/30"
            title="Chat Interno por Departamentos y Solicitudes de Verificación"
          >
            <MessageSquare className="w-6 h-6 text-white group-hover:animate-bounce" />
            {totalBadgeCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white font-extrabold text-[10px] min-w-6 h-6 px-1 rounded-full border-2 border-white flex items-center justify-center shadow-md animate-pulse">
                {totalBadgeCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* PANEL LATERAL DEL CHAT INTERNO ORGANIZADO POR DEPARTAMENTOS */}
      {isOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300">
          <div className="flex-1" onClick={handleToggleOpen} />

          <div className="w-full max-w-[460px] h-full bg-white shadow-2xl flex flex-col relative animate-slide-in-right border-l border-slate-200">
            {/* Cabecera del Chat */}
            <div className="px-4 py-3.5 bg-gradient-to-r from-teal-800 to-teal-900 text-white space-y-2.5 shadow-sm shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1.5 bg-white/15 rounded-xl shrink-0">
                    <MessageSquare className="w-5 h-5 text-teal-200" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-extrabold text-sm tracking-wide uppercase truncate">
                      Chat Interno por Departamentos
                    </h3>
                    <p className="text-[10px] text-teal-100 font-semibold opacity-95 flex items-center gap-1.5 truncate">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Tu Departamento: <strong>{userDept}</strong>
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleToggleOpen}
                  className="p-1.5 hover:bg-white/10 rounded-lg transition active:scale-95 cursor-pointer text-teal-100 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Menú Selector de Departamento para Comunicarse */}
              <div className="bg-black/20 rounded-xl p-2 border border-white/15 space-y-1">
                <label className="text-[9px] font-black uppercase tracking-wider text-teal-200 flex items-center gap-1">
                  <Building2 className="w-3 h-3" />
                  <span>Seleccionar Departamento con el que desea comunicarse:</span>
                </label>
                <select
                  value={selectedTargetDept}
                  onChange={(e) => {
                    setSelectedTargetDept(e.target.value);
                    playSound("click");
                  }}
                  className="w-full bg-white text-slate-900 rounded-lg px-2.5 py-1.5 text-xs font-extrabold outline-none focus:ring-2 focus:ring-teal-300 cursor-pointer"
                >
                  <option value="MI_DEPARTAMENTO">
                    🏢 Mi Departamento ({userDept}) — Bandeja Departamental
                  </option>
                  {availableDepartments.map((deptName) => (
                    <option key={deptName} value={deptName}>
                      📨 Departamento: {deptName}
                      {isSameDepartment(deptName, "Almacén y Suministros")
                        ? " (Validación y Stock)"
                        : ""}
                    </option>
                  ))}
                  <option value="CANAL_GENERAL">
                    🌐 Canal General (Todos los Departamentos)
                  </option>
                </select>
              </div>

              {/* Pestañas: Conversación vs. Solicitudes de Verificación */}
              <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setActiveViewTab("chat");
                    playSound("click");
                  }}
                  className={`py-1.5 px-3 rounded-xl text-[11px] font-extrabold uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    activeViewTab === "chat"
                      ? "bg-white text-teal-900 shadow-xs"
                      : "bg-white/10 text-teal-100 hover:bg-white/20"
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Conversación</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveViewTab("verificaciones");
                    playSound("click");
                  }}
                  className={`py-1.5 px-3 rounded-xl text-[11px] font-extrabold uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-1.5 ${
                    activeViewTab === "verificaciones"
                      ? "bg-white text-teal-900 shadow-xs"
                      : "bg-white/10 text-teal-100 hover:bg-white/20"
                  }`}
                >
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  <span>Verificaciones</span>
                  {pendingVerificationCountForMyDept > 0 && (
                    <span className="bg-amber-400 text-slate-950 font-black text-[10px] px-1.5 py-0.2 rounded-full">
                      {pendingVerificationCountForMyDept}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* FORMULARIO PRE-REDACTADO DE SOLICITUD DE VERIFICACIÓN (Desde botón «Validar» en Suministros) */}
            {draftProductValidation && (
              <form
                onSubmit={handleSendDraftValidationRequest}
                className="bg-amber-50/90 border-b-2 border-amber-300 p-3.5 space-y-2.5 shrink-0 anim-pop-in"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider bg-amber-300/80 text-amber-950 px-2 py-0.5 rounded-md flex items-center gap-1">
                    <ClipboardCheck className="w-3.5 h-3.5" />
                    Nueva Solicitud de verificación física
                  </span>
                  <button
                    type="button"
                    onClick={() => setDraftProductValidation(null)}
                    className="text-slate-500 hover:text-slate-800 p-1 rounded-lg cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="bg-white rounded-xl p-2.5 border border-amber-200 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-extrabold text-slate-900 truncate">
                      {draftProductValidation.producto.nombre}
                    </p>
                    <span className="text-[10px] font-mono font-bold text-teal-800">
                      Código: {draftProductValidation.producto.codigo}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[10px] font-bold text-slate-500 block">
                      Stock Reg.
                    </span>
                    <span className="font-black text-slate-900 text-xs tabular-nums">
                      {draftProductValidation.producto.lotes.reduce(
                        (a, l) => a + Number(l.cantidad || 0),
                        0
                      )}{" "}
                      und.
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                    Departamento Destinatario (Por defecto: Almacén y Suministros)
                  </label>
                  <select
                    value={draftProductValidation.departamentoDestino}
                    onChange={(e) =>
                      setDraftProductValidation((prev) =>
                        prev ? { ...prev, departamentoDestino: e.target.value } : null
                      )
                    }
                    className="w-full rounded-xl border border-amber-300 bg-white px-2.5 py-2 text-xs font-extrabold text-slate-900 outline-none"
                  >
                    {availableDepartments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-extrabold uppercase text-slate-700 mb-1">
                    Solicitud Redactada
                  </label>
                  <textarea
                    rows={3}
                    value={draftProductValidation.mensaje}
                    onChange={(e) =>
                      setDraftProductValidation((prev) =>
                        prev ? { ...prev, mensaje: e.target.value } : null
                      )
                    }
                    className="w-full rounded-xl border border-amber-300 bg-white px-2.5 py-2 text-xs font-semibold text-slate-800 outline-none leading-relaxed"
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDraftProductValidation(null)}
                    className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-[11px] font-bold text-slate-700 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={sendingValidationDraft}
                    className="px-4 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-extrabold uppercase tracking-wider shadow-xs cursor-pointer flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>
                      {sendingValidationDraft
                        ? "Enviando..."
                        : "Enviar Solicitud de Verificación"}
                    </span>
                  </button>
                </div>
              </form>
            )}

            {/* VISTA 1: CONVERSACIÓN DEL DEPARTAMENTO */}
            {activeViewTab === "chat" && (
              <>
                {/* Banner de solicitudes pendientes para el departamento */}
                {pendingVerificationCountForMyDept > 0 && (
                  <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between gap-2 shrink-0">
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-950">
                      <Bell className="w-4 h-4 text-amber-600 animate-bounce shrink-0" />
                      <span>
                        Tienes{" "}
                        <strong>{pendingVerificationCountForMyDept}</strong>{" "}
                        {pendingVerificationCountForMyDept === 1
                          ? "Solicitud de verificación pendiente"
                          : "Solicitudes de verificación pendientes"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveViewTab("verificaciones")}
                      className="text-[10px] font-extrabold uppercase bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-1 rounded-lg transition cursor-pointer shrink-0"
                    >
                      Ver Tareas
                    </button>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/50">
                  {filteredMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                        <MessageSquare className="w-6 h-6" />
                      </div>
                      <h4 className="text-xs font-bold text-slate-700">
                        Sin mensajes en este canal departamental
                      </h4>
                      <p className="text-[11px] text-slate-400 max-w-[240px]">
                        Escribe un mensaje o utiliza el botón «Validar» en cualquier producto de Suministros para enviar una solicitud de verificación.
                      </p>
                    </div>
                  ) : (
                    <>
                      {hasMore && (
                        <div className="flex justify-center pb-2">
                          <button
                            onClick={handleLoadMore}
                            className="text-[10px] font-extrabold uppercase tracking-wider text-teal-700 bg-teal-50/80 hover:bg-teal-100 border border-teal-200/60 px-3.5 py-1.5 rounded-full shadow-2xs transition flex items-center gap-1.5 cursor-pointer"
                          >
                            <Clock className="w-3.5 h-3.5 text-teal-600" />
                            Cargar anteriores
                          </button>
                        </div>
                      )}

                      {filteredMessages.map((msg, index) => {
                        const isOwn = msg.usuarioId === currentUser.id;
                        const isSys = msg.esSistema;
                        const linkedSolicitud = msg.solicitudVerificacionId
                          ? solicitudesVerificacion.find(
                              (s) => s.id === msg.solicitudVerificacionId
                            )
                          : undefined;

                        const prevMsg = index > 0 ? filteredMessages[index - 1] : null;
                        const showDateSeparator =
                          !prevMsg ||
                          (msg.timestamp &&
                            prevMsg.timestamp &&
                            new Date(msg.timestamp).toDateString() !==
                              new Date(prevMsg.timestamp).toDateString());

                        return (
                          <div key={msg.id || index} className="space-y-1.5">
                            {showDateSeparator && msg.timestamp && (
                              <div className="flex justify-center my-3">
                                <span className="text-[9px] font-bold text-slate-400 bg-slate-200/60 px-2.5 py-1 rounded-full uppercase tracking-wider">
                                  {new Date(msg.timestamp).toLocaleDateString("es-DO", {
                                    weekday: "short",
                                    day: "numeric",
                                    month: "short"
                                  })}
                                </span>
                              </div>
                            )}

                            {isSys ? (
                              <div className="bg-slate-100/90 border border-slate-200 rounded-xl p-3 shadow-2xs text-[11px] text-slate-700 space-y-1 max-w-[92%] mx-auto">
                                <div className="flex items-center justify-between border-b border-slate-200/50 pb-1 mb-1">
                                  <span className="font-extrabold text-[9px] text-slate-500 uppercase tracking-wider bg-white border border-slate-200 px-1.5 py-0.5 rounded-md">
                                    🤖 Evento del Sistema
                                  </span>
                                  <span className="text-[9px] text-slate-400 font-medium">
                                    {formatMessageTime(msg.timestamp)}
                                  </span>
                                </div>
                                <p className="leading-relaxed text-slate-800 break-words font-medium whitespace-pre-wrap">
                                  {msg.texto}
                                </p>
                              </div>
                            ) : (
                              <div
                                className={`flex flex-col ${
                                  isOwn ? "items-end" : "items-start"
                                }`}
                              >
                                <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] font-bold text-slate-500 flex-wrap">
                                  <span>{msg.usuarioNombre}</span>
                                  <span
                                    className={`px-1.5 py-0.5 text-[9px] rounded-full border font-black uppercase tracking-wider ${getDeptColor(
                                      msg.departamento
                                    )}`}
                                  >
                                    {msg.departamento}
                                  </span>
                                  {msg.departamentoDestino && (
                                    <span className="text-[9px] font-extrabold text-teal-700">
                                      → {msg.departamentoDestino}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 max-w-[90%]">
                                  {!isOwn && isAnyer && msg.id && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteMessage(msg.id);
                                      }}
                                      className="text-slate-400 hover:text-rose-600 transition shrink-0 p-1 cursor-pointer"
                                      title="Eliminar mensaje"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}

                                  <div
                                    className={`rounded-2xl px-3.5 py-2.5 text-xs shadow-2xs relative transition-all ${
                                      msg.tipoMensaje === "SOLICITUD_VERIFICACION"
                                        ? "bg-amber-50 border-2 border-amber-300 text-slate-900"
                                        : isOwn
                                        ? "bg-teal-700 text-white rounded-tr-none"
                                        : "bg-white border border-slate-200 text-slate-800 rounded-tl-none"
                                    }`}
                                  >
                                    {msg.tipoMensaje === "SOLICITUD_VERIFICACION" && (
                                      <div className="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-amber-200">
                                        <span className="text-[9px] font-black uppercase tracking-wider bg-amber-300 text-amber-950 px-2 py-0.5 rounded-md flex items-center gap-1">
                                          <ClipboardCheck className="w-3 h-3" />
                                          Solicitud de verificación
                                        </span>
                                        {linkedSolicitud && (
                                          <span
                                            className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-md ${
                                              linkedSolicitud.estado === "PENDIENTE"
                                                ? "bg-amber-200 text-amber-950"
                                                : linkedSolicitud.estado ===
                                                  "CONFIRMADA_COINCIDE"
                                                ? "bg-emerald-100 text-emerald-800"
                                                : "bg-rose-100 text-rose-800"
                                            }`}
                                          >
                                            {linkedSolicitud.estado === "PENDIENTE"
                                              ? "Pendiente"
                                              : linkedSolicitud.estado ===
                                                "CONFIRMADA_COINCIDE"
                                              ? "Validada"
                                              : "Con Diferencia"}
                                          </span>
                                        )}
                                      </div>
                                    )}

                                    <p className="leading-relaxed break-words whitespace-pre-wrap font-medium">
                                      {msg.texto}
                                    </p>

                                    {linkedSolicitud && (
                                      <div className="mt-2.5 pt-2 border-t border-amber-200/80 flex items-center justify-between gap-2">
                                        <span className="text-[10px] font-mono font-bold text-slate-700">
                                          Cód: {linkedSolicitud.productoCodigo} • Stock:{" "}
                                          {linkedSolicitud.existenciaSistemaAlSolicitar}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            playSound("open");
                                            setSelectedSolicitudModal(linkedSolicitud);
                                          }}
                                          className="px-2.5 py-1 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-[10px] font-extrabold uppercase tracking-wider transition cursor-pointer shrink-0"
                                        >
                                          {linkedSolicitud.estado === "PENDIENTE"
                                            ? "Abrir y Confirmar"
                                            : "Ver Resultado"}
                                        </button>
                                      </div>
                                    )}

                                    <div
                                      className={`flex items-center justify-end gap-1.5 mt-1 text-[9px] ${
                                        msg.tipoMensaje === "SOLICITUD_VERIFICACION"
                                          ? "text-amber-800"
                                          : isOwn
                                          ? "text-teal-200"
                                          : "text-slate-400"
                                      } font-medium`}
                                    >
                                      <span>{formatMessageTime(msg.timestamp)}</span>
                                    </div>
                                  </div>

                                  {isOwn && isAnyer && msg.id && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteMessage(msg.id);
                                      }}
                                      className="text-slate-400 hover:text-rose-600 transition shrink-0 p-1 cursor-pointer"
                                      title="Eliminar mensaje"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Plantillas Rápidas */}
                <div className="px-4 py-2 bg-slate-100 border-t border-slate-200/80 flex items-center justify-between shrink-0">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                    ⚡ Mensajes Rápidos ({effectiveRecipientDept || "General"})
                  </span>
                  <button
                    onClick={() => {
                      playSound("click");
                      setShowTemplates(!showTemplates);
                    }}
                    className="text-[10px] text-teal-700 hover:text-teal-900 font-bold underline transition cursor-pointer"
                  >
                    {showTemplates ? "Ocultar" : "Mostrar"}
                  </button>
                </div>

                {showTemplates && (
                  <div className="bg-slate-50 border-t border-slate-200 p-3 grid grid-cols-1 gap-2 max-h-[140px] overflow-y-auto shrink-0">
                    {TEMPLATED_MESSAGES.map((t, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          handleSendMessage(t.text);
                          setShowTemplates(false);
                        }}
                        className="flex flex-col items-start p-2 rounded-xl bg-white hover:bg-teal-50 hover:border-teal-300 border border-slate-200 text-left transition cursor-pointer group"
                      >
                        <span className="text-[11px] font-bold text-slate-800 group-hover:text-teal-700">
                          {t.text}
                        </span>
                        <span className="text-[9px] text-slate-400 group-hover:text-teal-600">
                          {t.desc}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Barra de entrada de mensajes */}
                <div className="p-3.5 bg-white border-t border-slate-200 flex items-center gap-2 shrink-0">
                  <input
                    type="text"
                    placeholder={
                      effectiveRecipientDept
                        ? `Mensaje para ${effectiveRecipientDept}...`
                        : "Mensaje en Canal General..."
                    }
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={handleKeyPress}
                    maxLength={400}
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500 transition-all"
                    disabled={sending}
                  />
                  <button
                    onClick={() => handleSendMessage()}
                    disabled={sending || !inputText.trim()}
                    className="p-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400 text-white transition-all shadow-sm active:scale-95 flex items-center justify-center shrink-0 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}

            {/* VISTA 2: BANDEJA DE TAREAS / SOLICITUDES DE VERIFICACIÓN POR DEPARTAMENTO */}
            {activeViewTab === "verificaciones" && (
              <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
                <div className="p-3 bg-white border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-700">
                    Tareas de Verificación ({departmentSolicitudes.length})
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setVerificacionFilter("PENDIENTES")}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase transition cursor-pointer ${
                        verificacionFilter === "PENDIENTES"
                          ? "bg-amber-500 text-slate-950"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      Pendientes
                    </button>
                    <button
                      type="button"
                      onClick={() => setVerificacionFilter("TODAS")}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold uppercase transition cursor-pointer ${
                        verificacionFilter === "TODAS"
                          ? "bg-teal-700 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      Todas
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
                  {departmentSolicitudes.filter((s) =>
                    verificacionFilter === "PENDIENTES" ? s.estado === "PENDIENTE" : true
                  ).length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2">
                      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                        <ClipboardCheck className="w-6 h-6" />
                      </div>
                      <h4 className="text-xs font-bold text-slate-700">
                        No hay solicitudes de verificación{" "}
                        {verificacionFilter === "PENDIENTES" ? "pendientes" : ""}
                      </h4>
                      <p className="text-[11px] text-slate-400 max-w-[230px]">
                        Usa el botón «Validar» en cualquier producto de Suministros para enviar una Solicitud de verificación a un departamento.
                      </p>
                    </div>
                  ) : (
                    departmentSolicitudes
                      .filter((s) =>
                        verificacionFilter === "PENDIENTES" ? s.estado === "PENDIENTE" : true
                      )
                      .map((sol) => (
                        <div
                          key={sol.id}
                          onClick={() => {
                            playSound("open");
                            setSelectedSolicitudModal(sol);
                          }}
                          className="bg-white rounded-2xl border border-slate-200 hover:border-teal-400 p-3.5 shadow-2xs space-y-2.5 cursor-pointer transition"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-mono font-black uppercase bg-amber-100 text-amber-950 border border-amber-300 px-2 py-0.5 rounded-md">
                              {sol.tipo} • {sol.codigoSolicitud}
                            </span>
                            <span
                              className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md ${
                                sol.estado === "PENDIENTE"
                                  ? "bg-amber-50 text-amber-800 border border-amber-200"
                                  : sol.estado === "CONFIRMADA_COINCIDE"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-rose-50 text-rose-700 border border-rose-200"
                              }`}
                            >
                              {sol.estado === "PENDIENTE"
                                ? "Pendiente"
                                : sol.estado === "CONFIRMADA_COINCIDE"
                                ? "Validada"
                                : "Con Diferencia"}
                            </span>
                          </div>

                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h5 className="text-xs font-extrabold text-slate-900 truncate">
                                {sol.productoNombre}
                              </h5>
                              <p className="text-[10px] font-mono font-bold text-teal-700 mt-0.5">
                                Código: {sol.productoCodigo} • {sol.unidadMedida}
                              </p>
                            </div>
                            <div className="text-right shrink-0 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1">
                              <span className="text-[9px] font-bold text-slate-500 block uppercase">
                                Existencias
                              </span>
                              <span className="text-xs font-black text-slate-900 tabular-nums">
                                Sis: {sol.existenciaSistemaAlSolicitar} | Fís:{" "}
                                {sol.existenciaFisicaAlSolicitar}
                              </span>
                            </div>
                          </div>

                          <p className="text-[11px] text-slate-600 line-clamp-2 font-medium bg-slate-50 p-2 rounded-xl border border-slate-100">
                            «{sol.mensajeSolicitud}»
                          </p>

                          <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 pt-1 border-t border-slate-100">
                            <span>
                              {sol.departamentoOrigen} →{" "}
                              <strong className="text-teal-800">
                                {sol.departamentoDestino}
                              </strong>
                            </span>
                            <span className="text-teal-700 font-extrabold">
                              {sol.estado === "PENDIENTE"
                                ? "Confirmar validación →"
                                : "Ver Detalle →"}
                            </span>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL DETALLE Y CONFIRMACIÓN DE VALIDACIÓN FÍSICA */}
      <ModalVerificacionProducto
        solicitud={selectedSolicitudModal}
        currentUser={currentUser}
        liveProduct={
          selectedSolicitudModal
            ? products.find((p) => p.codigo === selectedSolicitudModal.productoCodigo) ||
              null
            : null
        }
        onClose={() => setSelectedSolicitudModal(null)}
        showToast={showToast}
      />

      {/* Modal Confirmación Eliminar Mensaje */}
      {msgToDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-xs"
            onClick={() => setMsgToDelete(null)}
          />
          <div className="relative bg-white rounded-3xl border border-slate-200 shadow-xl max-w-sm w-full overflow-hidden anim-pop-in p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="p-2 bg-rose-50 rounded-xl">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="font-black text-slate-900 text-base">¿Eliminar mensaje?</h3>
            </div>
            <p className="text-xs font-semibold text-slate-500 leading-relaxed">
              ¿Estás seguro de que deseas eliminar este mensaje de forma permanente? Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setMsgToDelete(null)}
                className="flex-1 rounded-xl border border-slate-200 text-slate-600 py-2.5 text-xs font-bold hover:bg-slate-50 transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteMessage}
                className="flex-1 rounded-xl bg-rose-600 hover:bg-rose-700 text-white py-2.5 text-xs font-bold shadow-sm transition cursor-pointer"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
