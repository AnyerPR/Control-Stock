import React, { useState, useEffect, useRef } from "react";
import { collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, doc, deleteDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Usuario } from "../types";
import { playSound } from "../utils/audio";
import { 
  MessageSquare, 
  Send, 
  X, 
  Sparkles, 
  AlertCircle, 
  Bell, 
  CheckCircle, 
  Layers, 
  AlertOctagon,
  Clock,
  Trash2
} from "lucide-react";

interface ChatLateralProps {
  currentUser: Usuario;
}

export interface ChatMensaje {
  id: string;
  texto: string;
  usuarioNombre: string;
  usuarioId: string;
  departamento: string;
  rol: string;
  timestamp: any; // Can be number or Firestore serverTimestamp
  esSistema?: boolean;
}

const TEMPLATED_MESSAGES = [
  { text: "🚨 Stock Crítico", desc: "Reportar escasez de insumo urgente" },
  { text: "📦 Lote Recibido", desc: "Confirmar entrada de nuevo lote" },
  { text: "🩺 Suministro Listo", desc: "Notificar material listo para retirar" },
  { text: "💬 Consulta Solicitud", desc: "Preguntar sobre estado de orden" },
  { text: "🔄 Ajuste de Físico", desc: "Notificar discrepancia de inventario" }
];

