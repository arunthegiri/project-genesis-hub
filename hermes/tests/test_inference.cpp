// Verifies ONNXModel loads test_model.onnx and runs inference. Runs a hardcoded
// 5-feature vector, prints SHORT / NEUTRAL / LONG probabilities, and confirms
// they sum to 1.0.

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#include "config/EngineConfig.hpp"
#include "inference/ONNXModel.hpp"

using hermes::EngineConfig;
using hermes::ONNXModel;
using hermes::Prediction;

int main(int argc, char* argv[]) {
    const std::string model_path =
        argc > 1 ? argv[1] : "tests/test_model.onnx";
    const std::string contract_path =
        argc > 2 ? argv[2] : "tests/test_contract.json";

    EngineConfig config;
    try {
        config = EngineConfig::fromFile(contract_path);
        config.validate();
    } catch (const std::exception& e) {
        std::fprintf(stderr, "contract error: %s\n", e.what());
        return 2;
    }

    ONNXModel model(model_path, config);
    if (!model.isLoaded()) {
        std::fprintf(stderr, "model failed to load: %s\n", model_path.c_str());
        return 2;
    }

    const std::vector<float> features = {45.0f, 125.0f, 124.0f, 1.2f, 0.0f};
    const Prediction pred = model.predict(features);

    std::printf("Inference on [45.0, 125.0, 124.0, 1.2, 0.0]:\n");
    std::printf("  SHORT   = %.6f\n", pred.prob_short);
    std::printf("  NEUTRAL = %.6f\n", pred.prob_neutral);
    std::printf("  LONG    = %.6f\n", pred.prob_long);
    std::printf("  confidence = %.6f\n", pred.confidence);
    std::printf("  signal     = %s\n", hermes::signalName(pred.signal));

    const float sum = pred.prob_short + pred.prob_neutral + pred.prob_long;
    std::printf("  sum = %.6f\n", sum);

    if (std::fabs(sum - 1.0f) > 1e-4f) {
        std::printf("FAILED: probabilities do not sum to 1.0 (sum=%.6f)\n", sum);
        return 1;
    }
    std::printf("PASSED: probabilities sum to 1.0\n");
    return 0;
}
