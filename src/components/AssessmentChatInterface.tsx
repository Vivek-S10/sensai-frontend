import React, { useState, useRef, useEffect } from 'react';
import { Upload, X, Send, Bot, User, FileText, ArrowRight } from 'lucide-react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

// Define the workerSrc
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
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isGenerating]);

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
                const pdfContext = `[PDF EXTRACED CONTENT: ${file.name}]\n` + extractedText;
                setInput((prev) => prev ? prev + '\n\n' + pdfContext : pdfContext);
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

    const triggerFileInput = () => {
        fileInputRef.current?.click();
    };

    const parseJSONStream = async (response: Response) => {
        if (!response.body) throw new Error('ReadableStream not yet supported in this browser.');
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        let rawText = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            
            // The AI returns ndjson (Newline Delimited JSON)
            const jsonLines = chunk.split('\n').filter(line => line.trim() !== '');
            for (const line of jsonLines) {
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.response) { // The Pydantic model response format
                        rawText = parsed.response;
                        
                        setMessages(prev => {
                            const newMessages = [...prev];
                            const lastMessageIndex = newMessages.length - 1;
                            if (lastMessageIndex >= 0 && newMessages[lastMessageIndex].role === 'assistant') {
                                newMessages[lastMessageIndex].content = rawText;
                            } else {
                                newMessages.push({ role: 'assistant', content: rawText });
                            }
                            return newMessages;
                        });
                    }
                } catch (e) {
                    console.log("Error parsing chunk", line);
                }
            }
        }
    };

    const handleSubmit = async () => {
        if (!input.trim() || isGenerating) return;

        const userMessage = input;
        setInput('');
        
        // Add user message to UI immediately
        const newMessagesList = [...messages, { role: 'user' as const, content: userMessage }];
        setMessages(newMessagesList);
        setIsGenerating(true);

        try {
            // Include user_id, which we normally get from context, but we will fetch from localStorage for now
            // or we could pass user_id down from a higher level component.
            // Using a dummy user_id 1 since this is an admin dashboard currently relying on auth context
            const requestBody = {
                task_id: parseInt(taskId),
                user_id: 1, // Placeholder
                new_message: userMessage,
                chat_history: messages
            };

            const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8001';
            const response = await fetch(`${backendUrl}/ai/assessment/topics-chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                throw new Error("Failed to send request");
            }

            await parseJSONStream(response);
            
        } catch (error) {
            console.error("Error during chat stream:", error);
            // Append error message
            setMessages(prev => [...prev, { role: 'assistant', content: "Sorry, I encountered an error. Please try again." }]);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };
    
    const handleGenerateQuestions = async () => {
        setIsGeneratingDeepQuestions(true);
        try {
            const requestBody = {
                task_id: parseInt(taskId),
                user_id: 1, // Placeholder
                new_message: "", // Empty for generating questions
                chat_history: messages
            };

            const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8001';
            const response = await fetch(`${backendUrl}/ai/assessment/generate-questions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                throw new Error("Failed to generate questions");
            }

            const generatedQuestions = await response.json();
            onContinueToGenerateQuestions(generatedQuestions);
        } catch (error) {
            console.error("Error generating deep questions:", error);
            alert("Failed to generate questions from curriculum. Please try again.");
        } finally {
            setIsGeneratingDeepQuestions(false);
        }
    };

    // Check if there's at least one assistant message
    const hasAssistantResponse = messages.some(m => m.role === 'assistant');

    return (
        <div className="flex flex-col h-full bg-[#f5f5f5] dark:bg-[#1A1A1A]">
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center max-w-2xl mx-auto space-y-6">
                        <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-2xl flex items-center justify-center">
                            <Bot className="w-8 h-8 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">Curriculum Extractor</h2>
                            <p className="text-gray-500 dark:text-gray-400">
                                Paste your curriculum, topics, or Job Description below. Or upload a PDF. 
                                I will extract the key themes and suggest a relative weightage for question generation.
                            </p>
                        </div>
                    </div>
                ) : (
                    messages.map((message, index) => (
                        <div 
                            key={index} 
                            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                            <div className={`flex max-w-[80%] ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                                    message.role === 'user' 
                                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 ml-3' 
                                        : 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 mr-3'
                                }`}>
                                    {message.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                                </div>
                                <div className={`px-4 py-3 rounded-2xl ${
                                    message.role === 'user' 
                                        ? 'bg-blue-600 text-white rounded-tr-sm' 
                                        : 'bg-white dark:bg-[#2A2A2A] text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-800 rounded-tl-sm shadow-sm'
                                }`}>
                                    {message.role === 'assistant' ? (
                                        // A simple display for markdown formatted text
                                        <div className="prose dark:prose-invert max-w-none prose-sm">
                                            {message.content.split('\n').map((line, i) => (
                                                <p key={i} className="mb-1">{line}</p>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="whitespace-pre-wrap text-sm">{message.content}</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
                {isGenerating && (
                    <div className="flex justify-start">
                        <div className="flex flex-row max-w-[80%]">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 mr-3 flex items-center justify-center">
                                <Bot size={16} />
                            </div>
                            <div className="px-5 py-4 rounded-2xl bg-white dark:bg-[#2A2A2A] border border-gray-200 dark:border-gray-800 rounded-tl-sm shadow-sm flex items-center space-x-2">
                                <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                                <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                                <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {hasAssistantResponse && (
                <div className="px-6 pb-2 text-center">
                    <button 
                        onClick={handleGenerateQuestions}
                        disabled={isGeneratingDeepQuestions}
                        className="inline-flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-full transition-colors cursor-pointer disabled:opacity-50"
                    >
                        {isGeneratingDeepQuestions ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white rounded-full border-t-transparent animate-spin mr-2" />
                                Generating Questions...
                            </>
                        ) : (
                            <>
                                Continue with Question Generation
                                <ArrowRight size={16} className="ml-2" />
                            </>
                        )}
                    </button>
                </div>
            )}

            <div className="p-4 bg-white dark:bg-[#111] border-t border-gray-200 dark:border-gray-800">
                <div className="max-w-4xl mx-auto flex items-end gap-2 bg-gray-100 dark:bg-[#1A1A1A] p-2 rounded-2xl border border-gray-200 dark:border-gray-800 focus-within:ring-2 focus-within:ring-purple-500/50">
                    <div className="relative">
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept="application/pdf"
                            className="hidden"
                        />
                        <button
                            onClick={triggerFileInput}
                            disabled={isGenerating || fileExtracting}
                            className="p-3 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-xl hover:bg-gray-200 dark:hover:bg-[#2A2A2A] transition-colors disabled:opacity-50 cursor-pointer"
                            title="Upload PDF"
                        >
                            {fileExtracting ? (
                                <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                            ) : (
                                <Upload size={20} />
                            )}
                        </button>
                    </div>

                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type curriculum or upload PDF..."
                        className="flex-1 max-h-32 min-h-[44px] py-3 bg-transparent text-gray-900 dark:text-white placeholder-gray-500 outline-none resize-none hide-scrollbar text-sm"
                        disabled={isGenerating}
                        rows={1}
                        style={{ height: 'auto' }}
                    />

                    <button
                        onClick={handleSubmit}
                        disabled={!input.trim() || isGenerating}
                        className="p-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                        <Send size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
}
