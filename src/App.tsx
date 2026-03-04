import { BrowserRouter, Routes, Route } from 'react-router';
import { CanvasPage } from './pages/canvas';
import { MintPage } from './pages/mint';
import { GeneratePage } from './pages/generate';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CanvasPage />} />
        <Route path="/mint" element={<MintPage />} />
        {import.meta.env.DEV && <Route path="/generate" element={<GeneratePage />} />}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
