import { useState } from "react";
import { Camera, ImagePlus, LoaderCircle, Pencil, Trash2, X } from "lucide-react";
import { processImageFile } from "./PhotoCaptureField";
import PhotoCaptureField from "./PhotoCaptureField";
import ImageLightbox from "./ImageLightbox";
import {
  MAX_PHOTO_DATA_URL_LENGTH,
  MAX_PRODUCT_PHOTOS,
  addProductImage,
  removeProductImage,
  replaceProductImage
} from "../utils/productPhotos";

interface ProductPhotosEditorProps {
  images: string[];
  onChange: (images: string[]) => void;
}

type ImageAction = { kind: "add" } | { kind: "replace"; index: number };

export default function ProductPhotosEditor({ images, onChange }: ProductPhotosEditorProps) {
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [captureAction, setCaptureAction] = useState<ImageAction | null>(null);

  const openCapture = (action: ImageAction) => {
    if (action.kind === "add" && images.length >= MAX_PRODUCT_PHOTOS) return;
    setErrorMessage("");
    setCaptureAction(action);
  };

  const handleCapturedImage = async (capturedDataUrl: string) => {
    setProcessing(true);
    setErrorMessage("");
    try {
      const blob = await fetch(capturedDataUrl).then((response) => response.blob());
      const file = new File([blob], "fotografia.webp", { type: blob.type || "image/webp" });
      let dataUrl = "";
      for (const [dimension, quality] of [[1280, 0.82], [1024, 0.76], [800, 0.68], [640, 0.6]] as const) {
        dataUrl = await processImageFile(file, dimension, quality);
        if (dataUrl.length <= MAX_PHOTO_DATA_URL_LENGTH) break;
      }

      if (dataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) {
        throw new Error("La imagen es demasiado grande para guardarla de forma segura. Selecciona una foto más pequeña.");
      }

      const action = captureAction;
      if (!action) return;
      if (action.kind === "replace") {
        onChange(replaceProductImage(images, action.index, dataUrl));
      } else {
        onChange(addProductImage(images, dataUrl));
      }
      setCaptureAction(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo procesar la fotografía.");
    } finally {
      setProcessing(false);
    }
  };

  const removeImage = (index: number) => {
    try {
      onChange(removeProductImage(images, index));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "No se pudo eliminar la fotografía.");
    }
  };

  return (
    <section className="space-y-3" aria-label="Fotografías del producto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">Fotografías del suministro</h3>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">
            {images.length} de {MAX_PRODUCT_PHOTOS} fotografías · {Math.max(0, MAX_PRODUCT_PHOTOS - images.length)} disponibles
          </p>
        </div>
        {processing && (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-700">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Procesando
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map((image, index) => (
          <div key={`${index}-${image.slice(0, 32)}`} className="relative min-w-0">
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setZoomImage(image);
              }}
              aria-label={`Ampliar fotografía ${index + 1}`}
              className="block h-32 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500 sm:h-36"
            >
              <img src={image} alt={`Fotografía ${index + 1} del suministro`} className="h-full w-full object-contain" />
            </button>
            <span className="absolute bottom-2 left-2 rounded-md bg-slate-950/75 px-2 py-1 text-[10px] font-bold text-white">
              Foto {index + 1}
            </span>
            <div className="absolute right-2 top-2 flex gap-1">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openCapture({ kind: "replace", index });
                }}
                aria-label={`Reemplazar fotografía ${index + 1}`}
                title="Reemplazar fotografía"
                className="rounded-lg bg-slate-950/75 p-2 text-white hover:bg-teal-700"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  removeImage(index);
                }}
                aria-label={`Eliminar fotografía ${index + 1}`}
                title="Eliminar fotografía"
                className="rounded-lg bg-slate-950/75 p-2 text-white hover:bg-rose-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}

        {images.length < MAX_PRODUCT_PHOTOS && (
          <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-teal-300 bg-teal-50/50 p-3 text-center sm:min-h-36">
            <ImagePlus className="h-6 w-6 text-teal-700" />
            <span className="text-[11px] font-bold text-slate-600">Agregar fotografía</span>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                disabled={processing}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openCapture({ kind: "add" });
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-2.5 py-2 text-[10px] font-bold text-white hover:bg-teal-800 disabled:opacity-50"
              >
                <Camera className="h-3.5 w-3.5" /> Cámara
              </button>
              <button
                type="button"
                disabled={processing}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openCapture({ kind: "add" });
                }}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-[10px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Dispositivo
              </button>
            </div>
          </div>
        )}
      </div>

      {errorMessage && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {errorMessage}
        </p>
      )}
      <p className="text-[10px] font-medium text-slate-400">
        Los cambios se guardan al pulsar «Guardar Cambios». Toca una miniatura para ampliarla.
      </p>

      {captureAction && (
        <div className="rounded-xl border border-teal-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-700">
              {captureAction.kind === "replace" ? "Reemplazar fotografía" : "Agregar fotografía"}
            </span>
            <button
              type="button"
              onClick={() => setCaptureAction(null)}
              aria-label="Cancelar fotografía"
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <PhotoCaptureField
            currentImageUrl={captureAction.kind === "replace" ? images[captureAction.index] : undefined}
            onConfirmImage={handleCapturedImage}
            onDeleteImage={captureAction.kind === "replace"
              ? () => {
                  removeImage(captureAction.index);
                  setCaptureAction(null);
                }
              : undefined}
            isSaving={processing}
            placeholderText="Toma una foto con la cámara o selecciona una imagen del dispositivo"
            heightClass="h-36"
            objectFit="contain"
            maxDimension={1280}
            quality={0.88}
            compact
          />
        </div>
      )}
      <ImageLightbox imageUrl={zoomImage} alt="Fotografía del suministro" onClose={() => setZoomImage(null)} />
    </section>
  );
}
