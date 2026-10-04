import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { CaptureApp } from "./CaptureApp.tsx";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  new URLSearchParams(location.search).has("capture") ? (
    <CaptureApp />
  ) : (
    <App />
  ),
);
