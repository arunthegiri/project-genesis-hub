import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import "../base.css";
import IndexPage from "../pages/_index";
import CopilotPage from "../pages/copilot";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<IndexPage />} />
        <Route path="/copilot" element={<CopilotPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
