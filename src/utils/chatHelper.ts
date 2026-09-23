import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

export async function logSystemEvent(texto: string) {
  const isLocalFileMode = typeof window !== "undefined" && window.location.protocol === "file:";

  if (isLocalFileMode) {
    try {
      const newMsg = {
        id: `msg-system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        texto,
        usuarioNombre: "Sistema",
        usuarioId: "system-bot",
        departamento: "Sistema 🤖",
        rol: "Sistema",
        timestamp: Date.now(),
        esSistema: true
      };
      
      let stored = localStorage.getItem("offline_chat_mensajes");
      let list = [];
      if (stored) {
        try {
          list = JSON.parse(stored);
        } catch (e) {}
      }
      list.push(newMsg);
      localStorage.setItem("offline_chat_mensajes", JSON.stringify(list));
      window.dispatchEvent(new Event("offline_chat_update"));
    } catch (e) {
      console.error("Error logging system event in offline mode:", e);
    }
    return;
  }

  try {
    await addDoc(collection(db, "chat_mensajes"), {
      texto,
      usuarioNombre: "Sistema",
      usuarioId: "system-bot",
      departamento: "Sistema 🤖",
      rol: "Sistema",
      timestamp: serverTimestamp(),
      esSistema: true
    });
  } catch (err) {
    console.error("Error logging system event to chat:", err);
  }
}
