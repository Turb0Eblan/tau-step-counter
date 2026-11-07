"""
Interactive photobleaching step counter for single-molecule intensity traces.

Reads an ImageJ / Fiji "Multi Measure" CSV (columns Mean(1), Mean(2), ...),
shows each ROI trace together with a TV-denoised version and lets you label
it as M (one bleaching step), D (two steps) or D+ (more than two).
Labels are appended to a CSV right away, so you can stop and resume.

    python parse_tau.py ../examples/Frame1_IntensityTraces_film_3.csv
"""
import argparse
import csv
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.widgets import Button
from skimage.restoration import denoise_tv_chambolle


def estimate_noise_std(y: np.ndarray) -> float:
    """Robust noise estimate from successive differences."""
    if len(y) < 3:
        return 1.0
    dy = np.diff(y)
    mad = np.median(np.abs(dy - np.median(dy)))
    if mad > 0:
        return float(mad / 0.6745 / np.sqrt(2))
    alt = np.std(dy) / np.sqrt(2)
    return float(max(alt, 1.0))


def find_mean_columns(df: pd.DataFrame) -> list[str]:
    """Return ROI intensity columns like Mean(1), Mean1, etc."""
    cols = [c for c in df.columns if str(c).startswith("Mean")]
    if not cols:
        raise ValueError("No ROI columns found. Expected columns starting with 'Mean'.")
    return cols


def get_frame_axis(df: pd.DataFrame) -> np.ndarray:
    """Use the first numeric-looking column as frame axis, else 1..N."""
    first_col = df.columns[0]
    frames = pd.to_numeric(df[first_col], errors="coerce")
    if frames.notna().all():
        return frames.to_numpy()
    return np.arange(1, len(df) + 1)


def load_existing_labels(path: Path) -> set[str]:
    """Read already-labeled ROI names so we can resume."""
    if not path.exists():
        return set()
    old = pd.read_csv(path)
    if "roi_column" not in old.columns:
        return set()
    return set(old["roi_column"].astype(str).tolist())


def append_label(path: Path, row: dict) -> None:
    """Append one classification row immediately."""
    file_exists = path.exists()
    with path.open("a", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "roi_column",
                "label",
                "tv_weight",
                "noise_std",
                "n_points",
            ],
        )
        if not file_exists:
            writer.writeheader()
        writer.writerow(row)


class TraceReviewer:
    def __init__(self, frames, y, roi_name, out_csv, tv_weight, noise_std, max_iter=200):
        self.frames = frames
        self.y = y
        self.roi_name = roi_name
        self.out_csv = out_csv
        self.tv_weight = tv_weight
        self.noise_std = noise_std
        self.choice = None

        self.filtered = denoise_tv_chambolle(
            self.y,
            weight=self.tv_weight,
            eps=1e-6,
            max_num_iter=max_iter,
        )

        self.fig = None

    def save_and_close(self, label: str):
        append_label(
            self.out_csv,
            {
                "roi_column": self.roi_name,
                "label": label,
                "tv_weight": round(self.tv_weight, 6),
                "noise_std": round(self.noise_std, 6),
                "n_points": len(self.y),
            },
        )
        self.choice = label
        plt.close(self.fig)

    def on_m(self, event):
        self.save_and_close("m")

    def on_d(self, event):
        self.save_and_close("d")

    def on_dp(self, event):
        self.save_and_close("d+")

    def on_key(self, event):
        if event.key in ["m", "M"]:
            self.save_and_close("m")
        elif event.key in ["d", "D"]:
            self.save_and_close("d")
        elif event.key == "+":
            self.save_and_close("d+")
        elif event.key in ["escape", "q"]:
            plt.close(self.fig)

    def show(self):
        self.fig = plt.figure(figsize=(10, 6))

        ax = self.fig.add_axes([0.08, 0.22, 0.84, 0.70])
        ax.plot(self.frames, self.y, label=f"{self.roi_name} raw")
        ax.plot(self.frames, self.filtered, label=f"TV filtered (weight={self.tv_weight:.2f})")
        ax.set_xlabel("Frame")
        ax.set_ylabel("Mean intensity")
        ax.set_title(self.roi_name)
        ax.legend()

        # Buttons
        ax_m = self.fig.add_axes([0.18, 0.06, 0.16, 0.08])
        ax_d = self.fig.add_axes([0.42, 0.06, 0.16, 0.08])
        ax_dp = self.fig.add_axes([0.66, 0.06, 0.16, 0.08])

        b_m = Button(ax_m, "M")
        b_d = Button(ax_d, "D")
        b_dp = Button(ax_dp, "D+")

        b_m.on_clicked(self.on_m)
        b_d.on_clicked(self.on_d)
        b_dp.on_clicked(self.on_dp)

        self.fig.canvas.mpl_connect("key_press_event", self.on_key)

        plt.show()
        return self.choice


