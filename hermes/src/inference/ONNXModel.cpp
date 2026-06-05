#include "inference/ONNXModel.hpp"

#include <algorithm>
#include <stdexcept>

namespace hermes {

const char* signalName(Signal s) {
    switch (s) {
        case Signal::BUY:  return "BUY";
        case Signal::SELL: return "SELL";
        case Signal::HOLD: return "HOLD";
    }
    return "HOLD";
}

ONNXModel::ONNXModel(const std::string& model_path, const EngineConfig& config)
    : env_(ORT_LOGGING_LEVEL_WARNING, "hermes"),
      config_(config) {
    session_options_.SetIntraOpNumThreads(1);
    session_options_.SetGraphOptimizationLevel(
        GraphOptimizationLevel::ORT_ENABLE_ALL);

    // On non-Windows platforms ORTCHAR_T is char, so the path passes straight
    // through. Throws Ort::Exception (a std::exception) if the file is bad.
    session_ = std::make_unique<Ort::Session>(
        env_, model_path.c_str(), session_options_);

    Ort::AllocatorWithDefaultOptions allocator;

    // Cache input names.
    const size_t n_inputs = session_->GetInputCount();
    for (size_t i = 0; i < n_inputs; ++i) {
        auto name = session_->GetInputNameAllocated(i, allocator);
        input_name_storage_.emplace_back(name.get());
    }

    // Cache output names and locate the "probabilities" output (fall back to
    // the first float-typed output, else output 0).
    const size_t n_outputs = session_->GetOutputCount();
    int float_output = -1;
    for (size_t i = 0; i < n_outputs; ++i) {
        auto name = session_->GetOutputNameAllocated(i, allocator);
        output_name_storage_.emplace_back(name.get());

        auto info = session_->GetOutputTypeInfo(i);
        auto tensor_info = info.GetTensorTypeAndShapeInfo();
        if (tensor_info.GetElementType() ==
                ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT &&
            float_output < 0) {
            float_output = static_cast<int>(i);
        }
        if (output_name_storage_.back() == "probabilities") {
            prob_output_index_ = static_cast<int>(i);
            float_output = static_cast<int>(i);
        }
    }
    if (float_output >= 0) {
        prob_output_index_ = float_output;
    }

    // Build char* views now that the backing strings are final.
    for (const auto& s : input_name_storage_)  input_names_.push_back(s.c_str());
    for (const auto& s : output_name_storage_) output_names_.push_back(s.c_str());

    // Input shape: a single-sample batch sized to the feature count.
    input_shape_ = {1, static_cast<int64_t>(config_.features.size())};
}

bool ONNXModel::isLoaded() const {
    return session_ != nullptr;
}

Signal ONNXModel::indexToSignal(int idx, float /*confidence*/) {
    if (idx < 0 || idx >= static_cast<int>(config_.output_classes.size())) {
        return Signal::HOLD;
    }
    const std::string& c = config_.output_classes[idx];
    if (c == "LONG")  return Signal::BUY;
    if (c == "SHORT") return Signal::SELL;
    return Signal::HOLD;
}

Signal ONNXModel::applyThresholds(float prob_long, float prob_short) {
    const bool buy  = prob_long  >= config_.buy_threshold;
    const bool sell = prob_short >= config_.sell_threshold;
    if (buy && sell) return prob_long >= prob_short ? Signal::BUY : Signal::SELL;
    if (buy)  return Signal::BUY;
    if (sell) return Signal::SELL;
    return Signal::HOLD;
}

Prediction ONNXModel::predict(const std::vector<float>& features) {
    if (features.size() != config_.features.size()) {
        throw std::runtime_error(
            "ONNXModel::predict: expected " +
            std::to_string(config_.features.size()) + " features, got " +
            std::to_string(features.size()));
    }

    // CreateTensor needs a mutable, lifetime-stable buffer.
    std::vector<float> input_values = features;
    auto mem = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    Ort::Value input_tensor = Ort::Value::CreateTensor<float>(
        mem, input_values.data(), input_values.size(),
        input_shape_.data(), input_shape_.size());

    auto outputs = session_->Run(
        Ort::RunOptions{nullptr},
        input_names_.data(), &input_tensor, 1,
        output_names_.data(), output_names_.size());

    // Read the probabilities tensor.
    const Ort::Value& prob = outputs[prob_output_index_];
    const float* probs = prob.GetTensorData<float>();
    const size_t n = prob.GetTensorTypeAndShapeInfo().GetElementCount();

    Prediction pred;
    int   best_idx = 0;
    float best_p   = -1.0f;
    for (size_t i = 0; i < n && i < config_.output_classes.size(); ++i) {
        const float p = probs[i];
        const std::string& cls = config_.output_classes[i];
        if (cls == "LONG")    pred.prob_long = p;
        else if (cls == "SHORT")   pred.prob_short = p;
        else if (cls == "NEUTRAL") pred.prob_neutral = p;
        if (p > best_p) { best_p = p; best_idx = static_cast<int>(i); }
    }
    pred.confidence = best_p;

    // Final signal from configured thresholds; argmax->signal kept as the
    // natural-class reference (used when thresholds leave it ambiguous).
    Signal thresholded = applyThresholds(pred.prob_long, pred.prob_short);
    if (thresholded == Signal::HOLD) {
        // No threshold crossed — stay flat regardless of argmax in V1.
        (void)indexToSignal(best_idx, pred.confidence);
        pred.signal = Signal::HOLD;
    } else {
        pred.signal = thresholded;
    }
    return pred;
}

}  // namespace hermes
