package com.stocktracker.controller;

import com.stocktracker.dto.ApiDto;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;

import java.util.NoSuchElementException;
import java.util.stream.Collectors;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiDto.ErrorResponse> handleValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .collect(Collectors.joining(", "));
        return ResponseEntity
                .badRequest()
                .body(new ApiDto.ErrorResponse(message, 400));
    }

    @ExceptionHandler(HttpClientErrorException.class)
    public ResponseEntity<ApiDto.ErrorResponse> handleAlpacaClientError(HttpClientErrorException ex) {
        log.error("Alpaca API client error: {} {}", ex.getStatusCode(), ex.getMessage());
        return ResponseEntity
                .status(ex.getStatusCode())
                .body(new ApiDto.ErrorResponse("Alpaca API error: " + ex.getMessage(),
                        ex.getStatusCode().value()));
    }

    @ExceptionHandler(HttpServerErrorException.class)
    public ResponseEntity<ApiDto.ErrorResponse> handleAlpacaServerError(HttpServerErrorException ex) {
        log.error("Alpaca API server error: {}", ex.getMessage());
        return ResponseEntity
                .status(HttpStatus.BAD_GATEWAY)
                .body(new ApiDto.ErrorResponse("Upstream Alpaca API error", 502));
    }

    @ExceptionHandler(NoSuchElementException.class)
    public ResponseEntity<ApiDto.ErrorResponse> handleNotFound(NoSuchElementException ex) {
        return ResponseEntity
                .status(HttpStatus.NOT_FOUND)
                .body(new ApiDto.ErrorResponse(ex.getMessage(), 404));
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<ApiDto.ErrorResponse> handleIllegalState(IllegalStateException ex) {
        return ResponseEntity
                .status(HttpStatus.CONFLICT)
                .body(new ApiDto.ErrorResponse(ex.getMessage(), 409));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiDto.ErrorResponse> handleIllegalArg(IllegalArgumentException ex) {
        return ResponseEntity
                .badRequest()
                .body(new ApiDto.ErrorResponse(ex.getMessage(), 400));
    }

    @ExceptionHandler(UnsupportedOperationException.class)
    public ResponseEntity<ApiDto.ErrorResponse> handleUnsupported(UnsupportedOperationException ex) {
        log.warn("Strategy cannot be re-run: {}", ex.getMessage());
        return ResponseEntity
                .unprocessableEntity()
                .body(new ApiDto.ErrorResponse(ex.getMessage(), 422));
    }

    @ExceptionHandler(com.stocktracker.service.KimiClient.KimiUnavailableException.class)
    public ResponseEntity<ApiDto.ErrorResponse> handleCopilotUnavailable(
            com.stocktracker.service.KimiClient.KimiUnavailableException ex) {
        log.warn("Copilot unavailable: {}", ex.getMessage());
        return ResponseEntity
                .status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(new ApiDto.ErrorResponse(ex.getMessage(), 503));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiDto.ErrorResponse> handleGeneric(Exception ex) {
        log.error("Unhandled exception: {}", ex.getMessage(), ex);
        String detail = ex.getMessage() != null ? ex.getMessage() : ex.getClass().getSimpleName();
        return ResponseEntity
                .internalServerError()
                .body(new ApiDto.ErrorResponse("Internal server error: " + detail, 500));
    }
}
