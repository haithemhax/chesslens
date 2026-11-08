import { createRoot } from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/inter/latin-900.css';
import '@fontsource/noto-sans-arabic/arabic-400.css';
import '@fontsource/noto-sans-arabic/arabic-600.css';
import '@fontsource/noto-sans-arabic/arabic-700.css';
import '@fontsource/noto-sans-arabic/arabic-800.css';
import '@fontsource/noto-sans-arabic/arabic-900.css';
import '@fontsource/noto-sans-symbols-2/symbols-400.css';
import './index.css';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { ShowProvider } from './state/ShowProvider.jsx';

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <ShowProvider>
      <App />
    </ShowProvider>
  </ErrorBoundary>,
);
