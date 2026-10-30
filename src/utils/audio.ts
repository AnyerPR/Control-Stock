let audioCtx: AudioContext | null = null;
let isMuted = false;

function initAudioContext() {
  try {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch {
    audioCtx = null;
  }
}

export function setMuteState(muted: boolean) {
  isMuted = muted;
}

export function playTone(freq = 440, duration = 0.08, type: OscillatorType = "sine") {
  if (isMuted) return;
  if (!audioCtx) initAudioContext();
  if (!audioCtx) return;

  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = 0.0001;

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  } catch (err) {
    console.warn("Error playing tone:", err);
  }
}

export function playSound(event: "click" | "open" | "close" | "positive" | "negative" | "action" | "notify") {
  switch (event) {
    case "click":
      playAudioFile("CLICK.mp3");
      break;
    case "open":
      playTone(660, 0.12, "sine");
      break;
    case "close":
      playTone(220, 0.14, "sine");
      break;
    case "positive":
      playTone(880, 0.14, "sine");
      break;
    case "negative":
      playTone(220, 0.18, "sawtooth");
      break;
    case "action":
      playTone(520, 0.12, "triangle");
      break;
    case "notify":
      playAudioFile("NOTIFICACION.mp3");
      break;
  }
}

function playAudioFile(filename: string) {
  if (isMuted) return;

  const audio = new Audio(`${import.meta.env.BASE_URL}${filename}`);
  audio.play().catch((error: unknown) => {
    console.warn(`Error playing ${filename}:`, error);
  });
}
