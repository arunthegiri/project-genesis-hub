# Ananke SDK

Python SDK for the Ananke Quant Trading Platform. Define, backtest, and export
trading strategies from Jupyter notebooks to the Ananke dashboard.

---

## Installation

```bash
pip install -e /path/to/ananke-sdk/
```

Install in editable mode so any changes to the source files take effect
immediately without reinstalling.

---

## Quick Start

```python
from ananke import Kairos
from ananke.indicators import rsi, sma

# df is your OHLCV DataFrame loaded from TimescaleDB
k = Kairos(df, name='my_strategy')

# Always compute indicators from k.df — Kairos may reindex df internally
rsi_vals = rsi(k.df['close'], period=14)
k.enter_long(condition=rsi_vals < 30)
k.enter_short(condition=rsi_vals > 70)

# Define exit conditions
k.exit_trade(stop_loss=0.02, take_profit=0.05)

# Run the backtest
results = k.run()
results       # displays summary table in Jupyter

# Visualise
k.plot()

# Export to dashboard
k.export()
```

> **Note:** Always use `k.df['close']` (not the original `df['close']`) when
> computing indicators. Kairos promotes the `time` column to the index
> internally, so the original `df` may have a different index than `k.df`.

---

## Indicators

All indicators are pure functions in `ananke.indicators`. They take a pandas
Series or DataFrame and return a Series aligned to the same index. NaN values
in the input are propagated naturally.

```python
from ananke.indicators import rsi, sma, ema, macd, bollinger, atr, vwap
```

---

### `sma(series, period)`

Simple Moving Average — unweighted arithmetic mean of the last `period` values.

| Parameter | Type | Description |
|---|---|---|
| `series` | `pd.Series` | Price series (typically close) |
| `period` | `int` | Rolling window size |

**Returns:** `pd.Series` — first `period - 1` values are NaN.

```python
sma_20 = sma(k.df['close'], period=20)
```

---

### `ema(series, period)`

Exponential Moving Average — applies exponentially decreasing weights using
`alpha = 2 / (period + 1)`. More responsive to recent prices than SMA.

| Parameter | Type | Description |
|---|---|---|
| `series` | `pd.Series` | Price series |
| `period` | `int` | Span for the EMA smoothing factor |

**Returns:** `pd.Series`

```python
fast = ema(k.df['close'], period=9)
slow = ema(k.df['close'], period=21)
bullish = fast > slow
```

---

### `rsi(series, period=14)`

Relative Strength Index — momentum oscillator ranging 0–100.
Below 30 = oversold (potential buy). Above 70 = overbought (potential sell).

| Parameter | Type | Description |
|---|---|---|
| `series` | `pd.Series` | Closing price series |
| `period` | `int` | Lookback period. Default `14`. |

**Returns:** `pd.Series` — values between 0 and 100.

Uses Wilder's smoothing method (`alpha = 1/period`).

```python
rsi_vals = rsi(k.df['close'], period=14)
buy_signal  = rsi_vals < 30
sell_signal = rsi_vals > 70
```

---

### `macd(series, fast=12, slow=26, signal=9)`

Moving Average Convergence Divergence — trend-following momentum indicator.

| Parameter | Type | Description |
|---|---|---|
| `series` | `pd.Series` | Closing price series |
| `fast` | `int` | Fast EMA period. Default `12`. |
| `slow` | `int` | Slow EMA period. Default `26`. |
| `signal` | `int` | Signal line EMA period. Default `9`. |

**Returns:** `dict` with keys:
- `'macd'` — MACD line (fast EMA − slow EMA)
- `'signal'` — Signal line (EMA of MACD)
- `'histogram'` — MACD line − signal line

```python
m = macd(k.df['close'])
bullish_cross = (m['macd'] > m['signal']) & (m['macd'].shift(1) <= m['signal'].shift(1))
```

---

### `bollinger(series, period=20, std=2)`

Bollinger Bands — SMA with upper/lower bands at `std` standard deviations.

| Parameter | Type | Description |
|---|---|---|
| `series` | `pd.Series` | Closing price series |
| `period` | `int` | Rolling window for SMA and std. Default `20`. |
| `std` | `float` | Number of standard deviations. Default `2`. |

**Returns:** `dict` with keys `'upper'`, `'middle'`, `'lower'` — each a `pd.Series`.

```python
bands = bollinger(k.df['close'], period=20, std=2)
at_lower = k.df['close'] <= bands['lower']
at_upper = k.df['close'] >= bands['upper']
```

---

### `atr(df, period=14)`

