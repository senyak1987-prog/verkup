import { createRoot } from "react-dom/client";
import { SignProductConfigurator } from "./components/SignProductConfigurator";
import { retireLegacyServiceWorker } from "./lib/retireLegacyServiceWorker";
import "./sign-studio-base.css";
import "./sign-studio.css";
import "./sign-studio-commerce.css";
import "./gorod-svet.css";
import "./sign-studio-viewport.css";

createRoot(document.getElementById("root")!).render(<SignProductConfigurator />);
void retireLegacyServiceWorker();
