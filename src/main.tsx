import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { DomTooltipLayer, TooltipProvider } from "@/components/ui/tooltip";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <App />
      <DomTooltipLayer />
    </TooltipProvider>
  </React.StrictMode>,
);
