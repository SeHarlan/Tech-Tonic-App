import { BrowserRouter, Routes, Route } from 'react-router';
import { CanvasPage } from './pages/canvas';
import { MintPage } from './pages/mint';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CanvasPage />} />
        <Route path="/mint" element={<MintPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
