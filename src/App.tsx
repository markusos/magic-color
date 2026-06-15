import { GameBoard } from './components/GameBoard/GameBoard';
import { DifficultySelector } from './components/DifficultySelector/DifficultySelector';
import { Stats } from './components/Stats/Stats';
import { InfoButton } from './components/InfoButton/InfoButton';
import { Toolbar } from './components/Toolbar/Toolbar';
import { Overlay } from './components/Overlay/Overlay';
import styles from './App.module.css';

export default function App() {
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <InfoButton />
        <h1 className={styles.title}>Magic Color</h1>
        <DifficultySelector />
        <Stats />
      </header>

      <GameBoard />

      <footer className={styles.footer}>
        <Toolbar />
      </footer>

      <Overlay />
    </div>
  );
}
