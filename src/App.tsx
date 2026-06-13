import { GameBoard } from './components/GameBoard/GameBoard';
import { Toolbar } from './components/Toolbar/Toolbar';
import { Overlay } from './components/Overlay/Overlay';
import styles from './App.module.css';

export default function App() {
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>Magic Color</h1>
        <p className={styles.tagline}>Pour the colors until every bottle is one shade.</p>
      </header>

      <main className={styles.main}>
        <GameBoard />
        <Toolbar />
      </main>

      <Overlay />
    </div>
  );
}
