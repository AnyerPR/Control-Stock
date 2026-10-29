import React, { useState, useRef, useEffect } from "react";
import {
  Camera,
  Upload,
  X,
  Check,
  RefreshCw,
  LoaderCircle,
  AlertCircle,
  Image as ImageIcon,
  SwitchCamera,
  Trash2
} from "lucide-react";
import { playSound } from "../utils/audio";
import ImageLightbox from "./ImageLightbox";

interface PhotoCaptureFieldProps {
  currentImageUrl?: string;
  onConfirmImage: (dataUrl: string) => Promise<void> | void;
  onDeleteImage?: () => Promise<void> | void;
  onPendingChange?: (pendingDataUrl: string | null) => void;
  isSaving?: boolean;
  label?: string;
  helperText?: string;
  placeholderText?: string;
  heightClass?: string;
  objectFit?: "cover" | "contain";
  preserveSvg?: boolean;
  maxDimension?: number;
  quality?: number;
  compact?: boolean;
}

export function compressImageElement(
  source: HTMLImageElement | HTMLVideoElement,
  sourceWidth: number,
  sourceHeight: number,
  maxDimension = 420,
  quality = 0.78,
  preserveTransparency = false
): string {
  let width = sourceWidth;
  let height = sourceHeight;

  if (width > maxDimension || height > maxDimension) {
    if (width > height) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("No se pudo inicializar el procesador de imagen.");
  }

  if (!preserveTransparency) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  if (preserveTransparency) {
    return canvas.toDataURL("image/png");
  }

  let dataUrl = canvas.toDataURL("image/webp", quality);
  if (!dataUrl.startsWith("data:image/webp")) {
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  return dataUrl;
}

export function processImageFile(
  file: File,
  maxDimension = 420,
  quality = 0.78,
  preserveSvg = false
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (preserveSvg && file.type === "image/svg+xml") {
      const svgReader = new FileReader();
      svgReader.onload = () => resolve(svgReader.result as string);
      svgReader.onerror = () => reject(new Error("No se pudo leer el archivo SVG."));
      svgReader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        try {
          const isPngOrWebp =
            preserveSvg && (file.type === "image/png" || file.type === "image/webp");
          const result = compressImageElement(
            img,
            img.width,
            img.height,
            maxDimension,
            quality,
            isPngOrWebp
          );
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error("El archivo seleccionado no es una imagen válida."));
      img.src = event.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Error al leer el archivo del dispositivo."));
    reader.readAsDataURL(file);
  });
}

