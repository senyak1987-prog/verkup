import { createRoot } from "react-dom/client";
import { SignProductConfigurator } from "./components/SignProductConfigurator";
import "./sign-studio-base.css";
import "./sign-studio.css";
import "./sign-studio-commerce.css";

createRoot(document.getElementById("root")!).render(<SignProductConfigurator />);
