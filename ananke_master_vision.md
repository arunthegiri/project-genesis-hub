# Ananke — Master Vision, Architecture & Career Roadmap
*A personal reference capturing every architectural decision, design idea, research direction, and how it all lands against the career trajectory. Not a code doc. A map of where the mind is.*

*Author: Arun Thegiri*
*Captured: June 2026*

---

## PART 0 — WHAT ANANKE ACTUALLY IS

Ananke is not "a trading bot." It is a **quant research operating system** — the
infrastructure that lets a single person go from raw market data → research →
trained model → backtest → live execution → performance tracking, all in one
owned, controlled stack.

Two truths sit underneath everything:

1. **The first customer is me.** The platform is the research environment for an
   applied-math undergrad thesis (regime detection) and a CS masters
   (optimizing that detector with parallel computing / CUDA). Every feature
   serves the research first. The business is a second-order consequence of the
   research being real.

2. **Separation of concerns is the spine.** The entire system is organized so
   that each component does exactly one job and can be swapped without breaking
   the others. This instinct — applied without formal systems-design training —
   is the through-line of the whole project.

The Greek naming convention encodes the philosophy:
- **Ananke** — necessity/inevitability — the platform itself
- **Kairos** — the opportune moment — the Python strategy SDK (timing)
- **Hermes** — speed and commerce — the C++ execution engine
- **Themis** — order, law, justice — the risk manager inside Hermes

---

## PART 1 — THE CORE ARCHITECTURE (decided & built)

### The layer separation
```
Jupyter (research)      → train models, export ONNX, NO trade logic
Java Spring Boot (8080) → ONLY data management: TimescaleDB CRUD, Alpaca fetch
Hermes C++ (9090)       → ALL trade logic: signals, entry/exit, risk, execution
React frontend (3000)   → dashboard, backtesting, live monitoring
TimescaleDB (5432)      → all price data + trade logs
```

### The decisions that define this
- **All trade logic lives in C++, never in Jupyter.** The model is *only* a
  signal generator. Jupyter trains and exports; it never decides to buy or sell.
  This is the cleanest separation in the whole system and was a deliberate choice.
- **Java is data-only.** It fetches from Alpaca, stores in TimescaleDB, serves
  the frontend. It does not make trading decisions. When the dashboard runs a
  backtest, Java should eventually hand the actual simulation to C++ (Java
  fetches bars, C++ runs the strategy).
- **The model is model-agnostic to the engine.** Hermes never recompiles per
  model. A contract JSON travels with each ONNX file describing features
  (ordered), thresholds, and output classes. Swap models = swap files. The
  engine binary is written once.
- **ONNX is the universal bridge.** Train in anything (sklearn, LightGBM,
  PyTorch, XGBoost), export to ONNX, Hermes runs it. The training framework and
  the inference runtime never need to know about each other.

### Why latency separation matters
Live HFT path bypasses Java entirely: Alpaca WebSocket → Hermes → ONNX
inference → Alpaca order → TimescaleDB log. Java is never in the hot path.
Realistic latency is ~15–115ms per trade (network-dominated, C++ compute <5ms).
This is the **algo-trading tier**, not microsecond HFT — which requires
colocated servers inside the exchange. That ceiling is accepted on purpose; the
edge comes from model quality, not raw speed.

---

## PART 2 — THE TWO-PATH DESIGN (decided, partially built)

The platform serves two kinds of builder, who are really two phases of the
same workflow:

### Path A — Data scientists / math-heavy people
Stay in Jupyter. Train models. Export to ONNX. Get C++ execution speed without
ever writing C++. Later improve inference performance via TensorRT.

### Path B — AlgoDevs
Stay in C++. Write strategies directly against an event-driven base class.
Compile, backtest interactively on the dashboard, deploy. Full control over the
math.

### The unifying rule
**No matter where a strategy is made, it shows up on the dashboard backtesting
page and can be deployed to paper/live from both places.** The dashboard is the
single destination. The deploy button is the single action. The user never
thinks about which path produced the strategy.

