"""
Self-healing market-data loader for the Ananke SDK.

`get_data()` is the single method the Charts/Data pages emit as a copy-paste
snippet. Given a symbol, range and interval it returns a Kairos-ready DataFrame
(lowercase OHLCV + a UTC datetime index). If the backing data is missing — a
fresh database, a wiped table, a never-pulled range — it detects the gaps,
triggers ONE async backfill through the Spring Boot API, shows a progress bar,
then returns the complete frame. The same line of code works across Jupyter
sessions; all the intelligence (coverage check → backfill → poll → read →
resample) lives here, invisible to the user.

Workflow::

    df = get_data('NVDA', '2026-01-01', '2026-06-16', '5min')

See Dev-notes/get_data_build_instructions.md for the full design.
"""

import time
import warnings
from datetime import datetime, timezone, timedelta

import pandas as pd

from . import client

# Interval snippet form → pandas resample rule. These six values match the
# frontend Interval enum lowercased (1Min→1min, 1Hour→1hour, …). Mirrors
# python-export.ts intervalToPandasRule, keyed on the snippet form.
_INTERVAL_RULES = {
    "1min": "1min",
    "5min": "5min",
    "15min": "15min",
    "30min": "30min",
    "1hour": "1h",
    "1day": "1D",
}

# Columns get_data can return. OHLCV is the default Kairos contract; vwap,
# trade_count and symbol are opt-in via the `columns` kwarg.
_DEFAULT_COLUMNS = ["open", "high", "low", "close", "volume"]
_ALLOWED_COLUMNS = _DEFAULT_COLUMNS + ["vwap", "trade_count", "symbol"]

# Columns that cannot be correctly aggregated on resample for V1. vwap would
# need an HLC3-volume-weighted recompute over the bucket; trade_count a sum we
# deliberately don't carry. Rather than emit a silently-wrong `last` value we
# drop them when interval != 1min and warn. (See build doc 2e.)
_DROP_ON_RESAMPLE = {"vwap", "trade_count"}

# Gap-significance threshold. The backend's coverage-block detection only splits
# blocks on holes > 96h, but pure block-subtraction here still yields trivial
# leading/trailing slivers (e.g. request starts 00:00 but the first stored bar
# is 14:30). Backfilling those would re-fetch the whole range on every call, so
# we ignore any computed gap shorter than this. Mirrors the backend's
# COVERAGE_GAP_THRESHOLD_HOURS so the two views of "what counts as a gap" agree;
# it also means a genuine missing edge (a whole missing week/month) is still
# caught, while sub-day partials are not — matching the documented limitation.
GAP_THRESHOLD_HOURS = 96

# Polling cadence while a backfill job runs.
_POLL_INTERVAL_SECONDS = 1.5

# Convergence backstop (build doc 2d): an in-process memo of spans a recent
# backfill completed with 0 bars (delisted ticker, pre-IPO, market-closed span
# the threshold didn't catch). Before firing a backfill we skip any gap fully
# contained in a still-fresh zero-bar span, preventing infinite re-backfill
# churn. In-process is sufficient for V1 — it need not survive a kernel restart;
# a fresh kernel attempting once more is acceptable. Keyed by (SYMBOL, from, to)
# → expiry datetime (UTC).
_zero_bar_memo: dict = {}
_ZERO_BAR_TTL_SECONDS = 3600  # 1h: long enough to stop churn, short enough to retry later


# ── Time helpers ─────────────────────────────────────────────────────────────

def _normalize_ts(value: str) -> str:
    """Accept a bare date ('2026-01-01') or full ISO-8601 → UTC ISO-Z string."""
    return _to_dt(value).strftime("%Y-%m-%dT%H:%M:%SZ")


def _to_dt(value: str) -> datetime:
    """Parse a bare date or ISO-8601 string into a UTC datetime."""
    s = str(value).strip()
    if "T" not in s and " " not in s:
        s += "T00:00:00Z"
    # fromisoformat doesn't accept the trailing 'Z' before Python 3.11.
    parsed = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Gap math ─────────────────────────────────────────────────────────────────

