import { useLayoutEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { resolveSignFont } from "../lib/letterContours";

type Props = {
  index: number; initialText: string; font: string; zoom: number;
  onApply: (text: string) => void; onCancel: () => void;
};

export function CanvasTextEditor({ index, initialText, font, zoom, onApply, onCancel }: Props) {
  const [text, setText] = useState(initialText);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => { inputRef.current?.focus({ preventScroll: true }); inputRef.current?.select(); }, []);
  useLayoutEffect(() => {
    const form = formRef.current, host = form?.parentElement;
    if (!form || !host) return;
    const update = () => {
      const bounds = host.getBoundingClientRect(), panel = form.getBoundingClientRect();
      const row = host.querySelector(`.layout-editor-overlay rect[data-object="line-${index}"]:not([data-resize])`)?.getBoundingClientRect();
      const center = row ? row.x - bounds.x + row.width / 2 : bounds.width / 2;
      const below = row ? row.bottom - bounds.top + 12 : bounds.height - panel.height - 12;
      const top = below + panel.height <= bounds.height - 12 ? below : (row?.top ?? bounds.top) - bounds.top - panel.height - 12;
      setPosition({
        left: Math.max(12, Math.min(center - panel.width / 2, bounds.width - panel.width - 12)),
        top: Math.max(12, Math.min(top, bounds.height - panel.height - 12)),
      });
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(host); observer.observe(form);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, [index, zoom]);
  return <form ref={formRef} className="canvas-text-editor" style={position} aria-label={`Изменить текст строки ${index + 1}`}
    onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    }} onSubmit={event => { event.preventDefault(); onApply(text); }}>
    <div className="canvas-text-editor-heading"><label htmlFor="canvas-line-text">Строка {index + 1}</label>
      <button type="button" className="studio-button" aria-label="Отменить ввод текста" title="Отменить · Escape" onClick={onCancel}><X size={16} /></button>
    </div>
    <div className="canvas-text-editor-input"><input ref={inputRef} id="canvas-line-text" type="text" maxLength={60}
      aria-label={`Текст строки ${index + 1} на макете`} aria-describedby="canvas-line-text-hint" value={text}
      style={{ fontFamily: font, fontWeight: resolveSignFont(font).weight }}
      onChange={event => setText(event.target.value)} />
      <button type="submit" className="studio-button"><Check size={16} />Готово</button>
    </div>
    <small id="canvas-line-text-hint">Enter — применить · Escape — отменить</small>
  </form>;
}
