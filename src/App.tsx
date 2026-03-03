import { BrowserRouter, Routes, Route } from 'react-router';
import { ArtCanvas } from './components/ArtCanvas';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ArtCanvas />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