def _compute_gaps(start: datetime, end: datetime, blocks: list) -> list:
    """
    Subtract covered blocks from [start, end] → list of (gap_from, gap_to) tuples.

    A block partially overlapping the request trims the gap; no blocks → the
    whole range is one gap. Sub-threshold slivers are filtered out afterwards by
    the caller (see GAP_THRESHOLD_HOURS).
    """
    parsed = sorted(
        ((_to_dt(b["fromTime"]), _to_dt(b["toTime"])) for b in blocks),
        key=lambda b: b[0],
    )
    gaps = []
    cursor = start
    for block_from, block_to in parsed:
        if block_to < cursor:
            continue  # block entirely behind the cursor
        if block_from > cursor:
            gap_end = min(block_from, end)
            if gap_end > cursor:
                gaps.append((cursor, gap_end))
        cursor = max(cursor, block_to)
        if cursor >= end:
            break
    if cursor < end:
        gaps.append((cursor, end))
    return gaps


def _significant_gaps(gaps: list) -> list:
    """Drop gaps shorter than GAP_THRESHOLD_HOURS (trivial edge slivers)."""
    threshold = timedelta(hours=GAP_THRESHOLD_HOURS)
    return [(f, t) for (f, t) in gaps if (t - f) >= threshold]


# ── Convergence backstop ─────────────────────────────────────────────────────

def _memo_key(symbol: str, gap_from: datetime, gap_to: datetime) -> tuple:
    return (symbol.upper(), _iso_z(gap_from), _iso_z(gap_to))


def _remember_zero_bar(symbol: str, gap_from: datetime, gap_to: datetime) -> None:
    expiry = datetime.now(timezone.utc) + timedelta(seconds=_ZERO_BAR_TTL_SECONDS)
    _zero_bar_memo[_memo_key(symbol, gap_from, gap_to)] = expiry


def _is_memoized_zero_bar(symbol: str, gap_from: datetime, gap_to: datetime) -> bool:
    """True if this gap falls inside a still-fresh zero-bar span for the symbol."""
    now = datetime.now(timezone.utc)
    sym = symbol.upper()
    for (msym, mfrom, mto), expiry in list(_zero_bar_memo.items()):
        if expiry < now:
            del _zero_bar_memo[(msym, mfrom, mto)]
            continue
        if msym != sym:
            continue
        if _to_dt(mfrom) <= gap_from and gap_to <= _to_dt(mto):
            return True
    return False


# ── Backfill + polling ───────────────────────────────────────────────────────

_TERMINAL_STATES = {"COMPLETED", "FAILED", "CANCELLED"}


def _find_active_job(symbol: str) -> dict | None:
    for job in client.get_jobs(symbol):
        if job.get("status") in ("PENDING", "RUNNING"):
            return job
    return None


def _make_progress_bar(desc: str):
    """
    Create a tqdm bar rendered immediately, or None if tqdm isn't installed.

    `tqdm.auto` selects the JupyterLab widget in a notebook and the text bar in a
    terminal. `leave=True` keeps the finished bar on screen (a closed `leave=False`
    notebook widget vanishes — the "split-second flash"). The caller owns close().
    """
    try:
        from tqdm.auto import tqdm
    except ImportError:
        warnings.warn(
            "tqdm not installed — backfill progress bar disabled. "
            "Install with `pip install tqdm` for a progress bar.",
            stacklevel=3,
        )
        return None
    bar = tqdm(total=100, desc=desc, unit="%", leave=True)
    bar.refresh()  # paint at 0% now, not after the first poll
    return bar


