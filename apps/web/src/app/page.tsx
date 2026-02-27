"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Upload, FileText, CheckCircle2, Loader2, Plus, ArrowRight, Wallet, PieChart, Landmark, Sun, Moon } from "lucide-react";
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

  // const router = useRouter();

  /* 
  const handleLogout = () => {
    localStorage.removeItem("isLoggedIn");
    router.push("/login");
  };
  */

  const { theme, setTheme } = useTheme();
  const [monthOffset, setMonthOffset] = useState<number>(0);

  const fetchDashboardData = async (offset = monthOffset) => {
    try {
      const authRes = await axios.get('/api/auth/me');
      setUser(authRes.data.user);

      const targetDate = new Date();
      targetDate.setMonth(targetDate.getMonth() + offset);
      const m = targetDate.getMonth() + 1;
      const y = targetDate.getFullYear();

      const statsRes = await axios.get(`${API_BASE_URL}/receipts/stats?month=${m}&year=${y}`);
      setStats(statsRes.data);

      const listRes = await axios.get(`${API_BASE_URL}/receipts`);
      setRecentReceipts(listRes.data.slice(0, 10)); // 최근 10개
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    }
  };

  useEffect(() => {
    fetchDashboardData(monthOffset);
  }, [monthOffset]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      try {
        const options = {
          maxSizeMB: 2,
          maxWidthOrHeight: 2560,
          initialQuality: 0.95,
          useWebWorker: true,
          fileType: "image/jpeg" as string,
        };
        const compressedBlob = await imageCompression(selectedFile, options);
        
        // Ensure the file maintains a valid name and extension for Naver OCR
        const safeName = selectedFile.name.replace(/\.[^/.]+$/, "") + ".jpg";
        const finalFile = new File([compressedBlob], safeName, { type: "image/jpeg" });
        
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

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans p-4 md:p-8 transition-colors duration-200">
      <header className="max-w-5xl mx-auto mb-10 flex justify-between items-center">
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
          <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-800 flex items-center justify-center overflow-hidden">
            <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">{user?.email?.substring(0, 2).toUpperCase() || 'US'}</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto space-y-8">
        {/* 요약 통계 대시보드 */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-indigo-600 dark:bg-indigo-500 text-white p-5 rounded-3xl shadow-lg shadow-indigo-100 dark:shadow-none flex flex-col justify-between"
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
            className="bg-white dark:bg-zinc-900 p-5 rounded-3xl border border-zinc-100 dark:border-zinc-800 shadow-sm flex flex-col justify-between"
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

              <label className={cn(
                "relative group flex flex-col items-center justify-center w-full aspect-[4/5] rounded-2xl border-2 border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all cursor-pointer overflow-hidden",
                preview ? "border-solid border-indigo-200" : ""
              )}>
                {preview ? (
                  <div className="relative w-full h-full">
                    <img src={preview} alt="Receipt Preview" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-all flex items-center justify-center">
                      <p className="text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">이미지 변경</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Upload className="w-6 h-6 text-zinc-500 dark:text-zinc-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium">영수증 이미지 업로드</p>
                      <p className="text-xs text-zinc-400 dark:text-zinc-500">JPG, PNG 파일 지원</p>
                    </div>
                  </div>
                )}
                <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
              </label>

              <button
                onClick={handleUpload}
                disabled={!file || status === "uploading"}
                className={cn(
                  "w-full mt-6 py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2",
                  !file || status === "uploading"
                    ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed"
                    : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-100 dark:shadow-none"
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
                  className="bg-white dark:bg-zinc-900 rounded-3xl p-5 shadow-sm border border-zinc-100 dark:border-zinc-800"
                >
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold text-sm tracking-tight uppercase">
                      <CheckCircle2 className="w-4 h-4" />
                      인식 완료
                    </div>
                    <span className="text-[10px] bg-indigo-50 dark:bg-zinc-800 text-indigo-700 dark:text-zinc-300 px-2 py-0.5 rounded-full font-bold">내용을 확인 후 저장해 주세요</span>
                  </div>

                  <div className="space-y-5">
                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">상호명</label>
                        <input
                          type="text"
                          value={result.merchantName || ""}
                          onChange={(e) => setResult({ ...result, merchantName: e.target.value })}
                          className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-zinc-950 transition-all text-sm font-bold"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">금액</label>
                        <input
                          type="number"
                          value={result.amount || 0}
                          onChange={(e) => setResult({ ...result, amount: parseInt(e.target.value) })}
                          className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-zinc-950 transition-all text-sm font-bold text-indigo-600 dark:text-indigo-400"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">날짜</label>
                        <input
                          type="date"
                          value={result.paidAt ? new Date(result.paidAt).toISOString().split('T')[0] : ""}
                          onChange={(e) => setResult({ ...result, paidAt: e.target.value })}
                          className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-zinc-950 transition-all text-sm font-bold"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">용도 (카테고리)</label>
                        <select
                          value={result.category || ""}
                          onChange={(e) => setResult({ ...result, category: e.target.value })}
                          className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-zinc-950 transition-all text-sm font-bold"
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
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-1">비고 (메모)</label>
                        <textarea
                          placeholder="특이사항을 입력하세요"
                          value={result.memo || ""}
                          onChange={(e) => setResult(prev => prev ? { ...prev, memo: e.target.value } : null)}
                          className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-zinc-950 transition-all text-sm font-medium min-h-[80px]"
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
                        <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 border border-zinc-200 dark:border-zinc-700">
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
