package com.stocktracker.model;

import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;

public class StockPriceId implements Serializable {

    private Instant time;
    private String symbol;

    public StockPriceId() {}

    public StockPriceId(Instant time, String symbol) {
        this.time   = time;
        this.symbol = symbol;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof StockPriceId that)) return false;
        return Objects.equals(time, that.time) && Objects.equals(symbol, that.symbol);
    }

    @Override
    public int hashCode() {
        return Objects.hash(time, symbol);
    }
}
