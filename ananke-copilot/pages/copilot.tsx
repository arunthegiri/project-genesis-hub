import React, { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { 
  ArrowLeft, 
  Plus, 
  MessageSquare, 
  Send,
  FileCode2
} from "lucide-react";
import { ThemeModeSwitch } from "../components/ThemeModeSwitch";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { 
  ChartContainer, 
  ChartTooltip, 
  ChartTooltipContent, 
} from "../components/Chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from "recharts";
import { useCopilotChat } from "../helpers/useCopilotChat";
import styles from "./copilot.module.css";

// ---------------------------------------------
// Demo Data
// ---------------------------------------------

const DEMO_HISTORY = [
  { id: "h1", title: "RSI + EMA on NVDA", active: true },
  { id: "h2", title: "LSTM Forecast TSLA", active: false },
  { id: "h3", title: "Portfolio Optimization", active: false },
  { id: "h4", title: "Mean Reversion Crypto", active: false },
];

const SUGGESTIONS = [
  "What symbols are being tracked?",
  "Show me NVDA price data from the last month",
  "Backtest an RSI strategy on AAPL"
];

// ---------------------------------------------
// Component
// ---------------------------------------------

export default function CopilotPage() {
  const { messages, sendMessage, isStreaming, error, clearChat } = useCopilotChat();
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const lastMessage = messages[messages.length - 1];
  // True while the request is in flight (tool loop, first token pending) and no
  // visible assistant text has arrived yet — show the typing bubble then.
  const showTyping = isStreaming && !(lastMessage?.role === "assistant" && lastMessage.content);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, showTyping]);

  const handleSend = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim() || isStreaming) return;
    
    sendMessage(inputValue.trim());
    setInputValue("");
  };

  const handleSuggestionClick = (text: string) => {
    sendMessage(text);
  };

  const renderMarkdown = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(```[\s\S]*?```)/g);
    
    return parts.map((part, index) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const codeLines = part.slice(3, -3).split('\n');
        const firstLine = codeLines[0].trim();
        const hasLanguage = /^[a-zA-Z0-9_-]+$/.test(firstLine);
        const code = hasLanguage ? codeLines.slice(1).join('\n') : codeLines.join('\n');
        
        return (
          <div key={index} className={styles.codeCard}>
            <div className={styles.codeHeader}>
              <FileCode2 size={16} />
              <span>{hasLanguage ? firstLine : 'code'}</span>
            </div>
            <pre className={styles.codeBlock}>
              <code>{code}</code>
            </pre>
          </div>
        );
      }
      
      return (
        <div key={index} className={styles.markdownText}>
          {part.split('\n').map((line, i) => {
            if (line.startsWith('# ')) return <h1 key={i}>{line.slice(2)}</h1>;
            if (line.startsWith('## ')) return <h2 key={i}>{line.slice(3)}</h2>;
            if (line.startsWith('### ')) return <h3 key={i}>{line.slice(4)}</h3>;
            
            const isBullet = line.trim().startsWith('- ') || line.trim().startsWith('• ');
            let content = isBullet ? line.trim().substring(2) : line;

            const contentParts = content.split(/(\*\*.*?\*\*)/g).map((bp, j) => 
              bp.startsWith('**') && bp.endsWith('**') ? <strong key={j}>{bp.slice(2, -2)}</strong> : bp
            );

            if (isBullet) return <li key={i}>{contentParts}</li>;
            if (line.trim() === '') return <div key={i} style={{ height: '0.5rem' }} />;
            return <p key={i}>{contentParts}</p>;
          })}
        </div>
      );
    });
  };

  const renderMessageContent = (msg: { role: string; content: string; isStreaming?: boolean }) => {
    if (msg.role === "user") {
      return <div className={styles.userText}>{msg.content}</div>;
    }

    return (
      <div className={styles.assistantContent}>
        {renderMarkdown(msg.content)}
        {msg.isStreaming && <span className={styles.blinkingCursor} />}
      </div>
    );
  };

  return (
    <div className={styles.layout}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <Button variant="outline" className={styles.newChatBtn} onClick={clearChat}>
            <Plus size={16} /> New Chat
          </Button>
        </div>
        <div className={styles.historyList}>
          <div className={styles.historyLabel}>Recent Experiments</div>
          {DEMO_HISTORY.map((item) => (
            <button 
              key={item.id} 
              className={`${styles.historyItem} ${item.active ? styles.historyItemActive : ''}`}
            >
              <MessageSquare size={16} className={styles.historyIcon} />
              <span className={styles.historyTitle}>{item.title}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className={styles.main}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <Button asChild variant="ghost" size="icon-sm" className={styles.backBtn}>
              <Link to="/" aria-label="Back to home"><ArrowLeft size={18} /></Link>
            </Button>
            <h1 className={styles.headerTitle}>Ananke Copilot</h1>
          </div>
          <div className={styles.headerRight}>
            <ThemeModeSwitch />
          </div>
        </header>

        {/* Chat Thread */}
        <div className={styles.chatThread}>
          {messages.length === 0 ? (
            <div className={styles.emptyState}>
              <h2 className={styles.emptyTitle}>Ananke Copilot</h2>
              <p className={styles.emptySubtitle}>Describe your research idea to get started</p>
              <div className={styles.suggestions}>
                {SUGGESTIONS.map((suggestion) => (
                  <button 
                    key={suggestion} 
                    className={styles.suggestionChip}
                    onClick={() => handleSuggestionClick(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.chatContainer}>
              {messages.map((msg) => {
                // An empty streaming placeholder is represented by the typing
                // bubble below instead of a blank assistant bubble.
                if (msg.role === "assistant" && msg.isStreaming && !msg.content) return null;
                return (
                <div 
                  key={msg.id} 
                  className={`${styles.messageWrapper} ${msg.role === 'user' ? styles.wrapperUser : styles.wrapperAi}`}
                >
                  {msg.role === 'assistant' && (
                    <div className={styles.avatarAi}>A</div>
                  )}
                  <div className={`${styles.messageBubble} ${msg.role === 'user' ? styles.bubbleUser : styles.bubbleAi}`}>
                    {renderMessageContent(msg as any)}
                  </div>
                </div>
                );
              })}
              {showTyping && (
                <div className={`${styles.messageWrapper} ${styles.wrapperAi}`}>
                  <div className={styles.avatarAi}>A</div>
                  <div className={`${styles.messageBubble} ${styles.typingBubble}`} aria-label="Copilot is typing">
                    <span className={styles.typingDot} />
                    <span className={styles.typingDot} />
                    <span className={styles.typingDot} />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className={styles.inputArea}>
          {error && (
            <div className={styles.errorBanner}>
              {error}
            </div>
          )}
          <form className={styles.inputForm} onSubmit={handleSend}>
            <Input 
              className={styles.chatInput}
              placeholder="Describe your research idea..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              disabled={isStreaming}
            />
            <Button 
              type="submit" 
              size="icon-md" 
              variant={inputValue.trim() && !isStreaming ? "primary" : "secondary"}
              disabled={!inputValue.trim() || isStreaming}
              className={styles.sendBtn}
            >
              <Send size={16} />
            </Button>
          </form>
          <div className={styles.inputFooter}>
            Ananke orchestrator determines execution logic based on provided context. Computations happen external to the client.
          </div>
        </div>
      </main>
    </div>
  );
}