export default function PhotoCaptureField({
  currentImageUrl,
  onConfirmImage,
  onDeleteImage,
  onPendingChange,
  isSaving = false,
  label,
  helperText,
  placeholderText = "Toma una fotografía al momento o selecciona una imagen desde tu dispositivo",
  heightClass = "h-52",
  objectFit = "cover",
  preserveSvg = false,
  maxDimension = 420,
  quality = 0.78,
  compact = false
}: PhotoCaptureFieldProps) {
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [processingFile, setProcessingFile] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live Camera Modal state
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");

  const deviceInputRef = useRef<HTMLInputElement>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const updatePending = (val: string | null) => {
    setPendingPreview(val);
    if (onPendingChange) {
      onPendingChange(val);
    }
  };

  // Reset pending preview when currentImageUrl changes externally
  useEffect(() => {
    updatePending(null);
    setErrorMsg(null);
  }, [currentImageUrl]);

  // Stop camera stream cleanly
  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, []);

  // Start camera stream only when requested by user
  const startCamera = async (requestedFacing: "environment" | "user") => {
    setCameraStarting(true);
    setCameraError(null);
    stopCameraStream();

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      setCameraStarting(false);
      setShowCameraModal(false);
      // Fallback directly to native mobile camera input
      nativeCameraInputRef.current?.click();
      return;
    }

    try {
      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: requestedFacing },
            width: { ideal: 1280 },
            height: { ideal: 960 }
          },
          audio: false
        });
      } catch {
        // Fallback to any available video camera (e.g. desktop webcam)
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
      }

      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraStarting(false);
    } catch (err: any) {
      console.warn("No se pudo iniciar la cámara web:", err);
      setCameraStarting(false);
      if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
        setCameraError(
          "El permiso de la cámara fue denegado o bloqueado por el navegador. Puedes autorizar la cámara en tu navegador o usar el botón 'Abrir Cámara del Teléfono'."
        );
      } else if (err?.name === "NotFoundError" || err?.name === "DevicesNotFoundError") {
        setCameraError("No se detectó ninguna cámara conectada en este dispositivo.");
      } else {
        setCameraError(
          "No se pudo acceder a la cámara en vivo. Puedes usar la cámara nativa del dispositivo o seleccionar un archivo."
        );
      }
    }
  };

  const handleOpenCameraClick = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setErrorMsg(null);
    playSound("open");
    setShowCameraModal(true);
    startCamera(facingMode);
  };

  const handleCloseCameraModal = () => {
    stopCameraStream();
    setShowCameraModal(false);
    setCameraError(null);
  };

  const handleSwitchCamera = () => {
    const nextFacing = facingMode === "environment" ? "user" : "environment";
    setFacingMode(nextFacing);
    playSound("click");
    startCamera(nextFacing);
  };

  const handleCaptureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError("La cámara aún se está enfocando. Intenta capturar nuevamente.");
      return;
    }

    try {
      const dataUrl = compressImageElement(
        video,
        video.videoWidth,
        video.videoHeight,
        maxDimension,
        quality,
        false
      );
      stopCameraStream();
      setShowCameraModal(false);
      updatePending(dataUrl);
      playSound("positive");
    } catch (err) {
      console.error(err);
      setCameraError("Error al capturar la fotografía.");
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setErrorMsg("Por favor selecciona un archivo de imagen válido (JPG, PNG, WebP).");
      playSound("negative");
      return;
    }

    setProcessingFile(true);
    setErrorMsg(null);

    try {
      const compressed = await processImageFile(file, maxDimension, quality, preserveSvg);
      stopCameraStream();
      setShowCameraModal(false);
      updatePending(compressed);
      playSound("open");
    } catch (err) {
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : "No se pudo procesar la fotografía.");
      playSound("negative");
    } finally {
      setProcessingFile(false);
    }
  };

  const handleConfirmPending = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pendingPreview || isSaving) return;

    const toSave = pendingPreview;
    await onConfirmImage(toSave);
    updatePending(null);
  };

  const handleDiscardPending = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    updatePending(null);
    setErrorMsg(null);
    playSound("click");
  };

  const handleDeleteCurrent = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onDeleteImage || isSaving) return;
    await onDeleteImage();
    updatePending(null);
  };

  const displayImage = pendingPreview || currentImageUrl;
  const isBusy = isSaving || processingFile;

  return (
    <div className="space-y-2.5">
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-[11px] font-extrabold text-slate-700 uppercase tracking-wider">
            <Camera className="w-3.5 h-3.5 text-teal-600" />
            <span>{label}</span>
          </label>
          {pendingPreview && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300">
              Vista previa • Confirma para guardar
            </span>
          )}
        </div>
      )}

      {/* Main Visual Container / Preview Area */}
      <div
        className={`relative w-full ${heightClass} rounded-2xl overflow-hidden bg-white border ${
          pendingPreview
            ? "border-2 border-amber-400 ring-2 ring-amber-400/20"
            : "border-slate-300 hover:border-teal-500"
        } flex items-center justify-center shadow-2xs transition`}
      >
        {isBusy ? (
          <div className="flex flex-col items-center gap-2 text-slate-500 p-4">
            <LoaderCircle className="w-8 h-8 animate-spin text-teal-600" />
            <span className="text-xs font-bold">
              {processingFile ? "Procesando fotografía..." : "Guardando fotografía..."}
            </span>
          </div>
        ) : displayImage ? (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setZoomImage(displayImage);
              }}
              aria-label="Ampliar fotografía"
              className="h-full w-full cursor-zoom-in"
            >
              <img
                src={displayImage}
                alt="Vista previa de fotografía"
                className={`w-full h-full ${
                  objectFit === "contain" ? "object-contain p-3" : "object-cover"
                }`}
              />
            </button>

            {/* Badge when in preview state */}
            {pendingPreview ? (
              <div className="absolute top-3 left-3 z-10 bg-amber-500/95 text-white text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-lg shadow-sm flex items-center gap-1">
                <Camera className="w-3 h-3" />
                <span>Vista Previa</span>
              </div>
            ) : (
              <div className="absolute top-3 left-3 z-10 bg-slate-900/65 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg backdrop-blur-xs">
                Foto actual
              </div>
            )}

            {/* Delete current photo button (only when showing saved image and not pending preview) */}
            {!pendingPreview && onDeleteImage && (
              <button
                type="button"
                onClick={handleDeleteCurrent}
                title="Eliminar fotografía"
                className="absolute top-3 right-3 z-10 bg-slate-900/80 hover:bg-rose-600 text-white rounded-xl w-9 h-9 flex items-center justify-center transition active:scale-95 shadow-md cursor-pointer"
              >
                <X className="w-4 h-4 pointer-events-none" />
              </button>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 text-slate-400 p-4 text-center">
            <div className="w-11 h-11 rounded-2xl bg-teal-50/80 border border-teal-100 flex items-center justify-center text-teal-600">
              <ImageIcon className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold text-slate-600 max-w-xs leading-snug">
              {placeholderText}
            </span>
          </div>
        )}
      </div>

      {/* Error Message Banner */}
      {errorMsg && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span className="flex-1">{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-rose-500 hover:text-rose-800 p-0.5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Action Buttons: Preview Confirmation vs Clear Capture/Select Options */}
      {pendingPreview ? (
        <div className="bg-amber-50/80 border border-amber-200/90 rounded-2xl p-3 space-y-2.5">
          <p className="text-[11px] font-bold text-amber-900 text-center">
            ¿Deseas utilizar esta fotografía? Confírmala o cámbiala antes de guardar.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={handleConfirmPending}
              className="w-full py-2.5 px-3 rounded-xl bg-teal-700 hover:bg-teal-800 active:scale-95 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-xs transition cursor-pointer"
            >
              <Check className="w-4 h-4 shrink-0" />
              <span>Confirmar foto</span>
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={handleOpenCameraClick}
              className="w-full py-2.5 px-3 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0 text-teal-600" />
              <span>Repetir / Cambiar</span>
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={handleDiscardPending}
              className="w-full py-2.5 px-3 rounded-xl bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>Cancelar</span>
            </button>
          </div>
        </div>
      ) : (
        <div className={`grid grid-cols-1 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2"} gap-2.5`}>
          <button
            type="button"
            disabled={isBusy}
            onClick={handleOpenCameraClick}
            className="w-full py-2.5 px-3.5 rounded-xl bg-teal-700 hover:bg-teal-800 active:scale-95 text-white font-extrabold text-xs flex items-center justify-center gap-2 shadow-2xs transition cursor-pointer"
          >
            <Camera className="w-4 h-4 shrink-0" />
            <span>Tomar foto</span>
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setErrorMsg(null);
              playSound("click");
              deviceInputRef.current?.click();
            }}
            className="w-full py-2.5 px-3.5 rounded-xl bg-white hover:bg-teal-50/60 active:scale-95 text-slate-800 hover:text-teal-800 border border-slate-300 hover:border-teal-400 font-extrabold text-xs flex items-center justify-center gap-2 shadow-2xs transition cursor-pointer"
          >
            <Upload className="w-4 h-4 shrink-0 text-teal-600" />
            <span>Seleccionar desde el dispositivo</span>
          </button>
        </div>
      )}

      {helperText && (
        <p className="text-[10px] text-slate-400 font-medium text-center">{helperText}</p>
      )}

      {/* Hidden File Input: Select from device gallery / files */}
      <input
        ref={deviceInputRef}
        type="file"
        accept={preserveSvg ? "image/png,image/jpeg,image/svg+xml,image/webp" : "image/*"}
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Hidden File Input: Native Mobile Camera Capture Fallback */}
      <input
        ref={nativeCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Live Camera Capture Modal (Mobile & Desktop) */}
      {showCameraModal && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={handleCloseCameraModal}
        >
          <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-xs" />
          <div
            className="relative w-full sm:max-w-lg bg-slate-900 text-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-700 overflow-hidden flex flex-col anim-slide-up sm:anim-pop-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-teal-500/20 border border-teal-500/40 flex items-center justify-center text-teal-400">
                  <Camera className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold tracking-wide">Tomar Fotografía</h3>
                  <p className="text-[11px] text-slate-400">
                    Enfoca el producto y presiona Capturar
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseCameraModal}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Camera Viewfinder */}
            <div className="relative bg-black aspect-[4/3] w-full flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`w-full h-full object-cover ${
                  facingMode === "user" ? "scale-x-[-1]" : ""
                } ${cameraStarting || cameraError ? " opacity-0" : "opacity-100"}`}
              />

              {cameraStarting && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <LoaderCircle className="w-9 h-9 animate-spin text-teal-400" />
                  <p className="text-xs font-bold text-slate-200">
                    Iniciando cámara del dispositivo...
                  </p>
                </div>
              )}

              {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-slate-900/95">
                  <AlertCircle className="w-10 h-10 text-amber-400" />
                  <p className="text-xs font-bold text-slate-200 max-w-sm leading-relaxed">
                    {cameraError}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
                    <button
                      type="button"
                      onClick={() => nativeCameraInputRef.current?.click()}
                      className="px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-extrabold text-xs flex items-center gap-2 shadow-sm transition cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Abrir Cámara del Teléfono</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => deviceInputRef.current?.click()}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs flex items-center gap-2 transition cursor-pointer"
                    >
                      <Upload className="w-4 h-4" />
                      <span>Seleccionar desde el dispositivo</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Camera Controls Footer */}
            <div className="p-4 bg-slate-900 border-t border-slate-800 flex flex-col gap-3">
              {!cameraError && (
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={handleSwitchCamera}
                    disabled={cameraStarting}
                    className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5 border border-slate-700 transition cursor-pointer"
                    title="Cambiar entre cámara trasera y frontal"
                  >
                    <SwitchCamera className="w-4 h-4 text-teal-400" />
                    <span>Girar cámara</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCaptureFrame}
                    disabled={cameraStarting}
                    className="flex-1 py-3 px-5 rounded-xl bg-teal-600 hover:bg-teal-500 active:scale-95 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg transition cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Capturar Foto</span>
                  </button>
                </div>
              )}

              {/* Direct option for native OS camera app on mobile */}
              <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px] text-slate-400">
                <span>¿Prefieres usar la app de cámara nativa de tu teléfono?</span>
                <button
                  type="button"
                  onClick={() => nativeCameraInputRef.current?.click()}
                  className="text-teal-400 hover:text-teal-300 font-extrabold underline cursor-pointer"
                >
                  Usar cámara nativa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ImageLightbox
        imageUrl={zoomImage}
        alt="Fotografía ampliada"
        onClose={() => setZoomImage(null)}
      />
    </div>
  );
}