export default function ChatLateral({ currentUser }: ChatLateralProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMensaje[]>([]);
  const [inputText, setInputText] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [sending, setSending] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [limitAmount, setLimitAmount] = useState(10);
  const [hasMore, setHasMore] = useState(false);
  const [msgToDelete, setMsgToDelete] = useState<string | null>(null);
  
  const lastOpenedRef = useRef<number>(Date.now());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const firstLoadRef = useRef(true);
  const isLoadingMoreRef = useRef(false);

  const isAnyer = 
    currentUser?.usuario?.trim().toLowerCase() === "anyer" || 
    currentUser?.nombre?.trim().toLowerCase() === "anyer";

  const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

  const handleDeleteMessage = (msgId: string) => {
    if (!isAnyer) return;
    setMsgToDelete(msgId);
  };

  const confirmDeleteMessage = async () => {
    if (!msgToDelete) return;
    if (isLocalFileMode) {
      let stored = localStorage.getItem("offline_chat_mensajes");
      let list: ChatMensaje[] = [];
      if (stored) {
        try {
          list = JSON.parse(stored);
        } catch (e) {}
      }
      list = list.filter((m) => m.id !== msgToDelete);
      localStorage.setItem("offline_chat_mensajes", JSON.stringify(list));
      window.dispatchEvent(new Event("offline_chat_update"));
      playSound("negative");
      setMsgToDelete(null);
      return;
    }

    try {
      await deleteDoc(doc(db, "chat_mensajes", msgToDelete));
      playSound("negative");
    } catch (err) {
      console.error("Error deleting message:", err);
    } finally {
      setMsgToDelete(null);
    }
  };

  // Load messages in real-time
  useEffect(() => {
    if (isLocalFileMode) {
      const loadOfflineMessages = () => {
        let stored = localStorage.getItem("offline_chat_mensajes");
        let list: ChatMensaje[] = [];
        if (stored) {
          try {
            list = JSON.parse(stored);
          } catch (e) {
            console.error(e);
          }
        }
        if (list.length === 0) {
          list = [
            {
              id: "welcome-1",
              texto: "¡Bienvenido al Panel de Comunicación! Estás en modo sin conexión (Local file).",
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

    const messagesCol = collection(db, "chat_mensajes");
    const q = query(messagesCol, orderBy("timestamp", "desc"), limit(limitAmount));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: ChatMensaje[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          texto: data.texto || "",
          usuarioNombre: data.usuarioNombre || "Usuario",
          usuarioId: data.usuarioId || "",
          departamento: data.departamento || "S/D",
          rol: data.rol || "Operador",
          timestamp: data.timestamp ? (data.timestamp.seconds ? data.timestamp.seconds * 1000 : data.timestamp) : Date.now(),
          esSistema: !!data.esSistema
        });
      });

      // The query gets the latest N messages (descending order).
      // We reverse them to show older messages at the top and newer at the bottom.
      const chronologicalList = [...list].reverse();
      setMessages(chronologicalList);
      setHasMore(list.length >= limitAmount);

      // Handle sound and unread counts for new incoming messages
      if (!firstLoadRef.current && list.length > 0) {
        // list[0] is the newest message since the Firestore query is descending
        const lastMsg = list[0];
        
        // Only trigger if message is very recent (within 10s) and not from current user
        const isRecent = Date.now() - lastMsg.timestamp < 10000;
        if (isRecent && lastMsg.usuarioId !== currentUser.id) {
          playSound("notify");
          if (!isOpen) {
            setUnreadCount((prev) => prev + 1);
          }
        }
      } else {
        firstLoadRef.current = false;
      }
    }, (error) => {
      console.error("Error listening to chat messages:", error);
    });

    return () => unsubscribe();
  }, [currentUser.id, isOpen, limitAmount, isLocalFileMode]);

  // Handle auto-scroll to bottom
  const scrollToBottom = () => {
    if (isLoadingMoreRef.current) {
      isLoadingMoreRef.current = false;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const handleLoadMore = () => {
    isLoadingMoreRef.current = true;
    playSound("click");
    setLimitAmount((prev) => prev + 10);
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
        departamento: currentUser.departamento || "Administración",
        rol: currentUser.rol,
        timestamp: Date.now(),
        esSistema: false
      };
      
      let stored = localStorage.getItem("offline_chat_mensajes");
      let list: ChatMensaje[] = [];
      if (stored) {
        try {
          list = JSON.parse(stored);
        } catch (e) {}
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
      await addDoc(collection(db, "chat_mensajes"), {
        texto: text,
        usuarioNombre: currentUser.nombre,
        usuarioId: currentUser.id,
        departamento: currentUser.departamento || "Administración",
        rol: currentUser.rol,
        timestamp: serverTimestamp(),
        esSistema: false
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

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSendMessage();
    }
  };

  const getDeptColor = (dept: string, esSistema?: boolean) => {
    if (esSistema) return "bg-slate-100 text-slate-700 border-slate-200";
    switch (dept) {
      case "Administración":
        return "bg-purple-50 text-purple-700 border-purple-100";
      case "Odontología":
        return "bg-teal-50 text-teal-700 border-teal-100";
      case "Laboratorio":
        return "bg-blue-50 text-blue-700 border-blue-100";
      case "Quirófano":
        return "bg-rose-50 text-rose-700 border-rose-100";
      case "Urgencias":
        return "bg-amber-50 text-amber-700 border-amber-100";
      case "Pediatría":
        return "bg-indigo-50 text-indigo-700 border-indigo-100";
      case "Gineco-Obstetricia":
        return "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100";
      default:
        return "bg-slate-50 text-slate-700 border-slate-100";
    }
  };

  const formatMessageTime = (timestampMs: number) => {
    if (!timestampMs) return "";
    const date = new Date(timestampMs);
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    return `${hours}:${minutes} ${ampm}`;
  };

  return (
    <>
      {/* FLOATING ACTION TOGGLE BUTTON */}
      {!isOpen && (
        <div className="fixed bottom-28 right-6 z-50">
          <button
            id="btn-toggle-chat-lateral"
            onClick={handleToggleOpen}
            className="relative group flex items-center justify-center w-14 h-14 rounded-full bg-teal-600 hover:bg-teal-700 text-white shadow-xl transition-all duration-300 transform hover:scale-105 active:scale-95 cursor-pointer border border-teal-500/30"
            title="Chat de Departamentos"
          >
            <MessageSquare className="w-6 h-6 text-white group-hover:animate-bounce" />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white font-extrabold text-[10px] w-6 h-6 rounded-full border-2 border-white flex items-center justify-center shadow-md animate-pulse">
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* LATERAL CHAT SIDEBAR DRAWER */}
      {isOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300">
          {/* Backdrop click closer */}
          <div className="flex-1" onClick={handleToggleOpen} />

          <div className="w-full max-w-[420px] h-full bg-white shadow-2xl flex flex-col relative animate-slide-in-right border-l border-slate-200">
            {/* Header */}
            <div className="px-5 py-4 bg-gradient-to-r from-teal-700 to-teal-800 text-white flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 bg-white/10 rounded-lg">
                  <MessageSquare className="w-5 h-5 text-teal-200" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm tracking-wide uppercase">Panel de Comunicación</h3>
                  <p className="text-[10px] text-teal-100 font-semibold opacity-90 flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    Salón General • {currentUser.departamento}
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

            {/* Event Log / Info Ribbon */}
            <div className="bg-teal-50 border-b border-teal-100 px-4 py-2.5 flex items-start gap-2 text-xs text-teal-800">
              <Sparkles className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
              <p className="font-medium text-[11px] leading-relaxed">
                ¡Interactúa con otros departamentos y mantente al día! El sistema reportará eventos de stock automáticamente.
              </p>
            </div>

            {/* Message Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-50/50">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2">
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                    <MessageSquare className="w-6 h-6" />
                  </div>
                  <h4 className="text-xs font-bold text-slate-700">Sin mensajes de comunicación</h4>
                  <p className="text-[11px] text-slate-400 max-w-[200px]">
                    Escribe tu primer mensaje o selecciona una plantilla para iniciar.
                  </p>
                </div>
              ) : (
                <>
                  {hasMore && (
                    <div className="flex justify-center pb-2">
                      <button
                        onClick={handleLoadMore}
                        className="text-[10px] font-extrabold uppercase tracking-wider text-teal-700 bg-teal-50/80 hover:bg-teal-100 border border-teal-200/60 px-3.5 py-1.5 rounded-full shadow-2xs hover:shadow-xs transition duration-150 active:scale-95 flex items-center gap-1.5 cursor-pointer"
                      >
                        <Clock className="w-3.5 h-3.5 text-teal-600 animate-pulse" />
                        Cargar anteriores
                      </button>
                    </div>
                  )}
                  {messages.map((msg, index) => {
                    const isOwn = msg.usuarioId === currentUser.id;
                    const isSys = msg.esSistema;
                    
                    // Simple Date separator logic
                    const prevMsg = index > 0 ? messages[index - 1] : null;
                    const showDateSeparator = !prevMsg || (msg.timestamp && prevMsg.timestamp && 
                      new Date(msg.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString());

                    return (
                      <div key={msg.id || index} className="space-y-1.5">
                        {showDateSeparator && msg.timestamp && (
                          <div className="flex justify-center my-3.5">
                            <span className="text-[9px] font-bold text-slate-400 bg-slate-200/60 px-2.5 py-1 rounded-full uppercase tracking-wider">
                              {new Date(msg.timestamp).toLocaleDateString("es-DO", { weekday: "short", day: "numeric", month: "short" })}
                            </span>
                          </div>
                        )}

                        {isSys ? (
                          /* SYSTEM LOG MESSAGE */
                          <div className="bg-slate-100/90 border border-slate-200 rounded-xl p-3 shadow-2xs text-[11px] text-slate-700 space-y-1 max-w-[90%] mx-auto font-mono">
                            <div className="flex items-center justify-between border-b border-slate-200/50 pb-1 mb-1 font-sans">
                              <span className="font-extrabold text-[9px] text-slate-500 uppercase tracking-wider flex items-center gap-1 bg-white border border-slate-200 px-1.5 py-0.5 rounded-md">
                                🤖 Evento del Sistema
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] text-slate-400 flex items-center gap-0.5 font-medium">
                                  <Clock className="w-2.5 h-2.5" />
                                  {formatMessageTime(msg.timestamp)}
                                </span>
                                {isAnyer && msg.id && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteMessage(msg.id);
                                    }}
                                    className="text-slate-400 hover:text-rose-600 transition p-0.5 cursor-pointer"
                                    title="Eliminar evento de sistema"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="leading-relaxed text-slate-800 break-words font-sans font-medium whitespace-pre-wrap">{msg.texto}</p>
                          </div>
                        ) : (
                          /* CHAT BUBBLE MESSAGE */
                          <div className={`flex flex-col ${isOwn ? "items-end" : "items-start"}`}>
                            {/* Sender Info */}
                            {!isOwn && (
                              <div className="flex items-center gap-1.5 mb-1 px-1 text-[10px] font-bold text-slate-500">
                                <span>{msg.usuarioNombre}</span>
                                <span className={`px-1.5 py-0.5 text-[9px] rounded-full border font-black uppercase tracking-wider ${getDeptColor(msg.departamento)}`}>
                                  {msg.departamento}
                                </span>
                              </div>
                            )}

                            {/* Message bubble wrapper with delete button */}
                            <div className="flex items-center gap-2 max-w-[85%]">
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
                                className={`rounded-2xl px-4 py-2.5 text-xs shadow-2xs relative transition-all duration-150 ${
                                  isOwn
                                    ? "bg-teal-600 text-white rounded-tr-none"
                                    : "bg-white border border-slate-200 text-slate-800 rounded-tl-none"
                                }`}
                              >
                                {/* Message text */}
                                <p className="leading-relaxed break-words whitespace-pre-wrap font-medium">{msg.texto}</p>
                                
                                {/* Time & User Role */}
                                <div className={`flex items-center justify-end gap-1.5 mt-1 text-[9px] ${isOwn ? "text-teal-200" : "text-slate-400"} font-medium`}>
                                  {isOwn && <span className="text-[8px] bg-white/10 px-1 rounded-sm uppercase tracking-wider">{msg.departamento}</span>}
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

            {/* Quick Templates Drawer Toggle */}
            <div className="px-4 py-2 bg-slate-100 border-t border-slate-200/80 flex items-center justify-between">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider flex items-center gap-1">
                ⚡ Mensajes Rápidos
              </span>
              <button
                onClick={() => {
                  playSound("click");
                  setShowTemplates(!showTemplates);
                }}
                className="text-[10px] text-teal-700 hover:text-teal-900 font-bold underline transition"
              >
                {showTemplates ? "Ocultar" : "Mostrar"}
              </button>
            </div>

            {/* Quick Templates Grid */}
            {showTemplates && (
              <div className="bg-slate-50 border-t border-slate-200 p-3 grid grid-cols-1 gap-2 max-h-[140px] overflow-y-auto anim-card-in">
                {TEMPLATED_MESSAGES.map((t, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      handleSendMessage(t.text);
                      setShowTemplates(false);
                    }}
                    className="flex flex-col items-start p-2 rounded-xl bg-white hover:bg-teal-50 hover:border-teal-300 border border-slate-200 text-left transition active:scale-98 cursor-pointer group"
                  >
                    <span className="text-[11px] font-bold text-slate-800 group-hover:text-teal-700">{t.text}</span>
                    <span className="text-[9px] text-slate-400 group-hover:text-teal-600">{t.desc}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Input Controls */}
            <div className="p-4 bg-white border-t border-slate-200 flex items-center gap-2">
              <input
                type="text"
                placeholder="Escribe un mensaje..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyPress}
                maxLength={300}
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                disabled={sending}
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={sending || !inputText.trim()}
                className="p-3 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-white transition-all shadow-md active:scale-95 flex items-center justify-center shrink-0 cursor-pointer"
              >
                <Send className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Confirmation Modal for Deleting Messages */}
      {msgToDelete !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setMsgToDelete(null)}></div>
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
