import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CaptureRoot } from "./capture-root";

const params = new URLSearchParams(window.location.search);
const Root = params.get("overlay") === "1" ? CaptureRoot : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
