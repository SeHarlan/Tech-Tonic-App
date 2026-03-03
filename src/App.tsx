import { BrowserRouter, Routes, Route } from 'react-router';
import { ArtCanvas } from './components/ArtCanvas';
import { MintPage } from './components/MintPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ArtCanvas />} />
        <Route path="/mint" element={<MintPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