### Export vs Deploy (key API decision)
- `export()` — always safe. Saves a strategy + backtest results to the
  dashboard. No execution.
- `deploy(mode, symbols)` — actually starts execution. Requires confirmation.
  `mode` ∈ {paper, live}. `symbols` is an explicit list in V1.

### The declarative-vs-event-driven decision (C++ SDK)
Build **both**, with the event-driven model as the foundation and a declarative
wrapper layered on top:
- **Event-driven (foundation)** — game-engine style: `onBar()`, `onFill()`,
  `onClose()`. Full mathematical control. Natural fit for HMMs, Monte Carlo,
  custom math. This is what the thesis research needs.
- **Declarative (convenience wrapper)** — Kairos-like syntax for simple
  rule-based strategies. Built on top of the event-driven base.

This matters because the hard research (HMM state machines, Monte Carlo) cannot
be expressed declaratively — it needs the event-driven layer's full control.

---

## PART 3 — STRATEGY-SYMBOL DEPLOYMENT (the V1→V4 staircase)

A deliberately staged plan so the regime orchestrator is NOT built prematurely.
The honest gating question: *"Does Strategy A even work?"* must be answered
before *"Which of 500 symbols should Strategy A trade?"*

```
V1 — Explicit symbol assignment
     deploy(symbols=["NVDA", "AAPL"]) — engine subscribes, no intelligence.

V2 — Universe testing
     Backtest a strategy across many symbols, human picks the winners by Sharpe.

V3 — Symbol selection layer
     Strategy → Universe (500 stocks) → Ranking model (momentum, volume,
     volatility, liquidity) → Top N → Engine.

V4 — Regime orchestrator
     Market state → Regime predictor → choose strategy → choose symbols → engine.
```

V4 is the long-term centerpiece but explicitly a **2027+ problem**, not a
pre-internship problem.

---

## PART 4 — THE REGIME ORCHESTRATOR (future centerpiece, designed not built)

This is the most intellectually important future component and the bridge
between the platform and the thesis.

### The core insight
By the time RSI crosses 30 or ADX crosses 25, the move has already started.
The goal is to **predict** regime changes before they confirm, not **detect**
them after.

### Three layers
1. **Kairos / strategy layer** — individual strategies on standby.
2. **RegimePredictor** — ML models that predict regime *transitions* using
   leading indicators (order-flow imbalance, volume delta, bid-ask dynamics,
   implied vol / VRP, cross-asset signals, macro calendar). Outputs a
   probability distribution over regimes, not a binary label.
3. **Orchestrator** — watches predictions, activates/deactivates strategies,
   manages liquidation when switching regimes, handles cross-strategy risk.

### Strategy lifecycle the orchestrator manages
```
STANDBY → WARMING_UP → ACTIVE → WINDING_DOWN → STANDBY
```
All strategies pre-loaded and warming indicators at all times — no cold starts
when a regime change is predicted.

### Anti-thrashing
Hysteresis band: activation threshold (e.g. 70%) higher than deactivation
threshold (e.g. 40%). Once active, stay active until confidence drops below the
lower bound. Prevents rapid flip-flopping as confidence oscillates.

### The hard open problem — intelligent liquidation
When switching regimes, what do you liquidate and what do you hold? Three
options: hard switch (fast, forced-loss risk), soft switch (natural exits,
slow), and intelligent switch (per-position decision on profitability,
correlation, cost, tax). Intelligent switch is the right answer and the one
that needs the most research.

---

## PART 5 — MODEL LIFECYCLE MANAGEMENT (designed, future)

The feedback loop that turns a one-shot model into a living system:
```
Model deployed → performance data → TimescaleDB → degradation detection
→ retrain trigger (automatic OR manual) → A/B test (old vs candidate on paper)
→ statistical significance test → promote winner → archive loser → back to Jupyter
```

