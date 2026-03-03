import { useNavigate } from 'react-router';
import { MenuButton } from '../../components/ui/MenuButton';

export function MintPage() {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <MenuButton onClick={() => navigate('/')}>Back</MenuButton>
    </div>
  );
}
