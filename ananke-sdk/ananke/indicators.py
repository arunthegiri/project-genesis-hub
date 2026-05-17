"""
Technical indicators for the Ananke SDK.

Pure functions only — no classes, no side effects. Each function accepts a
pandas Series or DataFrame and returns a pandas Series (or dict of Series)
aligned to the same index as the input.

NaN values in inputs are propagated naturally — none of these functions
raise on NaN; they simply let pandas handle missing data as usual.

All computations use pandas vectorized operations for performance even on
large DataFrames (100k+ rows).
"""

import pandas as pd


def sma(series, period):
    """
    Calculate the Simple Moving Average (SMA).

    Computes the unweighted arithmetic mean of the last `period` values
    at each point in the series. The first `period - 1` values will be NaN
    due to insufficient history.

    Parameters
    ----------
    series : pd.Series
        A pandas Series of numeric values (typically closing prices) indexed
        by datetime.
    period : int
        The rolling window size. Must be >= 1.

    Returns
    -------
    pd.Series
        SMA values aligned to the input index. First `period - 1` values
        are NaN.

    Example
    -------
    >>> from ananke.indicators import sma
    >>> sma_20 = sma(df['close'], period=20)
    >>> crossover = sma(df['close'], 10) > sma(df['close'], 50)
    """
    return series.rolling(window=period).mean()


def ema(series, period):
    """
    Calculate the Exponential Moving Average (EMA).

    Applies exponentially decreasing weights to past observations using a
    span-based smoothing factor (alpha = 2 / (period + 1)). More responsive
    to recent price changes than SMA.

    Parameters
    ----------
    series : pd.Series
        A pandas Series of numeric values indexed by datetime.
    period : int
        The span for the EMA calculation. Equivalent to the number of
        periods used to compute the smoothing factor alpha = 2/(period+1).

    Returns
    -------
    pd.Series
        EMA values aligned to the input index. Unlike SMA, EMA technically
        has a value at every bar, but early values should be treated with
        caution as the EMA is still warming up.

    Notes
    -----
    Uses adjust=False, which applies the recursive formula:
        EMA_t = alpha * price_t + (1 - alpha) * EMA_{t-1}
    This matches the standard industry definition of EMA.

    Example
    -------
    >>> from ananke.indicators import ema
    >>> fast = ema(df['close'], period=9)
    >>> slow = ema(df['close'], period=21)
    >>> bullish = fast > slow
    """
    return series.ewm(span=period, adjust=False).mean()


def rsi(series, period=14):
    """
    Calculate the Relative Strength Index (RSI) for a price series.

    RSI measures the speed and magnitude of recent price changes on a scale
    of 0 to 100. Values below 30 are considered oversold (potential buy
    signal), values above 70 are considered overbought (potential sell
    signal).

    Parameters
    ----------
    series : pd.Series
        A pandas Series of closing prices indexed by datetime.
    period : int, optional
        The lookback period for RSI calculation. Default is 14.
        Common values: 9 (short-term), 14 (standard), 25 (long-term).

    Returns
    -------
    pd.Series
        RSI values ranging from 0 to 100, aligned to the input index.
        Early values will be NaN during the warm-up period.

    Notes
    -----
    Uses Wilder's smoothing method (EMA with alpha = 1/period), which
    differs from a standard EMA (alpha = 2/(period+1)). NaN values in the
    input are propagated to the output.

    Example
    -------
    >>> from ananke.indicators import rsi
    >>> rsi_vals = rsi(df['close'], period=14)
    >>> buy_signal = rsi_vals < 30
    >>> sell_signal = rsi_vals > 70
    """
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def macd(series, fast=12, slow=26, signal=9):
    """
    Calculate MACD (Moving Average Convergence Divergence).

    MACD is a trend-following momentum indicator showing the relationship
    between two EMAs of price. The histogram shows the gap between the MACD
    line and its signal line, and is often used to detect momentum shifts.

    Parameters
    ----------
    series : pd.Series
        A pandas Series of closing prices indexed by datetime.
    fast : int, optional
        Period for the fast EMA. Default is 12.
    slow : int, optional
        Period for the slow EMA. Default is 26.
    signal : int, optional
        Period for the signal line EMA (smoothing of the MACD line).
        Default is 9.

    Returns
    -------
    dict
        A dictionary with three keys, each a pd.Series aligned to the
        input index:
        - 'macd'      : MACD line (fast EMA minus slow EMA)
        - 'signal'    : Signal line (EMA of the MACD line)
        - 'histogram' : MACD line minus signal line

    Example
    -------
    >>> from ananke.indicators import macd
    >>> m = macd(df['close'])
    >>> bullish_cross = (m['macd'] > m['signal']) & (m['macd'].shift(1) <= m['signal'].shift(1))
    """
    macd_line = ema(series, fast) - ema(series, slow)
    signal_line = ema(macd_line, signal)
    histogram = macd_line - signal_line
    return {'macd': macd_line, 'signal': signal_line, 'histogram': histogram}


