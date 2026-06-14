import { GameBoard } from './components/GameBoard/GameBoard';
import { DifficultySelector } from './components/DifficultySelector/DifficultySelector';
import { Toolbar } from './components/Toolbar/Toolbar';
import { Overlay } from './components/Overlay/Overlay';
import styles from './App.module.css';

export default function App() {
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>Magic Color</h1>
        <p className={styles.tagline}>Pour the colors until every bottle is one shade.</p>
        <DifficultySelector />
      </header>

      <GameBoard />

      <footer className={styles.footer}>
        <Toolbar />
      </footer>

      <Overlay />
    </div>
  );
}
