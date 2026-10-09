import { initializeLocale } from './i18n';
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import OpticalTransferApp from "./optical/OpticalTransferApp";
import { ThemeProvider } from "./context/ThemeContext";
import { AppLockGate } from './components/AppLockGate';
import "./index.css";

void initializeLocale().then(() => {
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AppLockGate primary={false}><OpticalTransferApp /></AppLockGate>
    </ThemeProvider>
  </StrictMode>
);

});
