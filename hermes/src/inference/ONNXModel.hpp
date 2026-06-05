#pragma once

#include <memory>
#include <string>
#include <vector>

#include <onnxruntime_cxx_api.h>

#include "config/EngineConfig.hpp"

namespace hermes {

enum class Signal { BUY, SELL, HOLD };

struct Prediction {
    Signal signal       = Signal::HOLD;
    float  confidence   = 0.0f;   // max class probability
    float  prob_long    = 0.0f;
    float  prob_short   = 0.0f;
    float  prob_neutral = 0.0f;
};

// Human-readable name for a signal (logging / status).
const char* signalName(Signal s);

// Wraps the ONNX Runtime C++ API for a single classifier model whose output
// is per-class probabilities ordered per config.output_classes.
class ONNXModel {
public:
    ONNXModel(const std::string& model_path, const EngineConfig& config);

    // Run inference on a feature vector. `features` must be in the exact order
    // of config.features. Throws std::runtime_error on size mismatch.
    Prediction predict(const std::vector<float>& features);

    bool isLoaded() const;

private:
    Ort::Env                      env_;
    Ort::SessionOptions           session_options_;
    std::unique_ptr<Ort::Session> session_;
    EngineConfig                  config_;

    // Backing storage keeps the c_str() pointers in *_names_ alive.
    std::vector<std::string>      input_name_storage_;
    std::vector<std::string>      output_name_storage_;
    std::vector<const char*>      input_names_;
    std::vector<const char*>      output_names_;
    std::vector<int64_t>          input_shape_;
    int                           prob_output_index_ = 0;  // "probabilities"

    // Map a class index to a Signal using config.output_classes
    // (e.g. "LONG" -> BUY, "SHORT" -> SELL, "NEUTRAL" -> HOLD).
    Signal indexToSignal(int idx, float confidence);

    // Apply config.buy_threshold / sell_threshold to the long/short probs.
    Signal applyThresholds(float prob_long, float prob_short);
};

}  // namespace hermes
