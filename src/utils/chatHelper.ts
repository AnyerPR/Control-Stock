import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

export async function logSystemEvent(texto: string) {
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
