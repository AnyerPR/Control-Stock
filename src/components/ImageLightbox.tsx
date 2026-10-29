import { useEffect } from "react";
import { X } from "lucide-react";

interface ImageLightboxProps {
  imageUrl: string | null;
  alt: string;
  onClose: () => void;
}

export default function ImageLightbox({ imageUrl, alt, onClose }: ImageLightboxProps) {
  useEffect(() => {
    if (!imageUrl) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [imageUrl, onClose]);

  if (!imageUrl) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Fotografía ampliada"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-3 sm:p-8"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
        aria-label="Cerrar fotografía ampliada"
        className="absolute right-3 top-3 z-10 rounded-full bg-slate-800/90 p-3 text-white hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-white"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={imageUrl}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[88dvh] max-w-[96vw] select-none object-contain sm:max-h-[90dvh] sm:max-w-[92vw]"
      />
    </div>
  );
}
