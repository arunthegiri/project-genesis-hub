"""
HTTP client for the Ananke SDK.

Handles all communication with the Ananke Spring Boot backend. The default
backend URL is http://localhost:8080, which assumes Docker is running locally.
Override it by setting the ANANKE_API_URL environment variable before
starting Jupyter:

    export ANANKE_API_URL=http://your-server:8080

All functions raise ConnectionError if the backend is unreachable and
ValueError if the server returns a non-2xx response.
"""

import os
import requests

BASE_URL = os.environ.get('ANANKE_API_URL', 'http://localhost:8080')


class BackfillActiveError(RuntimeError):
    """
    Raised when a backfill job is already running for a symbol.

    The backend allows only one active (PENDING/RUNNING) job per symbol and
    returns HTTP 409 if a second is requested. `get_data()` catches this and
    polls the already-active job instead of failing.
    """


def _connection_error() -> ConnectionError:
    return ConnectionError(
        f"Cannot connect to Ananke backend at {BASE_URL}. "
        "Make sure Docker is running: docker-compose up -d"
    )


def post_strategy(payload: dict) -> dict:
    """
    Send a strategy definition and backtest results to the dashboard backend.

    Makes a POST request to {BASE_URL}/api/strategies with the payload
    serialised as JSON. Handles connection errors gracefully with clear,
    actionable error messages.

    Parameters
    ----------
    payload : dict
        The strategy definition and results to send. Must include at minimum:
        'name', 'definition', 'results'.

    Returns
    -------
    dict
        The parsed JSON response from the server, typically containing the
        saved strategy's id, name, and created_at timestamp.

    Raises
    ------
    ConnectionError
        If the backend is not reachable. The message tells you to check
        that Docker is running.
    ValueError
        If the server returns a non-2xx status code. The message includes
        the status code and the server's error body.

    Example
    -------
    >>> from ananke.client import post_strategy
    >>> response = post_strategy({"name": "my_strategy", ...})
    >>> print(response)
    {"id": 1, "name": "my_strategy", "created_at": "2026-05-16T..."}
    """
    try:
        response = requests.post(
            f"{BASE_URL}/api/strategies",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        if response.status_code not in (200, 201):
            raise ValueError(
                f"Backend returned {response.status_code}: {response.text}"
            )
        return response.json()
    except requests.exceptions.ConnectionError:
        raise ConnectionError(
            f"Cannot connect to Ananke backend at {BASE_URL}. "
            "Make sure Docker is running: docker-compose up -d"
        )


def get_strategies() -> list:
    """
    Fetch all saved strategies from the backend.

    Returns
    -------
    list of dict
        Each dict contains at minimum: id, name, created_at. May also
        include description and summary statistics depending on the backend
        version.

    Raises
    ------
    ConnectionError
        If the backend is not reachable.
    ValueError
        If the server returns a non-2xx status code.

    Example
    -------
    >>> from ananke.client import get_strategies
    >>> strategies = get_strategies()
    >>> for s in strategies:
    ...     print(s['name'])
    rsi_mean_reversion
    ma_crossover
    """
    try:
        response = requests.get(
            f"{BASE_URL}/api/strategies",
            timeout=10,
        )
        if response.status_code != 200:
            raise ValueError(
                f"Backend returned {response.status_code}: {response.text}"
            )
        return response.json()
    except requests.exceptions.ConnectionError:
        raise ConnectionError(
            f"Cannot connect to Ananke backend at {BASE_URL}. "
            "Make sure Docker is running: docker-compose up -d"
        )


# ── Price data endpoints (back the SDK's get_data) ───────────────────────────
#
# These wrap the pure-read and async-backfill endpoints under /api/prices.
# They never touch /range (which auto-fills on read); see data.py for how
# get_data() composes them into a self-healing fetch.


def get_coverage_blocks(symbol: str, from_ts: str, to_ts: str) -> list:
    """
    Fetch the contiguous covered blocks of stored bars for `symbol` in a range.

    Wraps ``GET /api/prices/{symbol}/coverage-blocks``. The backend scans
    stock_prices and splits the data into blocks wherever consecutive bars are
    more than COVERAGE_GAP_THRESHOLD_HOURS (96h) apart. `get_data()` subtracts
    these blocks from the requested range to compute the gaps it must backfill.

    Parameters
    ----------
    symbol : str
        Ticker symbol (case-insensitive; backend upper-cases it).
    from_ts, to_ts : str
        ISO-8601 UTC instants with a trailing ``Z`` (e.g. ``2026-01-01T00:00:00Z``).

    Returns
    -------
    list of dict
        Each dict has ``fromTime``, ``toTime`` (ISO-Z) and ``barCount``. Empty
        list if no bars are stored in the range — the whole range is one gap.

    Raises
    ------
    ConnectionError
        If the backend is not reachable.
    ValueError
        If the server returns a non-200 status code.
    """
    try:
        response = requests.get(
            f"{BASE_URL}/api/prices/{symbol}/coverage-blocks",
            params={"from": from_ts, "to": to_ts},
            timeout=30,
        )
        if response.status_code != 200:
            raise ValueError(
                f"Backend returned {response.status_code}: {response.text}"
            )
        return response.json()
    except requests.exceptions.ConnectionError:
        raise _connection_error()


def get_raw_bars(symbol: str, from_ts: str, to_ts: str) -> list:
    """
    Fetch stored 1-minute bars for `symbol` in a range — pure read, no auto-fill.

    Wraps ``GET /api/prices/{symbol}/raw``. Unlike ``/range``, this endpoint
    never triggers fillGaps or an Alpaca fetch; it returns only what is already
    in stock_prices. The envelope ``{ data: [...], count: N }`` is unwrapped to
    the raw list of bar dicts.

    Parameters
    ----------
    symbol : str
        Ticker symbol.
    from_ts, to_ts : str
        ISO-8601 UTC instants with a trailing ``Z``.

    Returns
    -------
    list of dict
        Bar records with keys ``time, symbol, open, high, low, close, volume,
        vwap, tradeCount`` ordered by time ascending.

    Raises
    ------
    ConnectionError
        If the backend is not reachable.
    ValueError
        If the server returns a non-200 status code.
    """
    try:
        response = requests.get(
            f"{BASE_URL}/api/prices/{symbol}/raw",
            params={"from": from_ts, "to": to_ts},
            timeout=60,
        )
        if response.status_code != 200:
            raise ValueError(
                f"Backend returned {response.status_code}: {response.text}"
            )
        body = response.json()
        # /raw uses the PagedResponse envelope, like /range.
        return body.get("data", []) if isinstance(body, dict) else body
    except requests.exceptions.ConnectionError:
        raise _connection_error()


def start_backfill(symbol: str, from_ts: str, to_ts: str) -> dict:
    """
    Start an async backfill job for `symbol` over a range.

    Wraps ``POST /api/prices/{symbol}/backfill/async``. Returns immediately with
    a BackfillJobResponse dict containing ``jobId`` to poll.

    Parameters
    ----------
    symbol : str
        Ticker symbol.
    from_ts, to_ts : str
        ISO-8601 UTC instants with a trailing ``Z``.

    Returns
    -------
    dict
        BackfillJobResponse: ``jobId, symbol, fromTime, toTime, status,
        progressPct, totalBars, completedChunks, totalChunks, errorMessage`` …

    Raises
    ------
    BackfillActiveError
        If a job is already running for the symbol (HTTP 409). The caller should
        poll the existing active job via :func:`get_jobs` instead.
    ConnectionError
        If the backend is not reachable.
    ValueError
        For any other non-2xx status code.
    """
    try:
        response = requests.post(
            f"{BASE_URL}/api/prices/{symbol}/backfill/async",
            params={"from": from_ts, "to": to_ts},
            timeout=30,
        )
        if response.status_code == 409:
            raise BackfillActiveError(
                f"A backfill job is already running for {symbol.upper()}."
            )
        if response.status_code not in (200, 201, 202):
            raise ValueError(
                f"Backend returned {response.status_code}: {response.text}"
            )
        return response.json()
    except requests.exceptions.ConnectionError:
        raise _connection_error()


def get_job(job_id: str) -> dict:
    """
    Poll the status of a single async backfill job.

    Wraps ``GET /api/prices/jobs/{jobId}``.

    Parameters
    ----------
    job_id : str
        The job UUID returned by :func:`start_backfill`.

    Returns
    -------
    dict
        BackfillJobResponse (see :func:`start_backfill`).

    Raises
    ------
    ConnectionError
        If the backend is not reachable.
    ValueError
        If the server returns a non-200 status code.
    """
    try:
        response = requests.get(
            f"{BASE_URL}/api/prices/jobs/{job_id}",
            timeout=30,
        )
        if response.status_code != 200:
            raise ValueError(
                f"Backend returned {response.status_code}: {response.text}"
            )
        return response.json()
    except requests.exceptions.ConnectionError:
        raise _connection_error()


def get_jobs(symbol: str) -> list:
    """
    List all backfill jobs for a symbol.

    Wraps ``GET /api/prices/jobs?symbol=...``. Used to find an already-active job
    when :func:`start_backfill` reports one is running (BackfillActiveError).

    Parameters
    ----------
    symbol : str
        Ticker symbol.

    Returns
    -------
    list of dict
        BackfillJobResponse dicts.

    Raises
    ------
    ConnectionError
        If the backend is not reachable.
    ValueError
        If the server returns a non-200 status code.
    """
    try:
        response = requests.get(
            f"{BASE_URL}/api/prices/jobs",
            params={"symbol": symbol},
            timeout=30,
        )
        if response.status_code != 200:
            raise ValueError(
                f"Backend returned {response.status_code}: {response.text}"
            )
        return response.json()
    except requests.exceptions.ConnectionError:
        raise _connection_error()


def get_strategy(name: str) -> dict:
    """
    Fetch a single strategy by name, including its latest backtest results.

    Parameters
    ----------
    name : str
        The strategy name exactly as it was exported via Kairos.export().

    Returns
    -------
    dict
        Full strategy definition and backtest results as stored by the backend.

    Raises
    ------
    ConnectionError
        If the backend is not reachable.
    ValueError
        If the server returns a non-2xx status code (e.g. 404 if the
        strategy name does not exist).

    Example
    -------
    >>> from ananke.client import get_strategy
    >>> s = get_strategy('rsi_mean_reversion')
    >>> print(s['results']['win_rate'])
    66.67
    """
    try:
        response = requests.get(
            f"{BASE_URL}/api/strategies/{name}",
            timeout=10,
        )
        if response.status_code != 200:
            raise ValueError(
                f"Backend returned {response.status_code}: {response.text}"
            )
        return response.json()
    except requests.exceptions.ConnectionError:
        raise ConnectionError(
            f"Cannot connect to Ananke backend at {BASE_URL}. "
            "Make sure Docker is running: docker-compose up -d"
        )
