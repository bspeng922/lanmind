/**
 * ImagePreview — Interactive image preview component with mouse wheel zoom,
 * mouse drag & pan, and focal-point (cursor invariant) scaling.
 *
 * CALLING SPEC:
 *   const previewRef = useRef<ImagePreviewHandle>(null);
 *   <ImagePreview
 *     ref={previewRef}
 *     src={imageUrl}
 *     alt={imageName}
 *     scale={scale}
 *     onScaleChange={setScale}
 *   />
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Loader2 } from 'lucide-react';

export interface ImagePreviewHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  fit: () => void;
  actualSize: () => void;
}

interface ImagePreviewProps {
  src: string;
  alt: string;
  scale: number;
  onScaleChange: (scale: number) => void;
  className?: string;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 10.0;
const ZOOM_STEP = 1.25;

export const ImagePreview = forwardRef<ImagePreviewHandle, ImagePreviewProps>(
  ({ src, alt, scale, onScaleChange, className = '' }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imgDimensions, setImgDimensions] = useState<{ width: number; height: number }>({
      width: 0,
      height: 0,
    });

    const dragStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number }>({
      clientX: 0,
      clientY: 0,
      panX: 0,
      panY: 0,
    });

    // Center image in container at initial fit
    const centerImage = useCallback((imgW: number, imgH: number, targetScale: number) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const scaledW = imgW * targetScale;
      const scaledH = imgH * targetScale;
      const initialPanX = Math.round((rect.width - scaledW) / 2);
      const initialPanY = Math.round((rect.height - scaledH) / 2);
      setPan({ x: initialPanX, y: initialPanY });
    }, []);

    // Calculate initial fit scale
    const calculateFitScale = useCallback((imgW: number, imgH: number): number => {
      const container = containerRef.current;
      if (!container || imgW === 0 || imgH === 0) return 1;
      const rect = container.getBoundingClientRect();
      const padding = 48;
      const availW = Math.max(100, rect.width - padding);
      const availH = Math.max(100, rect.height - padding);
      const fit = Math.min(availW / imgW, availH / imgH);
      return Math.min(1, Math.max(MIN_SCALE, Number(fit.toFixed(2))));
    }, []);

    // Initial setup on image load
    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      const naturalWidth = img.naturalWidth || 800;
      const naturalHeight = img.naturalHeight || 600;
      setImgDimensions({ width: naturalWidth, height: naturalHeight });
      setImageLoaded(true);

      const initialScale = calculateFitScale(naturalWidth, naturalHeight);
      onScaleChange(initialScale);
      centerImage(naturalWidth, naturalHeight, initialScale);
    };

    // Zoom towards a specific focal point in container coordinates
    const zoomAtPoint = useCallback(
      (focalX: number, focalY: number, newScale: number) => {
        const clampedScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(newScale.toFixed(2))));
        if (clampedScale === scale) return;

        setPan((prevPan) => {
          const ratio = clampedScale / scale;
          const newPanX = focalX - (focalX - prevPan.x) * ratio;
          const newPanY = focalY - (focalY - prevPan.y) * ratio;
          return { x: Math.round(newPanX), y: Math.round(newPanY) };
        });

        onScaleChange(clampedScale);
      },
      [scale, onScaleChange]
    );

    // Zoom from center of viewport (e.g. for toolbar buttons)
    const zoomFromCenter = useCallback(
      (newScale: number) => {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        zoomAtPoint(centerX, centerY, newScale);
      },
      [zoomAtPoint]
    );

    // Expose control methods via ref
    useImperativeHandle(
      ref,
      () => ({
        zoomIn: () => zoomFromCenter(scale * ZOOM_STEP),
        zoomOut: () => zoomFromCenter(scale / ZOOM_STEP),
        reset: () => {
          if (imgDimensions.width > 0 && imgDimensions.height > 0) {
            const fitScale = calculateFitScale(imgDimensions.width, imgDimensions.height);
            onScaleChange(fitScale);
            centerImage(imgDimensions.width, imgDimensions.height, fitScale);
          } else {
            onScaleChange(1);
            setPan({ x: 0, y: 0 });
          }
        },
        fit: () => {
          if (imgDimensions.width > 0 && imgDimensions.height > 0) {
            const fitScale = calculateFitScale(imgDimensions.width, imgDimensions.height);
            onScaleChange(fitScale);
            centerImage(imgDimensions.width, imgDimensions.height, fitScale);
          }
        },
        actualSize: () => {
          zoomFromCenter(1);
        },
      }),
      [scale, imgDimensions, calculateFitScale, onScaleChange, centerImage, zoomFromCenter]
    );

    // Mouse wheel zoom with focal-point under cursor
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        const nextScale = scale * factor;
        zoomAtPoint(mouseX, mouseY, nextScale);
      };

      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }, [scale, zoomAtPoint]);

    // Drag start
    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return; // Only primary mouse button
      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    };

    // Drag move
    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      e.preventDefault();
      const deltaX = e.clientX - dragStartRef.current.clientX;
      const deltaY = e.clientY - dragStartRef.current.clientY;
      setPan({
        x: dragStartRef.current.panX + deltaX,
        y: dragStartRef.current.panY + deltaY,
      });
    };

    // Drag end
    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      setIsDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
    };

    // Double click to toggle between fit scale and 2.0x zoom
    const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (scale > 1.2) {
        const fitScale = calculateFitScale(imgDimensions.width, imgDimensions.height);
        zoomAtPoint(mouseX, mouseY, fitScale);
      } else {
        zoomAtPoint(mouseX, mouseY, 2.0);
      }
    };

    return (
      <div
        ref={containerRef}
        className={`relative h-full w-full overflow-hidden select-none bg-canvas ${
          isDragging ? 'cursor-grabbing' : 'cursor-grab'
        } ${className}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        {!imageLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-sub">
            <Loader2 className="h-8 w-8 animate-spin text-info mb-2" />
            <span className="text-xs">加载图片中...</span>
          </div>
        )}

        <div
          className="absolute left-0 top-0 will-change-transform transition-transform duration-75 ease-out"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0px) scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={handleImageLoad}
            className={`max-w-none rounded-lg shadow-popover pointer-events-none transition-opacity duration-200 ${
              imageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            style={
              imgDimensions.width > 0
                ? { width: imgDimensions.width, height: imgDimensions.height }
                : undefined
            }
          />
        </div>
      </div>
    );
  }
);

ImagePreview.displayName = 'ImagePreview';