Average True Range — measures volatility by capturing the full price range
including gaps from the previous close.

| Parameter | Type | Description |
|---|---|---|
| `df` | `pd.DataFrame` | OHLCV DataFrame with columns `high`, `low`, `close` |
| `period` | `int` | Wilder smoothing period. Default `14`. |

**Returns:** `pd.Series`

```python
atr_vals = atr(k.df, period=14)
dynamic_stop = 2 * atr_vals   # 2× ATR stop distance
```

---

### `vwap(df)`

Volume Weighted Average Price — intraday fair-value benchmark. Resets at the
start of each calendar day.

| Parameter | Type | Description |
|---|---|---|
| `df` | `pd.DataFrame` | OHLCV DataFrame with columns `high`, `low`, `close`, `volume` |

**Returns:** `pd.Series`

> Only meaningful on intraday bars (1-minute, 5-minute, etc.).

```python
vwap_vals = vwap(k.df)
above_vwap = k.df['close'] > vwap_vals
```

---

## Kairos Class

The main class for defining and running a backtest. Accepts an OHLCV DataFrame,
entry/exit conditions, and produces a `Results` object.

---

### `Kairos(df, name=None)`

| Parameter | Type | Description |
|---|---|---|
| `df` | `pd.DataFrame` | OHLCV DataFrame with columns `open`, `high`, `low`, `close`, `volume`. Accepts `time` as a column or as the index. |
| `name` | `str` | Optional strategy label. Defaults to `kairos_{timestamp}`. |

The DataFrame is sorted ascending by time internally. Access the cleaned,
index-set DataFrame via `k.df`.

---

### `enter_long(condition)`

Define when to open a long (buy) position.

| Parameter | Type | Description |
|---|---|---|
| `condition` | `pd.Series of bool` | Boolean Series aligned to `k.df.index`. When True at bar N, enters long at the open of bar N+1. |

Raises `ValueError` if condition is not a Series or its index doesn't match `k.df`.

```python
k.enter_long(condition=rsi_vals < 30)
```

---

### `enter_short(condition)`

Define when to open a short (sell) position.

| Parameter | Type | Description |
|---|---|---|
| `condition` | `pd.Series of bool` | Boolean Series aligned to `k.df.index`. When True at bar N, enters short at the open of bar N+1. |

```python
k.enter_short(condition=rsi_vals > 70)
```

---

### `exit_trade(condition=None, stop_loss=None, take_profit=None)`

Define when to close an open position. At least one parameter must be provided.
All three can be combined — whichever triggers first closes the trade.

| Parameter | Type | Description |
|---|---|---|
| `condition` | `pd.Series of bool` | Exit at bar close when True |
| `stop_loss` | `float` | Exit if trade moves against you by this fraction. `0.02` = 2% |
| `take_profit` | `float` | Exit if trade moves in your favour by this fraction. `0.05` = 5% |

```python
k.exit_trade(condition=rsi_vals > 65, stop_loss=0.02, take_profit=0.05)
```

---

### `set_quantity(qty)`

Set the number of shares or contracts per trade. Default is `1.0`.

| Parameter | Type | Description |
|---|---|---|
| `qty` | `float` | Must be greater than zero |

```python
k.set_quantity(10)
```

---

### `run()`

Execute the backtest bar by bar. Returns a `Results` object.

Raises `ValueError` if no entry condition has been set.

```python
results = k.run()
```

---

### `plot()`

Display an interactive chart in Jupyter with two subplots:
1. Price chart with entry/exit markers and trade connector lines
2. Equity curve with green/red shading

Must call `run()` first.

```python
k.plot()
```

---

### `export(name=None)`

Send the strategy definition and backtest results to the Ananke dashboard
backend via POST to `/api/strategies`.

| Parameter | Type | Description |
|---|---|---|
| `name` | `str` | Override the strategy name. Optional. |

Must call `run()` first. Requires Docker to be running.

```python
k.export('rsi_mean_reversion')
# Kairos 'rsi_mean_reversion' exported successfully ✓
```

---

## Results Class

Returned by `Kairos.run()`. Displays a formatted summary table automatically
when it is the last expression in a Jupyter cell.

---

### Fields

