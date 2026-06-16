import { Home } from './components/Home/Home';
import { GameScreen } from './components/GameScreen/GameScreen';
import { Settings } from './components/Settings/Settings';
import { LevelSelect } from './components/LevelSelect/LevelSelect';
import { useScreen } from './useHashRoute';
import styles from './App.module.css';

export default function App() {
  const screen = useScreen();

  return (
    <div className={styles.app}>
      {screen === 'play' && <GameScreen />}
      {screen === 'settings' && <Settings />}
      {screen === 'levels' && <LevelSelect />}
      {screen === 'home' && <Home />}
    </div>
  );
}
