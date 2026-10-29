import { initializeLocale } from './i18n';
import { initializeFeatures } from './modules/state';
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import OpticalTransferApp from "../plugins/optical-transfer/entry";
import { ThemeProvider } from "./context/ThemeContext";
import { AppLockGate } from './components/AppLockGate';
import "./index.css";

void Promise.all([initializeLocale(), initializeFeatures()]).then(() => {
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AppLockGate primary={false}><OpticalTransferApp /></AppLockGate>
    </ThemeProvider>
  </StrictMode>
);

});
