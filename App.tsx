import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, FileText, CheckCircle, Languages, AlertCircle, Loader2, Zap, BrainCircuit, History, Download, X, Trash2, Play } from 'lucide-react';
import { SUPPORTED_LANGUAGES } from './constants';
import { AppStatus, UploadedFile, HistoryItem } from './types';
import { translateDocument, generateSpeech, decodeAudioData } from './services/geminiService';
import AudioPlayer from './components/AudioPlayer';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [targetLang, setTargetLang] = useState<string>('en');
  const [processingMode, setProcessingMode] = useState<'speed' | 'detailed'>('speed');
  const [translatedText, setTranslatedText] = useState<string>('');
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isCompressing, setIsCompressing] = useState<boolean>(false);
  
  // History State
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load history on mount
  useEffect(() => {
    const saved = localStorage.getItem('docuvoice_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse history");
      }
    }
  }, []);

  const saveHistory = (newItem: HistoryItem) => {
    const updated = [newItem, ...history].slice(0, 20); // Keep last 20
    setHistory(updated);
    localStorage.setItem('docuvoice_history', JSON.stringify(updated));
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = history.filter(h => h.id !== id);
    setHistory(updated);
    localStorage.setItem('docuvoice_history', JSON.stringify(updated));
  };

  const loadHistoryItem = (item: HistoryItem) => {
    setTranslatedText(item.text);
    setTargetLang(item.targetLanguage); // Or find the code corresponding to the name
    setFile({ name: item.fileName, type: 'application/pdf', data: '' }); // Placeholder
    setAudioBuffer(null); // Clear audio as we don't save it
    setStatus(AppStatus.READY);
    setShowHistory(false);
  };

  const downloadTranslation = () => {
    const element = document.createElement("a");
    const file = new Blob([translatedText], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = `translation-${Date.now()}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Compress image to reduce upload size and processing time
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          // Max dimension 1024px is sufficient for OCR
          const MAX_WIDTH = 1024;
          const MAX_HEIGHT = 1024;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          
          if (ctx) {
             // Fill white background for transparent images (e.g. PNGs) to ensure text is black on white
             ctx.fillStyle = 'white';
             ctx.fillRect(0, 0, width, height);
             ctx.drawImage(img, 0, 0, width, height);
          }
          
          // Compress to JPEG 0.7 quality
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          resolve(dataUrl.split(',')[1]);
        };
        img.onerror = (err) => reject(new Error("Failed to load image"));
      };
      reader.onerror = (err) => reject(new Error("Failed to read file"));
    });
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (selectedFile.size > 10 * 1024 * 1024) { // 10MB limit
      setErrorMsg("File is too large. Please select a file under 10MB.");
      return;
    }

    try {
      setErrorMsg('');
      setStatus(AppStatus.IDLE);
      setAudioBuffer(null);
      setTranslatedText('');
      setFile(null);
      
      let base64Data = '';
      let fileType = selectedFile.type;

      // Optimizing images for faster processing
      if (selectedFile.type.startsWith('image/')) {
        setIsCompressing(true);
        try {
          base64Data = await compressImage(selectedFile);
          fileType = 'image/jpeg'; // We convert to JPEG
        } catch (e) {
          console.error("Compression failed, using original", e);
          // Fallback to original
           const reader = new FileReader();
           base64Data = await new Promise((resolve) => {
              reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
              reader.readAsDataURL(selectedFile);
           });
        }
        setIsCompressing(false);
      } else {
        // Handle PDF or other types
        const reader = new FileReader();
        base64Data = await new Promise((resolve) => {
            reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
            reader.readAsDataURL(selectedFile);
        });
      }

      setFile({
        name: selectedFile.name,
        type: fileType,
        data: base64Data,
      });

    } catch (err) {
      setIsCompressing(false);
      setErrorMsg("Error processing file.");
    }
  };

  const generateAudioOnly = async () => {
    if (!translatedText) return;
    try {
      setStatus(AppStatus.GENERATING_AUDIO);
      const audioBase64 = await generateSpeech(translatedText);
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const buffer = await decodeAudioData(audioBase64, audioCtx);
      setAudioBuffer(buffer);
      setStatus(AppStatus.READY);
      if (audioCtx.state !== 'closed') audioCtx.close();
    } catch (err) {
      console.error(err);
      setStatus(AppStatus.READY); // Go back to ready but with error msg?
      setErrorMsg("Failed to generate audio.");
    }
  };

  const handleProcess = async () => {
    if (!file) return;

    try {
      setErrorMsg('');
      setStatus(AppStatus.TRANSLATING);

      // Step 1: Translate
      const text = await translateDocument(file.data, file.type, targetLang, processingMode);
      setTranslatedText(text);

      setStatus(AppStatus.GENERATING_AUDIO);

      // Step 2: Generate Audio
      const audioBase64 = await generateSpeech(text);
      
      // Step 3: Decode Audio for playback
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const buffer = await decodeAudioData(audioBase64, audioCtx);
      
      setAudioBuffer(buffer);
      setStatus(AppStatus.READY);

      // Save to History
      saveHistory({
        id: Date.now().toString(),
        timestamp: Date.now(),
        fileName: file.name,
        targetLanguage: targetLang,
        text: text
      });
      
      // Clean up temp context used for decoding (AudioPlayer will create its own)
      if (audioCtx.state !== 'closed') {
        audioCtx.close();
      }

    } catch (err) {
      console.error(err);
      setStatus(AppStatus.ERROR);
      setErrorMsg(err instanceof Error ? err.message : "An unexpected error occurred.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-10 px-4 sm:px-6 lg:px-8 relative overflow-x-hidden">
      {/* Header */}
      <header className="max-w-3xl w-full flex items-center justify-between mb-10 relative z-10">
        <div></div> {/* Spacer */}
        <div className="text-center">
          <h1 className="text-4xl font-extrabold text-indigo-900 mb-2 tracking-tight">
            DocuVoice
          </h1>
          <p className="text-lg text-slate-600 hidden sm:block">
            Upload, Translate, and Listen.
          </p>
        </div>
        <button 
          onClick={() => setShowHistory(true)}
          className="p-3 bg-white text-slate-600 rounded-full shadow-md hover:bg-slate-50 transition-transform hover:scale-105 border border-slate-200"
          title="History"
        >
          <History size={24} />
        </button>
      </header>

      {/* History Sidebar */}
      <div 
        className={`fixed inset-y-0 right-0 w-full sm:w-80 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out z-50 border-l border-slate-200 flex flex-col ${
          showHistory ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <History size={20} /> History
          </h2>
          <button onClick={() => setShowHistory(false)} className="text-slate-500 hover:text-slate-800">
            <X size={24} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {history.length === 0 ? (
            <div className="text-center text-slate-400 py-10">
              <p>No translation history yet.</p>
            </div>
          ) : (
            history.map((item) => (
              <div 
                key={item.id} 
                onClick={() => loadHistoryItem(item)}
                className="bg-white border border-slate-200 rounded-xl p-4 cursor-pointer hover:border-indigo-400 hover:shadow-md transition-all group"
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold text-slate-800 text-sm truncate w-40">{item.fileName}</h3>
                  <button 
                    onClick={(e) => deleteHistoryItem(item.id, e)}
                    className="text-slate-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
                  <span className="bg-slate-100 px-2 py-1 rounded-md">{item.targetLanguage}</span>
                  <span>{new Date(item.timestamp).toLocaleDateString()}</span>
                </div>
                <p className="text-sm text-slate-600 line-clamp-2 italic">
                  "{item.text.substring(0, 60)}..."
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Overlay for mobile when history is open */}
      {showHistory && (
        <div 
          className="fixed inset-0 bg-black/20 z-40 backdrop-blur-sm"
          onClick={() => setShowHistory(false)}
        />
      )}

      <main className="max-w-3xl w-full bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-200 relative z-0">
        
        {/* Step 1: Upload */}
        <div className="p-8 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
            <span className="bg-slate-100 p-2 rounded-lg text-slate-600"><Upload size={20} /></span>
            1. Upload Document
          </h2>
          
          <div 
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer relative
              ${file ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'}`}
            onClick={() => !isCompressing && fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={handleFileChange}
              disabled={isCompressing}
            />
            
            {isCompressing ? (
              <div className="flex flex-col items-center py-4">
                <Loader2 size={48} className="text-indigo-600 animate-spin mb-2" />
                <p className="font-medium text-indigo-900">Optimizing image...</p>
              </div>
            ) : file ? (
              <div className="flex flex-col items-center">
                <FileText size={48} className="text-indigo-600 mb-2" />
                <p className="font-medium text-indigo-900">{file.name}</p>
                <p className="text-sm text-indigo-600 mt-1">Click to change file</p>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <Upload size={48} className="text-slate-300 mb-2" />
                <p className="font-medium text-slate-700">Click to upload Bill or Document</p>
                <p className="text-sm text-slate-400 mt-1">Supports PDF, JPG, PNG</p>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Language Selection */}
        <div className="p-8 border-b border-slate-100 bg-slate-50/50">
           <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
            <span className="bg-slate-100 p-2 rounded-lg text-slate-600"><Languages size={20} /></span>
            2. Choose Language
          </h2>
          
          <div className="relative">
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="w-full appearance-none bg-white border border-slate-300 text-slate-700 py-4 px-4 pr-8 rounded-xl leading-tight focus:outline-none focus:bg-white focus:border-indigo-500 font-medium text-lg shadow-sm"
              disabled={status === AppStatus.TRANSLATING || status === AppStatus.GENERATING_AUDIO}
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.name}>
                  {lang.nativeName} ({lang.name})
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-500">
              <Languages size={16} />
            </div>
          </div>
        </div>

        {/* Action Button & Mode Selection */}
        <div className="p-8">
          {errorMsg && (
            <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-2 border border-red-100">
              <AlertCircle size={20} />
              {errorMsg}
            </div>
          )}

          {status === AppStatus.READY ? (
             <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-8">
                {/* Audio Player */}
                {audioBuffer ? (
                  <AudioPlayer audioBuffer={audioBuffer} />
                ) : (
                  <div className="bg-indigo-50 rounded-xl p-6 border border-indigo-100 text-center">
                    <p className="text-indigo-900 mb-4 font-medium">Viewing history. Generate audio to listen?</p>
                    <button 
                      onClick={generateAudioOnly}
                      className="bg-indigo-600 text-white px-6 py-3 rounded-full font-bold shadow-md hover:bg-indigo-700 flex items-center justify-center gap-2 mx-auto transition-transform hover:scale-105"
                    >
                      <Play size={20} fill="currentColor" /> Generate Audio
                    </button>
                  </div>
                )}
                
                {/* Translated Text Display */}
                <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Translated Content</h3>
                    <button 
                      onClick={downloadTranslation}
                      className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 text-sm font-medium hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Download size={16} /> Download Text
                    </button>
                  </div>
                  <div className="prose prose-slate max-w-none text-slate-800 text-lg leading-relaxed whitespace-pre-wrap selection:bg-indigo-200 selection:text-indigo-900">
                    {translatedText}
                  </div>
                </div>

                <button 
                  onClick={() => {
                    setStatus(AppStatus.IDLE);
                    setTranslatedText('');
                    setAudioBuffer(null);
                    setFile(null);
                  }}
                  className="w-full py-4 bg-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-300 transition-colors"
                >
                  Start Over
                </button>
             </div>
          ) : (
            <>
              {/* Mode Selection */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <button 
                  onClick={() => setProcessingMode('speed')}
                  disabled={!file || status !== AppStatus.IDLE}
                  className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all ${
                    processingMode === 'speed' 
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700' 
                      : 'border-slate-200 hover:border-indigo-300 text-slate-600'
                  } ${(!file || status !== AppStatus.IDLE) ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Zap size={24} className={processingMode === 'speed' ? 'fill-indigo-200' : ''} />
                  <div className="text-center">
                    <span className="block font-bold text-sm">Fast</span>
                    <span className="block text-xs opacity-75">Best for printed text</span>
                  </div>
                </button>
                <button 
                  onClick={() => setProcessingMode('detailed')}
                  disabled={!file || status !== AppStatus.IDLE}
                  className={`p-4 rounded-xl border-2 flex flex-col items-center justify-center gap-2 transition-all ${
                    processingMode === 'detailed' 
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700' 
                      : 'border-slate-200 hover:border-indigo-300 text-slate-600'
                  } ${(!file || status !== AppStatus.IDLE) ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <BrainCircuit size={24} className={processingMode === 'detailed' ? 'fill-indigo-200' : ''} />
                  <div className="text-center">
                    <span className="block font-bold text-sm">Deep Reasoning</span>
                    <span className="block text-xs opacity-75">Best for handwriting</span>
                  </div>
                </button>
              </div>

              <button
                onClick={handleProcess}
                disabled={!file || status !== AppStatus.IDLE || isCompressing}
                className={`w-full py-5 rounded-xl text-xl font-bold text-white shadow-lg transition-all transform flex items-center justify-center gap-3
                  ${!file || status !== AppStatus.IDLE || isCompressing
                    ? 'bg-slate-400 cursor-not-allowed opacity-70' 
                    : 'bg-indigo-600 hover:bg-indigo-700 hover:scale-[1.02] hover:shadow-indigo-200'}`}
              >
                {status === AppStatus.IDLE && (
                  <>
                    <CheckCircle size={24} />
                    Translate & Read Aloud
                  </>
                )}
                {status === AppStatus.TRANSLATING && (
                  <>
                    <Loader2 size={24} className="animate-spin" />
                    Analyzing Document...
                  </>
                )}
                {status === AppStatus.GENERATING_AUDIO && (
                  <>
                    <Loader2 size={24} className="animate-spin" />
                    Generating Audio...
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </main>
      
      <footer className="mt-12 text-slate-400 text-sm">
        Powered by Gemini 2.5 & 3 Flash
      </footer>
    </div>
  );
};

export default App;