Key ideas:
- Rolling performance metrics (not just lifetime) — win rate / Sharpe on a
  rolling window to catch decay before it's catastrophic.
- A/B testing with hypothesis tests before any promotion to live.
- Both automatic degradation flags AND manual researcher judgment — the
  platform supplies the data to make the call.

Explicitly deferred until the regime orchestrator era.

---

## PART 6 — FROZEN PAGE STATE / FULL UI STATE PERSISTENCE (designed)

Not just data caching — the *entire* UI snapshot is restorable. Navigate away
and back and the page is exactly as left, including the exact replay bar you
were paused on. Implementation approach: URL state for UI (shareable,
bookmarkable, survives refresh) + TanStack Query for data. The backtesting bar
index is absolute (position in full dataset) so it survives zoom changes.

This is a small idea but it captures a design value: **the platform should feel
like it never forgets where you were.**

---

## PART 7 — PERFORMANCE & OBSERVABILITY ("measure everything")

A stated design value: instrument everything. Planned metrics across both
backtesting and live:
- Strategy *source* tracking (Kairos / ONNX / Hermes / paper / live / sim badges)
- Latency breakdown: bar arrival → signal → order → fill (where time goes)
- Trade frequency, signal-vs-trade ratio (how many signals Themis blocks)
- Rolling win rate (last 10 / 50 / session), PnL by time-of-day / day-of-week
- Drawdown over time, recovery time, win/loss streaks

The instinct here — that a serious system measures itself constantly — is the
same instinct that makes the regime detector and the CUDA performance analysis
work.

---

## PART 8 — THE SCALING / TECHNOLOGY LADDER

The deliberate order in which heavy infrastructure gets added. Each rung is only
climbed when the rung below actually hurts.

```
Inference:   ONNX Runtime (now) → NVIDIA Triton Inference Server → TensorRT
Parallelism: single-thread C++ (now) → OpenMP (quick 4–8x) → CUDA (20–40x+)
Orchestration: Docker Compose (now) → Kubernetes (multi-strategy, multi-tenant)
Cloud:       local (now) → AWS/GCP for training → cloud-hosted multi-tenant SaaS
Data:        bars (now) → tick data (when HFT matters)
```

Design principle that makes the ladder climbable: **interfaces don't change when
the backend does.** FeatureCalculator and ONNXModel have swappable
implementations. CPU today, CUDA later, same interface. ONNX today, TensorRT
later, same `predict()` call.

### OpenMP vs CUDA (decided heuristic)
- OpenMP first — 3-line pragma, 4–8x, no GPU required. Good for parallel
  backtesting across symbols and the Hermes feature calculator *now*.
- CUDA when compute >> memory-transfer cost — Monte Carlo (millions of paths),
  HMM forward-backward, 500-symbol feature computation, TensorRT inference.
- The trap: CUDA loses when data transfer dominates compute. Small data → OpenMP.

---

## PART 9 — THE BUSINESS (background thread, not the point — but real)

"Cursor for quants." The platform accidentally became a legitimate SaaS while
being built as research infrastructure. Treated as an *option*, not a mandate.

### What makes it defensible
- C++ execution speed + ONNX/TensorRT path — no LLM-friendly quant platform has
  institutional-grade execution.
- The regime detector (if the research is real) — a multi-year, hard-to-replicate
  moat.
- Data network effects — every user's anonymized performance improves the
  shared regime detector.
- Data gravity — years of a researcher's own strategies/backtests = no switching.
- Academic credibility — a thesis published *through* the platform is trust money
  can't buy.

### Tiering sketch (only if pursued)
Research (~$49) → Pro (~$149, live + C++ SDK) → Quant (~$499, alt data + compute)
→ Institutional (custom, white-label).

### The LLM layer (the retail unlock)
A conversational layer that turns "I want a strategy that protects me in crashes
but grows in bull markets" into generated Kairos code + a backtest + a deploy
button. This widens the audience from ~10k quant researchers to potentially
millions of retail traders. **Important honest note:** the LLM wrapper is NOT
the moat — GPT/Gemini can replicate it. The moat is the engine + regime detector
+ data. The LLM is packaging.

