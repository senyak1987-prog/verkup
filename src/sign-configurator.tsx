import { createRoot } from "react-dom/client";
import { SignProductConfigurator } from "./components/SignProductConfigurator";
import "./sign-studio-base.css";
import "./sign-studio.css";

createRoot(document.getElementById("root")!).render(<SignProductConfigurator />);
