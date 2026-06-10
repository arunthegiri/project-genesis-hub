#include "feed/MarketDataFeed.hpp"

#include <atomic>
#include <chrono>
#include <iostream>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include <nlohmann/json.hpp>
#include <websocketpp/client.hpp>
#include <websocketpp/config/asio_client.hpp>

#include "alpaca/AlpacaJson.hpp"

namespace hermes {

using nlohmann::json;
using namespace std::chrono_literals;

namespace {

using WsClient    = websocketpp::client<websocketpp::config::asio_tls_client>;
using ConnHdl     = websocketpp::connection_hdl;
using MessagePtr  = WsClient::message_ptr;
using SslContext  = websocketpp::lib::asio::ssl::context;
using ContextPtr  = websocketpp::lib::shared_ptr<SslContext>;

constexpr int kMaxBackoffSeconds = 60;

}  // namespace

struct MarketDataFeed::Impl {
    Impl(std::string key, std::string secret, std::string mode)
        : api_key_(std::move(key)),
          api_secret_(std::move(secret)),
          mode_(std::move(mode)) {}

    ~Impl() { stop(); }

    // ---- public-facing operations (called from MarketDataFeed) ------------

    void onBar(const std::string& symbol, BarCallback cb) {
        std::lock_guard<std::mutex> lk(cb_mutex_);
        callbacks_[symbol] = std::move(cb);
    }

    void start() {
        if (running_.exchange(true)) return;  // already running
        backoff_ = 1;
        thread_  = std::thread([this] { runLoop(); });
    }

    void stop() {
        if (!running_.exchange(false)) {
            if (thread_.joinable()) thread_.join();
            return;
        }
        {
            std::lock_guard<std::mutex> lk(client_mutex_);
            if (client_) client_->stop();  // unblocks WsClient::run()
        }
        if (thread_.joinable()) thread_.join();
    }

    bool isConnected() const { return connected_.load(); }

private:
    // ---- websocketpp lifecycle -------------------------------------------

    std::string streamUrl() const {
        return mode_ == "live"
                   ? "wss://stream.data.alpaca.markets/v2/sip"
                   : "wss://stream.data.alpaca.markets/v2/iex";
    }

    std::vector<std::string> subscribedSymbols() {
        std::lock_guard<std::mutex> lk(cb_mutex_);
        std::vector<std::string> syms;
        syms.reserve(callbacks_.size());
        for (const auto& [sym, _] : callbacks_) syms.push_back(sym);
        return syms;
    }

    ContextPtr onTlsInit(ConnHdl) {
        auto ctx = websocketpp::lib::make_shared<SslContext>(
            SslContext::tlsv12_client);
        try {
            ctx->set_options(SslContext::default_workarounds |
                             SslContext::no_sslv2 | SslContext::no_sslv3 |
                             SslContext::single_dh_use);
            // Verify Alpaca's certificate against the system trust store.
            ctx->set_default_verify_paths();
            ctx->set_verify_mode(websocketpp::lib::asio::ssl::verify_peer);
        } catch (const std::exception& e) {
            std::cerr << "[feed] TLS init error: " << e.what() << "\n";
        }
        return ctx;
    }

    void sendText(const std::string& payload) {
        std::lock_guard<std::mutex> lk(client_mutex_);
        if (!client_) return;
        websocketpp::lib::error_code ec;
        client_->send(hdl_, payload, websocketpp::frame::opcode::text, ec);
        if (ec) {
            std::cerr << "[feed] send failed: " << ec.message() << "\n";
        }
    }

    void onOpen(ConnHdl hdl) {
        {
            std::lock_guard<std::mutex> lk(client_mutex_);
            hdl_ = hdl;
        }
        backoff_ = 1;  // healthy connection — reset reconnect backoff
        std::cout << "[feed] connected to " << streamUrl() << "\n";
        // Alpaca expects auth immediately after the connect handshake.
        const json auth = {{"action", "auth"},
                           {"key", api_key_},
                           {"secret", api_secret_}};
        sendText(auth.dump());
    }

    void sendSubscribe() {
        const auto syms = subscribedSymbols();
        if (syms.empty()) {
            std::cerr << "[feed] no symbols registered — nothing to subscribe\n";
            return;
        }
        const json sub = {{"action", "subscribe"}, {"bars", syms}};
        sendText(sub.dump());
    }

    void dispatchBar(const Bar& bar) {
        BarCallback cb;
        {
            std::lock_guard<std::mutex> lk(cb_mutex_);
            auto it = callbacks_.find(bar.symbol);
            if (it == callbacks_.end()) return;
            cb = it->second;
        }
        if (cb) cb(bar);
    }

