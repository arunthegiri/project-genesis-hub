"""
Results class for the Ananke SDK.

Returned by Kairos.run(). Computes all backtest performance statistics on
construction and displays a formatted summary table automatically when it
is the last expression in a Jupyter cell.
"""

import math
from datetime import timedelta


# Table column widths — matches the spec layout exactly
_LEFT = 22
_RIGHT = 18
_INNER = _LEFT + 1 + _RIGHT  # 41


def _row(label, value):
    """Format a single table row."""
    left = f" {label}".ljust(_LEFT)
    right = f" {value}".ljust(_RIGHT)
    return f"│{left}│{right}│"


class Results:
    """
    Backtest performance report produced by Kairos.run().

    All statistics are computed immediately on construction from the list of
    closed Trade objects and the equity curve. Displaying a Results object
    in a Jupyter cell (as the last expression) automatically prints the
    summary table via __repr__.

    Parameters
    ----------
    trades : list of Trade
        All closed trades produced by the backtest.
    equity : list of tuple
        List of (datetime, float) pairs — cumulative PnL at every bar.
    df : pd.DataFrame
        The original OHLCV DataFrame used in the backtest. Stored for
        reference but not used in statistic calculations.

    Attributes
    ----------
    total_trades, winning_trades, losing_trades, win_rate,
    total_pnl, total_pnl_pct, avg_win, avg_loss,
    largest_win, largest_loss, profit_factor,
    max_drawdown, sharpe_ratio, avg_trade_duration

    Example
    -------
    >>> results = k.run()
    >>> results            # prints summary table in Jupyter
    >>> results.win_rate   # 66.67
    >>> results.to_dict()  # JSON-serialisable dict for the dashboard
    """

    def __init__(self, trades, equity, df):
        self.trades = trades
        self.equity = equity
        self.df = df

        # ── trade counts ────────────────────────────────────────────────────
        self.total_trades = len(trades)
        self.winning_trades = sum(1 for t in trades if t.win is True)
        self.losing_trades = sum(1 for t in trades if t.win is False)

        # ── win rate ────────────────────────────────────────────────────────
        self.win_rate = (
            (self.winning_trades / self.total_trades) * 100
            if self.total_trades > 0 else 0.0
        )

        # ── PnL totals ───────────────────────────────────────────────────────
        self.total_pnl = round(sum(t.pnl for t in trades), 4)
        self.total_pnl_pct = round(sum(t.pnl_pct for t in trades), 4)

        # ── averages ─────────────────────────────────────────────────────────
        wins = [t for t in trades if t.win is True]
        losses = [t for t in trades if t.win is False]

        self.avg_win = (
            sum(t.pnl for t in wins) / len(wins) if wins else 0.0
        )
        self.avg_loss = (
            sum(t.pnl for t in losses) / len(losses) if losses else 0.0
        )

        # ── extremes ─────────────────────────────────────────────────────────
        self.largest_win = max((t.pnl for t in trades), default=0.0)
        self.largest_loss = min((t.pnl for t in trades), default=0.0)

        # ── profit factor ────────────────────────────────────────────────────
        win_sum = sum(t.pnl for t in wins)
        loss_sum = abs(sum(t.pnl for t in losses))

        if losses and wins:
            self.profit_factor = win_sum / loss_sum
        elif wins and not losses:
            self.profit_factor = float('inf')
        else:
            self.profit_factor = 0.0

        # ── max drawdown ─────────────────────────────────────────────────────
        peak = 0.0
        max_dd = 0.0
        for _, eq_val in equity:
            if eq_val > peak:
                peak = eq_val
            drawdown = (peak - eq_val) / peak * 100 if peak > 0 else 0.0
            if drawdown > max_dd:
                max_dd = drawdown
        self.max_drawdown = max_dd

        # ── Sharpe ratio ─────────────────────────────────────────────────────
        if len(trades) >= 2:
            returns = [t.pnl_pct / 100 for t in trades]
            n = len(returns)
            mean_r = sum(returns) / n
            variance = sum((r - mean_r) ** 2 for r in returns) / (n - 1)
            std_r = math.sqrt(variance)
            self.sharpe_ratio = (
                (mean_r / std_r) * math.sqrt(252) if std_r > 0 else 0.0
            )
        else:
            self.sharpe_ratio = 0.0

        # ── average trade duration ────────────────────────────────────────────
        if trades:
            durations = [
                (t.exit_time - t.entry_time).total_seconds()
                for t in trades
                if t.exit_time is not None and t.entry_time is not None
            ]
            if durations:
                avg_secs = sum(durations) / len(durations)
                hours = int(avg_secs // 3600)
                minutes = int((avg_secs % 3600) // 60)
                self.avg_trade_duration = f"{hours}h {minutes}m"
            else:
                self.avg_trade_duration = "N/A"
        else:
            self.avg_trade_duration = "N/A"

    # ── display ──────────────────────────────────────────────────────────────

    def summary(self):
        """
        Print a formatted summary table of all backtest statistics.

        Called automatically by __repr__ so the table appears in Jupyter
        when Results is the last expression in a cell.

        Returns
        -------
        None

        Example
        -------
        ┌─────────────────────────────────────────┐
        │         BACKTEST RESULTS SUMMARY         │
        ├──────────────────────┬──────────────────┤
        │ Total Trades         │ 42               │
        │ Win Rate             │ 66.67%           │
        │ ...                                     │
        └──────────────────────┴──────────────────┘
        """
        pf = (
            "∞" if self.profit_factor == float('inf')
            else f"{self.profit_factor:.2f}"
        )

        rows = [
            ("Total Trades",       str(self.total_trades)),
            ("Winning Trades",     str(self.winning_trades)),
            ("Losing Trades",      str(self.losing_trades)),
            ("Win Rate",           f"{self.win_rate:.2f}%"),
            ("Total PnL",          f"${self.total_pnl:.2f}"),
            ("Total Return",       f"{self.total_pnl_pct:.2f}%"),
            ("Avg Win",            f"${self.avg_win:.2f}"),
            ("Avg Loss",           f"${self.avg_loss:.2f}"),
            ("Largest Win",        f"${self.largest_win:.2f}"),
            ("Largest Loss",       f"${self.largest_loss:.2f}"),
            ("Profit Factor",      pf),
            ("Max Drawdown",       f"{self.max_drawdown:.2f}%"),
            ("Sharpe Ratio",       f"{self.sharpe_ratio:.2f}"),
            ("Avg Trade Duration", self.avg_trade_duration),
        ]

        title = "BACKTEST RESULTS SUMMARY"
        print(f"┌{'─' * _INNER}┐")
        print(f"│{title.center(_INNER)}│")
        print(f"├{'─' * _LEFT}┬{'─' * _RIGHT}┤")
        for label, value in rows:
            print(_row(label, value))
        print(f"└{'─' * _LEFT}┴{'─' * _RIGHT}┘")

    def to_dict(self):
        """
        Serialize all results to a JSON-compatible dictionary.

        Used by Kairos.export() to send results to the backend. All values
        are JSON-serialisable (no datetime objects, no infinity — infinity
        is represented as None).

        Returns
        -------
        dict
            All statistics plus a 'trades' list and an 'equity_curve' list.

        Example
        -------
        >>> d = results.to_dict()
        >>> d['win_rate']
        66.67
        >>> len(d['trades'])
        42
        """
        return {
            'total_trades':        self.total_trades,
            'winning_trades':      self.winning_trades,
            'losing_trades':       self.losing_trades,
            'win_rate':            round(self.win_rate, 4),
            'total_pnl':           self.total_pnl,
            'total_pnl_pct':       self.total_pnl_pct,
            'avg_win':             round(self.avg_win, 4),
            'avg_loss':            round(self.avg_loss, 4),
            'largest_win':         round(self.largest_win, 4),
            'largest_loss':        round(self.largest_loss, 4),
            'profit_factor':       (
                None if self.profit_factor == float('inf')
                else round(self.profit_factor, 4)
            ),
            'max_drawdown':        round(self.max_drawdown, 4),
            'sharpe_ratio':        round(self.sharpe_ratio, 4),
            'avg_trade_duration':  self.avg_trade_duration,
            'trades': [t.to_dict() for t in self.trades],
            'equity_curve': [
                {'time': t.isoformat(), 'cumulative_pnl': pnl}
                for t, pnl in self.equity
            ],
        }

    def __repr__(self):
        self.summary()
        return ''

    def __str__(self):
        self.summary()
        return ''
