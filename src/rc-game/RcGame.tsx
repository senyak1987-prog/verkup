import { useEffect, useRef, useState } from "react";
import { CircleHelp, Flag, Keyboard, MousePointer2, Pause, Play, Radio, RotateCcw, X } from "lucide-react";
import { mountRcGame, type RcGameController, type RcTelemetry } from "./game";
import { RamModelCredit } from './RamModelCredit';
import "./rc-game.css";

export interface RcGameProps {
  /** Removes the page header and footer so the game fits a widget or iframe. */
  embedded?: boolean;
  className?: string;
  onLap?: (seconds: number) => void;
}

const INITIAL_TELEMETRY: RcTelemetry = {
  speed: 0,
  elapsed: 0,
  checkpoint: 0,
  checkpoints: 6,
  lap: 0,
  paused: false,
  driving: false,
  suspension: [0.5, 0.5, 0.5, 0.5],
  best: null,
};

const CAMERAS = [
  { value: "overview", label: "Полигон" },
  { value: "follow", label: "Следом" },
  { value: "rear", label: "Сзади" },
  { value: "detail", label: "Детали" },
] as const;

const COLORS = [
  { value: "#e8bc45", label: "Медовый" },
  { value: "#173e31", label: "Лесной" },
  { value: "#dc705b", label: "Коралловый" },
] as const;

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00.0";
  const value = Math.max(0, seconds);
  const minutes = Math.floor(value / 60).toString().padStart(2, "0");
  const wholeSeconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${wholeSeconds}.${Math.floor((value % 1) * 10)}`;
}

export function RcGame({ embedded = false, className = "", onLap }: RcGameProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<RcGameController | null>(null);
  const lapCallbackRef = useRef(onLap);
  const [telemetry, setTelemetry] = useState<RcTelemetry>(INITIAL_TELEMETRY);
  const [camera, setCamera] = useState<(typeof CAMERAS)[number]["value"]>("overview");
  const [color, setColor] = useState<string>(COLORS[0].value);
  const [mode, setMode] = useState<"free" | "trial">("free");
  const [helpOpen, setHelpOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  lapCallbackRef.current = onLap;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    setReady(false);
    setError(null);
    setTelemetry(INITIAL_TELEMETRY);
    try {
      const controller = mountRcGame(host, {
        onTelemetry: (next) => {
          if (!disposed) setTelemetry(next);
        },
        onLap: (seconds) => { if (!disposed) lapCallbackRef.current?.(seconds); },
        onError: (message) => {
          if (!disposed) setError(message);
        },
      });
      controllerRef.current = controller;
      controller.setCamera(camera);
      controller.setColor(color);
      controller.setMode(mode);
      setReady(true);
    } catch (mountError) {
      setError(mountError instanceof Error ? mountError.message : "Браузер не смог открыть 3D-полигон.");
    }
    return () => {
      disposed = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
    // The controller owns the scene. Settings update it without rebuilding WebGL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const active = ready && !error;

  function togglePause() {
    const paused = !telemetry.paused;
    controllerRef.current?.setPaused(paused);
    setTelemetry((previous) => ({ ...previous, paused }));
  }

  function resetGame() {
    controllerRef.current?.reset();
    controllerRef.current?.setPaused(false);
    setTelemetry((previous) => ({ ...INITIAL_TELEMETRY, checkpoints: previous.checkpoints, best: previous.best }));
  }

  function changeMode(next: "free" | "trial") {
    if (next === mode) return;
    setMode(next);
    controllerRef.current?.setMode(next);
  }

  return (
    <section className={`rc-page${embedded ? " rc-page--embedded" : ""} ${className}`} aria-label="Мини-игра с радиоуправляемой машинкой">
      {!embedded && (
        <header className="rc-header">
          <div className="rc-title-group">
            <h1>Маленький заезд</h1>
            <p>Радиоуправляемая машинка. Большое удовольствие.</p>
          </div>
          <a className="rc-brand" href={`${import.meta.env.BASE_URL}sign-configurator/`} aria-label="Открыть конструктор вывесок Город Свет">
            <img src={`${import.meta.env.BASE_URL}gorod-svet-wordmark.svg`} alt="Город Свет" />
          </a>
        </header>
      )}

      <div className="rc-game-shell">
        <div className="rc-toolbar">
          <div className="rc-segmented rc-mode-selector" role="group" aria-label="Режим заезда">
            <button type="button" aria-pressed={mode === "free"} onClick={() => changeMode("free")} disabled={!active}>
              <Radio size={15} aria-hidden="true" /> Свободный заезд
            </button>
            <button type="button" aria-pressed={mode === "trial"} onClick={() => changeMode("trial")} disabled={!active}>
              <Flag size={15} aria-hidden="true" /> На время
            </button>
          </div>
          <div className="rc-actions">
            <button type="button" className="rc-button rc-pause-button" onClick={togglePause} disabled={!active} aria-pressed={telemetry.paused}>
              {telemetry.paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
              <span>{telemetry.paused ? "Продолжить" : "Пауза"}</span>
            </button>
            <button type="button" className="rc-button rc-reset-button" onClick={resetGame} disabled={!active} title="Вернуть машинку на старт" aria-label="Вернуть машинку на старт">
              <RotateCcw size={16} aria-hidden="true" />
              <span>На старт</span>
            </button>
          </div>
        </div>

        <div className="rc-stage">
          <div className="rc-canvas-host" ref={hostRef} tabIndex={0} aria-label="3D-полигон. Удерживайте левую кнопку мыши и указывайте, куда ехать. Правая кнопка — тормоз. Shift — задний ход. Также доступны WASD и стрелки." />

          {active && mode === "trial" && (
            <div className="rc-trial-hud" aria-label="Результаты заезда">
              <div className="rc-timer"><span>Время</span><strong>{formatTime(telemetry.elapsed)}</strong></div>
              <div className="rc-checkpoints"><span>Ворота</span><strong>{Math.min(telemetry.checkpoint, telemetry.checkpoints)} <small>/ {telemetry.checkpoints}</small></strong></div>
              {telemetry.best !== null && <div className="rc-best"><span>Лучший круг</span><strong>{formatTime(telemetry.best)}</strong></div>}
              {telemetry.lap > 0 && <div className="rc-laps"><span>Круги</span><strong>{telemetry.lap}</strong></div>}
            </div>
          )}

          {active && (
            <>
              <div className="rc-speed-hud">
                <div className={`rc-running-state${(telemetry.driving || Math.abs(telemetry.speed) > 0.4) && !telemetry.paused ? " rc-running-state--active" : ""}`}>
                  <span aria-hidden="true" />{telemetry.paused ? "На паузе" : telemetry.driving ? "В движении" : Math.abs(telemetry.speed) > 0.4 ? "По инерции" : "Готова к заезду"}
                </div>
                <div className="rc-speed"><strong>{Math.abs(telemetry.speed).toFixed(1)}</strong><span>км/ч</span></div>
              </div>
              <div className="rc-suspension-hud" aria-label="Работа подвески четырёх колёс">
                <span className="rc-hud-label">Подвеска</span>
                <div className="rc-suspension-bars">
                  {["Переднее левое", "Переднее правое", "Заднее левое", "Заднее правое"].map((label, index) => {
                    const travel = Math.min(1, Math.max(0, telemetry.suspension[index] ?? 0.5));
                    return <div className="rc-suspension-track" key={label} title={label} aria-label={`${label} колесо: ${Math.round(travel * 100)}% хода подвески`}><span style={{ height: `${16 + travel * 84}%` }} /></div>;
                  })}
                </div>
                <span className="rc-suspension-caption">Ход каждого колеса</span>
              </div>
              {telemetry.paused && <div className="rc-pause-overlay"><button type="button" className="rc-resume-button" onClick={togglePause}><Play size={19} aria-hidden="true" />Продолжить заезд</button></div>}
              {!telemetry.paused && !telemetry.driving && Math.abs(telemetry.speed) < 0.4 && (
                <div className="rc-drive-prompt" aria-hidden="true">
                  <MousePointer2 size={16} /><span className="rc-desktop-copy">Удерживайте левую кнопку и указывайте, куда ехать</span><span className="rc-touch-copy">Удерживайте палец, чтобы ехать</span>
                </div>
              )}
            </>
          )}

          {!ready && !error && <div className="rc-stage-message" role="status"><Radio size={24} aria-hidden="true" /><h2>Готовим машинку</h2><p>Полигон скоро появится.</p></div>}
          {error && <div className="rc-stage-message rc-stage-message--error" role="alert"><Radio size={26} aria-hidden="true" /><h2>3D-полигон не открылся</h2><p>{error}</p><button type="button" className="rc-retry-button" onClick={() => setAttempt((previous) => previous + 1)}>Попробовать снова</button></div>}
        </div>

        <div className="rc-settings-bar">
          <div className="rc-camera-setting">
            <span className="rc-setting-label">Камера</span>
            <div className="rc-segmented rc-camera-selector" role="group" aria-label="Положение камеры">
              {CAMERAS.map(({ value, label }) => <button type="button" key={value} disabled={!active} aria-pressed={camera === value} onClick={() => { setCamera(value); controllerRef.current?.setCamera(value); }}>{label}</button>)}
            </div>
          </div>
          <div className="rc-color-setting">
            <span className="rc-setting-label">Цвет</span>
            <div className="rc-color-swatches" role="group" aria-label="Цвет машинки">
              {COLORS.map(({ value, label }) => <button type="button" key={value} disabled={!active} className="rc-color-swatch" style={{ backgroundColor: value }} aria-pressed={color === value} aria-label={label} title={label} onClick={() => { setColor(value); controllerRef.current?.setColor(value); }}><span /></button>)}
            </div>
          </div>
          <button type="button" className="rc-help-button" onClick={() => setHelpOpen((previous) => !previous)} aria-expanded={helpOpen} aria-controls="rc-controls-help">
            {helpOpen ? <X size={17} aria-hidden="true" /> : <CircleHelp size={17} aria-hidden="true" />}<span>Управление</span>
          </button>
        </div>

        {helpOpen && <div className="rc-help-panel" id="rc-controls-help">
          <div><MousePointer2 size={20} aria-hidden="true" /><p><strong>Мышь — ваш пульт</strong><span className="rc-desktop-copy">Удерживайте левую кнопку: машинка едет к курсору. Отпустите — она катится по инерции.</span><span className="rc-touch-copy">Удерживайте палец на полигоне: машинка едет к нему. Отпустите — она катится по инерции.</span></p></div>
          <div><Keyboard size={20} aria-hidden="true" /><p><strong>Ещё немного контроля</strong><span>Правая кнопка — тормоз. <kbd>Пробел</kbd> — ручник задних колёс. <kbd>Shift</kbd> — задний ход. <kbd>WASD</kbd> или стрелки — управление с клавиатуры.</span></p></div>
          {mode === "trial" && <p className="rc-trial-help"><Flag size={17} aria-hidden="true" />Пройдите все ворота по порядку. Следующие ворота подсвечены.</p>}
        </div>}
        <RamModelCredit />
      </div>

      {!embedded && <footer className="rc-footer"><p><MousePointer2 size={14} aria-hidden="true" /><span className="rc-desktop-copy">Зажмите левую кнопку — и поехали. Отпустите — накат.</span><span className="rc-touch-copy">Удерживайте палец на полигоне — и поехали.</span></p><span>Антенна, корпус и подвеска — всё в движении.</span></footer>}
    </section>
  );
}

export default RcGame;