| Field | Type | Description |
|---|---|---|
| `total_trades` | `int` | Total number of closed trades |
| `winning_trades` | `int` | Trades where PnL > 0 |
| `losing_trades` | `int` | Trades where PnL ≤ 0 |
| `win_rate` | `float` | Winning trades as a percentage (0–100) |
| `total_pnl` | `float` | Sum of all trade PnL in dollars |
| `total_pnl_pct` | `float` | Cumulative return as a percentage |
| `avg_win` | `float` | Mean PnL of winning trades |
| `avg_loss` | `float` | Mean PnL of losing trades (negative) |
| `largest_win` | `float` | Highest single-trade PnL |
| `largest_loss` | `float` | Lowest single-trade PnL (most negative) |
| `profit_factor` | `float` | abs(sum wins) / abs(sum losses). `inf` if no losses. |
| `max_drawdown` | `float` | Peak-to-trough equity drop as a percentage |
| `sharpe_ratio` | `float` | Annualised Sharpe ratio (risk-free rate = 0) |
| `avg_trade_duration` | `str` | Mean time in a trade, e.g. `"1h 23m"` |
| `trades` | `list` | All `Trade` objects from the backtest |
| `equity` | `list` | `(datetime, cumulative_pnl)` tuples for every bar |

---

### `summary()`

Print the formatted results table. Called automatically by `__repr__` so it
appears in Jupyter when `results` is the last expression in a cell.

```
┌─────────────────────────────────────────┐
│         BACKTEST RESULTS SUMMARY         │
├──────────────────────┬──────────────────┤
│ Total Trades         │ 42               │
│ Win Rate             │ 66.67%           │
│ Total PnL            │ $284.50          │
│ Sharpe Ratio         │ 1.42             │
│ ...                  │ ...              │
└──────────────────────┴──────────────────┘
```

---

### `to_dict()`

Serialize all results to a JSON-compatible dictionary. Used by `Kairos.export()`
to send results to the backend.

```python
d = results.to_dict()
d['win_rate']      # 66.67
d['trades']        # list of trade dicts
d['equity_curve']  # list of {time, cumulative_pnl} dicts
```

---

## Kairos Examples

### Example 1: RSI Mean Reversion

Enter long when RSI is oversold and the short-term EMA is above the long-term
EMA (confirming upward momentum). Enter short on the reverse.

```python
from ananke import Kairos
from ananke.indicators import rsi, ema

k = Kairos(df, name='rsi_mean_reversion')
rsi_vals = rsi(k.df['close'], period=14)
fast_ema = ema(k.df['close'], period=9)
slow_ema = ema(k.df['close'], period=21)

k.enter_long(condition=(rsi_vals < 30) & (fast_ema > slow_ema))
k.enter_short(condition=(rsi_vals > 70) & (fast_ema < slow_ema))
k.exit_trade(stop_loss=0.02, take_profit=0.05)

results = k.run()
k.plot()
k.export()
```

---

### Example 2: Moving Average Crossover

Enter on the exact bar the fast SMA crosses above or below the slow SMA.

```python
from ananke import Kairos
from ananke.indicators import sma

k = Kairos(df, name='ma_crossover')
fast = sma(k.df['close'], 10)
slow = sma(k.df['close'], 50)

k.enter_long(condition=(fast > slow) & (fast.shift(1) <= slow.shift(1)))
k.enter_short(condition=(fast < slow) & (fast.shift(1) >= slow.shift(1)))
k.exit_trade(stop_loss=0.03, take_profit=0.06)

results = k.run()
k.export('ma_crossover')
```

---

### Example 3: Bollinger Band Squeeze

Enter long when price touches the lower band and RSI confirms oversold.
Exit when price reaches the upper band or RSI turns overbought.

```python
from ananke import Kairos
from ananke.indicators import bollinger, rsi

k = Kairos(df, name='bollinger_rsi')
bands    = bollinger(k.df['close'], period=20, std=2)
rsi_vals = rsi(k.df['close'], period=14)

k.enter_long(
    condition=(k.df['close'] <= bands['lower']) & (rsi_vals < 35)
)
k.exit_trade(
    condition=(k.df['close'] >= bands['upper']) | (rsi_vals > 65),
    stop_loss=0.02,
)

results = k.run()
results.summary()
k.plot()
k.export()
```

---

## Configuration

```bash
# Override the backend URL (default: http://localhost:8080)
export ANANKE_API_URL=http://your-server:8080

# Override the database URL (default: localhost:5432)
export TIMESCALE_URL=postgresql+psycopg2://user:pass@host:5432/stockdb
```

---

## Performance Notes

- All indicators use pandas vectorized operations — fast even on large DataFrames
- The backtest runs bar by bar in Python — for DataFrames over 100,000 rows
  consider filtering to a tighter date range first
- Entry is always executed at the **open of the next bar** after the signal fires,
  avoiding look-ahead bias
