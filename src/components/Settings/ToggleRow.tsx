/**
 * A labeled on/off switch row (an accessible toggle button), shared by the settings screen and the
 * admin panel it hides. Lives on its own so extracting the admin console didn't have to either
 * duplicate it or import a component out of the screen that renders it.
 */
import styles from './ToggleRow.module.css';

export function ToggleRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={styles.toggleRow}>
      <span className={styles.toggleLabel}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={styles.switch}
        onClick={onToggle}
      >
        <span className={styles.knob} />
      </button>
    </div>
  );
}
