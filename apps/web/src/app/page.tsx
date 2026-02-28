"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Upload, FileText, CheckCircle2, Loader2, Plus, ArrowRight, Wallet, PieChart, Landmark, Sun, Moon, X, LogOut } from "lucide-react";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import imageCompression from 'browser-image-compression';

// 유틸리티 함수
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ParsedReceipt {
  id?: string;
  merchantName?: string;
  amount?: number;
  paidAt?: string;
  rawText?: string;
  category?: string;
  memo?: string;
  imageOriginalUrl?: string;
}

interface DashboardStats {
  totalAmount: number;
  count: number;
  categorySummary: Record<string, number>;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [result, setResult] = useState<ParsedReceipt | null>(null);

  const [user, setUser] = useState<{ name?: string, email?: string, role?: string } | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentReceipts, setRecentReceipts] = useState<ParsedReceipt[]>([]);
  const [viewImageUrl, setViewImageUrl] = useState<string | null>(null);
  
  // Drag and Drop State
  const [isDragging, setIsDragging] = useState(false);

  // const router = useRouter();

  const handleLogout = async () => {
    try {
      await axios.post('/api/auth/logout');
      window.location.href = '/login';
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  const { theme, setTheme } = useTheme();
  const [monthOffset, setMonthOffset] = useState<number>(0);

  const fetchDashboardData = async (offset = monthOffset) => {
    try {
      const targetDate = new Date();
      targetDate.setMonth(targetDate.getMonth() + offset);
      const m = targetDate.getMonth() + 1;
      const y = targetDate.getFullYear();

      const [authRes, statsRes, listRes] = await Promise.all([
        axios.get('/api/auth/me'),
        axios.get(`${API_BASE_URL}/receipts/stats?month=${m}&year=${y}`),
        axios.get(`${API_BASE_URL}/receipts`)
      ]);

      setUser(authRes.data.user);
      setStats(statsRes.data);
      setRecentReceipts(listRes.data.slice(0, 10)); // 최근 10개
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    }
  };

  useEffect(() => {
    fetchDashboardData(monthOffset);
  }, [monthOffset]);

  const processImageForOCR = (file: File | Blob): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Canvas ctx null'));
          
          ctx.drawImage(img, 0, 0);
          
          try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // Grayscale & Contrast (Contrast = 60)
            const contrast = 60;
            const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
            
            for (let i = 0; i < data.length; i += 4) {
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];
              
              const gray = 0.299 * r + 0.587 * g + 0.114 * b;
              
              let finalColor = factor * (gray - 128) + 128;
              if (finalColor > 255) finalColor = 255;
              if (finalColor < 0) finalColor = 0;
              
              data[i] = finalColor;
              data[i + 1] = finalColor;
              data[i + 2] = finalColor;
            }
            
            ctx.putImageData(imageData, 0, 0);
            canvas.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error('Canvas to Blob failed'));
            }, 'image/jpeg', 0.9);
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      try {
        // 1. 먼저 이미지를 압축하여 핸들링하기 쉬운 사이즈로 변환
        const options = {
          maxSizeMB: 0.8,
          maxWidthOrHeight: 1600,
          initialQuality: 0.85,
          useWebWorker: true,
          fileType: "image/jpeg" as string,
        };
        const compressedBlob = await imageCompression(selectedFile, options);
        
        // 2. 압축된 이미지 캔버스에 올려서 흑백화(Grayscale) 및 대비(Contrast) 극대화 처리
        const processedBlob = await processImageForOCR(compressedBlob);
        
        // 3. 최종적으로 추출된 이미지를 업로드용 File 객체로 변환
        const safeName = selectedFile.name.replace(/\.[^/.]+$/, "") + ".jpg";
        const finalFile = new File([processedBlob], safeName, { type: "image/jpeg" });
        
        setFile(finalFile);

        const reader = new FileReader();
        reader.onloadend = () => {
          setPreview(reader.result as string);
        };
        reader.readAsDataURL(finalFile);
        setStatus("idle");
        setResult(null);
      } catch (error) {
        console.error("Image compression failed:", error);
        // Fallback to original
        setFile(selectedFile);
        const reader = new FileReader();
        reader.onloadend = () => {
          setPreview(reader.result as string);
        };
        reader.readAsDataURL(selectedFile);
        setStatus("idle");
        setResult(null);
      }
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setStatus("uploading");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await axios.post(`${API_BASE_URL}/receipts/upload`, formData);
      setResult(response.data.data);
      setStatus("success");
      fetchDashboardData(); // 데이터 로드 후 갱신
    } catch (error: any) {
      console.error("Upload failed:", error);
      alert(error.response?.data?.message || "영수증 인식에 실패했습니다.");
      setStatus("idle");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
        // Create a synthetic event to pass to handleFileChange
        const syntheticEvent = {
            target: { files: [droppedFile] }
        } as unknown as React.ChangeEvent<HTMLInputElement>;
        
        await handleFileChange(syntheticEvent);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans p-4 md:p-8 transition-colors duration-200">
      <header className="max-w-5xl mx-auto mb-8 flex justify-between items-center bg-white/50 dark:bg-zinc-900/50 backdrop-blur-md p-4 rounded-3xl border border-slate-200/60 dark:border-zinc-800/60 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">3초 영수증</h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm">지출 내역을 가장 빠르게 관리하세요</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")} 
            className="w-10 h-10 rounded-full flex items-center justify-center bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
          >
            {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center overflow-hidden">
              <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">{user?.name?.substring(0, 2).toUpperCase() || user?.email?.substring(0, 2).toUpperCase() || 'US'}</span>
            </div>
            <button
              onClick={handleLogout}
              className="w-10 h-10 rounded-full flex items-center justify-center bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
              title="로그아웃"
            >
              <LogOut className="w-4 h-4 ml-0.5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto space-y-6 md:space-y-8">
        {/* 요약 통계 대시보드 */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-indigo-600 dark:bg-indigo-500 text-white p-5 md:p-6 rounded-3xl shadow-lg shadow-indigo-200/50 dark:shadow-none flex flex-col justify-between"
          >
            <div className="flex justify-between items-start">
              <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center">
                <Wallet className="w-5 h-5" />
              </div>
              <div className="flex bg-white/10 p-1 rounded-xl gap-1">
                <button onClick={() => setMonthOffset(-1)} className={cn("px-3 py-1 text-[10px] font-bold rounded-lg transition-colors", monthOffset === -1 ? "bg-white text-indigo-600 dark:bg-zinc-900 dark:text-white" : "text-white/70 hover:bg-white/20")}>지난 달</button>
                <button onClick={() => setMonthOffset(0)} className={cn("px-3 py-1 text-[10px] font-bold rounded-lg transition-colors", monthOffset === 0 ? "bg-white text-indigo-600 dark:bg-zinc-900 dark:text-white" : "text-white/70 hover:bg-white/20")}>이번 달</button>
              </div>
            </div>
            <div className="mt-6">
              <p className="text-sm opacity-80 mb-1">총 지출 금액</p>
              <h3 className="text-2xl font-black">{stats?.totalAmount?.toLocaleString() ?? 0}원</h3>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white dark:bg-zinc-900/80 backdrop-blur-sm p-5 md:p-6 rounded-3xl border border-slate-100 dark:border-zinc-800 shadow-sm flex flex-col justify-between"
          >
            <div className="flex justify-between items-start">
              <div className="w-10 h-10 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-400">
                <FileText className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-6">
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-1">등록된 영수증</p>
              <h3 className="text-2xl font-bold">{stats?.count ?? 0}건</h3>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white dark:bg-zinc-900 p-5 rounded-3xl border border-zinc-100 dark:border-zinc-800 shadow-sm flex flex-col justify-between sm:col-span-2 lg:col-span-1"
          >
            <div className="flex justify-between items-start">
              <div className="w-10 h-10 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-400">
                <PieChart className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-6 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {stats?.categorySummary && Object.keys(stats.categorySummary).length > 0 ? (
                Object.entries(stats.categorySummary).map(([cat, amt]) => (
                  <div key={cat} className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700">
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-bold">{cat}</p>
                    <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">{amt.toLocaleString()}원</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-zinc-400 font-medium">카테고리 정보 없음</p>
              )}
            </div>
          </motion.div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* 등록 영역 */}
          <div className="lg:col-span-3">
            <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 shadow-sm border border-zinc-100 dark:border-zinc-800 sticky top-8">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Plus className="w-5 h-5" />
                영수증 등록
              </h2>

            <label 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "relative flex flex-col items-center justify-center w-full aspect-[4/5] rounded-3xl border-2 border-dashed bg-zinc-50 dark:bg-zinc-800/20 transition-all cursor-pointer overflow-hidden group",
                isDragging
                  ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/20 scale-[1.02]"
                  : preview 
                    ? "border-solid border-indigo-200 dark:border-zinc-700" 
                    : "border-slate-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-zinc-800/50"
              )}>
                {preview ? (
                  <div className="relative w-full h-full">
                    <img src={preview} alt="Receipt Preview" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/30 group-hover:bg-black/50 transition-all flex items-center justify-center">
                      <p className="text-white text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity">다른 파일 선택 또는 드래그</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Upload className="w-6 h-6 text-zinc-500 dark:text-zinc-400" />
                    </div>
                    <div className="text-center px-4">
                      <p className="text-base font-bold text-zinc-700 dark:text-zinc-200">
                        {isDragging ? "여기로 끌어다 놓으세요!" : "영수증 이미지 업로드"}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">터치하거나 파일을 드래그 하세요 (JPG, PNG)</p>
                    </div>
                  </div>
                )}
                <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
              </label>

              <button
                onClick={handleUpload}
                disabled={!file || status === "uploading"}
                className={cn(
                  "w-full mt-6 py-4 min-h-[3.5rem] rounded-2xl font-bold transition-all flex items-center justify-center gap-2",
                  !file || status === "uploading"
                    ? "bg-zinc-200 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-500 cursor-not-allowed"
                    : "bg-indigo-600 dark:bg-indigo-500 text-white hover:bg-indigo-700 dark:hover:bg-indigo-600 shadow-lg shadow-indigo-200/50 dark:shadow-none"
                )}
              >
                {status === "uploading" ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    분석 중...
                  </>
                ) : (
                  <>
                    <FileText className="w-5 h-5" />
                    OCR 인식하기
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 내역 및 결과 영역 */}
          <div className="lg:col-span-2 space-y-8">
            <AnimatePresence mode="wait">
              {status === "success" && result ? (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="bg-white dark:bg-zinc-900/80 backdrop-blur-sm rounded-3xl p-5 md:p-6 shadow-sm border border-slate-100 dark:border-zinc-800"
                >
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold text-sm tracking-tight uppercase">
                      <CheckCircle2 className="w-5 h-5" />
                      인식 완료
                    </div>
                    <span className="text-[10px] md:text-xs bg-indigo-50 dark:bg-zinc-800/80 text-indigo-700 dark:text-zinc-300 px-3 py-1 rounded-full font-bold border border-indigo-100 dark:border-zinc-700">내용 확인 후 저장하세요</span>
                  </div>

                  <div className="space-y-5">
                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10.5px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest pl-1">상호명</label>
                        <input
                          type="text"
                          value={result.merchantName || ""}
                          onChange={(e) => setResult({ ...result, merchantName: e.target.value })}
                          className="w-full px-4 py-3 min-h-[3rem] rounded-2xl border border-slate-200 dark:border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-zinc-950/50 transition-all text-sm font-bold shadow-sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10.5px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest pl-1">금액</label>
                        <input
                          type="number"
                          value={result.amount || 0}
                          onChange={(e) => setResult({ ...result, amount: parseInt(e.target.value) })}
                          className="w-full px-4 py-3 min-h-[3rem] rounded-2xl border border-slate-200 dark:border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-zinc-950/50 transition-all text-sm font-black text-indigo-600 dark:text-indigo-400 shadow-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10.5px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest pl-1">날짜</label>
                        <input
                          type="date"
                          value={result.paidAt ? new Date(result.paidAt).toISOString().split('T')[0] : ""}
                          onChange={(e) => setResult({ ...result, paidAt: e.target.value })}
                          className="w-full px-4 py-3 min-h-[3rem] rounded-2xl border border-slate-200 dark:border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-zinc-950/50 transition-all text-sm font-bold shadow-sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10.5px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest pl-1">용도 (카테고리)</label>
                        <select
                          value={result.category || ""}
                          onChange={(e) => setResult({ ...result, category: e.target.value })}
                          className="w-full px-4 py-3 min-h-[3rem] rounded-2xl border border-slate-200 dark:border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-zinc-950/50 transition-all text-sm font-bold shadow-sm"
                        >
                          <option value="">선택하세요</option>
                          <option value="식대">식대</option>
                          <option value="접대">접대</option>
                          <option value="주유">주유</option>
                          <option value="상품구매">상품구매</option>
                          <option value="교통비">교통비</option>
                          <option value="숙박비">숙박비</option>
                          <option value="기타">기타</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10.5px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest pl-1">비고 (메모)</label>
                        <textarea
                          placeholder="특이사항을 입력하세요"
                          value={result.memo || ""}
                          onChange={(e) => setResult(prev => prev ? { ...prev, memo: e.target.value } : null)}
                          className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-zinc-950/50 transition-all text-sm font-medium min-h-[5rem] shadow-sm"
                        />
                      </div>
                    </div>

                    <button
                      onClick={async () => {
                        if (!result.id) return;
                        try {
                          await axios.patch(`${API_BASE_URL}/receipts/${result.id}`, result);
                          alert('저장되었습니다!');
                          setStatus('idle');
                          setResult(null);
                          setPreview(null);
                          setFile(null);
                          fetchDashboardData();
                        } catch {
                          alert('저장에 실패했습니다.');
                        }
                      }}
                      className="w-full py-3.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-xl font-bold hover:bg-black dark:hover:bg-zinc-200 transition-all shadow-lg flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 className="w-5 h-5" />
                      기록 저장하기
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="flex items-center justify-between px-1">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Landmark className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                최근 내역
              </h2>
              <Link href="/receipts" className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1">
                전체보기 <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="space-y-3">
              {recentReceipts.length > 0 ? (
                recentReceipts.map((r, i) => (
                  <motion.div
                    key={r.id || i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="bg-white dark:bg-zinc-900 p-3 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm flex items-center justify-between group hover:border-indigo-200 dark:hover:border-indigo-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {r.imageOriginalUrl ? (
                        <div 
                          className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 border border-zinc-200 dark:border-zinc-700 cursor-zoom-in"
                          onClick={() => setViewImageUrl(r.imageOriginalUrl!)}
                        >
                          <img src={r.imageOriginalUrl} alt="receipt" className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center text-lg flex-shrink-0">🧾</div>
                      )}
                      <div>
                        <p className="text-sm font-bold truncate max-w-[120px] dark:text-zinc-100">{r.merchantName}</p>
                        <p className="text-[10px] text-zinc-400 dark:text-zinc-500">{r.paidAt ? new Date(r.paidAt).toLocaleDateString('ko-KR') : '-'}</p>
                      </div>
                    </div>
                    <p className="text-sm font-black text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {r.amount?.toLocaleString()}원
                    </p>
                  </motion.div>
                ))
              ) : (
                <div className="py-12 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl border border-dotted border-zinc-200 dark:border-zinc-800">
                  <p className="text-xs text-zinc-400 dark:text-zinc-500 font-medium">등록된 내역이 없습니다</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* 이미지 뷰어 모달 */}
      <AnimatePresence>
        {viewImageUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm cursor-zoom-out"
            onClick={() => setViewImageUrl(null)}
          >
            <button 
              className="absolute top-6 right-6 w-10 h-10 bg-white/10 hover:bg-white/20 text-white rounded-full flex items-center justify-center transition-colors backdrop-blur-md"
              onClick={(e) => { e.stopPropagation(); setViewImageUrl(null); }}
            >
              <X className="w-5 h-5" />
            </button>
            <motion.img
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              src={viewImageUrl}
              alt="Receipt Full View"
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 모바일 퀵 업로드 FAB */}
      <div className="fixed bottom-6 right-6 md:hidden z-50">
        <label className="w-14 h-14 bg-indigo-600 text-white rounded-full shadow-xl shadow-indigo-200 flex items-center justify-center cursor-pointer active:scale-90 transition-transform">
          <Upload className="w-6 h-6" />
          <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
        </label>
      </div>
    </div>
  );
}
