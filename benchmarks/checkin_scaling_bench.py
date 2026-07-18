"""Benchmark: how DeepFace.find() check-in latency scales with employee count.

Evidence for the "how many staff can this system check in, and does
performance degrade?" question (see AGENTS.md's threading fix in server.py).
Runs entirely against a throwaway `db_path`, generated from one real
reference photo duplicated with a per-copy pixel tweak (so file hashes
differ, mimicking N distinct employee photos while keeping the same
detectable face) — it never touches the app's real `database/` folder.

Usage:
    ./venv/bin/python benchmarks/checkin_scaling_bench.py [n ...]
    ./venv/bin/python benchmarks/checkin_scaling_bench.py 1 25 100 300 500

Measured results on this machine (CPU-only, VGG-Face + RetinaFace, see
server.py's handle_attendance):

    n_employees |   cold_s |   warm_s
              1 |   10.991 |    0.824
             25 |   22.549 |    0.913
            100 |  102.867 |    0.975
            300 |  269.362 |    0.932
            500 |  459.131 |    1.177

`cold` = first find() call after the embeddings cache is empty/stale for
all n images (one-time cost, ~0.9s/employee, paid incrementally per new
photo — not per check-in). `warm` = steady-state check-in cost once the
cache is built: stays nearly flat (0.82s -> 1.18s) from 1 to 500 employees,
confirming the recognition algorithm itself is not the bottleneck at this
scale — the flat ~1s floor is RetinaFace face-detection on the query image,
independent of database size.
"""

import argparse
import os
import shutil
import sys
import time

os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

from deepface import DeepFace  # noqa: E402
from PIL import Image  # noqa: E402

DEFAULT_SOURCE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "database")
DEFAULT_SIZES = [1, 25, 100, 300, 500]


def find_a_reference_photo(database_dir):
    """Pick any real .jpg from the app's database/ to use as the source face."""
    for name in sorted(os.listdir(database_dir)):
        if name.lower().endswith((".jpg", ".jpeg")):
            return os.path.join(database_dir, name)
    raise FileNotFoundError(f"No reference photo (.jpg) found in {database_dir}")


def reset_db(db_path):
    if os.path.exists(db_path):
        shutil.rmtree(db_path)
    os.makedirs(db_path)


def populate(db_path, source_path, n):
    """Create n distinct employee photos by re-saving the source image with a
    1px pixel tweak per copy, so file hashes differ (mimics n real distinct
    employee reference photos) while keeping the same detectable face."""
    img = Image.open(source_path).convert("RGB")
    for i in range(n):
        copy = img.copy()
        pixels = copy.load()
        pixels[0, 0] = (i % 255, (i * 7) % 255, (i * 13) % 255)
        copy.save(os.path.join(db_path, f"{i + 1}.jpg"), quality=95)


def time_find(db_path, query_path, label):
    t0 = time.time()
    dfs = DeepFace.find(
        img_path=query_path,
        db_path=db_path,
        detector_backend="retinaface",
        enforce_detection=True,
        silent=True,
    )
    elapsed = time.time() - t0
    n_matches = len(dfs[0]) if dfs and len(dfs) else 0
    print(f"[{label}] elapsed={elapsed:.3f}s matches_returned={n_matches}", flush=True)
    return elapsed


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("sizes", nargs="*", type=int, default=DEFAULT_SIZES, help="Employee counts to benchmark")
    parser.add_argument("--source", default=None, help="Real reference photo to duplicate (default: any in database/)")
    parser.add_argument("--workdir", default="/tmp/checkin_scaling_bench", help="Throwaway benchmark directory")
    args = parser.parse_args()

    source_path = args.source or find_a_reference_photo(DEFAULT_SOURCE)
    db_path = os.path.join(args.workdir, "bench_db")
    query_path = os.path.join(args.workdir, "query.jpg")
    os.makedirs(args.workdir, exist_ok=True)
    shutil.copy(source_path, query_path)

    results = []
    for n in args.sizes:
        reset_db(db_path)
        populate(db_path, source_path, n)
        cold = time_find(db_path, query_path, f"n={n} COLD (build cache)")
        warm = time_find(db_path, query_path, f"n={n} WARM (cache hit)")
        results.append((n, cold, warm))

    print("\n=== SUMMARY ===")
    print(f"{'n_employees':>12} | {'cold_s':>8} | {'warm_s':>8}")
    for n, cold, warm in results:
        print(f"{n:>12} | {cold:>8.3f} | {warm:>8.3f}")

    shutil.rmtree(args.workdir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
