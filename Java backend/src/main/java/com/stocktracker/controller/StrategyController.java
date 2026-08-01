package com.stocktracker.controller;

import com.stocktracker.dto.ApiDto;
import com.stocktracker.service.StrategyService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/strategies")
public class StrategyController {

    private final StrategyService strategyService;

    public StrategyController(StrategyService strategyService) {
        this.strategyService = strategyService;
    }

    /**
     * POST /api/strategies
     * Called by s.export() from Jupyter. Saves the strategy and its backtest results.
     */
    @PostMapping
    public ResponseEntity<ApiDto.StrategyResponse> save(
            @Valid @RequestBody ApiDto.StrategyRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(strategyService.saveStrategy(req));
    }

    /**
     * GET /api/strategies
     * List all saved strategies for the dashboard dropdown.
     */
    @GetMapping
    public ApiDto.PagedResponse<ApiDto.StrategyResponse> list() {
        return new ApiDto.PagedResponse<>(strategyService.getAllStrategies());
    }

    /**
     * GET /api/strategies/{name}
     * Get full strategy with its latest backtest results.
     */
    @GetMapping("/{name}")
    public ApiDto.StrategyDetailResponse get(@PathVariable String name) {
        return strategyService.getStrategy(name);
    }

    /**
     * DELETE /api/strategies/{name}
     * Remove a strategy and all its backtest results.
     */
    @DeleteMapping("/{name}")
    public ResponseEntity<Void> delete(@PathVariable String name) {
        strategyService.deleteStrategy(name);
        return ResponseEntity.noContent().build();
    }

    /**
     * POST /api/strategies/{name}/run
     * Re-runs the strategy definition against a new symbol/date range.
     * Results are NOT saved — they are returned for live preview.
     */
    @PostMapping("/{name}/run")
    public ApiDto.BacktestResultResponse run(
            @PathVariable String name,
            @Valid @RequestBody ApiDto.RunBacktestRequest req) {
        return strategyService.runBacktest(name, req);
    }

    /**
     * GET /api/strategies/active
     * Returns strategies with status ACTIVE or STANDBY (deployed to trading engine).
     */
    @GetMapping("/active")
    public ApiDto.PagedResponse<ApiDto.StrategyResponse> active() {
        return new ApiDto.PagedResponse<>(strategyService.getActiveStrategies());
    }

    /**
     * GET /api/strategies/{name}/results
     * Get all backtest runs for a strategy (history across multiple exports).
     */
    @GetMapping("/{name}/results")
    public List<ApiDto.BacktestResultResponse> results(@PathVariable String name) {
        return strategyService.getBacktestResults(name);
    }

    /**
     * POST /api/strategies/{name}/deploy
     * Flips an EXPORTED strategy to ACTIVE with the given deploy mode
     * (paper/live), so it appears in the Live page Active Strategies table.
     */
    @PostMapping("/{name}/deploy")
    public ApiDto.StrategyResponse deploy(
            @PathVariable String name,
            @RequestBody DeployRequest req) {
        return strategyService.deployStrategy(name, req.mode());
    }

    /** Request body for POST /api/strategies/{name}/deploy */
    public record DeployRequest(String mode) {
    }
}