def _poll_to_completion(job: dict, symbol: str, bar) -> dict:
    """
    Poll a backfill job to a terminal state, driving `bar` from progressPct.

    Polls *before* sleeping so a fast job (already running/done at submit time)
    fills the bar immediately instead of sitting at 0% for a full poll interval.
    Sets the bar position absolutely from progressPct. Does NOT close `bar` — the
    caller owns its lifecycle. Returns the final job dict; raises on FAILED/CANCELLED.
    """
    job_id = job["jobId"]
    status = job.get("status")
    while True:
        if bar is not None:
            bar.n = min(100.0, max(0.0, float(job.get("progressPct") or 0.0)))
            bar.refresh()
        if status in _TERMINAL_STATES:
            break
        time.sleep(_POLL_INTERVAL_SECONDS)
        job = client.get_job(job_id)
        status = job.get("status")
    if bar is not None and status == "COMPLETED":
        bar.n = 100.0
        bar.refresh()

    if status == "FAILED":
        raise RuntimeError(
            f"Backfill for {symbol.upper()} failed: "
            f"{job.get('errorMessage') or 'unknown error'}"
        )
    if status == "CANCELLED":
        raise RuntimeError(f"Backfill for {symbol.upper()} was cancelled.")
    return job


def _run_backfill(symbol: str, span_from: datetime, span_to: datetime, bar) -> None:
    """
    Fire one async backfill over [span_from, span_to] and poll to completion.

    `bar` is the shared progress bar created up-front (or None); this relabels it
    from "checking coverage" to the backfill span and drives it to completion. On
    COMPLETED with totalBars == 0 the span is memoized so future calls don't
    re-fire it (convergence backstop). If a job is already active for the symbol,
    polls that one instead of failing.
    """
    try:
        job = client.start_backfill(symbol, _iso_z(span_from), _iso_z(span_to))
    except client.BackfillActiveError:
        active = _find_active_job(symbol)
        if active is None:
            # The job finished between the 409 and our list call — nothing to do.
            return
        job = active

    if bar is not None:
        bar.set_description(
            f"Backfilling {symbol.upper()} "
            f"{_iso_z(span_from)[:10]}→{_iso_z(span_to)[:10]}"
        )
    final = _poll_to_completion(job, symbol, bar)
    if int(final.get("totalBars") or 0) == 0:
        _remember_zero_bar(symbol, span_from, span_to)


# ── DataFrame assembly ───────────────────────────────────────────────────────

