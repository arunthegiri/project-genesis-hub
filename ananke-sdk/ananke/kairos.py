"""
Kairos class for the Ananke SDK.

This is the primary class users interact with in Jupyter notebooks. It accepts
an OHLCV DataFrame and a set of entry/exit conditions, runs a bar-by-bar
backtest, and can visualise and export results to the Ananke dashboard.
"""

import time
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec

from .trade import Trade


class Kairos:
    """
    Bar-by-bar backtesting engine for the Ananke Quant Trading Platform.

    Kairos runs a realistic simulation over historical OHLCV data using
    signals you define with pandas boolean Series. Entries are executed at
    the open of the bar *after* the signal fires, avoiding look-ahead bias.

    Parameters
    ----------
    df : pd.DataFrame
        OHLCV DataFrame with columns: open, high, low, close, volume.
        The datetime index (or a 'time' column) is used for bar ordering.
        If 'time' is a column rather than the index it is promoted automatically.
        The DataFrame is sorted ascending by time internally.
    name : str, optional
        A label for this strategy. If omitted, defaults to
        'kairos_{unix_timestamp}'.

    Example
    -------
    >>> from ananke import Kairos
    >>> from ananke.indicators import rsi, sma
    >>>
    >>> k = Kairos(df, name='rsi_reversion')
    >>>
    >>> rsi_vals = rsi(df['close'], period=14)
    >>> k.enter_long(condition=rsi_vals < 30)
    >>> k.enter_short(condition=rsi_vals > 70)
    >>> k.exit_trade(stop_loss=0.02, take_profit=0.05)
    >>> k.set_quantity(10)
    >>>
    >>> results = k.run()
    >>> results          # displays summary table in Jupyter
    >>> k.plot()         # price chart + equity curve
    >>> k.export()       # send to dashboard
    """

    def __init__(self, df, name=None):
        df = df.copy()
        if 'time' in df.columns:
            df = df.set_index('time')
        df = df.sort_index()

        self.df = df
        self.name = name or f'kairos_{int(time.time())}'
        self._entry_long = None
        self._entry_short = None
        self._exit_cond = None
        self._stop_loss = None
        self._take_profit = None
        self._quantity = 1.0
        self._results = None
        self._trades = []
        self._equity = []

    # ── condition helpers ────────────────────────────────────────────────────

    def _validate_condition(self, condition, label):
        """Raise ValueError if condition is not a boolean Series aligned to df."""
        if not isinstance(condition, pd.Series):
            raise ValueError(
                f"{label} must be a pandas Series, got {type(condition).__name__}."
            )
        if not condition.index.equals(self.df.index):
            raise ValueError(
                f"{label} index does not match the DataFrame index. "
                "Compute the condition from the same df passed to Kairos()."
            )

    # ── public API ───────────────────────────────────────────────────────────

    def enter_long(self, condition):
        """
        Define the condition to enter a long (buy) position.

        When the condition is True at bar N the strategy enters a long trade
        at the open price of bar N+1, simulating realistic execution — you
        cannot trade on the close of the bar that generated the signal.

        Parameters
        ----------
        condition : pd.Series of bool
            A boolean Series aligned to df.index.

        Returns
        -------
        None

        Raises
        ------
        ValueError
            If condition is not a pandas Series or its index does not match
            the DataFrame index.

        Example
        -------
        >>> from ananke.indicators import rsi
        >>> rsi_vals = rsi(df['close'], 14)
        >>> k.enter_long(condition=rsi_vals < 30)
        """
        self._validate_condition(condition, 'enter_long condition')
        self._entry_long = condition

    def enter_short(self, condition):
        """
        Define the condition to enter a short (sell) position.

        When the condition is True at bar N the strategy enters a short trade
        at the open price of bar N+1.

        Parameters
        ----------
        condition : pd.Series of bool
            A boolean Series aligned to df.index.

        Returns
        -------
        None

        Raises
        ------
        ValueError
            If condition is not a pandas Series or its index does not match
            the DataFrame index.

        Example
        -------
        >>> from ananke.indicators import rsi
        >>> rsi_vals = rsi(df['close'], 14)
        >>> k.enter_short(condition=rsi_vals > 70)
        """
        self._validate_condition(condition, 'enter_short condition')
        self._entry_short = condition

    def exit_trade(self, condition=None, stop_loss=None, take_profit=None):
        """
        Define the conditions to exit an open trade.

        At least one of condition, stop_loss, or take_profit must be provided.
        All three can be combined — whichever triggers first at any bar closes
        the trade. Stop loss and take profit are evaluated against the bar's
        close price.

        Parameters
        ----------
        condition : pd.Series of bool, optional
            A boolean Series aligned to df.index. The trade is closed at the
            bar's close price when this is True.
        stop_loss : float, optional
            Exit if the position moves against you by this fraction.
            Example: 0.02 exits if the trade is down 2%.
            Long:  exit if close < entry_price * (1 - stop_loss)
            Short: exit if close > entry_price * (1 + stop_loss)
        take_profit : float, optional
            Exit if the position moves in your favour by this fraction.
            Example: 0.05 exits if the trade is up 5%.
            Long:  exit if close > entry_price * (1 + take_profit)
            Short: exit if close < entry_price * (1 - take_profit)

        Returns
        -------
        None

        Raises
        ------
        ValueError
            If none of the three parameters are provided, or if condition is
            not a valid boolean Series aligned to df.index.

        Example
        -------
        >>> k.exit_trade(
        ...     condition=rsi_vals > 65,
        ...     stop_loss=0.02,
        ...     take_profit=0.05,
        ... )
        """
        if condition is None and stop_loss is None and take_profit is None:
            raise ValueError(
                "exit_trade() requires at least one of: condition, stop_loss, take_profit."
            )
        if condition is not None:
            self._validate_condition(condition, 'exit_trade condition')
        self._exit_cond = condition
        self._stop_loss = stop_loss
        self._take_profit = take_profit

    def set_quantity(self, qty):
        """
        Set the number of shares or contracts per trade.

        Applied to every trade opened after this call. Default is 1.0.

        Parameters
        ----------
        qty : float
            Number of shares or contracts. Must be greater than zero.

        Returns
        -------
        None

        Raises
        ------
        ValueError
            If qty is not greater than zero.

        Example
        -------
        >>> k.set_quantity(10)   # trade 10 shares at a time
        >>> k.set_quantity(0.5)  # half a contract (futures/crypto)
        """
        if qty <= 0:
            raise ValueError(f"quantity must be > 0, got {qty}.")
        self._quantity = qty

    def run(self):
        """
        Execute the backtest bar by bar through the DataFrame.

        Iterates every bar in the DataFrame, checking exit conditions on open
        trades and entry conditions when flat. Entry is always on the open of
        the next bar after the signal fires. Stop loss and take profit are
        evaluated at each bar's close price.

        If both a long and short entry signal fire on the same bar, the long
        entry takes priority.

        Returns
        -------
        Results
            A Results object containing all closed trade records and computed
            performance statistics. Also stored internally as self._results.

        Raises
        ------
        ValueError
            If neither enter_long() nor enter_short() has been called before
            run().
        RuntimeError
            If results.py (Part 3) has not been built yet.

        Example
        -------
        >>> results = k.run()
        >>> print(f"Total trades: {results.total_trades}")
        >>> print(f"Win rate:     {results.win_rate:.1f}%")
        """
        if self._entry_long is None and self._entry_short is None:
            raise ValueError(
                "No entry condition set. Call enter_long() or enter_short() before run()."
            )

        from .results import Results

        rows = list(self.df.itertuples())
        trades = []
        open_trade = None
        equity = []

        for i, current_bar in enumerate(rows):
            next_bar = rows[i + 1] if i < len(rows) - 1 else None

            # ── A. Manage open trade ─────────────────────────────────────────
            if open_trade is not None:
                closed = False

                # Stop loss
                if not closed and self._stop_loss is not None:
                    if open_trade.direction == 'long':
                        sl_hit = current_bar.close < open_trade.entry_price * (1 - self._stop_loss)
                    else:
                        sl_hit = current_bar.close > open_trade.entry_price * (1 + self._stop_loss)
                    if sl_hit:
                        open_trade.close(current_bar.Index, current_bar.close)
                        trades.append(open_trade)
                        open_trade = None
                        closed = True

                # Take profit
                if not closed and self._take_profit is not None:
                    if open_trade.direction == 'long':
                        tp_hit = current_bar.close > open_trade.entry_price * (1 + self._take_profit)
                    else:
                        tp_hit = current_bar.close < open_trade.entry_price * (1 - self._take_profit)
                    if tp_hit:
                        open_trade.close(current_bar.Index, current_bar.close)
                        trades.append(open_trade)
                        open_trade = None
                        closed = True

                # Exit condition
                if not closed and self._exit_cond is not None:
                    if self._exit_cond.iloc[i]:
                        open_trade.close(current_bar.Index, current_bar.close)
                        trades.append(open_trade)
                        open_trade = None
                        closed = True

                # Last bar — force close
                if not closed and next_bar is None:
                    open_trade.close(current_bar.Index, current_bar.close)
                    trades.append(open_trade)
                    open_trade = None

            # ── B. Check for new entry ───────────────────────────────────────
            elif next_bar is not None:
                if self._entry_long is not None and self._entry_long.iloc[i]:
                    open_trade = Trade(
                        direction='long',
                        entry_time=next_bar.Index,
                        entry_price=getattr(next_bar, 'open'),
                        quantity=self._quantity,
                        stop_loss=self._stop_loss,
                        take_profit=self._take_profit,
                    )
                elif self._entry_short is not None and self._entry_short.iloc[i]:
                    open_trade = Trade(
                        direction='short',
                        entry_time=next_bar.Index,
                        entry_price=getattr(next_bar, 'open'),
                        quantity=self._quantity,
                        stop_loss=self._stop_loss,
                        take_profit=self._take_profit,
                    )

            # ── C. Track equity ──────────────────────────────────────────────
            cumulative_pnl = sum(t.pnl for t in trades)
            equity.append((current_bar.Index, cumulative_pnl))

        self._trades = trades
        self._equity = equity
        self._results = Results(trades=trades, equity=equity, df=self.df)
        return self._results

    def export(self, name=None):
        """
        Export the strategy definition and backtest results to the dashboard.

        Sends a POST request to the Ananke backend at
        http://localhost:8080/api/strategies (or the URL set by the
        ANANKE_API_URL environment variable). After export, the strategy
        appears in the dashboard dropdown.

        Parameters
        ----------
        name : str, optional
            Override the strategy name. If not provided, uses the name
            set in the constructor.

        Returns
        -------
        dict
            The server response containing the saved strategy id and name.

        Raises
        ------
        RuntimeError
            If run() has not been called before export().
        ConnectionError
            If the Ananke backend is not reachable.
        ValueError
            If the backend returns a non-2xx status code.

        Example
        -------
        >>> k.export('rsi_mean_reversion')
        Kairos 'rsi_mean_reversion' exported successfully ✓
        """
        if self._results is None:
            raise RuntimeError(
                "No results to export. Call run() before export()."
            )
        if name is not None:
            self.name = name

        from . import client

        payload = {
            'name': self.name,
            'definition': {
                'has_long_entry': self._entry_long is not None,
                'has_short_entry': self._entry_short is not None,
                'stop_loss': self._stop_loss,
                'take_profit': self._take_profit,
                'quantity': self._quantity,
            },
            'results': self._results.to_dict(),
            'symbol': self.df['symbol'].iloc[0] if 'symbol' in self.df.columns else None,
            'from_ts': str(self.df.index[0]),
            'to_ts': str(self.df.index[-1]),
            'interval': '1Min',
        }

        response = client.post_strategy(payload)
        print(f"Kairos '{self.name}' exported successfully ✓")
        return response

    def plot(self):
        """
        Plot the backtest results as an interactive chart in Jupyter.

        Generates two stacked subplots:
        1. Price chart (70% height) — close price with entry and exit markers
           and lines connecting each trade's entry to its exit.
        2. Equity curve (30% height) — cumulative PnL over time with a
           zero baseline and green/red shading.

        Marker legend:
            Long entry:  green upward triangle (^)
            Short entry: red downward triangle (v)
            Winning exit: green circle (o)
            Losing exit:  red circle (o)

        Returns
        -------
        None

        Raises
        ------
        RuntimeError
            If run() has not been called before plot().

        Example
        -------
        >>> k.run()
        >>> k.plot()
        """
        if self._results is None:
            raise RuntimeError("Call run() before plot().")

        fig = plt.figure(figsize=(14, 8))
        gs = gridspec.GridSpec(2, 1, figure=fig, height_ratios=[0.7, 0.3], hspace=0.08)
        ax1 = fig.add_subplot(gs[0])
        ax2 = fig.add_subplot(gs[1], sharex=ax1)

        # ── Price line ───────────────────────────────────────────────────────
        ax1.plot(self.df.index, self.df['close'],
                 color='#444444', linewidth=0.8, label='Close', zorder=1)

        # ── Trade markers and connector lines ────────────────────────────────
        for trade in self._trades:
            color = 'green' if trade.win else 'red'

            # Entry marker
            marker = '^' if trade.direction == 'long' else 'v'
            entry_color = 'green' if trade.direction == 'long' else 'red'
            ax1.scatter(trade.entry_time, trade.entry_price,
                        marker=marker, color=entry_color, s=90, zorder=4)

            # Exit marker + connector line
            if trade.exit_time is not None and trade.exit_price is not None:
                ax1.scatter(trade.exit_time, trade.exit_price,
                            marker='o', color=color, s=60, zorder=4)
                ax1.plot(
                    [trade.entry_time, trade.exit_time],
                    [trade.entry_price, trade.exit_price],
                    color=color, linewidth=0.9, alpha=0.45, zorder=2,
                )

        win_rate = self._results.win_rate
        total_return = self._results.total_pnl_pct
        ax1.set_title(
            f"{self.name}   |   Win Rate: {win_rate:.1f}%   |   Total Return: {total_return:.2f}%",
            fontsize=11,
        )
        ax1.set_ylabel('Price')
        ax1.legend(loc='upper left', fontsize=9)
        plt.setp(ax1.get_xticklabels(), visible=False)

        # ── Equity curve ─────────────────────────────────────────────────────
        if self._equity:
            times, pnl_vals = zip(*self._equity)
            ax2.plot(times, pnl_vals, color='steelblue', linewidth=1.0)
            ax2.axhline(0, color='gray', linewidth=0.5, linestyle='--')
            ax2.fill_between(times, pnl_vals, 0,
                             where=[p >= 0 for p in pnl_vals],
                             color='green', alpha=0.18)
            ax2.fill_between(times, pnl_vals, 0,
                             where=[p < 0 for p in pnl_vals],
                             color='red', alpha=0.18)

        ax2.set_ylabel('Cumulative PnL ($)')
        ax2.set_xlabel('Time')

        plt.tight_layout()
        plt.show()
