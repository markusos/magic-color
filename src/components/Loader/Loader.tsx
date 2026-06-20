import styles from './Loader.module.css';

/** Fills the board area with a spinner while a live level is being generated (see gameStore.loading). */
export function Loader() {
  return (
    <div className={styles.loader} role="status" aria-live="polite">
      <div className={styles.spinner} aria-hidden />
      <span className={styles.label}>Generating level…</span>
    </div>
  );
}