def _build_frame(records: list, columns: list, interval: str, rule: str) -> pd.DataFrame:
    """Bars (list of PriceResponse dicts) → time-indexed, lowercase-OHLCV frame."""
    if not records:
        idx = pd.DatetimeIndex([], name="time", tz="UTC")
        return pd.DataFrame({c: pd.Series(dtype="float64") for c in columns}, index=idx)

    df = pd.DataFrame.from_records(records)
    df = df.rename(columns={"tradeCount": "trade_count"})
    df["time"] = pd.to_datetime(df["time"], utc=True)
    df = df.set_index("time").sort_index()

    for col in ("open", "high", "low", "close", "volume", "vwap", "trade_count"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    if interval != "1min":
        df = _resample(df, rule, columns)

    keep = [c for c in columns if c in df.columns]
    return df[keep]


def _resample(df: pd.DataFrame, rule: str, columns: list) -> pd.DataFrame:
    """Resample 1-min bars to `rule`. Drops vwap/trade_count (see _DROP_ON_RESAMPLE)."""
    if df.empty:
        return df
    agg = {}
    for col, how in (("open", "first"), ("high", "max"), ("low", "min"),
                     ("close", "last"), ("volume", "sum"), ("symbol", "first")):
        if col in df.columns:
            agg[col] = how
    return df.resample(rule).agg(agg).dropna()


# ── Public API ───────────────────────────────────────────────────────────────

def get_data(
    symbol: str,
    start: str,
    end: str,
    interval: str = "1min",
    *,
    columns: list | None = None,
    auto_backfill: bool = True,
    show_progress: bool = True,
) -> pd.DataFrame:
    """
    Load OHLCV bars for `symbol`, self-healing missing data via async backfill.

    Returns a DataFrame ready to drop into ``Kairos(df, ...)``: lowercase
    ``open, high, low, close, volume`` columns and a UTC DatetimeIndex sorted
    ascending. If data is missing in the requested range and ``auto_backfill``
    is True, exactly ONE async backfill job is fired over the bounding span of
    the detected gaps, a progress bar is shown, and the complete frame is
    returned once the job finishes.

    Parameters
    ----------
    symbol : str
        Ticker symbol (case-insensitive).
    start, end : str
        Range bounds. Accepts a bare date (``'2026-01-01'``) or a full ISO-8601
        string; both are normalized to UTC ISO-Z.
    interval : str, default '1min'
        One of ``1min, 5min, 15min, 30min, 1hour, 1day``. Bars are stored as
        1-minute and resampled here.
    columns : list of str, optional
        Columns to return. Defaults to OHLCV. May also include ``vwap``,
        ``trade_count`` and ``symbol``. Note: ``vwap`` and ``trade_count`` are
        dropped when ``interval != '1min'`` (a correct resample is deferred to a
        later version; see the build doc) and a warning is emitted.
    auto_backfill : bool, default True
        If False, never triggers a backfill — returns only data already present
        and warns how much of the range is missing.
    show_progress : bool, default True
        Show a tqdm progress bar during backfill. Polling still runs when False.

    Returns
    -------
    pandas.DataFrame
        Time-indexed (UTC) OHLCV frame.

    Raises
    ------
    ValueError
        Unknown interval, or unknown column name.
    ConnectionError
        If the backend is not reachable.
    RuntimeError
        If a backfill job fails or is cancelled.
    """
    interval = interval.lower()
    if interval not in _INTERVAL_RULES:
        raise ValueError(
            f"Unknown interval {interval!r}. Valid intervals: "
            f"{', '.join(_INTERVAL_RULES)}."
        )
    rule = _INTERVAL_RULES[interval]

    cols = list(columns) if columns else list(_DEFAULT_COLUMNS)
    unknown = [c for c in cols if c not in _ALLOWED_COLUMNS]
    if unknown:
        raise ValueError(
            f"Unknown column(s) {unknown}. Allowed: {', '.join(_ALLOWED_COLUMNS)}."
        )
    if interval != "1min":
        dropped = [c for c in cols if c in _DROP_ON_RESAMPLE]
        if dropped:
            warnings.warn(
                f"{', '.join(dropped)} cannot be resampled correctly for V1 and "
                f"will be dropped at interval {interval!r}. Request interval "
                "'1min' to keep them.",
                stacklevel=2,
            )
            cols = [c for c in cols if c not in _DROP_ON_RESAMPLE]

    start_dt, end_dt = _to_dt(start), _to_dt(end)
    if start_dt >= end_dt:
        raise ValueError(f"start ({start}) must be before end ({end}).")
    from_z, to_z = _iso_z(start_dt), _iso_z(end_dt)

    if auto_backfill:
        # Show the bar the instant the cell runs — before the coverage query —
        # so there's immediate feedback during the scan + job submit. It then
        # relabels into the backfill bar (see _run_backfill) or, if nothing is
        # missing, is dropped quietly (leave=False) to avoid noise on the hot path.
        bar = _make_progress_bar(f"{symbol.upper()}: checking coverage") if show_progress else None
        try:
            blocks = client.get_coverage_blocks(symbol, from_z, to_z)
            gaps = _significant_gaps(_compute_gaps(start_dt, end_dt, blocks))
            # Convergence backstop: drop gaps a recent backfill already returned 0 bars for.
            gaps = [g for g in gaps if not _is_memoized_zero_bar(symbol, g[0], g[1])]
            if gaps:
                span_from = min(g[0] for g in gaps)
                span_to = max(g[1] for g in gaps)
                _run_backfill(symbol, span_from, span_to, bar)
            elif bar is not None:
                bar.leave = False  # data already present — don't leave a stray bar
        finally:
            if bar is not None:
                bar.close()
    else:
        blocks = client.get_coverage_blocks(symbol, from_z, to_z)
        missing = _significant_gaps(_compute_gaps(start_dt, end_dt, blocks))
        if missing:
            total_hours = sum((t - f).total_seconds() for f, t in missing) / 3600
            warnings.warn(
                f"{len(missing)} gap(s) (~{total_hours:.0f}h) missing for "
                f"{symbol.upper()} and auto_backfill=False — returning partial data.",
                stacklevel=2,
            )

    records = client.get_raw_bars(symbol, from_z, to_z)
    return _build_frame(records, cols, interval, rule)
