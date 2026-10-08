import { useEffect, useMemo, useRef, useState } from 'react';

type ImageBounds = { left: number; top: number; width: number; height: number; viewportWidth: number; viewportHeight: number };
type PhysicalSignBox = { x: number; y: number; width: number; height: number };

export function SignPhotoPreview({ image, imageWidthMm, markup, night, signBox }: {
  image: string; imageWidthMm: number; markup: string; night: boolean; signBox?: PhysicalSignBox;
}) {
  const hostRef = useRef<HTMLDivElement>(null), imageRef = useRef<HTMLImageElement>(null);
  const [bounds, setBounds] = useState<ImageBounds>({ left: 0, top: 0, width: 0, height: 0, viewportWidth: 0, viewportHeight: 0 });
  const [imageRatio, setImageRatio] = useState(0);
  const dimensions = useMemo(() => {
    const box = markup.match(/\bviewBox\s*=\s*["']\s*([-+\d.eE]+)[,\s]+([-+\d.eE]+)[,\s]+([-+\d.eE]+)[,\s]+([-+\d.eE]+)\s*["']/);
    const width = box ? Number(box[3]) : Number(markup.match(/\bwidth=["']([\d.]+)/)?.[1] ?? 500);
    const height = box ? Number(box[4]) : Number(markup.match(/\bheight=["']([\d.]+)/)?.[1] ?? 300);
    const x = box && Number.isFinite(Number(box[1])) ? Number(box[1]) : 0;
    const y = box && Number.isFinite(Number(box[2])) ? Number(box[2]) : 0;
    const validWidth = Number.isFinite(width) && width > 0 ? width : 500;
    const validHeight = Number.isFinite(height) && height > 0 ? height : 300;
    const metadata = markup.match(/\bdata-sign-anchor=["']([^"']+)["']/)?.[1].trim().split(/[\s,]+/).map(Number);
    const physicalBox = signBox && Object.values(signBox).every(Number.isFinite) && signBox.width > 0 && signBox.height > 0;
    const anchor = physicalBox ? { x: signBox.x + signBox.width / 2, y: signBox.y + signBox.height / 2 }
      : metadata?.length === 2 && metadata.every(Number.isFinite) ? { x: metadata[0], y: metadata[1] }
        : { x: x + validWidth / 2, y: y + validHeight / 2 };
    return { x, y, width: validWidth, height: validHeight, anchor };
  }, [markup, signBox]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const resize = () => {
      const ratio = imageRatio || (imageRef.current?.naturalWidth ?? 0) / Math.max(1, imageRef.current?.naturalHeight ?? 1);
      if (!ratio) return;
      const hostWidth = host.clientWidth, hostHeight = host.clientHeight;
      const width = Math.min(hostWidth, hostHeight * ratio), height = width / ratio;
      setBounds({ left: (hostWidth - width) / 2, top: (hostHeight - height) / 2, width, height,
        viewportWidth: hostWidth, viewportHeight: hostHeight });
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(host);
    return () => observer.disconnect();
  }, [image, imageRatio]);

  const pixelsPerMm = bounds.width / Math.max(1, Number.isFinite(imageWidthMm) ? imageWidthMm : 4000);
  const signLeft = bounds.left + bounds.width * .5 - dimensions.width * pixelsPerMm / 2;
  const signTop = bounds.top + bounds.height * .4 - dimensions.height * pixelsPerMm / 2;
  const signAnchor = { x: signLeft + (dimensions.anchor.x - dimensions.x) * pixelsPerMm,
    y: signTop + (dimensions.anchor.y - dimensions.y) * pixelsPerMm };
  const overlayMarkup = useMemo(() => markup.replace(/^<\?xml[^>]*\?>\s*/, '').replace(/<svg\b([^>]*)>/, (_tag, attrs: string) =>
    `<svg ${attrs.replace(/\s(?:x|y|width|height|style)\s*=\s*(?:"[^"]*"|'[^']*')/g, '')} x="${signLeft}" y="${signTop}" width="${dimensions.width * pixelsPerMm}" height="${dimensions.height * pixelsPerMm}" style="overflow:visible">`),
    [markup, signLeft, signTop, dimensions.width, dimensions.height, pixelsPerMm]);
  return <div ref={hostRef} className="sign-photo-preview" style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' }}>
    <img ref={imageRef} src={image} alt="Ваш фасад" onLoad={event => setImageRatio(event.currentTarget.naturalWidth / Math.max(1, event.currentTarget.naturalHeight))}
      style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }} />
    <div aria-hidden="true" style={{ position: 'absolute', left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height,
      background: '#0c1421', opacity: night ? .58 : 0, transition: 'opacity 750ms cubic-bezier(.22,.68,0,1)', pointerEvents: 'none' }} />
    {bounds.width > 0 && <svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ваша вывеска на фасаде"
      viewBox={`0 0 ${bounds.viewportWidth} ${bounds.viewportHeight}`} data-sign-anchor={`${signAnchor.x} ${signAnchor.y}`}
      width="100%" height="100%" style={{ position: 'absolute', inset: 0, display: 'block', overflow: 'visible', pointerEvents: 'none' }}
      dangerouslySetInnerHTML={{ __html: overlayMarkup }} />}
  </div>;
}
