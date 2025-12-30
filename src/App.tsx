import React from "react";
import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import { BookProvider } from "./contexts/BookContext";
import { ReaderPage } from "./pages/ReaderPage";
import { ReportPage } from "./pages/ReportPage";

const PersistentReader: React.FC = () => {
  const location = useLocation();
  const hideReader = location.pathname === "/report";

  return (
    <div style={{ display: hideReader ? "none" : "block" }} aria-hidden={hideReader}>
      <ReaderPage />
    </div>
  );
};

const AppRoutes: React.FC = () => {
  return (
    <>
      {/* Keep the Reader mounted so PDF state persists when navigating away */}
      <PersistentReader />
      <Routes>
        <Route path="/report" element={<ReportPage />} />
        <Route path="*" element={null} />
      </Routes>
    </>
  );
};

const App: React.FC = () => {
  return (
    <HashRouter>
      <BookProvider>
        <AppRoutes />
      </BookProvider>
    </HashRouter>
  );
};

export default App;
