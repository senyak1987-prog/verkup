import { useEffect, useMemo, useRef, useState } from 'react';

type ImageBounds = { left: number; top: number; width: number; height: number };

export function SignPhotoPreview({ image, imageWidthMm, markup, night }: {
  image: string; imageWidthMm: number; markup: string; night: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null), imageRef = useRef<HTMLImageElement>(null);
  const [bounds, setBounds] = useState<ImageBounds>({ left: 0, top: 0, width: 0, height: 0 });
  const [imageRatio, setImageRatio] = useState(0);
  const dimensions = useMemo(() => {
    const box = markup.match(/\bviewBox\s*=\s*["']\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)[,\s]+([-+\d.eE]+)[,\s]+([-+\d.eE]+)\s*["']/);
    const width = box ? Number(box[3]) : Number(markup.match(/\bwidth=["']([\d.]+)/)?.[1] ?? 500);
    const height = box ? Number(box[4]) : Number(markup.match(/\bheight=["']([\d.]+)/)?.[1] ?? 300);
    return { width: Number.isFinite(width) && width > 0 ? width : 500, height: Number.isFinite(height) && height > 0 ? height : 300 };
  }, [markup]);
  const overlayMarkup = useMemo(() => markup.replace(/<svg\b([^>]*)>/, (_tag, attrs: string) =>
    `<svg ${attrs.replace(/\s(?:width|height|style)\s*=\s*(?:"[^"]*"|'[^']*')/g, '')} width="100%" height="100%" style="display:block;overflow:visible">`), [markup]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const resize = () => {
      const ratio = imageRatio || (imageRef.current?.naturalWidth ?? 0) / Math.max(1, imageRef.current?.naturalHeight ?? 1);
      if (!ratio) return;
      const hostWidth = host.clientWidth, hostHeight = host.clientHeight;
      const width = Math.min(hostWidth, hostHeight * ratio), height = width / ratio;
      setBounds({ left: (hostWidth - width) / 2, top: (hostHeight - height) / 2, width, height });
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(host);
    return () => observer.disconnect();
  }, [image, imageRatio]);

  const pixelsPerMm = bounds.width / Math.max(1, Number.isFinite(imageWidthMm) ? imageWidthMm : 4000);
  return <div ref={hostRef} className="sign-photo-preview" style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' }}>
    <img ref={imageRef} src={image} alt="Ваш фасад" onLoad={event => setImageRatio(event.currentTarget.naturalWidth / Math.max(1, event.currentTarget.naturalHeight))}
      style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }} />
    <div aria-hidden="true" style={{ position: 'absolute', left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height,
      background: '#0c1421', opacity: night ? .58 : 0, transition: 'opacity 750ms cubic-bezier(.22,.68,0,1)', pointerEvents: 'none' }} />
    {bounds.width > 0 && <div aria-label="Ваша вывеска на фасаде" style={{ position: 'absolute', left: bounds.left + bounds.width * .5,
      top: bounds.top + bounds.height * .4, width: dimensions.width * pixelsPerMm, height: dimensions.height * pixelsPerMm,
      transform: 'translate(-50%,-50%)', pointerEvents: 'none' }} dangerouslySetInnerHTML={{ __html: overlayMarkup }} />}
  </div>;
}
