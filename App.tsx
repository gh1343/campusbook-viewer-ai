import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { BookProvider } from './contexts/BookContext';
import { ReaderPage } from './pages/ReaderPage';
import { ReportPage } from './pages/ReportPage';

const App: React.FC = () => {
  return (
    <HashRouter>
      <BookProvider>
        <Routes>
          <Route path="/" element={<ReaderPage />} />
          <Route path="/report" element={<ReportPage />} />
        </Routes>
      </BookProvider>
    </HashRouter>
  );
};

export default App;
