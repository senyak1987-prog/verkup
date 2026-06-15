import { createRoot } from "react-dom/client";
import { SignConfigurator } from "./components/PdfCalculator";
import "./styles.css";

function StandaloneSignConfigurator() {
  return (
    <SignConfigurator
      topTabs={
        <div className="stage-tabs standalone-tabs" role="navigation" aria-label="Навигация">
          <a className="standalone-back-link" href={import.meta.env.BASE_URL}>
            Себесы
          </a>
        </div>
      }
    />
  );
}

createRoot(document.getElementById("root")!).render(<StandaloneSignConfigurator />);
