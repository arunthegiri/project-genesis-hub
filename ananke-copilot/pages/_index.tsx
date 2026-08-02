import React from "react";
import { Link } from "react-router-dom";
import { 
  ArrowRight, 
  Terminal, 
  BrainCircuit, 
  Code2, 
  PlaySquare, 
  BarChart4, 
  MessageSquareDiff, 
  Rocket,
  Search,
  LineChart,
  ShieldCheck,
  Cpu,
  Layers,
  Activity
} from "lucide-react";
import { ThemeModeSwitch } from "../components/ThemeModeSwitch";
import { Button } from "../components/Button";
import { useScrollReveal } from "../helpers/useScrollReveal";
import styles from "./_index.module.css";

export default function LandingPage() {
  const revealRef = useScrollReveal({ threshold: 0.1, rootMargin: "0px 0px -50px 0px" });

  return (
    <div className={styles.page}>
      {/* Navbar */}
      <header className={styles.navbar}>
        <div className={styles.navContainer}>
          <div className={styles.logo}>
            Ananke
          </div>
          <div className={styles.navActions}>
            <ThemeModeSwitch />
            <Button asChild variant="primary" size="md">
              <Link to="/copilot">Launch Copilot</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {/* Hero Section */}
        <section className={styles.hero} ref={revealRef}>
          <div className={styles.heroContent}>
            <h1 className={`${styles.heroTitle} ${styles.revealItem}`} style={{ transitionDelay: '0ms' }}>
              AI-Powered <br />
              <span className={styles.italicText}>Quantitative Research</span>
            </h1>
            <p className={`${styles.heroSubtitle} ${styles.revealItem}`} style={{ transitionDelay: '100ms' }}>
              Describe your research ideas in natural language. Ananke translates hypotheses into rigorous, reproducible experiments—generating code, running backtests, and analyzing results instantly.
            </p>
            <div className={`${styles.heroActions} ${styles.revealItem}`} style={{ transitionDelay: '200ms' }}>
              <Button asChild size="lg" className={styles.ctaButton}>
                <Link to="/copilot">Launch Copilot <ArrowRight size={18} /></Link>
              </Button>
            </div>
          </div>
          
          <div className={`${styles.heroVisual} ${styles.revealItem}`} style={{ transitionDelay: '300ms' }}>
            <div className={styles.mockTerminal}>
              <div className={styles.terminalHeader}>
                <div className={styles.terminalDots}>
                  <span /> <span /> <span />
                </div>
                <div className={styles.terminalTitle}>ananke-copilot ~ zsh</div>
              </div>
              <div className={styles.terminalBody}>
                <div className={styles.terminalRow}>
                  <span className={styles.terminalPrompt}>&gt;</span>
                  <span className={styles.terminalText}>Backtest an RSI + EMA crossover strategy on NVDA from 2020–2025</span>
                </div>
                <div className={styles.terminalRow}>
                  <span className={styles.terminalInfo}>[Ananke]</span>
                  <span className={styles.terminalTextMuted}> Analyzing request...</span>
                </div>
                <div className={styles.terminalRow}>
                  <span className={styles.terminalSuccess}>[✓]</span>
                  <span className={styles.terminalTextMuted}> Generated experiment plan.</span>
                </div>
                <div className={styles.terminalRow}>
                  <span className={styles.terminalSuccess}>[✓]</span>
                  <span className={styles.terminalTextMuted}> Executed Kairos Python backtest.</span>
                </div>
                <div className={styles.terminalRow}>
                  <span className={styles.terminalInfo}>[Result]</span>
                  <span className={styles.terminalText}> CAGR: 18.3% | Sharpe: 1.42 | Win Rate: 62.1%</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className={styles.workflowSection} ref={revealRef}>
          <div className={`${styles.sectionHeader} ${styles.revealItem}`}>
            <h2 className={styles.sectionTitle}>The Research Lifecycle</h2>
            <p className={styles.sectionSubtitle}>From natural language hypothesis to deployed model.</p>
          </div>
          
          <div className={styles.timeline}>
            {[
              { icon: BrainCircuit, title: "Understand", desc: "Parses natural language requests into structured experiment objectives." },
              { icon: Layers, title: "Plan", desc: "Builds a deterministic execution plan with requested features and parameters." },
              { icon: Code2, title: "Generate Code", desc: "Writes reproducible Python code using the Kairos SDK." },
              { icon: PlaySquare, title: "Execute", desc: "Runs deterministic calculations on infrastructure." },
              { icon: BarChart4, title: "Present Results", desc: "Displays clear metrics, equity curves, and drawdowns." },
              { icon: MessageSquareDiff, title: "Recommend", desc: "Analyzes findings and suggests improvements." },
              { icon: Rocket, title: "Deploy", desc: "Exports to ONNX and deploys to Hermes with one click." },
            ].map((step, idx) => (
              <div key={idx} className={`${styles.timelineStep} ${styles.revealItem}`} style={{ transitionDelay: `${idx * 80}ms` }}>
                <div className={styles.timelineIconWrapper}>
                  <step.icon size={20} />
                </div>
                <div className={styles.timelineContent}>
                  <h3 className={styles.timelineTitle}>{step.title}</h3>
                  <p className={styles.timelineDesc}>{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Core Capabilities */}
        <section className={styles.capabilitiesSection} ref={revealRef}>
          <div className={`${styles.sectionHeader} ${styles.revealItem}`}>
            <h2 className={styles.sectionTitle}>Core Capabilities</h2>
            <p className={styles.sectionSubtitle}>Built for uncompromising archival research quality.</p>
          </div>

          <div className={styles.capabilityGrid}>
            <div className={`${styles.capabilityCard} ${styles.revealItem}`} style={{ transitionDelay: '0ms' }}>
              <Search className={styles.capabilityIcon} size={28} />
              <h3 className={styles.capabilityTitle}>Natural Language Research</h3>
              <p className={styles.capabilityDesc}>Skip boilerplate coding. Describe your experimental parameters, indicators, and timelines in plain English to immediately begin iterating.</p>
            </div>
            
            <div className={`${styles.capabilityCard} ${styles.revealItem}`} style={{ transitionDelay: '100ms' }}>
              <Terminal className={styles.capabilityIcon} size={28} />
              <h3 className={styles.capabilityTitle}>Code Generation</h3>
              <p className={styles.capabilityDesc}>Ananke writes production-grade Python against the Kairos SDK. Every experiment is transparent, reproducible, and verifiable.</p>
            </div>
            
            <div className={`${styles.capabilityCard} ${styles.revealItem}`} style={{ transitionDelay: '200ms' }}>
              <LineChart className={styles.capabilityIcon} size={28} />
              <h3 className={styles.capabilityTitle}>Backtest & Metrics</h3>
              <p className={styles.capabilityDesc}>Instant access to institutional-grade analytics: Sharpe, Sortino, CAGR, Maximum Drawdown, Win Rate, and comprehensive equity curve visualizations.</p>
            </div>
            
            <div className={`${styles.capabilityCard} ${styles.revealItem}`} style={{ transitionDelay: '300ms' }}>
              <ShieldCheck className={styles.capabilityIcon} size={28} />
              <h3 className={styles.capabilityTitle}>Safety First</h3>
              <p className={styles.capabilityDesc}>Orchestration happens transparently. View, edit, and approve the execution plan and cost estimates before any computation happens.</p>
            </div>
          </div>
        </section>

        {/* Supported Tools */}
        <section className={styles.toolsSection} ref={revealRef}>
          <div className={`${styles.sectionHeader} ${styles.revealItem}`}>
            <h2 className={styles.sectionTitle}>Ecosystem & Integrations</h2>
          </div>
          
          <div className={styles.toolsGrid}>
            <div className={`${styles.toolColumn} ${styles.revealItem}`} style={{ transitionDelay: '0ms' }}>
              <div className={styles.toolHeader}>
                <Activity size={20} className={styles.toolHeaderIcon} />
                <h3>Features</h3>
              </div>
              <ul className={styles.toolList}>
                <li>RSI & MACD</li>
                <li>Exponential Moving Averages</li>
                <li>Average True Range (ATR)</li>
                <li>Bollinger Bands</li>
                <li>Volume Weighted Average Price</li>
                <li>Custom Price Action Filters</li>
              </ul>
            </div>
            
            <div className={`${styles.toolColumn} ${styles.revealItem}`} style={{ transitionDelay: '100ms' }}>
              <div className={styles.toolHeader}>
                <Cpu size={20} className={styles.toolHeaderIcon} />
                <h3>Models</h3>
              </div>
              <ul className={styles.toolList}>
                <li>Rule-based Logic</li>
                <li>Random Forest</li>
                <li>XGBoost & LightGBM</li>
                <li>LSTM Networks</li>
                <li>Transformer Architectures</li>
              </ul>
            </div>
            
            <div className={`${styles.toolColumn} ${styles.revealItem}`} style={{ transitionDelay: '200ms' }}>
              <div className={styles.toolHeader}>
                <BarChart4 size={20} className={styles.toolHeaderIcon} />
                <h3>Evaluation</h3>
              </div>
              <ul className={styles.toolList}>
                <li>Walk-Forward Optimization</li>
                <li>K-Fold Cross Validation</li>
                <li>Out-of-sample Testing</li>
                <li>SHAP Value Analysis</li>
                <li>Feature Importance Ranking</li>
              </ul>
            </div>
          </div>
        </section>

        {/* CTA Footer */}
        <section className={styles.ctaSection} ref={revealRef}>
          <div className={`${styles.ctaBox} ${styles.revealItem}`}>
            <h2 className={styles.ctaTitle}>Ready to formalize your research?</h2>
            <p className={styles.ctaDesc}>Step into the copilot and run your first quantitative experiment today.</p>
            <Button asChild size="lg" className={styles.ctaBoxButton}>
              <Link to="/copilot">Start Researching</Link>
            </Button>
          </div>
        </section>
      </main>
      
      <footer className={styles.footer}>
        <div className={styles.footerContent}>
          <div className={styles.logo}>Ananke</div>
          <div className={styles.footerLinks}>
            <span className={styles.footerText}>© {new Date().getFullYear()} Ananke Stack. Archival Research Platform.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}