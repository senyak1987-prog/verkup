import {
  Building2,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Send,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { FocusEvent } from "react";
import type { ProductionEmployee } from "../types";

type AccessGateProps = {
  employees: ProductionEmployee[];
  installAvailable?: boolean;
  registrationAllowed?: boolean;
  registrationToken?: string;
  onLogin: (login: string, password: string) => Promise<boolean>;
  onInstallApp?: () => void;
  onRegister: (data: {
    name: string;
    phone: string;
    note: string;
  }) => void;
};

export function AccessGate({
  employees,
  installAvailable = false,
  registrationAllowed = false,
  registrationToken = "",
  onLogin,
  onInstallApp,
  onRegister,
}: AccessGateProps) {
  const [mode, setMode] = useState<"login" | "register">(() =>
    registrationAllowed ? "register" : "login",
  );
  const [login, setLogin] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [working, setWorking] = useState(false);
  const hasInviteToken = Boolean(registrationToken.trim());

  useEffect(() => {
    if (registrationAllowed) {
      setMode("register");
      setError("");
      setDone("");
      return;
    }

    if (mode === "register") setMode("login");
  }, [mode, registrationAllowed]);

  function switchMode(nextMode: "login" | "register") {
    setError("");
    setDone("");
    setMode(nextMode);
  }

  function scrollFocusedFieldIntoView(event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (typeof window === "undefined" || !window.matchMedia("(max-width: 768px)").matches) return;

    const target = event.currentTarget;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const keepFieldVisible = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const rect = target.getBoundingClientRect();
      const bottomLimit = Math.max(180, viewportHeight - 24);

      if (rect.top >= 12 && rect.bottom <= bottomLimit) return;

      target.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: reduceMotion ? "auto" : "smooth",
      });
    };

    window.setTimeout(keepFieldVisible, 120);
    window.setTimeout(keepFieldVisible, 420);
  }

  async function submitLogin() {
    const cleanLogin = login.trim();
    const cleanPassword = password.trim();
    setError("");
    setDone("");

    if (!cleanLogin || !cleanPassword) {
      setError("Введите логин и пароль.");
      return;
    }

    setWorking(true);
    try {
      const ok = await onLogin(cleanLogin, cleanPassword);
      if (!ok) setError("Логин или пароль не подошли.");
    } finally {
      setWorking(false);
    }
  }

  function submitRegistration() {
    const cleanName = name.trim();
    setError("");
    setDone("");

    if (!registrationAllowed) {
      setError("Регистрация доступна только по ссылке-приглашению.");
      return;
    }

    if (!cleanName) {
      setError("Укажите имя и фамилию.");
      return;
    }

    onRegister({
      name: cleanName,
      phone: phone.trim(),
      note: note.trim(),
    });
    setName("");
    setPhone("");
    setNote("");
    setDone("Заявка отправлена. Руководитель увидит ее в списке сотрудников и выдаст доступ.");
    setMode("login");
  }

  return (
    <main className="access-gate">
      <section className="access-shell" aria-labelledby="access-title">
        <aside className="access-brand-panel">
          <div className="access-logo-lockup">
            <img
              alt="VERKUP"
              className="access-logo"
              src={`${import.meta.env.BASE_URL}verkup-logo-vector.svg`}
            />
            <p>рекламно-производственная компания</p>
          </div>
        </aside>

        <section
          className="access-card"
          aria-label={mode === "login" ? "Вход сотрудника" : "Заявка на доступ"}
        >
          <div className="access-card-head">
            <span className="access-card-icon" aria-hidden="true">
              <LockKeyhole size={20} />
            </span>
            <div>
              <span className="eyebrow">{mode === "login" ? "Защищенный вход" : "Приглашение"}</span>
              <h2 id="access-title">{mode === "login" ? "Вход сотрудника" : "Заявка на доступ"}</h2>
            </div>
          </div>

          <div className="access-form">
            <div className="access-tabs" role="tablist" aria-label="Доступ">
              <button
                aria-selected={mode === "login"}
                className={mode === "login" ? "active" : ""}
                onClick={() => switchMode("login")}
                type="button"
              >
                Вход
              </button>
              <button
                aria-selected={mode === "register"}
                className={mode === "register" ? "active" : ""}
                disabled={!registrationAllowed}
                onClick={() => switchMode("register")}
                type="button"
                title={registrationAllowed ? "Регистрация по приглашению" : "Регистрация доступна только по ссылке"}
              >
                Регистрация
              </button>
            </div>

            {installAvailable ? (
              <button className="secondary access-install-button" onClick={onInstallApp} type="button">
                <Download size={17} />
                Установить приложение
              </button>
            ) : null}

            {mode === "login" ? (
              <>
                {employees.length ? (
                  <>
                    <div className="access-mode-note">
                      <UserRound size={16} />
                      <span>Можно войти по логину, телефону или имени сотрудника.</span>
                    </div>
                    <label>
                      <span>Логин</span>
                      <input
                        autoComplete="username"
                        autoFocus
                        onChange={(event) => setLogin(event.target.value)}
                        onFocus={scrollFocusedFieldIntoView}
                        placeholder="Логин, телефон или имя"
                        value={login}
                      />
                    </label>
                    <label>
                      <span>Пароль</span>
                      <div className="access-password-control">
                        <input
                          autoComplete="current-password"
                          onChange={(event) => setPassword(event.target.value)}
                          onFocus={scrollFocusedFieldIntoView}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void submitLogin();
                          }}
                          type={passwordVisible ? "text" : "password"}
                          value={password}
                        />
                        <button
                          aria-label={passwordVisible ? "Скрыть пароль" : "Показать пароль"}
                          className="access-password-toggle"
                          onClick={() => setPasswordVisible((current) => !current)}
                          type="button"
                        >
                          {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </label>
                    <button
                      className="primary"
                      disabled={working || !login.trim() || !password.trim()}
                      onClick={() => void submitLogin()}
                      type="button"
                    >
                      <KeyRound size={17} />
                      Войти
                    </button>
                  </>
                ) : (
                  <p className="access-note access-note-plain">Пока нет сотрудников с выданным доступом.</p>
                )}
                {hasInviteToken && !registrationAllowed && !done ? (
                  <p className="access-error" role="alert">Ссылка регистрации уже использована или недействительна.</p>
                ) : null}
              </>
            ) : (
              <>
                <div className="access-mode-note">
                  <Building2 size={16} />
                  <span>Заявка попадет руководителю в раздел сотрудников.</span>
                </div>
                <label>
                  <span>Имя и фамилия</span>
                  <input
                    autoComplete="name"
                    onChange={(event) => setName(event.target.value)}
                    onFocus={scrollFocusedFieldIntoView}
                    placeholder="Как вас записать"
                    value={name}
                  />
                </label>
                <label>
                  <span>Телефон</span>
                  <input
                    autoComplete="tel"
                    onChange={(event) => setPhone(event.target.value)}
                    onFocus={scrollFocusedFieldIntoView}
                    placeholder="+7..."
                    value={phone}
                  />
                </label>
                <label>
                  <span>Комментарий</span>
                  <textarea
                    onChange={(event) => setNote(event.target.value)}
                    onFocus={scrollFocusedFieldIntoView}
                    placeholder="Должность, отдел, кто пригласил"
                    value={note}
                  />
                </label>
                <button className="primary" onClick={submitRegistration} type="button">
                  <Send size={17} />
                  Отправить заявку
                </button>
              </>
            )}
          </div>

          {error ? <p className="access-error" role="alert">{error}</p> : null}
          {done ? <p className="access-done" role="status">{done}</p> : null}
          <p className="access-note access-note-footer">
            {registrationAllowed
              ? "Ссылка-приглашение активна. После отправки руководитель выдаст логин, пароль и права доступа."
              : "Регистрация доступна только по ссылке-приглашению. Права доступа выдает руководитель."}
          </p>
        </section>
      </section>
    </main>
  );
}
