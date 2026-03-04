import { BrowserRouter, Routes, Route } from 'react-router';
import { WalletProvider } from './providers/WalletProvider';
import { CanvasPage } from './pages/canvas';
import { MintPage } from './pages/mint';

function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<CanvasPage />} />
          <Route path="/mint" element={<MintPage />} />
        </Routes>
      </BrowserRouter>
    </WalletProvider>
  );
}

export default App;
