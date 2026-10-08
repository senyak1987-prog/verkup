import { ArrowLeft, CarFront, Flag, Map, Pause, Play, RotateCcw } from "lucide-react";
import type { RcTelemetry } from "./world";
import "./facade-rc-controls.css";

export interface FacadeRcControlsProps {
  active: boolean;
  paused: boolean;
  loading?: boolean;
  telemetry: RcTelemetry | null;
  onStart: () => void;
  onExit: () => void;
  onPause: () => void;
  onReset: () => void;
  onMode: (mode: "free" | "trial") => void;
  mode: "free" | "trial";
  onCamera: (camera: "arena" | "car") => void;
  camera: "arena" | "car";
}

function formatTime(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(value / 60).toString().padStart(2, "0");
  const wholeSeconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${wholeSeconds}.${Math.floor((value % 1) * 10)}`;
}

export function FacadeRcControls({
  active,
  paused,
  loading = false,
  telemetry,
  onStart,
  onExit,
  onPause,
  onReset,
  onMode,
  mode,
  onCamera,
  camera,
}: FacadeRcControlsProps) {
  const speed = Math.abs(telemetry?.speed ?? 0);
  const checkpoints = telemetry?.checkpoints ?? 6;
  const checkpoint = Math.min(telemetry?.checkpoint ?? 0, checkpoints);

  if (!active) {
    return (
      <div className="facade-rc-controls">
        <div className="facade-rc-launch">
          <button type="button" className="facade-rc-start" onClick={onStart} disabled={loading} aria-busy={loading}>
            <CarFront size={19} aria-hidden="true" />
            <span>{loading ? "Готовим машинку…" : "Поиграть с машинкой"}</span>
            {!loading && <Play size={15} aria-hidden="true" />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="facade-rc-controls facade-rc-controls--active" aria-label="Управление мини-заездом">
      <div className="facade-rc-toolbar">
        <button type="button" className="facade-rc-exit" onClick={onExit}>
          <ArrowLeft size={17} aria-hidden="true" />
          <span>К вывеске</span>
        </button>
        <span className="facade-rc-title">Мини-заезд{paused && <span className="facade-rc-paused"> · Пауза</span>}</span>
        <div className="facade-rc-actions">
          <button
            type="button"
            className="facade-rc-action"
            onClick={onPause}
            aria-pressed={paused}
            aria-label={paused ? "Продолжить заезд" : "Поставить заезд на паузу"}
            title={paused ? "Продолжить заезд" : "Пауза"}
          >
            {paused ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
          </button>
          <button type="button" className="facade-rc-action" onClick={onReset} aria-label="Вернуть машинку на старт" title="На старт">
            <RotateCcw size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="facade-rc-telemetry" aria-label="Показатели заезда">
        <span className="facade-rc-speed"><strong>{(Number.isFinite(speed) ? speed : 0).toFixed(1)}</strong><span>км/ч</span></span>
        {mode === "trial" && (
          <>
            <span className="facade-rc-time"><span>Время</span><strong>{formatTime(telemetry?.elapsed ?? 0)}</strong></span>
            <span className="facade-rc-gates"><Flag size={13} aria-hidden="true" /><strong>{checkpoint}<span> / {checkpoints}</span></strong><span className="facade-rc-gates-label">ворот</span></span>
          </>
        )}
        {paused && <span className="facade-rc-pause-status" role="status">Пауза</span>}
      </div>

      <div className="facade-rc-bottom">
        <div className="facade-rc-settings">
          <div className="facade-rc-segmented" role="group" aria-label="Режим заезда">
            <button type="button" aria-pressed={mode === "free"} onClick={() => onMode("free")}>Свободно</button>
            <button type="button" aria-pressed={mode === "trial"} onClick={() => onMode("trial")}>На время</button>
          </div>
          <div className="facade-rc-segmented facade-rc-camera" role="group" aria-label="Положение камеры">
            <button type="button" aria-pressed={camera === "arena"} onClick={() => onCamera("arena")} title="Вся площадка">
              <Map size={15} aria-hidden="true" /><span>Площадка</span>
            </button>
            <button type="button" aria-pressed={camera === "car"} onClick={() => onCamera("car")} title="Камера следует за машинкой">
              <CarFront size={15} aria-hidden="true" /><span>Машинка</span>
            </button>
          </div>
        </div>
        <p className="facade-rc-instructions">
          <span className="facade-rc-desktop-copy">Удерживайте ЛКМ — ехать · ПКМ — тормоз · Shift — назад</span>
          <span className="facade-rc-touch-copy">Удерживайте палец на площадке — машинка поедет к нему</span>
        </p>
      </div>
    </div>
  );
}

export default FacadeRcControls;
