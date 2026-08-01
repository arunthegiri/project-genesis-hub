package com.stocktracker.controller;

import com.stocktracker.dto.ApiDto;
import com.stocktracker.dto.ModelDto;
import com.stocktracker.service.ModelService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * /models registry — a projection over strategies + backtest_results (see ModelService).
 *
 * Endpoints:
 *   GET    /api/models                              list registered models (+ key metrics)
 *   GET    /api/models/{name}/versions              all versions of a model name
 *   GET    /api/models/{name}/{version}             detail (metrics, feature count, contract)
 *   GET    /api/models/{name}/{version}/performance backtest/validation metrics
 *   POST   /api/models/{name}/{version}/deploy      deploy a version (paper/live)
 *   DELETE /api/models/{name}/{version}             archive a version (SOFT-delete)
 */
@RestController
@RequestMapping("/api/models")
public class ModelController {

    private final ModelService modelService;

    public ModelController(ModelService modelService) {
        this.modelService = modelService;
    }

    @GetMapping
    public ApiDto.PagedResponse<ModelDto.ModelSummary> list() {
        return new ApiDto.PagedResponse<>(modelService.listModels());
    }

    @GetMapping("/{name}/versions")
    public ApiDto.PagedResponse<ModelDto.ModelSummary> versions(@PathVariable String name) {
        return new ApiDto.PagedResponse<>(modelService.listVersions(name));
    }

    @GetMapping("/{name}/{version}")
    public ModelDto.ModelDetail detail(@PathVariable String name,
                                       @PathVariable String version) {
        return modelService.getModel(name, version);
    }

    @GetMapping("/{name}/{version}/performance")
    public ResponseEntity<ModelDto.PerformanceMetrics> performance(@PathVariable String name,
                                                                   @PathVariable String version) {
        ModelDto.PerformanceMetrics metrics = modelService.getPerformance(name, version);
        return metrics != null ? ResponseEntity.ok(metrics) : ResponseEntity.noContent().build();
    }

    @PostMapping("/{name}/{version}/deploy")
    public ModelDto.ModelDetail deploy(@PathVariable String name,
                                       @PathVariable String version,
                                       @Valid @RequestBody ModelDto.DeployRequest req) {
        return modelService.deploy(name, version, req.getMode());
    }

    @DeleteMapping("/{name}/{version}")
    public ModelDto.ModelDetail archive(@PathVariable String name,
                                        @PathVariable String version) {
        return modelService.archive(name, version);
    }
}
