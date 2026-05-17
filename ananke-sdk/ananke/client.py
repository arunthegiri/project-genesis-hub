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