    void handleMessage(const std::string& payload) {
        json root = json::parse(payload, nullptr, /*allow_exceptions=*/false);
        if (root.is_discarded()) {
            std::cerr << "[feed] dropping non-JSON frame\n";
            return;
        }
        const json& arr = root.is_array() ? root : json::array({root});
        for (const json& m : arr) {
            if (!m.is_object()) continue;
            const std::string type = m.value("T", std::string());
            if (type == "b") {
                try {
                    dispatchBar(alpaca::parseBar(m));
                } catch (const std::exception& e) {
                    std::cerr << "[feed] bad bar: " << e.what() << "\n";
                }
            } else if (type == "success") {
                const std::string msg = m.value("msg", std::string());
                std::cout << "[feed] success: " << msg << "\n";
                if (msg == "authenticated") {
                    connected_ = true;
                    sendSubscribe();
                }
            } else if (type == "subscription") {
                std::cout << "[feed] subscribed: bars="
                          << m.value("bars", json::array()).dump() << "\n";
            } else if (type == "error") {
                std::cerr << "[feed] error " << m.value("code", 0) << ": "
                          << m.value("msg", std::string()) << "\n";
            }
        }
    }

    void onMessage(ConnHdl, MessagePtr msg) {
        handleMessage(msg->get_payload());
    }

    void onClose(ConnHdl) {
        connected_ = false;
        std::cout << "[feed] connection closed\n";
    }

    void onFail(ConnHdl) {
        connected_ = false;
        std::cerr << "[feed] connection failed\n";
    }

    // One connect attempt per iteration; reconnect with exponential backoff
    // (1, 2, 4, ... capped at 60s) until stop() clears running_.
    void runLoop() {
        namespace lib = websocketpp::lib;
        while (running_.load()) {
            WsClient client;
            try {
                client.clear_access_channels(websocketpp::log::alevel::all);
                client.clear_error_channels(websocketpp::log::elevel::all);
                client.init_asio();

                client.set_tls_init_handler(
                    lib::bind(&Impl::onTlsInit, this, lib::placeholders::_1));
                client.set_open_handler(
                    lib::bind(&Impl::onOpen, this, lib::placeholders::_1));
                client.set_message_handler(
                    lib::bind(&Impl::onMessage, this, lib::placeholders::_1,
                              lib::placeholders::_2));
                client.set_close_handler(
                    lib::bind(&Impl::onClose, this, lib::placeholders::_1));
                client.set_fail_handler(
                    lib::bind(&Impl::onFail, this, lib::placeholders::_1));

                lib::error_code ec;
                auto con = client.get_connection(streamUrl(), ec);
                if (ec) {
                    std::cerr << "[feed] connection init failed: "
                              << ec.message() << "\n";
                } else {
                    {
                        std::lock_guard<std::mutex> lk(client_mutex_);
                        client_ = &client;
                    }
                    client.connect(con);
                    client.run();  // blocks until the connection closes
                }
            } catch (const std::exception& e) {
                std::cerr << "[feed] run loop exception: " << e.what() << "\n";
            }

            {
                std::lock_guard<std::mutex> lk(client_mutex_);
                client_ = nullptr;
            }
            connected_ = false;

            if (!running_.load()) break;

            const int wait = backoff_;
            std::cerr << "[feed] reconnecting in " << wait << "s\n";
            for (int i = 0; i < wait * 10 && running_.load(); ++i) {
                std::this_thread::sleep_for(100ms);
            }
            backoff_ = std::min(backoff_ * 2, kMaxBackoffSeconds);
        }
    }

    // ---- state ------------------------------------------------------------
    std::string api_key_, api_secret_, mode_;

    std::mutex                          cb_mutex_;
    std::map<std::string, BarCallback>  callbacks_;

    std::mutex   client_mutex_;
    WsClient*    client_ = nullptr;  // valid only while runLoop owns it
    ConnHdl      hdl_;

    std::atomic<bool> running_{false};
    std::atomic<bool> connected_{false};
    int               backoff_ = 1;  // touched only by runLoop / onOpen
    std::thread       thread_;
};

// ---- thin forwarding wrapper ----------------------------------------------

MarketDataFeed::MarketDataFeed(std::string api_key, std::string api_secret,
                               std::string mode)
    : impl_(std::make_unique<Impl>(std::move(api_key), std::move(api_secret),
                                   std::move(mode))) {}

MarketDataFeed::~MarketDataFeed() = default;

void MarketDataFeed::onBar(const std::string& symbol, BarCallback callback) {
    impl_->onBar(symbol, std::move(callback));
}

void MarketDataFeed::start() { impl_->start(); }
void MarketDataFeed::stop() { impl_->stop(); }
bool MarketDataFeed::isConnected() const { return impl_->isConnected(); }

}  // namespace hermes
