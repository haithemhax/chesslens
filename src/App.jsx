import AudienceScreen from './components/AudienceScreen.jsx';
import CalibrationView from './components/CalibrationView.jsx';
import OperatorPanel from './components/OperatorPanel.jsx';
import Splash from './components/Splash.jsx';
import Toast from './components/Toast.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

export default function App() {
  return (
    <div className="relative min-h-screen bg-ink-950">
      <ErrorBoundary name="AudienceScreen">
        <AudienceScreen />
      </ErrorBoundary>
      <ErrorBoundary name="OperatorPanel">
        <OperatorPanel />
      </ErrorBoundary>
      <ErrorBoundary name="CalibrationView">
        <CalibrationView />
      </ErrorBoundary>
      <ErrorBoundary name="Splash">
        <Splash />
      </ErrorBoundary>
      <Toast />
    </div>
  );
}
