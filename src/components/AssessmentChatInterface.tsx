import React, { useState, useRef, useEffect } from 'react';
import { Upload, Send, Bot, User, ChevronDown, Sparkles } from 'lucide-react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
    try {
        GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.min.mjs',
            import.meta.url,
        ).toString();
    } catch (error) {
        console.warn('Could not set PDF worker source:', error);
    }
}

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

interface AssessmentChatInterfaceProps {
    taskId: string;
    onContinueToGenerateQuestions: (questions: any[]) => void;
}

export default function AssessmentChatInterface({ taskId, onContinueToGenerateQuestions }: AssessmentChatInterfaceProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isGeneratingDeepQuestions, setIsGeneratingDeepQuestions] = useState(false);
    const [fileExtracting, setFileExtracting] = useState(false);
    const [agentStatus, setAgentStatus] = useState<string | null>(null);
    const [agentLogs, setAgentLogs] = useState<{title: string, text: string}[]>([]);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isGenerating]);

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 300)}px`;
        }
    }, [input]);

    const handleExtractPdfText = async (file: File): Promise<string> => {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await getDocument(arrayBuffer).promise;
            let fullText = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map((item: any) => item.str).join(' ');
                fullText += pageText + '\n';
            }
            return fullText;
        } catch (error) {
            console.error("Error extracting PDF text:", error);
            throw new Error("Could not extract text from the PDF.");
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0] || null;
        if (file && file.type === 'application/pdf') {
            setFileExtracting(true);
            try {
                const extractedText = await handleExtractPdfText(file);
                const pdfContent = `**[PDF UPLOADED: ${file.name}]**\n\n${extractedText.substring(0, 5000)}${extractedText.length > 5000 ? '...' : ''}`;
                
                setMessages(prev => [...prev, {
                    role: 'user',
                    content: `I've uploaded a PDF: ${file.name}. Please analyze the curriculum and extract key skills.`
                }]);
                
                setInput("");
                await sendMessage(pdfContent);
            } catch (err) {
                alert("Failed to parse PDF.");
            } finally {
                setFileExtracting(false);
                if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                }
            }
        } else if (file) {
            alert('Please upload a PDF file.');
        }
    };

    const sendMessage = async (contentToSend: string) => {
        setIsGenerating(true);
        try {
            const requestBody = {
                task_id: parseInt(taskId),
                user_id: 1, 
                new_message: contentToSend,
                chat_history: messages
            };

            const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8001';
            const response = await fetch(`${backendUrl}/ai/assessment/topics-chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) throw new Error("Failed to send request");

            await parseJSONStream(response);
        } catch (error) {
            console.error("Error during chat stream:", error);
            setMessages(prev => [...prev, { role: 'assistant', content: "Sorry, I encountered an error. Please try again." }]);
        } finally {
            setIsGenerating(false);
        }
    };

    const parseJSONStream = async (response: Response) => {
        if (!response.body) throw new Error('ReadableStream not supported.');
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let rawText = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const jsonLines = chunk.split('\n').filter(line => line.trim() !== '');
            
            for (const line of jsonLines) {
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.response) {
                        rawText = parsed.response;
                        setMessages(prev => {
                            const newMessages = [...prev];
                            const lastMsgIdx = newMessages.length - 1;
                            if (lastMsgIdx >= 0 && newMessages[lastMsgIdx].role === 'assistant') {
                                return newMessages.map((m, i) => i === lastMsgIdx ? { ...m, content: rawText } : m);
                            } else {
                                return [...newMessages, { role: 'assistant', content: rawText }];
                            }
                        });
                    }
                } catch (e) {
                    console.error("Stream parse error", e);
                }
            }
        }
    };

    const handleSubmit = () => {
        if (!input.trim() || isGenerating) return;
        const userMsg = input;
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        sendMessage(userMsg);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const handleGenerateQuestions = async () => {
        setIsGeneratingDeepQuestions(true);
        setAgentStatus("Initializing Multi-Agent Pipeline...");
        setAgentLogs([]);
        try {
            const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8001';
            const response = await fetch(`${backendUrl}/ai/assessment/generate-questions-multiagent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_id: parseInt(taskId),
                    user_id: 1,
                    new_message: "",
                    chat_history: messages
                }),
            });

            if (!response.ok) throw new Error("Failed to generate questions");
            if (!response.body) throw new Error("No response body");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let currentBuffer = '';
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    if (currentBuffer.trim()) {
                        try {
                            const parsed = JSON.parse(currentBuffer);
                            if (parsed.status) setAgentStatus(parsed.status);
                            else if (parsed.final_output) onContinueToGenerateQuestions(parsed.final_output);
                        } catch (e) {
                            console.error("Failed to parse final line:", currentBuffer);
                        }
                    }
                    break;
                }
                
                const chunk = decoder.decode(value, { stream: true });
                currentBuffer += chunk;
                
                const lines = currentBuffer.split('\n');
                currentBuffer = lines.pop() || ''; // Keep the last incomplete line in buffer
                
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.log) {
                            setAgentLogs(prev => [...prev, parsed.log]);
                        } else if (parsed.status) {
                            setAgentStatus(parsed.status);
                        } else if (parsed.final_output) {
                            onContinueToGenerateQuestions(parsed.final_output);
                            return;
                        }
                    } catch (e) {
                        console.error("Failed to parse ndjson line:", line);
                    }
                }
            }
        } catch (error) {
            console.error("Error generating deep questions:", error);
            alert("Failed to generate questions.");
        } finally {
            setIsGeneratingDeepQuestions(false);
            setAgentStatus(null);
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#0a0a0a] text-[#e0e0e0] font-sans overflow-hidden md:rounded-xl">
            <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8 space-y-8 scroll-smooth hide-scrollbar">
                <style jsx global>{`
                    .hide-scrollbar::-webkit-scrollbar {
                        display: none;
                    }
                    .hide-scrollbar {
                        -ms-overflow-style: none;
                        scrollbar-width: none;
                    }
                `}</style>
                <div className="max-w-3xl mx-auto space-y-10 pt-4">
                    {messages.map((message, index) => (
                        <div key={index} className="flex gap-4 group">
                            <div className="flex-shrink-0 mt-1">
                                {message.role === 'user' ? (
                                    <div className="w-8 h-8 rounded-lg bg-[#ebaa34] flex items-center justify-center overflow-hidden">
                                        <User className="w-5 h-5 text-black/80" />
                                    </div>
                                ) : (
                                    <div className="w-8 h-8 rounded-lg bg-[#27153a] flex items-center justify-center overflow-hidden">
                                        <Bot className="w-5 h-5 text-[#8858c4]" />
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0 pt-1">
                                <div className="text-[15px] leading-relaxed font-normal opacity-90 prose prose-invert max-w-none prose-p:mb-4 last:prose-p:mb-0 prose-a:text-blue-400 prose-table:w-full prose-table:table-auto prose-th:text-left prose-th:font-semibold prose-th:text-[#e0e0e0] prose-th:pb-3 prose-td:py-2 prose-td:text-[#b0b0b0] prose-thead:border-b-0 prose-tbody:border-0 prose-tr:border-b-0 prose-td:align-top">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {message.content}
                                    </ReactMarkdown>
                                </div>
                            </div>
                        </div>
                    ))}
                    {isGenerating && (
                        <div className="flex gap-4">
                            <div className="flex-shrink-0 mt-1">
                                <div className="w-8 h-8 rounded-lg bg-[#27153a] flex items-center justify-center">
                                    <Bot className="w-5 h-5 text-[#8858c4]" />
                                </div>
                            </div>
                            <div className="flex-1 min-w-0 pt-1 flex items-center h-8">
                                <div className="flex gap-1.5 px-2">
                                    <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                                    <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                                    <div className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" />
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} className="h-4" />
                </div>
            </div>

            <div className="px-4 pb-6 pt-2 bg-[#0a0a0a]">
                <div className="max-w-3xl mx-auto flex flex-col gap-2">
                    <div className="relative bg-[#1a1a1c] rounded-xl border border-[#2e2e30] p-1 flex flex-col">
                        <textarea
                            ref={textareaRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Message Alice..."
                            className="w-full bg-transparent text-white placeholder:text-[#6a6a6c] outline-none resize-none px-4 py-3 min-h-[50px] max-h-[200px] text-[15px] leading-relaxed hide-scrollbar"
                            disabled={isGenerating}
                            rows={1}
                        />
                        
                        <div className="flex items-center justify-between px-2 pb-2 mt-1">
                            <div className="flex items-center">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileChange}
                                    accept="application/pdf"
                                    className="hidden"
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isGenerating || fileExtracting}
                                    className="p-1.5 text-[#a3a3a5] hover:text-white bg-[#2a2a2c] hover:bg-[#323234] rounded-lg transition-colors flex items-center gap-2"
                                >
                                    {fileExtracting ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Sparkles className="w-4 h-4" />}
                                </button>
                            </div>
                            <button
                                onClick={handleSubmit}
                                disabled={!input.trim() || isGenerating}
                                className="p-1.5 text-[#5e5e60] disabled:text-[#3a3a3c] bg-[#1a1a1c] disabled:bg-transparent hover:bg-[#2a2a2c] hover:text-white rounded-lg transition-colors border border-transparent hover:border-[#323234] disabled:border-transparent flex items-center justify-center cursor-pointer disabled:cursor-not-allowed"
                            >
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                    
                    
                </div>
                
                {agentLogs.length > 0 && (
                    <div className="max-w-3xl mx-auto mt-6 bg-[#1a1a1a] rounded-xl border border-[#333] p-4 overflow-hidden">
                        <h3 className="text-sm font-semibold text-[#ebaa34] mb-3 flex items-center gap-2">
                            <Bot className="w-4 h-4" /> Multi-Agent Reasoning Logs
                        </h3>
                        <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                            {agentLogs.map((log, i) => (
                                <div key={i} className="bg-[#242424] rounded-lg p-3 border border-[#444]">
                                    <h4 className="text-xs text-[#a0a0a0] font-medium mb-1 uppercase tracking-wider">{log.title}</h4>
                                    <div className="text-sm text-[#d0d0d0] whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                                        {log.text}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {messages.length > 0 && (
                    <div className="max-w-3xl mx-auto flex justify-center mt-6">
                        <button 
                            onClick={handleGenerateQuestions}
                            disabled={isGeneratingDeepQuestions}
                            className="text-sm bg-[#52528c] hover:bg-[#6060c2] text-white px-4 py-2 rounded-md transition-colors font-medium flex items-center gap-2 max-w-[600px]"
                        >
                            {isGeneratingDeepQuestions ? (
                                <>
                                    <Sparkles className="w-4 h-4 animate-spin" />
                                    {agentStatus || 'Processing...'}
                                </>
                            ) : 'Generate Questions with Multi-Agent Review'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
