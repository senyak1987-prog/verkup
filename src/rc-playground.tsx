import { createRoot } from "react-dom/client";
import { RcGame } from "./rc-game/RcGame";

const embedded = new URLSearchParams(window.location.search).get("embed") === "1";
document.body.classList.add("rc-standalone");
if (embedded) document.body.classList.add("rc-standalone--embedded");

const root = document.getElementById("root");
if (root) createRoot(root).render(<RcGame embedded={embedded} />);
