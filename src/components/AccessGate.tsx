import { Download, KeyRound, Lock, Send } from "lucide-react";
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

    window.setTimeout(() => {
      target.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }, 180);
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
      <section className="access-card">
        <div className="access-card-head">
          <Lock size={22} />
          <div>
            <span className="eyebrow">Доступ Verkup</span>
            <h1>Вход сотрудника</h1>
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
            <button className="secondary" onClick={onInstallApp} type="button">
              <Download size={17} />
              Установить приложение
            </button>
          ) : null}

          {mode === "login" ? (
            <>
              {employees.length ? (
                <>
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
                    <input
                      autoComplete="current-password"
                      onChange={(event) => setPassword(event.target.value)}
                      onFocus={scrollFocusedFieldIntoView}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void submitLogin();
                      }}
                      type="password"
                      value={password}
                    />
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
                <p className="access-note">Пока нет сотрудников с выданным доступом.</p>
              )}
              {hasInviteToken && !registrationAllowed && !done ? (
                <p className="access-error">Ссылка регистрации уже использована или недействительна.</p>
              ) : null}
            </>
          ) : (
            <>
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

        {error ? <p className="access-error">{error}</p> : null}
        {done ? <p className="access-done">{done}</p> : null}
        <p className="access-note">
          {registrationAllowed
            ? "Вы открыли ссылку-приглашение. Заполните заявку, после этого руководитель выдаст логин, пароль и права доступа."
            : "Регистрация доступна только по ссылке-приглашению. После заявки руководитель выдаёт права доступа, логин, пароль или оставляет сотрудника без доступа."}
        </p>
      </section>
    </main>
  );
}