### Valuation honesty
- Niche research tool: ~$15–40M.
- Quant + retail crossover w/ AI: ~$100–300M.
- "Cursor for quants" fully realized w/ working regime detector: $500M–$1B+.
The single variable that moves between these tiers is **whether the regime
detector actually works.** Everything else is execution and packaging.

### The non-negotiable caveat
The moment retail users make real trades on AI-recommended strategies, this is
SEC territory. Needs a lawyer early. Not a blocker, a known gate.

---

## PART 10 — RESEARCH DIRECTIONS WORTH DEEP-DIVING

Captured so future-me remembers what to chase.

### Regime detection (the thesis core)
- Hidden Markov Models — already prototyped (4-state Gaussian HMM). Go deeper:
  non-stationary transition matrices, online/streaming learning, custom emission
  distributions.
- **RS-CCC-GARCH** (Quant Insider, June 2026) — regime-switching multivariate
  volatility across asset classes. Cross-asset vol + VRP as *leading* regime
  indicators. Includes a calendar-event adjustment layer → directly feeds Themis
  (suppress trading around Fed/CPI/NFP).
- LSTM / Transformer regime models, Gaussian Mixture Models for probabilistic
  regime assignment.

### Portfolio management (the liquidation problem)
Markowitz / Modern Portfolio Theory, Kelly criterion (already used for sizing),
risk parity, Black-Litterman, transaction-cost analysis, Almgren-Chriss optimal
execution, implementation shortfall. Reading anchors: Lopez de Prado (*Advances
in Financial Machine Learning* — bet sizing, portfolio construction), Robert
Carver (*Systematic Trading*), Rishi Narang (*Inside the Black Box*).

### The thesis question (write it down, it drives everything)
*Can market regime transitions be predicted with statistical significance before
price indicators confirm them, and if so, what is the minimum latency between
prediction and confirmation?*

This question has a publishable answer whether yes or no, and it naturally
*demands* the CUDA work (massive parallel HMM parameter search), which lands it
squarely in NVIDIA / HPC territory.

---

## PART 11 — CAREER ROADMAP (specific, time-phased)

Career end-state intentionally open: quant-dev, ML-infra (NVIDIA-type), founder,
and academic are all preserved. The roadmap below keeps all four live by
front-loading the skills they share: HPC, CUDA, ML systems, and a real research
result.