def main():
    parser = argparse.ArgumentParser(
        description="Interactive photobleaching step counter (M / D / D+) with TV filtering."
    )
    parser.add_argument(
        "input_csv",
        nargs="?",
        default=str(Path(__file__).resolve().parent.parent / "examples" / "Frame1_IntensityTraces_film_3.csv"),
        help="Input ROI intensity CSV exported from ImageJ / Fiji (default: the example file)",
    )
    parser.add_argument(
        "--out",
        default="roi_classification.csv",
        help="Output CSV for saved labels (default: roi_classification.csv)",
    )
    parser.add_argument(
        "--tv-multiplier",
        type=float,
        default=1.5,
        help="TV weight = tv_multiplier * estimated noise std (default: 1.5)",
    )
    parser.add_argument(
        "--min-weight",
        type=float,
        default=1.0,
        help="Minimum TV weight (default: 1.0)",
    )
    parser.add_argument(
        "--max-iter",
        type=int,
        default=200,
        help="Max iterations of the Chambolle TV solver (default: 200)",
    )
    args = parser.parse_args()

    input_csv = Path(args.input_csv)
    out_csv = Path(args.out)

    df = pd.read_csv(input_csv)
    mean_cols = find_mean_columns(df)
    frames = get_frame_axis(df)
    done = load_existing_labels(out_csv)

    print(f"Found {len(mean_cols)} ROI columns.")
    print(f"Already labeled: {len(done)}")
    print("Controls: click buttons, or press M / D / +. Press Q or Esc to stop.")

    for col in mean_cols:
        if col in done:
            continue

        y = pd.to_numeric(df[col], errors="coerce").to_numpy(dtype=float)
        mask = np.isfinite(y) & np.isfinite(frames)
        y_valid = y[mask]
        frames_valid = frames[mask]

        if len(y_valid) < 3:
            append_label(
                out_csv,
                {
                    "roi_column": col,
                    "label": "too_short",
                    "tv_weight": np.nan,
                    "noise_std": np.nan,
                    "n_points": len(y_valid),
                },
            )
            continue

        noise_std = estimate_noise_std(y_valid)
        tv_weight = max(args.tv_multiplier * noise_std, args.min_weight)

        reviewer = TraceReviewer(
            frames=frames_valid,
            y=y_valid,
            roi_name=col,
            out_csv=out_csv,
            tv_weight=tv_weight,
            noise_std=noise_std,
            max_iter=args.max_iter,
        )
        choice = reviewer.show()

        # If user closes without choosing, stop cleanly
        if choice is None:
            print("Stopped by user.")
            break

    if out_csv.exists():
        labels = pd.read_csv(out_csv)
        print("\nCurrent counts:")
        if "label" in labels.columns:
            print(labels["label"].value_counts(dropna=False).to_string())
        print(f"\nSaved labels to: {out_csv}")


if __name__ == "__main__":
    main()