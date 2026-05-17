"""
Trade class for the Ananke SDK.

Represents a single trade (entry + exit) produced by a Kairos backtest.
Every time a position is opened or closed, a Trade object is created or
updated. This is the foundational data unit that Results and the dashboard
both consume.
"""

import uuid
from datetime import datetime


class Trade:
    """
    A single trade in a backtest — one entry and one exit.

    Created when Kairos enters a position and finalized by calling close()
    when the position exits. Before close() is called, pnl, pnl_pct, and
    win are all None.

    Parameters
    ----------
    direction : str
        'long' for a buy position, 'short' for a sell position.
    entry_time : datetime
        Timestamp of the bar at which the position was entered.
        This is the open of the bar *after* the signal fired.
    entry_price : float
        Open price of the entry bar.
    quantity : float, optional
        Number of shares or contracts. Default is 1.0.
    stop_loss : float, optional
        Decimal stop-loss threshold. 0.02 means exit if the trade
        moves 2% against you. Default is None (no stop loss).
    take_profit : float, optional
        Decimal take-profit threshold. 0.05 means exit if the trade
        moves 5% in your favour. Default is None (no take profit).

    Example
    -------
    >>> from datetime import datetime
    >>> from ananke.trade import Trade
    >>> t = Trade(
    ...     direction='long',
    ...     entry_time=datetime(2026, 5, 12, 9, 31),
    ...     entry_price=100.0,
    ...     stop_loss=0.02,
    ...     take_profit=0.05,
    ... )
    >>> t.close(exit_time=datetime(2026, 5, 12, 10, 15), exit_price=105.0)
    >>> t.pnl
    5.0
    >>> t.win
    True
    """

    def __init__(self, direction, entry_time, entry_price,
                 quantity=1.0, stop_loss=None, take_profit=None):
        self.trade_id = str(uuid.uuid4())
        self.direction = direction
        self.entry_time = entry_time
        self.entry_price = entry_price
        self.exit_time = None
        self.exit_price = None
        self.quantity = quantity
        self.stop_loss = stop_loss
        self.take_profit = take_profit
        self.status = 'open'
        self.pnl = None
        self.pnl_pct = None
        self.win = None

    def close(self, exit_time, exit_price):
        """
        Close the trade and compute profit/loss.

        Sets exit_time and exit_price, calculates pnl and pnl_pct according
        to the trade direction, sets win, and marks status as 'closed'.

        PnL formulas:
            long:  pnl = (exit_price - entry_price) * quantity
            short: pnl = (entry_price - exit_price) * quantity

        pnl_pct formulas:
            long:  ((exit_price - entry_price) / entry_price) * 100
            short: ((entry_price - exit_price) / entry_price) * 100

        Parameters
        ----------
        exit_time : datetime
            Timestamp of the bar at which the position is closed.
        exit_price : float
            Price at which the position is exited (typically bar close
            for stop/take-profit hits, or bar open for signal-based exits).

        Returns
        -------
        None

        Raises
        ------
        RuntimeError
            If close() is called on an already-closed trade.

        Example
        -------
        >>> t.close(exit_time=datetime(2026, 5, 12, 10, 15), exit_price=105.0)
        >>> t.status
        'closed'
        >>> t.pnl
        5.0
        """
        if self.status == 'closed':
            raise RuntimeError(
                f"Trade {self.trade_id} is already closed. Cannot close twice."
            )

        self.exit_time = exit_time
        self.exit_price = exit_price

        if self.direction == 'long':
            self.pnl = (exit_price - self.entry_price) * self.quantity
            self.pnl_pct = ((exit_price - self.entry_price) / self.entry_price) * 100
        else:
            self.pnl = (self.entry_price - exit_price) * self.quantity
            self.pnl_pct = ((self.entry_price - exit_price) / self.entry_price) * 100

        self.win = self.pnl > 0
        self.status = 'closed'

    def to_dict(self):
        """
        Serialize the trade to a JSON-compatible dictionary.

        Datetime fields are converted to ISO 8601 strings. All other fields
        are returned as-is (None values are preserved as Python None, which
        serializes to JSON null).

        Returns
        -------
        dict
            All trade fields as a JSON-serializable dictionary.

        Example
        -------
        >>> import json
        >>> print(json.dumps(t.to_dict(), indent=2))
        {
          "trade_id": "abc123...",
          "direction": "long",
          "entry_time": "2026-05-12T09:31:00",
          "entry_price": 100.0,
          "exit_time": "2026-05-12T10:15:00",
          "exit_price": 105.0,
          "quantity": 1.0,
          "stop_loss": 0.02,
          "take_profit": 0.05,
          "status": "closed",
          "pnl": 5.0,
          "pnl_pct": 5.0,
          "win": true
        }
        """
        return {
            'trade_id': self.trade_id,
            'direction': self.direction,
            'entry_time': self.entry_time.isoformat() if self.entry_time else None,
            'entry_price': self.entry_price,
            'exit_time': self.exit_time.isoformat() if self.exit_time else None,
            'exit_price': self.exit_price,
            'quantity': self.quantity,
            'stop_loss': self.stop_loss,
            'take_profit': self.take_profit,
            'status': self.status,
            'pnl': self.pnl,
            'pnl_pct': self.pnl_pct,
            'win': self.win,
        }