def bollinger(series, period=20, std=2):
    """
    Calculate Bollinger Bands.

    Bollinger Bands consist of a middle SMA and upper/lower bands placed
    `std` standard deviations away. Price touching the lower band can signal
    oversold conditions; touching the upper band can signal overbought.

    Parameters
    ----------
    series : pd.Series
        A pandas Series of closing prices indexed by datetime.
    period : int, optional
        Rolling window size for both the SMA and the standard deviation.
        Default is 20.
    std : float, optional
        Number of standard deviations for the band width. Default is 2.
        Common values: 1.5 (tight), 2 (standard), 2.5 (wide).

    Returns
    -------
    dict
        A dictionary with three keys, each a pd.Series aligned to the
        input index:
        - 'upper'  : Upper band (middle + std * rolling_std)
        - 'middle' : Middle band (SMA)
        - 'lower'  : Lower band (middle - std * rolling_std)

    Notes
    -----
    The rolling standard deviation uses ddof=1 (pandas default), which is
    the sample standard deviation. First `period - 1` values are NaN.

    Example
    -------
    >>> from ananke.indicators import bollinger
    >>> bands = bollinger(df['close'], period=20, std=2)
    >>> price_at_lower = df['close'] <= bands['lower']
    >>> price_at_upper = df['close'] >= bands['upper']
    """
    middle = sma(series, period)
    band_width = std * series.rolling(period).std()
    return {
        'upper': middle + band_width,
        'middle': middle,
        'lower': middle - band_width,
    }


def atr(df, period=14):
    """
    Calculate the Average True Range (ATR).

    ATR measures market volatility by decomposing the full range of price
    movement for a bar, including gaps from the previous close. Higher ATR
    means more volatile price action.

    Parameters
    ----------
    df : pd.DataFrame
        OHLCV DataFrame with columns: 'high', 'low', 'close'. Must be
        sorted by time ascending and indexed by datetime.
    period : int, optional
        Lookback period for the smoothed average. Default is 14.

    Returns
    -------
    pd.Series
        ATR values aligned to the input index. The first value is NaN
        (no previous close to compare against).

    Notes
    -----
    True Range = max(high - low,
                     abs(high - prev_close),
                     abs(low  - prev_close))

    Uses Wilder's smoothing (EMA with alpha = 1/period), matching the
    industry-standard ATR definition. First `period` values warm up and
    should be treated with caution.

    Example
    -------
    >>> from ananke.indicators import atr
    >>> atr_vals = atr(df, period=14)
    >>> # Use ATR to size a stop-loss dynamically
    >>> stop_distance = 2 * atr_vals
    """
    high = df['high']
    low = df['low']
    close = df['close']
    prev_close = close.shift(1)

    true_range = (
        (high - low)
        .combine((high - prev_close).abs(), max)
        .combine((low - prev_close).abs(), max)
    )
    return true_range.ewm(alpha=1 / period, adjust=False).mean()


def vwap(df):
    """
    Calculate the Volume Weighted Average Price (VWAP).

    VWAP is the ratio of cumulative dollar volume to cumulative share volume
    within each trading day. It resets at midnight and is used as an
    intraday fair-value benchmark.

    Parameters
    ----------
    df : pd.DataFrame
        OHLCV DataFrame with columns: 'high', 'low', 'close', 'volume'.
        Must be indexed by datetime. Works with any intraday frequency
        (1-minute, 5-minute, etc.).

    Returns
    -------
    pd.Series
        VWAP values aligned to the input index. Resets to a fresh
        cumulative calculation at the start of each calendar day.

    Notes
    -----
    Typical price = (high + low + close) / 3. The cumulative sums reset
    per date, so VWAP for intraday bars is computed fresh each day. VWAP
    is meaningless on daily OHLCV data — use it only with intraday bars.

    Example
    -------
    >>> from ananke.indicators import vwap
    >>> vwap_vals = vwap(df)
    >>> price_above_vwap = df['close'] > vwap_vals
    """
    typical_price = (df['high'] + df['low'] + df['close']) / 3
    tp_x_vol = typical_price * df['volume']

    date_key = df.index.date
    cumulative_tp_vol = tp_x_vol.groupby(date_key).cumsum()
    cumulative_vol = df['volume'].groupby(date_key).cumsum()

    return cumulative_tp_vol / cumulative_vol
