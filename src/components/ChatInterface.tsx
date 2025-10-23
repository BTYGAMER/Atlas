import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import backgroundImage from "@/assets/background.png";
import aiAssistantIcon from "@/assets/ai-assistant-icon.png";

type Message = { role: "user" | "assistant"; content: string };
type BrowserTab = { id: string; url: string; title: string; isExternal?: boolean };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

export const ChatInterface = () => {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<Message[]>([]);
  const [assistantQuery, setAssistantQuery] = useState("");
  const [isAssistantLoading, setIsAssistantLoading] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const assistantMessagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const activeTab = browserTabs.find(tab => tab.id === activeTabId);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    assistantMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [assistantMessages]);

  useEffect(() => {
    if (activeTab) setQuery(activeTab.url);
    else setQuery("");
  }, [activeTabId]);

  const streamChat = async (userMessage: string) => {
    const newMessages = [...messages, { role: "user" as const, content: userMessage }];
    setMessages(newMessages);
    setIsLoading(true);

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const resp = await fetch(CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ messages: newMessages }),
        });

        if (resp.status === 429) {
          attempt++;
          if (attempt < maxRetries) {
            const delay = 700 * attempt; // backoff
            toast({ title: "Rate limited", description: `Retrying in ${Math.round(delay / 1000)}s...` });
            await sleep(delay);
            continue; // retry
          }
          toast({
            title: "Rate limit exceeded",
            description: "Please try again a bit later.",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }

        if (resp.status === 402) {
          toast({
            title: "Out of credits",
            description: "Please add credits to your Lovable AI workspace.",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }

        if (!resp.ok || !resp.body) throw new Error("Failed to start stream");

        // Inform user if we switched to a cheaper model
        const modelUsed = resp.headers.get("x-model-used");
        if (modelUsed && modelUsed.includes("flash-lite")) {
          toast({ title: "Economy mode", description: "Using Gemini Flash Lite to avoid credit limits." });
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";
        let streamDone = false;
        let assistantContent = "";

        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) break;
          textBuffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
            let line = textBuffer.slice(0, newlineIndex);
            textBuffer = textBuffer.slice(newlineIndex + 1);

            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line.startsWith(":") || line.trim() === "") continue;
            if (!line.startsWith("data: ")) continue;

            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") { streamDone = true; break; }

            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content as string | undefined;
              if (content) {
                assistantContent += content;
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "assistant") {
                    return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantContent } : m));
                  }
                  return [...prev, { role: "assistant", content: assistantContent }];
                });
              }
            } catch {
              textBuffer = line + "\n" + textBuffer;
              break;
            }
          }
        }

        setIsLoading(false);
        return; // success, exit function
      } catch (error) {
        console.error("Chat error attempt", attempt + 1, error);
        attempt++;
        if (attempt >= maxRetries) {
          toast({ title: "Error", description: "Failed to send message. Please try again.", variant: "destructive" });
          setIsLoading(false);
          return;
        }
        await sleep(500 * attempt);
      }
    }
  };

  const openNewTab = (url: string) => {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    
    // Check if site is known to block embedding
    const hostname = new URL(fullUrl).hostname.toLowerCase();
    const blocksEmbedding = [
      'amazon.com', 'google.com', 'facebook.com', 'twitter.com', 'x.com',
      'instagram.com', 'youtube.com', 'netflix.com', 'github.com',
      'linkedin.com', 'reddit.com', 'tiktok.com'
    ].some(blocked => hostname === blocked || hostname.endsWith(`.${blocked}`));
    
    if (blocksEmbedding) {
      openInExternalTab(fullUrl);
      return;
    }
    
    const newTab: BrowserTab = {
      id: Date.now().toString(),
      url: fullUrl,
      title: hostname,
      isExternal: false
    };
    setBrowserTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    
  };

  const openInExternalTab = (url: string) => {
    window.open(url, '_blank');
    toast({
      title: "Opened in new tab",
      description: "This site blocks embedding and was opened in a new browser tab.",
    });
  };

  const closeTab = (tabId: string) => {
    setBrowserTabs(prev => {
      const filtered = prev.filter(tab => tab.id !== tabId);
      if (activeTabId === tabId && filtered.length > 0) {
        setActiveTabId(filtered[filtered.length - 1].id);
      } else if (filtered.length === 0) {
        setActiveTabId(null);
      }
      return filtered;
    });
  };

  const streamAssistantChat = async (userMessage: string) => {
    const systemPrompt = `You are a helpful AI assistant that helps users navigate and understand websites. The user is currently viewing: ${activeTab?.url || 'a website'}. Help them find information, explain features, and guide them through the site.`;
    
    const newMessages = [
      { role: "system" as const, content: systemPrompt },
      ...assistantMessages,
      { role: "user" as const, content: userMessage }
    ];
    setAssistantMessages([...assistantMessages, { role: "user" as const, content: userMessage }]);
    setIsAssistantLoading(true);

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (resp.status === 429) {
        toast({ title: "Rate limited", description: "Please try again later.", variant: "destructive" });
        setIsAssistantLoading(false);
        return;
      }

      if (resp.status === 402) {
        toast({ title: "Out of credits", description: "Please add credits.", variant: "destructive" });
        setIsAssistantLoading(false);
        return;
      }

      if (!resp.ok || !resp.body) throw new Error("Failed to start stream");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let streamDone = false;
      let assistantContent = "";

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantContent += content;
              setAssistantMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantContent } : m));
                }
                return [...prev, { role: "assistant", content: assistantContent }];
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      setIsAssistantLoading(false);
    } catch (error) {
      console.error("Assistant chat error:", error);
      toast({ title: "Error", description: "Failed to send message.", variant: "destructive" });
      setIsAssistantLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;
    
    // Check if input is a URL
    const urlPattern = /^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/.*)?$/i;
    const trimmedQuery = query.trim();
    
    if (urlPattern.test(trimmedQuery)) {
      openNewTab(trimmedQuery);
      setQuery("");
      return;
    }
    
    streamChat(query);
    setQuery("");
  };

  const handleAssistantSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assistantQuery.trim() || isAssistantLoading) return;
    streamAssistantChat(assistantQuery);
    setAssistantQuery("");
  };

  return (
    <div 
      className="flex min-h-screen items-center justify-center" 
      style={{ 
        backgroundImage: `url(${backgroundImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
      }}
    >
      <div className="w-full max-w-3xl px-4">
        {/* Browser Chrome */}
        <div className="rounded-t-xl bg-card p-4 shadow-lg">
          {/* Tabs */}
          {browserTabs.length > 0 && (
            <div className="flex items-center gap-2 mb-4">
              <div className="flex gap-2">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div className="h-3 w-3 rounded-full bg-yellow-400" />
                <div className="h-3 w-3 rounded-full bg-green-400" />
              </div>
              <div className="flex gap-1 flex-1 overflow-x-auto">
                {browserTabs.map(tab => (
                  <div
                    key={tab.id}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1 rounded-t text-sm cursor-pointer min-w-[120px] max-w-[200px]",
                      activeTabId === tab.id ? "bg-background" : "bg-muted hover:bg-muted/80"
                    )}
                    onClick={() => setActiveTabId(tab.id)}
                  >
                    <Sparkles className="h-3 w-3 shrink-0" />
                    <span className="truncate flex-1">{tab.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      className="hover:bg-background/50 rounded p-0.5"
                    >
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 shrink-0"
                onClick={() => setQuery("")}
              >
                <span className="text-xl">+</span>
              </Button>
            </div>
          )}

          {!browserTabs.length && (
            <div className="flex items-center gap-3 mb-4">
              <div className="flex gap-2">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div className="h-3 w-3 rounded-full bg-yellow-400" />
                <div className="h-3 w-3 rounded-full bg-green-400" />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Sparkles className="h-4 w-4" />
                <span>New Tab</span>
              </div>
            </div>
          )}

          {/* Navigation Bar */}
          <div className="flex items-center gap-2 border-b pb-4">
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M15 18l-6-6 6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M9 18l6-6-6-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
              <Loader2 className="h-4 w-4" />
            </Button>
            <form onSubmit={handleSubmit} className="flex-1">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 text-sm"
                placeholder="Search or enter website"
              />
            </form>
          </div>
        </div>

        {/* Main Content */}
        <div className="rounded-b-xl bg-card shadow-lg relative" style={{ minHeight: "500px", maxHeight: "600px" }}>
          {activeTab ? (
            <>
              <iframe
                src={activeTab.url}
                className="w-full rounded-b-xl"
                style={{ height: "600px", border: "none" }}
                title={activeTab.title}
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
              />
              
              {/* AI Assistant Button */}
              <button
                onClick={() => setAssistantOpen(!assistantOpen)}
                className="absolute top-4 right-4 h-14 w-14 rounded-2xl shadow-xl hover:scale-105 transition-transform overflow-hidden bg-white z-10"
              >
                <img src={aiAssistantIcon} alt="AI Assistant" className="h-full w-full object-cover" />
              </button>

              {/* AI Assistant Panel */}
              {assistantOpen && (
                <div className="absolute top-0 right-0 h-full w-96 bg-card border-l shadow-2xl rounded-br-xl overflow-hidden flex flex-col">
                  {/* Header */}
                  <div className="flex items-center justify-between p-4 border-b bg-primary/5">
                    <div className="flex items-center gap-2">
                      <img src={aiAssistantIcon} alt="AI Assistant" className="h-8 w-8 rounded-lg" />
                      <div>
                        <h3 className="font-semibold text-sm">AI Assistant</h3>
                        <p className="text-xs text-muted-foreground">Navigating: {activeTab.title}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setAssistantOpen(false)}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M18 6L6 18M6 6l12 12" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </Button>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {assistantMessages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-center p-6">
                        <img src={aiAssistantIcon} alt="AI Assistant" className="h-16 w-16 mb-4 rounded-xl" />
                        <h4 className="font-semibold mb-2">How can I help?</h4>
                        <p className="text-sm text-muted-foreground">
                          Ask me anything about this website, and I'll help you navigate and understand it.
                        </p>
                      </div>
                    ) : (
                      <>
                        {assistantMessages.map((msg, idx) => (
                          <div
                            key={idx}
                            className={cn(
                              "flex gap-2",
                              msg.role === "user" ? "justify-end" : "justify-start"
                            )}
                          >
                            {msg.role === "assistant" && (
                              <img src={aiAssistantIcon} alt="AI" className="h-6 w-6 rounded-lg shrink-0 mt-1" />
                            )}
                            <div
                              className={cn(
                                "rounded-xl px-3 py-2 max-w-[85%] text-sm",
                                msg.role === "user"
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted"
                              )}
                            >
                              <p className="whitespace-pre-wrap">{msg.content}</p>
                            </div>
                          </div>
                        ))}
                        {isAssistantLoading && assistantMessages[assistantMessages.length - 1]?.role === "user" && (
                          <div className="flex gap-2 justify-start">
                            <img src={aiAssistantIcon} alt="AI" className="h-6 w-6 rounded-lg shrink-0 mt-1" />
                            <div className="rounded-xl px-3 py-2 bg-muted">
                              <Loader2 className="h-4 w-4 animate-spin" />
                            </div>
                          </div>
                        )}
                        <div ref={assistantMessagesEndRef} />
                      </>
                    )}
                  </div>

                  {/* Input */}
                  <div className="border-t p-3">
                    <form onSubmit={handleAssistantSubmit}>
                      <div className="flex items-center gap-2 rounded-lg border bg-background p-2">
                        <Input
                          value={assistantQuery}
                          onChange={(e) => setAssistantQuery(e.target.value)}
                          disabled={isAssistantLoading}
                          className="border-0 bg-transparent p-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
                          placeholder="Ask about this website..."
                        />
                        <Button
                          type="submit"
                          size="icon"
                          disabled={!assistantQuery.trim() || isAssistantLoading}
                          className="h-8 w-8 rounded-full"
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12" style={{ minHeight: "400px" }}>
              {/* OpenAI Logo */}
              <div className="mb-12">
                <svg className="h-16 w-16 text-primary opacity-50" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.282 9.821a5.985 5.985 0 00-.516-4.91 6.046 6.046 0 00-6.51-2.9A6.065 6.065 0 004.981 4.18a5.985 5.985 0 00-3.998 2.9 6.046 6.046 0 00.743 7.097 5.98 5.98 0 00.51 4.911 6.051 6.051 0 006.515 2.9A5.985 5.985 0 0013.26 24a6.056 6.056 0 005.772-4.206 5.99 5.99 0 003.997-2.9 6.056 6.056 0 00-.747-7.073zM13.26 22.43a4.476 4.476 0 01-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 00.392-.681v-6.737l2.02 1.168a.071.071 0 01.038.052v5.583a4.504 4.504 0 01-4.494 4.494zM3.6 18.304a4.47 4.47 0 01-.535-3.014l.142.085 4.783 2.759a.771.771 0 00.78 0l5.843-3.369v2.332a.08.08 0 01-.033.062L9.74 19.95a4.5 4.5 0 01-6.14-1.646zM2.34 7.896a4.485 4.485 0 012.366-1.973V11.6a.766.766 0 00.388.676l5.815 3.355-2.02 1.168a.076.076 0 01-.071 0l-4.83-2.786A4.504 4.504 0 012.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 01.071 0l4.83 2.791a4.494 4.494 0 01-.676 8.105v-5.678a.79.79 0 00-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 00-.785 0L9.409 9.23V6.897a.066.066 0 01.028-.061l4.83-2.787a4.5 4.5 0 016.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 01-.038-.057V6.075a4.5 4.5 0 017.375-3.453l-.142.08L8.704 5.46a.795.795 0 00-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
                </svg>
              </div>

              {/* Search Box */}
              <form onSubmit={handleSubmit} className="w-full">
                <div className="flex items-center gap-2 rounded-lg border bg-background p-3 shadow-sm">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="border-0 bg-transparent p-0 text-base focus-visible:ring-0 focus-visible:ring-offset-0"
                    placeholder="Message ChatGPT"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!query.trim() || isLoading}
                    className="h-10 w-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <ArrowRight className="h-5 w-5" />
                  </Button>
                </div>
              </form>
            </div>
          ) : (
            <div className="flex flex-col" style={{ height: "500px" }}>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex gap-3",
                      msg.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {msg.role === "assistant" && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <Sparkles className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div
                      className={cn(
                        "rounded-2xl px-4 py-2 max-w-[80%]",
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      )}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    </div>
                    {msg.role === "user" && (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold text-sm">
                        U
                      </div>
                    )}
                  </div>
                ))}
                {isLoading && messages[messages.length - 1]?.role === "user" && (
                  <div className="flex gap-3 justify-start">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                    <div className="rounded-2xl px-4 py-2 bg-muted">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Box */}
              <div className="border-t p-4">
                <form onSubmit={handleSubmit}>
                  <div className="flex items-center gap-2 rounded-lg border bg-background p-3">
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      disabled={isLoading}
                      className="border-0 bg-transparent p-0 text-base focus-visible:ring-0 focus-visible:ring-offset-0"
                      placeholder="Message ChatGPT"
                    />
                    <Button
                      type="submit"
                      size="icon"
                      disabled={!query.trim() || isLoading}
                      className="h-10 w-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <ArrowRight className="h-5 w-5" />
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