### Phase 1 — NVIDIA internship (Aug 2026 → end Jan 2027)
**Goal: absorb the hardware/inference layer from the inside.**
- Deep-dive: cuBLAS (Pancotti's tip — HMM forward-backward IS matrix ops),
  TensorRT, Triton, the Nsight profiler. Learn to *read* occupancy, memory
  bandwidth, warp efficiency — writing fast CUDA, not just CUDA.
- Ananke work in off-hours: keep Hermes V1 → first real paper trade landed.
  Don't start CUDA integration yet; just learn the tools where the experts are.
- Career value: this internship is the single highest-leverage credential for
  every one of the four end-states.

### Phase 2 — Back to school, pre-thesis (Spring–Summer 2027)
**Goal: turn HPC access into standalone CUDA research artifacts.**
- Leverage Bethel / LBNL / NERSC Perlmutter access (6,000 A100s) — this is a
  rare asset; most people never touch hardware like this.
- Build standalone CUDA projects in this order (easiest entry → thesis-adjacent):
  1. `cuda-monte-carlo` — option pricing / VaR / strategy stress (embarrassingly
     parallel, ~200x, great first win).
  2. `cuda-hmm` — forward-backward + Viterbi on GPU via cuBLAS (~56x), plus
     *parallel HMM parameter search* (1000 configs at once) — this IS the thesis
     engine.
  3. `cuda-features` — GPU port of Hermes FeatureCalculator, benchmark vs CPU.
- Each project gets the full performance-analysis treatment: baseline → naive
  GPU → optimized GPU → roofline → scaling. Each step is publishable.
- Add OpenMP to Hermes now for quick wins while learning CUDA properly.

### Phase 3 — Undergrad thesis (Fall 2027)
**Goal: produce a real, defensible regime-detection result.**
- The applied-math thesis answers the thesis question above using Ananke as the
  research platform and CUDA for the heavy parallel search.
- This is the moment the platform and the research fuse: real data, real
  parallel compute, real statistical result.
- Whatever the answer, it's the centerpiece of PhD applications and the
  potential business moat.

### Phase 4 — Masters + PhD apps (Fall 2028)
**Goal: optimization as systems research + open the next door.**
- Masters coursework formalizes the CUDA/parallel work: custom HMM kernels,
  novel optimizations for financial time series, possibly RS-CCC-GARCH on GPU.
- This is a legitimate systems paper independent of the trading angle.
- PhD applications that cycle — the thesis result + NVIDIA pedigree + Perlmutter
  experience + a working platform is an unusually strong package.
- Decision point: PhD (academic/research track) vs fund (quant-dev) vs build
  Ananke (founder) vs NVIDIA-return (ML-infra). All four are live *because* the
  prior phases were generalist-strong in HPC + ML systems + a real result.

### The synthesis
Every phase compounds: the internship teaches the hardware, the HPC access turns
it into artifacts, the thesis turns artifacts into a result, the masters turns
the result into systems research, and Ananke is the connective tissue that makes
all of it one coherent story instead of four disconnected lines on a resume.

---

## PART 12 — WHAT TO ADD TO ANANKE, BY STAGE (architecture, not code)

A focused list of features/technologies that fit Ananke's identity, sequenced so
nothing is built prematurely.

### Near-term (now → internship)
- Finish Hermes Parts 11 (real paper trade end-to-end). This is the keystone —
  nothing downstream is real until one trade executes and logs.
- ONNX export path from the research notebook into Hermes (close the
  Jupyter→engine loop properly).
- OpenMP in the Hermes FeatureCalculator (quick parallel win, learning ramp).
- Strategy-source tracking + the "measure everything" observability layer.

### Mid-term (post-internship → thesis)
- The C++ event-driven strategy SDK (AnankeStrategy base class) + dynamic `.so`
  loading. This is the AlgoDev path AND the research substrate for custom HMMs.
- `ananke` CLI for the C++ path (compile → backtest → export → deploy) mirroring
  the Python ergonomics.
- Portable, containerized training (train anywhere: local RTX, GCP, AWS,
  someone's A100) — only when retraining cadence justifies it.
- Triton inference server to replace local ONNX runtime once multi-strategy /
  multi-symbol load appears.

### Long-term (thesis → masters → beyond)
- The Regime Orchestrator (V4) — the centerpiece. RegimePredictor +
  Orchestrator + intelligent liquidation.
- Model lifecycle management (degradation detection + A/B testing).
- CUDA-accelerated FeatureCalculator and TensorRT inference merged into Hermes.
- Kubernetes for multi-tenant hosting (the SaaS unlock).
- The LLM assistance layer (retail accessibility) — last, because it's packaging
  not moat.
- Tick-data support (only when bar-level ceases to be enough).

---

## PART 13 — THE DESIGN VALUES (the why behind the choices)

If future-me forgets everything else, remember these. They generated every
decision above:

1. **Separation of concerns is sacred.** One component, one job, swappable.
2. **The model is a signal generator, nothing more.** Trade logic is the
   engine's job.
3. **Interfaces outlive implementations.** Build so CPU→GPU, ONNX→TensorRT,
   Docker→K8s never require rewrites above the swap point.
4. **Don't build the orchestrator before proving a single strategy works.**
   Earn each layer of intelligence with evidence.
5. **Measure everything.** A serious system instruments itself.
6. **Research first, business second.** The platform succeeds on its merits;
   the regime detector, if real, makes it much bigger.
7. **Build for myself as the first customer.** The best validation is being the
   ideal user who knows exactly what they need.

---

## PART 14 — ENTERPRISE VISION (added July 2026, under VC pressure)

*Context for future-me: this part was written after VCs started looking at the
project and the timeline compressed to "all of it by end of 2026." It is
deliberately more ambitious than Parts 0–13 and deliberately more honest about
what that ambition costs. Read Part 12's sequencing before acting on this one —
they disagree, and the disagreement is the point.*

### The full ask

Everything below is one sentence in intent and five businesses in practice:

- **Agent loops for financial research** — agents that read filings, form
  hypotheses, write strategies, and propose them for deployment.
- **An agent deployment platform** — outsiders bring agents that trade.
- **No-code retail trading** — people who cannot code come and trade regularly.
- **Researcher tooling** — agents that build the code a quant actually wants,
  with easy access to training infra, local or cloud, **without ever exposing
  their alpha.**
- **Data access** — "all kinds," across asset classes and vendors.

### The honest decomposition

Those are not five features of one product. They are five products with
different users, different sales motions, different regulators, and different
cost structures — each with funded incumbents already in the lane:

    Retail no-code        → Composer, Capitalise, Tickeron
    Agent marketplace     → the most crowded category in the market right now
    Quant research        → QuantConnect, Numerai, WorldQuant
    Training compute      → Modal, RunPod, Together, CoreWeave
    Market data           → Polygon, Databento, Nasdaq Data Link

The vision can stay this big. The **build** has to pick one, and it should pick
the one where Ananke already has something nobody else has.

### The wedge — researchers first, retail later

Retail is the larger market and the wrong first move:

- "People who don't know how to code come and trade" makes Ananke an RIA, a
  broker-dealer, or a tech vendor to one. Composer is a registered RIA. That is
  months of legal work and real money **before the first user**, and it is a
  diligence question that cannot be hand-waved.
- Retail cannot perceive the moat. Bit-parity-verified features and a C++ risk
  manager mean nothing to someone who wants a button. That competition is won
  on UI polish, which is Ananke's weakest axis.
- Part 12 already sequenced this correctly — LLM/retail layer **last**, "because
  it's packaging not moat." That judgment was made without deadline pressure and
  should be trusted over the version of me that has a demo next month.

Researchers pay more, churn less, can evaluate the engine on its merits, and are
who I already am. Design value #7 still holds: **build for myself as the first
customer.**

### Alpha secrecy — the best new idea in this part

This was not anywhere in Parts 0–13, and it is the strongest thing to come out
of the enterprise thinking. **The architecture already solves it by accident.**

Ananke separates training from execution at an ONNX contract boundary. Hermes
loads a model file plus an ordered feature list and thresholds. It never sees
training data, never sees how features were derived, never sees the research
process. That was built for engineering hygiene — model-agnostic engine, swap
files not binaries. It happens to be a **product-grade IP boundary**, and almost
nobody else has one.

The ladder, in build order:

1. **Today (shippable now)** — researcher trains locally, uploads only ONNX +
   contract. Their data and process never leave their machine. This is already
   what Hermes does.
2. **Next** — model encrypted at rest, decrypted only inside the execution
   process.
3. **The real thing** — confidential computing. Train and serve inside a TEE on
   H100s in confidential-compute mode, where the platform **provably cannot**
   read the model or the data.

Numerai attacked this from the opposite side: they obfuscate the *data* so
models train blind. Protecting the *model* instead composes better with
researchers who bring their own data — which is the segment worth winning.

### NVIDIA: confidential computing, not Dynamo

Instinct said "NVIDIA Dynamo, inference at scale." Dynamo is disaggregated LLM
serving — prefill/decode separation, KV-cache-aware routing, scheduling across a
GPU fleet. Neither Ananke inference path is that:

- **Hermes** runs a random forest through ONNX Runtime. Microseconds, CPU, one
  model, one process. Dynamo has nothing to offer it.
- **The agent platform** will call hosted APIs. Dynamo only matters when
  self-hosting open-weight models — a different business with a GPU bill.

Dynamo becomes correct when self-hosted models serve enough tenants that
per-token API cost exceeds fleet cost. That is a real future; it is not now.

**Point the NVIDIA relationship at Hopper confidential computing instead.** Same
hardware, same CUDA/HPC career thread from Part 11, aimed at a claim that is
actually differentiating: *"train on our GPUs — we mathematically cannot see
your alpha."* This is the rare case where the technical story and the business
story are the same sentence.

### Data and compute — don't own either yet

**Data.** "Access to all kinds of data" is a licensing business, not an
engineering one. Redistribution rights are expensive and Alpaca's terms
generally do not permit reselling. Start **bring-your-own-key**: users plug in
their own Alpaca / Polygon / Databento credentials and Ananke orchestrates.
Sidesteps licensing entirely, ships in days, reuses the existing ingestion path.
Buy redistribution rights only when a paying customer is blocked without them.

**Compute.** Resell Modal / RunPod / Lambda with a markup before owning a single
GPU. Owning GPUs pre-revenue converts a software business into a capital
business at the worst possible moment. School HPC access and the NVIDIA network
are a genuine edge — use them for **design partners**, not as the product.

### Themis is the answer to agent-generated strategies

An agent that invents and deploys algos will produce overfit garbage at some
rate. That is not a risk to mitigate in the pitch; it is the feature.

Ananke already has a risk manager that can refuse a trade. Make it the story:
**the agent proposes, Themis disposes.** Confidence floors, daily loss limits,
drawdown ceilings, max trades/day, regime suppression — all already built and
exercised. That is the difference between this and a GPT wrapper that loses
someone's money, and it is the most credible thing to say in a room full of
people who have seen forty agent demos that quarter.

### What to demo

Not a platform. One loop, end to end, that nobody else can show:

    researcher states a hypothesis
      → agent writes Kairos strategy code
      → backtests on real TimescaleDB data
      → exports ONNX + contract
      → Hermes paper-trades it
      → trades land in the DB and on the dashboard
      → and the platform never saw the training data

Every component but the agent already exists. The agent's only job is emitting a
strategy config — not running infrastructure. Framed this way the five-business
vision reads as a roadmap off a working spine. Framed as "our agent platform,"
it reads as one of forty.

### The regulatory gate has moved

Part 9's caveat said SEC territory arrives when retail users trade on
AI-recommended strategies. The enterprise vision **pulls that gate forward**: an
agent marketplace plus no-code retail means adviser questions arrive at launch,
not eventually.

Minimum viable answer for the demo phase: **paper trading only, stated plainly,
with a one-line position on the RIA path.** Not having thought about it reads
worse than the honest version. A lawyer is needed earlier than Part 9 assumed.

### The tension, stated honestly

Part 12 puts the LLM layer last and Kubernetes multi-tenancy late, for good
reasons that have not stopped being true. This part pulls both forward because
of external timing, not because the engineering argument changed.

The moat is still the regime detector and the C++ execution path. **Neither gets
closer to done by building agent infrastructure.** Hermes V1 has still never
traded — HMM regime is unwired, so `hmm_regime` is frozen at 0 and Themis's
`suppress_regime` never fires. Part 12 calls Part 11 "the keystone — nothing
downstream is real until one trade executes and logs." That is still true, and
it is still not done.

Both things can be true: the enterprise vision is the right direction, and the
keystone is the right next task. If a choice has to be made under deadline,
**make the keystone the demo** — a working end-to-end trade is more compelling
to a serious investor than a broad platform that cannot yet execute one.

---

*This document is a snapshot of the mind behind Ananke in mid-2026: the
architecture decided, the futures imagined, and the career they're meant to
build toward. It is a map, not a contract. The directions are right even where
the details will change.*
